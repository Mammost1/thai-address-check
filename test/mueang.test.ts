// tac-night F12 (ruling eb27cfaa): people write the capital district as 'อ.เมือง' / 'เมือง' / 'Mueang' /
// 'Muang'. With the province it means เมือง<province>; 0.1.2 rejected it as MISSPELLED_NAME 'คูเมือง'.
import { describe, expect, it } from 'vitest'
import { check } from '../src/check'
import { allMueangDistricts, allProvinces, mueangDistrictOf, subdistrictsOf } from '../src/data'
import { normalize } from '../src/normalize'

describe('bare เมือง with a province (tac-night F12)', () => {
  it('75 provinces have a capital district named เมือง+province; Bangkok and Ayutthaya do not (data 2026.10.23)', () => {
    expect(allMueangDistricts().length).toBe(75)
    expect(mueangDistrictOf('10')).toBeUndefined()
    expect(mueangDistrictOf('14')).toBeUndefined()
  })

  it('every such province x {เมือง, อ.เมือง, อำเภอเมือง, Mueang, Muang, MUANG} resolves valid to that district', () => {
    const bad: string[] = []
    for (const p of allProvinces()) {
      const d = mueangDistrictOf(p.code)
      if (!d) continue
      const s = subdistrictsOf(d.code)[0]!
      const pc = s.postal_codes[0]!
      for (const [district, thai] of [['เมือง', true], ['อ.เมือง', true], ['อำเภอเมือง', true], ['Mueang', false], ['Muang', false], ['MUANG', false]] as const) {
        const input = thai
          ? { province: p.name_th, district, subdistrict: s.name_th, postalCode: pc }
          : { province: p.name_en, district, subdistrict: s.name_en, postalCode: pc }
        const r = check(input)
        const want = thai ? d.name_th : d.name_en
        const fmt = r.findings.find((f) => f.code === 'FORMAT_NORMALIZED' && f.fields[0] === 'district')
        if (r.status !== 'valid' || r.output.district !== want || r.resolved?.subdistrictCode !== s.code || !(fmt?.detail.rules as string[]).includes('mueang-province') || r.findings.some((f) => f.severity !== 'info')) {
          bad.push(`${p.name_th} ${district}: ${r.status} ${r.output.district} ${r.findings.map((f) => f.code).join(',')}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('normalize alone leaves the choice to validation: อ.เมือง becomes เมือง', () => {
    expect(normalize({ district: 'อ.เมือง', province: 'จ.เชียงใหม่' }).district).toBe('เมือง')
  })

  it('a subdistrict outside the capital district still gets PARENT_MISMATCH (ลำปาง has เมืองลำปาง and เมืองปาน)', () => {
    const r = check({ province: 'ลำปาง', district: 'เมือง', subdistrict: 'แจ้ห่ม' })
    expect(r.status).toBe('invalid')
    const m = r.findings.find((f) => f.code === 'PARENT_MISMATCH')!
    expect(m.message.en).toContain('"เมืองลำปาง"')
    expect(r.output.district).toBe('เมืองลำปาง')
  })

  it('Bangkok (no เมือง district) does not expand and gets no fuzzy suggestion', () => {
    const r = check({ province: 'กรุงเทพมหานคร', district: 'เมือง', subdistrict: 'บางนาเหนือ', postalCode: '10260' })
    expect(r.status).toBe('invalid')
    expect(r.output.district).toBe('เมือง')
    expect(r.findings.map((f) => f.code)).toContain('UNKNOWN_NAME')
    expect(r.findings.map((f) => f.code)).not.toContain('MISSPELLED_NAME')
    expect(r.suggestions.filter((s) => s.field === 'district')).toEqual([])
  })

  it('an exact province alias counts (กทม is Bangkok; จ.เชียงใหม่ is Chiang Mai)', () => {
    expect(check({ province: 'จ.เชียงใหม่', district: 'อ.เมือง', subdistrict: 'ต.สุเทพ', postalCode: '50200' }).output.district).toBe('เมืองเชียงใหม่')
  })

  it('a misspelled province is not fuzzy-matched first: no expansion, no wrong district', () => {
    const r = check({ province: 'เชียงใหมม', district: 'เมือง', subdistrict: 'สุเทพ', postalCode: '50200' })
    expect(r.output.district === 'เมือง' || r.output.district === 'เมืองเชียงใหม่').toBe(true)
    expect(r.suggestions.filter((s) => s.field === 'district' && s.to !== 'เมืองเชียงใหม่')).toEqual([])
  })
})

describe('bare เมือง without a province (tac-night F12)', () => {
  it('subdistrict + postal code that fit exactly one capital district: accepted, district written in full, province filled', () => {
    const r = check({ district: 'เมือง', subdistrict: 'สุเทพ', postalCode: '50200' })
    expect(r.status).toBe('corrected') // the province was filled, as for any missing province
    expect(r.output).toMatchObject({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่' })
    expect(r.findings.find((f) => f.code === 'FORMAT_NORMALIZED')?.detail.rules).toEqual(['mueang-province'])
  })

  it('several capital districts fit: AMBIGUOUS naming the province as needed, no fuzzy suggestion', () => {
    const r = check({ district: 'เมือง', subdistrict: 'ในเมือง' })
    expect(r.status).toBe('ambiguous')
    const a = r.findings.find((f) => f.code === 'AMBIGUOUS')!
    expect(a.detail.needs).toContain('province')
    expect(r.output.district).toBe('เมือง')
    expect(r.suggestions.filter((s) => s.field === 'district')).toEqual([])
  })
})
