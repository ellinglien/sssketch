import { describe, expect, it, vi } from 'vitest'
import { pauseArrangementBeforeShelfPreview } from './shelfPreviewHandoff'

describe('pauseArrangementBeforeShelfPreview', () => {
  it('pauses state before waiting for the native engine to stop', async () => {
    const order: string[] = []
    let finishStop!: () => void
    const stopEngine = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('stop-requested')
          finishStop = resolve
        })
    )
    const handoff = pauseArrangementBeforeShelfPreview({
      playing: true,
      pauseArrangement: () => order.push('paused'),
      stopEngine
    }).then(() => order.push('ready'))

    expect(order).toEqual(['paused', 'stop-requested'])
    finishStop()
    await handoff
    expect(order).toEqual(['paused', 'stop-requested', 'ready'])
  })

  it('still confirms native silence when React state is already paused', async () => {
    const pauseArrangement = vi.fn()
    const stopEngine = vi.fn(async () => undefined)
    await pauseArrangementBeforeShelfPreview({
      playing: false,
      pauseArrangement,
      stopEngine
    })
    expect(pauseArrangement).not.toHaveBeenCalled()
    expect(stopEngine).toHaveBeenCalledOnce()
  })
})
