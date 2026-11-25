/** Helpers shared by the file and CLI tests: temp dirs, a TIS-620 encoder, a minimal XLSX writer. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { openCsv } from '../../src/file/csv'

/** A fresh temp directory, removed by the returned `done()`. */
export async function tempDir(): Promise<{ dir: string; done: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'tac-file-'))
  return { dir, done: () => rm(dir, { recursive: true, force: true }) }
}

/** Reads a CSV the way the checker does and returns all rows. */
export async function readCsvFile(path: string, delimiter?: string): Promise<string[][]> {
  const source = await openCsv(path, delimiter)
  const rows: string[][] = []
  for await (const row of source.rows) rows.push(row)
  return rows
}

/** Reads a file as text, UTF-8, keeping a leading byte-order mark if present. */
export async function readText(path: string): Promise<string> {
  return (await readFile(path)).toString('utf8')
}

/**
 * Encodes text as windows-874 (TIS-620 plus Microsoft's extras), the code page Thai Excel saves a
 * 'CSV' in. Only ASCII and the Thai letters block are supported, which is all the tests use.
 */
export function encodeWindows874(text: string): Buffer {
  const bytes: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x80) bytes.push(cp)
    else if (cp >= 0x0e01 && cp <= 0x0e3a) bytes.push(cp - 0x0e01 + 0xa1)
    else if (cp >= 0x0e3f && cp <= 0x0e5b) bytes.push(cp - 0x0e3f + 0xdf)
    else throw new Error(`cannot encode U+${cp.toString(16)} as windows-874`)
  }
  return Buffer.from(bytes)
}

function zipStored(files: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.from(text)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    parts.push(local, nameBytes, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/**
 * Writes a one- or two-sheet .xlsx. Strings are inline strings; a JS number is a numeric cell, which
 * is how a postal code typed into Excel is usually stored.
 */
export async function writeXlsx(path: string, sheets: Record<string, (string | number)[][]>): Promise<void> {
  const names = Object.keys(sheets)
  const column = (i: number): string => String.fromCharCode(65 + i)
  const sheetXml = (rows: (string | number)[][]): string =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((v, c) =>
              typeof v === 'number'
                ? `<c r="${column(c)}${r + 1}"><v>${v}</v></c>`
                : `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`,
            )
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  }
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n] as (string | number)[][])
  })
  await writeFile(path, zipStored(files))
}
