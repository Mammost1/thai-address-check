/**
 * Dataset-wide guard for the class of bug "a real, correctly written row gets a false
 * POSTAL_CODE_MISMATCH" (found by hand on บางนา / 10260, tac-v011). It walks the whole of
 * @geothai/core 5.0.0: every abolished subdistrict with successors, and every current subdistrict.
 */
import { describe, expect, it } from 'vitest'
import { check } from '../src/check'
import {
  abolishedAreas,
  allSubdistricts,
  districtByCode,
  provinceByCode,
  subdistrictByCode,
  subdistrictsByName,
} from '../src/data'
import type { AddressInput } from '../src/types'

const mismatch = (input: AddressInput): string | undefined => {
  const r = check(input)
  const f = r.findings.find((x) => x.code === 'POSTAL_CODE_MISMATCH')
  return f ? `${JSON.stringify(input)} -> ${r.status} ${f.message.en}` : undefined
}

describe('abolished subdistricts: the row people still write has no false postal mismatch', () => {
  const rows: { why: string; input: AddressInput }[] = []
  let stillCurrent = 0
  let noParent = 0
  for (const a of abolishedAreas()) {
    if (a.level !== 'subdistrict' || a.successors.length === 0) continue
    const province = provinceByCode(a.code.slice(0, 2))
    for (const code of a.successors) {
      const successor = subdistrictByCode(code)
      if (!successor || !province) continue
      // The district the old name was written under: its parent if that district still exists,
      // otherwise the successor's own district.
      const parent = a.parent_code === null ? undefined : districtByCode(a.parent_code)
      const district = parent ?? districtByCode(successor.district_code)
      if (!district) {
        noParent++
        continue
      }
      // If the old name is also a CURRENT subdistrict of that district, the row is an ordinary one
      // and a postal code of another subdistrict is a genuine mismatch; not this guard's business.
      if (subdistrictsByName(a.name_th, { districtCode: district.code }).length > 0) {
        stillCurrent++
        continue
      }
      for (const postalCode of successor.postal_codes) {
        rows.push({ why: `${a.code} ${a.name_th} -> ${code}`, input: { province: province.name_th, district: district.name_th, subdistrict: a.name_th, postalCode } })
      }
    }
  }

  it('covers a large part of the data (the guard is not vacuous)', () => {
    expect(rows.length).toBeGreaterThan(1100) // 1,137 on data 2026.10.23
    expect(stillCurrent).toBeGreaterThan(0) // names that are still current in that district are excluded, and counted
    expect(rows.length + stillCurrent + noParent).toBeGreaterThan(1190) // every (abolished name, successor) pair is accounted for
  })

  it('no row gets a POSTAL_CODE_MISMATCH when its postal code is a successor\'s', () => {
    const bad = rows.map((r) => mismatch(r.input)).filter((x): x is string => x !== undefined)
    expect(bad.slice(0, 5)).toEqual([])
    expect(bad).toHaveLength(0)
  })
})

describe('current subdistricts: their own postal codes never mismatch (regression net)', () => {
  it('every current subdistrict with each of its own postal codes: no mismatch, no invalid code', () => {
    let rows = 0
    const bad: string[] = []
    for (const s of allSubdistricts()) {
      const district = districtByCode(s.district_code)
      const province = provinceByCode(s.province_code)
      if (!district || !province) continue
      for (const postalCode of s.postal_codes) {
        rows++
        const r = check({ province: province.name_th, district: district.name_th, subdistrict: s.name_th, postalCode })
        const f = r.findings.find((x) => x.code === 'POSTAL_CODE_MISMATCH' || x.code === 'POSTAL_CODE_INVALID')
        if (f) bad.push(`${s.code} ${s.name_th} ${postalCode}: ${f.code}`)
        else if (r.status !== 'valid') bad.push(`${s.code} ${s.name_th} ${postalCode}: status ${r.status}`)
      }
    }
    expect(rows).toBeGreaterThan(7500)
    expect(bad.slice(0, 5)).toEqual([])
    expect(bad).toHaveLength(0)
  })
})
