// src/shared/radioSlotFlags.ts
//
// The one gesture radio has that is not a setting: pointing at a layer you
// are hearing and saying something about it.
//
// Everything else radio offers -- pace, channel count, temperament, the
// padlock, mute, the kind pickers, the trait bars -- is a standing
// instruction set before or between changes. Elling asked, on two separate
// days, for both halves of the missing one:
//
//   "maybe have a way to select 'keep this one for a while' or .. 'this is
//    the hook' or something"                                   (2026-09-28)
//
//   "right now channel four is long and repeating many times, and i wish i
//    had a way to flag it as one to replace soon for replacement."
//                                                              (2026-09-29)
//
// They are the same gesture pointed in opposite directions, and they were
// TWO CONTROLS on the row: "hold longer" (the `hook` flag), beside the
// padlock, and "change next" (toggleRadioReplaceSoon), beside the rerolls.
//
// (2026-10-03) THE HOOK IS NO LONGER A FLAG. It is a STEM on its row that
// leaves and comes back (radioHooks.ts, docs/superpowers/specs/2026-10-03-
// radio-anointed-stems-design.md section 2): a flag is about the present
// stem and dies with it, while a hook outlives its stem's absences. What is
// left here is replace-soon. The history below is kept as the record of why
// replace-soon is shaped as it is.
// They began as one three-state cycle button -- normal -> replace soon ->
// hook -- on the argument that two buttons pushing one draw in opposite
// directions could be made to argue with each other. Split on 2026-09-29
// (docs/superpowers/specs/2026-09-29-discover-row-icons-and-source-dial-
// design.md): three glyphs on one square did not say what they meant, the
// cycle made the order matter, and "keep this" and "replace this" belong
// beside the controls they resemble. They still cannot argue, because a
// slot holds at most one flag: pressing one control replaces the other's
// mark on that row.
//
// See docs/superpowers/specs/2026-09-28-radio-controls-design.md 6.3-6.4 for
// the weighting the hook plugs into. The replace-soon half is not in that
// spec; the three decisions it needed are argued in the comments below,
// where the code that answers them is.
//
// NOT PERSISTED, either half. Slot ids are minted fresh each session
// (freshSlotId), so a stored flag would name a slot that does not exist.
// The padlock is the thing that survives a restart, and it survives it by
// living on the slot.

/** What one layer has been told: `replace-soon`, a layer that has outstayed
 * its welcome and should go next, or nearly next. (The hook was the other
 * flag until 2026-10-03; it is radioHooks.ts now.) It is not the padlock:
 *
 *   > The padlock is never. Replace-soon is soon.
 *
 * A slot can carry the flag AND a padlock; the padlock wins. That needs no
 * code here -- isRadioEligibleSlot drops a locked slot before any weight is
 * computed, so a flag on a locked layer is simply inert until the lock comes
 * off. */
export type RadioSlotFlag = 'replace-soon'

/** Flags by slot id, absent meaning normal. (A map rather than a set: it
 * held two kinds of flag, one per slot, until the hook moved to
 * radioHooks.ts.) */
export type RadioSlotFlags = Readonly<Record<string, RadioSlotFlag>>

export const NO_RADIO_SLOT_FLAGS: RadioSlotFlags = {}

/** (2026-10-03) The hook is no longer a flag: it is a STEM that leaves and comes back
 * (radioHooks.ts, spec 2026-10-03-radio-anointed-stems-design). Its old divisor (HOOK_HOLD_FACTOR,
 * 8: "a normal layer changes every 4.0 turns and a hooked one every 9.7") is gone with it; a hook
 * in is simply left out of radio's turnover (radioHookTurnoverExcluded). The comments below that
 * argue against the hook's numbers are kept as the record of why replace-soon's are what they
 * are. */

/** How much sooner a layer flagged `replace-soon` comes round -- a
 * MULTIPLIER, and deliberately not 8.
 *
 * DECISION 1 OF 3: is the factor symmetrical? No, and the asymmetry is in
 * the dynamics rather than in taste.
 *
 * The hook's divisor FIGHTS a quantity that grows without bound: base
 * weight is `staleness + 1`, so a held layer's own drought climbs against
 * the divisor every turn and eventually overcomes it. A multiplier is on
 * the same side as that growth, so it COMPOUNDS with it -- and the layer he
 * reaches for this control on is by definition already stale ("channel four
 * is long and repeating many times" is a description of high staleness).
 * Equal numbers would not be equal claims.
 *
 * The numbers that settled it, all measured against this weighting in
 * radioSchedule.test.ts, four layers, `even`, and quoted as "how often is
 * the flagged layer the very next change":
 *
 *             just arrived   six turns stale   unflagged neighbour's wait
 *   unflagged      17%             47%                 4.0 turns
 *   x2             29%             64%                 5.2 turns
 *   x4             47%             77%                 7.0 turns
 *   x8             64%             87%                 9.6 turns
 *
 * Two things fall out of that table. `even` ALREADY hurries a stale layer
 * to 47%, so on the case he described the flag has little room left and x8
 * buys only ten points over x4 -- while, in the last column, making every
 * unflagged layer wait nearly three times a normal turn, which starts to
 * read as "everything else froze". And x2 is too weak on the case the table
 * shows the flag is actually FOR: a layer he dislikes the moment it
 * arrives, where 29% is barely better than leaving it alone.
 *
 * x4 leaves the flagged layer the overwhelming favourite without the draw
 * ceasing to be a draw, and leaves three simultaneously-flagged layers a
 * draw rather than a queue (measured: 3.5 turns each against the unflagged
 * one's 7.0). It is a strong request, not a command. The command is the
 * `random` button four columns to the right, which changes the layer now.
 *
 * The other half of why the numbers need not match: the hook is evaluated
 * every turn for as long as radio runs, so its factor describes a STEADY
 * STATE, while replace-soon is honoured once and then forgotten (see
 * forgetRadioSlotFlagOnChange), so its factor describes a ONE-SHOT. A
 * one-shot that takes five intervals to fire has failed at being a gesture;
 * a steady state that never lets go has failed at not being the padlock.
 * Different failure modes, different numbers. */
export const REPLACE_SOON_FACTOR = 4

/** What a flag does to a slot's draw weight. One multiply, so both
 * controls together are a single term in pickRadioSlotId's formula rather
 * than a branch in it. */
export function radioSlotFlagWeightFactor(flag: RadioSlotFlag | null): number {
  if (flag === 'replace-soon') return REPLACE_SOON_FACTOR
  return 1
}

export function radioSlotFlagOf(flags: RadioSlotFlags, id: string): RadioSlotFlag | null {
  return flags[id] ?? null
}

/** The row's 👍 (2026-10-01, from the web radio's full-mode rows): one
 * press that says "i like this stem" twice -- a star, and radio's hold.
 *
 * The STAR toggles here. The HOLD is radioHooks' likeRadioStem (2026-10-03: the hook is a stem,
 * not a flag), called beside this; it only ever turns on. What is left of the flags' side: a 👍
 * that holds (`canHold`: radio on, the row not padlocked) takes the row's change soon away, since
 * the row is now held. Un-starring leaves the flags alone.
 *
 * Returns the SAME flags object when they do not change. */
export function likeRadioSlot(
  flags: RadioSlotFlags,
  id: string,
  opts: { starred: boolean; canHold: boolean }
): { flags: RadioSlotFlags; starred: boolean } {
  if (opts.starred) return { flags, starred: false }
  if (!opts.canHold || flags[id] !== 'replace-soon') return { flags, starred: true }
  return { flags: toggleRadioReplaceSoon(flags, id), starred: true }
}

/** The row's "change next" control: mark this slot to be replaced soon,
 * or unmark it.
 *
 * DECISION 2 OF 3: does "at most one" apply to replace-soon? No.
 *
 * It is load-bearing for the hook and the spec says why -- two hooks is two
 * centres, which is no centre -- but that is an argument about the TRACK
 * having one centre, a claim about structure. "Replace soon" makes no claim
 * about structure; it is a complaint about what is currently playing, and
 * being tired of three layers at once is an ordinary thing to be. Worse, if
 * it were at-most-one, flagging a second layer would silently unflag the
 * first, and the row would then be telling the truth about one channel and
 * a lie about another -- the exact failure the clear-on-change rule below
 * exists to avoid.
 *
 * So: marking a replace-soon releases nothing, and never touches another
 * slot's flag. (A hook -- radioHooks.ts -- is let go by the runtime when 👎
 * marks its row.) */
export function toggleRadioReplaceSoon(flags: RadioSlotFlags, id: string): RadioSlotFlags {
  const out: Record<string, RadioSlotFlag> = {}
  for (const [otherId, flag] of Object.entries(flags)) if (otherId !== id) out[otherId] = flag
  if (flags[id] !== 'replace-soon') out[id] = 'replace-soon'
  return out
}

/** Called on every change that replaces a layer's stem, whoever asked for
 * it -- radio's own turnover, or the row's similar/adjacent/random buttons,
 * or the phone.
 *
 * DECISION 3 OF 3: does the flag clear itself? Replace-soon does. The hook
 * does not.
 *
 * The two flags are in different tenses, and that is the whole difference.
 * "Keep this one for a while" is about the future, so it survives the
 * future arriving: the hook names the channel that is the centre of the
 * track, and a hook that evaporated the first time its layer turned over
 * would have to be re-pressed every few minutes to mean anything. "Replace
 * this one" is about the present stem, so it dies when that stem does.
 *
 * Leaving it set would be wrong twice over. The stem he was tired of is
 * gone, so the mark would be describing audio nobody can hear -- the UI
 * lying about a stem that just arrived. And because the mark MULTIPLIES,
 * the innocent new arrival would be first in line to be replaced as well,
 * turning one press into a channel that strobes.
 *
 * Cleared at the COMMIT, not when radio picks: a pick can be withdrawn at
 * the boundary (the slot was locked, muted or removed in the lap it took),
 * and a flag cleared by a change that never happened is the same lie in the
 * other direction. */
export function forgetRadioSlotFlagOnChange(flags: RadioSlotFlags, id: string): RadioSlotFlags {
  if (flags[id] !== 'replace-soon') return flags
  const out: Record<string, RadioSlotFlag> = {}
  for (const [otherId, flag] of Object.entries(flags)) if (otherId !== id) out[otherId] = flag
  return out
}

/** Drop flags for slots that no longer exist.
 *
 * Pruned against the LIVE ids on every commit, the same way
 * radioEligibleSlotIds re-reads slotsRef rather than trusting a snapshot: a
 * removed slot's entry is dropped rather than stranded, and a re-added slot
 * gets a fresh id anyway (freshSlotId), so a mark can never be resurrected
 * onto a layer nobody marked. It also means removing the hooked channel
 * frees the hook for whatever he chooses next, with no separate teardown.
 *
 * Returns the SAME object when nothing was stale, so it can be called on
 * every commit without churning a React state identity and re-rendering
 * every row. */
export function pruneRadioSlotFlags(
  flags: RadioSlotFlags,
  liveIds: ReadonlySet<string>
): RadioSlotFlags {
  const ids = Object.keys(flags)
  if (ids.every((id) => liveIds.has(id))) return flags
  const out: Record<string, RadioSlotFlag> = {}
  for (const id of ids) if (liveIds.has(id)) out[id] = flags[id]
  return out
}
