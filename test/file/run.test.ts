import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ColumnError } from '../../src/file/columns'
import { ADDED_COLUMNS, checkFile, defaultOutputPath } from '../../src/file/run'
import { encodeWindows874, readCsvFile, readText, tempDir, writeXlsx } from './fixtures'
import { sampleRows, SAMPLE_HEADER, writeSampleCsv } from './make-sample'

let dir: string
let done: () => Promise<void>
beforeEach(async () => {
  ;({ dir, done } = await tempDir())
})
afterEach(() => done())

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false)
const col = (name: string): number => [...SAMPLE_HEADER, ...ADDED_COLUMNS].indexOf(name)

describe('defaultOutputPath', () => {
  it('replaces the extension with .checked.csv', () => {
    expect(defaultOutputPath('/a/b/addr.csv')).toBe('/a/b/addr.checked.csv')
    expect(defaultOutputPath('x.xlsx')).toBe('x.checked.csv')
    expect(defaultOutputPath('noext')).toBe('noext.checked.csv')
  })
})

describe('checkFile on a generated file with known injected problems', { timeout: 30_000 }, () => {
  const N = 600
  const { rows: source, injected } = sampleRows(N, 1)

  it('writes every row with the original columns, the added columns, and the right verdicts', async () => {
    const input = join(dir, 'sample.csv')
    await writeSampleCsv(input, N, 1)
    const summary = await checkFile({ input })

    expect(summary.rows).toBe(N)
    expect(Object.values(summary.statuses).reduce((a, b) => a + b, 0)).toBe(N)
    expect(summary.output).toBe(join(dir, 'sample.checked.csv'))
    expect(summary.columns).toEqual({ province: 'จังหวัด', district: 'อำเภอ', subdistrict: 'ตำบล', postalCode: 'รหัสไปรษณีย์' })
    expect(summary.dataVersion).toMatch(/^\d{4}\.\d+\.\d+$/)

    const out = await readCsvFile(summary.output)
    expect(out[0]).toEqual([...SAMPLE_HEADER, ...ADDED_COLUMNS])
    expect(out).toHaveLength(N + 1)

    const tally: Record<string, Record<string, number>> = {}
    out.slice(1).forEach((row, i) => {
      const kind = injected[i] as string
      const status = row[col('tac_status')] as string
      tally[kind] ??= {}
      tally[kind][status] = (tally[kind][status] ?? 0) + 1
      // The columns the checker does not own come back untouched, quoting and line breaks included.
      expect(row[0]).toBe(source[i + 1]?.[0])
      expect(row[1]).toBe(source[i + 1]?.[1])
      const original = source[i + 1] as string[]
      if (status === 'invalid' || status === 'ambiguous') {
        expect(row.slice(2, 6)).toEqual(original.slice(2, 6)) // never rewritten
      }
    })
    // Clean rows are valid; formatting noise is cleaned (still valid); missing fields are filled.
    expect(tally.clean).toEqual({ valid: tally.clean?.valid })
    expect(Object.keys(tally.noise ?? {})).toEqual(['valid'])
    expect(Object.keys(tally.missing ?? {}).sort()).toEqual(expect.arrayContaining(['corrected']))
    // A wrong postal code and an unknown name are never called valid.
    expect(Object.keys(tally['wrong-postal'] ?? {})).not.toContain('valid')
    expect(tally.unknown).toEqual({ invalid: tally.unknown?.invalid })
  })

  it('writes the cleaned value into the cell and says what changed', async () => {
    const input = join(dir, 'sample.csv')
    await writeSampleCsv(input, N, 1)
    const summary = await checkFile({ input })
    const out = (await readCsvFile(summary.output)).slice(1)
    const i = injected.indexOf('noise')
    expect(i).toBeGreaterThan(-1)
    const row = out[i] as string[]
    const original = source[i + 1] as string[]
    expect(original[4]).toMatch(/^ต\./)
    expect(row[4]).toBe((original[4] as string).slice(2))
    expect(row[5]).toMatch(/^\d{5}$/)
    expect(row[col('tac_changes')]).toContain('subdistrict: ต.')
    expect(row[col('tac_status')]).toBe('valid')
  })

  it('fills missing district and province in their own columns and reports a Thai message', async () => {
    const input = join(dir, 'sample.csv')
    await writeSampleCsv(input, N, 1)
    const out = (await readCsvFile((await checkFile({ input })).output)).slice(1)
    const i = injected.findIndex((k, n) => k === 'missing' && out[n]?.[col('tac_status')] === 'corrected')
    expect(i).toBeGreaterThan(-1)
    const row = out[i] as string[]
    expect(row[2]).not.toBe('')
    expect(row[3]).not.toBe('')
    expect(row[col('tac_codes')]).toContain('MISSING_FIELD')
    expect(row[col('tac_message')]).toMatch(/[฀-๿]/)
    expect(row[col('tac_changes')]).toMatch(/^province: \+.+; district: \+/)
  })

  it('with autoCorrect off, changes no cell and still reports', async () => {
    const input = join(dir, 'sample.csv')
    await writeSampleCsv(input, N, 1)
    const summary = await checkFile({ input, autoCorrect: false })
    expect(summary.autoCorrect).toBe(false)
    expect(summary.statuses.corrected).toBe(0)
    const out = (await readCsvFile(summary.output)).slice(1)
    out.forEach((row, i) => {
      expect(row.slice(0, 6)).toEqual(source[i + 1])
      expect(row[col('tac_changes')]).toBe('')
    })
  })

  it('counts each finding code once per row', async () => {
    const input = join(dir, 'sample.csv')
    await writeSampleCsv(input, N, 1)
    const { findings, rows } = await checkFile({ input })
    for (const count of Object.values(findings)) expect(count).toBeLessThanOrEqual(rows)
    expect(findings.FORMAT_NORMALIZED).toBeGreaterThan(0)
  })
})

describe('checkFile input handling', () => {
  it('uses --map over detection, and works with arbitrary header names', async () => {
    const input = join(dir, 'odd.csv')
    await writeFile(input, 'a,b,c\nสุราษฎร์ธานี,เกาะพะงัน,84280\n')
    const summary = await checkFile({ input, map: ['province=a,subdistrict=b,postalCode=3'] })
    expect(summary.columns).toEqual({ province: 'a', subdistrict: 'b', postalCode: 'c' })
    expect(summary.statuses.corrected).toBe(1) // the district is missing and has no column: reported only
    const [header, row] = await readCsvFile(summary.output)
    expect(header).toEqual(['a', 'b', 'c', ...ADDED_COLUMNS])
    expect(row?.[3]).toBe('corrected')
    expect(row?.[6]).toBe('district: +เกาะพะงัน')
  })

  it('reads a file without a header when columns are given by number, and writes none', async () => {
    const input = join(dir, 'nohead.csv')
    await writeFile(input, 'สุราษฎร์ธานี,เกาะพะงัน,84280\nเชียงใหม่,แม่แดด,58130\n')
    const summary = await checkFile({ input, header: false, map: ['province=1,subdistrict=2,postalCode=3'] })
    expect(summary.rows).toBe(2)
    const out = await readCsvFile(summary.output)
    expect(out).toHaveLength(2)
    expect(out[0]?.slice(0, 3)).toEqual(['สุราษฎร์ธานี', 'เกาะพะงัน', '84280'])
    expect(out[0]?.[3]).toBe('corrected') // no district column: the district is only reported
    expect(out[0]?.[6]).toBe('district: +เกาะพะงัน')
    expect(out[1]?.[3]).toBe('corrected') // แม่แดด / 58130 is a valid pair (recon A8); only the district is missing
    expect(out[1]?.[6]).toBe('district: +กัลยาณิวัฒนา')
  })

  it('reads an .xlsx, with the postal code stored as a number, and writes a CSV', async () => {
    const input = join(dir, 'a.xlsx')
    await writeXlsx(input, { s: [['จังหวัด', 'ตำบล', 'รหัสไปรษณีย์'], ['สุราษฎร์ธานี', 'เกาะพะงัน', 84280], ['สุราษฎร์ธานี', 'เกาะพะงัน', 84360]] })
    const summary = await checkFile({ input })
    expect(summary.encoding).toBe('xlsx')
    expect(summary.output).toBe(join(dir, 'a.checked.csv'))
    expect(summary.statuses).toMatchObject({ corrected: 1, invalid: 1 }) // 84280 gets its district; 84360 is wrong
    const out = await readCsvFile(summary.output)
    expect(out[1]?.[2]).toBe('84280')
  })

  it('reads the sheet asked for', async () => {
    const input = join(dir, 'two.xlsx')
    await writeXlsx(input, { first: [['x']], second: [['ตำบล', 'รหัสไปรษณีย์'], ['เกาะพะงัน', 84280]] })
    const summary = await checkFile({ input, sheet: 'second' })
    expect(summary.rows).toBe(1)
  })

  it('reads a windows-874 CSV and keeps the delimiter of the input', async () => {
    const input = join(dir, 'tis.csv')
    await writeFile(input, encodeWindows874('จังหวัด;ตำบล;รหัสไปรษณีย์\nสุราษฎร์ธานี;เกาะพะงัน;84280\n'))
    const summary = await checkFile({ input })
    expect(summary).toMatchObject({ encoding: 'windows-874', delimiter: ';' })
    const text = await readText(summary.output)
    expect(text).toContain('สุราษฎร์ธานี;เกาะพะงัน;84280;corrected')
  })

  it('starts the output with a byte-order mark unless told not to', async () => {
    const input = join(dir, 'x.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84280\n')
    const withBom = await checkFile({ input, output: join(dir, 'a.csv') })
    expect((await readText(withBom.output)).charCodeAt(0)).toBe(0xfeff)
    const without = await checkFile({ input, output: join(dir, 'b.csv'), bom: false })
    expect((await readText(without.output)).charCodeAt(0)).not.toBe(0xfeff)
  })

  it('pads a short row and keeps the long one', async () => {
    const input = join(dir, 'ragged.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์,note\nเกาะพะงัน,84280\nเกาะพะงัน,84280,x,extra\n')
    const out = await readCsvFile((await checkFile({ input })).output)
    expect(out[1]).toHaveLength(3 + ADDED_COLUMNS.length)
    expect(out[2]?.slice(0, 4)).toEqual(['เกาะพะงัน', '84280', 'x', 'extra'])
  })

  it('applies the threshold: a typo fixed at 0.9 is left alone at 1', async () => {
    const input = join(dir, 'typo.csv')
    await writeFile(input, 'จังหวัด,อำเภอ,ตำบล\nสุราษฎร์ธานี,เกาะพะงัน,เกาะพะงนั\n')
    expect((await checkFile({ input, output: join(dir, 'o1.csv') })).statuses.corrected).toBe(1)
    expect((await checkFile({ input, output: join(dir, 'o2.csv'), autoCorrectThreshold: 1 })).statuses.corrected).toBe(0)
  })

  it('counts an all-blank address row as invalid, not as an error of the file', async () => {
    const input = join(dir, 'blank.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\n,\nเกาะพะงัน,84280\n')
    const summary = await checkFile({ input })
    expect(summary.statuses).toMatchObject({ invalid: 1 })
  })

  it('handles a file with only a header', async () => {
    const input = join(dir, 'head.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\n')
    const summary = await checkFile({ input })
    expect(summary.rows).toBe(0)
    expect(summary.invalidPercent).toBe(0)
    expect(await readCsvFile(summary.output)).toHaveLength(1)
  })
})

describe('checkFile refusals', () => {
  it.each([
    ['an empty file', '', /empty/],
    ['a header that names nothing', 'a,b,c\n1,2,3\n', /No header names an address field/],
    ['only province and district columns', 'จังหวัด,อำเภอ\nน่าน,เมืองน่าน\n', /at least a subdistrict or a postal code/],
    ['two columns for one field', 'ตำบล,ตำบล\nx,y\n', /Several columns/],
  ])('rejects %s with an explanation', async (_name, text, message) => {
    const input = join(dir, 'bad.csv')
    await writeFile(input, text)
    await expect(checkFile({ input })).rejects.toThrow(ColumnError)
    await expect(checkFile({ input })).rejects.toThrow(message)
    expect(await exists(join(dir, 'bad.checked.csv'))).toBe(false)
  })

  it('rejects an old .xls', async () => {
    const input = join(dir, 'old.xls')
    await writeFile(input, 'x')
    await expect(checkFile({ input })).rejects.toThrow(/\.xls/)
  })

  it('refuses to overwrite its own input', async () => {
    const input = join(dir, 'same.csv')
    await writeFile(input, 'ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84280\n')
    await expect(checkFile({ input, output: input })).rejects.toThrow(/overwrite/)
    expect(await readText(input)).toBe('ตำบล,รหัสไปรษณีย์\nเกาะพะงัน,84280\n')
  })

  it('reports a missing input file', async () => {
    await expect(checkFile({ input: join(dir, 'nope.csv') })).rejects.toThrow(/ENOENT/)
  })

  it('does not leave a half-written output when reading fails midway', async () => {
    const input = join(dir, 'broken.csv')
    await writeFile(input, `ตำบล,รหัสไปรษณีย์\n${'เกาะพะงัน,84280\n'.repeat(50)}"never closed,1\n`)
    const output = join(dir, 'broken.checked.csv')
    await expect(checkFile({ input, output })).rejects.toThrow()
    expect(await exists(output)).toBe(false)
  })
})
