import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject, EngineStem } from '../../../src/shared/buildEngineProject'
import { buildEngineSound } from '../../../src/shared/buildEngineProject'
import { DEFAULT_SOUND_SETTINGS, type SoundSettings } from '../../../src/shared/radioSound'

// renderStretched (src/main/rubberband.ts) reaches into Electron's `app` object
// (via its private cacheDir() helper) purely to find a writable cache directory —
// there's no real Electron process under Vitest, so `app` is mocked to point the
// cache at a plain OS temp dir. Same pattern already established in
// src/main/playbackEngineLifecycle.test.ts for app.getAppPath.
const rubberbandCacheDir = mkdtempSync(join(tmpdir(), 'sssketch-rb-cache-'))
vi.mock('electron', () => ({ app: { getPath: () => rubberbandCacheDir } }))

const { renderStretched } = await import('../../../src/main/rubberband')

// Assumes native-engine has already been built (Tasks 1-8) — same precondition
// as every other manual verification step in this plan. Path matches the
// Debug artefact location confirmed throughout Phase 0/1.
const ENGINE_BINARY = join(
  __dirname,
  '../../build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
)

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

// Mirrors LoopSewing.cpp's applyLoopSewingBlend (ported from OUROVEON's
// Stem::applyLoopSewingBlend — see that file's own doc comment, and
// LoopSewing.h's, on why this matches OUROVEON's own literal 128-sample
// tuning exactly rather than a wider or per-stem-adaptive window) — applied
// ONCE when a buffer is loaded/cached, before any fade/gain, so these
// references have to apply it to their own copy of the raw fixture samples
// too, in the same order (blend first, then fade/gain).
const LOOP_SEWING_WINDOW = 128

// loopEndSample defaults to the full sample count, matching
// StemBufferCache::load's own fallback when a stem's metadata durationSec
// isn't usable — callers with a known true duration (distinct from the raw
// decoded length, e.g. a LORE stem's metadata-derived durationSec) should
// pass `Math.round(durationSec * sampleRate)` instead, matching production.
function applyLoopSewingBlend(samples: Float64Array, loopEndSample = samples.length): void {
  if (loopEndSample <= LOOP_SEWING_WINDOW * 2) return
  const startSample = samples[0]
  for (let i = 0; i < LOOP_SEWING_WINDOW; i++) {
    const endIndex = loopEndSample - 1 - i
    const t = -1.0 + (i / LOOP_SEWING_WINDOW) * 2.0
    const coeff = Math.sqrt(0.5 * (1.0 - t))
    samples[endIndex] = samples[endIndex] + (startSample - samples[endIndex]) * coeff
  }
}

/** The engine binary's CPU, from a thin Mach-O header ('arm64', 'x64'), or process.arch when the
 * header isn't one we know (a universal binary, say). */
function engineArch(): string {
  const head = readFileSync(ENGINE_BINARY).subarray(0, 8)
  const magic = head.readUInt32LE(0)
  if (magic !== 0xfeedfacf) return process.arch
  const cpu = head.readUInt32LE(4)
  if (cpu === 0x0100000c) return 'arm64'
  if (cpu === 0x01000007) return 'x64'
  return process.arch
}

describe('native engine vs Web Audio export — render parity', () => {
  let dir: string
  let tonePath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sssketch-parity-'))
    tonePath = join(dir, 'tone.wav')
    writeToneWav(tonePath, 4.0) // 4 seconds — exactly 1 bar at 60bpm

    // Warm up ENGINE_BINARY before any individually-timed test below touches
    // it. On the release CI matrix's x64 leg, this is a freshly cross-
    // compiled x86_64 Mach-O executing on an arm64 runner -- observed for
    // real on a live CI run: the FIRST test in this file to call
    // execFileSync(ENGINE_BINARY, ...) timed out at vitest's default 5000ms,
    // while every later invocation of that exact same binary in the same
    // run completed in well under a second, meaning the cost is a one-time,
    // first-execution thing (most likely the first-launch Rosetta
    // translate-and-cache step for a binary that's never been run on this
    // VM before), not a per-call cost. Paying it once here, inside
    // beforeAll's own generous hook timeout, keeps every real test below at
    // its normal fast timeout. Args are deliberately short (argc doesn't
    // reach --render-test's own argc>4 dispatch check in Main.cpp) so this
    // exits immediately after JUCE's init -- no real render happens, and
    // none is needed; only the exec itself matters.
    execFileSync(ENGINE_BINARY, ['--render-test'])
  }, 30000)

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(rubberbandCacheDir, { recursive: true, force: true })
  })

  // Each test below carries an explicit 30s timeout rather than vitest's
  // default 5000ms. beforeAll's warm-up above removes the one-time
  // first-exec cost, but these still shell out to a real subprocess (and
  // the stretch test below shells out to TWO -- rubberband, then the
  // engine), which is not work that belongs under a 5s budget on a
  // contended runner. Measured on the release workflow's x64 leg, where
  // the engine binary runs translated: ~1.7s each, so 5000 was ~3x and
  // 30000 is ~18x.
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
  }, 30000)

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
  }, 30000)

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
  }, 30000)

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
  }, 30000)

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
  }, 30000)
})

// ---------------------------------------------------------------------------------------------
// The radio sound (docs/superpowers/plans/2026-10-01-native-radio-sound.md, Task 14).
//
// OFF IS TODAY: a project with every stage off renders, through the CLI's RenderExport, exactly
// what the engine rendered before the plan. The reference is a saved fixture rendered by the
// engine built at 926eb84 (the commit before the plan's Task 0) from this same project: a tone
// with a mute region, a filtered noise row sending to zita with drawn cutoff, send and volume
// curves, a riser, two channels. To re-render it (never needed unless the fixture project here
// changes), build that commit's engine and run this file with
// SSSKETCH_OFF_FIXTURE_ENGINE=<its sssketch-engine binary>.
//
// EVERY STAGE ON: the same project with the radio sound's defaults (all on), as buildEngineSound
// sends them, a planned throw, a key and pumped rows, pans and a riser character. There is no
// reference for the whole chain outside the engine (each stage has its own golden and its own
// live == export test natively: BounceParityTests), so this pins what a mixdown must be: it
// renders, deterministically, at the same length, it is not today's render, and the limiter
// holds the -1 dBTP ceiling.

const FIXTURE_DIR = join(__dirname, 'fixtures')
const OFF_FIXTURE = join(FIXTURE_DIR, 'off-is-today.s16')
const OFF_FIXTURE_META = join(FIXTURE_DIR, 'off-is-today.json')
// 480 bpm: half a second a bar, so 2.5 bars is 1.25 s (a 220 KB fixture)
const FIXTURE_BARS = '2.5'

function writeMonoWav16(path: string, sample: (i: number) => number, numSamples: number): void {
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(44100, 24)
  buf.writeUInt32LE(44100 * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i))) * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

describe('the radio sound: off is today, and every stage on (Task 14)', () => {
  let dir: string
  let files: { tone: string; noise: string; kick: string }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sssketch-radio-parity-'))
    files = {
      tone: join(dir, 'tone.wav'),
      noise: join(dir, 'noise.wav'),
      kick: join(dir, 'kick.wav')
    }
    const bar = 22050 // half a second at 44.1 kHz
    writeMonoWav16(files.tone, (i) => 0.4 * Math.sin((2 * Math.PI * 220 * i) / 44100), bar)
    // a seeded LCG: the same noise on every machine
    let seed = 12345
    writeMonoWav16(
      files.noise,
      (i) => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        const on = i % 5512 < 2756
        return on ? 0.35 * ((seed / 4294967296) * 2 - 1) : 0
      },
      bar
    )
    writeMonoWav16(
      files.kick,
      (i) => {
        const t = i % 5512
        return 0.7 * Math.exp(-t / 2646) * Math.sin((2 * Math.PI * 60 * t) / 44100)
      },
      bar
    )
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** The fixture project. `radio` adds what the radio sound sends with every stage on. */
  function fixtureProject(radio: boolean): EngineProject {
    const stem = (key: string, path: string, extra: Partial<EngineStem>): EngineStem => ({
      stemKey: key,
      resolvedPath: path,
      durationSec: 0.5,
      barLength: 1,
      playedBars: 2.5,
      leftCropBars: 0,
      offsetSteps: 0,
      startBarOverride: -1,
      volume: 0.5,
      muted: false,
      muteRegions: [],
      oneShot: false,
      trimStartSec: 0,
      trimEndSec: -1,
      ...extra
    })
    const throwCurve = [
      { bar: 1, value: 0 },
      { bar: 1.01, value: 1 },
      { bar: 1.49, value: 1 },
      { bar: 1.5, value: 0 }
    ]
    const sound = radio
      ? buildEngineSound(structuredClone(DEFAULT_SOUND_SETTINGS) as SoundSettings, {
          timing: 'dotted-eighth',
          feedback: 0.55
        })
      : undefined
    return {
      bpm: 480,
      snapDiv: 16,
      loopLengthBars: 2.5,
      reverb: { roomSize: 0.6, damping: 0.4, preDelayMs: 30 },
      masterChain: [],
      channelChains: [],
      risers: [
        {
          id: 'riser-1',
          channelId: 'c2',
          startBar: 0.5,
          lengthBars: 1.5,
          startCutoffValue: 0.2,
          endCutoffValue: 0.9,
          level: 0.2,
          curve: [],
          ...(radio ? { q: 4, colour: 'pink' as const, send: 0.3 } : {})
        }
      ],
      ...(sound ? { sound } : {}),
      rifffs: [
        {
          groupId: 'r1',
          channelId: 'c1',
          startBar: 0,
          barLength: 1,
          stems: [
            stem('r1:1', files.kick, radio ? { pumpRole: 'key' } : {}),
            stem('r1:2', files.tone, {
              muteRegions: [{ startBar: 1, endBar: 1.25 }],
              ...(radio ? { pan: -0.25, pumpRole: 'pumped' as const } : {})
            })
          ]
        },
        {
          groupId: 'r2',
          channelId: 'c2',
          startBar: 0,
          barLength: 1,
          stems: [
            stem('r2:3', files.noise, {
              ...(radio ? { pan: 0.25, pumpRole: 'pumped' as const } : {}),
              toolkit: {
                filterMode: 'lowpass',
                filterCutoff: 0.6,
                filterResonance: 0.3,
                reverbSend: 0.5,
                volume: 1,
                originBar: 0,
                automation: {
                  filterCutoff: [
                    { bar: 0, value: 0.3 },
                    { bar: 2, value: 0.9 }
                  ],
                  filterResonance: [],
                  reverbSend: [
                    { bar: 0, value: 0.2 },
                    { bar: 2.5, value: 0.7 }
                  ],
                  volume: [
                    { bar: 0, value: 1 },
                    { bar: 1, value: 0.5 },
                    { bar: 2, value: 1 }
                  ],
                  ...(radio ? { dubSend: throwCurve } : {})
                }
              }
            })
          ]
        }
      ]
    } as EngineProject
  }

  function render(project: EngineProject, name: string, binary = ENGINE_BINARY): Int16Array {
    const projectPath = join(dir, `${name}.json`)
    const outPath = join(dir, `${name}.wav`)
    writeFileSync(projectPath, JSON.stringify(project))
    execFileSync(binary, ['--render-test', projectPath, outPath, FIXTURE_BARS])
    return readWavSamples(outPath)
  }

  it('every stage off renders exactly what the pre-plan engine rendered (the saved fixture)', () => {
    const preplanEngine = process.env.SSSKETCH_OFF_FIXTURE_ENGINE
    if (preplanEngine) {
      const samples = render(fixtureProject(false), 'fixture-preplan', preplanEngine)
      mkdirSync(FIXTURE_DIR, { recursive: true })
      writeFileSync(
        OFF_FIXTURE,
        Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
      )
      writeFileSync(
        OFF_FIXTURE_META,
        JSON.stringify(
          {
            renderedBy: 'the engine built at 926eb84 (before the radio sound plan), --render-test',
            arch: process.arch,
            format: 'int16 LE, stereo interleaved, 44.1 kHz',
            frames: samples.length / 2
          },
          null,
          2
        ) + '\n'
      )
    }
    const fixture = readFileSync(OFF_FIXTURE)
    const today = new Int16Array(fixture.buffer, fixture.byteOffset, fixture.byteLength / 2)
    expect(today.length).toBe(2 * Math.round(1.25 * 44100))

    // Every stage off, three ways the wire can say it: no `sound` block (what buildEngineProject
    // sends with every stage off), a block naming only today's room, and the pump's roles with
    // the pump off (sent whenever a block is).
    const off = fixtureProject(false)
    const withBlock: EngineProject = { ...off, sound: { room: 'zita' } }
    const withRoles: EngineProject = {
      ...withBlock,
      rifffs: off.rifffs.map((r) => ({
        ...r,
        stems: r.stems.map((s, i) => ({
          ...s,
          pumpRole: i === 0 && r.groupId === 'r1' ? 'key' : 'pumped'
        }))
      }))
    }
    // An x64 engine runs under Rosetta in CI (the release matrix): its float arithmetic can
    // round differently from the arm64 build that rendered the fixture (no FMA contraction),
    // which 16 bits mostly hide. Bit-identical on the fixture's own architecture; a one-step
    // tolerance elsewhere. The ENGINE's architecture, read from its Mach-O header -- not
    // process.arch: on the release matrix's x64 leg Node itself runs natively on the arm64
    // runner while the engine is x86_64 under Rosetta, which is how v1.4.0's first runs failed
    // here by one step at sample 3980.
    const meta = JSON.parse(readFileSync(OFF_FIXTURE_META, 'utf8')) as { arch: string }
    const tolerance = engineArch() === meta.arch ? 0 : 1
    for (const [name, project] of [
      ['no sound block', off],
      ['a block saying zita', withBlock],
      ['pump roles with the pump off', withRoles]
    ] as const) {
      const samples = render(project, `off-${name.replace(/ /g, '-')}`)
      expect(samples.length, name).toBe(today.length)
      let worst = 0
      let first = -1
      for (let i = 0; i < today.length; i++) {
        const d = Math.abs(samples[i] - today[i])
        if (d > 0 && first < 0) first = i
        worst = Math.max(worst, d)
      }
      expect(worst, `${name}: first difference at ${first}`).toBeLessThanOrEqual(tolerance)
    }
  }, 60000)

  it('every stage on renders, deterministically, at the same length, not today, under the -1 dBTP ceiling', () => {
    const project = fixtureProject(true)
    // what buildEngineSound sends for the defaults: every stage
    expect(Object.keys(project.sound ?? {}).sort()).toEqual(
      ['dub', 'glue', 'mastering', 'pump', 'room', 'saturation', 'tone'].sort()
    )
    expect(project.sound?.room).toBe('cavern')
    const a = render(project, 'all-on-a')
    const b = render(project, 'all-on-b')
    const fixture = readFileSync(OFF_FIXTURE)
    expect(a.length).toBe(fixture.byteLength / 2)
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true)
    expect(Buffer.from(a.buffer).equals(fixture)).toBe(false)
    let peak = 0
    for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]))
    // -1 dBFS is 29204 at 16 bits; the sample peak stays under the true-peak ceiling plus the
    // limiter's measured worst overshoot on hot noise (Task 3: +0.4 dB)
    expect(peak).toBeLessThan(Math.round(32767 * 10 ** (-0.6 / 20)))
    expect(peak).toBeGreaterThan(1000)
  }, 60000)
})
