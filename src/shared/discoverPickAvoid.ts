// src/shared/discoverPickAvoid.ts
//
// Which stems a Discover roll would rather not land on a row. A PREFERENCE
// only: pickForSlot drops these from the pool when anything else is left,
// and uses the whole pool when nothing is (better a repeat than "no match").

/** The stems to avoid when rolling for row `id`.
 *
 * Always the stems on the OTHER rows (two rows of one kind used to land the
 * same stem). With `own`, the row's own stem too: a RADIO re-pick that lands
 * the stem already playing is a change nobody hears -- the web radio measured
 * it re-landing about 10% of the time (2026-10-01) and added this guard; this
 * is the shared rule. Manual rolls keep `own: false`, as before. */
export function stemsToAvoid(
  slots: readonly { id: string; stemCID: string | null }[],
  id: string,
  opts: { own: boolean }
): Set<string> {
  const out = new Set<string>()
  for (const s of slots) {
    if (s.stemCID === null) continue
    if (s.id === id && !opts.own) continue
    out.add(s.stemCID)
  }
  return out
}
