import { beforeAll, describe, expect, it, vi } from 'vitest'
import type * as YamnetWorker from './yamnetWorker'

// yamnetWorker.ts is a webworker module -- it assigns `self.onmessage = ...`
// at the top level on import. `self` doesn't exist in vitest's `node` test
// environment, so (same convention as peakCache.test.ts's window/
// AudioContext stubbing) stub it before dynamically importing the module.
let meanPoolEmbedding: typeof YamnetWorker.meanPoolEmbedding

beforeAll(async () => {
  vi.stubGlobal('self', {})
  const mod = await import('./yamnetWorker')
  meanPoolEmbedding = mod.meanPoolEmbedding
})

describe('meanPoolEmbedding', () => {
  it('is exported for reuse by this test file', () => {
    expect(typeof meanPoolEmbedding).toBe('function')
  })
})
