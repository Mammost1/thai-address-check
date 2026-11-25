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

/**
 * The district a person wrote next to an abolished subdistrict: its parent if that district still
 * exists, otherwise the abolished district's own name (หนองเข็ง was in an old อำเภอ of หนองคาย before
 * บึงกาฬ became a province), and only as a last resort the successor's district.
 */
function oldDistrictName(parentCode: string | null, successorDistrictCode: string): string | undefined {
  const current = parentCode === null ? undefined : districtByCode(parentCode)
  if (current) return current.name_th
  const gone = abolishedAreas().find((x) => x.level === 'district' && x.code === parentCode)
  return gone?.name_th ?? districtByCode(successorDistrictCode)?.name_th
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
      const district = oldDistrictName(a.parent_code, successor.district_code)
      if (!district) {
        noParent++
        continue
      }
      // If the old name is also a CURRENT subdistrict of that district, the row is an ordinary one
      // and a postal code of another subdistrict is a genuine mismatch; not this guard's business.
      if (a.parent_code !== null && subdistrictsByName(a.name_th, { districtCode: a.parent_code }).length > 0) {
        stillCurrent++
        continue
      }
      for (const postalCode of successor.postal_codes) {
        rows.push({ why: `${a.code} ${a.name_th} -> ${code}`, input: { province: province.name_th, district, subdistrict: a.name_th, postalCode } })
      }
    }
  }

  it('covers a large part of the data (the guard is not vacuous)', () => {
    expect(rows.length).toBeGreaterThan(1190) // 1,198 on data 2026.10.23: every (abolished name, successor) pair
    // Names that are still current under their own old parent would be excluded and counted here;
    // in this data there are none, and nothing may silently go missing.
    expect(rows.length + stillCurrent + noParent).toBeGreaterThan(1190)
  })

  it('no row gets a POSTAL_CODE_MISMATCH when its postal code is a successor\'s', () => {
    const bad = rows.map((r) => mismatch(r.input)).filter((x): x is string => x !== undefined)
    expect(bad.slice(0, 5)).toEqual([])
    expect(bad).toHaveLength(0)
  })
})

describe('abolished subdistricts: a wrong code gets exactly ONE mismatch that names the successors\' codes', () => {
  // The class behind "duplicate mismatch" (validate judges at district level when the abolished name
  // is current nowhere, abolished.ts judges at subdistrict level): count the findings, not just look
  // for one. The foreign code is in use somewhere but belongs to no successor of that name.
  const FOREIGN = ['50200', '10200', '84280', '20000']
  it('every abolished row with a foreign in-use code: one POSTAL_CODE_MISMATCH, expected = successors\' codes', () => {
    let rows = 0
    const bad: string[] = []
    for (const a of abolishedAreas()) {
      if (a.level !== 'subdistrict' || a.successors.length === 0) continue
      const province = provinceByCode(a.code.slice(0, 2))
      const successors = a.successors.map((c) => subdistrictByCode(c)).filter((s) => s !== undefined)
      const district = successors[0] ? oldDistrictName(a.parent_code, successors[0].district_code) : undefined
      if (!province || !district) continue
      if (a.parent_code !== null && subdistrictsByName(a.name_th, { districtCode: a.parent_code }).length > 0) continue
      const codes = new Set(successors.flatMap((s) => s.postal_codes))
      const foreign = FOREIGN.find((c) => !codes.has(c))
      if (!foreign) continue
      rows++
      const r = check({ province: province.name_th, district, subdistrict: a.name_th, postalCode: foreign })
      const found = r.findings.filter((f) => f.code === 'POSTAL_CODE_MISMATCH')
      const expected = (found[0]?.detail.expected ?? []) as string[]
      if (found.length !== 1) bad.push(`${a.code} ${a.name_th}: ${found.length} mismatches`)
      else if ([...codes].some((c) => !expected.includes(c))) bad.push(`${a.code} ${a.name_th}: expected ${expected} lacks a successor code`)
      else if (r.status !== 'invalid') bad.push(`${a.code} ${a.name_th}: status ${r.status}`)
    }
    expect(rows).toBeGreaterThan(900)
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
