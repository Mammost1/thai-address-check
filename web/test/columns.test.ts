import { describe, expect, it } from 'vitest'
import { detectColumns, isUsable } from '../src/lib/columns'

describe('detectColumns', () => {
  it('finds Thai headers', () => {
    expect(detectColumns(['ชื่อ', 'จังหวัด', 'อำเภอ', 'ตำบล', 'รหัสไปรษณีย์'])).toEqual({
      province: 1,
      district: 2,
      subdistrict: 3,
      postalCode: 4,
    })
  })

  it('finds English and combined headers, never taking sub_district for the district', () => {
    expect(detectColumns(['Sub_District', 'District', 'Province', 'Zip'])).toEqual({
      subdistrict: 0,
      district: 1,
      province: 2,
      postalCode: 3,
    })
    expect(detectColumns(['ตำบล/แขวง', 'อำเภอ/เขต', 'Postal Code'])).toEqual({
      subdistrict: 0,
      district: 1,
      postalCode: 2,
    })
  })

  it('matches prefixed headers by their ending and uses each column once', () => {
    expect(detectColumns(['customer_province', 'shipping_postcode'])).toEqual({ province: 0, postalCode: 1 })
  })

  it('leaves unknown columns unmapped', () => {
    const map = detectColumns(['name', 'phone'])
    expect(map).toEqual({})
    expect(isUsable(map)).toBe(false)
    expect(isUsable({ postalCode: 3 })).toBe(true)
  })
})
