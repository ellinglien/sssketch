import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { DEFAULT_TRAIT_BAR, normalizeTraitMatchBar } from '@shared/traitBar'
import { cleanFoldSeed, newFoldSeed } from '@shared/radioFold'
import {
  DEFAULT_RADIO_SETTINGS,
  normalizeRadioSettings,
  type RadioSettings
} from '@shared/radioSchedule'
import { DEFAULT_RADIO_VIEW, normalizeRadioView, type RadioView } from '@shared/radioView'
import { LEGACY_SOURCE_LEAN } from '@shared/discoverSlotModifier'

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
  /** Everything the radio menu sets -- pace preset, the bar window the
   * clock actually draws from, the loop-end threshold, starting channel
   * count,
   * transitions, turnarounds, turnover. One nested object rather than
   * seven flat fields; see RadioSettings' own doc comment. Persisted
   * because re-picking them every launch is an annoyance with a four-line
   * fix. docs/superpowers/specs/2026-09-28-radio-controls-design.md. */
  radio: RadioSettings
  /** The radio view's `simple` / `advanced` switch (spec 2026-10-05-radio-simple-view-design):
   * what the view shows, never what radio does, so it is not a RadioSettings field (a change to
   * `radio` re-runs the panel's radio effects). Simple unless saved advanced. */
  radioView: RadioView
}

const STORE_FILENAME = 'discoverSettings.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

const DEFAULT_SETTINGS: DiscoverSettings = {
  consentedToLibraryScan: false,
  traitMatchBar: DEFAULT_TRAIT_BAR,
  radio: DEFAULT_RADIO_SETTINGS,
  radioView: DEFAULT_RADIO_VIEW
}

/** Mirrors categoryCentroidStore.ts's own loadCategoryCentroidStore -- an
 * empty/default result (never a thrown error), both when nothing has been
 * saved yet and when reading fails. */
export function loadDiscoverSettings(): DiscoverSettings {
  const path = storePath()
  if (!existsSync(path)) return withRandomFoldSeed({ ...DEFAULT_SETTINGS }, undefined)
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<DiscoverSettings>
    return withRandomFoldSeed(
      {
        consentedToLibraryScan: parsed.consentedToLibraryScan ?? false,
        traitMatchBar: normalizeTraitMatchBar(parsed.traitMatchBar),
        // `parsed.radioPace` is the 1.3.0 shape -- flat, no `radio` object.
        // Passing it through migrates a real user's chosen pace rather than
        // silently resetting it. An explicit `radio.pace` always wins.
        radio: withLegacySourceLean(
          normalizeRadioSettings(parsed.radio, (parsed as { radioPace?: unknown }).radioPace),
          parsed.radio
        ),
        radioView: normalizeRadioView(parsed.radioView)
      },
      parsed.radio?.foldSeed
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadDiscoverSettings: failed to read ${path}: ${message}`)
    return withRandomFoldSeed({ ...DEFAULT_SETTINGS }, undefined)
  }
}

/** The source dial was in-memory until 2026-10-07, starting at 95 every launch. A file saved
 * before then (no `radio.source`) is an existing install, which keeps 95; a new install has no
 * file and starts at DEFAULT_SOURCE_LEAN. Every later save writes `source`. */
function withLegacySourceLean(radio: RadioSettings, savedRadio: unknown): RadioSettings {
  const saved = (savedRadio as { source?: unknown } | null | undefined)?.source
  if (typeof saved === 'number' && Number.isFinite(saved)) return radio
  return { ...radio, source: LEGACY_SOURCE_LEAN }
}

/** Fold mode's first seed is random, not the shared default (Elling, 2026-10-03): a saved
 * seed -- any text since v2 (cleanFoldSeed) -- is kept; none, or a blank one, draws a fresh one,
 * which the next save keeps. */
function withRandomFoldSeed(settings: DiscoverSettings, savedSeed: unknown): DiscoverSettings {
  if (cleanFoldSeed(savedSeed) !== null) return settings
  return { ...settings, radio: { ...settings.radio, foldSeed: newFoldSeed() } }
}

export function saveDiscoverSettings(settings: DiscoverSettings): void {
  try {
    writeFileSync(storePath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveDiscoverSettings: failed to write ${storePath()}: ${message}`)
  }
}
