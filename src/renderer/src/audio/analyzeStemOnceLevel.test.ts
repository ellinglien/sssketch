// The level pass on the one decode (spec 2026-10-05-radio-intensity-arc-design 7.2-7.3):
// analyzeStemOnce's needs.level, and a fresh extraction's level from every channel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stemLevelFeatures } from '@shared/stemLevel'

const NONE = { peaks: false, features: false, embedding: false, zeroShot: false }

const n = 22050
const left = new Float32Array(n)
const right = new Float32Array(n)
for (let i = 0; i < n; i++) {
  left[i] = 0.4 * Math.sin((2 * Math.PI * 110 * i) / 44100)
  right[i] = 0.2 * Math.sin((2 * Math.PI * 330 * i) / 44100)
}
function stereo(): AudioBuffer {
  return {
    getChannelData: (c: number) => (c === 0 ? left : right),
    sampleRate: 44100,
    length: n,
    duration: n / 44100,
    numberOfChannels: 2
  } as unknown as AudioBuffer
}

describe('analyzeStemOnce: the level pass', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>
  let decode: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    decode = vi.fn().mockImplementation(async () => stereo())
    api = {
      readAudioFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
      getStemPeaksCache: vi.fn().mockResolvedValue(null),
      setStemPeaksCache: vi.fn().mockResolvedValue(undefined),
      getStemFeatureCache: vi.fn().mockResolvedValue(null),
      setStemFeatureCache: vi.fn().mockResolvedValue(undefined),
      setStemAnalysisResults: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('window', { rifffApi: api })
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = decode
      }
    )
  })

  afterEach(async () => {
    await (await import('./analysisWriteQueue')).flushStemAnalysisWrites()
    vi.unstubAllGlobals()
  })

  async function writes(): Promise<Record<string, unknown>[]> {
    await (await import('./analysisWriteQueue')).flushStemAnalysisWrites()
    return (api.setStemAnalysisResults.mock.calls as [Record<string, unknown>[]][]).flatMap(
      ([b]) => b
    )
  }

  it('level alone: one read, one decode, every channel measured, one `level` write', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-l', { ...NONE, level: true })
    expect(result).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'skipped',
      zeroShot: 'skipped',
      level: 'done'
    })
    expect(api.readAudioFile).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
    const want = stemLevelFeatures([left, right], 44100)
    expect(await writes()).toEqual([{ path: '/lib/cid-l', level: { ...want, levelVersion: 1 } }])
    expect(api.setStemFeatureCache).not.toHaveBeenCalled()
  })

  it('a fresh extraction carries the level in its feature row, from both channels', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-f', { ...NONE, features: true, level: true })
    expect(result.features).toBe('done')
    expect(result.level).toBe('skipped')
    expect(decode).toHaveBeenCalledTimes(1)
    const [w] = await writes()
    const want = stemLevelFeatures([left, right], 44100)
    expect(w.features).toMatchObject({ ...want, levelVersion: 1 })
    expect('level' in w).toBe(false)
  })

  it('two scans asking for the same stem at once share one level pass', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const [a, b] = await Promise.all([
      analyzeStemOnce('/lib/cid-s', { ...NONE, level: true }),
      analyzeStemOnce('/lib/cid-s', { ...NONE, level: true })
    ])
    expect([a.level, b.level].sort()).toEqual(['done', 'skipped'])
    expect(decode).toHaveBeenCalledTimes(1)
    expect(await writes()).toHaveLength(1)
  })

  it('a level pass alongside peaks still decodes once', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-p', { ...NONE, peaks: true, level: true })
    expect(result.peaks).toBe('done')
    expect(result.level).toBe('done')
    expect(api.readAudioFile).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
    const [w] = await writes()
    expect(w.peaks).toBeDefined()
    expect(w.level).toEqual({ ...stemLevelFeatures([left, right], 44100), levelVersion: 1 })
  })

  it('a failed decode fails the level pass, and a later scan may retry it', async () => {
    decode.mockImplementationOnce(async () => {
      throw new Error('EncodingError')
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    expect((await analyzeStemOnce('/lib/cid-x', { ...NONE, level: true })).level).toBe('failed')
    expect((await analyzeStemOnce('/lib/cid-x', { ...NONE, level: true })).level).toBe('done')
    errors.mockRestore()
  })

  it('no level asked: the result has no `level` (today, exactly)', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    expect(await analyzeStemOnce('/lib/cid-n', { ...NONE, peaks: true })).toEqual({
      peaks: 'done',
      features: 'skipped',
      embedding: 'skipped',
      zeroShot: 'skipped'
    })
  })
})
