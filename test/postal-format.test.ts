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
    const r = check({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subdistrict: 'สุเทพ', postalCode: '50200.5' })
    const f = r.findings.find((x) => x.code === 'POSTAL_CODE_INVALID')!
    expect(f.message.en).toBe('Postal code "50200.5" (read as "502005") is invalid: it must be exactly 5 digits.')
    expect(f.message.th).toContain('"50200.5" (อ่านได้เป็น "502005")')
    expect(f.detail).toMatchObject({ given: '502005', written: '50200.5' })
    const plain = check({ postalCode: '1234' }).findings.find((x) => x.code === 'POSTAL_CODE_INVALID')!
    expect(plain.message.en).toBe('Postal code "1234" is invalid: it must be exactly 5 digits.')
    expect(plain.detail).not.toHaveProperty('written')
  })
})
