/**
 * Small RFC 4180 CSV reader/writer for the browser page. Files never leave the visitor's machine.
 */

/** Bytes of a file as text: UTF-8 (with or without BOM), else Windows-874/TIS-620 (old Thai Excel). */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-874' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-874').decode(bytes), encoding: 'windows-874' }
  }
}

/** The delimiter used by the first line: comma, semicolon or tab (whichever appears most). */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  let best = ','
  let bestCount = 0
  for (const d of [',', ';', '\t']) {
    const count = firstLine.split(d).length - 1
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/**
 * Parses CSV text into rows of cells. Handles quoted cells with delimiters, doubled quotes and
 * line breaks inside quotes, CRLF/LF endings, and drops a trailing empty line.
 */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      cell += c
      i++
      continue
    }
    if (c === '"' && cell === '') {
      quoted = true
    } else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (c === '\r' && text[i + 1] === '\n') i++
    } else {
      cell += c
    }
    i++
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) || /^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/** Rows as CSV text with CRLF endings and a UTF-8 BOM so Excel opens Thai text correctly. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return '﻿' + rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n'
}
