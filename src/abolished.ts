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
  provinceByCode,
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
 * code of both successors. `validate` cannot know this, so every POSTAL_CODE_MISMATCH it raised (at
 * subdistrict level, or at district level when the name is current nowhere, e.g. บางบอน) is replaced
 * here: no finding when a successor uses the code, otherwise exactly one that names the successors'
 * codes as the expected ones (never a code from another province). A code that is not
 * 5 digits or not in use anywhere keeps its POSTAL_CODE_INVALID finding, and with no successor there
 * is nothing to compare with, so validate's finding stays.
 */
function judgePostalBySuccessors(ctx: CheckContext, addrs: readonly ResolvedAddress[], given: string): void {
  const postal = ctx.output.postalCode
  if (addrs.length === 0 || !postal || !/^\d{5}$/.test(postal) || !isPostalCodeInUse(postal)) return
  // Whatever level validate judged the code at (subdistrict, or district when the name is current
  // nowhere), the successors now decide: drop its mismatches so at most one is reported.
  ctx.findings = ctx.findings.filter((f) => f.code !== 'POSTAL_CODE_MISMATCH')
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

function has(v: string | undefined): v is string {
  return v !== undefined && v.trim() !== ''
}

function place(a: ResolvedAddress): string {
  return `${a.subdistrict.th} (${a.district.th} ${a.province.th})`
}

/**
 * The unanchored case (no province, no district) when the abolished homonym that raises the doubt has NO
 * successor in the data (e.g. Bangkok's บางเขน 100599; rulings be3822a3 and Mos on 99481561, rule A).
 * Nothing is filled:
 *   (c') no postal code: status ambiguous (ABOLISHED_AREA warning + AMBIGUOUS naming the current place and
 *        the old area; the current homonym stays the one candidate and is suggested at 0.5);
 *   (b') the postal code is used in the abolished area's former district: invalid, ABOLISHED_AREA says so,
 *        no mismatch against the current homonym;
 *   (d') a postal code used by neither: invalid, the mismatch lists the current homonym's codes.
 * (A postal code the current homonym uses never reaches here: case (a) keeps today's fill.)
 */
function noSuccessor(ctx: CheckContext, name: string, areas: Abolished[], currentAddrs: ResolvedAddress[], postal: string | undefined): void {
  const first = areas[0]!
  const where = unique(areas.map((a) => provinceByCode(a.code.slice(0, 2))?.name_th ?? a.code.slice(0, 2))).join(', ')
  const homonyms = currentAddrs.map(place).join(', ')
  const formerDistricts = unique(areas.flatMap((a) => (a.parent_code ? [a.parent_code] : []))).filter((c) => districtByCode(c) !== undefined)
  const former = formerDistricts.flatMap((c) => subdistrictsOf(c).map((x) => resolvedOf(x)))
  const inFormer = postal === undefined ? [] : former.filter((a) => a.postalCodes.includes(postal))
  const formerLabel = unique(inFormer.map((a) => `${a.district.th} ${a.province.th}`)).join(', ')

  if (postal !== undefined && inFormer.length === 0) {
    const expected = unique(currentAddrs.flatMap((a) => a.postalCodes)).sort()
    ctx.findings.push({
      code: 'POSTAL_CODE_MISMATCH',
      severity: 'error',
      fields: ['postalCode', 'subdistrict'],
      message: {
        th: `${LABEL_TH.postalCode} ${postal} ไม่ตรงกับ${LABEL_TH.subdistrict} "${name}" ที่มีอยู่ปัจจุบัน (${homonyms} ใช้ ${expected.join(', ')})`,
        en: `Postal code ${postal} does not belong to the current "${name}" (${homonyms} uses ${expected.join(', ')}).`,
      },
      detail: { given: postal, against: { field: 'subdistrict', value: name, unanchored: true }, expected, expectedTotal: expected.length },
    })
  }
  const reasonTh =
    inFormer.length > 0
      ? `${LABEL_TH.postalCode} ${postal} ใช้ใน ${formerLabel} ซึ่งเป็นที่ตั้งเดิม จึงไม่ถือว่าเป็น ${homonyms}`
      : `ไม่มี${LABEL_TH.province}หรือ${LABEL_TH.district} จึงไม่สรุปว่าเป็น ${homonyms}`
  const reasonEn =
    inFormer.length > 0
      ? `Postal code ${postal} is used in ${formerLabel}, where it was, so this is not taken as ${homonyms}.`
      : `With no province or district, it is not assumed to be ${homonyms}.`
  // (c') no postal code: ambiguous between the current homonym and the old area; (b') / (d'): invalid.
  const open = postal === undefined
  ctx.findings.push({
    code: 'ABOLISHED_AREA',
    severity: open ? 'warning' : 'error',
    fields: ['subdistrict'],
    message: {
      th: `"${name}" เป็นชื่อของพื้นที่ที่ถูกยุบใน ${where} ด้วย (เมื่อ ${first.abolished_on}) และข้อมูลไม่ระบุพื้นที่ที่มาแทน ${reasonTh} ให้ระบุ${LABEL_TH.province}หรือ${LABEL_TH.district}`,
      en: `"${name}" also names an abolished area in ${where} (abolished ${first.abolished_on}) and the data lists no successor. ${reasonEn} Give the province or district.`,
    },
    detail: {
      given: name,
      level: 'subdistrict',
      unanchored: true,
      abolished: areas.map(areaDetail),
      basis: null,
      successors: [],
      current: currentAddrs.map((a) => ({ code: a.subdistrictCode, district: a.district.th, province: a.province.th, postalCodes: a.postalCodes })),
      ...(inFormer.length > 0 ? { postalCodeUsedIn: unique(inFormer.map((a) => a.districtCode)) } : {}),
      applied: false,
    },
  })
  if (open) {
    const options = [
      ...currentAddrs.map((a) => ({ province: a.province.th, district: a.district.th, subdistrict: a.subdistrict.th, postalCodes: a.postalCodes })),
      ...areas.map((a) => ({ province: provinceByCode(a.code.slice(0, 2))?.name_th ?? '', subdistrict: a.name_th, abolished: a.code, abolishedOn: a.abolished_on })),
    ]
    ctx.findings.push({
      code: 'AMBIGUOUS',
      severity: 'error',
      fields: ['province', 'district'],
      message: {
        th: `"${name}" อาจหมายถึง ${homonyms} หรือพื้นที่เดิมใน ${where} ที่ถูกยุบแล้ว ต้องระบุเพิ่ม: ${LABEL_TH.province}, ${LABEL_TH.district}`,
        en: `"${name}" may mean ${homonyms} or the abolished area in ${where}; add: province, district.`,
      },
      detail: { count: options.length, needs: ['province', 'district'], options: options.slice(0, 10), optionsTotal: options.length },
    })
  }
  // The current homonym stays a candidate when nothing rules it out; check() reports 'ambiguous'
  // because of the AMBIGUOUS finding, and never 'valid' with it filled.
  ctx.candidates = open ? [...currentAddrs] : []
  // Suggestions only: the current homonym, and the former district when the postal code points there.
  const pool = [...currentAddrs, ...unique(inFormer.map((a) => a.districtCode)).map((c) => inFormer.find((a) => a.districtCode === c)!)]
  const perField = new Map<Field, number>()
  for (const x of ctx.suggestions) perField.set(x.field, (perField.get(x.field) ?? 0) + 1)
  for (const addr of pool) {
    for (const field of ['province', 'district'] as const) {
      const k = perField.get(field) ?? 0
      if (k >= ctx.options.maxSuggestions) continue
      perField.set(field, k + 1)
      ctx.suggestions.push({ field, from: undefined, to: officialName(field, addr), confidence: CONFIDENCE_AMBIGUOUS, reason: currentAddrs.includes(addr) ? 'AMBIGUOUS' : 'ABOLISHED_AREA', resolved: addr })
    }
  }
}

/**
 * tac-night F10/F11 (ruling 41de56ed). A bare subdistrict name, with neither province nor district,
 * that is current somewhere AND also named an abolished area elsewhere: 0.1.2 filled the current
 * homonym ('บางนา' became Phra Nakhon Si Ayutthaya / มหาราช / 13150) and judged a postal code against it
 * alone ('บางนา 10260' was "it uses 13150", though 10260 is the code of Bangkok's successors). That is a
 * guess, so with no parent field:
 *   (a) a postal code a current homonym uses settles it: nothing changes here;
 *   (b) a postal code only the successors use: they are the candidates (ambiguous when several), never applied;
 *   (c) no postal code: no fill; the current homonyms and the successors are all candidates (ambiguous);
 *   (d) a postal code neither uses: invalid, the mismatch lists the codes of both, never applied.
 * With a province or a district given (anchored), or for a name never abolished elsewhere, nothing changes.
 *
 * @returns true when it decided the address (the rest of `checkAbolished` is skipped).
 */
function checkUnanchoredHomonym(ctx: CheckContext): boolean {
  const n = ctx.normalized
  if (has(n.province) || has(n.district) || !has(n.subdistrict)) return false
  const name = n.subdistrict
  const current = subdistrictsByName(name)
  if (current.length === 0) return false // current nowhere: the anchored path below explains it
  const currentDistricts = new Set(current.map((x) => x.district_code))
  const currentCodes = new Set(current.map((x) => x.code))
  // Rule A (Mos, amending be3822a3): a record whose successor IS a current homonym is the same place
  // re-registered (บึงกาฬ: old Nong Khai record -> today's Bueng Kan one) and raises no doubt. Any OTHER
  // record (pointing elsewhere, or nowhere) is a place the bare name may mean, so the fill is withheld;
  // a link on one record says nothing about an unlinked one (ส้มผ่อ: Phatthalung 930598 vs Yasothon).
  const areas = abolishedByName(name, 'subdistrict').filter(
    (a) => (a.parent_code === null || !currentDistricts.has(a.parent_code)) && !a.successors.some((c) => currentCodes.has(c)),
  )
  const successors = unique(areas.flatMap((a) => a.successors))
    .filter((code) => !currentCodes.has(code))
    .map((code) => resolvedByCode(code))
    .filter((a): a is ResolvedAddress => a !== undefined)
  if (areas.length === 0) return false

  const written = n.postalCode
  const postal = has(written) && /^\d{5}$/.test(written) && isPostalCodeInUse(written) ? written : undefined
  if (has(written) && postal === undefined) return false // malformed or unused: validate's finding stands
  const currentAddrs = current.map((x) => resolvedOf(x))
  if (postal !== undefined && currentAddrs.some((a) => a.postalCodes.includes(postal))) return false // (a)

  // Undo what validate concluded from the current homonym alone: its fill and its postal verdict.
  const kept: Partial<Record<Field, string>> = {}
  for (const f of ['province', 'district', 'subdistrict', 'postalCode'] as const) if (n[f] !== undefined) kept[f] = n[f]
  ctx.output = kept
  ctx.suggestions = ctx.suggestions.filter((x) => x.reason !== 'MISSING_FIELD' && x.field !== 'postalCode')
  ctx.findings = ctx.findings.filter((f) => !['MISSING_FIELD', 'POSTAL_CODE_MISMATCH', 'AMBIGUOUS'].includes(f.code))

  if (successors.length === 0) {
    noSuccessor(ctx, name, areas, currentAddrs, postal)
    return true
  }

  const using = postal === undefined ? successors : successors.filter((a) => a.postalCodes.includes(postal))
  const candidates = postal === undefined ? [...currentAddrs, ...successors] : using
  const basis = effectiveBasis(areas)
  const first = areas[0]!
  const where = unique(areas.map((a) => provinceByCode(a.code.slice(0, 2))?.name_th ?? a.code.slice(0, 2))).join(', ')
  const now = successors.map(place).join(', ')
  const homonyms = currentAddrs.map(place).join(', ')

  if (postal !== undefined && using.length === 0) {
    // (d) Neither side uses the code: say so with the codes of both, so the reader sees both places.
    const expected = unique([...currentAddrs, ...successors].flatMap((a) => a.postalCodes)).sort()
    ctx.findings.push({
      code: 'POSTAL_CODE_MISMATCH',
      severity: 'error',
      fields: ['postalCode', 'subdistrict'],
      message: {
        th: `${LABEL_TH.postalCode} ${postal} ไม่ตรงกับ${LABEL_TH.subdistrict} "${name}" ที่ใดเลย (ปัจจุบัน ${homonyms} และพื้นที่ที่มาแทน "${name}" เดิมใน ${where} ใช้ ${expected.join(', ')})`,
        en: `Postal code ${postal} belongs to no place named "${name}" (the current ${homonyms} and the areas that replaced the old "${name}" in ${where} use ${expected.join(', ')}).`,
      },
      detail: { given: postal, against: { field: 'subdistrict', value: name, unanchored: true }, expected, expectedTotal: expected.length },
    })
  }

  const several = candidates.length > 1
  ctx.findings.push({
    code: 'ABOLISHED_AREA',
    severity: several ? 'warning' : 'error',
    fields: ['subdistrict'],
    message: {
      th:
        `"${name}" เป็นชื่อของพื้นที่ที่ถูกยุบใน ${where} ด้วย (เมื่อ ${first.abolished_on}) ปัจจุบันแทนด้วย ${now} ` +
        (postal !== undefined && using.length > 0
          ? `และ${LABEL_TH.postalCode} ${postal} เป็นของพื้นที่ที่มาแทน จึงไม่ถือว่าเป็น ${homonyms}`
          : `ไม่มี${LABEL_TH.province}หรือ${LABEL_TH.district} จึงไม่สรุปว่าเป็น ${homonyms}`) +
        ' ไม่แก้ให้อัตโนมัติ',
      en:
        `"${name}" also names an abolished area in ${where} (abolished ${first.abolished_on}); it is now ${now}. ` +
        (postal !== undefined && using.length > 0
          ? `Postal code ${postal} belongs to the areas that replaced it, so this is not taken as ${homonyms}.`
          : `With no province or district, it is not assumed to be ${homonyms}.`) +
        ' Nothing is corrected automatically.',
    },
    detail: {
      given: name,
      level: 'subdistrict',
      unanchored: true,
      abolished: areas.map(areaDetail),
      basis,
      successors: successors.map((a) => ({ code: a.subdistrictCode, th: a.subdistrict.th, en: a.subdistrict.en, district: a.district.th, province: a.province.th, postalCodes: a.postalCodes })),
      current: currentAddrs.map((a) => ({ code: a.subdistrictCode, district: a.district.th, province: a.province.th, postalCodes: a.postalCodes })),
      applied: false,
    },
  })

  if (several && (postal === undefined || using.length > 0)) {
    const needs: Field[] = ['province', 'district', ...(postal === undefined ? (['postalCode'] as Field[]) : [])]
    ctx.findings.push({
      code: 'AMBIGUOUS',
      severity: 'error',
      fields: needs,
      message: {
        th: `มี ${candidates.length} ที่อยู่ที่ตรงกับข้อมูลนี้ ต้องระบุเพิ่ม: ${needs.map((f) => LABEL_TH[f]).join(', ')}`,
        en: `${candidates.length} addresses fit this input; add: ${needs.map((f) => (f === 'postalCode' ? 'postal code' : f)).join(', ')}.`,
      },
      detail: {
        count: candidates.length,
        needs,
        options: candidates.slice(0, 10).map((a) => ({ province: a.province.th, district: a.district.th, subdistrict: a.subdistrict.th, postalCodes: a.postalCodes })),
        optionsTotal: candidates.length,
      },
    })
  }
  ctx.candidates = several && (postal === undefined || using.length > 0) ? candidates : []

  // Suggestions only: where each candidate is, never applied.
  const perField = new Map<Field, number>()
  for (const x of ctx.suggestions) perField.set(x.field, (perField.get(x.field) ?? 0) + 1)
  const pool = postal !== undefined && using.length === 0 ? [...currentAddrs, ...successors] : candidates
  for (const addr of pool) {
    for (const field of ['province', 'district'] as const) {
      const k = perField.get(field) ?? 0
      if (k >= ctx.options.maxSuggestions) continue
      perField.set(field, k + 1)
      ctx.suggestions.push({
        field,
        from: undefined,
        to: officialName(field, addr),
        confidence: CONFIDENCE_AMBIGUOUS,
        reason: currentCodes.has(addr.subdistrictCode) ? 'AMBIGUOUS' : 'ABOLISHED_AREA',
        resolved: addr,
      })
    }
  }
  return true
}

/**
 * Reports names or codes that belong to abolished areas (ABOLISHED_AREA) with their successors
 * and the evidence basis, and corrects only on a gazette-notice basis with exactly one successor.
 * Does nothing when `ctx.candidates` already holds a current address, or when the name is current
 * under the given parent.
 */
export function checkAbolished(ctx: CheckContext): void {
  if (checkUnanchoredHomonym(ctx)) return
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
