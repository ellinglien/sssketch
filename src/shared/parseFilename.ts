export interface ParsedStemFilename {
  slot: number
  author: string
  stemName: string
  bpm: number
  timestamp: string
}

const STEM_FILENAME_RE = /^(\d+)\s*-\s*(.+?)\s*-\s*(.+)\s*-\s*(\d+)BPM\s*-\s*(.+?)\.wav$/i

export function parseStemFilename(filename: string): ParsedStemFilename | null {
  const match = STEM_FILENAME_RE.exec(filename)
  if (!match) return null
  return {
    slot: parseInt(match[1], 10),
    author: match[2].trim(),
    stemName: match[3].trim(),
    bpm: parseInt(match[4], 10),
    timestamp: match[5].trim()
  }
}
