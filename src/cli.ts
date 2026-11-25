#!/usr/bin/env node
/**
 * Feature 8: the `thai-address-check` command.
 *
 *   thai-address-check <file> [--out f] [--report f.json] [--threshold n] [--no-fix]
 *                      [--fail-over pct] [--map field=column] [--sheet s] [--no-header]
 *
 * Exit code: 0 done, 1 the invalid share is over --fail-over, 2 bad arguments or a file problem.
 */
import { realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ColumnError } from './file/columns'
import { checkFile, type FileSummary } from './file/run'

/** Where the command writes; replaced in tests. */
export interface Io {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

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
  --delimiter <c>      CSV delimiter (default: sniffed)
  --no-header          the file has no header row (use --map with numbers)
  --no-bom             do not start the output with a UTF-8 byte-order mark
  --quiet              no summary on screen
  -h, --help           this text

Exit code: 0 done; 1 invalid share over --fail-over; 2 bad arguments or file problem.
Output columns added: tac_status, tac_codes, tac_message, tac_changes.
`

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
  const codes = Object.keys(s.findings).sort((a, b) => FINDING_ORDER.indexOf(a) - FINDING_ORDER.indexOf(b))
  if (codes.length > 0) lines.push(`  findings: ${codes.map((c) => `${c} ${s.findings[c]}`).join(' · ')}`)
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

/**
 * Runs the command.
 *
 * @param argv - Arguments after the program name.
 * @param io - Where to write; stdout stays empty (the result is the output file), stderr gets the summary.
 * @returns The exit code: 0, 1 (over `--fail-over`) or 2 (bad arguments, unreadable file).
 */
export async function main(argv: string[], io: Io): Promise<number> {
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
      ...(values.delimiter === undefined ? {} : { delimiter: values.delimiter }),
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
    const message = error instanceof ColumnError || error instanceof RangeError ? e.message : e.code === 'ENOENT' ? `File not found: ${e.path ?? positionals[0]}` : e.message
    io.stderr(`thai-address-check: ${message}\n`)
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
  main(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  }).then((code) => {
    process.exitCode = code
  })
}
