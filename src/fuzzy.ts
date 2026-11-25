/**
 * Thai-aware string similarity (feature 2).
 *
 * A weighted optimal-string-alignment distance (Levenshtein plus adjacent transposition) where the
 * mistakes people really make when typing Thai place names cost less than an arbitrary edit:
 * a missing or extra tone mark / vowel above or below the line, the classic confusions
 * (ร/ล, ใ/ไ, ณ/น, ศ/ษ/ส, ์ dropped), a neighbouring key on the Kedmanee layout, and two letters
 * swapped. English names are compared case-, space- and hyphen-insensitively.
 *
 * Complexity: O(n·m) time and O(m) memory for names of n and m characters (place names are
 * under 40 characters). `similarityAtLeast` stops early once the minimum cannot be reached.
 */
import { englishKey, hasThai, thaiKey } from './data'

/** Cost of an edit nobody would make by accident. */
const FULL = 1
/** A tone mark or above/below vowel added, dropped or swapped for another one. */
const DIACRITIC = 0.3
/** One of the classic look-alike / sound-alike confusions. */
const CONFUSION = 0.35
/** Two neighbouring characters swapped. */
const TRANSPOSE = 0.5
/** A neighbouring key, or the same key with/without Shift. */
const KEY_SLIP = 0.6

/** Combining marks written above or below a consonant: tone marks, ์, ็, ั, ิ ี ึ ื ุ ู, ํ, ฺ. */
const DIACRITICS = new Set([...'่้๊๋์็ัิีึืุูํฺ'])

/** Groups whose members are commonly confused in spelling. */
const CONFUSION_GROUPS: readonly string[] = ['รล', 'ใไ', 'ณน', 'ศษส', 'ขฃ', 'คฅ', 'ฎด', 'ฏต', 'ฐถ', 'ภพ', 'ญย']

/**
 * Kedmanee keyboard, unshifted and shifted layers, row by row. Position i of a shifted row is the
 * same physical key as position i of the unshifted row.
 */
const KEDMANEE: readonly (readonly [string, string])[] = [
  ['ๅ/-ภถุึคตจขช', '+๑๒๓๔ู฿๕๖๗๘๙'],
  ['ๆไำพะัีรนยบลฃ', '๐"ฎฑธํ๊ณฯญฐ,ฅ'],
  ['ฟหกดเ้่าสวง', 'ฤฆฏโฌ็๋ษศซ.'],
  ['ผปแอิืทมใฝ', '()ฉฮฺ์?ฒฬฦ'],
]

/** QWERTY rows for English names. */
const QWERTY: readonly string[] = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

function pairKey(a: number, b: number): number {
  return a < b ? a * 0x10000 + b : b * 0x10000 + a
}

function buildCheapPairs(): Map<number, number> {
  const pairs = new Map<number, number>()
  const set = (a: string, b: string, cost: number) => {
    if (a === b) return
    const k = pairKey(a.charCodeAt(0), b.charCodeAt(0))
    const old = pairs.get(k)
    if (old === undefined || cost < old) pairs.set(k, cost)
  }
  for (const group of CONFUSION_GROUPS) {
    const chars = [...group]
    for (const a of chars) for (const b of chars) set(a, b, CONFUSION)
  }
  const keyRows = (rows: readonly string[][]) => {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] as string[]
      for (let i = 0; i < row.length; i++) {
        const c = row[i] as string
        const right = row[i + 1]
        if (right) set(c, right, KEY_SLIP)
        const below = rows[r + 1]?.[i]
        if (below) set(c, below, KEY_SLIP)
      }
    }
  }
  keyRows(KEDMANEE.map(([plain]) => [...plain]))
  keyRows(KEDMANEE.map(([, shifted]) => [...shifted]))
  for (const [plain, shifted] of KEDMANEE) {
    const p = [...plain]
    const s = [...shifted]
    for (let i = 0; i < p.length; i++) if (s[i]) set(p[i] as string, s[i] as string, KEY_SLIP)
  }
  keyRows(QWERTY.map((row) => [...row]))
  // Diacritic swapped for another diacritic (wrong tone mark, ิ for ี, ุ for ู ...).
  for (const a of DIACRITICS) for (const b of DIACRITICS) set(a, b, DIACRITIC)
  return pairs
}

const CHEAP_PAIRS = buildCheapPairs()
const DIACRITIC_CODES = new Set([...DIACRITICS].map((c) => c.charCodeAt(0)))

function indelCost(c: number): number {
  return DIACRITIC_CODES.has(c) ? DIACRITIC : FULL
}

function substituteCost(a: number, b: number): number {
  if (a === b) return 0
  return CHEAP_PAIRS.get(pairKey(a, b)) ?? FULL
}

// Three reusable rows of the DP table; grown on demand. Not re-entrant (no async in here).
let row0 = new Float64Array(64)
let row1 = new Float64Array(64)
let row2 = new Float64Array(64)

/**
 * Weighted OSA distance between two prepared names, or Infinity once it must exceed `limit`.
 * Prepared names never contain surrogate pairs (Thai and ASCII only), so UTF-16 units are characters.
 */
function distance(a: string, b: string, limit: number): number {
  const n = a.length
  const m = b.length
  if (row0.length <= m) {
    row0 = new Float64Array(m + 1)
    row1 = new Float64Array(m + 1)
    row2 = new Float64Array(m + 1)
  }
  let prev2 = row0
  let prev = row1
  let cur = row2
  prev[0] = 0
  for (let j = 1; j <= m; j++) prev[j] = (prev[j - 1] as number) + indelCost(b.charCodeAt(j - 1))
  // A transposition reaches back two rows, so stop only when two consecutive rows exceed the limit.
  let prevRowMin = 0
  for (let i = 1; i <= n; i++) {
    const ai = a.charCodeAt(i - 1)
    const aiDel = indelCost(ai)
    cur[0] = (prev[0] as number) + aiDel
    let rowMin = cur[0] as number
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1)
      let d = (prev[j] as number) + aiDel
      const ins = (cur[j - 1] as number) + indelCost(bj)
      if (ins < d) d = ins
      const sub = (prev[j - 1] as number) + substituteCost(ai, bj)
      if (sub < d) d = sub
      if (i > 1 && j > 1 && ai !== bj && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) {
        const tr = (prev2[j - 2] as number) + TRANSPOSE
        if (tr < d) d = tr
      }
      cur[j] = d
      if (d < rowMin) rowMin = d
    }
    if (rowMin > limit && prevRowMin > limit) return Number.POSITIVE_INFINITY
    prevRowMin = rowMin
    const t = prev2
    prev2 = prev
    prev = cur
    cur = t
  }
  return prev[m] as number
}

/** A name as it is compared: its Thai lookup key, or its folded English key. */
export function comparable(name: string): string {
  return hasThai(name) ? thaiKey(name) : englishKey(name)
}

/**
 * Similarity of two prepared names (from `comparable`), or 0 when it is below `min`.
 * Use this in loops: it skips hopeless pairs by length and stops the table early.
 */
export function similarityAtLeast(a: string, b: string, min: number): number {
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1
  const limit = (1 - min) * longest
  // Every missing character costs at least DIACRITIC.
  if (Math.abs(a.length - b.length) * DIACRITIC > limit) return 0
  const d = distance(a, b, limit)
  if (!Number.isFinite(d)) return 0
  const s = 1 - d / longest
  return s >= min ? Math.max(0, s) : 0
}

/**
 * How alike two area names are, from 0 (nothing in common) to 1 (the same name after the lookup
 * folding of `thaiKey` / `englishKey`). A Thai name is never similar to an English one.
 *
 * @example
 * similarity('สุราษฎร์ธานี', 'สุราษฏร์ธานี') // ≈ 0.97 (ฎ/ฏ is a neighbouring key)
 * similarity('Ko Pha-ngan', 'ko phangan')  // 1
 */
export function similarity(a: string, b: string): number {
  if (hasThai(a) !== hasThai(b)) return 0
  return similarityAtLeast(comparable(a), comparable(b), 0)
}
