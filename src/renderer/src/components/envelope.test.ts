import { describe, it, expect } from 'vitest'
import { envelopeCurveD, envelopeKnees } from './envelope'

describe('envelopeCurveD', () => {
  it('builds a straight-line path (no curve commands) through the envelope knees', () => {
    const width = 200
    const height = 40
    const fadeInPx = 30
    const fadeOutPx = 20
    const plateauY = 10

    const d = envelopeCurveD(width, height, fadeInPx, fadeOutPx, plateauY)

    const { fiEnd, foStart } = envelopeKnees(width, fadeInPx, fadeOutPx)
    expect(d).toBe(`M0,${height} L${fiEnd},${plateauY} L${foStart},${plateauY} L${width},${height}`)
    expect(d).not.toContain('C') // no Bezier curve commands
  })

  it('collapses to a single straight line across the full width when there is no fade', () => {
    const d = envelopeCurveD(100, 40, 0, 0, 10)
    const { fiEnd, foStart } = envelopeKnees(100, 0, 0)
    expect(d).toBe(`M0,40 L${fiEnd},10 L${foStart},10 L100,40`)
  })
})
