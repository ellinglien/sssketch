const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI note number (69 = A4/440Hz) for a frequency, not rounded. */
export function midiNoteForFrequency(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / 440)
}

/** Nearest note name in scientific pitch notation (C4 = middle C) for a frequency. */
export function noteNameForFrequency(freqHz: number): string {
  const midi = Math.round(midiNoteForFrequency(freqHz))
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

function frequencyForOctaveC(octave: number): number {
  const midi = (octave + 1) * 12 // C-1 = MIDI 0
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * Every octave-C landmark frequency within [minHz, maxHz], ascending — for
 * drawing a readable pitch reference on a log-frequency display (e.g. a
 * spectrogram's frequency axis) without doing any audio analysis at all.
 */
export function octaveGridlines(minHz: number, maxHz: number): { freqHz: number; label: string }[] {
  const lines: { freqHz: number; label: string }[] = []
  for (let octave = -1; octave <= 10; octave++) {
    const freqHz = frequencyForOctaveC(octave)
    if (freqHz < minHz || freqHz > maxHz) continue
    lines.push({ freqHz, label: `C${octave}` })
  }
  return lines
}
