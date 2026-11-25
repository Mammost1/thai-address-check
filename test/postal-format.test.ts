import { describe, expect, it } from 'vitest'
import { check } from '../src/check'

describe('postal code written by a spreadsheet (tac-night F13)', () => {
  it("'50200.0' is read as 50200: the address is valid", () => {
    const r = check({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subdistrict: 'สุเทพ', postalCode: '50200.0' })
    expect(r.status).toBe('valid')
    expect(r.output.postalCode).toBe('50200')
    expect(r.findings.map((f) => f.code)).toEqual(['FORMAT_NORMALIZED'])
  })

  it('an invalid code quotes what the caller wrote, not only the cleaned digits', () => {
    // A cleanup that changes the text (Thai digits, spaces) is quoted with what it was read as.
    const r = check({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subdistrict: 'สุเทพ', postalCode: '๕๐ ๒๐' })
    const f = r.findings.find((x) => x.code === 'POSTAL_CODE_INVALID')!
    expect(f.message.en).toBe('Postal code "๕๐ ๒๐" (read as "5020") is invalid: it must be exactly 5 digits.')
    expect(f.message.th).toContain('"๕๐ ๒๐" (อ่านได้เป็น "5020")')
    expect(f.detail).toMatchObject({ given: '5020', written: '๕๐ ๒๐' })
    const plain = check({ postalCode: '1234' }).findings.find((x) => x.code === 'POSTAL_CODE_INVALID')!
    expect(plain.message.en).toBe('Postal code "1234" is invalid: it must be exactly 5 digits.')
    expect(plain.detail).not.toHaveProperty('written')
  })
})

// tac-night-2 F18 (S2): every one of these was 'valid' with postal code 50200 in 0.2.0.
describe('a postal code is never made valid by dropping characters (tac-night-2 F18)', () => {
  const base = { province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subdistrict: 'สุเทพ' }
  it.each([
    ['5020.0'], ['50.200'], ['502.00'], ['50200abc'], ['abc50200'], ['ปณ.50200'], ['TH-50200'], ['(50200)'], ['+50200'], ['50/200'], ['50_200'],
  ])('%j is invalid, quoted as written', (postalCode) => {
    const r = check({ ...base, postalCode })
    expect(r.status).toBe('invalid')
    const f = r.findings.find((x) => x.code === 'POSTAL_CODE_INVALID')!
    expect(f.message.en).toBe(`Postal code "${postalCode}" is invalid: it must be exactly 5 digits.`)
    expect(r.output.postalCode).toBe(postalCode)
  })

  it.each([['50200'], ['50 200'], ['50-200'], ['50,200'], ['50200.0'], ['50200.'], ['๕๐๒๐๐']])('%j is still read as 50200', (postalCode) => {
    expect(check({ ...base, postalCode }).status).toBe('valid')
  })
})
