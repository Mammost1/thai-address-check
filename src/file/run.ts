/**
 * Features 7: check a whole CSV or XLSX file. Rows are streamed through `check()` one at a time and
 * written out as they are done, so the memory used does not grow with the number of rows (CSV;
 * an XLSX is loaded whole by its reader).
 */
import { rm } from 'node:fs/promises'
import { extname } from 'node:path'
import { check } from '../check'
import { dataVersion } from '../data'
import type { AddressInput, CheckResult, Field, Status } from '../types'
import {
  applyMap,
  ColumnError,
  detectColumns,
  looksLikeHeader,
  mappedFields,
  parseMapSpec,
  type ColumnMap,
} from './columns'
import { CsvWriter, openCsv } from './csv'
import { readXlsxRows } from './xlsx'

/** Columns added to the output file, after the original ones. */
export const ADDED_COLUMNS = ['tac_status', 'tac_codes', 'tac_message', 'tac_changes'] as const

/** Options of `checkFile()`. */
export interface CheckFileOptions {
  /** The .csv (or .txt/.tsv) or .xlsx file to check. */
  input: string
  /** Where to write the checked CSV. Default: the input name with `.checked.csv`. */
  output?: string
  /** `--map` entries, e.g. `['province=จังหวัด', 'subdistrict=3']`. They override column detection. */
  map?: string[]
  /** False when the file has no header row (then `map` must use column numbers). Default true. */
  header?: boolean
  /** XLSX sheet name or 1-based number. Default: the first sheet. */
  sheet?: string
  /** Force the CSV delimiter instead of sniffing it. */
  delimiter?: string
  /** Same meaning as in `check()`. Default 0.9. */
  autoCorrectThreshold?: number
  /** False: report only, never change a cell. Default true. */
  autoCorrect?: boolean
  /** Start the output with a UTF-8 byte-order mark so Excel reads Thai correctly. Default true. */
  bom?: boolean
  /** Called now and then with the number of rows done. */
  onProgress?: (rows: number) => void
}

/** What a run found, also written by `--report`. */
export interface FileSummary {
  input: string
  output: string
  /** Data rows checked (the header row is not counted, nor are blank rows). */
  rows: number
  /** Rows in which every cell was empty (for example `,,,,`): skipped, not counted as invalid. */
  blankRowsSkipped: number
  statuses: Record<Status, number>
  /** Share of rows that are invalid, in percent (0 for an empty file). */
  invalidPercent: number
  /** How many rows carried each finding code. */
  findings: Record<string, number>
  /** The column used for each field: header text, or the column number when there is no header. */
  columns: Partial<Record<Field, string>>
  encoding: string
  delimiter: string
  autoCorrect: boolean
  dataVersion: string
  elapsedMs: number
}

const FIELDS: readonly Field[] = ['province', 'district', 'subdistrict', 'postalCode']

/** The default output path: `a/b.csv` becomes `a/b.checked.csv`; an .xlsx input also gets .csv. */
export function defaultOutputPath(input: string): string {
  const ext = extname(input)
  return `${input.slice(0, input.length - ext.length)}.checked.csv`
}

/** Rows of a file as arrays of text, plus what was learned about its format. */
async function openRows(
  options: CheckFileOptions,
): Promise<{ rows: AsyncIterable<string[]>; encoding: string; delimiter: string }> {
  const ext = extname(options.input).toLowerCase()
  if (ext === '.xlsx') {
    const all = await readXlsxRows(options.input, options.sheet)
    return {
      rows: (async function* () {
        yield* all
      })(),
      encoding: 'xlsx',
      delimiter: ',',
    }
  }
  if (ext === '.xls') throw new ColumnError('Old .xls files are not supported: save the sheet as .xlsx or .csv')
  const csv = await openCsv(options.input, options.delimiter)
  return { rows: csv.rows, encoding: csv.encoding, delimiter: csv.delimiter }
}

function cellOf(row: readonly string[], index: number | undefined): string | undefined {
  return index === undefined ? undefined : (row[index] ?? '')
}

function inputOf(row: readonly string[], map: ColumnMap): AddressInput {
  const input: AddressInput = {}
  for (const f of FIELDS) {
    const v = cellOf(row, map[f])
    if (v !== undefined) input[f] = v
  }
  return input
}

/** The added columns of one row, and the row's own cells with the corrections written in. */
function outputRow(
  row: readonly string[],
  map: ColumnMap,
  result: CheckResult,
  fix: boolean,
  width: number,
): string[] {
  const cells = Array.from({ length: Math.max(width, row.length) }, (_, i) => row[i] ?? '')
  const changes: string[] = []
  const settled = result.status === 'valid' || result.status === 'corrected'
  if (fix && settled) {
    for (const f of FIELDS) {
      const to = result.output[f]
      if (to === undefined) continue
      const index = map[f]
      if (index === undefined) {
        // A field the file has no column for (filled in from the others) can only be reported.
        if (result.normalized[f] === undefined) changes.push(`${f}: +${to}`)
        continue
      }
      const from = cells[index] ?? ''
      if (from !== to) {
        cells[index] = to
        // '+x' means the cell was blank and x was added; 'a -> b' means a was replaced by b.
        changes.push(from === '' ? `${f}: +${to}` : `${f}: ${from} -> ${to}`)
      }
    }
  }
  const shown = result.findings.filter((f) => f.code !== 'FORMAT_NORMALIZED')
  return [
    ...cells,
    result.status,
    shown.map((f) => f.code).join(';'),
    shown.map((f) => f.message.th).join(' | '),
    changes.join('; '),
  ]
}

/**
 * Checks every row of a file and writes the checked CSV: the original columns (with corrections
 * written into the address columns unless `autoCorrect` is false) followed by `tac_status`,
 * `tac_codes`, `tac_message` (Thai) and `tac_changes`. Rows that are ambiguous or invalid keep
 * their original cells.
 *
 * @param options - Input path and the options above.
 * @returns The summary: counts per status and per finding code, the columns used, timing.
 * @throws ColumnError when no address column can be found or `map` is wrong; Error for I/O problems.
 */
export async function checkFile(options: CheckFileOptions): Promise<FileSummary> {
  const started = Date.now()
  const output = options.output ?? defaultOutputPath(options.input)
  if (output === options.input) throw new Error('The output file would overwrite the input; pass a different --out')
  const fix = options.autoCorrect ?? true
  const checkOptions = { autoCorrect: fix, ...(options.autoCorrectThreshold === undefined ? {} : { autoCorrectThreshold: options.autoCorrectThreshold }) }
  checkOptions.autoCorrectThreshold ??= 0.9

  const { rows, encoding, delimiter } = await openRows(options)
  const iterator = rows[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done) throw new ColumnError('The file is empty')

  const hasHeader = options.header ?? true
  const entries = parseMapSpec(options.map ?? [])
  let map: ColumnMap
  let header: string[] | undefined
  let firstData: string[] | undefined
  if (hasHeader) {
    header = first.value
    if (!looksLikeHeader(header) && entries.length === 0) {
      throw new ColumnError(
        'No header names an address field (จังหวัด, อำเภอ, ตำบล, รหัสไปรษณีย์ / province, district, subdistrict, postal code) ' +
          `in the first row (${header.length} column${header.length === 1 ? '' : 's'}). The header must be the first row of the file or sheet: a title or note above it is not supported, delete it first. ` +
          'Otherwise name the columns with --map, or pass --no-header.',
      )
    }
    map = { ...(looksLikeHeader(header) ? detectColumns(header) : {}), ...applyMap(entries, header, header.length) }
  } else {
    firstData = first.value
    map = applyMap(entries, undefined, first.value.length)
  }
  if (map.subdistrict === undefined && map.postalCode === undefined) {
    throw new ColumnError('Need at least a subdistrict or a postal code column. Name them with --map subdistrict=<header or number>.')
  }

  const columns: Partial<Record<Field, string>> = {}
  for (const f of mappedFields(map)) {
    const i = map[f] as number
    columns[f] = header ? (header[i] ?? String(i + 1)) : String(i + 1)
  }

  const summary: FileSummary = {
    input: options.input,
    output,
    rows: 0,
    blankRowsSkipped: 0,
    statuses: { valid: 0, corrected: 0, ambiguous: 0, invalid: 0 },
    invalidPercent: 0,
    findings: {},
    columns,
    encoding,
    delimiter,
    autoCorrect: fix,
    dataVersion,
    elapsedMs: 0,
  }

  const width = header?.length ?? first.value.length
  const writer = new CsvWriter(output, delimiter, options.bom ?? true)
  try {
    if (header) await writer.row([...header, ...ADDED_COLUMNS])
    const handle = async (row: string[]): Promise<void> => {
      // A row of only delimiters is as empty as an empty line (csv-parse already drops those) or a
      // blank .xlsx row: it is not a customer with a missing address, so it must not count as invalid.
      if (row.every((cell) => cell.trim() === '')) {
        summary.blankRowsSkipped++
        return
      }
      const result = check(inputOf(row, map), checkOptions)
      summary.rows++
      summary.statuses[result.status]++
      for (const code of new Set(result.findings.map((f) => f.code))) summary.findings[code] = (summary.findings[code] ?? 0) + 1
      await writer.row(outputRow(row, map, result, fix, width))
      if (options.onProgress && summary.rows % 5000 === 0) options.onProgress(summary.rows)
    }
    if (firstData) await handle(firstData)
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) await handle(next.value)
  } catch (error) {
    // Do not leave a half-written file that looks like a finished one.
    await writer.close().catch(() => undefined)
    await rm(output, { force: true })
    throw error
  }
  await writer.close()
  summary.invalidPercent = summary.rows === 0 ? 0 : (summary.statuses.invalid / summary.rows) * 100
  summary.elapsedMs = Date.now() - started
  return summary
}
