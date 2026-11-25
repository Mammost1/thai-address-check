import { describe, expect, it } from 'vitest'
import { decodeText, detectDelimiter, parseCsv, toCsv } from '../src/lib/csv'

describe('parseCsv', () => {
  it('reads quoted cells with delimiters, doubled quotes and line breaks', () => {
    const text = 'a,b,c\r\n"1, 2","say ""hi""","line\nbreak"\r\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1, 2', 'say "hi"', 'line\nbreak'],
    ])
  })

  it('keeps empty cells and handles LF, CR and a missing final newline', () => {
    expect(parseCsv('a,,c\n,b,')).toEqual([
      ['a', '', 'c'],
      ['', 'b', ''],
    ])
    expect(parseCsv('a\rb')).toEqual([['a'], ['b']])
  })

  it('detects semicolon and tab delimiters from the header', () => {
    expect(detectDelimiter('จังหวัด;อำเภอ;ตำบล\n')).toBe(';')
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('toCsv', () => {
  it('round-trips through parseCsv and starts with a BOM for Excel', () => {
    const rows = [
      ['ตำบล', 'note'],
      ['บางนา', 'a, "b"\nc'],
      [' padded ', ''],
    ]
    const text = toCsv(rows)
    expect(text.startsWith('﻿')).toBe(true)
    expect(parseCsv(text.slice(1))).toEqual(rows)
  })
})

describe('decodeText', () => {
  it('reads UTF-8 and strips the BOM', () => {
    const bytes = new TextEncoder().encode('﻿ตำบล,อำเภอ')
    expect(decodeText(bytes)).toEqual({ text: 'ตำบล,อำเภอ', encoding: 'utf-8' })
  })

  it('falls back to Windows-874 (TIS-620) for old Thai Excel files', () => {
    // 'ตำบล' in TIS-620: ต=0xB5 ำ=0xD3 บ=0xBA ล=0xC5
    const bytes = new Uint8Array([0xb5, 0xd3, 0xba, 0xc5])
    expect(decodeText(bytes)).toEqual({ text: 'ตำบล', encoding: 'windows-874' })
  })
})
