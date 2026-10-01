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
// They are the same gesture pointed in opposite directions, and they are
// TWO CONTROLS on the row: "hold longer" (toggleRadioHook), beside the
// padlock, and "change next" (toggleRadioReplaceSoon), beside the rerolls.
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

/** What one layer has been told.
 *
 * `hook` is the centre of the track -- held, but not frozen. `replace-soon`
 * is a layer that has outstayed its welcome and should go next, or nearly
 * next. Neither is the padlock, and the difference is one line:
 *
 *   > The padlock is never. The hook is rarely.
 *
 * A slot can carry a flag AND a padlock; the padlock wins, because "never"
 * contains "rarely" and also contains "soon". That needs no code here --
 * isRadioEligibleSlot drops a locked slot before any weight is computed, so
 * a flag on a locked layer is simply inert until the lock comes off, which
 * is the same thing the spec means by the hook surviving a lock. */
export type RadioSlotFlag = 'hook' | 'replace-soon'

/** Flags by slot id, absent meaning normal.
 *
 * ONE map rather than a `hookSlotId` scalar beside a `replaceSoonIds` set,
 * because a slot holds one flag: it cannot be both, and two stores could
 * disagree about that. The at-most-one-hook invariant is enforced in
 * toggleRadioHook instead, which is the only writer of `hook`. */
export type RadioSlotFlags = Readonly<Record<string, RadioSlotFlag>>

export const NO_RADIO_SLOT_FLAGS: RadioSlotFlags = {}

/** How much longer the hook holds than everything else -- a DIVISOR on its
 * draw weight, which is why it composes with both turnover modes for free:
 * under `random` every base weight is 1, so the hook is simply drawn an
 * eighth as often, and under `even` its staleness keeps growing while it
 * waits, so it climbs back toward eligibility on its own.
 *
 * That last part is the answer to "does the hook ever turn over?" -- yes,
 * and it has to, because a layer that never turns over is what the padlock
 * is already for.
 *
 * It is also why the hold is NOT eight times in practice. Measured over
 * four layers under `even`: a normal layer changes every 4.0 turns and a
 * hooked one every 9.7, because the divisor is being climbed at every turn
 * by the hook's own growing staleness. At `mid` (about 28s realised per
 * turn) that is two minutes against four and a half -- which is the hold
 * Elling noticed and liked before anyone built a control for it. */
export const HOOK_HOLD_FACTOR = 8

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
  if (flag === 'hook') return 1 / HOOK_HOLD_FACTOR
  if (flag === 'replace-soon') return REPLACE_SOON_FACTOR
  return 1
}

export function radioSlotFlagOf(flags: RadioSlotFlags, id: string): RadioSlotFlag | null {
  return flags[id] ?? null
}

/** The hooked slot, or null. At most one can exist -- toggleRadioHook is
 * the only writer of `hook` and it guarantees it -- so this is a lookup,
 * not a choice. */
export function radioHookSlotId(flags: RadioSlotFlags): string | null {
  for (const [id, flag] of Object.entries(flags)) if (flag === 'hook') return id
  return null
}

/** The row's "hold longer" control: hook this slot, or release it.
 *
 * AT MOST ONE HOOK. Two hooks is two centres, which is no centre, so
 * hooking this slot releases any hook on another -- the way a radio button
 * does. That release is visible: every row is on screen, and the other
 * row's hand goes dark in the same render. (The old single cycle button
 * could reach this state by accident on its way somewhere else; two
 * separate controls cannot.)
 *
 * One flag per slot, so hooking a slot that was marked replace-soon
 * replaces that mark. Replace-soon on OTHER slots is untouched. */
export function toggleRadioHook(flags: RadioSlotFlags, id: string): RadioSlotFlags {
  const turningOn = flags[id] !== 'hook'
  const out: Record<string, RadioSlotFlag> = {}
  for (const [otherId, flag] of Object.entries(flags)) {
    if (otherId === id) continue
    if (turningOn && flag === 'hook') continue
    out[otherId] = flag
  }
  if (turningOn) out[id] = 'hook'
  return out
}

/** The row's 👍 (2026-10-01, from the web radio's full-mode rows): one
 * press that says "i like this stem" twice -- a star, and radio's hold.
 *
 * Elling: "👍 replaces the star ... and toggles it." So the STAR toggles,
 * and the HOLD only ever turns on:
 *   - unstarred: star it, and hook the slot if it is not hooked already
 *     (toggleRadioHook, so the one-hold rule still holds and a replace-soon
 *     on this slot becomes the hook). Never turns a hook off.
 *   - starred: un-star it; the flags are untouched.
 *
 * `canHold` is false while radio is off ("👍 only stars or un-stars") and
 * on a padlocked row, where a hook is inert and would only steal the one
 * hold from a row radio can still turn over -- the same reason the old
 * "hold longer" button was disabled there.
 *
 * Returns the SAME flags object when the hold does not change. */
export function likeRadioSlot(
  flags: RadioSlotFlags,
  id: string,
  opts: { starred: boolean; canHold: boolean }
): { flags: RadioSlotFlags; starred: boolean } {
  if (opts.starred) return { flags, starred: false }
  if (!opts.canHold || flags[id] === 'hook') return { flags, starred: true }
  return { flags: toggleRadioHook(flags, id), starred: true }
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
 * So: marking a hook releases any other hook, visibly, the way a radio
 * button does. Marking a replace-soon releases nothing, and never touches
 * another slot's flag of either kind.
 *
 * One flag per slot, so marking a hooked slot replaces its hook. */
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
