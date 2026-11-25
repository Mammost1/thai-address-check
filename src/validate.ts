/**
 * Features 1 and 6: resolve the address to current areas and report what does not fit.
 *
 * Exact names only (after `normalize()`); fuzzy matching belongs to `suggest.ts`. Everything is
 * resolved through the indexes of `data.ts`, never through core's `match()` (docs/TASKS.md A1-A3).
 *
 * How it decides, in order:
 * 1. Each given name must name a current area at its level (UNKNOWN_NAME otherwise) and the
 *    postal code must be 5 digits used by some subdistrict (POSTAL_CODE_INVALID otherwise).
 * 2. The names that were found must agree with each other: district inside province, subdistrict
 *    inside district (and inside province when no district is given). Every broken link is its own
 *    PARENT_MISMATCH, so one address can report several problems (A2). A name can repeat
 *    (795 subdistrict names, 2 district names), so the links are tested on whole sets and a final
 *    joint test catches a combination no single area satisfies.
 * 3. The postal code must be used by an address that fits the names (POSTAL_CODE_MISMATCH with the
 *    codes that would fit). It is tested jointly with the names whenever they agree, so a repeated
 *    subdistrict name elsewhere cannot hide a wrong code.
 * 4. When nothing is wrong, the addresses that fit are the candidates. One candidate fills the
 *    fields the caller left out (feature 6); several candidates are AMBIGUOUS; no subdistrict and no
 *    postal code means there is nothing to resolve from (MISSING_FIELD).
 *
 * Complexity: each step reads an index (name, postal code or parent) and filters a list of at most
 * a few dozen subdistricts (the largest postal code is shared by 33, the most repeated name by
 * 28); the widest scan is the subdistricts of one district.
 */
import {
  districtsByName,
  districtsOf,
  isPostalCodeInUse,
  provinceByCode,
  provincesByName,
  resolvedOf,
  subdistrictsByName,
  subdistrictsByPostalCode,
  subdistrictsOf,
  type District,
  type Level,
  type Province,
  type Subdistrict,
} from './data'
import { LABEL_EN, LABEL_TH } from './labels'
import type { CheckContext, Field, Finding, ResolvedAddress, Severity, Suggestion } from './types'

/** How many options a finding lists before it only reports the total. */
const LIST_CAP = 10
const POSTAL_LIST_CAP = 30

/** What one field of the address holds after name resolution. */
interface Resolved {
  province: { given: string; found: Province[] } | undefined
  district: { given: string; found: District[] } | undefined
  subdistrict: { given: string; found: Subdistrict[] } | undefined
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

function finding(
  code: Finding['code'],
  severity: Severity,
  fields: Field[],
  th: string,
  en: string,
  detail: Record<string, unknown>,
): Finding {
  return { code, severity, fields, message: { th, en }, detail }
}

function unique<T>(list: readonly T[]): T[] {
  return [...new Set(list)]
}

function capped<T>(list: readonly T[], cap: number): { list: T[]; total: number } {
  return { list: list.slice(0, cap), total: list.length }
}

/** The address of a subdistrict as plain names, for the `detail` of a finding. */
function summary(r: ResolvedAddress): { province: string; district: string; subdistrict: string; postalCodes: string[] } {
  return { province: r.province.th, district: r.district.th, subdistrict: r.subdistrict.th, postalCodes: r.postalCodes }
}

function subdistrictsOfDistricts(districts: readonly District[]): Subdistrict[] {
  return districts.flatMap((d) => subdistrictsOf(d.code))
}

function resolveNames(ctx: CheckContext): { names: Resolved; findings: Finding[] } {
  const names: Resolved = { province: undefined, district: undefined, subdistrict: undefined }
  const findings: Finding[] = []
  const lookup: Record<Level, (name: string) => (Province | District | Subdistrict)[]> = {
    province: (n) => provincesByName(n),
    district: (n) => districtsByName(n),
    subdistrict: (n) => subdistrictsByName(n),
  }
  for (const level of ['province', 'district', 'subdistrict'] as const) {
    const given = present(ctx.output[level])
    if (given === undefined) continue
    const found = lookup[level](given)
    if (found.length === 0) {
      findings.push(
        finding(
          'UNKNOWN_NAME',
          'error',
          [level],
          `ไม่พบ${LABEL_TH[level]}ชื่อ "${given}" ในข้อมูลปัจจุบัน`,
          `No current ${LABEL_EN[level]} is named "${given}".`,
          { given, level },
        ),
      )
      continue
    }
    // The three lookups return different record types; each branch stores its own.
    if (level === 'province') names.province = { given, found: found as Province[] }
    else if (level === 'district') names.district = { given, found: found as District[] }
    else names.subdistrict = { given, found: found as Subdistrict[] }
  }
  return { names, findings }
}

/** True when the subdistrict is consistent with every name that was found. */
function fitsNames(s: Subdistrict, names: Resolved): boolean {
  if (names.province && !names.province.found.some((p) => p.code === s.province_code)) return false
  if (names.district && !names.district.found.some((d) => d.code === s.district_code)) return false
  if (names.subdistrict && !names.subdistrict.found.some((x) => x.code === s.code)) return false
  return true
}

/** One PARENT_MISMATCH per broken link between two found names (A2: report all, not the first). */
function parentFindings(names: Resolved): Finding[] {
  const found: Finding[] = []
  const { province, district, subdistrict } = names

  if (province && district && !district.found.some((d) => province.found.some((p) => p.code === d.province_code))) {
    const where = unique(district.found.map((d) => provinceByCode(d.province_code)?.name_th ?? d.province_code))
    found.push(
      finding(
        'PARENT_MISMATCH',
        'error',
        ['district', 'province'],
        `${LABEL_TH.district} "${district.given}" ไม่อยู่ใน${LABEL_TH.province} "${province.given}"` +
          ` (อยู่ใน ${where.join(', ')})`,
        `District "${district.given}" is not in province "${province.given}" (it is in ${where.join(', ')}).`,
        { given: { district: district.given, province: province.given }, expected: { province: where } },
      ),
    )
  }

  if (district && subdistrict && !subdistrict.found.some((s) => district.found.some((d) => d.code === s.district_code))) {
    const homes = capped(subdistrict.found.map((s) => summary(resolvedOf(s))), LIST_CAP)
    found.push(
      finding(
        'PARENT_MISMATCH',
        'error',
        ['subdistrict', 'district'],
        `${LABEL_TH.subdistrict} "${subdistrict.given}" ไม่อยู่ใน${LABEL_TH.district} "${district.given}"`,
        `Subdistrict "${subdistrict.given}" is not in district "${district.given}".`,
        {
          given: { subdistrict: subdistrict.given, district: district.given },
          expected: homes.list,
          expectedTotal: homes.total,
        },
      ),
    )
  }

  // With a district given, the district link above already says where the subdistrict lives.
  if (province && subdistrict && !district && !subdistrict.found.some((s) => province.found.some((p) => p.code === s.province_code))) {
    const homes = capped(subdistrict.found.map((s) => summary(resolvedOf(s))), LIST_CAP)
    found.push(
      finding(
        'PARENT_MISMATCH',
        'error',
        ['subdistrict', 'province'],
        `${LABEL_TH.subdistrict} "${subdistrict.given}" ไม่อยู่ใน${LABEL_TH.province} "${province.given}"`,
        `Subdistrict "${subdistrict.given}" is not in province "${province.given}".`,
        {
          given: { subdistrict: subdistrict.given, province: province.given },
          expected: homes.list,
          expectedTotal: homes.total,
        },
      ),
    )
  }
  return found
}

/** The lowest hierarchy level that was found, the one a postal code is judged against. */
function lowestLevel(names: Resolved): Level | undefined {
  if (names.subdistrict) return 'subdistrict'
  if (names.district) return 'district'
  if (names.province) return 'province'
  return undefined
}

function givenOf(names: Resolved, level: Level): string {
  return (names[level] as { given: string }).given
}

/** The names each exist but no single area has them all (repeated names in different places). */
function noSingleArea(names: Resolved): Finding {
  const fields = (['province', 'district', 'subdistrict'] as const).filter((f) => names[f])
  return finding(
    'PARENT_MISMATCH',
    'error',
    [...fields],
    `${fields.map((f) => `${LABEL_TH[f]} "${givenOf(names, f)}"`).join(' / ')} ไม่อยู่ในพื้นที่เดียวกัน`,
    `${fields.map((f) => `${LABEL_EN[f]} "${givenOf(names, f)}"`).join(' / ')} do not belong to one area.`,
    { given: Object.fromEntries(fields.map((f) => [f, givenOf(names, f)])), reason: 'no-single-area' },
  )
}

function postalMismatch(level: Level, names: Resolved, postalCode: string, expected: string[] | undefined): Finding {
  const given = givenOf(names, level)
  const list = expected === undefined ? undefined : capped(expected, POSTAL_LIST_CAP)
  const shown = list === undefined ? '' : list.total === list.list.length ? ` (ใช้ ${list.list.join(', ')})` : ` (เช่น ${list.list.join(', ')})`
  const shownEn = list === undefined ? '' : ` (it uses ${list.list.join(', ')}${list.total > list.list.length ? ', …' : ''})`
  return finding(
    'POSTAL_CODE_MISMATCH',
    'error',
    ['postalCode', level],
    `${LABEL_TH.postalCode} ${postalCode} ไม่ตรงกับ${LABEL_TH[level]} "${given}"${shown}`,
    `Postal code ${postalCode} does not belong to ${LABEL_EN[level]} "${given}"${shownEn}.`,
    {
      given: postalCode,
      against: { field: level, value: given },
      ...(list === undefined ? {} : { expected: list.list, expectedTotal: list.total }),
    },
  )
}

/**
 * Checks the postal code against the names. `hierarchy` is the list of subdistricts that fit the
 * names, or undefined when only a province (or nothing) was given and the list would be huge.
 */
function postalFindings(names: Resolved, postalCode: string, hierarchy: Subdistrict[] | undefined): Finding[] {
  const level = lowestLevel(names)
  if (level === undefined) return [] // only a postal code: nothing to disagree with
  const uses = (s: Subdistrict) => s.postal_codes.includes(postalCode)

  if (hierarchy !== undefined && hierarchy.length > 0) {
    if (hierarchy.some(uses)) return []
    const lowest: Level = level === 'subdistrict' ? 'subdistrict' : 'district'
    return [postalMismatch(lowest, names, postalCode, unique(hierarchy.flatMap((s) => s.postal_codes)).sort())]
  }

  // The names disagree with each other, so judge the code against the lowest name on its own. No
  // address fits every settled parent, so no code is suggested: the codes of a same-name area in
  // another province or district would point the caller at the wrong place (บางนา in เขตบางนา is
  // not บางนา of Ayutthaya, whose code is 13150).
  if (level === 'province') {
    const inProvince = subdistrictsByPostalCode(postalCode).some((s) => fitsNames(s, names))
    return inProvince ? [] : [postalMismatch('province', names, postalCode, undefined)]
  }
  const own = level === 'subdistrict' ? names.subdistrict?.found ?? [] : subdistrictsOfDistricts(names.district?.found ?? [])
  if (own.some(uses)) return []
  return [postalMismatch(level, names, postalCode, undefined)]
}

function postalInvalid(given: string, reason: 'format' | 'not-in-use', expected: string[] | undefined): Finding {
  const why =
    reason === 'format'
      ? { th: 'ต้องเป็นตัวเลข 5 หลัก', en: 'it must be exactly 5 digits' }
      : { th: 'ไม่มีตำบลไหนใช้รหัสนี้', en: 'no subdistrict uses this code' }
  const hint =
    expected && expected.length > 0
      ? { th: ` (ที่อยู่นี้ใช้ ${expected.join(', ')})`, en: ` (this address uses ${expected.join(', ')})` }
      : { th: '', en: '' }
  return finding(
    'POSTAL_CODE_INVALID',
    'error',
    ['postalCode'],
    `${LABEL_TH.postalCode} "${given}" ใช้ไม่ได้: ${why.th}${hint.th}`,
    `Postal code "${given}" is invalid: ${why.en}${hint.en}.`,
    { given, reason, ...(expected && expected.length > 0 ? { expected } : {}) },
  )
}

/** Which fields the candidates disagree on, i.e. what the caller can add to settle on one. */
function differingFields(candidates: ResolvedAddress[]): Field[] {
  const differs = (key: (r: ResolvedAddress) => string): boolean => new Set(candidates.map(key)).size > 1
  const out: Field[] = []
  // By name, not code: two subdistricts called 'บางมด' differ in code, but writing the name again
  // would not tell them apart, so 'subdistrict' is not something the caller can add.
  if (differs((r) => r.province.th)) out.push('province')
  if (differs((r) => r.district.th)) out.push('district')
  if (differs((r) => r.subdistrict.th)) out.push('subdistrict')
  if (differs((r) => r.postalCodes.join(','))) out.push('postalCode')
  return out
}

function ambiguous(candidates: ResolvedAddress[]): Finding {
  const options = capped(candidates.map(summary), LIST_CAP)
  const needs = differingFields(candidates)
  const needsTh = needs.map((f) => LABEL_TH[f]).join(', ')
  const needsEn = needs.map((f) => LABEL_EN[f]).join(', ')
  return finding(
    'AMBIGUOUS',
    'error',
    needs.length > 0 ? needs : ['subdistrict'],
    `มี ${candidates.length} ที่อยู่ที่ตรงกับข้อมูลนี้ ต้องระบุเพิ่ม: ${needsTh}`,
    `${candidates.length} addresses fit this input; add: ${needsEn}.`,
    { count: candidates.length, needs, options: options.list, optionsTotal: options.total },
  )
}

function missingAnchor(): Finding {
  return finding(
    'MISSING_FIELD',
    'error',
    ['subdistrict', 'postalCode'],
    'ข้อมูลไม่พอจะหาที่อยู่: ต้องมีอย่างน้อยตำบล/แขวง หรือรหัสไปรษณีย์',
    'Not enough to find an address: give at least the subdistrict or the postal code.',
    { needsOneOf: ['subdistrict', 'postalCode'] },
  )
}

/** A name field the caller left out, taken from the one address that fits (feature 6). */
function filledName(field: Level, c: ResolvedAddress): string {
  const name = c[field].th
  if (field !== 'district' || !name.startsWith('เขต')) return name
  // Bangkok districts are stored as 'เขตพระนคร'; write them the way normalize() does.
  const bare = name.slice('เขต'.length)
  return districtsByName(bare).some((d) => d.name_th === name) ? bare : name
}

/** Fills the fields the caller left out when exactly one address fits; reports each fill. */
function fillMissing(ctx: CheckContext, c: ResolvedAddress): void {
  const fills: { field: Field; to: string }[] = []
  for (const field of ['province', 'district', 'subdistrict'] as const) {
    if (present(ctx.output[field]) === undefined) fills.push({ field, to: filledName(field, c) })
  }
  const onlyCode = c.postalCodes.length === 1 ? c.postalCodes[0] : undefined
  if (present(ctx.output.postalCode) === undefined) {
    if (onlyCode !== undefined) fills.push({ field: 'postalCode', to: onlyCode })
    else {
      // Several codes serve this subdistrict: none can be picked, and the address still resolves.
      ctx.findings.push(
        finding(
          'MISSING_FIELD',
          'info',
          ['postalCode'],
          `ไม่ได้ระบุ${LABEL_TH.postalCode} ตำบลนี้ใช้ได้หลายรหัส: ${c.postalCodes.join(', ')}`,
          `No postal code given; this subdistrict uses several: ${c.postalCodes.join(', ')}.`,
          { options: c.postalCodes },
        ),
      )
    }
  }

  const apply = ctx.options.autoCorrect && 1 >= ctx.options.autoCorrectThreshold
  if (fills.length > 0) {
    const filled: Record<string, string> = {}
    for (const f of fills) filled[f.field] = f.to
    const fields = fills.map((f) => f.field)
    ctx.findings.push(
      finding(
        'MISSING_FIELD',
        apply ? 'info' : 'warning',
        fields,
        `ไม่ได้ระบุ ${fields.map((f) => LABEL_TH[f]).join(', ')} ${apply ? 'เติมให้จากที่อยู่เดียวที่ตรงกัน' : 'พบว่ามีที่อยู่เดียวที่ตรงกัน (ยังไม่ได้เติม)'}`,
        `Missing ${fields.map((f) => LABEL_EN[f]).join(', ')}; ${apply ? 'filled from the only address that fits' : 'exactly one address fits (not applied)'}.`,
        { filled, applied: apply, resolved: summary(c) },
      ),
    )
    for (const f of fills) {
      const suggestion: Suggestion = {
        field: f.field,
        from: undefined,
        to: f.to,
        confidence: 1,
        reason: 'MISSING_FIELD',
        resolved: c,
      }
      // An applied fill is always listed (the contract); an unapplied one respects maxSuggestions.
      if (apply || ctx.options.maxSuggestions > 0) ctx.suggestions.push(suggestion)
      if (apply) ctx.output[f.field] = f.to
    }
  }
  ctx.candidates = [c]
}

/**
 * Resolves `ctx.output` against the dataset (exact names only), fills `ctx.candidates`, fills a
 * missing field when exactly one address fits, and adds MISSING_FIELD, UNKNOWN_NAME,
 * PARENT_MISMATCH, POSTAL_CODE_INVALID, POSTAL_CODE_MISMATCH and AMBIGUOUS findings.
 *
 * `ctx.candidates` holds every current address that fits `ctx.output` and is left empty whenever
 * an error was found. A missing field is filled (and listed as an applied Suggestion) only when
 * `ctx.options.autoCorrect` is on and exactly one address fits; with it off the fill is reported
 * as a warning and `ctx.output` is untouched.
 *
 * @param ctx - The working state of one `check()`; read for `output` and `options`, extended with findings.
 */
export function validate(ctx: CheckContext): void {
  const { names, findings } = resolveNames(ctx)
  const postal = present(ctx.output.postalCode)

  // Names must agree with each other.
  const links = parentFindings(names)
  findings.push(...links)

  // The subdistricts that fit the names; undefined when only a province (or nothing) was given.
  let hierarchy: Subdistrict[] | undefined
  if (names.subdistrict) hierarchy = names.subdistrict.found.filter((s) => fitsNames(s, names))
  else if (names.district) hierarchy = subdistrictsOfDistricts(names.district.found).filter((s) => fitsNames(s, names))
  if (links.length === 0 && hierarchy !== undefined && hierarchy.length === 0) findings.push(noSingleArea(names))

  // The postal code: its shape, then its fit with the names.
  let postalOk = false
  if (postal !== undefined) {
    if (!/^\d{5}$/.test(postal)) findings.push(postalInvalid(postal, 'format', undefined))
    else if (!isPostalCodeInUse(postal)) {
      // Tell the caller which codes the (otherwise consistent) address does use.
      const fitting = links.length === 0 && hierarchy ? unique(hierarchy.flatMap((s) => s.postal_codes)).sort() : []
      findings.push(postalInvalid(postal, 'not-in-use', fitting.length <= POSTAL_LIST_CAP ? fitting : undefined))
    } else {
      postalOk = true
      findings.push(...postalFindings(names, postal, hierarchy))
    }
  }

  // Without a subdistrict or a usable postal code there is nothing to resolve from.
  const anchored = present(ctx.output.subdistrict) !== undefined || postalOk
  if (!anchored) findings.push(missingAnchor())

  ctx.findings.push(...findings)
  ctx.candidates = []
  if (findings.some((f) => f.severity === 'error')) return

  // Nothing is wrong: the addresses that fit are the candidates.
  let fit: Subdistrict[] = []
  if (hierarchy !== undefined) {
    fit = postalOk && postal !== undefined ? hierarchy.filter((s) => s.postal_codes.includes(postal)) : hierarchy
  } else if (postalOk && postal !== undefined) {
    fit = subdistrictsByPostalCode(postal).filter((s) => fitsNames(s, names))
  }
  const candidates = fit.map(resolvedOf)
  const only = candidates.length === 1 ? candidates[0] : undefined
  if (only) fillMissing(ctx, only)
  else if (candidates.length > 1) {
    ctx.candidates = candidates
    ctx.findings.push(ambiguous(candidates))
  }
}
