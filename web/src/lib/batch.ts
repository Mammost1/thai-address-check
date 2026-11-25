import { check, type AddressInput, type CheckOptions, type CheckResult, type FindingCode, type Status } from 'thai-address-check'
import { FIELDS, type ColumnMap } from './columns'

/** One data row of the file with its check result. */
export interface RowResult {
  /** 1-based line number in the file, header included, so people can find the row. */
  line: number
  cells: string[]
  result: CheckResult
}

export interface Summary {
  total: number
  byStatus: Record<Status, number>
  byFinding: Partial<Record<FindingCode, number>>
}

/** The address fields of one row, by the column map. Empty cells count as absent. */
export function addressOf(cells: readonly string[], map: ColumnMap): AddressInput {
  const input: AddressInput = {}
  for (const field of FIELDS) {
    const index = map[field]
    if (index === undefined) continue
    const value = cells[index]
    if (value !== undefined && value.trim() !== '') input[field] = value
  }
  return input
}

/**
 * Checks every data row (rows after the header), `chunk` rows at a time, yielding to the browser
 * between chunks so the page stays responsive. `onProgress` gets the number of rows done.
 */
export async function checkRows(
  rows: readonly string[][],
  map: ColumnMap,
  options: CheckOptions,
  onProgress: (done: number) => void = () => {},
  chunk = 500,
): Promise<RowResult[]> {
  const out: RowResult[] = []
  for (let start = 1; start < rows.length; start += chunk) {
    const end = Math.min(rows.length, start + chunk)
    for (let i = start; i < end; i++) {
      const cells = rows[i] as string[]
      if (cells.every((c) => c.trim() === '')) continue
      out.push({ line: i + 1, cells, result: check(addressOf(cells, map), options) })
    }
    onProgress(end - 1)
    await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

export function summarize(results: readonly RowResult[]): Summary {
  const summary: Summary = { total: results.length, byStatus: { valid: 0, corrected: 0, ambiguous: 0, invalid: 0 }, byFinding: {} }
  for (const { result } of results) {
    summary.byStatus[result.status]++
    for (const code of new Set(result.findings.map((f) => f.code))) {
      summary.byFinding[code] = (summary.byFinding[code] ?? 0) + 1
    }
  }
  return summary
}

/** Columns appended to the downloaded file. */
export const OUTPUT_COLUMNS = [
  'check_status',
  'check_findings',
  'checked_province',
  'checked_district',
  'checked_subdistrict',
  'checked_postal_code',
  'check_suggestions',
] as const

/**
 * The downloaded file: every original column untouched, then the status, the finding codes, the
 * checked value of each field (corrected where a correction was applied, filled where a missing
 * field had one answer) and the suggestions that were not applied.
 */
export function outputRows(header: readonly string[], results: readonly RowResult[]): string[][] {
  const rows: string[][] = [[...header, ...OUTPUT_COLUMNS]]
  for (const { cells, result } of results) {
    const padded = header.map((_, i) => cells[i] ?? '')
    const r = result.resolved
    const o = result.output
    rows.push([
      ...padded,
      result.status,
      [...new Set(result.findings.filter((f) => f.code !== 'FORMAT_NORMALIZED').map((f) => f.code))].join(' '),
      r ? r.province.th : (o.province ?? ''),
      r ? r.district.th : (o.district ?? ''),
      r ? r.subdistrict.th : (o.subdistrict ?? ''),
      o.postalCode ?? (r && r.postalCodes.length === 1 ? (r.postalCodes[0] as string) : ''),
      result.suggestions
        .filter((s) => o[s.field] !== s.to)
        .map((s) => `${s.field}=${s.to} (${Math.round(s.confidence * 100)}%)`)
        .join('; '),
    ])
  }
  return rows
}
