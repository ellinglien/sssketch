import { describe, expect, it, vi } from 'vitest'
import { issueCrossPreviewLoad } from './useCrossPreview'

describe('issueCrossPreviewLoad', () => {
  it('marks an issued native load as needing restoration before its acknowledgement can be cancelled', async () => {
    let resolveLoad!: () => void
    const deferredLoad = new Promise<void>((resolve) => {
      resolveLoad = resolve
    })
    let needsRestore = false
    let cancelled = false
    let restores = 0
    const load = vi.fn(() => deferredLoad)

    const pending = issueCrossPreviewLoad(
      load,
      () => {
        needsRestore = true
      },
      () => cancelled
    )

    expect(load).toHaveBeenCalledOnce()
    expect(needsRestore).toBe(true)

    // Models Back/Stop/unmount while engineLoadProject is still pending.
    cancelled = true
    if (needsRestore) restores += 1
    resolveLoad()

    await expect(pending).resolves.toBe(false)
    expect(restores).toBe(1)
  })
})
