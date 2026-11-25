/**
 * Ranked suggestions and the auto-correct decision (features 2 and 3).
 *
 * For each name field that matches no current area (and is not an abolished name, which
 * `abolished.ts` explains), the closest names at that level are scored by `fuzzy.ts` and weighed
 * by how well they fit the other fields: a candidate consistent with the given postal code,
 * parent or child outranks a closer string elsewhere. Fields are handled top-down (province,
 * district, subdistrict) so a corrected parent narrows the level below it.
 *
 * Global constraint 9: a correction is applied only when its confidence reaches
 * `autoCorrectThreshold` AND exactly one candidate does. Everything else stays a suggestion.
 *
 * Interface with validate.ts (which runs first): when this step emits MISSPELLED_NAME for a field,
 * it removes validate's UNKNOWN_NAME finding for that same single field, since MISSPELLED_NAME is
 * the more specific explanation. After applying a correction it recomputes `ctx.candidates` for
 * the corrected address.
 *
 * Complexity: one fuzzy pass over the areas of a level, narrowed to the children of a settled
 * parent or the areas of a settled postal code when one is given; worst case (subdistrict with no
 * usable context) 7,436 length-filtered comparisons of O(n·m) each.
 */
import {
  abolishedAreas,
  abolishedByName,
  allDistricts,
  allProvinces,
  allSubdistricts,
  districtsByName,
  districtsOf,
  englishKey,
  hasThai,
  isKnownName,
  isPostalCodeInUse,
  provincesByName,
  resolvedOf,
  subdistrictsByName,
  subdistrictsByPostalCode,
  subdistrictsOf,
  type Area,
  type Level,
  type Subdistrict,
} from './data'
import { comparable, similarityAtLeast } from './fuzzy'
import type { CheckContext, Field, Finding, ResolvedAddress, Suggestion } from './types'

/** Names less similar than this are not suggested at all. */
export const MIN_SIMILARITY = 0.7
/** Weight of a candidate when no other field can confirm or contradict it. */
export const NO_CONTEXT_FIT = 0.9
/** Weight of a candidate that any settled field (parent, child or postal code) contradicts. */
export const CONTRADICTS_FIT = 0.5
/**
 * A correction is applied only when the best candidate is at least this far ahead of the runner-up.
 * Without it, a name one character from two real names is "corrected" to whichever scores 0.9 while
 * the other scores 0.83 (ท่าวัก -> ท่าซัก, though ท่าวัง is as close): both are plausible, so the caller
 * decides. Measured on every one-character typo (delete, swap, substitute) of the 7,436 subdistrict
 * names: it removes 7 of the 9 wrong corrections for 0.5% of the right ones, which become suggestions
 * (docs/TASKS.md A12). The remaining 2 are names whose closest real name is unique but not the intended one.
 */
export const AUTOCORRECT_MARGIN = 0.15
/**
 * Confidence of a postal-code suggestion. Kept below the default threshold on purpose: when the
 * names and the postal code disagree, either side may be the wrong one, so it is never rewritten
 * silently (PLAN.md, positioning against thai-address-sdk).
 */
export const POSTAL_CONFIDENCE = 0.85

const LEVELS: readonly Level[] = ['province', 'district', 'subdistrict']

/** Fields known to name a current area (exactly, or after a correction made in this step). */
interface Settled {
  provinceCodes?: Set<string>
  districtCodes?: Set<string>
  subdistrictCodes?: Set<string>
  /** Subdistricts using the given postal code, when that code is in use. */
  postal?: Subdistrict[]
}

interface Scored {
  area: Area
  similarity: number
  confidence: number
}

function codes(list: readonly Area[]): Set<string> | undefined {
  return list.length > 0 ? new Set(list.map((a) => a.code)) : undefined
}

/**
 * The fields that can confirm or contradict a candidate. An abolished name is left out even when
 * a current area elsewhere shares it (บางนา): it names an area that no longer exists, so it is not
 * evidence about the current one.
 */
function settle(output: CheckContext['output']): Settled {
  const s: Settled = {}
  if (output.province) s.provinceCodes = codes(provincesByName(output.province))
  if (output.district && !isAbolishedName('district', output.district))
    s.districtCodes = codes(districtsByName(output.district))
  if (output.subdistrict && !isAbolishedName('subdistrict', output.subdistrict))
    s.subdistrictCodes = codes(subdistrictsByName(output.subdistrict))
  if (output.postalCode && isPostalCodeInUse(output.postalCode)) s.postal = subdistrictsByPostalCode(output.postalCode)
  return s
}

/** Names an area is compared by: the official name and, for Bangkok districts, without 'เขต'. */
function namesOf(area: Area, thai: boolean): string[] {
  if (!thai) return area.name_en ? [area.name_en] : []
  return area.name_th.startsWith('เขต') && 'province_code' in area && !('district_code' in area)
    ? [area.name_th, area.name_th.slice(3)]
    : [area.name_th]
}

const preparedTh = new WeakMap<Area, string[]>()
const preparedEn = new WeakMap<Area, string[]>()

/** `namesOf` already split by `comparable`, computed once per area. */
function prepared(area: Area, thai: boolean): string[] {
  const cache = thai ? preparedTh : preparedEn
  let names = cache.get(area)
  if (!names) {
    names = namesOf(area, thai).map(comparable)
    cache.set(area, names)
  }
  return names
}

function provinceOf(area: Area): string {
  return 'province_code' in area ? area.province_code : area.code
}

/**
 * Checks one candidate against every settled field other than its own level.
 * Returns how many settled fields confirm it and how many were checked.
 */
function fit(level: Level, area: Area, s: Settled): { confirmed: number; checked: number } {
  let confirmed = 0
  let checked = 0
  const check = (ok: boolean) => {
    checked++
    if (ok) confirmed++
  }
  if (level !== 'province' && s.provinceCodes) check(s.provinceCodes.has(provinceOf(area)))
  if (level === 'province') {
    if (s.districtCodes) check([...s.districtCodes].some((d) => d.startsWith(area.code)))
    if (s.subdistrictCodes) check([...s.subdistrictCodes].some((c) => c.startsWith(area.code)))
    if (s.postal) check(s.postal.some((x) => x.province_code === area.code))
  } else if (level === 'district') {
    if (s.subdistrictCodes) check([...s.subdistrictCodes].some((c) => c.startsWith(area.code)))
    if (s.postal) check(s.postal.some((x) => x.district_code === area.code))
  } else {
    const sub = area as Subdistrict
    if (s.districtCodes) check(s.districtCodes.has(sub.district_code))
    if (s.postal) check(sub.postal_codes.some((p) => s.postal?.some((x) => x.postal_codes.includes(p)) ?? false))
  }
  return { confirmed, checked }
}

/**
 * Weight of a candidate's fit: full when every settled field agrees with it, `NO_CONTEXT_FIT`
 * when there is nothing to check, `CONTRADICTS_FIT` as soon as any settled field disagrees
 * (a correction that leaves the address contradicting itself is never applied).
 */
function fitWeight(f: { confirmed: number; checked: number }): number {
  if (f.checked === 0) return NO_CONTEXT_FIT
  return f.confirmed === f.checked ? 1 : CONTRADICTS_FIT
}

/** The areas worth comparing at a level: narrowed by a settled parent or postal code when possible. */
function pool(level: Level, s: Settled): readonly Area[] {
  if (level === 'province') return allProvinces()
  if (level === 'district') {
    if (s.provinceCodes) return [...s.provinceCodes].flatMap((p) => districtsOf(p))
    return allDistricts()
  }
  if (s.districtCodes) return [...s.districtCodes].flatMap((d) => subdistrictsOf(d))
  if (s.postal) return s.postal
  if (s.provinceCodes) {
    const provinces = s.provinceCodes
    return allSubdistricts().filter((x) => provinces.has(x.province_code))
  }
  return allSubdistricts()
}

function score(level: Level, given: string, s: Settled): Scored[] {
  const thai = hasThai(given)
  const target = comparable(given)
  const out: Scored[] = []
  const seen = new Set<string>()
  const consider = (area: Area) => {
    if (seen.has(area.code)) return
    let best = 0
    for (const name of prepared(area, thai)) best = Math.max(best, similarityAtLeast(target, name, MIN_SIMILARITY))
    if (best === 0) return
    seen.add(area.code)
    const weight = fitWeight(fit(level, area, s))
    out.push({ area, similarity: best, confidence: round(best * weight) })
  }
  const narrowed = pool(level, s)
  for (const area of narrowed) consider(area)
  // A settled parent can itself be the wrong field: also look everywhere, at the contradicting weight.
  if (out.length === 0 && narrowed.length !== poolSize(level)) for (const area of pool(level, {})) consider(area)
  return out.sort((a, b) => b.confidence - a.confidence || b.similarity - a.similarity || (a.area.code < b.area.code ? -1 : 1))
}

function poolSize(level: Level): number {
  return level === 'province' ? allProvinces().length : level === 'district' ? allDistricts().length : allSubdistricts().length
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000
}

/** The full current address of a candidate, when it pins down exactly one subdistrict. */
function resolvedFor(level: Level, area: Area, s: Settled): ResolvedAddress | undefined {
  if (level === 'subdistrict') return resolvedOf(area as Subdistrict)
  if (level === 'district' && s.subdistrictCodes) {
    const inside = [...s.subdistrictCodes].filter((c) => c.startsWith(area.code))
    if (inside.length === 1) {
      const sub = subdistrictsOf(area.code).find((x) => x.code === inside[0])
      return sub ? resolvedOf(sub) : undefined
    }
  }
  return undefined
}

function officialName(area: Area, thai: boolean): string {
  return thai || !area.name_en ? area.name_th : area.name_en
}

function levelLabel(level: Level): { th: string; en: string } {
  if (level === 'province') return { th: 'จังหวัด', en: 'province' }
  if (level === 'district') return { th: 'อำเภอ/เขต', en: 'district' }
  return { th: 'ตำบล/แขวง', en: 'subdistrict' }
}

function misspelled(level: Level, given: string, best: Scored, alternatives: Scored[], applied: boolean, close?: Scored): Finding {
  const label = levelLabel(level)
  const thai = hasThai(given)
  const name = officialName(best.area, thai)
  return {
    code: 'MISSPELLED_NAME',
    severity: applied ? 'warning' : 'error',
    fields: [level],
    message: applied
      ? {
          th: `ไม่พบ${label.th}ชื่อ "${given}" แก้เป็น "${name}" (ความมั่นใจ ${best.confidence})`,
          en: `No ${label.en} is named "${given}"; corrected to "${name}" (confidence ${best.confidence}).`,
        }
      : close
        ? {
            th: `ไม่พบ${label.th}ชื่อ "${given}" ชื่อที่ใกล้ที่สุดคือ "${name}" (ความมั่นใจ ${best.confidence}) แต่ "${officialName(close.area, thai)}" (${close.confidence}) ใกล้พอกัน จึงยังไม่แก้ให้`,
            en: `No ${label.en} is named "${given}"; the closest name is "${name}" (confidence ${best.confidence}) but "${officialName(close.area, thai)}" (${close.confidence}) is nearly as close, so it is not applied.`,
          }
        : {
            th: `ไม่พบ${label.th}ชื่อ "${given}" ชื่อที่ใกล้ที่สุดคือ "${name}" (ความมั่นใจ ${best.confidence}) ยังไม่แก้ให้`,
            en: `No ${label.en} is named "${given}"; the closest name is "${name}" (confidence ${best.confidence}), not applied.`,
          },
    detail: {
      given,
      closest: name,
      code: best.area.code,
      similarity: best.similarity,
      confidence: best.confidence,
      applied,
      ...(close ? { closeRunnerUp: officialName(close.area, thai) } : {}),
      alternatives: alternatives.map((a) => ({ name: officialName(a.area, thai), code: a.area.code, confidence: a.confidence })),
    },
  }
}

let abolishedEnglish: Map<Level, Set<string>> | undefined

/** True when `name` is exactly (after lookup folding) the Thai or English name of an abolished area. */
function isAbolishedName(level: Level, name: string): boolean {
  if (level === 'province') return false
  if (hasThai(name)) return abolishedByName(name, level).length > 0
  if (!abolishedEnglish) {
    abolishedEnglish = new Map()
    for (const a of abolishedAreas()) {
      if (!a.name_en) continue
      let set = abolishedEnglish.get(a.level)
      if (!set) abolishedEnglish.set(a.level, (set = new Set()))
      set.add(englishKey(a.name_en))
    }
  }
  return abolishedEnglish.get(level)?.has(englishKey(name)) ?? false
}

function dropUnknownName(ctx: CheckContext, field: Field): void {
  ctx.findings = ctx.findings.filter(
    (f) => !(f.code === 'UNKNOWN_NAME' && f.fields.length === 1 && f.fields[0] === field),
  )
}

/** Current subdistricts that fit every given field of the output exactly. */
function fitsOutput(output: CheckContext['output']): ResolvedAddress[] {
  if (!output.subdistrict) return []
  const provinces = output.province ? codes(provincesByName(output.province)) : undefined
  const districts = output.district ? codes(districtsByName(output.district)) : undefined
  return subdistrictsByName(output.subdistrict)
    .filter(
      (x) =>
        (!output.province || provinces?.has(x.province_code)) &&
        (!output.district || districts?.has(x.district_code)) &&
        (!output.postalCode || x.postal_codes.includes(output.postalCode)),
    )
    .map(resolvedOf)
}

function handleName(ctx: CheckContext, level: Level): boolean {
  const given = ctx.output[level]
  if (!given || isKnownName(level, given)) return false
  // An exact abolished name is explained by abolished.ts, which knows its official successors;
  // fuzzy matching must not pre-empt it (review ruling ).
  if (isAbolishedName(level, given)) return false

  const s = settle(ctx.output)
  const scored = score(level, given, s)
  if (scored.length === 0) return false

  const { autoCorrect, autoCorrectThreshold, maxSuggestions } = ctx.options
  const thai = hasThai(given)
  const qualifying = scored.filter((c) => c.confidence >= autoCorrectThreshold)
  const best = scored[0] as Scored
  const runnerUp = scored[1]
  const crowded = runnerUp !== undefined && best.confidence - runnerUp.confidence < AUTOCORRECT_MARGIN
  const apply = autoCorrect && qualifying.length === 1 && qualifying[0] === best && !crowded

  for (const c of scored.slice(0, maxSuggestions)) {
    const suggestion: Suggestion = {
      field: level,
      from: given,
      to: officialName(c.area, thai),
      confidence: c.confidence,
      reason: 'MISSPELLED_NAME',
    }
    const resolved = resolvedFor(level, c.area, s)
    if (resolved) suggestion.resolved = resolved
    ctx.suggestions.push(suggestion)
  }

  // MISSPELLED_NAME means "close to exactly one known name": skip it when the top names tie.
  const bestName = officialName(best.area, thai)
  const tied = scored.filter((c) => c.confidence === best.confidence && officialName(c.area, thai) !== bestName)
  if (tied.length === 0 || apply) {
    dropUnknownName(ctx, level)
    ctx.findings.push(
      misspelled(level, given, best, scored.slice(1, maxSuggestions), apply, crowded && qualifying.length === 1 ? runnerUp : undefined),
    )
  }
  if (apply) ctx.output[level] = bestName
  return apply
}

/** Suggests the postal codes of the one subdistrict the names point to, when the given code is not one. */
function suggestPostalCode(ctx: CheckContext): void {
  const { postalCode } = ctx.output
  if (!postalCode || ctx.options.maxSuggestions === 0) return
  const fits = fitsOutput({ ...ctx.output, postalCode: undefined })
  if (fits.length !== 1) return
  const only = fits[0] as ResolvedAddress
  if (only.postalCodes.includes(postalCode)) return
  for (const code of only.postalCodes.slice(0, ctx.options.maxSuggestions)) {
    ctx.suggestions.push({
      field: 'postalCode',
      from: postalCode,
      to: code,
      confidence: POSTAL_CONFIDENCE,
      reason: 'POSTAL_CODE_MISMATCH',
      resolved: only,
    })
  }
}

/**
 * Proposes corrections for names that matched nothing, ranked by similarity and by fit with the
 * other fields, adds MISSPELLED_NAME findings, and applies a correction to `ctx.output` only when
 * its confidence is at least `ctx.options.autoCorrectThreshold` and exactly one candidate
 * qualifies. Also suggests the right postal code when the names point to one subdistrict that
 * does not use the given code (never applied automatically; see `POSTAL_CONFIDENCE`).
 */
export function suggest(ctx: CheckContext): void {
  let corrected = false
  for (const level of LEVELS) if (handleName(ctx, level)) corrected = true
  if (corrected) ctx.candidates = fitsOutput(ctx.output)
  suggestPostalCode(ctx)
}

