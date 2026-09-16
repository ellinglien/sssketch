/** Who currently owns what gets sent to the native engine -- 'discover-
 * preview' is DiscoverPanel.tsx's own throwaway single-rifff preview
 * project (docs/superpowers/specs/2026-09-15-discover-native-engine-
 * preview-design.md); 'stem-solo-preview' is useStemPreviewPlayback.ts's
 * own SOLO_STEMS-based preview, shared by both Tidy Up
 * (ClusterStemsBrowser.tsx) and Auto Arrange (AutoArrangeRoleStep.tsx) --
 * those two never run at once (both are full-screen modals, opening one
 * closes the other), so one owner id safely covers both callers. */
export type EngineOwner = 'discover-preview' | 'stem-solo-preview'

export interface EngineOwnershipTracker {
  /** Claims ownership, returning a generation token. The caller must hold
   * onto this token and check it via `stillOwn` after any await, before
   * actually applying a send (calling engineLoadProject) -- if a newer
   * claim (by anyone, including a fresh claim by the SAME owner) has
   * landed since, the token is stale and the result must be discarded. */
  claim(owner: EngineOwner): number
  /** True iff `token` is still the current generation -- nothing has
   * claimed or released since it was issued. */
  stillOwn(token: number): boolean
  /** Releases ownership back to nobody (the real project's own automatic
   * sync is free to run again). Also bumps the generation, so any of the
   * outgoing owner's own still-in-flight sends are invalidated too.
   * Returns the new generation as a token -- pass it to `stillOwn` to
   * check whether anyone has claimed ownership again SINCE this release
   * (e.g. DiscoverPanel.tsx's restorePreviewIfLoaded uses this to abort
   * its own real-project restore send if something else claims ownership
   * before that send actually reaches the engine). */
  release(): number
  /** The current owner, or null when nobody has claimed -- read by
   * StoreContext.tsx's own automatic sync effect to decide whether to
   * skip a send. */
  readonly current: EngineOwner | null
}

/** Real generation-guard logic, factored out as pure/testable rather than
 * inlined into StoreContext.tsx directly -- see docs/superpowers/specs/
 * 2026-09-16-engine-preview-ownership-design.md. Every claim/release bumps
 * a shared counter; stillOwn is a plain equality check against it. This is
 * the SAME pattern this codebase already uses three separate times, per-
 * component (DiscoverPanel.tsx's previewSyncGenerationRef,
 * useStemPreviewPlayback.ts's callGenerationRef, StoreContext.tsx's own
 * pendingEngineSyncRef/dirtyEngineSyncRef pair) -- this is that same idea,
 * shared across all three instead of three separate, mutually-unaware
 * copies. */
export function createEngineOwnershipTracker(): EngineOwnershipTracker {
  let owner: EngineOwner | null = null
  let generation = 0

  return {
    claim(next: EngineOwner): number {
      owner = next
      generation += 1
      return generation
    },
    stillOwn(token: number): boolean {
      return generation === token
    },
    release(): number {
      owner = null
      generation += 1
      return generation
    },
    get current(): EngineOwner | null {
      return owner
    }
  }
}
