import { describe, expect, it } from 'vitest'
import { createEngineOwnershipTracker } from './engineOwnership'

describe('createEngineOwnershipTracker', () => {
  it('starts with no owner', () => {
    const tracker = createEngineOwnershipTracker()
    expect(tracker.current).toBeNull()
  })

  it('claim sets the current owner', () => {
    const tracker = createEngineOwnershipTracker()
    tracker.claim('discover-preview')
    expect(tracker.current).toBe('discover-preview')
  })

  it('a token returned by claim is still owned immediately after', () => {
    const tracker = createEngineOwnershipTracker()
    const token = tracker.claim('discover-preview')
    expect(tracker.stillOwn(token)).toBe(true)
  })

  it('a second claim by a DIFFERENT owner invalidates the first token', () => {
    const tracker = createEngineOwnershipTracker()
    const firstToken = tracker.claim('discover-preview')
    tracker.claim('stem-solo-preview')
    expect(tracker.stillOwn(firstToken)).toBe(false)
    expect(tracker.current).toBe('stem-solo-preview')
  })

  it('a second claim by the SAME owner still invalidates the first token', () => {
    // Two rapid calls from the same component (e.g. two reroll clicks in a
    // row) must not let the FIRST call's late-resolving async work land
    // after the second -- same "superseded, not just unmounted" guard
    // this codebase's own per-component generation refs already enforce
    // locally; claim() enforces it globally.
    const tracker = createEngineOwnershipTracker()
    const firstToken = tracker.claim('discover-preview')
    const secondToken = tracker.claim('discover-preview')
    expect(tracker.stillOwn(firstToken)).toBe(false)
    expect(tracker.stillOwn(secondToken)).toBe(true)
  })

  it('release resets current to null and invalidates the outgoing token', () => {
    const tracker = createEngineOwnershipTracker()
    const token = tracker.claim('stem-solo-preview')
    tracker.release()
    expect(tracker.current).toBeNull()
    expect(tracker.stillOwn(token)).toBe(false)
  })

  it('claim after release still invalidates the pre-release token', () => {
    const tracker = createEngineOwnershipTracker()
    const firstToken = tracker.claim('discover-preview')
    tracker.release()
    const secondToken = tracker.claim('stem-solo-preview')
    expect(tracker.stillOwn(firstToken)).toBe(false)
    expect(tracker.stillOwn(secondToken)).toBe(true)
  })
})
