import type { AppState } from './store'

/** True when there's real, unsaved content that would be lost by replacing
 * the live project (New, Open, Restore, Quit) -- the exact "is there
 * anything real to lose" check ProjectMenu's old handleNew used to compute
 * inline, hoisted out so App.tsx's Frame, the shared discard-guard, and the
 * unsaved-changes indicator all read the same value instead of three
 * separate recomputations (see docs/superpowers/specs/2026-08-14-explicit-
 * save-model-design.md, section 3).
 *
 * Takes the already-serialized state JSON (not the full AppState) so a
 * caller that re-evaluates this on every render (the indicator) can reuse
 * an already-memoized serialize instead of paying for a fresh one every
 * time -- see App.tsx's Frame, which threads its own `persistedJson` memo
 * through here.
 *
 * An empty project (no rifffs at all) is never "unsaved" even if
 * lastSavedJson is null/stale -- nothing has been imported yet, so there's
 * nothing real to lose. */
export function hasUnsavedChanges(
  rifffs: AppState['rifffs'],
  serializedState: string,
  lastSavedJson: string | null
): boolean {
  return Object.keys(rifffs).length > 0 && serializedState !== lastSavedJson
}
