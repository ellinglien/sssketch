import { describe, expect, it } from 'vitest'
import {
  coachPhraseLine,
  loopPhraseIsWorthSaying,
  phraseAnswerOptions,
  readLoopPhrase,
  sanitiseCoachPhrase,
  sanitiseLoopPhraseReading,
  type StemPhraseReading
} from './coachPhrase'

function reading(path: string, bars: number | null): StemPhraseReading {
  return {
    path,
    nominalBars: 8,
    verdict: bars === null ? { kind: 'inconclusive' } : { kind: 'period', bars, confidence: 1 }
  }
}

describe('readLoopPhrase', () => {
  it('takes the LONGEST true period across the stems', () => {
    const loop = readLoopPhrase([reading('/kick', 1), reading('/lead', 4)], 8)
    expect(loop.phraseBars).toBe(4)
    expect(loop.measuredStems).toBe(2)
    expect(loop.inconclusiveStems).toBe(0)
  })

  it('ignores the stems it could not read, and counts them', () => {
    const loop = readLoopPhrase([reading('/kick', 2), reading('/pad', null)], 8)
    expect(loop.phraseBars).toBe(2)
    expect(loop.inconclusiveStems).toBe(1)
  })

  it('is inconclusive overall when every stem is', () => {
    const loop = readLoopPhrase([reading('/a', null), reading('/b', null)], 8)
    expect(loop.phraseBars).toBeNull()
  })

  it('is inconclusive for an empty loop rather than guessing', () => {
    expect(readLoopPhrase([], 8).phraseBars).toBeNull()
  })

  it('keeps the nominal length alongside the measurement', () => {
    expect(readLoopPhrase([reading('/a', 4)], 8).nominalBars).toBe(8)
  })
})

describe('loopPhraseIsWorthSaying', () => {
  it('is true only when the measurement differs from the nominal length', () => {
    expect(loopPhraseIsWorthSaying(readLoopPhrase([reading('/a', 4)], 8))).toBe(true)
    expect(loopPhraseIsWorthSaying(readLoopPhrase([reading('/a', 8)], 8))).toBe(false)
    expect(loopPhraseIsWorthSaying(readLoopPhrase([reading('/a', null)], 8))).toBe(false)
  })
})

describe('phraseAnswerOptions', () => {
  it('offers the measured value and the nominal one, measured first', () => {
    expect(phraseAnswerOptions(readLoopPhrase([reading('/a', 4)], 8))).toEqual([
      { bars: 4, source: 'measured' },
      { bars: 8, source: 'nominal' }
    ])
  })

  it('offers only the nominal length when there is nothing to compare it to', () => {
    expect(phraseAnswerOptions(readLoopPhrase([reading('/a', null)], 8))).toEqual([
      { bars: 8, source: 'nominal' }
    ])
  })
})

describe('coachPhraseLine', () => {
  it('states the measurement as the fact it is', () => {
    const line = coachPhraseLine(readLoopPhrase([reading('/a', 4)], 8), 0)
    expect(line).toContain('8')
    expect(line).toContain('4')
  })

  it('says NOTHING when the measurement is inconclusive', () => {
    expect(coachPhraseLine(readLoopPhrase([reading('/a', null)], 8), 0)).toBeNull()
  })

  it('says NOTHING when the loop is already its own phrase', () => {
    expect(coachPhraseLine(readLoopPhrase([reading('/a', 8)], 8), 0)).toBeNull()
  })

  it('rotates deterministically on the seed, never at random', () => {
    const loop = readLoopPhrase([reading('/a', 4)], 8)
    expect(coachPhraseLine(loop, 0)).toBe(coachPhraseLine(loop, 0))
    expect(coachPhraseLine(loop, 1)).not.toBe(coachPhraseLine(loop, 0))
  })

  it('never tells the user to change anything -- the finding is a fact, not an instruction', () => {
    const loop = readLoopPhrase([reading('/a', 4)], 8)
    for (let seed = 0; seed < 8; seed += 1) {
      const line = coachPhraseLine(loop, seed)!
      expect(line).not.toMatch(/you should|you need to|halve it|make it/i)
    }
  })
})

describe('the load repair', () => {
  it('drops a reading that is not an object', () => {
    expect(sanitiseLoopPhraseReading('nonsense')).toBeNull()
  })

  it('keeps a hand-edited reading only where every number is sane', () => {
    expect(sanitiseLoopPhraseReading({ nominalBars: 8, phraseBars: 4 })).toEqual({
      nominalBars: 8,
      phraseBars: 4,
      measuredStems: 0,
      inconclusiveStems: 0
    })
    expect(sanitiseLoopPhraseReading({ nominalBars: 0, phraseBars: 4 })).toBeNull()
    expect(sanitiseLoopPhraseReading({ nominalBars: 8, phraseBars: -1 })?.phraseBars).toBeNull()
  })

  it('drops an answer with an unusable bar count or an unknown source', () => {
    expect(sanitiseCoachPhrase({ bars: 4, source: 'measured' })).toEqual({
      bars: 4,
      source: 'measured'
    })
    expect(sanitiseCoachPhrase({ bars: 0, source: 'measured' })).toBeNull()
    expect(sanitiseCoachPhrase({ bars: 4, source: 'vibes' })).toBeNull()
  })
})
