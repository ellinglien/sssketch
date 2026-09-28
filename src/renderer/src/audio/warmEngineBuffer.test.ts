import { describe, it, expect, vi } from 'vitest'
import { warmEngineBuffer } from './warmEngineBuffer'

// A stem recorded at 120bpm-worth of seconds-per-bar: 2s per bar.
const twoSecPerBar = { path: '/stems/native', durationSec: 8, barLength: 4 }

describe('warmEngineBuffer', () => {
  it('warms the stem itself when the project tempo needs no stretch', async () => {
    const resolve = vi.fn()
    const preload = vi.fn()
    // 120bpm is exactly this stem's own native tempo, so buildEngineProject
    // would resolve nothing and setProject would load the raw file.
    await warmEngineBuffer(twoSecPerBar, 120, resolve, preload)
    expect(resolve).not.toHaveBeenCalled()
    expect(preload).toHaveBeenCalledWith('/stems/native', 8)
  })

  it('warms the STRETCHED file, not the stem it came from', async () => {
    const resolve = vi.fn().mockResolvedValue({ path: '/cache/stretched', durationSec: 6 })
    const preload = vi.fn()
    // 160bpm is 1.5s per bar against the stem's own 2s, so it has to be
    // played 4/3 as slow -- a real stretch, and the ratio buildEngineProject
    // itself would compute.
    await warmEngineBuffer(twoSecPerBar, 160, resolve, preload)
    expect(resolve).toHaveBeenCalledWith('/stems/native', 2 / 1.5)
    // The exact pair buildEngineProject will put in EngineStem.resolvedPath/
    // durationSec -- warming the unstretched file instead would warm a file
    // nothing ever loads, which is the whole failure this guards against.
    expect(preload).toHaveBeenCalledWith('/cache/stretched', 6)
    expect(preload).toHaveBeenCalledTimes(1)
  })

  it('falls back to the native file when the stretch cannot be resolved', async () => {
    // buildEngineProject catches a failed render per stem and falls back to
    // native-tempo playback for exactly that stem, so that is the file
    // setProject will ask for and therefore the one worth warming.
    const resolve = vi.fn().mockRejectedValue(new Error('rubberband missing'))
    const preload = vi.fn()
    await warmEngineBuffer(twoSecPerBar, 160, resolve, preload)
    expect(preload).toHaveBeenCalledWith('/stems/native', 8)
  })

  it('never rejects, so a caller can fire and forget it', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('nope'))
    const preload = vi.fn(() => {
      throw new Error('ipc is gone')
    })
    await expect(warmEngineBuffer(twoSecPerBar, 160, resolve, preload)).resolves.toBeUndefined()
  })

  it('warms nothing for a stem with no measurable path', async () => {
    const resolve = vi.fn()
    const preload = vi.fn()
    await warmEngineBuffer({ path: '', durationSec: 8, barLength: 4 }, 120, resolve, preload)
    expect(preload).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })
})
