/**
 * Public contract of thai-address-check (docs/TASKS.md, "Public API contract").
 * Changes to the exported shapes need a ruling; other modules import from here and never edit it.
 */

/** One of the four address fields this package checks. */
export type Field = 'province' | 'district' | 'subdistrict' | 'postalCode'

/** The fields of one address as the caller has them. Every field is optional. */
export interface AddressInput {
  province?: string
  district?: string
  subdistrict?: string
  postalCode?: string
}

/** Input after formatting-only cleanup. No meaning is changed at this stage. */
export interface NormalizedAddress extends AddressInput {
  /** Per field: which formatting rules fired, e.g. 'strip-prefix', 'thai-digits', 'whitespace'. */
  applied: Partial<Record<Field, string[]>>
}

/** One current address from the dataset, with both names and the postal codes it uses. */
export interface ResolvedAddress {
  provinceCode: string
  districtCode: string
  subdistrictCode: string
  province: { th: string; en: string }
  district: { th: string; en: string }
  subdistrict: { th: string; en: string }
  postalCodes: string[]
}

/**
 * One row of the reference data as `listAddresses()` gives it: one per (subdistrict, postal code).
 * Names are the dataset's own, unmodified (Bangkok districts keep their 'เขต' prefix).
 */
export interface AddressRow {
  provinceCode: string
  provinceNameTh: string
  provinceNameEn: string
  districtCode: string
  districtNameTh: string
  districtNameEn: string
  subdistrictCode: string
  subdistrictNameTh: string
  subdistrictNameEn: string
  postalCode: string
}

/** Stable machine codes of every finding. */
export type FindingCode =
  | 'MISSING_FIELD' // a field needed to decide is absent
  | 'UNKNOWN_NAME' // no current area has this name at this level
  | 'MISSPELLED_NAME' // close to exactly one known name
  | 'PARENT_MISMATCH' // child exists but not under the given parent
  | 'POSTAL_CODE_MISMATCH' // postal code not used by the resolved subdistrict
  | 'POSTAL_CODE_INVALID' // not 5 digits / not in use anywhere
  | 'ABOLISHED_AREA' // name/code belongs to an abolished area
  | 'AMBIGUOUS' // more than one address fits; another field is needed
  | 'FORMAT_NORMALIZED' // informational: formatting was cleaned

/** How serious a finding is. Only `error` findings make an address invalid. */
export type Severity = 'error' | 'warning' | 'info'

/** One thing the check found, explained in Thai and English with its evidence. */
export interface Finding {
  code: FindingCode
  severity: Severity
  fields: Field[]
  message: { th: string; en: string }
  /** Structured evidence, e.g. { given: '84360', expected: ['84280'] }. */
  detail: Record<string, unknown>
}

/** A proposed change to one field, ranked by confidence. */
export interface Suggestion {
  field: Field
  from: string | undefined
  to: string
  confidence: number // 0..1
  reason: FindingCode
  resolved?: ResolvedAddress
}

/** Overall verdict of one check. */
export type Status = 'valid' | 'corrected' | 'ambiguous' | 'invalid'

/** Options of `check()` and `checkMany()`. */
export interface CheckOptions {
  /** Minimum confidence to apply a correction automatically. Default 0.9. */
  autoCorrectThreshold?: number
  /** When false, never change values; only report. Default true. */
  autoCorrect?: boolean
  /** Max suggestions returned per field. Default 3. */
  maxSuggestions?: number
}

/** Everything `check()` reports about one address. */
export interface CheckResult {
  status: Status
  input: AddressInput
  normalized: NormalizedAddress
  /** Present when status is 'valid' or 'corrected'. */
  resolved?: ResolvedAddress
  /** The address after applied corrections; equals normalized input when nothing was applied. */
  output: AddressInput
  findings: Finding[]
  suggestions: Suggestion[]
  dataVersion: string // from @geothai/core
}

/**
 * Internal (not exported from the package): the state one `check()` passes through the
 * validate, fuzzy+suggest and abolished steps. Each step reads it and adds to it.
 */
export interface CheckContext {
  /** The caller's input, untouched. */
  readonly input: AddressInput
  /** The input after `normalize()`. */
  readonly normalized: NormalizedAddress
  /** Options with every default filled in. */
  readonly options: Required<CheckOptions>
  /** Working field values. Starts as the normalized fields; an applied correction changes it. */
  output: AddressInput
  findings: Finding[]
  suggestions: Suggestion[]
  /** Every current address that fits `output`. One = resolved, more than one = ambiguous. */
  candidates: ResolvedAddress[]
}
