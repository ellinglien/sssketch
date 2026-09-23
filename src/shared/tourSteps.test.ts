import { describe, expect, it } from 'vitest'
import { TOUR_STEPS } from './tourSteps'

/**
 * The tour is copy, and copy goes stale silently -- two of these steps
 * described features that had changed underneath them before anyone noticed.
 * Nothing here can prove a selector actually resolves in a running app (the
 * anchors live in React components this codebase deliberately doesn't mount
 * in tests); what it CAN hold is the shape and the voice, plus the one rule
 * that keeps the tour from growing into a feature list.
 */

const ANCHOR_SELECTOR = /^\[data-tour-id="tour-[a-z-]+"\]$/

describe('the first-run tour', () => {
  it('stays short enough to be a tour rather than a feature list', () => {
    expect(TOUR_STEPS.length).toBeGreaterThan(0)
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(7)
  })

  it('anchors every step on a data-tour-id, never an incidental attribute', () => {
    // A step anchored on something like [data-rifff-clip] (a marker owned by
    // drag/scrub logic, not by the tour) can be moved or renamed by work that
    // has no idea the tour points at it. data-tour-id exists to be greppable:
    // every selector here should find its element with one search.
    for (const step of TOUR_STEPS) expect(step.selector).toMatch(ANCHOR_SELECTOR)
  })

  it('only reuses an anchor on consecutive steps', () => {
    // Two steps may share an anchor when two features genuinely live behind
    // one button (auto-arrange and tidy up, both in the gear menu). They must
    // then be adjacent, so the spotlight sits still across the pair instead of
    // jumping away and back -- which reads as a bug.
    const firstIndex = new Map<string, number>()
    TOUR_STEPS.forEach((step, i) => {
      const seen = firstIndex.get(step.selector)
      if (seen === undefined) {
        firstIndex.set(step.selector, i)
        return
      }
      expect(TOUR_STEPS[i - 1].selector).toBe(step.selector)
    })
  })

  it('obeys the copy rules: lowercase, no emoji, no exclamation marks', () => {
    // tokens.css: "UI copy is lowercase; no emoji, no exclamation marks."
    // Same three checks coachScript.test.ts runs over sssketchy's lines --
    // this is the app's own voice, held to the same rules.
    for (const step of TOUR_STEPS) {
      for (const text of [step.title, step.body]) {
        expect(text).not.toMatch(/!/)
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(text[0]).toBe(text[0].toLowerCase())
      }
    }
  })

  it('keeps every step to one short callout', () => {
    // The callout is 300px wide (TourOverlay's CALLOUT_WIDTH) at 11px -- past
    // roughly this much, a step stops being a pointer and becomes a manual.
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeLessThanOrEqual(40)
      expect(step.body.length).toBeLessThanOrEqual(150)
      expect(step.body.trim()).not.toBe('')
    }
  })

  it('gives every step its own title', () => {
    const titles = TOUR_STEPS.map((s) => s.title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
