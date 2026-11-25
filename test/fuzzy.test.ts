import { describe, expect, it } from 'vitest'
import { comparable, similarity, similarityAtLeast } from '../src/fuzzy'

// Names are real current areas from @geothai/core 5.0.0; the misspellings are the kinds of
// mistakes feature 3 must tolerate (PLAN.md).

describe('similarity basics', () => {
  it('is 1 for the same name, also after lookup folding', () => {
    expect(similarity('เชียงใหม่', 'เชียงใหม่')).toBe(1)
    expect(similarity('เชียง ใหม่', 'เชียงใหม่')).toBe(1)
    expect(similarity('Ko Pha-ngan', 'ko phangan')).toBe(1)
  })

  it('is 0 between a Thai and an English name', () => {
    expect(similarity('เชียงใหม่', 'Chiang Mai')).toBe(0)
  })

  it('is symmetric', () => {
    expect(similarity('สุราษฎร์ธานี', 'สุราษฏร์ธานี')).toBe(similarity('สุราษฏร์ธานี', 'สุราษฎร์ธานี'))
    expect(similarity('พระนคร', 'พรนะคร')).toBe(similarity('พรนะคร', 'พระนคร'))
  })

  it('stays within [0, 1] for unrelated and empty names', () => {
    expect(similarity('ก', 'ขคฆงจฉชซ')).toBe(0)
    expect(similarity('', '')).toBe(1)
  })
})

describe('Thai mistakes cost less than arbitrary edits', () => {
  const arbitrary = similarity('เชียงใหม่', 'เชียงใหมก')

  it('tolerates a dropped tone mark or vowel above/below', () => {
    expect(similarity('เชียงใหม่', 'เชียงใหม')).toBeGreaterThan(arbitrary)
    expect(similarity('เชียงใหม่', 'เชยงใหม่')).toBeGreaterThan(arbitrary)
    expect(similarity('ลำพูน', 'ลำพุน')).toBeGreaterThan(0.9)
  })

  it.each([
    ['ร/ล', 'ลำพูน', 'รำพูน'],
    ['ใ/ไ', 'เชียงใหม่', 'เชียงไหม่'],
    ['ณ/น', 'สุราษฎร์ธานี', 'สุราษฎร์ธาณี'],
    ['ศ/ษ/ส', 'สุราษฎร์ธานี', 'สุราศฎร์ธานี'],
    ['์ dropped', 'สุราษฎร์ธานี', 'สุราษฎรธานี'],
  ])('tolerates the %s confusion', (_, right, wrong) => {
    expect(similarity(right, wrong)).toBeGreaterThan(0.9)
  })

  it('tolerates two neighbouring letters swapped', () => {
    expect(similarity('พระนคร', 'พรนะคร')).toBeGreaterThan(similarity('พระนคร', 'พระนกก'))
  })

  it('tolerates a neighbouring key on the Kedmanee layout', () => {
    // ฎ and ฏ are vertically adjacent on the shifted layer.
    expect(similarity('สุราษฎร์ธานี', 'สุราษฏร์ธานี')).toBeGreaterThan(0.9)
  })

  it('keeps clearly different names apart', () => {
    expect(similarity('แม่แดด', 'แม่แรม')).toBeLessThan(0.7)
    expect(similarity('สมุทรสาคร', 'สมุทรสงคราม')).toBeLessThan(0.8)
  })
})

describe('English names', () => {
  it('tolerates a swap and a neighbouring key', () => {
    expect(similarity('Chiang Mai', 'Chaing Mai')).toBeGreaterThan(0.9)
    expect(similarity('Chiang Mai', 'Chiang Nai')).toBeGreaterThan(0.9)
  })
})

describe('similarityAtLeast', () => {
  it('agrees with similarity above the minimum and returns 0 below it', () => {
    const a = comparable('สุราษฎร์ธานี')
    const b = comparable('สุราษฏร์ธานี')
    expect(similarityAtLeast(a, b, 0.7)).toBe(similarity('สุราษฎร์ธานี', 'สุราษฏร์ธานี'))
    expect(similarityAtLeast(a, b, 0.99)).toBe(0)
    expect(similarityAtLeast(comparable('ก'), comparable('กรุงเทพมหานคร'), 0.7)).toBe(0)
  })

  it('does not stop early before a transposition two rows later (review S2)', () => {
    const a = comparable('เชียงใหม่')
    const b = comparable('เชีงยใหม่')
    expect(similarity('เชียงใหม่', 'เชีงยใหม่')).toBeGreaterThan(0.9)
    expect(similarityAtLeast(a, b, 0.7)).toBe(similarity('เชียงใหม่', 'เชีงยใหม่'))
  })
})
