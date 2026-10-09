import { describe, expect, it, vi } from 'vitest'
import {
  continueCrossPreviewAfterSilence,
  PreviewHaltBarrier,
  issueCrossPreviewLoad
} from './useCrossPreview'

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

describe('continueCrossPreviewAfterSilence', () => {
  it('does not swap or restore a project until the native halt has completed', async () => {
    let releaseSilence!: () => void
    const silence = new Promise<void>((resolve) => {
      releaseSilence = resolve
    })
    const continuation = vi.fn()
    const pending = continueCrossPreviewAfterSilence(
      () => silence,
      continuation,
      () => false
    )

    expect(continuation).not.toHaveBeenCalled()
    releaseSilence()
    await expect(pending).resolves.toBe(true)
    expect(continuation).toHaveBeenCalledOnce()
  })

  it('does not publish a stale project after another preview supersedes the halt', async () => {
    let cancelled = false
    const continuation = vi.fn()
    const pending = continueCrossPreviewAfterSilence(
      async () => {
        cancelled = true
      },
      continuation,
      () => cancelled
    )

    await expect(pending).resolves.toBe(false)
    expect(continuation).not.toHaveBeenCalled()
  })
})

describe('PreviewHaltBarrier', () => {
  it('carries a halt across generations so the superseding preview resumes native playback', async () => {
    let releaseSilence!: () => void
    const silence = new Promise<void>((resolve) => {
      releaseSilence = resolve
    })
    const halt = vi.fn(() => silence)
    const barrier = new PreviewHaltBarrier()

    const olderGeneration = barrier.reachSilence(halt)
    const newerGeneration = barrier.pendingSilence()

    expect(halt).toHaveBeenCalledOnce()
    expect(newerGeneration).toBe(olderGeneration)
    releaseSilence()
    await newerGeneration

    // The stale request does not consume this. The latest request does and
    // therefore knows it must issue enginePlay even if Redux stayed true.
    expect(barrier.consumeResume()).toBe(true)
    expect(barrier.consumeResume()).toBe(false)
  })

  it('cancels automatic resume when the user actually stops the preview', async () => {
    const barrier = new PreviewHaltBarrier()
    await barrier.reachSilence(async () => undefined)
    barrier.cancelResume()
    expect(barrier.consumeResume()).toBe(false)
  })

  it('does not let a stale failed request consume a newer handoff resume', async () => {
    const barrier = new PreviewHaltBarrier()
    await barrier.reachSilence(async () => undefined)
    expect(barrier.consumeResumeIf(false)).toBe(false)
    expect(barrier.consumeResumeIf(true)).toBe(true)
  })
})
