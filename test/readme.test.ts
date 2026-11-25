import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('README', () => {
  it('does not claim the package is unpublished', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).not.toMatch(/not yet published/i)
    expect(readme).not.toMatch(/ยังไม่ได้เผยแพร่/)
  })
})
