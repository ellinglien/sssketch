// src/shared/latestSettings.ts -- settings patches merge onto the LATEST settings, never onto a
// render's snapshot. A control can commit late (a bar's click waits out the double-click window,
// a wheel burst its settle delay) through a callback from an older render; merging onto that
// render's copy would roll back whatever was saved in between (the radio view switch, another
// radio setting). The caller keeps one always-current holder (a React ref) and every save goes
// through it.

/** One holder of the latest settings: a React ref fits. */
export interface LatestHolder<T> {
  current: T
}

/** Merges `patch` onto the latest settings, records the result as the latest and returns it. */
export function mergeLatestSettings<T extends object>(
  holder: LatestHolder<T>,
  patch: Partial<T>
): T {
  const next = { ...holder.current, ...patch }
  holder.current = next
  return next
}

/** The top-level patch for one nested object's patch (e.g. `radio`), built from the latest
 * nested object, not a render's. */
export function nestedPatchFromLatest<T extends object, K extends keyof T>(
  holder: LatestHolder<T>,
  key: K,
  patch: Partial<T[K]>
): Partial<T> {
  return { [key]: { ...holder.current[key], ...patch } } as unknown as Partial<T>
}
