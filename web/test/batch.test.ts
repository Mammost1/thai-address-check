import { describe, expect, it } from 'vitest'
import { addressOf, checkRows, OUTPUT_COLUMNS, outputRows, summarize } from '../src/lib/batch'

// Real cases from docs/TASKS.md (A7).
const ROWS = [
  ['id', 'province', 'district', 'subdistrict', 'zip'],
  ['1', 'สุราษฎร์ธานี', 'เกาะพะงัน', 'เกาะพะงัน', '84280'],
  ['2', 'สุราษฎร์ธานี', 'เกาะพะงัน', 'เกาะพะงัน', '84360'],
  ['', '', '', '', ''],
  ['3', '', '', 'ตลาด', '84000'],
]
const MAP = { province: 1, district: 2, subdistrict: 3, postalCode: 4 }

describe('addressOf', () => {
  it('takes mapped cells and treats blank cells as absent', () => {
    expect(addressOf(['x', '', ' ', 'ตลาด', '84000'], MAP)).toEqual({ subdistrict: 'ตลาด', postalCode: '84000' })
  })
})

describe('checkRows', () => {
  it('checks data rows in order, skips blank rows, keeps file line numbers and reports progress', async () => {
    const progress: number[] = []
    const results = await checkRows(ROWS, MAP, {}, (n) => progress.push(n), 2)
    expect(results.map((r) => r.line)).toEqual([2, 3, 5])
    expect(results.map((r) => r.result.status)).toEqual(['valid', 'invalid', 'corrected'])
    expect(progress).toEqual([2, 4])
  })
})

describe('summary and output file', () => {
  it('counts statuses and rows per finding code', async () => {
    const s = summarize(await checkRows(ROWS, MAP, {}))
    expect(s.total).toBe(3)
    expect(s.byStatus).toEqual({ valid: 1, corrected: 1, ambiguous: 0, invalid: 1 })
    expect(s.byFinding.POSTAL_CODE_MISMATCH).toBe(1)
  })

  it('keeps every original column and appends the checked values', async () => {
    const results = await checkRows(ROWS, MAP, {})
    const out = outputRows(ROWS[0] as string[], results)
    expect(out[0]).toEqual([...(ROWS[0] as string[]), ...OUTPUT_COLUMNS])
    const filled = out[3] as string[]
    expect(filled.slice(0, 5)).toEqual(ROWS[4])
    expect(filled.slice(5)).toEqual(['corrected', 'MISSING_FIELD', 'สุราษฎร์ธานี', 'เมืองสุราษฎร์ธานี', 'ตลาด', '84000', ''])
    const mismatch = out[2] as string[]
    expect(mismatch[5]).toBe('invalid')
    expect(mismatch[6]).toContain('POSTAL_CODE_MISMATCH')
    expect(mismatch[11]).toContain('postalCode=84280')
  })
})
