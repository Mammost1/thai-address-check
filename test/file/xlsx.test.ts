import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readXlsxRows } from '../../src/file/xlsx'
import { tempDir, writeXlsx } from './fixtures'

let dir: string
let done: () => Promise<void>
beforeEach(async () => {
  ;({ dir, done } = await tempDir())
})
afterEach(() => done())

describe('readXlsxRows', () => {
  it('reads the first sheet as text; a numeric postal code becomes its digits', async () => {
    const file = join(dir, 'a.xlsx')
    await writeXlsx(file, { 'ที่อยู่': [['ตำบล', 'รหัสไปรษณีย์'], ['เกาะพะงัน', 84280]], other: [['x']] })
    expect(await readXlsxRows(file)).toEqual([
      ['ตำบล', 'รหัสไปรษณีย์'],
      ['เกาะพะงัน', '84280'],
    ])
  })

  it('reads a sheet by name or by number', async () => {
    const file = join(dir, 'b.xlsx')
    await writeXlsx(file, { one: [['a']], two: [['b']] })
    expect(await readXlsxRows(file, 'two')).toEqual([['b']])
    expect(await readXlsxRows(file, '2')).toEqual([['b']])
  })

  it('rejects a file that is not an xlsx', async () => {
    const file = join(dir, 'c.xlsx')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'not a zip')
    await expect(readXlsxRows(file)).rejects.toThrow()
  })
})
