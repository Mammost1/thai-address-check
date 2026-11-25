import { describe, expect, it } from 'vitest'
import { checkAbolished } from '../src/abolished'
import { check } from '../src/check'
import type { CheckContext, Finding } from '../src/types'

function ctxOf(output: CheckContext['output'], options: Partial<CheckContext['options']> = {}): CheckContext {
  return {
    input: output,
    normalized: { ...output, applied: {} },
    options: { autoCorrectThreshold: 0.9, autoCorrect: true, maxSuggestions: 3, ...options },
    output: { ...output },
    findings: [],
    suggestions: [],
    candidates: [],
  }
}

const abolishedFindings = (r: { findings: Finding[] }) => r.findings.filter((f) => f.code === 'ABOLISHED_AREA')

describe('checkAbolished: notice basis, one successor', () => {
  const input = { province: 'กรุงเทพมหานคร', district: 'พระโขนง', subdistrict: 'คลองตัน', postalCode: '10110' }

  it('corrects the subdistrict and its district, and resolves the successor', () => {
    const r = check(input)
    expect(r.status).toBe('corrected')
    expect(r.output).toEqual({ province: 'กรุงเทพมหานคร', district: 'เขตคลองเตย', subdistrict: 'คลองตัน', postalCode: '10110' })
    expect(r.resolved?.subdistrictCode).toBe('103302')
    const [f] = abolishedFindings(r)
    expect(f).toMatchObject({ severity: 'warning', fields: ['subdistrict'] })
    expect(f!.detail).toMatchObject({ basis: 'notice', applied: true })
    expect(f!.detail.source).toEqual(expect.stringContaining('ราชกิจจานุเบกษา'))
    expect(r.suggestions[0]).toMatchObject({ field: 'district', from: 'พระโขนง', to: 'เขตคลองเตย', reason: 'ABOLISHED_AREA' })
  })

  it('corrects when the postal code is absent', () => {
    expect(check({ ...input, postalCode: undefined }).status).toBe('corrected')
  })

  it('does not correct when the postal code disagrees with the successor', () => {
    const r = check({ ...input, postalCode: '99999' })
    expect(r.status).toBe('invalid')
    expect(r.output.district).toBe('พระโขนง')
    expect(abolishedFindings(r)[0]).toMatchObject({ severity: 'error' })
    expect(abolishedFindings(r)[0]!.detail.expected).toEqual(['10110'])
  })

  it('only reports when autoCorrect is false', () => {
    const r = check(input, { autoCorrect: false })
    expect(r.status).toBe('invalid')
    expect(r.output.district).toBe('พระโขนง')
    expect(r.suggestions[0]!.to).toBe('เขตคลองเตย')
  })

  it('does not correct when the threshold is above the evidence', () => {
    expect(check(input, { autoCorrectThreshold: 0.99 }).status).toBe('invalid')
  })
})

describe('checkAbolished: name basis is suggestion-only', () => {
  it('never applies, whatever the threshold', () => {
    const r = check({ province: 'กรุงเทพมหานคร', district: 'ดุสิต', subdistrict: 'บางซื่อ' }, { autoCorrectThreshold: 0 })
    expect(r.status).toBe('invalid')
    expect(r.output.district).toBe('ดุสิต')
    const s = r.suggestions.find((x) => x.field === 'district')!
    expect(s.to).toBe('เขตบางซื่อ')
    expect(s.confidence).toBeLessThan(0.9)
    expect(abolishedFindings(r)[0]!.detail.basis).toBe('name')
  })
})

describe('checkAbolished: no successor is report-only', () => {
  it('reports บางนา under เขตพระโขนง (basis null) with no suggestion', () => {
    const r = check({ province: 'กรุงเทพมหานคร', district: 'พระโขนง', subdistrict: 'บางนา' })
    expect(r.status).toBe('invalid')
    expect(r.suggestions).toEqual([])
    expect(abolishedFindings(r)[0]).toMatchObject({ severity: 'error' })
    expect(abolishedFindings(r)[0]!.detail.basis).toBeNull()
  })
})

describe('checkAbolished: several successors are always ambiguous', () => {
  it('A7: บางนา / เขตบางนา / กรุงเทพ -> ABOLISHED_AREA, two successors', () => {
    const ctx = ctxOf({ province: 'กรุงเทพมหานคร', district: 'บางนา', subdistrict: 'บางนา' })
    checkAbolished(ctx)
    expect(ctx.candidates.map((c) => c.subdistrict.th).sort()).toEqual(['บางนาเหนือ', 'บางนาใต้'])
    expect(ctx.output.subdistrict).toBe('บางนา')
    const r = check({ province: 'กรุงเทพ', district: 'เขตบางนา', subdistrict: 'บางนา' })
    expect(r.status).toBe('ambiguous')
    expect(r.resolved).toBeUndefined()
    expect(abolishedFindings(r)).toHaveLength(1)
  })

  it('บางบอน has four successors', () => {
    const ctx = ctxOf({ province: 'กรุงเทพมหานคร', district: 'บางบอน', subdistrict: 'บางบอน' })
    checkAbolished(ctx)
    expect(ctx.candidates).toHaveLength(4)
  })

  it('caps suggestions per field at maxSuggestions (default 3, 1, 0)', () => {
    const input = { province: 'กรุงเทพมหานคร', district: 'เขตบางบอน', subdistrict: 'บางบอน' }
    const count = (n?: number) =>
      check(input, n === undefined ? undefined : { maxSuggestions: n }).suggestions.filter((s) => s.field === 'subdistrict').length
    expect(count()).toBe(3)
    expect(count(1)).toBe(1)
    expect(count(0)).toBe(0)
    expect(count(10)).toBe(4)
  })

  it('does not auto-correct even with a postal code that fits one successor', () => {
    const ctx = ctxOf({ province: 'กรุงเทพมหานคร', district: 'บางนา', subdistrict: 'บางนา', postalCode: '10260' })
    checkAbolished(ctx)
    expect(ctx.output.subdistrict).toBe('บางนา')
    expect(ctx.candidates.length).toBeGreaterThan(1)
  })
})

describe('checkAbolished: a current name wins', () => {
  it('does nothing for a current subdistrict, even when an abolished one had its name', () => {
    const ctx = ctxOf({ province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน' })
    checkAbolished(ctx)
    expect(ctx.findings).toEqual([])
  })

  it('does nothing for บางนา in Phra Nakhon Si Ayutthaya, where it is current', () => {
    const ctx = ctxOf({ province: 'พระนครศรีอยุธยา', district: 'บางนา', subdistrict: 'บางนา' })
    checkAbolished(ctx)
    expect(ctx.findings).toEqual([])
  })

  it('does nothing when validate already resolved the address', () => {
    const ctx = ctxOf({ province: 'กรุงเทพมหานคร', district: 'บางนา', subdistrict: 'บางนา' })
    ctx.candidates = [{ provinceCode: '10' } as never]
    checkAbolished(ctx)
    expect(ctx.findings).toEqual([])
  })

  it('does nothing without a district or subdistrict', () => {
    const ctx = ctxOf({ province: 'กรุงเทพมหานคร', postalCode: '10260' })
    checkAbolished(ctx)
    expect(ctx.findings).toEqual([])
  })
})

describe('checkAbolished: district level', () => {
  it('reports an abolished district with its successor district, without rewriting', () => {
    const r = check({ province: 'หนองคาย', district: 'บึงกาฬ' })
    expect(r.status).toBe('invalid')
    expect(r.output.district).toBe('บึงกาฬ')
    expect(abolishedFindings(r)[0]).toMatchObject({ fields: ['district'] })
    expect(r.suggestions[0]).toMatchObject({ field: 'district', to: 'เมืองบึงกาฬ', reason: 'ABOLISHED_AREA' })
  })
})

describe('checkAbolished: supersedes validate findings on the explained field', () => {
  it('drops UNKNOWN_NAME and PARENT_MISMATCH for the abolished field but keeps others', () => {
    const ctx = ctxOf({ province: 'กรุงเทพมหานคร', district: 'บางนา', subdistrict: 'บางนา' })
    const mk = (code: 'UNKNOWN_NAME' | 'PARENT_MISMATCH' | 'POSTAL_CODE_INVALID', fields: ('subdistrict' | 'postalCode')[]) => ({
      code, severity: 'error' as const, fields, message: { th: '', en: '' }, detail: {},
    })
    ctx.findings = [mk('UNKNOWN_NAME', ['subdistrict']), mk('PARENT_MISMATCH', ['subdistrict']), mk('POSTAL_CODE_INVALID', ['postalCode'])]
    checkAbolished(ctx)
    expect(ctx.findings.map((f) => f.code).sort()).toEqual(['ABOLISHED_AREA', 'POSTAL_CODE_INVALID'])
  })
})
