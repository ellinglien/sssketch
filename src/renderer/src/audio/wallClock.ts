// src/renderer/src/audio/wallClock.ts -- the wall clock, for callers inside components: the React
// Compiler's purity rule rejects Date.now() inside a component-defined function (DiscoverPanel's
// pickForSlot), and an imported call is how this codebase reads time there.
export function wallClockMs(): number {
  return Date.now()
}
