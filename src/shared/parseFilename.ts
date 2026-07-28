export interface ParsedStemFilename {
  slot: number
  author: string
  stemName: string
  bpm: number
  timestamp: string
}

// Field separator is a literal " - " (space, hyphen, space) — NOT `\s*-\s*`. Using
// `\s*-\s*` would let a hyphen with no surrounding whitespace (e.g. inside "Jean-Luc")
// count as a field boundary, silently mis-splitting names that contain their own
// hyphen. Every real filename (design spec + all 6 sample fixtures) separates fields
// with single-space-hyphen-single-space, so requiring that literal resolves the
// ambiguity: "Jean-Luc" has no spaces around its internal hyphen and so is never
// mistaken for a separator, while genuine " - " separators still match.
const STEM_FILENAME_RE = /^(\d+) - (.+?) - (.+) - (\d+)BPM - (.+?)\s*\.wav$/i

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
