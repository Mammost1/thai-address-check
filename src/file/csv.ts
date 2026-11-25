/**
 * Streaming CSV in and out. Rows are read and written one at a time with back-pressure, so the
 * memory used does not depend on the size of the file.
 */
import { once } from 'node:events'
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { parse } from 'csv-parse'

/** Text encodings a CSV is read as: UTF-8, or the Thai Windows code page Excel writes. */
export type CsvEncoding = 'utf-8' | 'windows-874'

const SNIFF_BYTES = 64 * 1024

/**
 * Chooses the encoding from the start of the file: UTF-8 when the first 64 KB decode as UTF-8,
 * otherwise windows-874 (TIS-620 with Microsoft's extras), which Thai Excel saves as 'CSV'.
 */
export async function sniffEncoding(path: string): Promise<{ encoding: CsvEncoding; sample: string }> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0)
    const bytes = buffer.subarray(0, bytesRead)
    try {
      // stream: true lets a character cut in half by the sample boundary pass.
      return { encoding: 'utf-8', sample: new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true }) }
    } catch {
      return { encoding: 'windows-874', sample: new TextDecoder('windows-874').decode(bytes) }
    }
  } finally {
    await handle.close()
  }
}

/** Picks comma, semicolon or tab from the first line of the file: the one used most outside quotes. */
export function sniffDelimiter(sample: string): string {
  const first = sample.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
  let quoted = false
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of first) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1
  }
  let best = ','
  for (const d of [';', '\t']) if ((counts[d] ?? 0) > (counts[best] ?? 0)) best = d
  return best
}

/** What was read from the start of a CSV before streaming its rows. */
export interface CsvSource {
  encoding: CsvEncoding
  delimiter: string
  rows: AsyncIterable<string[]>
}

/**
 * Opens a CSV for streaming. Each row is an array of cell texts; blank lines are skipped and rows
 * with a different number of cells are kept as they are.
 *
 * @param path - The file to read.
 * @param delimiter - Force a delimiter; by default it is sniffed from the first line.
 */
export async function openCsv(path: string, delimiter?: string): Promise<CsvSource> {
  const { encoding, sample } = await sniffEncoding(path)
  const chosen = delimiter ?? sniffDelimiter(sample)
  const parser = parse({
    delimiter: chosen,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: false,
  })
  let source = createReadStream(path).on('error', (e) => parser.destroy(e))
  if (encoding === 'windows-874') {
    const decoder = new TextDecoder('windows-874')
    const decode = new Transform({
      transform(chunk: Buffer, _enc, done) {
        done(null, decoder.decode(chunk, { stream: true }))
      },
      flush(done) {
        done(null, decoder.decode())
      },
    })
    source = source.pipe(decode) as unknown as typeof source
  }
  source.pipe(parser)
  return { encoding, delimiter: chosen, rows: parser as AsyncIterable<string[]> }
}

/** One cell as CSV text: quoted when it holds the delimiter, a quote or a line break. */
export function csvCell(value: string, delimiter = ','): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** One row as a CSV line, without the line break. */
export function csvLine(cells: readonly string[], delimiter = ','): string {
  return cells.map((c) => csvCell(c, delimiter)).join(delimiter)
}

/** The UTF-8 byte-order mark every CSV this package writes starts with, unless asked not to (Excel needs it for Thai). */
export const CSV_BOM = '\uFEFF'

/** One row as a CSV record: the line plus the CRLF line break (RFC 4180). */
export function csvRecord(cells: readonly string[], delimiter = ','): string {
  return `${csvLine(cells, delimiter)}\r\n`
}

/** A buffered CSV writer that waits for the disk when it falls behind. */
export class CsvWriter {
  private readonly stream: WriteStream
  private buffer: string[] = []
  private size = 0

  constructor(
    path: string,
    private readonly delimiter: string,
    bom: boolean,
  ) {
    this.stream = createWriteStream(path, { encoding: 'utf8' })
    if (bom) this.buffer.push(CSV_BOM)
  }

  /** Adds one row; flushes to the file (and waits if the file is slow) every 64 KB. */
  async row(cells: readonly string[]): Promise<void> {
    const line = csvRecord(cells, this.delimiter)
    this.buffer.push(line)
    this.size += line.length
    if (this.size >= 64 * 1024) await this.flush()
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const chunk = this.buffer.join('')
    this.buffer = []
    this.size = 0
    if (!this.stream.write(chunk)) await once(this.stream, 'drain')
  }

  /** Writes what is left and closes the file. */
  async close(): Promise<void> {
    await this.flush()
    this.stream.end()
    await once(this.stream, 'finish')
  }
}
