import { describe, expect, it } from 'vitest'
import { sampleRateFromHeader } from './audioHeaderSampleRate'

function wavHeader(sampleRate: number, declaredDataBytes = 0): Uint8Array {
  const buf = new Uint8Array(44)
  const view = new DataView(buf.buffer)
  const ascii = (at: number, s: string): void =>
    s.split('').forEach((c, i) => (buf[at + i] = c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + declaredDataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, declaredDataBytes, true)
  return buf
}

function oggVorbisHeader(sampleRate: number): Uint8Array {
  const buf = new Uint8Array(58)
  buf.set([0x4f, 0x67, 0x67, 0x53], 0) // OggS
  buf[26] = 1 // one segment
  buf[27] = 30 // of 30 bytes: the identification packet
  const packet = 28
  buf.set([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], packet) // \x01vorbis
  buf[packet + 11] = 2 // channels
  new DataView(buf.buffer).setUint32(packet + 12, sampleRate, true)
  return buf
}

function flacHeader(sampleRate: number): Uint8Array {
  const buf = new Uint8Array(42)
  buf.set([0x66, 0x4c, 0x61, 0x43], 0) // fLaC
  buf[4] = 0x80 // last metadata block, type 0 (STREAMINFO)
  buf[7] = 34
  buf[18] = (sampleRate >> 12) & 0xff
  buf[19] = (sampleRate >> 4) & 0xff
  buf[20] = (sampleRate & 0x0f) << 4
  return buf
}

describe('sampleRateFromHeader', () => {
  it('reads a WAV fmt chunk, even when the data chunk runs past the bytes read', () => {
    expect(sampleRateFromHeader(wavHeader(44100))).toBe(44100)
    expect(sampleRateFromHeader(wavHeader(48000, 10_000_000))).toBe(48000)
  })

  it('reads an Ogg Vorbis identification header (a LORE stem, no extension)', () => {
    expect(sampleRateFromHeader(oggVorbisHeader(44100))).toBe(44100)
    expect(sampleRateFromHeader(oggVorbisHeader(48000))).toBe(48000)
  })

  it('reads FLAC STREAMINFO', () => {
    expect(sampleRateFromHeader(flacHeader(96000))).toBe(96000)
    expect(sampleRateFromHeader(flacHeader(44100))).toBe(44100)
  })

  it('returns null for anything it does not recognise, or a header cut short', () => {
    expect(sampleRateFromHeader(new Uint8Array(0))).toBeNull()
    expect(sampleRateFromHeader(new TextEncoder().encode('ID3 not an mp3 parser'))).toBeNull()
    expect(sampleRateFromHeader(oggVorbisHeader(44100).subarray(0, 30))).toBeNull()
    expect(sampleRateFromHeader(wavHeader(0))).toBeNull()
  })
})
