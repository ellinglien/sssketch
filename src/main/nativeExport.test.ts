import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from '../shared/types'

// nativeExport's internal spawnEngine() call (see engineProcess.ts's
// defaultBinaryPath) resolves the compiled engine binary's path via
// app.getAppPath() — real Electron machinery that isn't running under plain
// Vitest. This is the same constraint Task 4 hit for engineProcess.test.ts,
// but nativeExport itself exposes no binaryPathOverride to route around it,
// so the fix here is a mock instead: in real dev-mode Electron,
// app.getAppPath() returns exactly the directory containing package.json
// (the worktree root), which is also where Vitest's own process.cwd()
// already points when tests run from the repo root — so this mock is a
// faithful stand-in for that one piece of Electron machinery, not a
// workaround that changes what's under test. vi.mock calls are hoisted
// above all imports in this file by Vitest, so nativeExport.ts's own
// dependency chain (via engineProcess.ts's `import { app } from 'electron'`)
// sees this mock. loopLengthBarsFor below has no electron dependency at all,
// so the mock has no effect on those existing tests.
//
// getPath is needed too now that nativeExport calls pluginCatalog.ts's
// loadCatalog() (to resolve a masterChain slot's catalog id to a real file
// path) -- loadCatalog only ever reads (existsSync + readFileSync, never
// writes here), so tmpdir() is a safe stand-in: no pluginCatalog.json will
// exist there, and loadCatalog treats that as "no scan has run yet" (an
// empty catalog), which is exactly correct for these fixtures, none of
// which set masterChain.
// shell.openPath is mocked as a no-op: exportStemsToLibrary/
// exportStemsNextToSource (added below) open the destination in Finder on
// success, same as nativeExportStemsToDisk already does, but there's no real
// Finder to open against under Vitest -- nothing in this file asserts on it,
// it just needs to not throw (see the earlier "No shell export is defined on
// the electron mock" failure this fixes).
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

// Wraps the real buildEngineProject in a spy (still calling straight through
// to the real implementation) so the pluginStates-threading tests below can
// assert on what argument each renderStemsToDir/renderStemTracksToDir call
// actually passed, without needing a real plugin binary to observe an
// audible effect -- per this codebase's own convention, real plugin-hosting
// behavior itself is verified by manual walkthrough, not faked here.
vi.mock('@shared/buildEngineProject', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/buildEngineProject')>()
  return { ...actual, buildEngineProject: vi.fn(actual.buildEngineProject) }
})

import { buildEngineProject } from '@shared/buildEngineProject'
import type { RawPluginStatesCapture } from '@shared/pluginStates'
import {
  loopLengthBarsFor,
  nativeExport,
  renderStemsToDir,
  renderStemTracksToDir,
  soloState,
  withoutRisers,
  riserOnlyState,
  exportStemsToLibrary,
  exportStemsNextToSource,
  exportStemTracksToLibrary,
  exportStemTracksNextToSource
} from './nativeExport'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    {
      slot: 1,
      author: 'e',
      name: 'a',
      type: 'fx',
      path: '/a.wav',
      durationSec: 12.8,
      barLength: 8
    },
    { slot: 2, author: 'e', name: 'b', type: 'fx', path: '/b.wav', durationSec: 12.8, barLength: 8 }
  ]
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...initialState, rifffs: { r1: rifff }, ...overrides }
}

describe('loopLengthBarsFor', () => {
  it('falls back to the default when nothing is placed', () => {
    expect(loopLengthBarsFor(stateWith({ rifffs: {} }))).toBe(32)
  })

  it('uses the rifff-level end (startBar + barLength)', () => {
    // startBar 4 + barLength 8 = 12
    expect(loopLengthBarsFor(stateWith({}))).toBe(12)
  })

  it('respects a playedBars resize override, not just raw barLength', () => {
    // startBar 4 + a resize to 16 bars = 20, not 4 + 8 = 12.
    const state = stateWith({ playedBars: { r1: 16 } })
    expect(loopLengthBarsFor(state)).toBe(20)
  })
})

describe('soloState', () => {
  it('mutes every key except the target(s), regardless of the input mute map', () => {
    const state = stateWith({ mute: { 'r1:1': false, 'r1:2': true } })
    const result = soloState(state, new Set(['r1:1']), ['r1:1', 'r1:2'])
    expect(result.mute).toEqual({ 'r1:1': false, 'r1:2': true })
  })

  it('zeroes the master chain regardless of what was set', () => {
    const state = stateWith({ masterChain: ['some-limiter-id', null, null, null] })
    const result = soloState(state, new Set(['r1:1']), ['r1:1', 'r1:2'])
    expect(result.masterChain).toEqual([null, null, null, null])
  })

  it('supports multiple simultaneous targets (a bus solo, not just a single stem)', () => {
    const state = stateWith({})
    const result = soloState(state, new Set(['r1:1', 'r1:2']), ['r1:1', 'r1:2', 'r1:3'])
    expect(result.mute).toEqual({ 'r1:1': false, 'r1:2': false, 'r1:3': true })
  })

  it('leaves every other field of state untouched', () => {
    const state = stateWith({ bpm: 133 })
    const result = soloState(state, new Set(['r1:1']), ['r1:1'])
    expect(result.bpm).toBe(133)
    expect(result.rifffs).toBe(state.rifffs)
  })
})

/** A 16-bit mono WAV of a constant sample value, repeated for numSamples. Not
 * an actual tone (no frequency) — deliberately simple so the reference math
 * below is just "the constant, scaled by volume" with nothing else to model. */
function writeConstantWav(
  path: string,
  value: number,
  numSamples: number,
  sampleRate = 44100
): void {
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
  const sample16 = Math.round(value * 32767)
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(sample16, 44 + i * 2)
  }
  writeFileSync(path, buf)
}

// Walks the RIFF chunk list to find "data" rather than assuming a fixed
// offset — JUCE's WavAudioFormat writer (the native engine's own output)
// inserts a JUNK padding chunk before "fmt ", pushing real audio data well
// past byte 44. This exact bug (assuming a fixed 44-byte header) was hit and
// fixed in Phase 1's render-parity.test.ts; reusing the same approach here.
function findDataChunkOffset(buf: Buffer): number {
  let offset = 12 // past "RIFF" + size(4) + "WAVE"
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset + 8
    offset += 8 + chunkSize + (chunkSize % 2) // chunks are word-aligned
  }
  throw new Error(`no "data" chunk found in WAV (${buf.length} bytes)`)
}

// Mirrors FadeGain.cpp's always-on ~3ms anti-click floor (see its own doc
// comment) — this reference is computed independently by hand, so the floor
// has to be reproduced here too or every segment in this fixture would
// diverge from the native engine's real output right at its start/end. The
// floor is applied unconditionally by buildFadePoints, which is why the
// engine still runs that code even though nothing sends it a fade length
// any more.
const MICRO_FADE_SEC = 0.003

// Simpler than render-parity.test.ts's own version of this helper: only the
// flat MICRO_FADE_SEC floor ever applies — no need to also take secPerBar.
function microFadeGain(tSec: number, segmentDurationSec: number): number {
  const fadeSec = Math.min(MICRO_FADE_SEC, segmentDurationSec / 2)
  if (fadeSec <= 0) return 1.0
  if (tSec < fadeSec) return tSec / fadeSec
  const fadeOutStart = segmentDurationSec - fadeSec
  if (tSec > fadeOutStart) return Math.max(0, (segmentDurationSec - tSec) / fadeSec)
  return 1.0
}

describe('nativeExport — multi-stem/multi-rifff parity against reference math', () => {
  it('produces near-identical output for a two-stem, two-rifff project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-export-parity-'))
    const stemAPath = join(dir, 'a.wav')
    const stemBPath = join(dir, 'b.wav')
    const sampleRate = 44100
    const numSamples = 4 * sampleRate // 4 seconds — exactly 1 bar at 60bpm
    const volA = 0.3
    const volB = 0.2
    writeConstantWav(stemAPath, volA, numSamples, sampleRate)
    writeConstantWav(stemBPath, volB, numSamples, sampleRate)

    // Everything below is wrapped in try/finally so the mkdtempSync'd
    // fixture dir (containing both WAV fixtures) always gets cleaned up,
    // even if an assertion throws — that's the exact failure mode this test
    // exists to catch, and a failing run shouldn't leak temp files in
    // addition to reporting the failure.
    try {
      // Two separate rifffs, each with a single stem, both starting at bar 0
      // and both exactly 1 bar long — so their outputs fully overlap in
      // time, giving multi-rifff *and* multi-stem summation in one render.
      const rifffA: Rifff = {
        groupId: 'r1',
        name: 'a',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: stemAPath,
            durationSec: 4,
            barLength: 1
          }
        ]
      }
      const rifffB: Rifff = {
        groupId: 'r2',
        name: 'b',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'b',
            type: 'fx',
            path: stemBPath,
            durationSec: 4,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60, // matches both rifffs' own bpm, so ratio === 1 and no stretch resolution kicks in
        rifffs: { r1: rifffA, r2: rifffB }
      }

      const nativeBytes = await nativeExport(state, null)

      // Reference: both stems are unstretched (project bpm === rifff bpm),
      // unmuted, with no drawn automation at all, at volume 1 (state.vol has no entries -> default 1, per
      // buildEngineProject.ts), both starting at bar 0 and both exactly 1
      // bar long matching their rifff's own length. So the expected output
      // is the sample-wise sum of the two constant-value fixtures (each
      // carrying its own anti-click floor — see microFadeGain — since both
      // are single, whole-clip segments), clamped to int16 range — exactly
      // what the native engine's mixing would produce for this fixture,
      // computed here as independent reference math rather than by calling
      // nativeExport() a second time (which is the function under test, so
      // it can't also serve as its own reference).
      const a16 = Math.round(volA * 32767)
      const b16 = Math.round(volB * 32767)
      const segmentDurationSec = numSamples / sampleRate

      const nativeBuf = Buffer.from(
        nativeBytes.buffer,
        nativeBytes.byteOffset,
        nativeBytes.byteLength
      )
      const nativeDataStart = findDataChunkOffset(nativeBuf)
      // Native output is stereo (interleaved L/R, 4 bytes per frame);
      // compare the left channel only against the mono reference.
      const numFrames = (nativeBuf.length - nativeDataStart) / 4
      expect(numFrames).toBeGreaterThanOrEqual(numSamples)

      let maxDiff = 0
      for (let i = 0; i < numSamples; i++) {
        const gain = microFadeGain(i / sampleRate, segmentDurationSec)
        const expected16 = Math.max(-32768, Math.min(32767, Math.round(a16 * gain + b16 * gain)))
        const left = nativeBuf.readInt16LE(nativeDataStart + i * 4)
        maxDiff = Math.max(maxDiff, Math.abs(left - expected16))
      }

      console.log('nativeExport parity: two-stem/two-rifff maxDiff =', maxDiff)
      expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance, matching Phase 1's parity test
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('renderStemsToDir', () => {
  it('mixes every stem assigned to a bus down into one <busId>.wav, not one file per stem', async () => {
    // Two DIFFERENT stems, both assigned to the 'drums' bus -- the point of
    // this export is "the tidied track", so both must land in ONE file, not
    // two, unlike the old per-stem behavior.
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      const stemAPath = join(srcDir, 'a.wav')
      const stemBPath = join(srcDir, 'b.wav')
      writeConstantWav(stemAPath, 0.3, 4410)
      writeConstantWav(stemBPath, 0.2, 4410)
      const rifffA: Rifff = {
        groupId: 'r1',
        name: 'a',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'kick',
            type: 'fx',
            path: stemAPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const rifffB: Rifff = {
        groupId: 'r2',
        name: 'b',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 1,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'snare',
            type: 'fx',
            path: stemBPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifffA, r2: rifffB },
        busOf: { 'r1:1': 'drums', 'r2:1': 'drums' }
      }

      const fileNames = await renderStemsToDir(state, destDir)

      expect(fileNames).toEqual(['drums.wav'])
      expect(existsSync(join(destDir, 'drums.wav'))).toBe(true)
      expect(existsSync(join(destDir, 'bass.wav'))).toBe(false) // no stems on this bus -- no file
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('renders one file per bus that actually has stems, none for buses with nothing assigned', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      const drumsStemPath = join(srcDir, 'a.wav')
      const bassStemPath = join(srcDir, 'b.wav')
      writeConstantWav(drumsStemPath, 0.3, 4410)
      writeConstantWav(bassStemPath, 0.2, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'my rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'kick',
            type: 'fx',
            path: drumsStemPath,
            durationSec: 0.1,
            barLength: 1
          },
          {
            slot: 2,
            author: 'e',
            name: 'sub',
            type: 'fx',
            path: bassStemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'drums', 'r1:2': 'bass' }
      }

      const fileNames = await renderStemsToDir(state, destDir)

      // Bus order (BUS_ORDER in nativeExport.ts), not discovery/placement order.
      expect(fileNames).toEqual(['drums.wav', 'bass.wav'])
      expect(existsSync(join(destDir, 'drums.wav'))).toBe(true)
      expect(existsSync(join(destDir, 'bass.wav'))).toBe(true)
      expect(existsSync(join(destDir, 'lead.wav'))).toBe(false)
      expect(existsSync(join(destDir, 'backing.wav'))).toBe(false)
      expect(existsSync(join(destDir, 'aux.wav'))).toBe(false)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('falls back to aux.wav for a stem with no busOf assignment', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'untidied',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = { ...initialState, bpm: 60, rifffs: { r1: rifff }, busOf: {} }

      const fileNames = await renderStemsToDir(state, destDir)

      expect(fileNames).toEqual(['aux.wav'])
      expect(existsSync(join(destDir, 'aux.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('actually mixes (sums) two same-bus stems, not just renders one of them', async () => {
    // Real content-level parity check, mirroring the nativeExport parity
    // test above: two stems, same bus, fully time-overlapping, both
    // unmuted/unfaded/unstretched (project bpm === both rifffs' bpm) -- the
    // rendered drums.wav should be the sample-wise sum of both fixtures,
    // not silence, not just one of them alone.
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      const stemAPath = join(srcDir, 'a.wav')
      const stemBPath = join(srcDir, 'b.wav')
      const sampleRate = 44100
      const numSamples = 4 * sampleRate // exactly 1 bar at 60bpm
      const volA = 0.3
      const volB = 0.2
      writeConstantWav(stemAPath, volA, numSamples, sampleRate)
      writeConstantWav(stemBPath, volB, numSamples, sampleRate)

      const rifffA: Rifff = {
        groupId: 'r1',
        name: 'a',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: stemAPath,
            durationSec: 4,
            barLength: 1
          }
        ]
      }
      const rifffB: Rifff = {
        groupId: 'r2',
        name: 'b',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'b',
            type: 'fx',
            path: stemBPath,
            durationSec: 4,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifffA, r2: rifffB },
        busOf: { 'r1:1': 'drums', 'r2:1': 'drums' }
      }

      await renderStemsToDir(state, destDir)

      const outBuf = readFileSync(join(destDir, 'drums.wav'))
      const dataStart = findDataChunkOffset(outBuf)
      const numFrames = (outBuf.length - dataStart) / 4 // stereo, 2 bytes/sample
      expect(numFrames).toBeGreaterThanOrEqual(numSamples)

      const a16 = Math.round(volA * 32767)
      const b16 = Math.round(volB * 32767)
      const segmentDurationSec = numSamples / sampleRate
      let maxDiff = 0
      for (let i = 0; i < numSamples; i++) {
        const gain = microFadeGain(i / sampleRate, segmentDurationSec)
        const expected16 = Math.max(-32768, Math.min(32767, Math.round(a16 * gain + b16 * gain)))
        const left = outBuf.readInt16LE(dataStart + i * 4)
        maxDiff = Math.max(maxDiff, Math.abs(left - expected16))
      }
      expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('throws instead of silently succeeding with zero files when nothing is placed', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      // No rifffs at all -- the emptiest possible "nothing placed" state.
      // This also covers nativeExportStemsToDisk (the dialog-based path),
      // which calls renderStemsToDir directly and has no guard of its own.
      const state: AppState = { ...initialState, rifffs: {} }

      await expect(renderStemsToDir(state, destDir)).rejects.toThrow(
        'Nothing to export -- no rifffs are placed on the timeline.'
      )
    } finally {
      rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('renderStemsToDir / renderStemTracksToDir — pluginStates threading', () => {
  // soloState() (used internally by both functions) always zeroes
  // masterChain for a solo render, but leaves channelPlugins untouched --
  // so a captured channel-insert plugin's state must still reach
  // buildEngineProject even though the bus/track being isolated changes on
  // every iteration. buildEngineProject is a real function here (only
  // wrapped, not replaced, by the vi.mock above), so this also exercises
  // the real buildPluginStatesMap/stateForSlot lookup -- it just can't
  // observe an AUDIBLE effect without a real plugin binary, which is this
  // codebase's own established boundary for what's unit- vs manually-
  // walkthrough-tested.
  it('renderStemsToDir threads a channel plugin state into buildEngineProject for the isolated bus render', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      vi.mocked(buildEngineProject).mockClear()
      const state: AppState = {
        ...initialState,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'drums', 'r1:2': 'drums' },
        channelPlugins: { r1: ['comp-plugin', null] }
      }
      const rawPluginStates: RawPluginStatesCapture = {
        masterChain: ['', '', '', ''],
        channelChains: [{ channelId: 'r1', slots: ['Q0FUUw==', ''] }]
      }

      await renderStemsToDir(state, destDir, rawPluginStates)

      expect(buildEngineProject).toHaveBeenCalled()
      for (const call of vi.mocked(buildEngineProject).mock.calls) {
        const pluginStates = call[3]
        expect(pluginStates).toEqual({
          'channel:r1:0': { pluginId: 'comp-plugin', stateBase64: 'Q0FUUw==' }
        })
      }
    } finally {
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('renderStemTracksToDir threads a channel plugin state into buildEngineProject for the isolated track render', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-dest-'))
    try {
      vi.mocked(buildEngineProject).mockClear()
      const state: AppState = {
        ...initialState,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'drums', 'r1:2': 'drums' },
        channelPlugins: { r1: ['comp-plugin', null] }
      }
      const rawPluginStates: RawPluginStatesCapture = {
        masterChain: ['', '', '', ''],
        channelChains: [{ channelId: 'r1', slots: ['Q0FUUw==', ''] }]
      }

      await renderStemTracksToDir(state, destDir, 'my proj', rawPluginStates)

      expect(buildEngineProject).toHaveBeenCalled()
      for (const call of vi.mocked(buildEngineProject).mock.calls) {
        const pluginStates = call[3]
        expect(pluginStates).toEqual({
          'channel:r1:0': { pluginId: 'comp-plugin', stateBase64: 'Q0FUUw==' }
        })
      }
    } finally {
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('omits stateBase64 (empty map) when rawPluginStates is not passed, matching pre-fix behavior', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      vi.mocked(buildEngineProject).mockClear()
      const state: AppState = {
        ...initialState,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'drums', 'r1:2': 'drums' },
        channelPlugins: { r1: ['comp-plugin', null] }
      }

      await renderStemsToDir(state, destDir)

      expect(buildEngineProject).toHaveBeenCalled()
      for (const call of vi.mocked(buildEngineProject).mock.calls) {
        expect(call[3]).toEqual({})
      }
    } finally {
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('renderStemTracksToDir', () => {
  it('packs two non-overlapping same-bus stems onto ONE shared track, still numbered', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-dest-'))
    try {
      const stemAPath = join(srcDir, 'a.wav')
      const stemBPath = join(srcDir, 'b.wav')
      writeConstantWav(stemAPath, 0.3, 4410)
      writeConstantWav(stemBPath, 0.2, 4410)
      // Rifff A occupies bar [0, 1), rifff B occupies bar [1, 2) -- back to
      // back, no overlap -- so packIntoTracks should place both on the same
      // physical track.
      const rifffA: Rifff = {
        groupId: 'r1',
        name: 'a',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'kick',
            type: 'fx',
            path: stemAPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const rifffB: Rifff = {
        groupId: 'r2',
        name: 'b',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 1,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'snare',
            type: 'fx',
            path: stemBPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifffA, r2: rifffB },
        busOf: { 'r1:1': 'drums', 'r2:1': 'drums' }
      }

      const fileNames = await renderStemTracksToDir(state, destDir, 'my proj')

      expect(fileNames).toEqual(['my proj - drums 1.wav'])
      expect(existsSync(join(destDir, 'my proj - drums 1.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('forces two time-overlapping same-bus stems onto separate numbered tracks', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-dest-'))
    try {
      const stemAPath = join(srcDir, 'a.wav')
      const stemBPath = join(srcDir, 'b.wav')
      writeConstantWav(stemAPath, 0.3, 4410)
      writeConstantWav(stemBPath, 0.2, 4410)
      // Both rifffs start at bar 0 -- full overlap -- so packIntoTracks must
      // open a second track rather than sharing one.
      const rifffA: Rifff = {
        groupId: 'r1',
        name: 'a',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'kick',
            type: 'fx',
            path: stemAPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const rifffB: Rifff = {
        groupId: 'r2',
        name: 'b',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'snare',
            type: 'fx',
            path: stemBPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifffA, r2: rifffB },
        busOf: { 'r1:1': 'drums', 'r2:1': 'drums' }
      }

      const fileNames = await renderStemTracksToDir(state, destDir, 'my proj')

      expect(fileNames).toEqual(['my proj - drums 1.wav', 'my proj - drums 2.wav'])
      expect(existsSync(join(destDir, 'my proj - drums 1.wav'))).toBe(true)
      expect(existsSync(join(destDir, 'my proj - drums 2.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('sanitizes unsafe characters out of the project name in every filename', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-dest-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'a',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'kick',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'drums' }
      }

      const fileNames = await renderStemTracksToDir(state, destDir, 'My:Project/Name')

      expect(fileNames).toEqual(['My_Project_Name - drums 1.wav'])
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('throws instead of silently succeeding with zero files when nothing is placed', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-dest-'))
    try {
      const state: AppState = { ...initialState, rifffs: {} }

      await expect(renderStemTracksToDir(state, destDir, 'my proj')).rejects.toThrow(
        'Nothing to export -- no rifffs are placed on the timeline.'
      )
    } finally {
      rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('exportStemTracksToLibrary / exportStemTracksNextToSource', () => {
  it('exportStemTracksToLibrary uses the library name as the project name', async () => {
    const { sketchStemsDir } = await import('./projectLibrary')
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-src-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'lib rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'bass' }
      }

      await exportStemTracksToLibrary(state, 'my-sketch')

      expect(existsSync(join(sketchStemsDir('my-sketch'), 'my-sketch - bass 1.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
    }
  }, 30000)

  it('exportStemTracksNextToSource derives the project name from the source filename', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-src-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'sssketch-tracks-project-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'ext rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'lead' }
      }
      const sourcePath = join(projectDir, 'my-proj.sssketchproj')

      await exportStemTracksNextToSource(state, sourcePath)

      expect(existsSync(join(projectDir, 'Stems', 'my-proj - lead 1.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it('exportStemTracksToLibrary throws and does NOT clear a pre-existing Stems/ folder when nothing is placed', async () => {
    const { sketchStemsDir } = await import('./projectLibrary')
    const stemsDir = sketchStemsDir('untidied-tracks-sketch')
    try {
      const markerPath = join(stemsDir, 'marker.wav')
      mkdirSync(stemsDir, { recursive: true })
      writeFileSync(markerPath, 'not really a wav, just a marker')

      const state: AppState = { ...initialState, rifffs: {} }

      await expect(exportStemTracksToLibrary(state, 'untidied-tracks-sketch')).rejects.toThrow(
        'Nothing to export -- no rifffs are placed on the timeline.'
      )
      expect(existsSync(markerPath)).toBe(true)
    } finally {
      rmSync(stemsDir, { recursive: true, force: true })
    }
  })
})

describe('exportStemsToLibrary / exportStemsNextToSource', () => {
  it('exportStemsToLibrary writes bus-grouped stems into sketchStemsDir(name)', async () => {
    // Reuses this test file's own electron mock (getPath -> tmpdir()) --
    // sketchStemsDir resolves under that same tmpdir() via projectLibrary.ts.
    const { sketchStemsDir } = await import('./projectLibrary')
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'lib rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'bass' }
      }

      await exportStemsToLibrary(state, 'my-sketch')

      expect(existsSync(join(sketchStemsDir('my-sketch'), 'bass.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
    }
  }, 30000)

  it('exportStemsNextToSource writes bus-grouped stems into <sourceDir>/Stems/', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-project-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'ext rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'lead' }
      }
      const sourcePath = join(projectDir, 'my-proj.sssketchproj')

      await exportStemsNextToSource(state, sourcePath)

      expect(existsSync(join(projectDir, 'Stems', 'lead.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it('exportStemsToLibrary throws and does NOT clear a pre-existing Stems/ folder when nothing is placed', async () => {
    const { sketchStemsDir } = await import('./projectLibrary')
    // Pre-populate the sketch's Stems/ folder, as if a previous export had
    // already run -- the bug this guards against is exportStemsToLibrary
    // rmSync-ing this away before discovering there's nothing to render.
    const stemsDir = sketchStemsDir('untidied-sketch')
    try {
      const markerPath = join(stemsDir, 'aux.wav')
      mkdirSync(stemsDir, { recursive: true })
      writeFileSync(markerPath, 'not really a wav, just a marker')

      const state: AppState = { ...initialState, rifffs: {} }

      await expect(exportStemsToLibrary(state, 'untidied-sketch')).rejects.toThrow(
        'Nothing to export -- no rifffs are placed on the timeline.'
      )
      expect(existsSync(markerPath)).toBe(true)
    } finally {
      rmSync(stemsDir, { recursive: true, force: true })
    }
  })

  it('exportStemsNextToSource throws and does NOT clear a pre-existing Stems/ folder when nothing is placed', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-project-'))
    try {
      const stemsDir = join(projectDir, 'Stems')
      mkdirSync(stemsDir, { recursive: true })
      const markerPath = join(stemsDir, 'aux.wav')
      writeFileSync(markerPath, 'not really a wav, just a marker')

      const state: AppState = { ...initialState, rifffs: {} }
      const sourcePath = join(projectDir, 'my-proj.sssketchproj')

      await expect(exportStemsNextToSource(state, sourcePath)).rejects.toThrow(
        'Nothing to export -- no rifffs are placed on the timeline.'
      )
      expect(existsSync(markerPath)).toBe(true)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})

describe('risers in an isolated render', () => {
  const riser = {
    id: 'ri1',
    channelId: 'r1',
    startBar: 12,
    lengthBars: 4,
    startCutoffValue: 0.3,
    endCutoffValue: 0.95,
    curve: [],
    level: 0.6
  }

  it('counts a riser towards the render length, so one past the last clip is not cut off', () => {
    // The rifff fixture ends at bar 12; this riser runs 12 -> 16, which is
    // where the mixdown used to stop dead.
    expect(loopLengthBarsFor(stateWith({ risers: { ri1: riser } }))).toBe(16)
  })

  it('leaves a riser that ends inside the arrangement alone', () => {
    expect(loopLengthBarsFor(stateWith({ risers: { ri1: { ...riser, startBar: 0 } } }))).toBe(12)
  })

  it('withoutRisers empties the risers and touches nothing else', () => {
    const state = stateWith({ risers: { ri1: riser }, bpm: 133 })
    const result = withoutRisers(state)
    expect(result.risers).toEqual({})
    expect(result.bpm).toBe(133)
    expect(result.rifffs).toBe(state.rifffs)
  })

  it('riserOnlyState mutes every stem and keeps the risers', () => {
    const state = stateWith({ risers: { ri1: riser } })
    const result = riserOnlyState(state, ['r1:1', 'r1:2'])
    expect(result.mute).toEqual({ 'r1:1': true, 'r1:2': true })
    expect(result.risers).toEqual({ ri1: riser })
    expect(result.masterChain).toEqual([null, null, null, null])
  })

  it('renders risers into one file of their own, and out of every bus file', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-riser-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-riser-dest-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const oneBarRifff: Rifff = {
        groupId: 'r1',
        name: 'my rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'kick',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      vi.mocked(buildEngineProject).mockClear()
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: oneBarRifff },
        busOf: { 'r1:1': 'drums' },
        risers: { ri1: { ...riser, startBar: 0, lengthBars: 1 } }
      }

      const fileNames = await renderStemsToDir(state, destDir)

      expect(fileNames).toEqual(['drums.wav', 'risers.wav'])
      expect(existsSync(join(destDir, 'risers.wav'))).toBe(true)
      // The bus render is riser-free; the riser render is stem-free. Without
      // both halves, every bus file would carry a copy of every riser and
      // re-summing the exported files would stack them.
      const projects = await Promise.all(
        vi.mocked(buildEngineProject).mock.results.map((r) => r.value)
      )
      expect(projects).toHaveLength(2)
      expect(projects[0].risers).toEqual([])
      expect(projects[1].risers).toHaveLength(1)
      expect(projects[1].rifffs[0].stems.every((s: { muted: boolean }) => s.muted)).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)
})
