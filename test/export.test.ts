import { describe, expect, it } from 'vitest'
import { check, dataVersion, listAddresses } from '../src/index'
import type { AddressRow } from '../src/index'

const FIELDS: (keyof AddressRow)[] = [
  'provinceCode',
  'provinceNameTh',
  'provinceNameEn',
  'districtCode',
  'districtNameTh',
  'districtNameEn',
  'subdistrictCode',
  'subdistrictNameTh',
  'subdistrictNameEn',
  'postalCode',
]

describe('listAddresses() (tac-night A1)', () => {
  const rows = listAddresses()

  it('every row has exactly the ten string fields, in order', () => {
    for (const r of rows) {
      expect(Object.keys(r)).toEqual(FIELDS)
      for (const f of FIELDS) expect(typeof r[f]).toBe('string')
    }
  })

  it('is sorted by subdistrictCode then postalCode with no duplicate pair', () => {
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1] as AddressRow
      const b = rows[i] as AddressRow
      const order = a.subdistrictCode === b.subdistrictCode ? a.postalCode < b.postalCode : a.subdistrictCode < b.subdistrictCode
      expect(order, `row ${i}: ${a.subdistrictCode}/${a.postalCode} then ${b.subdistrictCode}/${b.postalCode}`).toBe(true)
    }
  })

  it('codes nest: district starts with province, subdistrict with district; postal codes are 5 digits', () => {
    for (const r of rows) {
      expect(r.provinceCode).toMatch(/^\d{2}$/)
      expect(r.districtCode.startsWith(r.provinceCode)).toBe(true)
      expect(r.subdistrictCode.startsWith(r.districtCode)).toBe(true)
      expect(r.postalCode).toMatch(/^\d{5}$/)
    }
  })

  // Tied to the pinned data: when @geothai/core is bumped this test fails on purpose, so the counts here
  // and in the README are re-checked instead of silently going stale.
  it('has the counts of data 2026.10.23 (@geothai/core 5.0.0)', () => {
    expect(dataVersion).toBe('2026.10.23')
    expect(rows.length).toBe(7600)
    expect(new Set(rows.map((r) => r.subdistrictCode)).size).toBe(7436)
    expect(new Set(rows.map((r) => r.districtCode)).size).toBe(928)
    expect(new Set(rows.map((r) => r.provinceCode)).size).toBe(77)
    const perSub = new Map<string, number>()
    for (const r of rows) perSub.set(r.subdistrictCode, (perSub.get(r.subdistrictCode) ?? 0) + 1)
    expect([...perSub.values()].filter((n) => n > 1).length).toBe(160)
  })

  it("keeps the dataset's own names: Bangkok districts carry 'เขต'", () => {
    const r = rows.find((x) => x.subdistrictCode === '100101') as AddressRow
    expect(r).toEqual({
      provinceCode: '10',
      provinceNameTh: 'กรุงเทพมหานคร',
      provinceNameEn: 'Bangkok',
      districtCode: '1001',
      districtNameTh: 'เขตพระนคร',
      districtNameEn: 'Phra Nakhon',
      subdistrictCode: '100101',
      subdistrictNameTh: 'พระบรมมหาราชวัง',
      subdistrictNameEn: 'Phra Borom Maha Ratchawang',
      postalCode: '10200',
    })
  })

  it('returns fresh objects: a caller changing one does not change the next call', () => {
    const first = listAddresses()
    ;(first[0] as AddressRow).postalCode = 'XXXXX'
    first.length = 0
    expect(listAddresses().length).toBe(rows.length)
    expect((listAddresses()[0] as AddressRow).postalCode).toMatch(/^\d{5}$/)
  })
})

// Every exported row fed back into check() must come back valid with ZERO findings, unchanged, and
// resolved to its own codes. Before ruling 8e5bf3f9 the 191 Bangkok rows came back with a
// FORMAT_NORMALIZED finding and output.district rewritten from 'เขตพระนคร' to 'พระนคร'.
describe('round trip (tac-night A3): every exported row checks as valid', () => {
  it.each([
    ['Thai', (r: AddressRow) => ({ province: r.provinceNameTh, district: r.districtNameTh, subdistrict: r.subdistrictNameTh, postalCode: r.postalCode })],
    ['English', (r: AddressRow) => ({ province: r.provinceNameEn, district: r.districtNameEn, subdistrict: r.subdistrictNameEn, postalCode: r.postalCode })],
  ] as const)('%s names + postal code: 7,600 of 7,600 valid, no findings, output = input', (_lang, toInput) => {
    const rows = listAddresses()
    const bad: string[] = []
    for (const r of rows) {
      const input = toInput(r)
      const res = check(input)
      if (
        res.status !== 'valid' ||
        res.findings.length > 0 ||
        res.resolved?.subdistrictCode !== r.subdistrictCode ||
        JSON.stringify(res.output) !== JSON.stringify(input)
      ) {
        bad.push(`${r.subdistrictCode}/${r.postalCode}: ${res.status} ${res.findings.map((f) => f.code).join(',')} -> ${JSON.stringify(res.output)}`)
      }
    }
    expect(bad).toEqual([])
    expect(rows.length).toBe(7600)
  })

  it("both spellings of every Bangkok district are valid and neither is rewritten (191 rows x 2)", () => {
    const bangkok = listAddresses().filter((r) => r.districtNameTh.startsWith('เขต'))
    expect(bangkok.length).toBe(191)
    const bad: string[] = []
    for (const r of bangkok) {
      for (const district of [r.districtNameTh, r.districtNameTh.slice('เขต'.length)]) {
        const res = check({ province: r.provinceNameTh, district, subdistrict: r.subdistrictNameTh, postalCode: r.postalCode })
        if (res.status !== 'valid' || res.findings.length > 0 || res.output.district !== district || res.resolved?.subdistrictCode !== r.subdistrictCode) {
          bad.push(`${r.subdistrictCode} ${district}: ${res.status} ${res.findings.map((f) => f.code).join(',')}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})
