import { describe, expect, it } from 'vitest'
import { check, DEFAULT_OPTIONS } from '../src/check'
import { normalize } from '../src/normalize'
import { allSubdistricts, districtByCode, provinceByCode } from '../src/data'
import { AUTOCORRECT_MARGIN, POSTAL_CONFIDENCE, suggest } from '../src/suggest'
import type { AddressInput, CheckContext, CheckOptions, Finding } from '../src/types'

// suggest() is driven directly with a context built the way check() builds it, so these tests do
// not depend on validate.ts (a separate task). Every area is real in @geothai/core 5.0.0.

function ctxOf(input: AddressInput, options: CheckOptions = {}, findings: Finding[] = []): CheckContext {
  const normalized = normalize(input)
  const { applied, ...fields } = normalized
  void applied
  return {
    input,
    normalized,
    options: { ...DEFAULT_OPTIONS, ...options },
    output: { ...fields },
    findings,
    suggestions: [],
    candidates: [],
  }
}

function run(input: AddressInput, options?: CheckOptions, findings?: Finding[]): CheckContext {
  const ctx = ctxOf(input, options, findings)
  suggest(ctx)
  return ctx
}

const KO_PHANGAN = { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน', postalCode: '84280' }
const MAE_RIM = { province: 'เชียงใหม่', district: 'แม่ริม', postalCode: '50180' }

function unknownName(field: 'province' | 'subdistrict'): Finding {
  return { code: 'UNKNOWN_NAME', severity: 'error', fields: [field], message: { th: 'x', en: 'x' }, detail: {} }
}

describe('correct names are left alone', () => {
  it('changes nothing for a fully correct address', () => {
    const ctx = run(KO_PHANGAN)
    expect(ctx.output).toEqual(KO_PHANGAN)
    expect(ctx.findings).toEqual([])
    expect(ctx.suggestions).toEqual([])
  })

  it('A7: never rewrites a real subdistrict under the wrong district (แม่แดด / แม่ริม)', () => {
    const ctx = run({ ...MAE_RIM, subdistrict: 'แม่แดด' })
    expect(ctx.output.subdistrict).toBe('แม่แดด')
    expect(ctx.suggestions.filter((s) => s.field === 'subdistrict')).toEqual([])
    expect(ctx.findings).toEqual([])
  })

  it('leaves abolished names to abolished.ts', () => {
    // นางเลิ้ง (100899) was abolished and no current subdistrict has that name.
    const ctx = run({ province: 'กรุงเทพมหานคร', subdistrict: 'นางเลิ้ง' })
    expect(ctx.suggestions).toEqual([])
    expect(ctx.findings).toEqual([])
  })
})

describe('auto-correction (Global constraint 9)', () => {
  it('corrects a misspelled province confirmed by the other fields', () => {
    const ctx = run({ ...KO_PHANGAN, province: 'สุราษฎร์ธาณี' })
    expect(ctx.output.province).toBe('สุราษฎร์ธานี')
    expect(ctx.findings).toHaveLength(1)
    expect(ctx.findings[0]).toMatchObject({ code: 'MISSPELLED_NAME', severity: 'warning', fields: ['province'] })
    expect(ctx.findings[0]?.detail).toMatchObject({ given: 'สุราษฎร์ธาณี', closest: 'สุราษฎร์ธานี', applied: true })
    expect(ctx.candidates.map((c) => c.subdistrictCode)).toEqual(['840501'])
    expect(ctx.suggestions[0]).toMatchObject({ field: 'province', to: 'สุราษฎร์ธานี', reason: 'MISSPELLED_NAME' })
  })

  it('corrects a Bangkok district written without เขต to the official name', () => {
    const ctx = run({ province: 'กรุงเทพ', district: 'พรนะคร', subdistrict: 'พระบรมมหาราชวัง', postalCode: '10200' })
    expect(ctx.output.district).toBe('เขตพระนคร')
    expect(ctx.candidates.map((c) => c.subdistrictCode)).toEqual(['100101'])
  })

  it('corrects English names and answers in English', () => {
    const ctx = run({ province: 'Chaing Mai', district: 'Mae Rim' })
    expect(ctx.output.province).toBe('Chiang Mai')
  })

  it('only suggests when the confidence is below the threshold', () => {
    const ctx = run({ ...MAE_RIM, subdistrict: 'แม่แรน' })
    expect(ctx.output.subdistrict).toBe('แม่แรน')
    expect(ctx.suggestions[0]).toMatchObject({ field: 'subdistrict', to: 'แม่แรม' })
    expect(ctx.suggestions[0]?.confidence).toBeLessThan(0.9)
    expect(ctx.suggestions[0]?.resolved?.districtCode).toBe('5007')
    expect(ctx.findings[0]).toMatchObject({ code: 'MISSPELLED_NAME', severity: 'error' })
    expect(ctx.candidates).toEqual([])
  })

  it('applies the same suggestion when the caller lowers the threshold', () => {
    const ctx = run({ ...MAE_RIM, subdistrict: 'แม่แรน' }, { autoCorrectThreshold: 0.8 })
    expect(ctx.output.subdistrict).toBe('แม่แรม')
    expect(ctx.findings[0]?.severity).toBe('warning')
    expect(ctx.candidates).toHaveLength(1)
  })

  it('never changes a value when autoCorrect is false', () => {
    const ctx = run({ ...KO_PHANGAN, province: 'สุราษฎร์ธาณี' }, { autoCorrect: false })
    expect(ctx.output.province).toBe('สุราษฎร์ธาณี')
    expect(ctx.suggestions[0]?.to).toBe('สุราษฎร์ธานี')
    expect(ctx.findings[0]).toMatchObject({ code: 'MISSPELLED_NAME', severity: 'error' })
  })

  it('does not correct a repeated name without context to pick one area', () => {
    // หนองบัว is the name of 28 subdistricts.
    const ctx = run({ subdistrict: 'หนองบัา' })
    expect(ctx.output.subdistrict).toBe('หนองบัา')
    expect(ctx.candidates).toEqual([])
  })
})

describe('ranking uses the other fields', () => {
  it('ranks a candidate inside the given province first', () => {
    const ctx = run({ province: 'ขอนแก่น', subdistrict: 'หนองบัา' })
    const top = ctx.suggestions[0]
    expect(top).toMatchObject({ field: 'subdistrict', to: 'หนองบัว' })
    expect(top?.resolved?.provinceCode).toBe('40')
  })

  it('weights a candidate that contradicts a settled field below one that fits', () => {
    const ctx = run({ province: 'Chaing Mai', district: 'Mae Rim' })
    const [first, second] = ctx.suggestions
    expect(first?.to).toBe('Chiang Mai')
    expect(second?.confidence ?? 0).toBeLessThan(0.5)
  })

  it('never applies a candidate that one field confirms and another contradicts (review S1)', () => {
    // เมืองลำพูน fits the postal code 51000 but is not in เชียงใหม่.
    const ctx = run({ province: 'เชียงใหม่', district: 'เมืองลำพูล', postalCode: '51000' })
    expect(ctx.output.district).toBe('เมืองลำพูล')
    expect(ctx.suggestions[0]?.to).toBe('เมืองลำพูน')
    expect(ctx.suggestions[0]?.confidence).toBeLessThan(0.9)
  })

  it('returns at most maxSuggestions per field', () => {
    expect(run({ subdistrict: 'หนองบัา' }, { maxSuggestions: 1 }).suggestions).toHaveLength(1)
    expect(run({ subdistrict: 'หนองบัา' }, { maxSuggestions: 0 }).suggestions).toEqual([])
  })
})

describe('findings', () => {
  it('replaces validate UNKNOWN_NAME on the same field and keeps the rest', () => {
    const other = unknownName('subdistrict')
    const ctx = run({ ...KO_PHANGAN, province: 'สุราษฎร์ธาณี' }, {}, [unknownName('province'), other])
    expect(ctx.findings.map((f) => f.code)).toEqual(['UNKNOWN_NAME', 'MISSPELLED_NAME'])
    expect(ctx.findings[0]).toBe(other)
  })

  it('explains itself in Thai and English', () => {
    const f = run({ ...KO_PHANGAN, province: 'สุราษฎร์ธาณี' }).findings[0]
    expect(f?.message.th).toContain('สุราษฎร์ธานี')
    expect(f?.message.en).toContain('corrected')
  })
})

describe('postal code suggestion (feature 2)', () => {
  it('A7: suggests 84280 for เกาะพะงัน + 84360 without rewriting it', () => {
    const ctx = run({ ...KO_PHANGAN, postalCode: '84360' })
    expect(ctx.output.postalCode).toBe('84360')
    expect(ctx.suggestions).toEqual([
      expect.objectContaining({ field: 'postalCode', from: '84360', to: '84280', confidence: POSTAL_CONFIDENCE }),
    ])
    expect(POSTAL_CONFIDENCE).toBeLessThan(DEFAULT_OPTIONS.autoCorrectThreshold)
  })

  it('offers every code of a subdistrict that has several', () => {
    // สวนจิตรลดา 100203 uses 10300 and 10303.
    const ctx = run({ province: 'กรุงเทพมหานคร', district: 'ดุสิต', subdistrict: 'สวนจิตรลดา', postalCode: '10200' })
    expect(ctx.suggestions.map((s) => s.to)).toEqual(['10300', '10303'])
  })

  it('stays quiet when the names do not point to one subdistrict', () => {
    expect(run({ subdistrict: 'หนองบัว', postalCode: '84360' }).suggestions).toEqual([])
  })
})

describe('abolished names reach abolished.ts (review ruling A7)', () => {
  // These run the whole check() so the order fuzzy+suggest -> abolished is exercised for real.
  const fuzzy = (r: ReturnType<typeof check>) => [
    ...r.findings.filter((f) => f.code === 'MISSPELLED_NAME'),
    ...r.suggestions.filter((s) => s.reason === 'MISSPELLED_NAME'),
  ]

  it.each([{}, { autoCorrectThreshold: 0 }])('บางนา / เขตบางนา / กรุงเทพ stays ambiguous and is never applied (%o)', (options) => {
    const r = check({ province: 'กรุงเทพ', district: 'เขตบางนา', subdistrict: 'บางนา' }, options)
    expect(r.status).toBe('ambiguous')
    expect(r.output.subdistrict).toBe('บางนา')
    expect(r.findings.map((f) => f.code)).toContain('ABOLISHED_AREA')
    expect(fuzzy(r)).toEqual([])
  })

  it('บางบอน / เขตบางบอน stays ambiguous between its successors', () => {
    const r = check({ province: 'กรุงเทพ', district: 'เขตบางบอน', subdistrict: 'บางบอน' })
    expect(r.status).toBe('ambiguous')
    expect(r.output.subdistrict).toBe('บางบอน')
    expect(fuzzy(r)).toEqual([])
  })

  it('คลองตัน is left to abolished.ts, which corrects it by gazette notice', () => {
    const r = check({ province: 'กรุงเทพ', district: 'เขตพระโขนง', subdistrict: 'คลองตัน' })
    expect(fuzzy(r)).toEqual([])
    expect(r.findings.map((f) => f.code)).toContain('ABOLISHED_AREA')
  })

  it('an English abolished name is not fuzzed into another subdistrict', () => {
    const ctx = run({ province: 'Bangkok', district: 'Bang Bon', subdistrict: 'Bang Bon' })
    expect(ctx.suggestions).toEqual([])
    expect(ctx.findings).toEqual([])
  })

  it('a misspelled province next to an abolished subdistrict is still corrected, and abolished still decides', () => {
    // บางนา is also a current subdistrict in another province; that must not sink กรุงเทพมหานคร.
    const r = check({ province: 'กรุงเทพมหานตร', district: 'เขตบางนา', subdistrict: 'บางนา' })
    expect(r.output.province).toBe('กรุงเทพมหานคร')
    expect(r.status).toBe('ambiguous')
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['MISSPELLED_NAME', 'ABOLISHED_AREA']))
  })

  it('a misspelling of an abolished name is still a misspelling', () => {
    const r = check({ province: 'กรุงเทพ', district: 'เขตบางบอน', subdistrict: 'บางบอนน' })
    expect(r.output.subdistrict).toBe('บางบอนน')
    expect(r.suggestions[0]).toMatchObject({ field: 'subdistrict', reason: 'MISSPELLED_NAME' })
  })
})


describe('a close runner-up blocks auto-correction (tac-harden T1)', () => {
  // Found by the tester over every one-character typo of the 7,436 subdistrict names: a name one
  // character from TWO real names was "corrected" to whichever scored higher.
  const CASES = [
    // [input, the wrong pick that used to be applied, the other plausible name]
    [{ province: 'นครศรีธรรมราช', district: 'เมืองนครศรีธรรมราช', subdistrict: 'ท่าวัก', postalCode: '80000' }, 'ท่าซัก', 'ท่าวัง'],
    [{ province: 'ปทุมธานี', district: 'คลองหลวง', subdistrict: 'คลองหา', postalCode: '12110' }, 'คลองห้า', 'คลองหก'],
    [{ province: 'อุบลราชธานี', district: 'พิบูลมังสาหาร', subdistrict: 'โนนกาลง', postalCode: '34110' }, 'โนนกลาง', 'โนนกาหลง'],
  ] as const

  it.each(CASES)('%j is not rewritten: both names are offered, the caller decides', (input, wrong, other) => {
    const r = check(input)
    expect(r.status).not.toBe('corrected')
    expect(r.output.subdistrict).toBe(input.subdistrict) // untouched
    const names = r.suggestions.filter((s) => s.field === 'subdistrict').map((s) => s.to)
    expect(names).toEqual(expect.arrayContaining([wrong, other]))
    const f = r.findings.find((x) => x.code === 'MISSPELLED_NAME')
    expect(f?.severity).toBe('error')
    expect(f?.detail).toMatchObject({ applied: false })
    expect(f?.detail.closeRunnerUp).toBeTypeOf('string')
    expect(f?.message.th).toContain('ใกล้พอกัน')
    expect(f?.message.en).toContain('nearly as close')
  })

  it('a clear winner is still corrected (the margin only guards near-ties)', () => {
    const r = check({ province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงนั' })
    expect(r.status).toBe('corrected')
    expect(r.output.subdistrict).toBe('เกาะพะงัน')
    expect(r.findings.find((x) => x.code === 'MISSPELLED_NAME')?.detail.closeRunnerUp).toBeUndefined()
  })

  it('the margin is 0.15: a runner-up at least that far behind does not block', () => {
    expect(AUTOCORRECT_MARGIN).toBe(0.15)
  })

  it('dataset-wide: no applied subdistrict correction ever has a runner-up within the margin', () => {
    // One-character deletions and substitutions of a spread of real subdistricts (every 5th: ~1,500
    // names, ~20,000 typos), each with its district, province and postal code.
    const subs = ['ก', 'า', 'อ', 'ร', 'ล', 'น', 'ม', 'ง', 'ว', 'ย']
    let corrected = 0
    let crowded = 0
    allSubdistricts().forEach((s, n) => {
      if (n % 5 !== 0) return
      const district = districtByCode(s.district_code)
      const province = provinceByCode(s.province_code)
      if (!district || !province) return
      const t = [...s.name_th]
      const typos = [
        ...t.map((_, i) => t.filter((__, k) => k !== i).join('')),
        ...t.map((_, i) => t.map((c, k) => (k === i ? (subs[(i + t.length) % subs.length] as string) : c)).join('')),
      ]
      for (const typo of typos) {
        if (!typo || typo === s.name_th) continue
        const r = check({ province: province.name_th, district: district.name_th, subdistrict: typo, postalCode: s.postal_codes[0] })
        if (r.status !== 'corrected') continue
        corrected++
        const sg = r.suggestions.filter((x) => x.field === 'subdistrict')
        const second = sg[1]
        if (second && (sg[0]?.confidence ?? 0) - second.confidence < AUTOCORRECT_MARGIN) crowded++
      }
    })
    expect(corrected).toBeGreaterThan(5000) // the invariant is not vacuous
    expect(crowded).toBe(0)
  }, 60_000)
})
