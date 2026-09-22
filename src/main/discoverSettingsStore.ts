import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { DEFAULT_TRAIT_BAR, normalizeTraitMatchBar } from '@shared/traitBar'

export interface DiscoverSettings {
  /** Whether the user has explicitly agreed to the whole-library background
   * scan Discover needs for a real candidate pool (see design spec §8.5).
   * Defaults false -- Discover is still usable without it, just limited to
   * whatever the existing placed-stems-only BackgroundFeatureScan.tsx has
   * already analyzed from ordinary use. Never silently flipped true. */
  consentedToLibraryScan: boolean
  /** How strict a trait (chonky/rhythmic/sparkly/buttery) must be, as a
   * library-percentile bar -- the Settings menu's "trait match" entry
   * (one of TRAIT_MATCH_BAR_OPTIONS; 0.75 = top 25%). Direct request,
   * 2026-09-22. */
  traitMatchBar: number
}

const STORE_FILENAME = 'discoverSettings.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

const DEFAULT_SETTINGS: DiscoverSettings = {
  consentedToLibraryScan: false,
  traitMatchBar: DEFAULT_TRAIT_BAR
}

/** Mirrors categoryCentroidStore.ts's own loadCategoryCentroidStore -- an
 * empty/default result (never a thrown error), both when nothing has been
 * saved yet and when reading fails. */
export function loadDiscoverSettings(): DiscoverSettings {
  const path = storePath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<DiscoverSettings>
    return {
      consentedToLibraryScan: parsed.consentedToLibraryScan ?? false,
      traitMatchBar: normalizeTraitMatchBar(parsed.traitMatchBar)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadDiscoverSettings: failed to read ${path}: ${message}`)
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveDiscoverSettings(settings: DiscoverSettings): void {
  try {
    writeFileSync(storePath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveDiscoverSettings: failed to write ${storePath()}: ${message}`)
  }
}
