import { describe, it, expect } from 'vitest'
import { clusterProvenance } from './busProvenance'

describe('clusterProvenance', () => {
  it("returns 'clustered' for a cluster with more than one member stem", () => {
    expect(clusterProvenance(['Kick', 'Snare'], 5)).toBe('clustered')
  })

  it("returns 'from preset name' for a singleton cluster whose one stem has a recognizable preset name", () => {
    expect(clusterProvenance(['Kick'], 1)).toBe('from preset name')
  })

  it("returns 'unknown' for a singleton cluster with no recognizable preset name", () => {
    expect(clusterProvenance(['Vocals'], 1)).toBe('unknown')
  })
})
