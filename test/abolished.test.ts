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

describe('checkAbolished: the postal code is judged against the successors (tac-v011)', () => {
  const BANG_NA = { province: 'กรุงเทพมหานคร', district: 'บางนา', subdistrict: 'บางนา' }
  const codes = (r: { findings: Finding[] }) => r.findings.map((f) => f.code)
  const mismatch = (r: { findings: Finding[] }) => r.findings.find((f) => f.code === 'POSTAL_CODE_MISMATCH')

  it('บางนา / บางนา / กรุงเทพมหานคร / 10260: no false mismatch, ambiguous between the two successors', () => {
    const r = check({ ...BANG_NA, postalCode: '10260' }) // 10260 is the code of บางนาเหนือ and บางนาใต้
    expect(mismatch(r)).toBeUndefined()
    expect(codes(r).filter((c) => c !== 'FORMAT_NORMALIZED')).toEqual(['ABOLISHED_AREA'])
    expect(r.status).toBe('ambiguous')
    expect(r.resolved).toBeUndefined()
    expect(r.output.postalCode).toBe('10260') // nothing rewritten
    expect(r.output.subdistrict).toBe('บางนา')
  })

  it('the same row written with เขต and กรุงเทพ gives the same result', () => {
    const r = check({ province: 'กรุงเทพ', district: 'เขตบางนา', subdistrict: 'แขวงบางนา', postalCode: '10260' })
    expect(mismatch(r)).toBeUndefined()
    expect(r.status).toBe('ambiguous')
  })

  it('with no postal code it is still ambiguous (unchanged)', () => {
    const r = check(BANG_NA)
    expect(r.status).toBe('ambiguous')
    expect(mismatch(r)).toBeUndefined()
  })

  it('a code that is in use but is not a successor\'s: mismatch, with the successors\' codes as expected', () => {
    const r = check({ ...BANG_NA, postalCode: '10200' })
    const f = mismatch(r)
    expect(f?.severity).toBe('error')
    expect(f?.fields).toEqual(['postalCode', 'subdistrict'])
    expect(f?.detail).toMatchObject({ given: '10200', expected: ['10260'], against: { field: 'subdistrict', abolished: true } })
    expect(f?.message.th).toContain('ใช้ 10260')
    expect(f?.message.th).toContain('ที่มาแทน')
    expect(r.status).toBe('invalid')
    expect(codes(r)).toContain('ABOLISHED_AREA') // still explained
  })

  it('never offers a code from another province: Ayutthaya\'s บางนา (13150) is not a hint for เขตบางนา', () => {
    for (const postalCode of ['10200', '13150']) {
      const f = mismatch(check({ ...BANG_NA, postalCode }))
      expect(f?.detail.expected, postalCode).toEqual(['10260'])
      expect(f?.message.th.replace(`รหัสไปรษณีย์ ${postalCode}`, '')).not.toContain('13150')
    }
  })

  it('an abolished name that is current NOWHERE (บางบอน) gets exactly one mismatch, not a district-level one plus a subdistrict-level one', () => {
    for (const district of ['เขตบางบอน', 'บางบอน']) {
      const row = { province: 'กรุงเทพมหานคร', district, subdistrict: 'บางบอน' }
      const wrong = check({ ...row, postalCode: '50200' })
      const found = wrong.findings.filter((f) => f.code === 'POSTAL_CODE_MISMATCH')
      expect(found, district).toHaveLength(1)
      expect(found[0]?.fields).toEqual(['postalCode', 'subdistrict'])
      expect(found[0]?.detail).toMatchObject({ given: '50200', expected: ['10150'], against: { abolished: true } })
      expect(wrong.status).toBe('invalid')
      expect(wrong.findings.map((f) => f.code)).toContain('ABOLISHED_AREA')
      // The right code (a successor's) is no mismatch at all.
      const right = check({ ...row, postalCode: '10150' })
      expect(right.findings.some((f) => f.code === 'POSTAL_CODE_MISMATCH')).toBe(false)
      expect(right.status).toBe('ambiguous')
    }
  })

  it('a code that is not valid keeps its own finding and gets no mismatch on top', () => {
    for (const postalCode of ['1026', '00000']) {
      const r = check({ ...BANG_NA, postalCode })
      expect(codes(r)).toContain('POSTAL_CODE_INVALID')
      expect(mismatch(r)).toBeUndefined()
    }
  })

  it('one successor with a gazette notice: its own code corrects, another in-use code is a mismatch', () => {
    const row = { province: 'กรุงเทพมหานคร', district: 'เขตพระโขนง', subdistrict: 'พระโขนง' } // 100997, a single successor
    const ok = check({ ...row, postalCode: '10110' })
    expect(ok.status).toBe('corrected')
    expect(mismatch(ok)).toBeUndefined()
    const bad = check({ ...row, postalCode: '10200' })
    expect(bad.status).toBe('invalid')
    expect(mismatch(bad)?.detail.expected).toEqual(['10110', '10260'])
  })

  it('an abolished name with no successor has nothing to compare with: validate\'s finding stays, without a hint', () => {
    const r = check({ province: 'กรุงเทพมหานคร', district: 'เขตบางเขน', subdistrict: 'บางเขน', postalCode: '10200' }) // 100599, no successor
    expect(abolishedFindings(r)).toHaveLength(1)
    expect(mismatch(r)).toBeDefined()
    expect(mismatch(r)?.detail.expected).toBeUndefined()
  })

  it('a current subdistrict is unaffected: a wrong code is still judged against that subdistrict', () => {
    const r = check({ province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน', postalCode: '84360' })
    expect(mismatch(r)?.detail.expected).toEqual(['84280'])
  })
})
