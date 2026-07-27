import { describe, expect, it } from 'vitest'
import { buildRifff, type ScannedFile } from './buildRifff'

function wavBytes(seconds: number, sampleRate = 48000): Uint8Array {
  const numFrames = Math.round(seconds * sampleRate)
  const dataBytes = numFrames * 2 // mono 16-bit
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const writeStr = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  return new Uint8Array(buf)
}

describe('buildRifff', () => {
  it('assembles a rifff from real-convention filenames', () => {
    const files: ScannedFile[] = [
      {
        filename: '1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav',
        path: '/x/1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav',
        bytes: wavBytes(12.8)
      },
      {
        filename: '6 - elling - Freezer - 150BPM - 2020-11-11-13-52.wav',
        path: '/x/6 - elling - Freezer - 150BPM - 2020-11-11-13-52.wav',
        bytes: wavBytes(3.2)
      },
      {
        filename: '8 - elling - Sunset - 150BPM - 2020-11-11-12-38.wav',
        path: '/x/8 - elling - Sunset - 150BPM - 2020-11-11-12-38.wav',
        bytes: wavBytes(1.6)
      },
      { filename: '.DS_Store', path: '/x/.DS_Store', bytes: new Uint8Array(0) }
    ]

    const rifff = buildRifff('/x', 'my jam 150 Stems', files)

    expect(rifff).not.toBeNull()
    expect(rifff?.name).toBe('my jam 150')
    expect(rifff?.bpm).toBe(150)
    expect(rifff?.folderPath).toBe('/x')
    expect(rifff?.stems).toHaveLength(3)
    expect(rifff?.stems.map((s) => s.slot)).toEqual([1, 6, 8])
    expect(rifff?.stems[0].barLength).toBe(8)
    expect(rifff?.stems[1].barLength).toBe(2)
    expect(rifff?.stems[2].barLength).toBe(1)
    expect(rifff?.barLength).toBe(8) // max of the stems
    expect(rifff?.stems.every((s) => s.type === 'fx')).toBe(true)
  })

  it('returns null when no files match the convention', () => {
    const files: ScannedFile[] = [
      { filename: 'recording 165 (Bass).wav', path: '/y/a.wav', bytes: new Uint8Array(0) }
    ]
    expect(buildRifff('/y', 'unrelated folder', files)).toBeNull()
  })

  it('does not strip "Stems" from the middle of a name', () => {
    const files: ScannedFile[] = [
      {
        filename: '1 - elling - Tail - 80BPM - 2020-01-01-00-00.wav',
        path: '/z/1.wav',
        bytes: wavBytes(1.6)
      }
    ]
    const rifff = buildRifff('/z', 'Stems of Consciousness', files)
    expect(rifff?.name).toBe('Stems of Consciousness')
  })

  it('skips a filename-valid but byte-corrupt WAV and keeps the rest', () => {
    const files: ScannedFile[] = [
      {
        filename: '1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav',
        path: '/x/1.wav',
        bytes: wavBytes(3.2)
      },
      {
        filename: '2 - elling - Corrupt - 150BPM - 2020-11-11-13-54.wav',
        path: '/x/2.wav',
        bytes: new Uint8Array(0) // parses as filename, but not a real WAV
      }
    ]

    const rifff = buildRifff('/x', 'my jam 150 Stems', files)

    expect(rifff).not.toBeNull()
    expect(rifff?.stems).toHaveLength(1)
    expect(rifff?.stems[0].slot).toBe(1)
  })

  it('keeps only the first file when two files claim the same slot', () => {
    const files: ScannedFile[] = [
      {
        filename: '3 - elling - First - 150BPM - 2020-11-11-13-53.wav',
        path: '/x/first.wav',
        bytes: wavBytes(1.6)
      },
      {
        filename: '3 - elling - Second - 150BPM - 2020-11-11-13-54.wav',
        path: '/x/second.wav',
        bytes: wavBytes(3.2)
      }
    ]

    const rifff = buildRifff('/x', 'my jam 150 Stems', files)

    expect(rifff).not.toBeNull()
    expect(rifff?.stems).toHaveLength(1)
    expect(rifff?.stems[0].path).toBe('/x/first.wav')
  })
})
