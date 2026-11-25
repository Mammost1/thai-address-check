/**
 * Feature 4: formatting-only cleanup. Nothing here guesses what the caller meant; a value only
 * changes in ways that cannot change which area it names, and every rule that fired is recorded.
 */
import { hasThai, isKnownName, type Level } from './data'
import type { AddressInput, Field, NormalizedAddress } from './types'

/** Names of the rules `normalize()` can record in `applied`. */
export type NormalizeRule =
  | 'invisible-chars'
  | 'thai-digits'
  | 'fullwidth-digits'
  | 'thai-sara-am'
  | 'whitespace'
  | 'strip-prefix'
  | 'bangkok-alias'
  | 'postal-digits-only'

const FIELDS: readonly Field[] = ['province', 'district', 'subdistrict', 'postalCode']

/** Zero-width and soft-hyphen characters: removed. */
const ZERO_WIDTH = /[​-‍⁠﻿­]/g
/** Non-breaking and other fixed-width spaces: turned into a plain space. */
const ODD_SPACE = /[   　]/g
const THAI_DIGITS = /[๐-๙]/g
/** Full-width digits (U+FF10-FF19), e.g. from Japanese/Chinese input methods. */
const FULLWIDTH_DIGITS = /[\uFF10-\uFF19]/g
/**
 * Sara am typed or copied as nikhahit + sara aa (U+0E4D U+0E32), common from PDF/Word, including
 * the PDF order with a tone mark in between ('นํ้า' = น ํ ้ า); it becomes tone + ำ as the dataset writes it.
 * NFC does not compose it, and the dataset only uses the single character U+0E33.
 */
const DECOMPOSED_SARA_AM = /\u0E4D([\u0E48-\u0E4B]?)\u0E32/g

/**
 * Thai level prefixes per field, longest first so 'ตำบล' wins over 'ต.'. A bare letter without
 * its dot (e.g. 'ต') is never a prefix: many names start with that letter.
 */
const THAI_PREFIXES: Record<Level, readonly string[]> = {
  subdistrict: ['ตำบล', 'แขวง', 'ต.'],
  district: ['อำเภอ', 'เขต', 'อ.'],
  province: ['จังหวัด', 'จ.'],
}

/** English level words written before the name, e.g. 'Tambon Talat'. */
const ENGLISH_PREFIXES: Record<Level, readonly string[]> = {
  subdistrict: ['tambon', 'khwaeng'],
  district: ['amphoe', 'khet'],
  province: ['changwat'],
}

/** English level words written after the name, e.g. 'Mueang Chiang Mai District'. */
const ENGLISH_SUFFIXES: Record<Level, readonly string[]> = {
  subdistrict: ['sub-district', 'sub district', 'subdistrict'],
  district: ['district'],
  province: ['province'],
}

/** Ways people write Bangkok. Compared after whitespace is removed and case is folded. */
const BANGKOK_THAI = new Set(['กทม', 'กทม.', 'กรุงเทพ', 'กรุงเทพฯ'])
const BANGKOK_ENGLISH = new Set(['bangkok', 'bkk', 'krungthepmahanakhon', 'krungthep', 'bangkokmetropolis'])
const BANGKOK_TH = 'กรุงเทพมหานคร'
const BANGKOK_EN = 'Bangkok'

type Step = { value: string; rules: NormalizeRule[] }

function step(s: Step, rule: NormalizeRule, next: string): Step {
  return next === s.value ? s : { value: next, rules: [...s.rules, rule] }
}

function cleanCharacters(s: Step): Step {
  s = step(s, 'invisible-chars', s.value.replace(ZERO_WIDTH, '').replace(ODD_SPACE, ' '))
  s = step(
    s,
    'thai-digits',
    s.value.replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50)),
  )
  s = step(
    s,
    'fullwidth-digits',
    s.value.replace(FULLWIDTH_DIGITS, (d) => String(d.charCodeAt(0) - 0xff10)),
  )
  s = step(s, 'thai-sara-am', s.value.replace(DECOMPOSED_SARA_AM, '$1\u0E33'))
  return step(s, 'whitespace', s.value.trim().replace(/\s+/gu, ' '))
}

/** The value without one leading/trailing level word, or undefined when none is present. */
function withoutPrefix(level: Level, value: string): string | undefined {
  if (hasThai(value)) {
    for (const p of THAI_PREFIXES[level]) {
      if (value.startsWith(p)) return value.slice(p.length).trim()
    }
    return undefined
  }
  const lower = value.toLowerCase()
  for (const p of ENGLISH_PREFIXES[level]) {
    if (lower.startsWith(`${p} `)) return value.slice(p.length + 1).trim()
  }
  for (const p of ENGLISH_SUFFIXES[level]) {
    if (lower.endsWith(` ${p}`)) return value.slice(0, value.length - p.length - 1).trim()
  }
  return undefined
}

/**
 * Removes a level prefix only when that cannot change the name: the remainder is a known name
 * at this level, or the original is not. A real name that merely starts like a prefix
 * (for example the subdistrict 'จ.ป.ร.') is therefore kept as written.
 */
function stripPrefix(level: Level, s: Step): Step {
  const rest = withoutPrefix(level, s.value)
  if (rest === undefined || rest === '') return s
  if (isKnownName(level, rest) || !isKnownName(level, s.value)) return step(s, 'strip-prefix', rest)
  return s
}

function bangkokAlias(s: Step): Step {
  const key = s.value.replace(/\s+/gu, '').toLowerCase()
  if (BANGKOK_THAI.has(key)) return step(s, 'bangkok-alias', BANGKOK_TH)
  if (BANGKOK_ENGLISH.has(key)) return step(s, 'bangkok-alias', BANGKOK_EN)
  return s
}

function normalizeField(field: Field, raw: string): Step {
  let s = cleanCharacters({ value: raw, rules: [] })
  if (field === 'postalCode') return step(s, 'postal-digits-only', s.value.replace(/\D/g, ''))
  s = stripPrefix(field, s)
  if (field === 'province') s = bangkokAlias(s)
  return s
}

/**
 * Cleans the formatting of each field without changing its meaning (feature 4):
 * zero-width and non-breaking characters, Thai and full-width digits to Arabic, sara am
 * written as ํ + า, extra whitespace,
 * level prefixes (ต./ตำบล/แขวง, อ./อำเภอ/เขต, จ./จังหวัด, Tambon/Amphoe/Khwaeng/Khet/Changwat,
 * '… Sub-district', '… District', '… Province'), Bangkok aliases (กทม, กรุงเทพฯ, BKK …) and
 * non-digits in the postal code. Fields that are absent stay absent; a blank field becomes ''.
 *
 * @param input - The address as the caller has it.
 * @returns The cleaned fields plus, per field, the rules that changed it (in order).
 * @example
 * normalize({ subdistrict: 'ต. ตลาด', province: 'จ.สุราษฎร์ธานี', postalCode: '๘๔๐๐๐' })
 * // { subdistrict: 'ตลาด', province: 'สุราษฎร์ธานี', postalCode: '84000',
 * //   applied: { subdistrict: ['strip-prefix'], province: ['strip-prefix'], postalCode: ['thai-digits'] } }
 */
export function normalize(input: AddressInput): NormalizedAddress {
  const out: NormalizedAddress = { applied: {} }
  for (const field of FIELDS) {
    const raw: unknown = input[field]
    if (raw === undefined || raw === null) continue
    // Plain-JS callers and spreadsheets hand over numbers (e.g. postal code 84000): read them as text.
    const s = normalizeField(field, typeof raw === 'string' ? raw : String(raw))
    out[field] = s.value
    if (s.rules.length > 0) out.applied[field] = s.rules
  }
  return out
}
