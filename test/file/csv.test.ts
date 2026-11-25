import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CsvWriter, csvCell, csvLine, openCsv, sniffDelimiter, sniffEncoding } from '../../src/file/csv'
import { encodeWindows874, readCsvFile, readText, tempDir } from './fixtures'

let dir: string
let done: () => Promise<void>
beforeEach(async () => {
  ;({ dir, done } = await tempDir())
})
afterEach(() => done())

describe('csv quoting', () => {
  it('quotes only what needs it', () => {
    expect(csvCell('abc')).toBe('abc')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('a;b', ';')).toBe('"a;b"')
    expect(csvCell('a,b', ';')).toBe('a,b')
    expect(csvLine(['a', 'b,c', ''])).toBe('a,"b,c",')
  })
})

describe('sniffDelimiter', () => {
  it('picks the most used of , ; tab on the first line, ignoring quoted text', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('a\tb\tc')).toBe('\t')
    expect(sniffDelimiter('"a,b,c";d;e')).toBe(';')
    expect(sniffDelimiter('﻿single')).toBe(',')
  })
})

describe('openCsv', () => {
  it('reads quoted cells with commas, quotes and line breaks, and skips blank lines', async () => {
    const file = join(dir, 'a.csv')
    await writeFile(file, 'a,b\r\n"x, ""y""\nz",2\r\n\r\n3,4\r\n')
    expect(await readCsvFile(file)).toEqual([
      ['a', 'b'],
      ['x, "y"\nz', '2'],
      ['3', '4'],
    ])
  })

  it('drops a UTF-8 byte-order mark', async () => {
    const file = join(dir, 'bom.csv')
    await writeFile(file, '﻿ตำบล,รหัส\nเกาะพะงัน,84280\n')
    const rows = await readCsvFile(file)
    expect(rows[0]).toEqual(['ตำบล', 'รหัส'])
  })

  it('keeps rows with fewer or more cells than the header', async () => {
    const file = join(dir, 'ragged.csv')
    await writeFile(file, 'a,b,c\n1\n1,2,3,4\n')
    expect(await readCsvFile(file)).toEqual([['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']])
  })

  it('sniffs and reads a semicolon file', async () => {
    const file = join(dir, 'semi.csv')
    await writeFile(file, 'ตำบล;รหัส\nเกาะพะงัน;84280\n')
    const source = await openCsv(file)
    expect(source.delimiter).toBe(';')
    expect(source.encoding).toBe('utf-8')
  })

  it('reads a Thai Excel "CSV" saved in windows-874', async () => {
    const file = join(dir, 'tis.csv')
    await writeFile(file, encodeWindows874('จังหวัด,ตำบล\nสุราษฎร์ธานี,เกาะพะงัน\n'))
    const { encoding } = await sniffEncoding(file)
    expect(encoding).toBe('windows-874')
    expect(await readCsvFile(file)).toEqual([
      ['จังหวัด', 'ตำบล'],
      ['สุราษฎร์ธานี', 'เกาะพะงัน'],
    ])
  })

  it('decodes windows-874 text that crosses a read-chunk boundary', async () => {
    const file = join(dir, 'big-tis.csv')
    const line = 'สุราษฎร์ธานี,เกาะพะงัน\n'
    await writeFile(file, encodeWindows874(`จังหวัด,ตำบล\n${line.repeat(5000)}`))
    const rows = await readCsvFile(file)
    expect(rows).toHaveLength(5001)
    expect(rows.at(-1)).toEqual(['สุราษฎร์ธานี', 'เกาะพะงัน'])
  })

  it('treats a file that is valid UTF-8 as UTF-8 even when the sample cuts a character in half', async () => {
    const file = join(dir, 'cut.csv')
    // 64 KB of 3-byte characters: the sniff window ends mid-character.
    await writeFile(file, `ก${'ก'.repeat(30000)}\n`)
    expect((await sniffEncoding(file)).encoding).toBe('utf-8')
  })

  it('fails on a quote that never closes', async () => {
    const file = join(dir, 'bad.csv')
    await writeFile(file, 'a,b\n"open,1\n')
    await expect(readCsvFile(file)).rejects.toThrow()
  })

  it('fails on a missing file', async () => {
    await expect(readCsvFile(join(dir, 'nope.csv'))).rejects.toThrow(/ENOENT/)
  })
})

describe('CsvWriter', () => {
  it('writes a byte-order mark, quotes cells and ends lines with CRLF', async () => {
    const file = join(dir, 'out.csv')
    const w = new CsvWriter(file, ',', true)
    await w.row(['a', 'b,c'])
    await w.row(['ไทย', 'say "x"'])
    await w.close()
    expect(await readText(file)).toBe('﻿a,"b,c"\r\nไทย,"say ""x"""\r\n')
  })

  it('can leave the byte-order mark out and use another delimiter', async () => {
    const file = join(dir, 'out2.csv')
    const w = new CsvWriter(file, ';', false)
    await w.row(['a;b', 'c'])
    await w.close()
    expect(await readText(file)).toBe('"a;b";c\r\n')
  })

  it('writes more than its buffer without losing a row', async () => {
    const file = join(dir, 'many.csv')
    const w = new CsvWriter(file, ',', false)
    for (let i = 0; i < 20000; i++) await w.row([String(i), 'ลูกค้า'])
    await w.close()
    const rows = await readCsvFile(file)
    expect(rows).toHaveLength(20000)
    expect(rows[19999]).toEqual(['19999', 'ลูกค้า'])
  })
})
