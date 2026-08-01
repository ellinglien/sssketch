import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4])
}

function fakeAudioBuffer(): { getChannelData: () => Float32Array; sampleRate: number } {
  return {
    getChannelData: () => new Float32Array(256).fill(0.3),
    sampleRate: 44100
  }
}

describe('bandEnergyCache', () => {
  let readAudioFileMock: ReturnType<typeof vi.fn>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()

    vi.stubGlobal('window', { rifffApi: { readAudioFile: readAudioFileMock } })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the same in-flight promise across concurrent callers for the same path', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getBandEnergy } = await import('./bandEnergyCache')

    const [a, b] = await Promise.all([
      getBandEnergy('/some/path.wav'),
      getBandEnergy('/some/path.wav')
    ])

    expect(a).toEqual(b)
    expect(readAudioFileMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('evicts a rejected decode so a later call retries', async () => {
    readAudioFileMock
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getBandEnergy } = await import('./bandEnergyCache')

    await expect(getBandEnergy('/some/path.wav')).rejects.toThrow('permission denied')

    const result = await getBandEnergy('/some/path.wav')
    expect(result.numFrames).toBeGreaterThan(0)
    expect(readAudioFileMock).toHaveBeenCalledTimes(2)
  })

  it('returns bass/mid/treble arrays matching numFrames', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getBandEnergy } = await import('./bandEnergyCache')
    const result = await getBandEnergy('/some/path.wav')

    expect(result.bass.length).toBe(result.numFrames)
    expect(result.mid.length).toBe(result.numFrames)
    expect(result.treble.length).toBe(result.numFrames)
  })
})
