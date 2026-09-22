// Direct request, 2026-09-22: "change default tempo to whatever the last
// project tempo was" -- the new-project dialog's tempo field seeds from the
// tempo of the most recently open project (remembered across launches),
// not initialState's fixed default. Per-machine convenience only, so plain
// localStorage (wrapped -- it can throw or be empty).

const STORAGE_KEY = 'sssketch:lastProjectTempo'
// Same clamp the reducer's SET_TEMPO and NewProjectModal enforce.
const MIN_BPM = 40
const MAX_BPM = 200

export function parseStoredTempo(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < MIN_BPM || value > MAX_BPM) return fallback
  return value
}

export function loadLastProjectTempo(fallback: number): number {
  try {
    return parseStoredTempo(localStorage.getItem(STORAGE_KEY), fallback)
  } catch {
    return fallback
  }
}

export function saveLastProjectTempo(bpm: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(bpm))
  } catch {
    // Unavailable storage just means the next new project uses the default.
  }
}
