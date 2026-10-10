import { describe, expect, it } from 'vitest'
import {
  CLEANUP_GRACE_MS,
  CLEANUP_NOT_NOW_MS,
  CLEANUP_OFFER_BYTES,
  MISSING_COPY_TEXT,
  NOTHING_TO_CLEAN_TEXT,
  cleanupOfferText,
  clearedText,
  formatCopySize,
  shouldOfferCleanup
} from './reonedCleanup'

describe('the offer', () => {
  it('at 200 MB or more, and not while "not now" is running', () => {
    const now = 1_000_000_000_000
    expect(CLEANUP_OFFER_BYTES).toBe(200_000_000)
    expect(shouldOfferCleanup({ unusedBytes: 199_999_999, now, notNowUntil: null })).toBe(false)
    expect(shouldOfferCleanup({ unusedBytes: 200_000_000, now, notNowUntil: null })).toBe(true)
    expect(shouldOfferCleanup({ unusedBytes: 5e9, now, notNowUntil: now + 1 })).toBe(false)
    expect(shouldOfferCleanup({ unusedBytes: 5e9, now, notNowUntil: now })).toBe(true)
    expect(CLEANUP_NOT_NOW_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(CLEANUP_GRACE_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('words', () => {
  it("the spec's message, word for word", () => {
    expect(cleanupOfferText(1_200_000_000)).toBe(
      "about 1.2 GB of re-oned and EEEDIT stem copies aren't used by any project. your rifffs, stems and projects aren't touched, and any re-oned copy needed later is rebuilt automatically."
    )
    expect(clearedText(1_200_000_000)).toBe('cleared 1.2 GB')
    expect(MISSING_COPY_TEXT).toBe('re-oned copy missing · rebuilds when its original is back')
  })

  it('sizes', () => {
    expect(formatCopySize(340_400_000)).toBe('340 MB')
    expect(formatCopySize(999_600_000)).toBe('1.0 GB')
    expect(formatCopySize(12_345_000_000)).toBe('12.3 GB')
    expect(formatCopySize(400_000)).toBe('less than 1 MB')
    expect(cleanupOfferText(400_000).startsWith('less than 1 MB of re-oned')).toBe(true)
    expect(NOTHING_TO_CLEAN_TEXT).toBe(
      'every re-oned and EEEDIT stem copy is in use. nothing to clean up.'
    )
  })
})
