#!/usr/bin/env node
/**
 * Feature 8: the `thai-address-check` command.
 *
 *   thai-address-check <file> [--out f] [--report f.json] [--threshold n] [--no-fix]
 *                      [--fail-over pct] [--map field=column] [--sheet s] [--no-header]
 *   thai-address-check export [--format csv|json] [--out f] [--no-bom]
 *
 * Exit code: 0 done, 1 the invalid share is over --fail-over, 2 bad arguments or a file problem.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { dataVersion, listAddresses } from './export'
import { ColumnError } from './file/columns'
import { CSV_BOM, CsvWriter, csvRecord } from './file/csv'
import { checkFile, defaultOutputPath, type FileSummary } from './file/run'
import type { AddressRow } from './types'

/** Where the command writes; replaced in tests. */
export interface Io {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/** Credit required by CC BY 4.0 wherever this package emits data (see NOTICE). */
export const CREDIT =
  'Address data © 2026 Pongsakorn Thipayanate ("GeoThai"), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via @geothai/core. See NOTICE.'

const DATA_LINES = `Data version: ${dataVersion}
${CREDIT}
`

const EXPORT_COLUMNS = [
  'province_code',
  'province_name_th',
  'province_name_en',
  'district_code',
  'district_name_th',
  'district_name_en',
  'subdistrict_code',
  'subdistrict_name_th',
  'subdistrict_name_en',
  'postal_code',
] as const

const EXPORT_USAGE = `thai-address-check export [--format csv|json] [--out <file>]
ส่งออกข้อมูลอ้างอิงทั้งชุด (Write the reference data: one row per subdistrict + postal code)

  --format <csv|json>  csv (default): header ${EXPORT_COLUMNS[0]} ... ${EXPORT_COLUMNS[9]};
                       json: an array of { provinceCode, ..., postalCode }
  --out <file>         write to a file (default: stdout)
  --no-bom             CSV without the UTF-8 byte-order mark
`

const USAGE = `thai-address-check <file.csv|file.xlsx> [options]
ตรวจที่อยู่ไทยทั้งไฟล์ (Check a whole file of Thai addresses)

Options:
  --out <file>         checked CSV to write (default: <file>.checked.csv)
  --report <file>      write the summary as JSON
  --threshold <0..1>   minimum confidence to correct automatically (default 0.9)
  --no-fix             only report; never change a cell
  --fail-over <pct>    exit 1 when more than pct% of rows are invalid (default: never)
  --map <field=col>    name a column: province, district, subdistrict, postalCode = header or 1-based number
                       (repeatable, or comma separated); overrides detection
  --sheet <name|n>     XLSX sheet (default: the first)
  --delimiter <c>      CSV delimiter: one character, or the word tab (default: sniffed)
  --no-header          the file has no header row (use --map with numbers)
  --no-bom             do not start the output with a UTF-8 byte-order mark
  --quiet              no summary on screen
  --version            print the version
  -h, --help           this text

Exit code: 0 done; 1 invalid share over --fail-over; 2 bad arguments or file problem.
Output columns added: tac_status, tac_codes, tac_message, tac_changes.

${EXPORT_USAGE}
${DATA_LINES}`

const FINDING_ORDER = [
  'PARENT_MISMATCH',
  'POSTAL_CODE_MISMATCH',
  'POSTAL_CODE_INVALID',
  'UNKNOWN_NAME',
  'MISSPELLED_NAME',
  'ABOLISHED_AREA',
  'AMBIGUOUS',
  'MISSING_FIELD',
  'FORMAT_NORMALIZED',
]

function pct(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`
}

/** The summary as the lines printed to the screen. */
export function formatSummary(s: FileSummary): string {
  const lines = [
    `ตรวจ ${s.rows.toLocaleString('en-US')} แถว / checked ${s.rows.toLocaleString('en-US')} rows in ${(s.elapsedMs / 1000).toFixed(1)} s (data ${s.dataVersion})`,
    `  valid ${s.statuses.valid} (${pct(s.statuses.valid, s.rows)}) · corrected ${s.statuses.corrected} (${pct(s.statuses.corrected, s.rows)}) · ambiguous ${s.statuses.ambiguous} (${pct(s.statuses.ambiguous, s.rows)}) · invalid ${s.statuses.invalid} (${pct(s.statuses.invalid, s.rows)})`,
  ]
  if (s.blankRowsSkipped > 0) lines.push(`  skipped ${s.blankRowsSkipped} blank row${s.blankRowsSkipped === 1 ? '' : 's'} (every cell empty)`)
  // FORMAT_NORMALIZED is information, not a problem (a valid row can carry it): its own line, so a
  // fully valid file does not show a "findings:" line that looks like one.
  const codes = Object.keys(s.findings)
    .filter((c) => c !== 'FORMAT_NORMALIZED')
    .sort((a, b) => FINDING_ORDER.indexOf(a) - FINDING_ORDER.indexOf(b))
  if (codes.length > 0) lines.push(`  findings: ${codes.map((c) => `${c} ${s.findings[c]}`).join(' · ')}`)
  const cleaned = s.findings.FORMAT_NORMALIZED ?? 0
  if (cleaned > 0) lines.push(`  formatting cleaned in ${cleaned} row${cleaned === 1 ? '' : 's'} (meaning unchanged, not a problem)`)
  lines.push(`  columns: ${Object.entries(s.columns).map(([f, c]) => `${f}="${c}"`).join(' ')}${s.autoCorrect ? '' : ' (report only, no changes)'}`)
  lines.push(`  -> ${s.output}`)
  return `${lines.join('\n')}\n`
}

function number(name: string, text: string | undefined, min: number, max: number): number | undefined {
  if (text === undefined) return undefined
  const n = Number(text)
  if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
    throw new RangeError(`${name} must be a number from ${min} to ${max}, got "${text}"`)
  }
  return n
}

/** The version in package.json (next to `dist/` in the published package, next to `src/` in the repo). */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

const WRITE_REASON: Record<string, string> = {
  ENOENT: 'the directory does not exist',
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EISDIR: 'it is a directory',
  ENOTDIR: 'a part of the path is not a directory',
  EROFS: 'the file system is read-only',
}

/**
 * The message for an error thrown while running: a bad argument as it is, and a file error
 * attributed to the file that failed, so a missing output directory is not reported as a missing input.
 */
function fileErrorMessage(e: NodeJS.ErrnoException, input: string, out: string | undefined, report: string | undefined): string {
  if (e instanceof ColumnError || e instanceof RangeError) return e.message
  const same = (a: string | undefined, b: string | undefined): boolean => a !== undefined && b !== undefined && resolve(a) === resolve(b)
  const reason = WRITE_REASON[e.code ?? ''] ?? e.message
  if (same(e.path, report)) return `Cannot write report ${report}: ${reason}`
  if (same(e.path, out ?? defaultOutputPath(input))) return `Cannot write output ${e.path}: ${reason}`
  return e.code === 'ENOENT' ? `File not found: ${e.path ?? input}` : e.message
}

function exportCells(r: AddressRow): string[] {
  return [
    r.provinceCode,
    r.provinceNameTh,
    r.provinceNameEn,
    r.districtCode,
    r.districtNameTh,
    r.districtNameEn,
    r.subdistrictCode,
    r.subdistrictNameTh,
    r.subdistrictNameEn,
    r.postalCode,
  ]
}

/** JSON of the rows: one row per line, so the file diffs line by line between data versions. */
function exportJson(rows: readonly AddressRow[]): string {
  return rows.length === 0 ? '[]\n' : `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`
}

/**
 * `thai-address-check export`: the reference data as CSV or JSON, on stdout or in a file. The data
 * goes to stdout (or the file) only; the row count and the credit line go to stderr.
 */
export async function exportMain(argv: string[], io: Io): Promise<number> {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        format: { type: 'string', default: 'csv' },
        out: { type: 'string' },
        'no-bom': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }))
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${EXPORT_USAGE}`)
    return 2
  }
  if (values.help) {
    io.stdout(`${EXPORT_USAGE}\n${DATA_LINES}`)
    return 0
  }
  const format = values.format
  if (format !== 'csv' && format !== 'json') {
    io.stderr(`Unknown --format "${format}": use csv or json.\n\n${EXPORT_USAGE}`)
    return 2
  }
  const rows = listAddresses()
  const bom = !values['no-bom']
  try {
    if (values.out === undefined) {
      if (format === 'json') io.stdout(exportJson(rows))
      else {
        // In chunks, so a pipe gets data early and no single string holds the whole file.
        let chunk = (bom ? CSV_BOM : '') + csvRecord(EXPORT_COLUMNS)
        for (const r of rows) {
          chunk += csvRecord(exportCells(r))
          if (chunk.length >= 64 * 1024) {
            io.stdout(chunk)
            chunk = ''
          }
        }
        io.stdout(chunk)
      }
    } else if (format === 'json') {
      await writeFile(values.out, exportJson(rows))
    } else {
      const writer = new CsvWriter(values.out, ',', bom)
      await writer.row(EXPORT_COLUMNS)
      for (const r of rows) await writer.row(exportCells(r))
      await writer.close()
    }
  } catch (error) {
    const e = error as NodeJS.ErrnoException
    io.stderr(`thai-address-check: Cannot write output ${values.out}: ${WRITE_REASON[e.code ?? ''] ?? e.message}\n`)
    return 2
  }
  io.stderr(
    `exported ${rows.length.toLocaleString('en-US')} rows (data ${dataVersion}) as ${format}${values.out === undefined ? '' : ` -> ${values.out}`}\n${CREDIT}\n`,
  )
  return 0
}

/**
 * Runs the command.
 *
 * @param argv - Arguments after the program name.
 * @param io - Where to write; stdout stays empty (the result is the output file), stderr gets the summary.
 * @returns The exit code: 0, 1 (over `--fail-over`) or 2 (bad arguments, unreadable file).
 */
export async function main(argv: string[], io: Io): Promise<number> {
  // 'export' is a command word; a file with that exact name is checked as ./export.
  if (argv[0] === 'export') return exportMain(argv.slice(1), io)
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        report: { type: 'string' },
        threshold: { type: 'string' },
        'no-fix': { type: 'boolean' },
        'fail-over': { type: 'string' },
        map: { type: 'string', multiple: true },
        sheet: { type: 'string' },
        delimiter: { type: 'string' },
        'no-header': { type: 'boolean' },
        'no-bom': { type: 'boolean' },
        quiet: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
    })
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help) {
    io.stdout(USAGE)
    return 0
  }
  if (values.version) {
    io.stdout(`${packageVersion()}\n`)
    return 0
  }
  if (positionals.length !== 1 || positionals[0] === undefined) {
    io.stderr(`Give exactly one file.\n\n${USAGE}`)
    return 2
  }
  try {
    const threshold = number('--threshold', values.threshold, 0, 1)
    const failOver = number('--fail-over', values['fail-over'], 0, 100)
    const summary = await checkFile({
      input: positionals[0],
      ...(values.out === undefined ? {} : { output: values.out }),
      ...(values.map === undefined ? {} : { map: values.map }),
      ...(values.sheet === undefined ? {} : { sheet: values.sheet }),
      ...(values.delimiter === undefined ? {} : { delimiter: values.delimiter === 'tab' || values.delimiter === '\\t' ? '\t' : values.delimiter }),
      ...(threshold === undefined ? {} : { autoCorrectThreshold: threshold }),
      autoCorrect: !values['no-fix'],
      header: !values['no-header'],
      bom: !values['no-bom'],
    })
    if (values.report) await writeFile(values.report, `${JSON.stringify(summary, null, 2)}\n`)
    if (!values.quiet) io.stderr(formatSummary(summary))
    if (failOver !== undefined && summary.invalidPercent > failOver) {
      io.stderr(`ล้มเหลว / FAIL: invalid ${summary.invalidPercent.toFixed(1)}% is over --fail-over ${failOver}%\n`)
      return 1
    }
    return 0
  } catch (error) {
    const e = error as NodeJS.ErrnoException
    io.stderr(`thai-address-check: ${fileErrorMessage(e, positionals[0], values.out, values.report)}\n`)
    return 2
  }
}

// Run when started as a command, not when imported (tests import `main`). npm starts a bin through
// a symlink, so compare real paths.
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  // A reader that stops early (`export | head`) closes the pipe: that is a normal end, not a crash
  // with a stack trace (tac-night F17).
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0)
    throw error
  })
  main(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  }).then((code) => {
    process.exitCode = code
  })
}
