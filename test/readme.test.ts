import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('README', () => {
  it('does not claim the package is unpublished', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).not.toMatch(/not yet published/i)
    expect(readme).not.toMatch(/ยังไม่ได้เผยแพร่/)
  })
})

// tac-night: the README's export and data-version sentences are checked against the code, so a data bump
// that changes them fails here instead of leaving the README stale.
describe('README numbers about the shipped data', async () => {
  const { dataVersion, listAddresses } = await import('../src/index')
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const rows = listAddresses()
  const n = (x: number): string => x.toLocaleString('en-US')
  const perSub = new Map<string, number>()
  for (const r of rows) perSub.set(r.subdistrictCode, (perSub.get(r.subdistrictCode) ?? 0) + 1)
  const multi = [...perSub.values()].filter((c) => c > 1).length

  it('names the data version the code ships, in both languages', () => {
    expect(readme).toContain(`รุ่น \`${dataVersion}\``)
    expect(readme).toContain(`Data \`${dataVersion}\``)
    expect(readme).toContain(`Data shipped with this version: \`${dataVersion}\``)
  })

  it('states the row counts listAddresses() really returns', () => {
    expect(readme).toContain(`${n(rows.length)} แถว, ${n(perSub.size)} ตำบล, ${n(new Set(rows.map((r) => r.districtCode)).size)} อำเภอ/เขต, ${new Set(rows.map((r) => r.provinceCode)).size} จังหวัด`)
    expect(readme).toContain(`${n(rows.length)} rows, ${n(perSub.size)} subdistricts, ${n(new Set(rows.map((r) => r.districtCode)).size)} districts, ${new Set(rows.map((r) => r.provinceCode)).size} provinces`)
    expect(readme).toContain(`${multi} ตำบลในรุ่นนี้`)
    expect(readme).toContain(`${multi} do in this data`)
  })

  it('the @geothai/core version it names is the exact pin in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
    const pin = pkg.dependencies['@geothai/core'] as string
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/) // exact, no range: the data changes only with a release of this package
    expect(readme).toContain(`\`@geothai/core\` ${pin}): 7`)
    expect(readme).toContain(`from \`@geothai/core\` ${pin}, which \`package.json\` pins exactly`)
  })
})
