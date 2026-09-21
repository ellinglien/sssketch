import { describe, expect, it } from 'vitest'
import { createBackgroundScanGate } from './backgroundScanGate'

describe('createBackgroundScanGate', () => {
  it('stays closed for the quiet window after an interaction, then opens', () => {
    const gate = createBackgroundScanGate({ quietMs: 1500, now: () => 0 })
    gate.noteInteraction(1000)
    expect(gate.mayRun(2000)).toBe(false)
    expect(gate.mayRun(2500)).toBe(true)
  })

  it('starts closed for one quiet window from creation (startup grace)', () => {
    const gate = createBackgroundScanGate({ quietMs: 1500, now: () => 100 })
    expect(gate.mayRun(200)).toBe(false)
    expect(gate.mayRun(1600)).toBe(true)
  })

  it('stays closed while any hold is active, regardless of quiet time', () => {
    const gate = createBackgroundScanGate({ quietMs: 1500, now: () => 0 })
    const releaseA = gate.hold()
    const releaseB = gate.hold()
    expect(gate.mayRun(10_000)).toBe(false)
    releaseA()
    expect(gate.mayRun(10_000)).toBe(false)
    releaseB()
    expect(gate.mayRun(10_000)).toBe(true)
  })

  it('releasing the same hold twice does not over-release another hold', () => {
    const gate = createBackgroundScanGate({ quietMs: 1500, now: () => 0 })
    const releaseA = gate.hold()
    gate.hold()
    releaseA()
    releaseA()
    expect(gate.mayRun(10_000)).toBe(false)
  })
})
