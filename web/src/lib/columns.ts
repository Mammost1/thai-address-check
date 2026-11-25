import type { Field } from 'thai-address-check'

export const FIELDS: readonly Field[] = ['province', 'district', 'subdistrict', 'postalCode']

/** Which column (index) holds each field; undefined = not in the file. */
export type ColumnMap = Partial<Record<Field, number>>

/**
 * Header words that name each field, compared after lower-casing and removing spaces, dots,
 * hyphens and underscores. Order matters: 'subdistrict' words are tried before 'district' so a
 * 'sub_district' column is never taken for the district.
 */
const HEADER_WORDS: readonly [Field, readonly string[]][] = [
  ['postalCode', ['postalcode', 'postcode', 'zipcode', 'zip', 'postal', 'รหัสไปรษณีย์', 'ไปรษณีย์', 'รหัสไปรษณี']],
  ['subdistrict', ['subdistrict', 'tambon', 'khwaeng', 'ตำบล', 'แขวง', 'ตำบลแขวง', 'ตำบล/แขวง', 'ต']],
  ['district', ['district', 'amphoe', 'amphur', 'khet', 'อำเภอ', 'เขต', 'อำเภอเขต', 'อำเภอ/เขต', 'อ']],
  ['province', ['province', 'changwat', 'state', 'city', 'จังหวัด', 'จ']],
]

function headerKey(header: string): string {
  return header.normalize('NFC').toLowerCase().replace(/[\s._\-()]/g, '')
}

/**
 * Guesses the column of each field from the header row. A header matches when its key equals one
 * of the field's words or ends with one (e.g. 'customer_province'). Each column is used once.
 */
export function detectColumns(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = {}
  const used = new Set<number>()
  const keys = headers.map(headerKey)
  for (const exact of [true, false]) {
    for (const [field, words] of HEADER_WORDS) {
      if (map[field] !== undefined) continue
      const index = keys.findIndex(
        (k, i) => !used.has(i) && words.some((w) => (exact ? k === w : w.length > 2 && k.endsWith(w))),
      )
      if (index >= 0) {
        map[field] = index
        used.add(index)
      }
    }
  }
  return map
}

/** True when at least the subdistrict or the postal code column is known (nothing to check otherwise). */
export function isUsable(map: ColumnMap): boolean {
  return map.subdistrict !== undefined || map.postalCode !== undefined
}
