/**
 * Column detection for batch files: which column of a spreadsheet holds which address field.
 * Headers are matched by name (Thai and English); `--map` overrides the guess per field.
 */
import type { Field } from '../types'

/** Zero-based column index per address field; a field without a column is absent. */
export type ColumnMap = Partial<Record<Field, number>>

/** Thrown when columns cannot be settled; the message says what to pass to `--map`. */
export class ColumnError extends Error {
  override name = 'ColumnError'
}

const FIELDS: readonly Field[] = ['province', 'district', 'subdistrict', 'postalCode']

/**
 * Header texts (after `headerKey`) that name each field. The `…nameth` entries are the headers
 * `thai-address-check export` writes (province_name_th …), so an exported table, or a database table
 * seeded from one, is checked without `--map`: the Thai name column is the exact match.
 */
const SYNONYMS: Record<Field, readonly string[]> = {
  province: ['จังหวัด', 'province', 'changwat', 'จ', 'provincename', 'provincenameth'],
  district: ['อำเภอ', 'เขต', 'อำเภอเขต', 'เขตอำเภอ', 'district', 'amphoe', 'amphur', 'khet', 'districtname', 'districtnameth'],
  subdistrict: ['ตำบล', 'แขวง', 'ตำบลแขวง', 'แขวงตำบล', 'subdistrict', 'tambon', 'tambol', 'khwaeng', 'subdistrictname', 'subdistrictnameth'],
  postalCode: ['รหัสไปรษณีย์', 'ไปรษณีย์', 'รหัสปณ', 'ปณ', 'zipcode', 'zip', 'postalcode', 'postcode', 'postal'],
}

/** Aliases accepted for a field name in `--map`. */
const FIELD_ALIASES: Record<string, Field> = {
  province: 'province',
  district: 'district',
  subdistrict: 'subdistrict',
  postalcode: 'postalCode',
  postal: 'postalCode',
  zip: 'postalCode',
  zipcode: 'postalCode',
}

/** A header reduced to lower-case letters, digits and Thai characters, so 'Postal_Code' = 'postal code'. */
export function headerKey(header: string): string {
  return header
    .normalize('NFC')
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]/g, '')
}

function matches(key: string, synonym: string): boolean {
  return key === synonym
}

/** Columns whose header IS a synonym; when none, those that merely contain a longer synonym. */
function candidates(keys: readonly string[], field: Field): number[] {
  const exact = keys.flatMap((k, i) => (SYNONYMS[field].some((s) => matches(k, s)) ? [i] : []))
  if (exact.length > 0) return exact
  // A code or id column ('รหัสตำบล', 'province_code') is not the name column.
  const isCode = (k: string): boolean => field !== 'postalCode' && /รหัส|code|id$/.test(k)
  return keys.flatMap((k, i) => (!isCode(k) && SYNONYMS[field].some((s) => s.length >= 4 && k.includes(s)) ? [i] : []))
}

/**
 * Finds the address columns from a header row.
 *
 * @param header - The first row of the file.
 * @returns The columns found. Fields with no matching header are left out.
 * @throws ColumnError when one field matches several columns (name the right one with `--map`).
 */
export function detectColumns(header: readonly string[]): ColumnMap {
  const keys = header.map(headerKey)
  const map: ColumnMap = {}
  for (const field of FIELDS) {
    const found = candidates(keys, field)
    if (found.length > 1) {
      const names = found.map((i) => `"${header[i] ?? ''}" (column ${i + 1})`).join(', ')
      throw new ColumnError(`Several columns look like ${field}: ${names}. Choose one with --map ${field}=<header or number>.`)
    }
    const only = found[0]
    if (only !== undefined) map[field] = only
  }
  return map
}

/** One `--map` entry: a field name and a header text or a 1-based column number. */
export interface MapEntry {
  field: Field
  column: string
}

/**
 * Parses `--map` values such as `province=จังหวัด,subdistrict=3`. A value that is only digits is a
 * 1-based column number; anything else is a header text. Headers containing a comma or `=` cannot
 * be named here: use their column number.
 *
 * @throws ColumnError for an unknown field name or an entry without `=`.
 */
export function parseMapSpec(specs: readonly string[]): MapEntry[] {
  const entries: MapEntry[] = []
  for (const spec of specs) {
    for (const part of spec.split(',')) {
      if (part.trim() === '') continue
      const at = part.indexOf('=')
      if (at < 0) throw new ColumnError(`--map entry "${part}" needs the form field=column`)
      const name = headerKey(part.slice(0, at))
      const field = FIELD_ALIASES[name]
      if (!field) {
        throw new ColumnError(`--map: unknown field "${part.slice(0, at)}" (use province, district, subdistrict, postalCode)`)
      }
      const column = part.slice(at + 1).trim()
      if (column === '') throw new ColumnError(`--map entry "${part}" has no column`)
      entries.push({ field, column })
    }
  }
  return entries
}

/**
 * Resolves `--map` entries to column indexes and lays them over the detected ones.
 *
 * @param entries - Parsed `--map` entries.
 * @param header - The header row, or undefined for a file without one (then only numbers work).
 * @param width - Number of columns in the first data row, to bound column numbers.
 * @throws ColumnError when a header text is not found, or a number is outside the file.
 */
export function applyMap(entries: readonly MapEntry[], header: readonly string[] | undefined, width: number): ColumnMap {
  const map: ColumnMap = {}
  for (const { field, column } of entries) {
    if (/^\d+$/.test(column)) {
      const n = Number(column)
      if (n < 1 || n > width) throw new ColumnError(`--map ${field}=${column}: the file has ${width} columns`)
      map[field] = n - 1
      continue
    }
    if (!header) throw new ColumnError(`--map ${field}=${column}: the file has no header row, use a column number`)
    const key = headerKey(column)
    const found = header.flatMap((h, i) => (headerKey(h) === key ? [i] : []))
    if (found.length === 0) throw new ColumnError(`--map ${field}=${column}: no column has that header`)
    if (found.length > 1) throw new ColumnError(`--map ${field}=${column}: several columns have that header, use a column number`)
    map[field] = found[0] as number
  }
  return map
}

/** True when the row looks like a header: at least one cell names an address field. */
export function looksLikeHeader(row: readonly string[]): boolean {
  const keys = row.map(headerKey)
  return FIELDS.some((f) => candidates(keys, f).length > 0)
}

/** The fields that have a column, in field order. */
export function mappedFields(map: ColumnMap): Field[] {
  return FIELDS.filter((f) => map[f] !== undefined)
}
