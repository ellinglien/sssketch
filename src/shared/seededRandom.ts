// src/shared/seededRandom.ts -- small, stable, dependency-free hashing and a seeded random, for
// rules that must draw the same "random" on every machine and every run (the timeline's dub
// throws, timelineThrows.ts; the project seed, serialize.ts).

/** A 32-bit hash of a string (FNV-1a, then murmur3's finaliser so nearby strings spread). */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A short, stable hash of any text (8 hex digits): seeds derived from text. */
export function hashText(text: string): string {
  return hash32(text).toString(16).padStart(8, '0')
}

/** A seeded random in [0, 1) (mulberry32 over hash32 of `seed`): the same seed, the same
 * sequence, on every machine. */
export function seededRandom(seed: string): () => number {
  let a = hash32(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
