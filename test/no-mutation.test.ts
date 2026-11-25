// tac-night-2 (review 357ddaed): expandMueang wrote into the object normalize() returned. No step may edit
// an object another caller holds; normalize() is wrapped here to hand back a deep-frozen object, so any
// in-place write throws (ES modules are strict mode).
import { describe, expect, it, vi } from 'vitest'

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v)
    Object.freeze(o)
  }
  return o
}

vi.mock('../src/normalize', async () => {
  const actual = await vi.importActual<typeof import('../src/normalize')>('../src/normalize')
  return { ...actual, normalize: (input: Parameters<typeof actual.normalize>[0]) => deepFreeze(actual.normalize(input)) }
})

const { check } = await import('../src/check')

describe('check() edits no object it was given or returned (tac-night-2)', () => {
  it("a bare 'อ.เมือง' is expanded without touching normalize()'s frozen result", () => {
    const r = check({ province: 'เชียงใหม่', district: 'อ.เมือง', subdistrict: 'สุเทพ', postalCode: '50200' })
    expect(r.status).toBe('valid')
    expect(r.normalized.district).toBe('เมืองเชียงใหม่')
    expect(r.normalized.applied.district).toEqual(['strip-prefix', 'mueang-province'])
  })

  it('the input and a first result are unchanged after a second call', () => {
    const input = deepFreeze({ province: 'เชียงใหม่', district: 'เมือง', subdistrict: 'สุเทพ', postalCode: '50200' })
    const first = check(input)
    const snapshot = JSON.stringify(first)
    const second = check(input)
    expect(JSON.stringify(first)).toBe(snapshot)
    expect(input).toEqual({ province: 'เชียงใหม่', district: 'เมือง', subdistrict: 'สุเทพ', postalCode: '50200' })
    expect(second.normalized).not.toBe(first.normalized)
    expect(second.normalized.applied).not.toBe(first.normalized.applied)
  })
})
