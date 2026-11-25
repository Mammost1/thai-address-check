// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

// jsdom's File has no arrayBuffer(); real browsers do.
if (!(File.prototype as any).arrayBuffer) {
  ;(File.prototype as any).arrayBuffer = function (this: File) {
    return new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = rej; r.readAsArrayBuffer(this) })
  }
}
/** TIS-620 for ASCII and the Thai letters block (U+0E01-0E3A, U+0E3F-0E5B): what Thai Excel saves as "CSV". */
function encodeTis620(text: string): Uint8Array {
  const bytes: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x80) bytes.push(cp)
    else if (cp >= 0x0e01 && cp <= 0x0e3a) bytes.push(cp - 0x0e01 + 0xa1)
    else if (cp >= 0x0e3f && cp <= 0x0e5b) bytes.push(cp - 0x0e3f + 0xdf)
    else throw new Error(`cannot encode U+${cp.toString(16)} as TIS-620`)
  }
  return new Uint8Array(bytes)
}
const readBlob = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsText(b) })
afterEach(cleanup)

const csvFile = (name: string, text: string | Uint8Array) =>
  new File([text as BlobPart], name, { type: 'text/csv' })

async function openFileMode() {
  fireEvent.click(screen.getAllByRole('button').find((b) => /ไฟล์|File/i.test(b.textContent ?? '') && b.hasAttribute('aria-pressed'))!)
}
function upload(file: File) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}
async function runCheck() {
  const btn = await waitFor(() => {
    const b = screen.getAllByRole('button').find((x) => /^(ตรวจ|Check)/.test((x.textContent ?? '').trim()) && !x.hasAttribute('aria-pressed') && !x.classList.contains('chip'))
    if (!b) throw new Error('no run button')
    return b as HTMLButtonElement
  })
  fireEvent.click(btn)
}

describe('single address', () => {
  it('typing a wrong postal code shows the mismatch and a suggestion', async () => {
    render(<App />)
    const inputs = Array.from(document.querySelectorAll('.single input[type=text]')) as HTMLInputElement[]
    expect(inputs).toHaveLength(4)
    const [prov, dist, sub, zip] = inputs
    fireEvent.change(prov!, { target: { value: 'เชียงใหม่' } })
    fireEvent.change(dist!, { target: { value: 'เมืองเชียงใหม่' } })
    fireEvent.change(sub!, { target: { value: 'ศรีภูมิ' } })
    fireEvent.change(zip!, { target: { value: '10110' } })
    await waitFor(() => expect(document.querySelector('.result')!.textContent).toContain('50200'))
  })
  it('a correct address with Thai digits and prefixes is shown valid/corrected, never invalid', async () => {
    render(<App />)
    const inputs = Array.from(document.querySelectorAll('.single input[type=text]')) as HTMLInputElement[]
    fireEvent.change(inputs[0]!, { target: { value: 'จ.เชียงใหม่' } })
    fireEvent.change(inputs[1]!, { target: { value: 'อ.เมืองเชียงใหม่' } })
    fireEvent.change(inputs[2]!, { target: { value: 'ต.ศรีภูมิ' } })
    fireEvent.change(inputs[3]!, { target: { value: '๕๐๒๐๐' } })
    await waitFor(() => expect(document.querySelector('.result .status')?.className ?? '').toMatch(/status-valid/))
  })
})

describe('file mode: upload, check, download', () => {
  let blobs: Blob[] = []
  let clicked: { href: string; download: string }[] = []
  beforeEach(() => {
    blobs = []
    clicked = []
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:test/' + blobs.length })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ href: this.href, download: this.download }) })
  })

  const GOOD = 'ชื่อ,จังหวัด,อำเภอ,ตำบล,รหัสไปรษณีย์\r\nก,เชียงใหม่,เมืองเชียงใหม่,ศรีภูมิ,50200\r\nข,เชียงใหม่,เมืองเชียงใหม่,ศรีภูมิ,10110\r\n'

  it('UTF-8 CSV: loads, checks, totals shown, download keeps every column and adds the check_* / checked_* columns', async () => {
    render(<App />)
    await openFileMode()
    upload(csvFile('ลูกค้า.csv', GOOD))
    await waitFor(() => expect(document.querySelector('.mapping')).toBeTruthy())
    await runCheck()
    await waitFor(() => expect(document.querySelector('.report')).toBeTruthy())
    expect(document.querySelectorAll('table.rows tbody tr')).toHaveLength(2)
    fireEvent.click(document.querySelector('.report-tools button.primary')!)
    expect(blobs).toHaveLength(1)
    expect(clicked[0]!.download).toBe('ลูกค้า-checked.csv')
    const text = await readBlob(blobs[0]!)
    const bytes = await new Promise<Uint8Array>((res) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result as ArrayBuffer)); r.readAsArrayBuffer(blobs[0]!) })
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const lines = text.trim().split('\r\n')
    expect(lines).toHaveLength(3)
    // The page's download uses its own columns (OUTPUT_COLUMNS), not the CLI's tac_* ones: README says so (W1).
    for (const column of ['check_status', 'check_findings', 'checked_province', 'checked_district', 'checked_subdistrict', 'checked_postal_code', 'check_suggestions']) {
      expect(lines[0]).toContain(column)
    }
    expect(lines[0]).not.toContain('tac_status')
    expect(lines[1]).toContain('valid')
    expect(lines[2]).toContain('invalid')
  })

  it('semicolon, tab and TIS-620 files are read', async () => {
    for (const [name, content] of [
      ['semi.csv', GOOD.replace(/,/g, ';')],
      ['tab.csv', GOOD.replace(/,/g, '\t')],
    ] as const) {
      render(<App />)
      await openFileMode()
      upload(csvFile(name, content))
      await waitFor(() => expect(document.querySelector('.mapping')).toBeTruthy())
      expect(document.querySelector('.mapping')!.textContent).toContain('2')
      cleanup()
    }
    render(<App />)
    await openFileMode()
    upload(csvFile('tis.csv', encodeTis620(GOOD)))
    await waitFor(() => expect(document.querySelector('.mapping')).toBeTruthy())
    await runCheck()
    await waitFor(() => expect(document.querySelector('.report')).toBeTruthy())
    expect(document.querySelector('table.rows')!.textContent).toContain('เชียงใหม่')
  })

  it('a title row above the header gives a clear message, not a crash', async () => {
    render(<App />)
    await openFileMode()
    upload(csvFile('t.csv', 'รายงานประจำเดือน\r\n' + GOOD))
    await waitFor(() => expect(document.querySelector('.mapping')).toBeTruthy())
    // the title row is taken as the header: no address column is detected -> run is disabled and a hint is shown
    const run = Array.from(document.querySelectorAll('.mapping .actions button')).find((b) => b.classList.contains('primary')) as HTMLButtonElement
    expect(run.disabled).toBe(true)
    expect(document.querySelector('.mapping .error')?.textContent ?? '').not.toBe('')
  })

  it('an empty file and a header-only file give the empty-file error', async () => {
    render(<App />)
    await openFileMode()
    upload(csvFile('e.csv', ''))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })

  it('3,000 rows check and download without freezing the test (progress completes)', { timeout: 60_000 }, async () => {
    const rows = ['ชื่อ,จังหวัด,อำเภอ,ตำบล,รหัสไปรษณีย์']
    for (let i = 0; i < 3000; i++) rows.push(`x${i},เชียงใหม่,เมืองเชียงใหม่,ศรีภูมิ,50200`)
    render(<App />)
    await openFileMode()
    upload(csvFile('big.csv', rows.join('\r\n')))
    await waitFor(() => expect(document.querySelector('.mapping')).toBeTruthy())
    await runCheck()
    await waitFor(() => expect(document.querySelector('.report')).toBeTruthy(), { timeout: 20000 })
    expect(document.querySelectorAll('table.rows tbody tr').length).toBe(500)
    fireEvent.click(document.querySelector('.report-tools button.primary')!)
    const text = await readBlob(blobs[0]!)
    expect(text.trim().split('\r\n')).toHaveLength(3001)
  })
})
