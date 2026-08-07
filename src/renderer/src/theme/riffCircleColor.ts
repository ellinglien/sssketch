/** Continuous brightness ramp from dark gray (0% ownership) to white (100%
 * ownership) — one brightness axis, no separate accent hue, matching the
 * app's existing "color spent only on things that carry information" design
 * language (see tokens.css). Shared by LoreLibraryBrowser and
 * EndlesssLibraryBrowser so both riff-circle grids read the same way. */
export function riffCircleColor(ownerFraction: number): string {
  const lo = 60 // dark gray floor, not pure black, so 0% still reads as "a riff", not "empty"
  const hi = 237 // matches --ra-text's near-white value
  const v = Math.round(lo + ownerFraction * (hi - lo))
  return `rgb(${v}, ${v}, ${v})`
}
