import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CREDIT, main } from '../src/cli'
import { dataVersion, listAddresses } from '../src/index'
import { readCsvFile, readText, tempDir } from './file/fixtures'

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

const HEADER = 'province_code,province_name_th,province_name_en,district_code,district_name_th,district_name_en,subdistrict_code,subdistrict_name_th,subdistrict_name_en,postal_code'
const rows = listAddresses()

describe('thai-address-check export (tac-night A2)', () => {
  it('default: CSV on stdout with BOM, snake_case header, CRLF, one line per row; credit on stderr', async () => {
    const r = await run(['export'])
    expect(r.code).toBe(0)
    expect(r.out.startsWith(`﻿${HEADER}\r\n`)).toBe(true)
    expect(r.out.endsWith('\r\n')).toBe(true)
    expect(r.out.split('\r\n').length - 2).toBe(rows.length) // header + trailing empty
    expect(r.out).toContain('\r\n10,กรุงเทพมหานคร,Bangkok,1001,เขตพระนคร,Phra Nakhon,100101,พระบรมมหาราชวัง,Phra Borom Maha Ratchawang,10200\r\n')
    expect(r.err).toContain(`exported ${rows.length.toLocaleString('en-US')} rows (data ${dataVersion})`)
    expect(r.err).toContain(CREDIT)
  })

  it('--out writes the same bytes as stdout, read back by the CSV reader as every row', async () => {
    const out = join(dir, 'addresses.csv')
    const viaFile = await run(['export', '--out', out])
    expect(viaFile.code).toBe(0)
    expect(viaFile.out).toBe('')
    expect(await readText(out)).toBe((await run(['export'])).out)
    const back = await readCsvFile(out)
    expect(back[0]).toEqual(HEADER.split(','))
    expect(back.length - 1).toBe(rows.length)
    expect(back[1]).toEqual(Object.values(rows[0] as object))
  })

  it('--no-bom drops only the byte-order mark', async () => {
    const r = await run(['export', '--no-bom'])
    expect(r.out.startsWith(`${HEADER}\r\n`)).toBe(true)
    expect(`﻿${r.out}`).toBe((await run(['export'])).out)
  })

  it('quotes a cell with a comma or quote (RFC 4180), through the shared writer', async () => {
    const r = await run(['export'])
    const quoted = r.out.split('\r\n').filter((l) => l.includes('"'))
    for (const line of quoted) expect(line).toMatch(/(^|,)"([^"]|"")*"(,|$)/)
    // Every line has the 10 fields once parsed (no stray delimiter from an unquoted comma).
    const out = join(dir, 'a.csv')
    await writeFile(out, r.out)
    for (const cells of await readCsvFile(out)) expect(cells.length).toBe(10)
  })

  it('--format json: an array of AddressRow equal to listAddresses(), to stdout or --out', async () => {
    const r = await run(['export', '--format', 'json'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toEqual(rows)
    expect(r.err).toContain(CREDIT)
    const out = join(dir, 'a.json')
    expect((await run(['export', '--format', 'json', '--out', out])).code).toBe(0)
    expect(await readFile(out, 'utf8')).toBe(r.out)
  })

  it.each([['xml'], ['CSV'], ['']])('unknown --format %j exits 2 with the usage line and writes nothing', async (f) => {
    const r = await run(['export', '--format', f])
    expect(r.code).toBe(2)
    expect(r.out).toBe('')
    expect(r.err).toContain('thai-address-check export [--format csv|json]')
  })

  it('an unknown option or a stray argument exits 2', async () => {
    expect((await run(['export', '--nope'])).code).toBe(2)
    expect((await run(['export', 'file.csv'])).code).toBe(2)
  })

  it('--out into a missing directory exits 2 naming the output', async () => {
    const out = join(dir, 'missing', 'a.csv')
    const r = await run(['export', '--out', out])
    expect(r.code).toBe(2)
    expect(r.err).toContain(`Cannot write output ${out}`)
    expect(existsSync(out)).toBe(false)
  })

  // The audit flow from the README: a table seeded from export, exported back to CSV, checked as is.
  // Before tac-night the checker stopped with 'Several columns look like province' on these headers.
  it('an exported CSV is checked without --map: Thai name columns found, every row valid, nothing changed', async () => {
    const csv = join(dir, 'addresses.csv')
    const report = join(dir, 'report.json')
    expect((await run(['export', '--out', csv])).code).toBe(0)
    const r = await run([csv, '--no-fix', '--fail-over', '0', '--report', report, '--quiet'])
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    const summary = JSON.parse(await readFile(report, 'utf8')) as { rows: number; statuses: Record<string, number>; findings: Record<string, number>; columns: Record<string, string> }
    expect(summary.rows).toBe(rows.length)
    expect(summary.statuses.valid).toBe(rows.length)
    expect(summary.findings).toEqual({})
    expect(summary.columns).toEqual({ province: 'province_name_th', district: 'district_name_th', subdistrict: 'subdistrict_name_th', postalCode: 'postal_code' })
  })

  it('export --help prints the export usage, the data version and the credit', async () => {
    const r = await run(['export', '--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('--format <csv|json>')
    expect(r.out).toContain(`Data version: ${dataVersion}`)
    expect(r.out).toContain(CREDIT)
  })

  it('the main --help documents export, the data version and the credit', async () => {
    const r = await run(['--help'])
    expect(r.out).toContain('thai-address-check export [--format csv|json] [--out <file>]')
    expect(r.out).toContain(`Data version: ${dataVersion}`)
    expect(r.out).toContain(CREDIT)
  })

  it('only the bare word export is the command: a path to a file named export is checked', async () => {
    const input = join(dir, 'export')
    await writeFile(input, 'จังหวัด,อำเภอ,ตำบล,รหัสไปรษณีย์\nสุราษฎร์ธานี,เกาะพะงัน,เกาะพะงัน,84280\n')
    const r = await run([input, '--quiet'])
    expect(r.code).toBe(0)
    expect(existsSync(`${input}.checked.csv`)).toBe(true)
  })
})

// The built command, through a real pipe (CI also runs this after the build).
describe.skipIf(!existsSync(resolve(__dirname, '../dist/cli.js')))('built command', () => {
  it('node dist/cli.js export | ... gives every row on stdout and nothing but the summary on stderr', () => {
    const r = spawnSync(process.execPath, [resolve(__dirname, '../dist/cli.js'), 'export', '--no-bom'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    expect(r.status).toBe(0)
    expect(r.stdout.split('\r\n')[0]).toBe(HEADER)
    expect(r.stdout.split('\r\n').length - 2).toBe(rows.length)
    expect(r.stderr).toContain(CREDIT)
  })
})
