import { describe, expect, it } from 'vitest'
import { parseStemFilename } from './parseFilename'

describe('parseStemFilename', () => {
  it('parses the documented convention', () => {
    const parsed = parseStemFilename('1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav')
    expect(parsed).toEqual({
      slot: 1,
      author: 'elling',
      stemName: 'Highpass',
      bpm: 150,
      timestamp: '2020-11-11-13-53'
    })
  })
  it('parses a stem name that itself contains a hyphen', () => {
    const parsed = parseStemFilename('5 - elling - Endless Smile - 80BPM - 2023-07-26-15-52.wav')
    expect(parsed?.stemName).toBe('Endless Smile')
    expect(parsed?.bpm).toBe(80)
  })
  it('returns null for a non-matching filename', () => {
    expect(parseStemFilename('recording 165 (Bass).wav')).toBeNull()
    expect(parseStemFilename('.DS_Store')).toBeNull()
  })
  it('does not mis-split an author name that itself contains a hyphen', () => {
    const parsed = parseStemFilename('5 - Jean-Luc - Highpass - 150BPM - 2020-11-11-13-53.wav')
    expect(parsed).toEqual({
      slot: 5,
      author: 'Jean-Luc',
      stemName: 'Highpass',
      bpm: 150,
      timestamp: '2020-11-11-13-53'
    })
  })
})
