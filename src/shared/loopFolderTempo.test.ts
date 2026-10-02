import { describe, expect, it } from 'vitest'
import {
  barsAtTempo,
  pickBarsNearTempo,
  mostCommonFilenameTempo,
  loopTempo,
  IRREGULAR_TOLERANCE
} from './loopFolderTempo'

/** How long `bars` bars last at `bpm`, in seconds. */
const secs = (bars: number, bpm: number): number => (bars * 240) / bpm

describe('barsAtTempo', () => {
  it('finds the whole power-of-two bar count a length spans at a tempo', () => {
    expect(barsAtTempo(secs(4, 160), 160)).toEqual({ bars: 4, irregular: false })
    expect(barsAtTempo(secs(2, 165), 165)).toEqual({ bars: 2, irregular: false })
    expect(barsAtTempo(secs(1, 90), 90)).toEqual({ bars: 1, irregular: false })
    expect(barsAtTempo(secs(32, 174), 174)).toEqual({ bars: 32, irregular: false })
  })

  it('accepts a length up to 3% off a whole bar count', () => {
    expect(barsAtTempo(secs(4, 160) * 1.029, 160)).toEqual({ bars: 4, irregular: false })
    expect(barsAtTempo(secs(4, 160) * 0.971, 160)).toEqual({ bars: 4, irregular: false })
  })

  it('marks a length that fits no bar count within 3% as irregular, keeping the nearest', () => {
    // 7.0s at 160 is 4.67 bars: nearest is 4, and it is 17% long.
    expect(barsAtTempo(7, 160)).toEqual({ bars: 4, irregular: true })
    // 3 bars sits between 2 and 4; log-nearest is 4 (|ln 0.75| < |ln 1.5|).
    expect(barsAtTempo(secs(3, 120), 120)).toEqual({ bars: 4, irregular: true })
  })

  it('uses a 3% tolerance', () => {
    expect(IRREGULAR_TOLERANCE).toBe(0.03)
  })
})

describe('pickBarsNearTempo', () => {
  it('picks the bar count whose implied tempo is nearest the prior', () => {
    // 4.0s: 1 bar implies 60, 2 bars 120, 4 bars 240.
    expect(pickBarsNearTempo(4, 120)).toBe(2)
    expect(pickBarsNearTempo(4, 70)).toBe(1)
    expect(pickBarsNearTempo(4, 200)).toBe(4)
  })

  it('compares in log space, not raw bpm', () => {
    // Prior 85 on 4.0s: raw distance favours 60 (25 away, against 35),
    // but in log space 120 is nearer (|ln(120/85)| 0.345 < |ln(60/85)| 0.348).
    expect(pickBarsNearTempo(4, 85)).toBe(2)
  })

  it('breaks an exact tie toward the candidate inside 70-180 bpm', () => {
    // 4.0s with a prior of 60*sqrt(2): 60 and 120 are equally far in log space.
    // 120 is inside the range, 60 is not.
    expect(pickBarsNearTempo(4, 60 * Math.SQRT2)).toBe(2)
    // 1.6s with a prior of 150*sqrt(2): 150 and 300 are equally far.
    // 150 is inside, so the tie goes DOWN this time: the range decides, not the size.
    expect(pickBarsNearTempo(1.6, 150 * Math.SQRT2)).toBe(1)
  })
})

describe('mostCommonFilenameTempo', () => {
  it('returns the tempo most names carry', () => {
    expect(
      mostCommonFilenameTempo([
        'Creek Break 160.wav',
        'cw_amen08_165.wav',
        'Crot Break 165.wav',
        'Halftime Dnb Drums 1.wav'
      ])
    ).toBe(165)
  })

  it('breaks a tie toward the lower tempo', () => {
    expect(mostCommonFilenameTempo(['Creek Break 160.wav', 'cw_amen08_165.wav'])).toBe(160)
  })

  it('is null when no name carries a tempo', () => {
    expect(mostCommonFilenameTempo(['Halftime Dnb Drums 1.wav', 'cw_amen_classic.wav'])).toBeNull()
    expect(mostCommonFilenameTempo([])).toBeNull()
  })
})

describe('loopTempo', () => {
  const base = { folderName: 'Amen Breaks Volume 3', siblingFileNames: [], projectBpm: 120 }

  it('step 1: the filename tempo, certain', () => {
    expect(
      loopTempo({ ...base, fileName: 'Creek Break 160.wav', durationSec: secs(2, 160) })
    ).toEqual({ bpm: 160, bars: 2, source: 'filename', irregular: false })
    expect(
      loopTempo({ ...base, fileName: 'cw_amen08_165.wav', durationSec: secs(2, 165) })
    ).toEqual({ bpm: 165, bars: 2, source: 'filename', irregular: false })
  })

  it('step 1 wins over the folder name and the siblings', () => {
    const result = loopTempo({
      fileName: 'Creek Break 160.wav',
      folderName: 'DnB Breaks 170',
      siblingFileNames: ['Crot Break 165.wav', 'Hype Break 165.wav'],
      durationSec: secs(2, 160),
      projectBpm: 120
    })
    expect(result.source).toBe('filename')
    expect(result.bpm).toBe(160)
  })

  it('step 1 with a length that fits no bar count keeps the tempo and is irregular', () => {
    expect(loopTempo({ ...base, fileName: 'Creek Break 160.wav', durationSec: 7 })).toEqual({
      bpm: 160,
      bars: 4,
      source: 'filename',
      irregular: true
    })
  })

  it('step 2: with no tempo in the name, the folder name is the prior', () => {
    // Two bars of halftime at 85 is four bars at 170, the folder's tempo.
    const result = loopTempo({
      fileName: 'Halftime Dnb Drums 1.wav',
      folderName: 'DnB Breaks 170',
      siblingFileNames: ['Creek Break 160.wav'],
      durationSec: secs(2, 85),
      projectBpm: 120
    })
    expect(result.source).toBe('folder')
    expect(result.bars).toBe(4)
    expect(result.bpm).toBeCloseTo(170, 6)
    expect(result.irregular).toBe(false)
  })

  it('step 2: otherwise the siblings’ most common tempo is the prior', () => {
    const result = loopTempo({
      fileName: 'Halftime Dnb Drums 1.wav',
      folderName: 'Amen Breaks Volume 3',
      siblingFileNames: [
        'Creek Break 160.wav',
        'Crot Break 165.wav',
        'Hype Break 165.wav',
        'Halftime Dnb Drums 1.wav'
      ],
      durationSec: secs(4, 165),
      projectBpm: 120
    })
    expect(result.source).toBe('siblings')
    expect(result.bars).toBe(4)
    expect(result.bpm).toBeCloseTo(165, 6)
  })

  it('step 3: nothing named anywhere, so the length decides, near the project tempo', () => {
    const noNames = {
      fileName: 'cw_amen_classic.wav',
      folderName: 'Amen Breaks Volume 2',
      siblingFileNames: ['cw_amen_apache.wav', 'cw_amen_classic.wav'],
      durationSec: 4
    }
    expect(loopTempo({ ...noNames, projectBpm: 120 })).toEqual({
      bpm: 120,
      bars: 2,
      source: 'length',
      irregular: false
    })
    expect(loopTempo({ ...noNames, projectBpm: 70 })).toEqual({
      bpm: 60,
      bars: 1,
      source: 'length',
      irregular: false
    })
  })

  it('step 3 uses the 70-180 tie-break', () => {
    const result = loopTempo({
      fileName: 'cw_amen_classic.wav',
      folderName: 'Amen Breaks Volume 2',
      siblingFileNames: [],
      durationSec: 4,
      projectBpm: 60 * Math.SQRT2
    })
    expect(result).toEqual({ bpm: 120, bars: 2, source: 'length', irregular: false })
  })

  it('a guessed tempo comes from the length, so it always loops whole and is never irregular', () => {
    // 5.1s near a folder tempo of 170: 4 bars implies 188.2.
    const result = loopTempo({
      fileName: 'Halftime Dnb Drums 1.wav',
      folderName: 'DnB Breaks 170',
      siblingFileNames: [],
      durationSec: 5.1,
      projectBpm: 120
    })
    expect(result.bars).toBe(4)
    expect(result.bpm).toBeCloseTo(188.235, 2)
    expect(result.irregular).toBe(false)
  })
})
