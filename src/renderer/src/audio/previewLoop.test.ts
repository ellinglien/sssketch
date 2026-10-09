import { describe, expect, it, vi } from 'vitest'

const { decodeStemFile } = vi.hoisted(() => ({ decodeStemFile: vi.fn() }))

vi.mock('./decodeStemFile', () => ({ decodeStemFile }))

import { startPreviewLoop } from './previewLoop'

describe('startPreviewLoop cancellation', () => {
  it('does not create or start sources when ownership is lost during decode', async () => {
    let finishDecode!: (buffer: AudioBuffer) => void
    decodeStemFile.mockReturnValueOnce(
      new Promise<AudioBuffer>((resolve) => {
        finishDecode = resolve
      })
    )
    const createBufferSource = vi.fn()
    const context = { createBufferSource } as unknown as AudioContext
    let cancelled = false

    const pending = startPreviewLoop(context, [{ path: '/pending.wav' }], () => cancelled)
    cancelled = true
    finishDecode({ duration: 1 } as AudioBuffer)

    await expect(pending).resolves.toEqual([])
    expect(createBufferSource).not.toHaveBeenCalled()
  })
})
