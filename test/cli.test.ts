import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatSummary, main } from '../src/cli'
import { readCsvFile, readText, tempDir } from './file/fixtures'
import { writeSampleCsv } from './file/make-sample'

let dir: string
let done: () => Promise<void>
beforeEach(async () => {
  ;({ dir, done } = await tempDir())
})
afterEach(() => done())

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const code = await main(args, { stdout: (t) => (out += t), stderr: (t) => (err += t) })
  return { code, out, err }
}

const GOOD = 'จังหวัด,อำเภอ,ตำบล,รหัสไปรษณีย์\nสุราษฎร์ธานี,เกาะพะงัน,เกาะพะงัน,84280\n'

describe('arguments', () => {
  it('prints usage for --help on stdout and exits 0', async () => {
    const r = await run(['--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('--fail-over')
    expect(r.out).toContain('tac_status')
    expect(r.err).toBe('')
  })

  it.each([
    ['no file', []],
    ['two files', ['a.csv', 'b.csv']],
    ['an unknown option', ['--nope', 'a.csv']],
  ])('exits 2 with usage for %s', async (_name, args) => {
    const r = await run(args)
    expect(r.code).toBe(2)
    expect(r.err).toContain('thai-address-check <file')
    expect(r.out).toBe('')
  })

  it.each([
    ['--threshold', '1.5'],
    ['--threshold', 'x'],
    ['--threshold', ''],
    ['--fail-over', '-1'],
    ['--fail-over', '101'],
    ['--fail-over', 'abc'],
  ])('exits 2 for %s %s', async (flag, value) => {
    const input = join(dir, 'a.csv')
    await writeFile(input, GOOD)
    const r = await run([input, flag, value])
    expect(r.code).toBe(2)
    expect(r.err).toContain(flag)
  })

  it('exits 2 and names a missing file', async () => {
    const r = await run([join(dir, 'nope.csv')])
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/File not found: .*nope\.csv/)
  })

  it('exits 2 with the explanation when the columns cannot be found', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, 'a,b\n1,2\n')
    const r = await run([input])
    expect(r.code).toBe(2)
    expect(r.err).toContain('--map')
  })
})

describe('a run', () => {
  it('checks the file, writes the output next to it, prints the summary on stderr and nothing on stdout', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, GOOD)
    const r = await run([input])
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
    expect(r.err).toContain('checked 1 rows')
    expect(r.err).toContain('corrected 0')
    expect(r.err).toContain('valid 1')
    expect(r.err).toContain(join(dir, 'a.checked.csv'))
    expect((await readCsvFile(join(dir, 'a.checked.csv')))[1]?.[4]).toBe('valid')
  })

  it('--quiet prints no summary', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, GOOD)
    expect(await run([input, '--quiet'])).toMatchObject({ code: 0, err: '' })
  })

  it('--out and --report are written, and the report has the counts', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, GOOD)
    const r = await run([input, '--out', join(dir, 'o.csv'), '--report', join(dir, 'r.json'), '--quiet'])
    expect(r.code).toBe(0)
    const report = JSON.parse(await readText(join(dir, 'r.json')))
    expect(report).toMatchObject({ rows: 1, statuses: { valid: 1, corrected: 0, ambiguous: 0, invalid: 0 }, invalidPercent: 0 })
    expect(report.output).toBe(join(dir, 'o.csv'))
  })

  it('--no-fix reports and changes nothing; --no-bom drops the mark', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84280\n')
    const r = await run([input, '--no-fix', '--no-bom', '--out', join(dir, 'o.csv')])
    expect(r.code).toBe(0)
    expect(r.err).toContain('report only')
    const text = await readText(join(dir, 'o.csv'))
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
    expect((await readCsvFile(join(dir, 'o.csv')))[1]?.slice(0, 2)).toEqual(['เกาะพะงัน', '84280'])
  })

  it('--map, --delimiter and --no-header reach the checker', async () => {
    const input = join(dir, 'a.txt')
    await writeFile(input, 'เกาะพะงัน|84280\n')
    const r = await run([input, '--no-header', '--delimiter', '|', '--map', 'subdistrict=1,postalCode=2', '--out', join(dir, 'o.csv')])
    expect(r.code).toBe(0)
    expect(r.err).toContain('subdistrict="1"')
  })

  it('--threshold is passed on', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, 'จังหวัด,อำเภอ,ตำบล\nสุราษฎร์ธานี,เกาะพะงัน,เกาะพะงนั\n')
    expect((await run([input, '--out', join(dir, 'o1.csv')])).err).toContain('corrected 1')
    expect((await run([input, '--threshold', '1', '--out', join(dir, 'o2.csv')])).err).toContain('corrected 0')
  })
})

describe('file errors are attributed to the right file (tac-harden T6)', () => {
  const GOOD = 'ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84280\n'

  it('--out into a missing directory says the output cannot be written, not that a file is missing', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, GOOD)
    const r = await run([input, '--out', join(dir, 'no-such-dir', 'x.csv')])
    expect(r.code).toBe(2)
    expect(r.err).toContain('Cannot write output')
    expect(r.err).toContain('the directory does not exist')
    expect(r.err).not.toContain('File not found')
  })

  it('--report into a missing directory is reported as the report', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, GOOD)
    const r = await run([input, '--out', join(dir, 'o.csv'), '--report', join(dir, 'no-such-dir', 'r.json')])
    expect(r.code).toBe(2)
    expect(r.err).toContain('Cannot write report')
    expect(r.err).toContain('the directory does not exist')
  })

  it('--out that is a directory says so', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, GOOD)
    const r = await run([input, '--out', dir])
    expect(r.code).toBe(2)
    expect(r.err).toContain('Cannot write output')
    expect(r.err).toContain('it is a directory')
  })

  it('a missing INPUT is still "File not found"', async () => {
    const r = await run([join(dir, 'nope.csv')])
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/File not found: .*nope\.csv/)
  })
})

describe('--delimiter (tac-harden T5)', () => {
  it('a wrong one exits 2 and names the likely one; "tab" and the real delimiter work', async () => {
    const comma = join(dir, 'comma.csv')
    await writeFile(comma, 'ชื่อ,ตำบล,รหัสไปรษณีย์\nสมชาย,เกาะพะงัน,84280\n')
    const wrong = await run([comma, '--delimiter', ';', '--out', join(dir, 'o.csv')])
    expect(wrong.code).toBe(2)
    expect(wrong.err).toContain('the delimiter is probably ","')
    expect(wrong.err).not.toContain('invalid')
    const tab = join(dir, 'tab.csv')
    await writeFile(tab, 'ชื่อ\tตำบล\tรหัสไปรษณีย์\nสมชาย\tเกาะพะงัน\t84280\n')
    expect((await run([tab, '--delimiter', 'tab', '--quiet', '--out', join(dir, 'o2.csv')])).code).toBe(0)
    expect((await run([tab, '--delimiter', '\\t', '--quiet', '--out', join(dir, 'o3.csv')])).code).toBe(0)
    expect((await run([comma, '--delimiter', ',', '--quiet', '--out', join(dir, 'o4.csv')])).code).toBe(0)
  })
})

describe('--fail-over and blank rows (tac-harden T4)', () => {
  it('rows made only of delimiters do not count as invalid and cannot trip --fail-over', async () => {
    const input = join(dir, 'blank.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84280\n,\n,\n,\n')
    const r = await run([input, '--fail-over', '0', '--out', join(dir, 'o.csv'), '--report', join(dir, 'r.json')])
    expect(r.code).toBe(0)
    expect(r.err).toContain('checked 1 rows')
    expect(r.err).toContain('skipped 3 blank rows')
    expect(JSON.parse(await readText(join(dir, 'r.json')))).toMatchObject({ rows: 1, blankRowsSkipped: 3, invalidPercent: 0 })
  })
})

describe('--fail-over', () => {
  // 150 generated rows (~4% invalid) keep three passes well inside the timeout on a slow machine.
  it('exits 1 when the invalid share is over the limit, 0 when it is not, and never when it is not asked', { timeout: 30_000 }, async () => {
    const input = join(dir, 'sample.csv')
    await writeSampleCsv(input, 150, 3)
    const base = [input, '--quiet']

    const never = await run([...base, '--out', join(dir, 'a.csv'), '--report', join(dir, 'a.json')])
    expect(never.code).toBe(0) // no --fail-over: never fails, however many rows are invalid
    const { invalidPercent } = JSON.parse(await readText(join(dir, 'a.json'))) as { invalidPercent: number }
    expect(invalidPercent).toBeGreaterThan(0.5)
    expect(invalidPercent).toBeLessThan(50)

    const over = await run([...base, '--fail-over', '0', '--out', join(dir, 'b.csv')])
    expect(over.code).toBe(1)
    expect(over.err).toContain('FAIL')
    const under = await run([...base, '--fail-over', '50', '--out', join(dir, 'c.csv')])
    expect(under.code).toBe(0)
  })

  it('the limit is "over": exactly at the limit passes', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84280\nเกาะพะงัน,84360\n') // 1 of 2 invalid = 50%
    expect((await run([input, '--quiet', '--fail-over', '50', '--out', join(dir, 'o1.csv')])).code).toBe(0)
    expect((await run([input, '--quiet', '--fail-over', '49.9', '--out', join(dir, 'o2.csv')])).code).toBe(1)
  })

  it('still writes the output and the report when it fails', async () => {
    const input = join(dir, 'a.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84360\n')
    const r = await run([input, '--quiet', '--fail-over', '10', '--out', join(dir, 'o.csv'), '--report', join(dir, 'r.json')])
    expect(r.code).toBe(1)
    expect(JSON.parse(await readText(join(dir, 'r.json'))).invalidPercent).toBe(100)
    expect((await readCsvFile(join(dir, 'o.csv')))[1]?.[2]).toBe('invalid')
  })
})

describe('formatSummary', () => {
  it('lists the statuses, only the findings that occurred, and the columns', () => {
    const text = formatSummary({
      input: 'a.csv',
      output: 'a.checked.csv',
      rows: 1000,
      blankRowsSkipped: 0,
      statuses: { valid: 900, corrected: 50, ambiguous: 10, invalid: 40 },
      invalidPercent: 4,
      findings: { POSTAL_CODE_MISMATCH: 30, FORMAT_NORMALIZED: 120, AMBIGUOUS: 10 },
      columns: { subdistrict: 'ตำบล' },
      encoding: 'utf-8',
      delimiter: ',',
      autoCorrect: true,
      dataVersion: '2026.10.23',
      elapsedMs: 1500,
    })
    expect(text).toContain('1,000 rows')
    expect(text).toContain('valid 900 (90.0%)')
    expect(text).toContain('invalid 40 (4.0%)')
    expect(text).toContain('POSTAL_CODE_MISMATCH 30 · AMBIGUOUS 10 · FORMAT_NORMALIZED 120')
    expect(text).not.toContain('UNKNOWN_NAME')
    expect(text).toContain('subdistrict="ตำบล"')
    expect(text).toContain('a.checked.csv')
  })

  it('says how many blank rows were skipped, only when there were some', () => {
    const base = { input: 'a', output: 'b', rows: 10, blankRowsSkipped: 0, statuses: { valid: 10, corrected: 0, ambiguous: 0, invalid: 0 }, invalidPercent: 0, findings: {}, columns: {}, encoding: 'utf-8', delimiter: ',', autoCorrect: true, dataVersion: 'x', elapsedMs: 0 }
    expect(formatSummary(base)).not.toContain('blank')
    expect(formatSummary({ ...base, blankRowsSkipped: 1 })).toContain('skipped 1 blank row (every cell empty)')
    expect(formatSummary({ ...base, blankRowsSkipped: 7 })).toContain('skipped 7 blank rows')
  })

  it('shows 0.0% for an empty file instead of NaN', () => {
    const text = formatSummary({
      input: 'a',
      output: 'b',
      rows: 0,
      blankRowsSkipped: 0,
      statuses: { valid: 0, corrected: 0, ambiguous: 0, invalid: 0 },
      invalidPercent: 0,
      findings: {},
      columns: {},
      encoding: 'utf-8',
      delimiter: ',',
      autoCorrect: true,
      dataVersion: 'x',
      elapsedMs: 0,
    })
    expect(text).toContain('valid 0 (0.0%)')
    expect(text).not.toContain('NaN')
  })
})
