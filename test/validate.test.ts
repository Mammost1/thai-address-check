import { describe, expect, it } from 'vitest'
import { check, checkMany } from '../src/check'
import { subdistrictsByName } from '../src/data'
import { normalize } from '../src/normalize'
import type { AddressInput, CheckContext, CheckOptions, Finding } from '../src/types'
import { validate } from '../src/validate'

/** Runs validate() alone on a normalized address, the way check() hands it over. */
function run(input: AddressInput, options: CheckOptions = {}): CheckContext {
  const normalized = normalize(input)
  const { applied: _applied, ...fields } = normalized
  const ctx: CheckContext = {
    input,
    normalized,
    options: { autoCorrectThreshold: 0.9, autoCorrect: true, maxSuggestions: 3, ...options },
    output: { ...fields },
    findings: [],
    suggestions: [],
    candidates: [],
  }
  validate(ctx)
  return ctx
}

const codes = (ctx: CheckContext): string[] => ctx.findings.map((f) => f.code)
const one = (ctx: CheckContext, code: Finding['code']): Finding => {
  const found = ctx.findings.filter((f) => f.code === code)
  expect(found, `findings of ${code}`).toHaveLength(1)
  return found[0] as Finding
}

const KO_PHANGAN = { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน', postalCode: '84280' }

describe('a consistent address', () => {
  it('resolves to exactly one candidate with no findings', () => {
    const ctx = run(KO_PHANGAN)
    expect(ctx.findings).toEqual([])
    expect(ctx.candidates).toHaveLength(1)
    expect(ctx.candidates[0]?.subdistrictCode).toBe('840501')
    expect(ctx.output).toEqual(KO_PHANGAN)
  })

  it('accepts English names, with any case and hyphenation', () => {
    const ctx = run({ province: 'surat thani', district: 'KO PHA-NGAN', subdistrict: 'Ko Pha ngan', postalCode: '84280' })
    expect(ctx.findings).toEqual([])
    expect(ctx.candidates[0]?.subdistrictCode).toBe('840501')
  })

  it('accepts either postal code of a subdistrict that has two', () => {
    for (const postalCode of ['10300', '10303']) {
      const ctx = run({ province: 'กรุงเทพมหานคร', district: 'ดุสิต', subdistrict: 'สวนจิตรลดา', postalCode })
      expect(ctx.findings).toEqual([])
      expect(ctx.candidates).toHaveLength(1)
    }
  })

  it('takes a Bangkok district with or without its เขต prefix', () => {
    for (const district of ['ดุสิต', 'เขตดุสิต']) {
      expect(run({ province: 'กรุงเทพมหานคร', district, subdistrict: 'สวนจิตรลดา' }).candidates).toHaveLength(1)
    }
  })
})

describe('feature 1: findings per field', () => {
  it('A7: a wrong postal code names the codes that fit', () => {
    const ctx = run({ ...KO_PHANGAN, postalCode: '84360' })
    expect(codes(ctx)).toEqual(['POSTAL_CODE_MISMATCH'])
    const f = one(ctx, 'POSTAL_CODE_MISMATCH')
    expect(f.severity).toBe('error')
    expect(f.fields).toEqual(['postalCode', 'subdistrict'])
    expect(f.detail).toMatchObject({ given: '84360', expected: ['84280'] })
    expect(f.message.th).toContain('84280')
    expect(f.message.en).toContain('84280')
    expect(ctx.candidates).toEqual([])
    expect(ctx.output).toEqual({ ...KO_PHANGAN, postalCode: '84360' }) // never rewritten
    expect(ctx.suggestions).toEqual([])
  })

  it('A7: แม่แดด under แม่ริม is a PARENT_MISMATCH and is not rewritten', () => {
    const ctx = run({ province: 'เชียงใหม่', district: 'แม่ริม', subdistrict: 'แม่แดด', postalCode: '58130' })
    expect(codes(ctx)).toEqual(['PARENT_MISMATCH'])
    const f = one(ctx, 'PARENT_MISMATCH')
    expect(f.fields).toEqual(['subdistrict', 'district'])
    expect(f.detail.expected).toEqual([
      { province: 'เชียงใหม่', district: 'กัลยาณิวัฒนา', subdistrict: 'แม่แดด', postalCodes: ['58130'] },
    ])
    expect(ctx.candidates).toEqual([])
    expect(ctx.suggestions).toEqual([])
    expect(ctx.output.subdistrict).toBe('แม่แดด')
  })

  it('reports every problem of one address, not just the first', () => {
    const ctx = run({ province: 'เชียงใหม่', district: 'เกาะพะงัน', subdistrict: 'ตลาด', postalCode: '99999' })
    expect(new Set(codes(ctx))).toEqual(new Set(['PARENT_MISMATCH', 'POSTAL_CODE_INVALID']))
    expect(ctx.findings.filter((f) => f.code === 'PARENT_MISMATCH').map((f) => f.fields)).toEqual([
      ['district', 'province'],
      ['subdistrict', 'district'],
    ])
  })

  it.each([
    ['province', { province: 'เมืองมั่ว', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน' }],
    ['district', { province: 'สุราษฎร์ธานี', district: 'เมืองมั่ว', subdistrict: 'เกาะพะงัน' }],
    ['subdistrict', { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เมืองมั่ว' }],
  ] as const)('UNKNOWN_NAME for an unknown %s, alone in its finding', (field, input) => {
    const ctx = run(input)
    const f = one(ctx, 'UNKNOWN_NAME')
    expect(f.fields).toEqual([field])
    expect(f.detail).toMatchObject({ given: 'เมืองมั่ว', level: field })
    expect(f.severity).toBe('error')
    expect(ctx.candidates).toEqual([])
  })

  it('still checks the names it did find when another one is unknown', () => {
    const ctx = run({ province: 'เชียงใหม่', district: 'เกาะพะงัน', subdistrict: 'เมืองมั่ว' })
    expect(codes(ctx).sort()).toEqual(['PARENT_MISMATCH', 'UNKNOWN_NAME'])
  })

  it('POSTAL_CODE_INVALID for a code that is not 5 digits', () => {
    for (const postalCode of ['1234', '842800', '12']) {
      const ctx = run({ ...KO_PHANGAN, postalCode })
      const f = one(ctx, 'POSTAL_CODE_INVALID')
      expect(f.detail).toMatchObject({ given: postalCode, reason: 'format' })
    }
  })

  it('POSTAL_CODE_INVALID for a 5-digit code nobody uses, with the codes that would fit', () => {
    const f = one(run({ ...KO_PHANGAN, postalCode: '00000' }), 'POSTAL_CODE_INVALID')
    expect(f.detail).toMatchObject({ given: '00000', reason: 'not-in-use', expected: ['84280'] })
  })

  it('does not call a code wrong for a subdistrict when it was never in use', () => {
    expect(codes(run({ ...KO_PHANGAN, postalCode: '00000' }))).toEqual(['POSTAL_CODE_INVALID'])
  })

  it('judges the code against the district when only a district is given', () => {
    const ctx = run({ district: 'เกาะพะงัน', postalCode: '10300' })
    const f = one(ctx, 'POSTAL_CODE_MISMATCH')
    expect(f.fields).toEqual(['postalCode', 'district'])
    expect(f.detail.expected).toEqual(['84280', '84360'])
  })

  it('judges the code against the province when only a province is given', () => {
    const ctx = run({ province: 'สุราษฎร์ธานี', postalCode: '10300' })
    const f = one(ctx, 'POSTAL_CODE_MISMATCH')
    expect(f.fields).toEqual(['postalCode', 'province'])
    expect(f.detail.expected).toBeUndefined()
  })

  it('a wrong code on a multi-code subdistrict lists both codes that fit', () => {
    const ctx = run({ province: 'กรุงเทพมหานคร', district: 'ดุสิต', subdistrict: 'สวนจิตรลดา', postalCode: '84280' })
    expect(one(ctx, 'POSTAL_CODE_MISMATCH').detail.expected).toEqual(['10300', '10303'])
  })

  it('a repeated subdistrict name elsewhere cannot hide a wrong postal code', () => {
    // บางมด exists in เขตจอมทอง (10150) and เขตทุ่งครุ (10140): the code must fit the given district.
    const ctx = run({ province: 'กรุงเทพมหานคร', district: 'จอมทอง', subdistrict: 'บางมด', postalCode: '10140' })
    expect(one(ctx, 'POSTAL_CODE_MISMATCH').detail.expected).toEqual(['10150'])
  })

  it('names a district that exists in two provinces by the province given', () => {
    const bkk = run({ province: 'กรุงเทพมหานคร', district: 'จอมทอง', subdistrict: 'บางมด' })
    expect(bkk.findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(bkk.candidates[0]?.districtCode).toBe('1035')
    const cm = run({ province: 'เชียงใหม่', district: 'จอมทอง', subdistrict: 'บ้านหลวง' })
    expect(cm.findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(cm.candidates[0]?.districtCode).toBe('5002')
  })

  it('reports names that exist but never in one place together', () => {
    // บางขุนเทียน is in เขตจอมทอง (Bangkok); เชียงใหม่ has a อำเภอจอมทอง too, but not that subdistrict.
    const ctx = run({ province: 'เชียงใหม่', district: 'จอมทอง', subdistrict: 'บางขุนเทียน' })
    const f = one(ctx, 'PARENT_MISMATCH')
    expect(f.detail).toMatchObject({ reason: 'no-single-area' })
    expect(f.fields).toEqual(['province', 'district', 'subdistrict'])
  })

  it('treats a blank field as missing, not as an unknown name', () => {
    const ctx = run({ province: '', district: '  ', subdistrict: 'เกาะพะงัน', postalCode: '' })
    expect(ctx.findings.some((f) => f.code === 'UNKNOWN_NAME')).toBe(false)
    expect(ctx.candidates).toHaveLength(1)
  })

  it('findings always carry fields, both messages and detail (constraint 10)', () => {
    const inputs: AddressInput[] = [
      { ...KO_PHANGAN, postalCode: '84360' },
      { province: 'เชียงใหม่', district: 'แม่ริม', subdistrict: 'แม่แดด' },
      { subdistrict: 'หนองบัว' },
      { province: 'สุราษฎร์ธานี' },
      { postalCode: '12' },
      { subdistrict: 'เกาะพะงัน' },
    ]
    for (const input of inputs) {
      for (const f of run(input).findings) {
        expect(f.fields.length).toBeGreaterThan(0)
        expect(f.message.th).not.toBe('')
        expect(f.message.en).not.toBe('')
        expect(Object.keys(f.detail).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('feature 6: fill the missing fields', () => {
  it('fills district and province from a postal code and a subdistrict name', () => {
    const ctx = run({ subdistrict: 'เกาะพะงัน', postalCode: '84280' })
    expect(ctx.output).toEqual({
      province: 'สุราษฎร์ธานี',
      district: 'เกาะพะงัน',
      subdistrict: 'เกาะพะงัน',
      postalCode: '84280',
    })
    const f = one(ctx, 'MISSING_FIELD')
    expect(f.severity).toBe('info')
    expect(f.fields).toEqual(['province', 'district'])
    expect(f.detail).toMatchObject({ filled: { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน' }, applied: true })
    expect(ctx.suggestions.map((s) => [s.field, s.from, s.to, s.confidence, s.reason])).toEqual([
      ['province', undefined, 'สุราษฎร์ธานี', 1, 'MISSING_FIELD'],
      ['district', undefined, 'เกาะพะงัน', 1, 'MISSING_FIELD'],
    ])
    expect(ctx.suggestions[0]?.resolved?.subdistrictCode).toBe('840501')
    expect(ctx.candidates).toHaveLength(1)
  })

  it('fills everything from a postal code that only one subdistrict uses', () => {
    const ctx = run({ postalCode: '84360' })
    expect(ctx.candidates).toHaveLength(1)
    expect(ctx.output.province).toBe('สุราษฎร์ธานี')
    expect(ctx.output.subdistrict).toBeDefined()
    expect(ctx.output.district).toBeDefined()
  })

  it('fills a unique subdistrict name inside a given district, province and postal code left out', () => {
    const ctx = run({ province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน' })
    expect(ctx.output.postalCode).toBe('84280')
    expect(ctx.findings).toHaveLength(1)
    expect(ctx.findings[0]?.fields).toEqual(['postalCode'])
  })

  it('writes a filled Bangkok district without the เขต prefix, as normalize() does', () => {
    const ctx = run({ province: 'กรุงเทพมหานคร', subdistrict: 'สวนจิตรลดา', postalCode: '10300' })
    expect(ctx.output.district).toBe('ดุสิต')
    expect(ctx.suggestions.find((s) => s.field === 'district')?.to).toBe('ดุสิต')
  })

  it('fills in Thai even when the caller wrote the other fields in English', () => {
    const ctx = run({ subdistrict: 'Ko Pha-ngan', postalCode: '84280' })
    expect(ctx.output.province).toBe('สุราษฎร์ธานี')
    expect(ctx.output.subdistrict).toBe('Ko Pha-ngan') // given fields are never rewritten
  })

  it('does not pick one of several postal codes; the address still resolves', () => {
    const ctx = run({ province: 'กรุงเทพมหานคร', district: 'ดุสิต', subdistrict: 'สวนจิตรลดา' })
    expect(ctx.candidates).toHaveLength(1)
    expect(ctx.output.postalCode).toBeUndefined()
    const f = one(ctx, 'MISSING_FIELD')
    expect(f.fields).toEqual(['postalCode'])
    expect(f.severity).toBe('info')
    expect(f.detail.options).toEqual(['10300', '10303'])
    expect(ctx.suggestions).toEqual([])
  })

  it('reports the fill but changes nothing when autoCorrect is off', () => {
    const ctx = run({ subdistrict: 'เกาะพะงัน', postalCode: '84280' }, { autoCorrect: false })
    expect(ctx.output).toEqual({ subdistrict: 'เกาะพะงัน', postalCode: '84280' })
    const f = one(ctx, 'MISSING_FIELD')
    expect(f.severity).toBe('warning')
    expect(f.detail).toMatchObject({ applied: false })
    expect(ctx.suggestions.map((s) => s.field)).toEqual(['province', 'district'])
    expect(ctx.candidates).toHaveLength(1)
  })

  it('lists an applied fill even when maxSuggestions is 0, and an unapplied one never', () => {
    const applied = run({ subdistrict: 'เกาะพะงัน', postalCode: '84280' }, { maxSuggestions: 0 })
    expect(applied.suggestions).toHaveLength(2)
    const reportOnly = run({ subdistrict: 'เกาะพะงัน', postalCode: '84280' }, { maxSuggestions: 0, autoCorrect: false })
    expect(reportOnly.suggestions).toEqual([])
  })

  it('never fills when anything is wrong', () => {
    const ctx = run({ subdistrict: 'เกาะพะงัน', postalCode: '84360' })
    expect(ctx.output).toEqual({ subdistrict: 'เกาะพะงัน', postalCode: '84360' })
    expect(ctx.suggestions).toEqual([])
    expect(ctx.candidates).toEqual([])
  })
})

describe('AMBIGUOUS and MISSING_FIELD', () => {
  it('a postal code shared by several subdistricts is ambiguous and says what to add', () => {
    const ctx = run({ postalCode: '58130' })
    expect(ctx.candidates).toHaveLength(10)
    const f = one(ctx, 'AMBIGUOUS')
    expect(f.severity).toBe('error')
    expect(f.detail).toMatchObject({ count: 10, optionsTotal: 10 })
    expect(f.fields).toEqual(expect.arrayContaining(['district', 'subdistrict']))
    expect(ctx.output).toEqual({ postalCode: '58130' }) // nothing filled when several fit
  })

  it('a repeated subdistrict name alone is ambiguous; the options are capped', () => {
    const ctx = run({ subdistrict: 'หนองบัว' })
    expect(ctx.candidates).toHaveLength(28)
    const f = one(ctx, 'AMBIGUOUS')
    expect(f.detail).toMatchObject({ count: 28, optionsTotal: 28 })
    expect((f.detail.options as unknown[]).length).toBe(10)
    expect(f.fields).toEqual(['province', 'district', 'postalCode'])
  })

  it('another field narrows an ambiguity to one address', () => {
    expect(codes(run({ subdistrict: 'หนองบัว', postalCode: '58130' }))).toEqual(['POSTAL_CODE_MISMATCH'])
    const narrowed = run({ province: 'สุราษฎร์ธานี', subdistrict: 'ตลาด' })
    expect(narrowed.candidates).toHaveLength(1)
  })

  it('two subdistricts of one name in one province stay ambiguous until the district is given', () => {
    const both = run({ province: 'กรุงเทพมหานคร', subdistrict: 'บางมด' })
    expect(both.candidates).toHaveLength(2)
    expect(one(both, 'AMBIGUOUS').detail.needs).toEqual(['district', 'postalCode']) // same name twice: the name alone cannot tell them apart
    expect(run({ province: 'กรุงเทพมหานคร', district: 'ทุ่งครุ', subdistrict: 'บางมด' }).candidates).toHaveLength(1)
    expect(run({ province: 'กรุงเทพมหานคร', subdistrict: 'บางมด', postalCode: '10140' }).candidates).toHaveLength(1)
  })

  it.each([
    ['nothing', {}],
    ['only a province', { province: 'สุราษฎร์ธานี' }],
    ['only a district', { district: 'เกาะพะงัน' }],
    ['province and district', { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน' }],
  ] as const)('MISSING_FIELD error when %s is given', (_name, input) => {
    const ctx = run(input)
    const f = one(ctx, 'MISSING_FIELD')
    expect(f.severity).toBe('error')
    expect(f.fields).toEqual(['subdistrict', 'postalCode'])
    expect(f.detail).toEqual({ needsOneOf: ['subdistrict', 'postalCode'] })
    expect(ctx.candidates).toEqual([])
  })

  it('an invalid postal code with no subdistrict reports both problems', () => {
    expect(new Set(codes(run({ province: 'สุราษฎร์ธานี', postalCode: '12' })))).toEqual(
      new Set(['POSTAL_CODE_INVALID', 'MISSING_FIELD']),
    )
  })
})

describe('through check()', () => {
  it('a clean address is valid', () => {
    const r = check(KO_PHANGAN)
    expect(r.status).toBe('valid')
    expect(r.resolved?.subdistrictCode).toBe('840501')
    expect(r.findings).toEqual([])
  })

  it('a filled address is corrected, and checking its output again is valid', () => {
    const r = check({ subdistrict: 'เกาะพะงัน', postalCode: '84280' })
    expect(r.status).toBe('corrected')
    expect(r.output).toMatchObject({ province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน' })
    expect(check(r.output).status).toBe('valid')
  })

  it('with autoCorrect off, a fillable address stays valid, with a warning and the output untouched', () => {
    const r = check({ subdistrict: 'เกาะพะงัน', postalCode: '84280' }, { autoCorrect: false })
    expect(r.status).toBe('valid')
    expect(r.output).toEqual({ subdistrict: 'เกาะพะงัน', postalCode: '84280' })
    expect(r.findings.find((f) => f.code === 'MISSING_FIELD')?.severity).toBe('warning')
  })

  it('A7: เกาะพะงัน + 84360 is invalid and the code is not silently rewritten', () => {
    const r = check({ ...KO_PHANGAN, postalCode: '84360' })
    expect(r.status).toBe('invalid')
    expect(r.output.postalCode).toBe('84360')
    expect(r.findings.some((f) => f.code === 'POSTAL_CODE_MISMATCH')).toBe(true)
  })

  it('A7: แม่แดด under แม่ริม is invalid and แม่แดด is not replaced by another subdistrict', () => {
    const r = check({ province: 'เชียงใหม่', district: 'แม่ริม', subdistrict: 'แม่แดด', postalCode: '58130' })
    expect(r.status).toBe('invalid')
    expect(r.output.subdistrict).toBe('แม่แดด')
    expect(r.findings.some((f) => f.code === 'PARENT_MISMATCH')).toBe(true)
  })

  it('an ambiguous address is ambiguous', () => {
    const r = check({ postalCode: '58130' })
    expect(r.status).toBe('ambiguous')
    expect(r.resolved).toBeUndefined()
  })

  it('an input of formatting noise resolves like the clean address', () => {
    const r = check({ province: 'จ. สุราษฎร์ธานี', district: 'อ.เกาะพะงัน', subdistrict: 'ต.เกาะพะงัน', postalCode: '๘๔๒๘๐' })
    expect(r.status).toBe('valid')
    expect(r.findings.every((f) => f.code === 'FORMAT_NORMALIZED')).toBe(true)
  })

  it('does not change the caller input or the normalized copy', () => {
    const input = { subdistrict: 'เกาะพะงัน', postalCode: '84280' }
    const r = check(input)
    expect(input).toEqual({ subdistrict: 'เกาะพะงัน', postalCode: '84280' })
    expect(r.input).toEqual(input)
    expect(r.normalized.province).toBeUndefined()
  })
})

describe('postal hint stays inside the given parents', () => {
  it('บางนา / เขตบางนา / กรุงเทพ / 10260: reports the mismatch but suggests no code', () => {
    // บางนา exists today only in Ayutthaya (13150); in เขตบางนา the old บางนา is abolished.
    const ctx = run({ province: 'กรุงเทพ', district: 'เขตบางนา', subdistrict: 'บางนา', postalCode: '10260' })
    const f = one(ctx, 'POSTAL_CODE_MISMATCH')
    expect(f.detail.expected).toBeUndefined()
    expect(f.detail.expectedTotal).toBeUndefined()
    expect(f.message.th).not.toContain('ใช้')
    expect(f.message.en).not.toContain('uses')
    // The hint is about the postal code. PARENT_MISMATCH may still say where the name does exist
    // (Ayutthaya's บางนา, labelled with its own province), which is a location, not a suggestion.
    expect(JSON.stringify(f)).not.toContain('13150')
  })

  it('a district whose name exists elsewhere does not lend its codes either', () => {
    // จอมทอง is a district in Bangkok and in เชียงใหม่; with Bangkok's province wrong, no code is hinted.
    const ctx = run({ province: 'สุราษฎร์ธานี', district: 'จอมทอง', postalCode: '10150' })
    expect(ctx.findings.some((f) => f.code === 'POSTAL_CODE_MISMATCH' && f.detail.expected !== undefined)).toBe(false)
  })

  it('A7: เกาะพะงัน / สุราษฎร์ธานี / 84360 still suggests 84280', () => {
    expect(one(run({ ...KO_PHANGAN, postalCode: '84360' }), 'POSTAL_CODE_MISMATCH').detail.expected).toEqual(['84280'])
  })

  it('a name that exists in several provinces: the hint is the code of the given province', () => {
    const elsewhere = subdistrictsByName('ตลาด').filter((s) => s.province_code !== '84')
    expect(elsewhere.length).toBeGreaterThan(0) // the trap is real: other provinces have a ตลาด
    const full = run({ province: 'สุราษฎร์ธานี', district: 'เมืองสุราษฎร์ธานี', subdistrict: 'ตลาด', postalCode: '10200' })
    expect(one(full, 'POSTAL_CODE_MISMATCH').detail.expected).toEqual(['84000'])
    const provinceOnly = run({ province: 'สุราษฎร์ธานี', subdistrict: 'ตลาด', postalCode: '10200' })
    expect(one(provinceOnly, 'POSTAL_CODE_MISMATCH').detail.expected).toEqual(['84000'])
    for (const s of elsewhere) expect(JSON.stringify(full.findings)).not.toContain(s.postal_codes[0] as string)
  })
})

describe('Thai messages use Thai field labels', () => {
  const inputs: AddressInput[] = [
    { province: 'จ.สุราษฎร์ธานี', district: 'อ.เกาะพะงัน', subdistrict: 'ต.เกาะพะงัน', postalCode: '๘๔๒๘๐' },
    { ...KO_PHANGAN, postalCode: '84360' },
    { ...KO_PHANGAN, postalCode: '1234' },
    { ...KO_PHANGAN, postalCode: '00000' },
    { province: 'เชียงใหม่', district: 'แม่ริม', subdistrict: 'แม่แดด', postalCode: '58130' },
    { province: 'กรุงเทพ', district: 'เขตบางนา', subdistrict: 'บางนา', postalCode: '10260' },
    { province: 'สุราษฎร์ธานี', district: 'เมืองมั่ว', subdistrict: 'เกาะพะงัน' },
    { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงนั' },
    { province: 'เชียงใหม่', district: 'จอมทอง', subdistrict: 'บางขุนเทียน' },
    { subdistrict: 'เกาะพะงัน', postalCode: '84280' },
    { subdistrict: 'หนองบัว' },
    { postalCode: '58130' },
    { province: 'สุราษฎร์ธานี' },
    {},
  ]

  it('never shows a field id (province, district, subdistrict, postalCode) in a Thai sentence', () => {
    let messages = 0
    for (const input of inputs) {
      for (const f of check(input).findings) {
        messages++
        expect(f.message.th, `${f.code} for ${JSON.stringify(input)}`).not.toMatch(/province|district|subdistrict|postalCode/)
      }
    }
    expect(messages).toBeGreaterThanOrEqual(15) // the inputs really do exercise many findings
  })

  it('names the fields in Thai in the findings that mention a field', () => {
    const ctx = run({ ...KO_PHANGAN, postalCode: '84360' })
    expect(one(ctx, 'POSTAL_CODE_MISMATCH').message.th).toContain('ตำบล/แขวง')
    expect(one(ctx, 'POSTAL_CODE_MISMATCH').message.en).toContain('subdistrict')
    expect(one(run({ subdistrict: 'หนองบัว' }), 'AMBIGUOUS').message.th).toContain('จังหวัด')
  })
})

describe('input that is not an address object (tac-harden T11)', () => {
  const BAD: [string, unknown, string][] = [
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a string', 'เกาะพะงัน', 'string'],
    ['a number', 84280, 'number'],
    ['an array', [], 'an array'],
  ]

  it.each(BAD)('check(%s) throws a TypeError that says what was expected', (_name, value, got) => {
    expect(() => check(value as never)).toThrow(TypeError)
    expect(() => check(value as never)).toThrow(`expected an address object such as { province, district, subdistrict, postalCode }, got ${got}`)
  })

  it('normalize() says the same, and checkMany() throws when it reaches the bad item', () => {
    expect(() => normalize(undefined as never)).toThrow(/expected an address object/)
    const results = checkMany([{ subdistrict: 'เกาะพะงัน', postalCode: '84280' }, undefined as never])
    expect(results.next().value?.status).toBe('corrected') // the good item is still checked first
    expect(() => results.next()).toThrow(/expected an address object/)
  })

  it('real objects are untouched: an empty object, extra keys and a numeric postal code still work', () => {
    expect(check({}).status).toBe('invalid')
    expect(check({ subdistrict: 'เกาะพะงัน', postalCode: 84280 as never, note: 'x' } as never).status).toBe('corrected')
  })
})
