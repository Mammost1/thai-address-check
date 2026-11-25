/**
 * Deterministic sample files for the batch checker, built only from the public @geothai/core data.
 *
 * As a library: `sampleRows(n, seed)` gives header + rows. As a command (Node >= 22.12):
 *   node --experimental-strip-types test/file/make-sample.ts 100000 /tmp/sample.csv
 * writes an n-row CSV; the same seed always gives the same file.
 */
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import * as core from '@geothai/core'

export const SAMPLE_HEADER = ['ลำดับ', 'ชื่อลูกค้า', 'จังหวัด', 'อำเภอ', 'ตำบล', 'รหัสไปรษณีย์']

/** What `sampleRows` injected into a row, so tests can count what the checker should find. */
export type Injected = 'clean' | 'noise' | 'missing' | 'wrong-postal' | 'typo' | 'ambiguous' | 'unknown'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Place {
  province: string
  district: string
  subdistrict: string
  postal: string
  unique: boolean
}

function places(): Place[] {
  const all: Place[] = []
  const names = new Map<string, number>()
  for (const p of core.provinces()) {
    for (const d of core.districts(p.code)) {
      for (const s of core.subdistricts(d.code)) {
        names.set(s.name_th, (names.get(s.name_th) ?? 0) + 1)
        all.push({ province: p.name_th, district: d.name_th, subdistrict: s.name_th, postal: s.postal_codes[0] ?? '', unique: false })
      }
    }
  }
  for (const a of all) a.unique = names.get(a.subdistrict) === 1
  return all
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'

/**
 * Header plus `n` rows. About 90% are clean; the rest carry one injected problem each. The
 * `ชื่อลูกค้า` column holds commas, quotes and a line break on some rows, to exercise CSV quoting.
 */
export function sampleRows(n: number, seed = 1): { rows: string[][]; injected: Injected[] } {
  const rand = mulberry32(seed)
  const all = places()
  const rows: string[][] = [SAMPLE_HEADER]
  const injected: Injected[] = []
  for (let i = 0; i < n; i++) {
    const pick = all[Math.floor(rand() * all.length)] as Place
    let province = pick.province
    let district = pick.district
    let subdistrict = pick.subdistrict
    let postal = pick.postal
    const roll = rand()
    let kind: Injected = 'clean'
    if (roll >= 0.9 && roll < 0.93) {
      kind = 'noise'
      subdistrict = `ต.${subdistrict}`
      postal = postal.replace(/\d/g, (d) => THAI_DIGITS[Number(d)] as string)
    } else if (roll >= 0.93 && roll < 0.95) {
      kind = 'missing'
      district = ''
      province = ''
    } else if (roll >= 0.95 && roll < 0.97) {
      kind = 'wrong-postal'
      postal = postal === '10200' ? '10300' : '10200'
    } else if (roll >= 0.97 && roll < 0.98) {
      kind = 'typo'
      // Drop one character from a long name: close enough for the fuzzy step to notice.
      const cut = Math.floor(subdistrict.length / 2)
      subdistrict = subdistrict.slice(0, cut) + subdistrict.slice(cut + 1)
    } else if (roll >= 0.98 && roll < 0.99) {
      kind = 'ambiguous'
      province = ''
      district = ''
      postal = ''
    } else if (roll >= 0.99) {
      kind = 'unknown'
      subdistrict = 'ตำบลที่ไม่มีอยู่จริง'
    }
    const name = i % 97 === 0 ? `คุณ "สมชาย", ใจดี\nบ้านเลขที่ ${i}` : `ลูกค้า ${i + 1}`
    rows.push([String(i + 1), name, province, district, subdistrict, postal])
    injected.push(kind)
  }
  return { rows, injected }
}

/** One CSV line; quotes a cell that needs it. */
function line(cells: string[]): string {
  return `${cells.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')}\r\n`
}

/** Writes `n` sample rows to `path` as UTF-8 CSV without holding them all in memory at once. */
export async function writeSampleCsv(path: string, n: number, seed = 1): Promise<void> {
  const out = createWriteStream(path, { encoding: 'utf8' })
  const chunk = 5000
  let header = true
  for (let from = 0; from < n; from += chunk) {
    const { rows } = sampleRows(Math.min(chunk, n - from), seed + from)
    // sampleRows numbers rows from 1 each time; renumber so the 'ลำดับ' column is unique.
    const body = rows.slice(header ? 0 : 1).map((r, k) => (header && k === 0 ? r : [String(from + k + (header ? 0 : 1)), ...r.slice(1)]))
    header = false
    if (!out.write(body.map(line).join(''))) await once(out, 'drain')
  }
  out.end()
  await once(out, 'finish')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [count, path] = process.argv.slice(2)
  if (!count || !path) {
    process.stderr.write('usage: node --experimental-strip-types test/file/make-sample.ts <rows> <out.csv>\n')
    process.exit(2)
  }
  await writeSampleCsv(path, Number(count))
}
