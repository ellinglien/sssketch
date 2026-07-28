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
//
// The slot number is sometimes followed by a quality tag before the first separator
// (observed in real exports: "1 HQ - elling - ..."), which the original fixtures
// didn't have — `(?: \S+)?` optionally consumes and discards exactly one such token.
// Regex backtracking makes this safe for the no-tag case too: `\S+` greedily grabs
// the literal "-" of the real " - " separator first, fails to find the required
// follow-up separator, and backs off to matching the group zero times instead.
//
// BPM itself isn't always a whole number either (observed: "62.7024BPM" — Endlesss
// doesn't round a jam's tempo to an integer), so the digits group allows an optional
// decimal tail.
const STEM_FILENAME_RE = /^(\d+)(?: \S+)? - (.+?) - (.+) - (\d+(?:\.\d+)?)BPM - (.+?)\s*\.wav$/i

export function parseStemFilename(filename: string): ParsedStemFilename | null {
  const match = STEM_FILENAME_RE.exec(filename)
  if (!match) return null
  return {
    slot: parseInt(match[1], 10),
    author: match[2].trim(),
    stemName: match[3].trim(),
    bpm: parseFloat(match[4]),
    timestamp: match[5].trim()
  }
}
