// Tracks the most recent manually-initiated seek (click/drag-to-scrub on
// the Ruler, Timeline background, or a clip's own waveform) so the native
// engine's 30Hz position tick (StoreContext.tsx's onEnginePositionUpdate)
// can ignore a straggler tick that was already in flight from BEFORE the
// seek reached the engine -- otherwise the playhead visibly flickers back
// to the pre-seek position for one frame before the next (correct) tick
// arrives and overwrites it again. Audio itself isn't affected by this (the
// engine really did seek correctly, immediately) -- it's purely a
// renderer-side display race between "I just dispatched the new position
// locally" and "a tick computed from the OLD position is still in flight
// over IPC."
let lastManualSeekAtMs = 0

export function markManualSeek(): void {
  lastManualSeekAtMs = performance.now()
}

// Long enough to cover a real seek's IPC round-trip plus a queued tick or
// two (30Hz ticks are ~33ms apart) -- short enough that a genuine tick
// arriving shortly after a seek during normal playback isn't also dropped.
const GRACE_MS = 120

export function isWithinManualSeekGrace(): boolean {
  return performance.now() - lastManualSeekAtMs < GRACE_MS
}
