import { beforeEach, describe, expect, it, vi } from 'vitest'
import { check, checkMany, DEFAULT_OPTIONS } from '../src/check'
import { dataVersion, resolvedByCode } from '../src/data'
import type { CheckContext, Finding, ResolvedAddress } from '../src/types'
import { validate } from '../src/validate'

// validate() is still a stub (tac-validate owns it). It is mocked here so the scaffold's own
// status rules can be driven with real candidates from @geothai/core 5.0.0.
vi.mock('../src/validate', () => ({ validate: vi.fn() }))
const mockedValidate = vi.mocked(validate)

const KO_PHANGAN = { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน', postalCode: '84280' }
const r840501 = resolvedByCode('840501') as ResolvedAddress
const r840502 = resolvedByCode('840502') as ResolvedAddress

function addCandidates(...list: ResolvedAddress[]) {
  return (ctx: CheckContext) => {
    ctx.candidates.push(...list)
  }
}

function errorFinding(code: Finding['code']): Finding {
  return { code, severity: 'error', fields: ['postalCode'], message: { th: 'x', en: 'x' }, detail: {} }
}

beforeEach(() => {
  mockedValidate.mockReset()
})

describe('check options', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_OPTIONS).toEqual({ autoCorrectThreshold: 0.9, autoCorrect: true, maxSuggestions: 3 })
    expect(Object.isFrozen(DEFAULT_OPTIONS)).toBe(true)
  })

  it('passes every option, defaults filled in, to the steps', () => {
    check(KO_PHANGAN, { maxSuggestions: 1 })
    expect(mockedValidate.mock.calls[0]?.[0].options).toEqual({
      autoCorrectThreshold: 0.9,
      autoCorrect: true,
      maxSuggestions: 1,
    })
  })

  it.each([-0.1, 1.1, Number.NaN])('rejects autoCorrectThreshold %s', (value) => {
    expect(() => check(KO_PHANGAN, { autoCorrectThreshold: value })).toThrow(RangeError)
  })

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])('rejects maxSuggestions %s', (value) => {
    expect(() => check(KO_PHANGAN, { maxSuggestions: value })).toThrow(RangeError)
  })

  it('accepts the edges 0 and 1', () => {
    expect(() => check(KO_PHANGAN, { autoCorrectThreshold: 0, maxSuggestions: 0 })).not.toThrow()
    expect(() => check(KO_PHANGAN, { autoCorrectThreshold: 1 })).not.toThrow()
  })
})

describe('check result', () => {
  it('reports the data version and keeps input, normalized and output apart', () => {
    const input = { ...KO_PHANGAN, subdistrict: 'ต.เกาะพะงัน' }
    const r = check(input)
    expect(r.dataVersion).toBe(dataVersion)
    expect(r.input).toEqual(input)
    expect(r.normalized.subdistrict).toBe('เกาะพะงัน')
    expect(r.output).toEqual(KO_PHANGAN)
    expect(input.subdistrict).toBe('ต.เกาะพะงัน')
  })

  it('drops fields the caller left undefined', () => {
    const r = check({ province: 'สุราษฎร์ธานี', district: undefined })
    expect(Object.keys(r.input)).toEqual(['province'])
    expect(Object.keys(r.output)).toEqual(['province'])
  })

  it('adds one FORMAT_NORMALIZED info finding per cleaned field, with the rules', () => {
    const r = check({ ...KO_PHANGAN, province: 'จ.สุราษฎร์ธานี', postalCode: '๘๔๒๘๐' })
    const format = r.findings.filter((f) => f.code === 'FORMAT_NORMALIZED')
    expect(format.map((f) => f.fields)).toEqual([['province'], ['postalCode']])
    expect(format.every((f) => f.severity === 'info')).toBe(true)
    expect(format[1]?.detail).toEqual({ given: '๘๔๒๘๐', normalized: '84280', rules: ['thai-digits'] })
    // Thai messages name the field in Thai, English messages in English; never the field id.
    expect(format[0]?.message.th).toContain('ช่องจังหวัด')
    expect(format[0]?.message.th).not.toContain('province')
    expect(format[0]?.message.en).toContain('the province')
    expect(format[1]?.message.th).toContain('ช่องรหัสไปรษณีย์')
    expect(format[1]?.message.en).toContain('the postal code')
    expect(format[1]?.message.en).not.toContain('postalCode')
  })

  it('adds no finding for a clean address', () => {
    expect(check(KO_PHANGAN).findings).toEqual([])
  })
})

describe('postal hint through the real validate', () => {
  it('บางนา / เขตบางนา / กรุงเทพ / 10260 never points at Ayutthaya (13150)', async () => {
    const actual = await vi.importActual<typeof import('../src/validate')>('../src/validate')
    mockedValidate.mockImplementation(actual.validate)
    const r = check({ province: 'กรุงเทพ', district: 'เขตบางนา', subdistrict: 'บางนา', postalCode: '10260' })
    expect(JSON.stringify(r)).not.toContain('13150')
    expect(r.findings.some((f) => f.code === 'ABOLISHED_AREA')).toBe(true) // abolished.ts still owns the name
    expect(r.status).not.toBe('valid')
    expect(r.output.postalCode).toBe('10260') // not rewritten
  })
})

describe('status rules', () => {
  it('is invalid when nothing resolves', () => {
    const r = check(KO_PHANGAN)
    expect(r.status).toBe('invalid')
    expect(r.resolved).toBeUndefined()
  })

  it('is valid with exactly one candidate and an unchanged output, and resolves it', () => {
    mockedValidate.mockImplementation(addCandidates(r840501))
    const r = check(KO_PHANGAN)
    expect(r.status).toBe('valid')
    expect(r.resolved).toEqual(r840501)
  })

  it('is valid, not corrected, when only formatting was cleaned', () => {
    mockedValidate.mockImplementation(addCandidates(r840501))
    expect(check({ ...KO_PHANGAN, province: 'จ.สุราษฎร์ธานี' }).status).toBe('valid')
  })

  it('is corrected when a step changed the output', () => {
    mockedValidate.mockImplementation((ctx) => {
      ctx.output.postalCode = '84280'
      ctx.candidates.push(r840501)
    })
    const r = check({ ...KO_PHANGAN, postalCode: undefined })
    expect(r.status).toBe('corrected')
    expect(r.output.postalCode).toBe('84280')
    expect(r.resolved).toEqual(r840501)
  })

  it('is ambiguous with several candidates, even with an AMBIGUOUS error finding', () => {
    mockedValidate.mockImplementation((ctx) => {
      ctx.candidates.push(r840501, r840502)
      ctx.findings.push(errorFinding('AMBIGUOUS'))
    })
    const r = check({ postalCode: '84280' })
    expect(r.status).toBe('ambiguous')
    expect(r.resolved).toBeUndefined()
  })

  it('is invalid when any other error finding exists, even with one candidate', () => {
    mockedValidate.mockImplementation((ctx) => {
      ctx.candidates.push(r840501)
      ctx.findings.push(errorFinding('POSTAL_CODE_MISMATCH'))
    })
    const r = check(KO_PHANGAN)
    expect(r.status).toBe('invalid')
    expect(r.resolved).toBeUndefined()
  })

  it('ignores warning and info findings when deciding', () => {
    mockedValidate.mockImplementation((ctx) => {
      ctx.candidates.push(r840501)
      ctx.findings.push({ ...errorFinding('ABOLISHED_AREA'), severity: 'warning' })
    })
    expect(check(KO_PHANGAN).status).toBe('valid')
  })
})

describe('checkMany', () => {
  it('returns one result per input, in order', () => {
    const results = [...checkMany([KO_PHANGAN, { province: 'จ.สุราษฎร์ธานี' }, {}])]
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.input)).toEqual([KO_PHANGAN, { province: 'จ.สุราษฎร์ธานี' }, {}])
  })

  it('reads the inputs lazily', () => {
    let read = 0
    function* rows() {
      for (;;) {
        read++
        yield KO_PHANGAN
      }
    }
    const it = checkMany(rows())
    expect(read).toBe(0)
    it.next()
    it.next()
    expect(read).toBe(2)
  })

  it('validates options before reading the first input', () => {
    let read = 0
    function* rows() {
      read++
      yield KO_PHANGAN
    }
    expect(() => checkMany(rows(), { maxSuggestions: -1 })).toThrow(RangeError)
    expect(read).toBe(0)
  })

  it('applies the same options to every input', () => {
    ;[...checkMany([KO_PHANGAN, KO_PHANGAN], { autoCorrect: false })]
    expect(mockedValidate.mock.calls.map((c) => c[0].options.autoCorrect)).toEqual([false, false])
  })

  it('accepts an empty iterable', () => {
    expect([...checkMany([])]).toEqual([])
  })
})
