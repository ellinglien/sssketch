// The pace slider's rows per change on the desktop (docs/superpowers/specs/2026-10-03-radio-pace-
// slider-design.md): the rows that ride radio's own change, "companions". DiscoverPanel arms them
// with its pick, holds the ready, eligible ones with its change and stages them inside it
// (@shared/radioManualChanges mergeStageChanges), so they land or are taken back with it. These
// are the panel's pure decisions about them.

/** How many companions may ride one change at this cadence: rows less radio's own, rounded up
 * (a fractional row was a chance at arm time, radioPaceRowsThisChange, and an armed one may
 * ride). None while fold is on: fold mode turns one row at a time. */
export function radioCompanionCap(cadence: { rows: number; fold: boolean }): number {
  if (cadence.fold) return 0
  return Math.max(0, Math.ceil(cadence.rows) - 1)
}

/** The companions that may ride radio's change NOW, in order, at most `max`: READY (stem
 * warmed), a row other than radio's own, once, still eligible (radioEligibleSlotIds: there,
 * unlocked, audible, not rerolling) and without a manual change waiting on it (that change wins
 * its row). One still warming is dropped, never waited for (spec section 3): the change grid and
 * the decision both read exactly this set, so the grid never holds a change for a cold row and a
 * decision holds exactly what the grid saw. */
export function radioCompanionsRiding<S, T extends { slotId: string; stem: S | null }>(
  companions: readonly T[],
  opts: {
    primarySlotId: string
    eligible: readonly string[]
    manual: { has(slotId: string): boolean }
    max: number
  }
): (T & { stem: S })[] {
  const out: (T & { stem: S })[] = []
  const seen = new Set([opts.primarySlotId])
  for (const k of companions) {
    if (out.length >= opts.max) break
    if (k.stem === null || seen.has(k.slotId)) continue
    if (!opts.eligible.includes(k.slotId) || opts.manual.has(k.slotId)) continue
    seen.add(k.slotId)
    out.push(k as T & { stem: S })
  }
  return out
}

/** The held change's companions whose rows are still eligible. A padlock or a mute set after
 * the decision stops a companion -- a padlock means never -- as it stops radio's own row; a
 * removed row is gone too. The SAME array when nothing dropped, so the caller can tell that
 * nothing needs re-staging. */
export function radioHeldCompanionsKept<T extends { slotId: string }>(
  companions: readonly T[],
  eligible: readonly string[]
): readonly T[] {
  const kept = companions.filter((k) => eligible.includes(k.slotId))
  return kept.length === companions.length ? companions : kept
}

/** The companion picks worth keeping once they return: one with a candidate, on a row no manual
 * change has claimed meanwhile, and a stem neither radio's own pick nor an earlier companion drew
 * (two drum rows can draw one stem). */
export function radioUsableCompanionPicks<
  P extends { candidate: { stemCID: string } | null },
  T extends { slotId: string; pick: P | null }
>(
  primaryStemCID: string,
  picks: readonly T[],
  manual: { has(slotId: string): boolean }
): (T & { pick: P })[] {
  const stems = new Set([primaryStemCID])
  const out: (T & { pick: P })[] = []
  for (const k of picks) {
    const stem = k.pick?.candidate?.stemCID
    if (stem === undefined || manual.has(k.slotId) || stems.has(stem)) continue
    stems.add(stem)
    out.push(k as T & { pick: P })
  }
  return out
}

/** What the change grid (radioPaceGridBars) reads for a change of several rows: radio's own and
 * its READY companions (radioCompanionsRiding -- a cold one is not in the change, so it holds
 * nothing back). The longest outgoing and incoming lengths (null when any is unknown, i.e.
 * radio's own stem still warming, which holds the change to the loop top as it always has), and
 * the loop as it will be once
 * every one of them has turned over (the longest of the rows not changing and every incoming
 * stem; null when any incoming length is unknown). A change that would shorten the loop waits
 * for the top, all its rows together. */
export function radioChangeLengths(
  changes: readonly { slotId: string; incomingBars: number | null }[],
  resolved: ReadonlyMap<string, number>
): { outgoingBars: number | null; incomingBars: number | null; loopBarsAfter: number | null } {
  let outgoing: number | null = changes.length > 0 ? 0 : null
  let incoming: number | null = changes.length > 0 ? 0 : null
  for (const c of changes) {
    const out = resolved.get(c.slotId)
    outgoing = outgoing === null || out === undefined ? null : Math.max(outgoing, out)
    incoming =
      incoming === null || c.incomingBars === null ? null : Math.max(incoming, c.incomingBars)
  }
  if (incoming === null) return { outgoingBars: outgoing, incomingBars: null, loopBarsAfter: null }
  const changing = new Set(changes.map((c) => c.slotId))
  let after = incoming
  for (const [id, bars] of resolved) if (!changing.has(id) && bars > after) after = bars
  return { outgoingBars: outgoing, incomingBars: incoming, loopBarsAfter: after }
}
