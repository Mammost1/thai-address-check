/**
 * The reference data as plain rows (tac-night A1), for seeding a table of your own. Reads the
 * dataset through data.ts like every other module; nothing here touches @geothai/core directly.
 */
import { allSubdistricts, districtByCode, provinceByCode } from './data'
import type { AddressRow } from './types'

export { dataVersion } from './data'

/**
 * Every current address of the dataset: one row per (subdistrict, postal code), sorted by
 * subdistrict code then postal code. A subdistrict with several postal codes has several rows, so
 * `subdistrictCode` + `postalCode` is the key. Each call returns new objects.
 */
export function listAddresses(): AddressRow[] {
  const rows: AddressRow[] = []
  for (const s of allSubdistricts()) {
    const d = districtByCode(s.district_code)
    const p = provinceByCode(s.province_code)
    if (!d || !p) throw new Error(`thai-address-check: dataset has no parent for subdistrict ${s.code}`)
    for (const postalCode of [...new Set(s.postal_codes)].sort()) {
      rows.push({
        provinceCode: p.code,
        provinceNameTh: p.name_th,
        provinceNameEn: p.name_en,
        districtCode: d.code,
        districtNameTh: d.name_th,
        districtNameEn: d.name_en,
        subdistrictCode: s.code,
        subdistrictNameTh: s.name_th,
        subdistrictNameEn: s.name_en,
        postalCode,
      })
    }
  }
  return rows.sort((a, b) =>
    a.subdistrictCode === b.subdistrictCode
      ? a.postalCode < b.postalCode ? -1 : a.postalCode > b.postalCode ? 1 : 0
      : a.subdistrictCode < b.subdistrictCode ? -1 : 1,
  )
}
