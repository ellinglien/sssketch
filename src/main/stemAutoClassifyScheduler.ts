// src/main/stemAutoClassifyScheduler.ts
import { classifyAutoCategoryBatch } from './stemAutoClassify'
import { openOwnRiffLibraryDb } from './riffLibrarySchema'
import { loadDiscoverSettings } from './discoverSettingsStore'

// Short delay between batches while there's known work waiting -- keeps
// this from ever monopolizing the main process for long, same "batch,
// then yield to real usage" spirit as DiscoverLibraryScan.tsx's own
// BATCH_DELAY_MS (renderer side). Longer delay once caught up: nothing to
// do until the OTHER scan (DiscoverLibraryScan.tsx) embeds/extracts
// features for more stems, or consent changes, so there's no reason to
// re-check every second.
const BUSY_DELAY_MS = 1000
const IDLE_DELAY_MS = 30_000

let started = false

function scheduleNext(delayMs: number): void {
  setTimeout(() => {
    void runOnce()
  }, delayMs)
}

async function runOnce(): Promise<void> {
  // Re-read consent on every tick (not just once at startup) -- the
  // settings-menu toggle (TransportBar.tsx) can flip this while the app is
  // running, same "live, not just at mount" requirement
  // DiscoverLibraryScan.tsx's own top-level-mount fix already established
  // earlier this session for the sibling renderer-side scan.
  if (!loadDiscoverSettings().consentedToLibraryScan) {
    scheduleNext(IDLE_DELAY_MS)
    return
  }
  try {
    const { remaining } = await classifyAutoCategoryBatch(openOwnRiffLibraryDb())
    scheduleNext(remaining > 0 ? BUSY_DELAY_MS : IDLE_DELAY_MS)
  } catch (err) {
    console.error('stemAutoClassifyScheduler: batch failed:', err)
    scheduleNext(IDLE_DELAY_MS)
  }
}

/** Starts the background "pre-categorize the whole library" scheduler --
 * call ONCE, at app startup. Gated on the SAME discoverConsented setting
 * DiscoverLibraryScan.tsx's own renderer-side scan already uses (this is
 * that scan's main-process counterpart: DiscoverLibraryScan.tsx extracts
 * each stem's embedding/features, this classifies them once extracted).
 * Self-reschedules INDEFINITELY, not a one-shot pass -- "something people
 * can leave running overnight," direct request 2026-09-15 -- so it keeps
 * picking up newly-scanned stems for as long as the app stays open and
 * consent remains granted. Idempotent: a second call is a silent no-op,
 * matching the "mount once" precedent other app-lifetime background
 * processes in this codebase already follow. */
export function startStemAutoClassifyScheduler(): void {
  if (started) return
  started = true
  scheduleNext(BUSY_DELAY_MS)
}
