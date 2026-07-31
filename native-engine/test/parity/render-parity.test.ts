import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject } from '../../../src/shared/buildEngineProject'

// renderStretched (src/main/rubberband.ts) reaches into Electron's `app` object
// (via its private cacheDir() helper) purely to find a writable cache directory —
// there's no real Electron process under Vitest, so `app` is mocked to point the
// cache at a plain OS temp dir. Same pattern already established in
// src/main/playbackEngineLifecycle.test.ts for app.getAppPath.
const rubberbandCacheDir = mkdtempSync(join(tmpdir(), 'ssstitch-rb-cache-'))
vi.mock('electron', () => ({ app: { getPath: () => rubberbandCacheDir } }))

const { renderStretched } = await import('../../../src/main/rubberband')

// Assumes native-engine has already been built (Tasks 1-8) — same precondition
// as every other manual verification step in this plan. Path matches the
// Debug artefact location confirmed throughout Phase 0/1.
const ENGINE_BINARY = join(__dirname, '../../build/ssstitch_engine_artefacts/Debug/ssstitch_engine')

function writeToneWav(path: string, durationSec: number, sampleRate = 44100): void {
  // A simple 16-bit mono WAV containing a fixed low-frequency sine, generated
  // directly (no dependency on any Endlesss export) — deterministic and small.
  const numSamples = Math.floor(durationSec * sampleRate)
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

// The sample code this test started from assumed a fixed 44-byte header for
// every WAV read here. That holds for `tone.wav` (written by writeToneWav
// above, which emits exactly RIFF/fmt /data with no extras), but NOT for the
// native engine's own output: JUCE's WavAudioFormat writer inserts a 52-byte
// "JUNK" padding chunk between the RIFF header and "fmt " (confirmed by
// dumping native-out.wav's chunk list: JUNK size=52 @12, fmt  size=16 @72,
// data @96 -> sample data actually starts at byte 104, not 44). Assuming a
// fixed 44 there silently read 60 bytes into the fmt/JUNK region as if it
// were sample data, producing a huge, meaningless maxDiff. Walking the actual
// chunk structure to find "data" works correctly for both WAV shapes.
function findDataChunkOffset(buf: Buffer): number {
  let offset = 12 // past "RIFF" + size(4) + "WAVE"
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset + 8
    // RIFF chunks are word-aligned: an odd-sized chunk is padded with 1 byte.
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  throw new Error(`no "data" chunk found in WAV (${buf.length} bytes)`)
}

function readWavSamples(path: string): Int16Array {
  const buf = readFileSync(path)
  const dataStart = findDataChunkOffset(buf)
  const dataBytes = buf.length - dataStart
  const samples = new Int16Array(dataBytes / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(dataStart + i * 2)
  }
  return samples
}

// Mirrors FadeGain.cpp/fadeGain.ts's always-on ~3ms anti-click floor (see
// either file's own doc comment) — these "expected" references are computed
// by hand rather than through any shared fade function, so the floor has to
// be reproduced here too or every test with an unfaded (fadeInBars/
// fadeOutBars = 0) segment would diverge from the native engine's real
// output right at that segment's start/end.
const MICRO_FADE_SEC = 0.003

function microFadeGain(
  tSec: number,
  segmentDurationSec: number,
  fadeInBars: number,
  fadeOutBars: number,
  secPerBar: number,
  isFirstSegment: boolean,
  isLastSegment: boolean
): number {
  const halfDuration = segmentDurationSec / 2
  let gain = 1.0
  if (isFirstSegment) {
    const fadeInSec = Math.max(
      Math.min(fadeInBars * secPerBar, halfDuration),
      Math.min(MICRO_FADE_SEC, halfDuration)
    )
    if (fadeInSec > 0 && tSec < fadeInSec) gain = Math.min(gain, tSec / fadeInSec)
  }
  if (isLastSegment) {
    const fadeOutSec = Math.max(
      Math.min(fadeOutBars * secPerBar, halfDuration),
      Math.min(MICRO_FADE_SEC, halfDuration)
    )
    const fadeOutStart = segmentDurationSec - fadeOutSec
    if (fadeOutSec > 0 && tSec > fadeOutStart) {
      gain = Math.min(gain, (segmentDurationSec - tSec) / fadeOutSec)
    }
  }
  return Math.max(0, gain)
}

// Mirrors LoopSewing.cpp's applyLoopSewingBlend and adaptiveLoopSewingWindow
// (ported from OUROVEON's Stem::applyLoopSewingBlend — see that file's own
// doc comment) — applied ONCE when a buffer is loaded/cached, before any
// fade/gain, so these references have to apply it to their own copy of the
// raw fixture samples too, in the same order (blend first, then fade/gain).
const LOOP_SEWING_MIN_WINDOW = 512
const LOOP_SEWING_MAX_WINDOW = 2048

function adaptiveLoopSewingWindow(samples: Float64Array, sampleRate: number): number {
  const n = samples.length
  const analysisWindow = Math.min(LOOP_SEWING_MAX_WINDOW, n)
  if (analysisWindow < 2) return LOOP_SEWING_MIN_WINDOW
  const startIndex = n - analysisWindow
  let crossings = 0
  for (let i = startIndex + 1; i < n; i++) {
    if (samples[i - 1] < 0 !== samples[i] < 0) crossings++
  }
  const windowDurationSec = analysisWindow / sampleRate
  const estimatedFreqHz = crossings / 2 / windowDurationSec
  const kBassyFreqHz = 150
  const kBrightFreqHz = 1000
  if (estimatedFreqHz <= kBassyFreqHz) return LOOP_SEWING_MAX_WINDOW
  if (estimatedFreqHz >= kBrightFreqHz) return LOOP_SEWING_MIN_WINDOW
  const logLow = Math.log(kBassyFreqHz)
  const logHigh = Math.log(kBrightFreqHz)
  const t = (Math.log(estimatedFreqHz) - logLow) / (logHigh - logLow)
  return Math.round(LOOP_SEWING_MAX_WINDOW + t * (LOOP_SEWING_MIN_WINDOW - LOOP_SEWING_MAX_WINDOW))
}

function applyLoopSewingBlend(samples: Float64Array, sampleRate = 44100): void {
  const n = samples.length
  const window = adaptiveLoopSewingWindow(samples, sampleRate)
  if (n <= window * 2) return
  const startSample = samples[0]
  for (let i = 0; i < window; i++) {
    const endIndex = n - 1 - i
    const t = -1.0 + (i / window) * 2.0
    const coeff = Math.sqrt(0.5 * (1.0 - t))
    samples[endIndex] = samples[endIndex] + (startSample - samples[endIndex]) * coeff
  }
}

describe('native engine vs Web Audio export — render parity', () => {
  let dir: string
  let tonePath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssstitch-parity-'))
    tonePath = join(dir, 'tone.wav')
    writeToneWav(tonePath, 4.0) // 4 seconds — exactly 1 bar at 60bpm
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(rubberbandCacheDir, { recursive: true, force: true })
  })

  it('produces near-identical output to the native engine for a simple one-stem project', async () => {
    // --- Native side: EngineProject JSON -> --render-test -> WAV ---
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1,
          fadeInBars: 0,
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 0.8,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out.wav')
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'])
    const nativeSamples = readWavSamples(nativeOutPath)

    // --- Reference side: the exact same math, computed directly in JS to avoid
    // needing a full jsdom + Web Audio + Electron renderer environment just for
    // this test. This mirrors exactly what the native engine's mixing does for
    // one unstretched, unmuted, unfaded stem: sample[i] = sourceSample[i] * volume. ---
    const toneBuf = readFileSync(tonePath)
    const sampleRate = 44100
    const segmentDurationSec = 4.0
    const numSamples = Math.floor(segmentDurationSec * sampleRate)
    const rawSamples = new Float64Array(numSamples)
    for (let i = 0; i < numSamples; i++) rawSamples[i] = toneBuf.readInt16LE(44 + i * 2)
    applyLoopSewingBlend(rawSamples)

    const expectedSamples = new Int16Array(numSamples)
    for (let i = 0; i < numSamples; i++) {
      const gain = microFadeGain(i / sampleRate, segmentDurationSec, 0, 0, 4.0, true, true)
      expectedSamples[i] = Math.round(rawSamples[i] * 0.8 * gain)
    }

    expect(nativeSamples.length).toBeGreaterThanOrEqual(expectedSamples.length)
    // Left channel only (native output is stereo, reference is mono-sourced) —
    // compare the interleaved-stereo native output's left channel (even indices)
    // against the mono reference, allowing a small tolerance for 16-bit rounding.
    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      const diff = Math.abs(nativeSamples[i * 2] - expectedSamples[i])
      maxDiff = Math.max(maxDiff, diff)
    }

    console.log('render-parity: volume-only test maxDiff =', maxDiff)
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance
  })

  it('matches a fade-in envelope applied to the same tone', async () => {
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1,
          fadeInBars: 0.5, // 2 seconds of fade-in at 60bpm (secPerBar=4)
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 1.0,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project-fade.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-fade.wav')
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'])
    const nativeSamples = readWavSamples(nativeOutPath)

    const toneBuf = readFileSync(tonePath)
    const sampleRate = 44100
    const segmentDurationSec = 4.0
    const numSamples = Math.floor(segmentDurationSec * sampleRate)
    const rawSamples = new Float64Array(numSamples)
    for (let i = 0; i < numSamples; i++) rawSamples[i] = toneBuf.readInt16LE(44 + i * 2)
    applyLoopSewingBlend(rawSamples)

    const expectedSamples = new Int16Array(numSamples)
    for (let i = 0; i < numSamples; i++) {
      // fadeInBars 0.5 -> 2s explicit fade-in (far bigger than the floor, so
      // unaffected by it); fadeOutBars 0 -> only the anti-click floor applies
      // at the very end, which this test didn't have to account for before.
      const gain = microFadeGain(i / sampleRate, segmentDurationSec, 0.5, 0, 4.0, true, true)
      expectedSamples[i] = Math.round(rawSamples[i] * gain)
    }

    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(nativeSamples[i * 2] - expectedSamples[i]))
    }

    console.log('render-parity: fade-in test maxDiff =', maxDiff)
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance
  })

  it('fails cleanly (nonzero exit, no crash) for a project with an invalid bpm', async () => {
    // Covers the `secPerBar <= 0.0` guard added to renderProjectToWavFile
    // (native-engine/Source/RenderExport.cpp) beyond Phase 1's original
    // runRenderTest, which had no such check and would have produced
    // NaN/Inf math or a degenerate buffer instead of a clear failure.
    const project: EngineProject = {
      bpm: 0,
      snapDiv: 16,
      rifffs: []
    }
    const projectPath = join(dir, 'project-invalid-bpm.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-invalid-bpm.wav')

    expect(() =>
      execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'], {
        stdio: 'pipe'
      })
    ).toThrow()
  })

  it('matches a tempo-stretched stem (rifff recorded at 80bpm, project at 60bpm)', async () => {
    // ratio = projectBpm / rifffBpm, same formula buildEngineProject.ts uses.
    // 60/80 = 0.75, well past the >= 0.001 "is this a real stretch" threshold
    // at src/shared/buildEngineProject.ts:56. ratio < 1 means "slow down" ->
    // rubberband's --tempo semantics (see src/main/rubberband.ts comment)
    // produce a LONGER file than the 4s source tone.
    const ratio = 60 / 80
    const { path: stretchedPath } = await renderStretched(tonePath, ratio)
    expect(stretchedPath).not.toBe(tonePath) // confirms a real render happened, not the ratio~1 no-op passthrough

    // Measure the stretched file's actual duration directly from its own data
    // rather than assuming an arithmetic value — rubberband's exact output
    // length isn't a simple ratio of the input length.
    const stretchedSamples = readWavSamples(stretchedPath)
    const stretchedDurationSec = stretchedSamples.length / 44100
    // Sanity check: slowing down (ratio<1) must produce something longer than
    // the 4s source, not shorter or equal.
    expect(stretchedDurationSec).toBeGreaterThan(4.0)

    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1,
          fadeInBars: 0,
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: stretchedPath,
              durationSec: stretchedDurationSec,
              barLength: 1,
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 0.8,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project-stretch.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-stretch.wav')
    // Unlike the other 3 cases (whose 4-second tone exactly fills the 1-bar,
    // 4-second-per-bar render window at 60bpm), the stretched stem is longer
    // than 1 bar's worth of wall-clock time. --render-test's 4th argument is
    // durationBars, which sizes the output buffer as durationBars * secPerBar
    // — it must cover the stretched stem's full length or the tail gets
    // silently truncated (independently of rifff/stem barLength, which only
    // affect scheduling, not the render buffer's total size). secPerBar at
    // bpm=60 is 4s/bar; add a full extra bar of headroom beyond the minimum
    // needed so no edge-of-buffer rounding clips the last few samples.
    const secPerBar = 4.0 // (60 / bpm) * 4, bpm=60
    const renderDurationBars = (stretchedDurationSec / secPerBar + 1).toFixed(6)
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, renderDurationBars])
    const nativeSamples = readWavSamples(nativeOutPath)

    // Reference: the stretch itself already happened above (rubberband CLI,
    // outside the native engine) — this reference reads the STRETCHED file's
    // own samples and applies the same plain volume scaling the other cases
    // use. It does not reimplement any stretch/resampling math.
    const stretchedRawSamples = Float64Array.from(stretchedSamples)
    applyLoopSewingBlend(stretchedRawSamples)

    const expectedSamples = new Int16Array(stretchedSamples.length)
    for (let i = 0; i < expectedSamples.length; i++) {
      const gain = microFadeGain(i / 44100, stretchedDurationSec, 0, 0, secPerBar, true, true)
      expectedSamples[i] = Math.round(stretchedRawSamples[i] * 0.8 * gain)
    }

    expect(nativeSamples.length).toBeGreaterThanOrEqual(expectedSamples.length)
    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      const diff = Math.abs(nativeSamples[i * 2] - expectedSamples[i])
      maxDiff = Math.max(maxDiff, diff)
    }

    console.log('render-parity: stretch-ratio test maxDiff =', maxDiff)
    // Same 16-bit rounding tolerance as the other 3 cases — the engine reads
    // the already-stretched file verbatim and applies only a gain multiply
    // here (no additional resampling on the native side for this path), so
    // no wider tolerance is expected or justified.
    expect(maxDiff).toBeLessThanOrEqual(2)
  })

  it('re-loops a stem from its own beginning when playedBars exceeds its native barLength', async () => {
    // 1-bar stem (4s tone at 60bpm), playedBars=2 -> should tile twice, restarting
    // from the buffer's own start each time (not looping/wrapping mid-buffer).
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1, // rifff.barLength deliberately UNCHANGED/irrelevant here —
          // playedBars is what the scheduler now actually reads
          fadeInBars: 0,
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              playedBars: 2, // the actual point of this test
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 1.0,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project-playedbars.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-playedbars.wav')
    // durationBars=2 to cover the full 8s (2 tiles x 4s) this project should now render.
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '2'])
    const nativeSamples = readWavSamples(nativeOutPath)

    // Reference: the 4s tone concatenated with itself (two full, unstretched,
    // unfaded repeats back-to-back), each repeat starting from the buffer's own
    // sample 0 — exactly what "re-loops from the beginning" means.
    // The anti-click floor only touches the FIRST tile's own start (isFirst,
    // not isLast) and the SECOND tile's own end (isLast, not isFirst) — the
    // seam between the two tiles at the 4s mark gets no fade at all, matching
    // the native engine's own isFirstSegment/isLastSegment scoping (see
    // FadeGain.cpp: applies at a stem's own overall play-window edges, not
    // every internal tiling repetition).
    const sampleRate = 44100
    const tileDurationSec = 4.0
    const toneBuf = readFileSync(tonePath)
    // Loaded ONCE (mirroring StemBufferCache: one cached buffer, read twice
    // for the two tiles) — the loop-sewing blend is applied here, to that
    // single shared buffer, not independently per tile-read.
    const oneTileSamples = new Float64Array(Math.floor(tileDurationSec * sampleRate))
    for (let i = 0; i < oneTileSamples.length; i++) {
      oneTileSamples[i] = toneBuf.readInt16LE(44 + i * 2)
    }
    applyLoopSewingBlend(oneTileSamples)

    const expectedSamples = new Int16Array(oneTileSamples.length * 2)
    for (let i = 0; i < oneTileSamples.length; i++) {
      const gainTile0 = microFadeGain(i / sampleRate, tileDurationSec, 0, 0, 4.0, true, false)
      expectedSamples[i] = Math.round(oneTileSamples[i] * gainTile0)
      const gainTile1 = microFadeGain(i / sampleRate, tileDurationSec, 0, 0, 4.0, false, true)
      expectedSamples[oneTileSamples.length + i] = Math.round(oneTileSamples[i] * gainTile1)
    }

    expect(nativeSamples.length).toBeGreaterThanOrEqual(expectedSamples.length)
    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(nativeSamples[i * 2] - expectedSamples[i]))
    }
    console.log('render-parity: playedBars re-loop test maxDiff =', maxDiff)
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance, matching the other cases
  })
})
