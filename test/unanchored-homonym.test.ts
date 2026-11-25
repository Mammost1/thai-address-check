// tac-night F10/F11 (rulings 41de56ed, e1ccb0e5). With neither province nor district, a subdistrict name
// that is current somewhere AND also named an abolished area elsewhere must not be resolved to the current
// place by guessing: 0.1.2 filled 'บางนา' as Phra Nakhon Si Ayutthaya / มหาราช / 13150, and judged
// 'บางนา 10260' against 13150 although 10260 is the code of Bangkok's successors.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check'
import { abolishedByName, allSubdistricts, subdistrictsByName } from '../src/data'

const { names } = JSON.parse(readFileSync(new URL('./fixtures/abolished-homonyms.json', import.meta.url), 'utf8')) as { names: string[] }
/**
 * Rule B (ruling e1ccb0e5): withheld when the name has abolished records outside the current homonyms'
 * districts and NONE of them names a current homonym as its successor. Computed from the data here,
 * independently of abolished.ts, so the test states the rule rather than echoing the implementation.
 */
function withheld(name: string): boolean {
  const cur = subdistrictsByName(name)
  if (cur.length === 0) return false
  const codes = new Set(cur.map((s) => s.code))
  const districts = new Set(cur.map((s) => s.district_code))
  const recs = abolishedByName(name, 'subdistrict').filter((a) => a.parent_code === null || !districts.has(a.parent_code))
  return recs.length > 0 && !recs.some((a) => a.successors.some((c) => codes.has(c)))
}
const W = names.filter(withheld)
const linked = names.filter((n) => !withheld(n))
const abolishedFlag = (r: ReturnType<typeof check>): boolean => r.findings.some((f) => f.code === 'ABOLISHED_AREA' && f.detail.unanchored === true)

describe('bare abolished homonym, no parent field (F10)', () => {
  it('the tester set: 151 names, 93 with no record linking them to the current place, 58 linked (data 2026.10.23)', () => {
    expect(names.length).toBe(151)
    expect(W.length).toBe(93)
    expect(linked).toContain('บึงกาฬ')
  })

  it('name only: none of the 93 is corrected or valid, nothing is filled, ABOLISHED_AREA says why', () => {
    const bad: string[] = []
    for (const name of W) {
      const r = check({ subdistrict: name })
      if (r.status === 'corrected' || r.status === 'valid' || JSON.stringify(r.output) !== JSON.stringify({ subdistrict: name }) || !abolishedFlag(r)) {
        bad.push(`${name}: ${r.status} ${JSON.stringify(r.output)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the 58 linked names (an old record names the current place as successor, e.g. บึงกาฬ) are still filled', () => {
    const bad: string[] = []
    for (const name of linked) {
      const s = subdistrictsByName(name)
      const r = check({ subdistrict: name })
      if (abolishedFlag(r) || (s.length === 1 && (r.status !== 'corrected' || r.resolved?.subdistrictCode !== s[0]!.code))) bad.push(`${name}: ${r.status}`)
    }
    expect(bad).toEqual([])
  })

  it('(a) with the current homonym\'s own postal code it is resolved as before', () => {
    const bad: string[] = []
    for (const name of W) {
      const s = subdistrictsByName(name)
      if (s.length !== 1) continue
      const r = check({ subdistrict: name, postalCode: s[0]!.postal_codes[0]! })
      if (r.status !== 'corrected' || r.resolved?.subdistrictCode !== s[0]!.code || abolishedFlag(r)) bad.push(`${name}: ${r.status}`)
    }
    expect(bad).toEqual([])
  })

  it('(d) with a postal code used by neither place: invalid, POSTAL_CODE_MISMATCH + ABOLISHED_AREA, nothing filled', () => {
    const bad: string[] = []
    for (const name of W) {
      const own = new Set(subdistrictsByName(name).flatMap((s) => s.postal_codes))
      const far = ['84280', '50200', '90110'].find((c) => !own.has(c))!
      const r = check({ subdistrict: name, postalCode: far })
      const codes = r.findings.map((f) => f.code)
      if (r.status !== 'invalid' || r.output.province !== undefined || !abolishedFlag(r) || !(codes.includes('POSTAL_CODE_MISMATCH') || r.findings.some((f) => f.detail.postalCodeUsedIn))) {
        bad.push(`${name} ${far}: ${r.status} ${codes.join(',')}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('the two named cases (F10, F11)', () => {
  it('บางนา: ambiguous between Ayutthaya and Bangkok\'s two successors', () => {
    const r = check({ subdistrict: 'บางนา' })
    expect(r.status).toBe('ambiguous')
    expect(r.output).toEqual({ subdistrict: 'บางนา' })
    expect(r.findings.find((f) => f.code === 'AMBIGUOUS')?.detail.count).toBe(3)
  })

  it('บางนา + 10260: the Bangkok successors, ambiguous between them, no mismatch against 13150', () => {
    const r = check({ subdistrict: 'บางนา', postalCode: '10260' })
    expect(r.status).toBe('ambiguous')
    expect(r.findings.map((f) => f.code)).not.toContain('POSTAL_CODE_MISMATCH')
    expect(r.suggestions.every((s) => s.to !== '13150')).toBe(true)
    expect((r.findings.find((f) => f.code === 'AMBIGUOUS')?.detail.options as { province: string }[]).every((o) => o.province === 'กรุงเทพมหานคร')).toBe(true)
  })

  it('บางนา + 50200: invalid, the mismatch names both 10260 and 13150', () => {
    const r = check({ subdistrict: 'บางนา', postalCode: '50200' })
    expect(r.status).toBe('invalid')
    expect(r.findings.find((f) => f.code === 'POSTAL_CODE_MISMATCH')?.detail.expected).toEqual(['10260', '13150'])
  })

  it('บางเขน (abolished in Bangkok, no successor): not filled as Nonthaburi; + 10220 points to เขตบางเขน, no mismatch', () => {
    const bare = check({ subdistrict: 'บางเขน' })
    expect(bare.status).toBe('invalid')
    expect(bare.output).toEqual({ subdistrict: 'บางเขน' })
    const r = check({ subdistrict: 'บางเขน', postalCode: '10220' })
    expect(r.status).toBe('invalid')
    expect(r.findings.map((f) => f.code)).toEqual(['ABOLISHED_AREA'])
    expect(r.findings[0]!.message.en).toContain('10220 is used in เขตบางเขน กรุงเทพมหานคร')
    expect(check({ subdistrict: 'บางเขน', postalCode: '11000' }).status).toBe('corrected')
  })
})

describe('cannot widen (ruling 41de56ed e)', () => {
  it('anchored by province or district: the unanchored rule never fires', () => {
    const bad: string[] = []
    for (const name of W) {
      const s = subdistrictsByName(name)[0]!
      const r1 = check({ province: check({ subdistrict: name, postalCode: s.postal_codes[0]! }).output.province, subdistrict: name })
      const r2 = check({ district: check({ subdistrict: name, postalCode: s.postal_codes[0]! }).output.district, subdistrict: name })
      if (abolishedFlag(r1) || abolishedFlag(r2)) bad.push(name)
    }
    expect(bad).toEqual([])
  })

  it('every current name the rule does not cover keeps today\'s name-only behaviour (unique ones are filled)', () => {
    const bad: string[] = []
    let unique = 0
    for (const name of new Set(allSubdistricts().map((s) => s.name_th))) {
      if (withheld(name)) continue
      const r = check({ subdistrict: name })
      if (abolishedFlag(r)) bad.push(`${name}: flagged`)
      const s = subdistrictsByName(name)
      if (s.length === 1) {
        unique++
        if (r.status !== 'corrected' || r.resolved?.subdistrictCode !== s[0]!.code) bad.push(`${name}: ${r.status}`)
      }
    }
    expect(bad).toEqual([])
    expect(unique).toBeGreaterThan(4900)
  })
})
