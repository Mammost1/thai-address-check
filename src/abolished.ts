/**
 * Old names and abolished areas (feature 5).
 *
 * A name is reported as abolished only when it does NOT resolve to a current area under the
 * parent the caller gave: 1,429 of the 1,503 abolished subdistrict names are still in use
 * somewhere today, so the parent (district, then province) is what tells an old `บางนา` in
 * เขตบางนา from a current `บางนา` in Phra Nakhon Si Ayutthaya.
 *
 * Evidence basis of the successors (docs/TASKS.md amendment A5):
 *   notice + exactly one successor  -> may be corrected automatically (confidence 0.95)
 *   name                            -> suggestion only, never applied (confidence 0.8)
 *   null / no successor             -> report only
 *   more than one successor         -> always ambiguous, never applied
 */
import {
  abolishedByName,
  districtByCode,
  districtsByName,
  isPostalCodeInUse,
  provincesByName,
  resolvedByCode,
  resolvedOf,
  subdistrictsByName,
  subdistrictsOf,
  type Abolished,
} from './data'
import { LABEL_TH } from './labels'
import type { CheckContext, Field, Finding, ResolvedAddress, Suggestion } from './types'

type Basis = Abolished['successors_basis']

const CONFIDENCE_NOTICE = 0.95
const CONFIDENCE_NAME = 0.8
const CONFIDENCE_AMBIGUOUS = 0.5
const BASIS_RANK: Record<string, number> = { notice: 2, name: 1, null: 0 }

/**
 * The evidence for a group of matched abolished areas. Records that agree on the successor set
 * count as one claim, so the strongest basis among them stands (100902 and 100998 both say
 * คลองตัน -> 103302, one by name and one by notice). Records that disagree fall back to the
 * weakest basis, so nothing is corrected on the strength of one record while another contradicts it.
 */
function effectiveBasis(hits: Abolished[]): Basis {
  const sets = new Set(hits.map((h) => [...h.successors].sort().join(',')))
  const rank = (b: Basis): number => BASIS_RANK[String(b)]!
  const pick = sets.size === 1 ? Math.max : Math.min
  const best = pick(...hits.map((h) => rank(h.successors_basis)))
  return best === 2 ? 'notice' : best === 1 ? 'name' : null
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)]
}

/** True when the given text names exactly this area of `addr` at `field`. */
function fieldMatches(field: Field, value: string, addr: ResolvedAddress): boolean {
  if (field === 'province') return provincesByName(value).some((p) => p.code === addr.provinceCode)
  if (field === 'district') return districtsByName(value).some((d) => d.code === addr.districtCode)
  if (field === 'subdistrict') return subdistrictsByName(value).some((s) => s.code === addr.subdistrictCode)
  return true
}

function officialName(field: Field, addr: ResolvedAddress): string {
  if (field === 'province') return addr.province.th
  if (field === 'district') return addr.district.th
  return addr.subdistrict.th
}

interface Hit {
  /** Which field the abolished name was found in. */
  field: 'district' | 'subdistrict'
  areas: Abolished[]
  /** Current addresses the successors stand for; empty when there is no usable successor. */
  addrs: ResolvedAddress[]
  /** Successor districts (district level only). */
  districts: { code: string; th: string; en: string }[]
}

function areaDetail(a: Abolished): Record<string, unknown> {
  return { code: a.code, name: a.name_th, abolishedOn: a.abolished_on }
}

function successorLabel(h: Hit): string {
  if (h.field === 'district') return h.districts.map((d) => d.th).join(', ')
  return h.addrs.map((a) => `${a.subdistrict.th} (${a.district.th} ${a.province.th})`).join(', ')
}

/**
 * The postal code of a row whose subdistrict resolves ONLY as an abolished name is judged against
 * the codes of its successors (those that stand for the areas matched under the given parents), not
 * against a same-name subdistrict somewhere else: people still write แขวงบางนา 10260 and 10260 is the
 * code of both successors. `validate` cannot know this, so any POSTAL_CODE_MISMATCH it raised for the
 * subdistrict is replaced here: no finding when a successor uses the code, otherwise one that names the
 * successors' codes as the expected ones (never a code from another province). A code that is not
 * 5 digits or not in use anywhere keeps its POSTAL_CODE_INVALID finding, and with no successor there
 * is nothing to compare with, so validate's finding stays.
 */
function judgePostalBySuccessors(ctx: CheckContext, addrs: readonly ResolvedAddress[], given: string): void {
  const postal = ctx.output.postalCode
  if (addrs.length === 0 || !postal || !/^\d{5}$/.test(postal) || !isPostalCodeInUse(postal)) return
  ctx.findings = ctx.findings.filter((f) => !(f.code === 'POSTAL_CODE_MISMATCH' && f.fields.includes('subdistrict')))
  if (addrs.some((a) => a.postalCodes.includes(postal))) return
  const expected = unique(addrs.flatMap((a) => a.postalCodes)).sort()
  const shown = expected.slice(0, 30)
  const list = expected.length > shown.length ? `เช่น ${shown.join(', ')}` : `ใช้ ${shown.join(', ')}`
  ctx.findings.push({
    code: 'POSTAL_CODE_MISMATCH',
    severity: 'error',
    fields: ['postalCode', 'subdistrict'],
    message: {
      th: `${LABEL_TH.postalCode} ${postal} ไม่ตรงกับ${LABEL_TH.subdistrict}ที่มาแทน "${given}" (${list})`,
      en: `Postal code ${postal} does not belong to the areas that replaced "${given}" (they use ${shown.join(', ')}${expected.length > shown.length ? ', …' : ''}).`,
    },
    detail: {
      given: postal,
      against: { field: 'subdistrict', value: given, abolished: true },
      expected: shown,
      expectedTotal: expected.length,
    },
  })
}

/**
 * Reports names or codes that belong to abolished areas (ABOLISHED_AREA) with their successors
 * and the evidence basis, and corrects only on a gazette-notice basis with exactly one successor.
 * Does nothing when `ctx.candidates` already holds a current address, or when the name is current
 * under the given parent.
 */
export function checkAbolished(ctx: CheckContext): void {
  if (ctx.candidates.length > 0) return
  const { province, district, subdistrict, postalCode } = ctx.output
  if (!district && !subdistrict) return

  const provinceCodes = province ? provincesByName(province).map((p) => p.code) : []
  const inProvince = (code: string): boolean =>
    provinceCodes.length === 0 || provinceCodes.some((p) => code.startsWith(p))

  const currentDistricts = district ? districtsByName(district).filter((d) => inProvince(d.code)) : []
  const abolishedDistricts =
    district && currentDistricts.length === 0
      ? abolishedByName(district, 'district').filter((a) => inProvince(a.code))
      : []

  const hits: Hit[] = []

  if (subdistrict) {
    const parents = new Set([...currentDistricts.map((d) => d.code), ...abolishedDistricts.map((a) => a.code)])
    const anchored = Boolean(district)
    if (!anchored || parents.size > 0) {
      const currentHere = subdistrictsByName(subdistrict).filter((s) =>
        anchored ? parents.has(s.district_code) : inProvince(s.code),
      )
      if (currentHere.length === 0) {
        const areas = abolishedByName(subdistrict, 'subdistrict').filter((a) =>
          anchored ? a.parent_code !== null && parents.has(a.parent_code) : inProvince(a.code),
        )
        if (areas.length > 0) {
          const addrs = unique(areas.flatMap((a) => a.successors))
            .map((code) => resolvedByCode(code))
            .filter((a): a is ResolvedAddress => a !== undefined)
          hits.push({ field: 'subdistrict', areas, addrs, districts: [] })
        }
      }
    }
  }

  if (abolishedDistricts.length > 0 && !hits.some((h) => h.field === 'subdistrict')) {
    let districts = unique(abolishedDistricts.flatMap((a) => a.successors)).flatMap((code) => {
      const d = districtByCode(code)
      return d ? [{ code: d.code, th: d.name_th, en: d.name_en }] : []
    })
    if (subdistrict) {
      const narrowed = districts.filter((d) => subdistrictsOf(d.code).some((s) => fieldMatches('subdistrict', subdistrict, resolvedOf(s))))
      if (narrowed.length > 0) districts = narrowed
    }
    const addrs = subdistrict
      ? districts.flatMap((d) =>
          subdistrictsByName(subdistrict, { districtCode: d.code }).map((s) => resolvedOf(s)),
        )
      : []
    hits.push({ field: 'district', areas: abolishedDistricts, addrs, districts })
  } else if (abolishedDistricts.length > 0) {
    // The subdistrict hit already carries the successor district; the old district is reported too.
    hits.push({ field: 'district', areas: abolishedDistricts, addrs: [], districts: [] })
  }

  if (hits.length === 0) return

  const explained = new Set<Field>(hits.map((h) => h.field))
  ctx.findings = ctx.findings.filter(
    (f) => !((f.code === 'UNKNOWN_NAME' || f.code === 'PARENT_MISMATCH') && f.fields.some((x) => explained.has(x))),
  )

  const main = hits.find((h) => h.addrs.length > 0 || h.districts.length > 0) ?? hits[0]!
  if (main.field === 'subdistrict' && subdistrict) judgePostalBySuccessors(ctx, main.addrs, subdistrict)
  const basis = effectiveBasis(main.areas)
  const addrs = main.addrs
  const postalOk = (a: ResolvedAddress): boolean => !postalCode || a.postalCodes.includes(postalCode)
  const single = basis !== null && addrs.length === 1 ? addrs[0] : undefined
  const apply =
    ctx.options.autoCorrect &&
    basis === 'notice' &&
    single !== undefined &&
    CONFIDENCE_NOTICE >= ctx.options.autoCorrectThreshold &&
    postalOk(single)
  const ambiguous = basis !== null && addrs.length > 1

  const confidence =
    basis === 'notice' ? CONFIDENCE_NOTICE : basis === 'name' ? CONFIDENCE_NAME : 0
  const suggestions: Suggestion[] = []
  if (basis !== null) {
    const fields: Field[] = ['province', 'district', 'subdistrict']
    if (addrs.length > 0) {
      for (const addr of addrs) {
        for (const field of fields) {
          const given = ctx.output[field]
          if (!given || fieldMatches(field, given, addr)) continue
          suggestions.push({
            field,
            from: given,
            to: officialName(field, addr),
            confidence: addrs.length === 1 ? confidence : Math.min(confidence, CONFIDENCE_AMBIGUOUS),
            reason: 'ABOLISHED_AREA',
            resolved: addr,
          })
        }
      }
    } else if (main.districts.length > 0 && district) {
      for (const d of main.districts) {
        suggestions.push({
          field: 'district',
          from: district,
          to: d.th,
          confidence: main.districts.length === 1 ? confidence : Math.min(confidence, CONFIDENCE_AMBIGUOUS),
          reason: 'ABOLISHED_AREA',
        })
      }
    }
  }
  // maxSuggestions is per field, and counts suggestions other steps already put on that field.
  const perField = new Map<Field, number>()
  for (const s of ctx.suggestions) perField.set(s.field, (perField.get(s.field) ?? 0) + 1)
  for (const s of suggestions) {
    const n = perField.get(s.field) ?? 0
    if (n >= ctx.options.maxSuggestions) continue
    perField.set(s.field, n + 1)
    ctx.suggestions.push(s)
  }

  const resolvedNow = apply || ambiguous
  for (const hit of hits) {
    const hitBasis = effectiveBasis(hit.areas)
    const given = ctx.output[hit.field]
    const successors = hit === main ? successorLabel(hit) : ''
    const first = hit.areas[0]!
    const cited = hit.areas.find((a) => a.successors_source !== null) ?? first
    const finding: Finding = {
      code: 'ABOLISHED_AREA',
      severity: resolvedNow ? 'warning' : 'error',
      fields: [hit.field],
      message: {
        th: successors
          ? `"${given}" เป็นชื่อของพื้นที่ที่ถูกยุบ (เมื่อ ${first.abolished_on}) ปัจจุบันแทนด้วย ${successors}` +
            (ambiguous && hit === main ? ' จึงต้องระบุข้อมูลเพิ่มเพื่อเลือกหนึ่งพื้นที่' : '') +
            (hitBasis === 'name' ? ' (หลักฐานคือชื่อพื้นที่ ไม่ใช่ประกาศ จึงไม่แก้ให้อัตโนมัติ)' : '')
          : `"${given}" เป็นชื่อของพื้นที่ที่ถูกยุบ (เมื่อ ${first.abolished_on}) และข้อมูลไม่ระบุพื้นที่ที่มาแทน`,
        en: successors
          ? `"${given}" names an abolished area (abolished ${first.abolished_on}); it is now ${successors}` +
            (ambiguous && hit === main ? '. More than one area took over, so another field is needed to choose.' : '') +
            (hitBasis === 'name' ? ' (the link rests on the name, not a gazette notice, so it is not corrected automatically)' : '')
          : `"${given}" names an abolished area (abolished ${first.abolished_on}) and the data lists no successor.`,
      },
      detail: {
        given,
        level: hit.field,
        abolished: hit.areas.map(areaDetail),
        basis: hitBasis,
        successors: hit.addrs.length > 0
          ? hit.addrs.map((a) => ({ code: a.subdistrictCode, th: a.subdistrict.th, en: a.subdistrict.en, district: a.district.th, province: a.province.th, postalCodes: a.postalCodes }))
          : hit.districts,
        inForce: cited.successors_in_force,
        source: cited.successors_source,
        applied: apply && hit === main,
        ...(single && postalCode && !postalOk(single) ? { postalCode, expected: single.postalCodes } : {}),
      },
    }
    ctx.findings.push(finding)
  }

  if (apply && single) {
    const next = { ...ctx.output }
    for (const field of ['province', 'district', 'subdistrict'] as const) {
      const given = ctx.output[field]
      if (given && !fieldMatches(field, given, single)) next[field] = officialName(field, single)
    }
    ctx.output = next
    ctx.candidates = [single]
  } else if (ambiguous) {
    ctx.candidates = [...addrs]
  }
}
