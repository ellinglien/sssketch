import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject, EngineStem } from '../shared/buildEngineProject'
import { phoneStemAudioId } from '../shared/phoneLoop'

// The same narrow electron stand-in remoteLoopRenderer.test.ts uses, and for
// the same reason: app.getPath('temp') is the only thing the subject needs
// from electron. afconvert is REAL here -- what is under test is bytes an
// iphone has to be able to decode, and a fake would test nothing.
vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }))

import { createRemoteStemRenderer, PHONE_STEM_CHANNELS } from './remoteStemRenderer'

const dir = mkdtempSync(join(tmpdir(), 'stem-renderer-'))

/** A real stereo 16-bit 44.1k wav of a constant value, so afconvert has
 * something genuine to resample and re-encode. */
function writeStereoWav(path: string, seconds: number): string {
  const rate = 44100
  const frames = Math.round(seconds * rate)
  const dataSize = frames * 4
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let n = 0; n < frames; n++) {
    const v = Math.round(8000 * Math.sin((n / rate) * 2 * Math.PI * 220))
    buf.writeInt16LE(v, 44 + n * 4)
    buf.writeInt16LE(v, 46 + n * 4)
  }
  writeFileSync(path, buf)
  return path
}

function stemAt(path: string, durationSec: number, over: Partial<EngineStem> = {}): EngineStem {
  return {
    stemKey: `g::${Math.random()}`,
    resolvedPath: path,
    durationSec,
    barLength: 2,
    playedBars: 2,
    leftCropBars: 0,
    offsetSteps: 0,
    startBarOverride: -1,
    volume: 1,
    muted: false,
    muteRegions: [],
    oneShot: false,
    trimStartSec: 0,
    trimEndSec: -1,
    ...over
  }
}

function projectOf(stems: EngineStem[]): EngineProject {
  const slot = { pluginId: '', path: '', stateBase64: '' }
  return {
    bpm: 120,
    snapDiv: 4,
    loopLengthBars: 2,
    rifffs: [{ groupId: 'g', channelId: 'g', startBar: 0, barLength: 2, stems }],
    risers: [],
    masterChain: [{ ...slot }, { ...slot }, { ...slot }, { ...slot }],
    channelChains: [],
    reverb: { roomSize: 0.5, damping: 0.5, preDelayMs: 20 }
  }
}

describe('remoteStemRenderer addressing', () => {
  it('names each slot the stem id its own engine stem hashes to', () => {
    const r = createRemoteStemRenderer()
    const a = stemAt('/a.wav', 4)
    const b = stemAt('/b.wav', 4)
    r.setLoop(projectOf([a, b]), ['slot-1', 'slot-2'])
    expect(r.stemIdsBySlotId().get('slot-1')).toBe(phoneStemAudioId(a))
    expect(r.stemIdsBySlotId().get('slot-2')).toBe(phoneStemAudioId(b))
    r.stop()
  })

  it('FAILS CLOSED when the slot ids do not line up with the stems', () => {
    // A mis-paired row -- hearing one stem while looking at another -- is the
    // worst bug this feature can have, so a disagreement drops the whole map
    // rather than guessing at an alignment.
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stemAt('/a.wav', 4), stemAt('/b.wav', 4)]), ['slot-1'])
    expect(r.stemIdsBySlotId().size).toBe(0)
    r.stop()
  })

  it('forgets everything when the loop is cleared', () => {
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stemAt('/a.wav', 4)]), ['slot-1'])
    r.setLoop(null, [])
    expect(r.stemIdsBySlotId().size).toBe(0)
    r.stop()
  })
})

describe('remoteStemRenderer bytes', () => {
  it('answers null for an id it is not holding', async () => {
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stemAt('/a.wav', 4)]), ['slot-1'])
    await expect(r.bytes('0000000000000000')).resolves.toBeNull()
    r.stop()
  })

  it('renders a real stem to stereo 48k alac of exactly the declared length', async () => {
    const path = writeStereoWav(join(dir, 'src.wav'), 2)
    const stem = stemAt(path, 2)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    const bytes = await r.bytes(phoneStemAudioId(stem))
    expect(bytes).not.toBeNull()
    const out = join(dir, 'probe.m4a')
    writeFileSync(out, bytes as Buffer)
    const info = execFileSync('/usr/bin/afinfo', [out]).toString()
    // The three facts the phone depends on, read back off the real file.
    expect(info).toContain(`${PHONE_STEM_CHANNELS} ch,  48000 Hz`)
    expect(info).toContain('alac')
    // 2.000s at 48000 -- exactly, because sewLoopPCM16 trimmed it there and
    // alac has no encoder priming to add.
    expect(info).toMatch(/audio 96000 valid frames \+ 0 priming/)
    r.stop()
  }, 30_000)

  it('renders each id once and hands the same buffer back', async () => {
    const path = writeStereoWav(join(dir, 'src2.wav'), 1)
    const stem = stemAt(path, 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    const first = await r.bytes(phoneStemAudioId(stem))
    const second = await r.bytes(phoneStemAudioId(stem))
    expect(second).toBe(first)
    r.stop()
  }, 30_000)

  it('leaves no temp file behind', async () => {
    const path = writeStereoWav(join(dir, 'src3.wav'), 1)
    const stem = stemAt(path, 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    await r.bytes(phoneStemAudioId(stem))
    expect(readdirSync(join(tmpdir(), 'sssketch-phone-stems'))).toEqual([])
    r.stop()
  }, 30_000)

  it('keeps a stem that survived a roll, and drops one that did not', async () => {
    const keep = stemAt(writeStereoWav(join(dir, 'keep.wav'), 1), 1)
    const gone = stemAt(writeStereoWav(join(dir, 'gone.wav'), 1), 1)
    const fresh = stemAt(writeStereoWav(join(dir, 'fresh.wav'), 1), 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([keep, gone]), ['slot-1', 'slot-2'])
    await r.bytes(phoneStemAudioId(keep))
    await r.bytes(phoneStemAudioId(gone))
    r.setLoop(projectOf([keep, fresh]), ['slot-1', 'slot-2'])
    expect(r.cachedIds()).toEqual([phoneStemAudioId(keep)])
    r.stop()
  }, 60_000)

  it('rejects rather than hanging when the source cannot be read', async () => {
    const stem = stemAt(join(dir, 'does-not-exist'), 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    await expect(r.bytes(phoneStemAudioId(stem))).rejects.toThrow()
    r.stop()
  }, 30_000)

  it('bakes the gain into the bytes rather than sending a number', async () => {
    // The gain is part of the stem id (stemAudioFields includes volume), so
    // two gains are two different files and the phone's own GainNode is left
    // free for mute and solo.
    const path = writeStereoWav(join(dir, 'gain.wav'), 1)
    const loud = stemAt(path, 1, { volume: 1 })
    const quiet = stemAt(path, 1, { volume: 0.25 })
    expect(phoneStemAudioId(loud)).not.toBe(phoneStemAudioId(quiet))
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([loud, quiet]), ['slot-1', 'slot-2'])
    const a = await r.bytes(phoneStemAudioId(loud))
    const b = await r.bytes(phoneStemAudioId(quiet))
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect((b as Buffer).equals(a as Buffer)).toBe(false)
    r.stop()
  }, 60_000)
})
