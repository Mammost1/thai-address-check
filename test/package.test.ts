import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  engines: { node: string }
  exports: Record<string, Record<string, string>>
  bin: Record<string, string>
}

describe('package.json exports (tac-harden T2: require() used to fail with ERR_PACKAGE_PATH_NOT_EXPORTED)', () => {
  const entry = pkg.exports['.'] as Record<string, string>

  it('the main entry has types, import AND default, all pointing at the one build', () => {
    expect(Object.keys(entry).sort()).toEqual(['default', 'import', 'types'])
    expect(entry.import).toBe('./dist/index.js')
    expect(entry.default).toBe(entry.import) // require() on Node >= 22.12 loads the same ESM file
    expect(entry.types).toBe('./dist/index.d.ts')
  })

  it('"types" comes first so TypeScript finds it before the runtime conditions', () => {
    expect(Object.keys(entry)[0]).toBe('types')
  })

  it('engines.node is a version that can require() an ES module without a flag (22.12+)', () => {
    expect(pkg.engines.node).toBe('>=22.12')
  })

  it('the command is exposed as a bin', () => {
    expect(pkg.bin['thai-address-check']).toBe('dist/cli.js')
  })
})

// The real thing, through the package name, on the built output. In a clean clone the gate runs the
// tests before the build, so this part is also run by CI after the build (the library smoke step).
describe.skipIf(!existsSync(resolve(ROOT, 'dist/index.js')))('require() and import() of the built package', () => {
  const run = (args: string[]) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })

  it('require("thai-address-check") returns the API and check() works', () => {
    const r = run(['-e', "const m=require('thai-address-check');process.stdout.write(Object.keys(m).sort().join(',')+'|'+m.check({subdistrict:'เกาะพะงัน',postalCode:'84280'}).status)"])
    expect(r.stderr.replace(/\(node:\d+\)[^\n]*\n?|\(Use `node --trace[^\n]*\n?/g, '')).toBe('') // an experimental warning on 22.12 is allowed
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('check,checkMany,dataVersion,listAddresses,normalize|corrected')
  })

  it('import("thai-address-check") gives the same exports', () => {
    const r = run(['--input-type=module', '-e', "import('thai-address-check').then(m=>process.stdout.write(Object.keys(m).sort().join(',')))"])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('check,checkMany,dataVersion,listAddresses,normalize')
  })
})
