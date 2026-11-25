import { describe, expect, it } from 'vitest'
import { normalize } from '../src/normalize'

// Every name below is a real current area from @geothai/core 5.0.0 (data 2026.10.23):
// ตลาด 840101 / เมืองสุราษฎร์ธานี 8401 / สุราษฎร์ธานี 84, พระบรมมหาราชวัง 100101 / เขตพระนคร 1001,
// จ.ป.ร. 850406 (a subdistrict whose real name starts like the province prefix 'จ.').

describe('normalize', () => {
  it('leaves a clean address unchanged and records no rule', () => {
    const input = { province: 'สุราษฎร์ธานี', district: 'เมืองสุราษฎร์ธานี', subdistrict: 'ตลาด', postalCode: '84000' }
    expect(normalize(input)).toEqual({ ...input, applied: {} })
  })

  it('keeps absent fields absent and does not invent any', () => {
    expect(normalize({ subdistrict: 'ตลาด' })).toEqual({ subdistrict: 'ตลาด', applied: {} })
    expect(normalize({})).toEqual({ applied: {} })
  })

  it('trims and collapses whitespace', () => {
    const r = normalize({ district: '  เมืองสุราษฎร์ธานี  ', subdistrict: 'Ko   Pha-ngan' })
    expect(r.district).toBe('เมืองสุราษฎร์ธานี')
    expect(r.subdistrict).toBe('Ko Pha-ngan')
    expect(r.applied).toEqual({ district: ['whitespace'], subdistrict: ['whitespace'] })
  })

  it('turns a blank field into an empty string instead of dropping it', () => {
    const r = normalize({ postalCode: '   ' })
    expect(r.postalCode).toBe('')
    expect(r.applied.postalCode).toEqual(['whitespace'])
  })

  it('removes zero-width characters and turns non-breaking spaces into spaces', () => {
    const r = normalize({ subdistrict: 'ตล​าด', district: 'Mueang Surat Thani' })
    expect(r.subdistrict).toBe('ตลาด')
    expect(r.district).toBe('Mueang Surat Thani')
    expect(r.applied.subdistrict).toEqual(['invisible-chars'])
    expect(r.applied.district).toEqual(['invisible-chars'])
  })

  it('converts Thai digits in the postal code', () => {
    const r = normalize({ postalCode: '๘๔๐๐๐' })
    expect(r.postalCode).toBe('84000')
    expect(r.applied.postalCode).toEqual(['thai-digits'])
  })

  // tac-night F13: '50200.0' (a spreadsheet number) used to become '502000' by deleting the dot.
  it('drops a zero decimal a spreadsheet adds before keeping the digits', () => {
    expect(normalize({ postalCode: '50200.0' })).toMatchObject({ postalCode: '50200', applied: { postalCode: ['postal-decimal-zero'] } })
    expect(normalize({ postalCode: '50200.00' }).postalCode).toBe('50200')
    expect(normalize({ postalCode: '๕๐๒๐๐.๐' }).postalCode).toBe('50200')
    expect(normalize({ postalCode: '50200.' }).postalCode).toBe('50200')
    expect(normalize({ postalCode: '50200.5' }).postalCode).toBe('50200.5') // not a zero decimal: kept for the format check
  })

  // tac-night-2 F18: deleting every non-digit turned '5020.0' (the number 5020) into a valid 50200.
  it.each([
    ['5020.0'], ['50.200'], ['502.00'], ['50200abc'], ['abc50200'], ['ปณ.50200'], ['TH-50200'],
    ['(50200)'], ['+50200'], ['50/200'], ['50_200'], ['50200.0.0'], ['1.0e4'],
  ])('keeps %j as written: no digit is picked out of it', (given) => {
    const r = normalize({ postalCode: given })
    expect(r.postalCode).toBe(given)
    expect(r.applied.postalCode ?? []).not.toContain('postal-digits-only')
  })

  it.each([
    ['50 200', '50200'], ['5 0 2 0 0', '50200'], ['50-200', '50200'], ['50,200', '50200'], ['๕๐ ๒๐๐', '50200'],
  ])('a separator that cannot change the number is removed: %j -> %j', (given, expected) => {
    expect(normalize({ postalCode: given }).postalCode).toBe(expected)
  })

  it('keeps only the digits of a postal code', () => {
    expect(normalize({ postalCode: '84 000' })).toMatchObject({ postalCode: '84000', applied: { postalCode: ['postal-digits-only'] } })
    expect(normalize({ postalCode: '10200.' }).postalCode).toBe('10200')
    expect(normalize({ postalCode: ' ๑๐๒๐๐ ' })).toMatchObject({
      postalCode: '10200',
      applied: { postalCode: ['thai-digits', 'whitespace'] },
    })
  })

  it('reads a numeric postal code from plain-JS callers as text', () => {
    expect(normalize({ postalCode: 84000 as unknown as string }).postalCode).toBe('84000')
  })

  describe('Thai level prefixes', () => {
    it.each([
      ['subdistrict', 'ต.ตลาด', 'ตลาด'],
      ['subdistrict', 'ต. ตลาด', 'ตลาด'],
      ['subdistrict', 'ตำบลตลาด', 'ตลาด'],
      ['subdistrict', 'ตำบล ตลาด', 'ตลาด'],
      ['subdistrict', 'แขวงพระบรมมหาราชวัง', 'พระบรมมหาราชวัง'],
      ['district', 'อ.เมืองสุราษฎร์ธานี', 'เมืองสุราษฎร์ธานี'],
      ['district', 'อำเภอ เมืองสุราษฎร์ธานี', 'เมืองสุราษฎร์ธานี'],
      ['district', 'เขต พระนคร', 'พระนคร'], // not the dataset's exact spelling, so the prefix goes
      ['province', 'จ.สุราษฎร์ธานี', 'สุราษฎร์ธานี'],
      ['province', 'จังหวัดสุราษฎร์ธานี', 'สุราษฎร์ธานี'],
    ] as const)('%s %s -> %s', (field, given, expected) => {
      const r = normalize({ [field]: given })
      expect(r[field]).toBe(expected)
      expect(r.applied[field]).toEqual(['strip-prefix'])
    })

    // tac-night A3 (ruling 8e5bf3f9): the dataset stores Bangkok districts WITH 'เขต'. That exact spelling
    // used to be "cleaned" to 'พระนคร' with a FORMAT_NORMALIZED finding, so a row copied from the
    // dataset (or from `thai-address-check export`) did not come back clean. Now it is kept as written.
    it("keeps a value that is exactly the dataset's own name: 'เขตพระนคร' stays, no rule fires", () => {
      const r = normalize({ district: 'เขตพระนคร' })
      expect(r.district).toBe('เขตพระนคร')
      expect(r.applied).toEqual({})
      expect(normalize({ district: 'พระนคร' }).district).toBe('พระนคร')
    })

    it('strips "อ.เมือง" to "เมือง" and leaves the choice of district to validation', () => {
      const r = normalize({ district: 'อ.เมือง', province: 'จ.สุราษฎร์ธานี' })
      expect(r.district).toBe('เมือง')
      expect(r.province).toBe('สุราษฎร์ธานี')
    })

    it('only strips the prefixes of the field it is in', () => {
      // 'จ.' is a province prefix; in the subdistrict field 'จ.ป.ร.' is a real name and stays.
      expect(normalize({ subdistrict: 'จ.ป.ร.' })).toEqual({ subdistrict: 'จ.ป.ร.', applied: {} })
      // A subdistrict prefix in front of that name is removed, the name itself is kept.
      expect(normalize({ subdistrict: 'ต.จ.ป.ร.' }).subdistrict).toBe('จ.ป.ร.')
      // 'ต.' in the district field is not a district prefix.
      expect(normalize({ district: 'ต.ตลาด' }).district).toBe('ต.ตลาด')
    })

    it('does not treat a bare letter as a prefix', () => {
      // 'ตลาด' starts with 'ต' but has no dot: nothing to strip.
      expect(normalize({ subdistrict: 'ตลาด' }).applied).toEqual({})
    })

    it('keeps a prefix-only value as written', () => {
      expect(normalize({ subdistrict: 'ตำบล' })).toEqual({ subdistrict: 'ตำบล', applied: {} })
    })
  })

  describe('English level words', () => {
    it.each([
      ['subdistrict', 'Tambon Talat', 'Talat'],
      ['subdistrict', 'tambon Talat', 'Talat'],
      ['subdistrict', 'Khwaeng Phra Borom Maha Ratchawang', 'Phra Borom Maha Ratchawang'],
      ['subdistrict', 'Talat Sub-district', 'Talat'],
      ['subdistrict', 'Talat Subdistrict', 'Talat'],
      ['district', 'Amphoe Mueang Surat Thani', 'Mueang Surat Thani'],
      ['district', 'Khet Phra Nakhon', 'Phra Nakhon'],
      ['district', 'Mueang Surat Thani District', 'Mueang Surat Thani'],
      ['province', 'Changwat Surat Thani', 'Surat Thani'],
      ['province', 'Surat Thani Province', 'Surat Thani'],
    ] as const)('%s "%s" -> "%s"', (field, given, expected) => {
      const r = normalize({ [field]: given })
      expect(r[field]).toBe(expected)
      expect(r.applied[field]).toEqual(['strip-prefix'])
    })

    it('does not remove a level word that is part of the field of another level', () => {
      expect(normalize({ district: 'Tambon Talat' }).district).toBe('Tambon Talat')
    })
  })

  describe('Bangkok aliases', () => {
    it.each(['กทม', 'กทม.', 'กรุงเทพ', 'กรุงเทพฯ', 'กรุงเทพ ฯ'])('"%s" -> the official Thai name', (given) => {
      const r = normalize({ province: given })
      expect(r.province).toBe('กรุงเทพมหานคร')
      expect(r.applied.province).toContain('bangkok-alias')
    })

    it.each(['BKK', 'bkk', 'bangkok', 'BANGKOK'])('"%s" -> the official English name', (given) => {
      const r = normalize({ province: given })
      expect(r.province).toBe('Bangkok')
      expect(r.applied.province).toEqual(['bangkok-alias'])
    })

    it('leaves the official names alone', () => {
      expect(normalize({ province: 'กรุงเทพมหานคร' }).applied).toEqual({})
      expect(normalize({ province: 'Bangkok' }).applied).toEqual({})
    })

    it('handles a prefix in front of an alias', () => {
      const r = normalize({ province: 'จ.กทม' })
      expect(r.province).toBe('กรุงเทพมหานคร')
      expect(r.applied.province).toEqual(['strip-prefix', 'bangkok-alias'])
    })

    it('applies aliases to the province field only', () => {
      expect(normalize({ district: 'กทม' }).district).toBe('กทม')
    })
  })

  it('records every rule that fired, in order, per field', () => {
    const r = normalize({
      province: ' จ.​กรุงเทพฯ ',
      district: 'เขต  พระนคร',
      subdistrict: 'แขวงพระบรมมหาราชวัง',
      postalCode: '๑๐๒๐๐',
    })
    expect(r).toEqual({
      province: 'กรุงเทพมหานคร',
      district: 'พระนคร',
      subdistrict: 'พระบรมมหาราชวัง',
      postalCode: '10200',
      applied: {
        province: ['invisible-chars', 'whitespace', 'strip-prefix', 'bangkok-alias'],
        district: ['whitespace', 'strip-prefix'],
        subdistrict: ['strip-prefix'],
        postalCode: ['thai-digits'],
      },
    })
  })

  it('never changes letters inside a name (no spelling correction here)', () => {
    // 'พระบรมมหาราชวง' is a misspelling of a real name; fixing it is fuzzy+suggest's job, not ours.
    expect(normalize({ subdistrict: 'พระบรมมหาราชวง' })).toEqual({ subdistrict: 'พระบรมมหาราชวง', applied: {} })
  })

  it('does not modify its input object', () => {
    const input = { subdistrict: 'ต.ตลาด' }
    normalize(input)
    expect(input).toEqual({ subdistrict: 'ต.ตลาด' })
  })

  it('folds sara am written as nikhahit + sara aa (U+0E4D U+0E32)', () => {
    const r = normalize({ province: 'ก\u0E4D\u0E32แพงเพชร' })
    expect(r.province).toBe('กำแพงเพชร')
    expect(r.applied.province).toEqual(['thai-sara-am'])
  })

  it('folds the PDF order nikhahit + tone + sara aa into tone + sara am', () => {
    const r = normalize({ subdistrict: 'ปากน\u0E4D\u0E49\u0E32' })
    expect(r.subdistrict).toBe('ปากน้ำ')
    expect(r.applied.subdistrict).toEqual(['thai-sara-am'])
  })

  it('strips a ตำบล prefix written with the decomposed sara am', () => {
    const r = normalize({ subdistrict: 'ต\u0E4D\u0E32บลในเมือง' })
    expect(r.subdistrict).toBe('ในเมือง')
    expect(r.applied.subdistrict).toEqual(['thai-sara-am', 'strip-prefix'])
  })

  it('reads full-width postal digits instead of deleting them', () => {
    const r = normalize({ postalCode: '\uFF18\uFF14\uFF10\uFF10\uFF10' })
    expect(r.postalCode).toBe('84000')
    expect(r.applied.postalCode).toEqual(['fullwidth-digits'])
  })

  it.each(['Krung Thep Maha Nakhon', 'krung thep', 'BANGKOK METROPOLIS', 'KrungThep'])(
    'reads the romanised Bangkok alias %s as Bangkok (A10)',
    (alias) => {
      const r = normalize({ province: alias })
      expect(r.province).toBe('Bangkok')
      expect(r.applied.province).toContain('bangkok-alias')
    },
  )
})
