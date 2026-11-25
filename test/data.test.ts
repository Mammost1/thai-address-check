import { describe, expect, it } from 'vitest'
import {
  abolishedByName,
  allDistricts,
  allProvinces,
  allSubdistricts,
  dataVersion,
  districtByCode,
  districtsByName,
  districtsOf,
  englishKey,
  isKnownName,
  isPostalCodeInUse,
  provinceByCode,
  provincesByName,
  resolvedByCode,
  subdistrictsByName,
  subdistrictsByPostalCode,
  subdistrictsOf,
  thaiKey,
} from '../src/data'

// Counts and codes below were checked against @geothai/core 5.0.0 (data 2026.10.23); see docs/recon.md.

describe('data indexes', () => {
  it('exposes the dataset version', () => {
    expect(dataVersion).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}$/)
  })

  it('loads every current area', () => {
    expect(allProvinces()).toHaveLength(77)
    expect(allDistricts()).toHaveLength(928)
    expect(allSubdistricts()).toHaveLength(7436)
  })

  it('looks areas up by code', () => {
    expect(provinceByCode('84')?.name_th).toBe('สุราษฎร์ธานี')
    expect(districtByCode('1001')?.name_th).toBe('เขตพระนคร')
    expect(provinceByCode('99')).toBeUndefined()
  })
})

describe('name keys', () => {
  it('folds spacing and invisible characters in Thai names only', () => {
    expect(thaiKey(' สุราษฎร์ ธานี​')).toBe('สุราษฎร์ธานี')
  })

  it('folds sara am written as nikhahit + sara aa', () => {
    expect(thaiKey('ก\u0E4D\u0E32แพงเพชร')).toBe(thaiKey('กำแพงเพชร'))
    expect(provincesByName('ก\u0E4D\u0E32แพงเพชร')).toHaveLength(1)
    expect(thaiKey('ปากน\u0E4D\u0E49\u0E32')).toBe(thaiKey('ปากน้ำ'))
  })

  it('folds case and punctuation in English names', () => {
    expect(englishKey('Ko Pha-ngan')).toBe(englishKey('KO PHA NGAN'))
    expect(englishKey('ko phangan')).toBe(englishKey('Ko Pha-ngan'))
  })
})

describe('name lookups', () => {
  it('finds a province by Thai or English name', () => {
    expect(provincesByName('สุราษฎร์ธานี').map((p) => p.code)).toEqual(['84'])
    expect(provincesByName('surat thani').map((p) => p.code)).toEqual(['84'])
  })

  it('returns every district sharing a name, and narrows by province', () => {
    expect(districtsByName('จอมทอง').map((d) => d.code)).toEqual(['1035', '5002'])
    expect(districtsByName('จอมทอง', '50').map((d) => d.code)).toEqual(['5002'])
  })

  it('matches Bangkok districts with or without the เขต prefix', () => {
    expect(districtsByName('พระนคร').map((d) => d.code)).toEqual(['1001'])
    expect(districtsByName('เขตพระนคร').map((d) => d.code)).toEqual(['1001'])
  })

  it('returns every subdistrict sharing a common name', () => {
    expect(subdistrictsByName('หนองบัว')).toHaveLength(28)
  })

  it('is exact: no typo tolerance and blank is unknown', () => {
    expect(isKnownName('province', 'สุราษฎร์ธานี')).toBe(true)
    expect(isKnownName('province', 'สุราษฏร์ธานี')).toBe(false)
    expect(isKnownName('district', '   ')).toBe(false)
  })
})

describe('postal codes', () => {
  it('lists the subdistricts using a postal code', () => {
    expect(subdistrictsByPostalCode('84280').map((s) => s.code)).toEqual(['840501', '840502'])
    expect(isPostalCodeInUse('84280')).toBe(true)
    expect(isPostalCodeInUse('00000')).toBe(false)
  })

  it('keeps every postal code of a subdistrict that has several', () => {
    expect(resolvedByCode('100203')?.postalCodes).toEqual(['10300', '10303'])
  })
})

describe('hierarchy', () => {
  it('lists children of a province and of a district', () => {
    expect(districtsOf('84').every((d) => d.province_code === '84')).toBe(true)
    expect(subdistrictsOf('8405').map((s) => s.code)).toContain('840501')
    expect(districtsOf('99')).toEqual([])
  })

  it('resolves a subdistrict code into the package shape', () => {
    const r = resolvedByCode('840501')
    expect(r).toMatchObject({ provinceCode: '84', districtCode: '8405', subdistrictCode: '840501' })
    expect(r?.postalCodes).toContain('84280')
    expect(resolvedByCode('999999')).toBeUndefined()
  })
})

describe('abolished areas', () => {
  it('finds abolished areas by exact name and level', () => {
    expect(abolishedByName('บางนา').map((a) => a.code)).toEqual(['100904', '104701'])
    expect(abolishedByName('บางนา', 'subdistrict').map((a) => a.code)).toEqual(['100904', '104701'])
    expect(abolishedByName('บางนา', 'district')).toEqual([])
    // Both abolished บางนา are แขวง (subdistricts), so the เขต-prefixed form matches nothing.
    expect(abolishedByName('เขตบางนา')).toEqual([])
    expect(abolishedByName('ไม่มีชื่อนี้')).toEqual([])
  })
})
