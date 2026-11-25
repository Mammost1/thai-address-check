import { describe, expect, it } from 'vitest'
import { applyMap, ColumnError, detectColumns, headerKey, looksLikeHeader, parseMapSpec } from '../../src/file/columns'

describe('headerKey', () => {
  it('folds case, spaces, punctuation and a byte-order mark', () => {
    expect(headerKey('﻿Postal_Code')).toBe('postalcode')
    expect(headerKey(' Zip Code ')).toBe('zipcode')
    expect(headerKey('อำเภอ/เขต')).toBe('อำเภอเขต')
  })
})

describe('detectColumns', () => {
  it('finds the Thai name columns of an export header (tac-night), and plain *_name headers', () => {
    const exported = ['province_code', 'province_name_th', 'province_name_en', 'district_code', 'district_name_th', 'district_name_en', 'subdistrict_code', 'subdistrict_name_th', 'subdistrict_name_en', 'postal_code']
    expect(detectColumns(exported)).toEqual({ province: 1, district: 4, subdistrict: 7, postalCode: 9 })
    expect(detectColumns(['id', 'province_name', 'district_name', 'subdistrict_name', 'zipcode'])).toEqual({ province: 1, district: 2, subdistrict: 3, postalCode: 4 })
  })

  it('finds Thai headers', () => {
    expect(detectColumns(['ชื่อ', 'จังหวัด', 'อำเภอ', 'ตำบล', 'รหัสไปรษณีย์'])).toEqual({
      province: 1,
      district: 2,
      subdistrict: 3,
      postalCode: 4,
    })
  })

  it('finds English headers in any spelling', () => {
    expect(detectColumns(['Name', 'Changwat', 'Amphoe', 'Sub-district', 'Zip Code'])).toEqual({
      province: 1,
      district: 2,
      subdistrict: 3,
      postalCode: 4,
    })
    expect(detectColumns(['province', 'DISTRICT', 'Tambon', 'postal_code'])).toEqual({
      province: 0,
      district: 1,
      subdistrict: 2,
      postalCode: 3,
    })
  })

  it('accepts the combined Thai headers อำเภอ/เขต and ตำบล/แขวง', () => {
    expect(detectColumns(['อำเภอ/เขต', 'ตำบล/แขวง'])).toEqual({ district: 0, subdistrict: 1 })
  })

  it('finds a header that only contains the word, such as "ตำบลที่จัดส่ง"', () => {
    expect(detectColumns(['จังหวัดที่จัดส่ง', 'ตำบลที่จัดส่ง'])).toEqual({ province: 0, subdistrict: 1 })
  })

  it('does not take a code column for the name column', () => {
    expect(detectColumns(['รหัสตำบล', 'ตำบล'])).toEqual({ subdistrict: 1 })
    expect(detectColumns(['รหัสตำบล', 'province_code'])).toEqual({})
  })

  it('leaves out fields with no header', () => {
    expect(detectColumns(['id', 'ตำบล'])).toEqual({ subdistrict: 1 })
    expect(detectColumns(['id', 'note'])).toEqual({})
  })

  it('refuses to guess between two columns for one field, and says how to choose', () => {
    expect(() => detectColumns(['ตำบล', 'ตำบล'])).toThrow(ColumnError)
    expect(() => detectColumns(['จังหวัด', 'Province'])).toThrow(/--map province=/)
  })
})

describe('looksLikeHeader', () => {
  it('is true when any cell names a field, false for data', () => {
    expect(looksLikeHeader(['ชื่อ', 'ตำบล'])).toBe(true)
    expect(looksLikeHeader(['คุณสมชาย', 'เกาะพะงัน', '84280'])).toBe(false)
  })
})

describe('parseMapSpec', () => {
  it('reads comma separated and repeated entries, with field aliases', () => {
    expect(parseMapSpec(['province=จังหวัด,subdistrict=3', 'zip=รหัส'])).toEqual([
      { field: 'province', column: 'จังหวัด' },
      { field: 'subdistrict', column: '3' },
      { field: 'postalCode', column: 'รหัส' },
    ])
    expect(parseMapSpec(['postalCode=5'])).toEqual([{ field: 'postalCode', column: '5' }])
  })

  it('rejects an unknown field, a missing = and an empty column', () => {
    expect(() => parseMapSpec(['street=1'])).toThrow(/unknown field "street"/)
    expect(() => parseMapSpec(['province'])).toThrow(/field=column/)
    expect(() => parseMapSpec(['province='])).toThrow(/no column/)
  })
})

describe('applyMap', () => {
  const header = ['id', 'prov', 'tam', 'zip5']

  it('resolves a header text (spelling-insensitive) or a 1-based number', () => {
    expect(applyMap(parseMapSpec(['province=PROV,subdistrict=3,postalCode=ZIP5']), header, 4)).toEqual({
      province: 1,
      subdistrict: 2,
      postalCode: 3,
    })
  })

  it('rejects a header that is not there, a repeated one, and a number outside the file', () => {
    expect(() => applyMap(parseMapSpec(['province=nope']), header, 4)).toThrow(/no column has that header/)
    expect(() => applyMap(parseMapSpec(['province=a']), ['a', 'A'], 2)).toThrow(/several columns/)
    expect(() => applyMap(parseMapSpec(['province=9']), header, 4)).toThrow(/has 4 columns/)
    expect(() => applyMap(parseMapSpec(['province=0']), header, 4)).toThrow(/has 4 columns/)
  })

  it('without a header only numbers work', () => {
    expect(applyMap(parseMapSpec(['subdistrict=2']), undefined, 3)).toEqual({ subdistrict: 1 })
    expect(() => applyMap(parseMapSpec(['subdistrict=ตำบล']), undefined, 3)).toThrow(/no header row/)
  })
})
