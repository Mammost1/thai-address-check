/**
 * The ONLY module that imports @geothai/core (docs/TASKS.md, module layout).
 * It builds the lookup indexes the other modules need once, on first use, and caches them.
 * API facts used here are verified in docs/recon.md (Q2).
 */
import * as core from '@geothai/core'
import { abolishedAreas as coreAbolishedAreas } from '@geothai/core/abolished'
import type { Abolished, Address, District, Province, Subdistrict } from '@geothai/core/types'
import type { ResolvedAddress } from './types'

export type { Abolished, Address, District, Province, Subdistrict }

/** One of the three area levels of the dataset. */
export type Level = 'province' | 'district' | 'subdistrict'

/** Any current area record. */
export type Area = Province | District | Subdistrict

/** The GeoThai data release in use, as `YYYY.M.D` (e.g. '2026.10.23'). */
export const dataVersion: string = core.dataVersion

/**
 * Level prefixes the dataset itself writes into names. Bangkok districts are stored as
 * 'เขตพระนคร'; subdistricts and provinces carry no prefix (docs/recon.md, "ผลกระทบต่อแผน" 5).
 */
const DATA_PREFIX: Record<Level, RegExp | null> = {
  province: null,
  district: /^เขต/,
  subdistrict: null,
}

const INVISIBLE = /[​-‍⁠﻿­]/g

/**
 * The lookup key of a Thai name: NFC, invisible characters and all whitespace removed.
 * Two spellings that differ only in spacing, or in sara am written as ํ + า, share a key;
 * nothing else is folded.
 */
export function thaiKey(name: string): string {
  return name
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\u0E4D([\u0E48-\u0E4B]?)\u0E32/g, '$1\u0E33')
    .replace(/\s+/gu, '')
}

/**
 * The lookup key of an English name: lower case, letters and digits only, so
 * 'Ko Pha-ngan', 'ko phangan' and 'KO PHA NGAN' share one key.
 */
export function englishKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** True when the text contains at least one Thai character. */
export function hasThai(text: string): boolean {
  return /[฀-๿]/.test(text)
}

interface LevelIndex<T extends Area> {
  all: T[]
  byCode: Map<string, T>
  /** Thai key of the full name AND of the name with the dataset's own prefix removed. */
  byThai: Map<string, T[]>
  byEnglish: Map<string, T[]>
}

interface Indexes {
  province: LevelIndex<Province>
  district: LevelIndex<District>
  subdistrict: LevelIndex<Subdistrict>
  /** Parent code (province or district) to its direct children, sorted by code. */
  children: Map<string, (District | Subdistrict)[]>
  byPostalCode: Map<string, Subdistrict[]>
  abolished: Abolished[]
  abolishedByThai: Map<string, Abolished[]>
}

let cache: Indexes | undefined

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) {
    if (!list.includes(value)) list.push(value)
  } else {
    map.set(key, [value])
  }
}

function levelIndex<T extends Area>(level: Level, all: T[]): LevelIndex<T> {
  const idx: LevelIndex<T> = { all, byCode: new Map(), byThai: new Map(), byEnglish: new Map() }
  const prefix = DATA_PREFIX[level]
  for (const area of all) {
    idx.byCode.set(area.code, area)
    push(idx.byThai, thaiKey(area.name_th), area)
    if (prefix && prefix.test(area.name_th)) push(idx.byThai, thaiKey(area.name_th.replace(prefix, '')), area)
    push(idx.byEnglish, englishKey(area.name_en), area)
  }
  return idx
}

function build(): Indexes {
  const provinces = core.provinces()
  const districts = provinces.flatMap((p) => core.districts(p.code))
  const subdistricts = districts.flatMap((d) => core.subdistricts(d.code))

  const children = new Map<string, (District | Subdistrict)[]>()
  for (const d of districts) push(children, d.province_code, d)
  for (const s of subdistricts) push(children, s.district_code, s)

  const byPostalCode = new Map<string, Subdistrict[]>()
  for (const s of subdistricts) for (const code of s.postal_codes) push(byPostalCode, code, s)

  const abolished = coreAbolishedAreas()
  const abolishedByThai = new Map<string, Abolished[]>()
  for (const a of abolished) {
    push(abolishedByThai, thaiKey(a.name_th), a)
    const prefix = DATA_PREFIX[a.level]
    if (prefix && prefix.test(a.name_th)) push(abolishedByThai, thaiKey(a.name_th.replace(prefix, '')), a)
  }

  return {
    province: levelIndex('province', provinces),
    district: levelIndex('district', districts),
    subdistrict: levelIndex('subdistrict', subdistricts),
    children,
    byPostalCode,
    abolished,
    abolishedByThai,
  }
}

function indexes(): Indexes {
  cache ??= build()
  return cache
}

function levelOf(level: 'province'): LevelIndex<Province>
function levelOf(level: 'district'): LevelIndex<District>
function levelOf(level: 'subdistrict'): LevelIndex<Subdistrict>
function levelOf(level: Level): LevelIndex<Area>
function levelOf(level: Level): LevelIndex<Area> {
  return indexes()[level]
}

/** Every current province, sorted by code. */
export function allProvinces(): readonly Province[] {
  return levelOf('province').all
}

/** Every current district, sorted by province then code. */
export function allDistricts(): readonly District[] {
  return levelOf('district').all
}

/** Every current subdistrict, sorted by district then code. */
export function allSubdistricts(): readonly Subdistrict[] {
  return levelOf('subdistrict').all
}

/** The province with this two-digit code, or undefined. */
export function provinceByCode(code: string): Province | undefined {
  return levelOf('province').byCode.get(code)
}

/** The district with this four-digit code, or undefined. */
export function districtByCode(code: string): District | undefined {
  return levelOf('district').byCode.get(code)
}

/** The subdistrict with this six-digit code, or undefined. */
export function subdistrictByCode(code: string): Subdistrict | undefined {
  return levelOf('subdistrict').byCode.get(code)
}

function byName<T extends Area>(idx: LevelIndex<T>, name: string): T[] {
  const list = hasThai(name) ? idx.byThai.get(thaiKey(name)) : idx.byEnglish.get(englishKey(name))
  return list ? [...list] : []
}

/**
 * Provinces whose Thai or English name is exactly `name` (after the key folding of
 * `thaiKey` / `englishKey`). Exact only: no prefixes are removed and no typos tolerated.
 */
export function provincesByName(name: string): Province[] {
  return byName(levelOf('province'), name)
}

/**
 * Districts named exactly `name`, optionally only those in one province.
 * Bangkok districts match with or without their 'เขต' prefix ('เขตพระนคร' and 'พระนคร').
 */
export function districtsByName(name: string, provinceCode?: string): District[] {
  const found = byName(levelOf('district'), name)
  return provinceCode === undefined ? found : found.filter((d) => d.province_code === provinceCode)
}

/**
 * Subdistricts named exactly `name`, optionally narrowed by district and/or province code.
 * Many names repeat across the country (e.g. 'หนองบัว'), so expect several results.
 */
export function subdistrictsByName(
  name: string,
  where: { districtCode?: string; provinceCode?: string } = {},
): Subdistrict[] {
  return byName(levelOf('subdistrict'), name).filter(
    (s) =>
      (where.districtCode === undefined || s.district_code === where.districtCode) &&
      (where.provinceCode === undefined || s.province_code === where.provinceCode),
  )
}

/** True when some current area at `level` has exactly this name (Thai or English). */
export function isKnownName(level: Level, name: string): boolean {
  if (!name.trim()) return false
  return byName(levelOf(level), name).length > 0
}

const exactNames = new Map<Level, Set<string>>()

/**
 * True when `name` is, character for character, the Thai or English name the dataset stores for some
 * current area at `level` (so 'เขตพระนคร' is a district name, 'เขต พระนคร' and 'พระนคร' are not).
 * No key folding: this answers "is this value already the dataset's own spelling".
 */
export function isDatasetName(level: Level, name: string): boolean {
  let names = exactNames.get(level)
  if (!names) {
    names = new Set(levelOf(level).all.flatMap((a) => [a.name_th, a.name_en]))
    exactNames.set(level, names)
  }
  return names.has(name)
}

/** Subdistricts that use this postal code, sorted by code. The code must be exactly 5 digits. */
export function subdistrictsByPostalCode(postalCode: string): Subdistrict[] {
  const list = indexes().byPostalCode.get(postalCode)
  return list ? [...list] : []
}

/** True when at least one current subdistrict uses this postal code. */
export function isPostalCodeInUse(postalCode: string): boolean {
  return indexes().byPostalCode.has(postalCode)
}

/**
 * The direct children of an area: the districts of a province code (2 digits) or the
 * subdistricts of a district code (4 digits). Empty for an unknown code.
 */
export function childrenOf(code: string): (District | Subdistrict)[] {
  const list = indexes().children.get(code)
  return list ? [...list] : []
}

/** The districts of a province, sorted by code. Empty for an unknown province code. */
export function districtsOf(provinceCode: string): District[] {
  return childrenOf(provinceCode).filter((a): a is District => !('district_code' in a))
}

/** The subdistricts of a district, sorted by code. Empty for an unknown district code. */
export function subdistrictsOf(districtCode: string): Subdistrict[] {
  return childrenOf(districtCode).filter((a): a is Subdistrict => 'district_code' in a)
}

/** Converts a dataset subdistrict into the package's `ResolvedAddress` shape. */
export function resolvedOf(s: Subdistrict): ResolvedAddress {
  const d = districtByCode(s.district_code)
  const p = provinceByCode(s.province_code)
  if (!d || !p) throw new Error(`thai-address-check: dataset has no parent for subdistrict ${s.code}`)
  return {
    provinceCode: p.code,
    districtCode: d.code,
    subdistrictCode: s.code,
    province: { th: p.name_th, en: p.name_en },
    district: { th: d.name_th, en: d.name_en },
    subdistrict: { th: s.name_th, en: s.name_en },
    postalCodes: [...s.postal_codes],
  }
}

/** The `ResolvedAddress` of a six-digit subdistrict code, or undefined if no such subdistrict. */
export function resolvedByCode(subdistrictCode: string): ResolvedAddress | undefined {
  const s = subdistrictByCode(subdistrictCode)
  return s ? resolvedOf(s) : undefined
}

/** Every abolished district and subdistrict (from '@geothai/core/abolished'), sorted by code. */
export function abolishedAreas(): readonly Abolished[] {
  return indexes().abolished
}

/**
 * Abolished areas whose Thai name is exactly `name`, optionally only at one level.
 * A name can belong to several abolished areas, and can also still be in use today.
 */
export function abolishedByName(name: string, level?: Level): Abolished[] {
  const list = indexes().abolishedByThai.get(thaiKey(name)) ?? []
  return level === undefined ? [...list] : list.filter((a) => a.level === level)
}

/** Raw dataset lookups, for modules that need the address as @geothai/core returns it. */
export function addressOf(subdistrictCode: string): Address | undefined {
  return core.address(subdistrictCode)
}
