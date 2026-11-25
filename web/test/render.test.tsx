import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from '../src/App'

describe('page renders without a browser', () => {
  it('renders the Thai page with the default example checked and the credit', () => {
    const html = renderToString(<App />)
    expect(html).toContain('ตรวจที่อยู่ไทย')
    expect(html).toContain('รหัสไปรษณีย์ไม่ตรง')
    expect(html).toContain('84280')
    expect(html).toContain('CC BY 4.0')
  })

  it('keeps both modes mounted and announces only a short status line (review F1, F2)', () => {
    const html = renderToString(<App />)
    // The CSV panel is rendered but hidden, so switching modes cannot drop a loaded file.
    expect(html).toMatch(/<div hidden="">\s*<div class="file">/)
    expect(html).toContain('วางไฟล์ CSV ที่นี่')
    // Exactly the two short status regions are live; the result panel is not.
    expect(html.match(/aria-live=/g)).toHaveLength(2)
    expect(html).not.toMatch(/class="result"[^>]*aria-live/)
  })
})

