// One Discover row (moved verbatim from DiscoverPanel.tsx, radio view plan Task 4): its buttons, waveform, readout and popovers. State that outlives a row stays in DiscoverPanel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Compass,
  Copy,
  Repeat,
  Shovel,
  Shuffle,
  SkipForward,
  ThumbsDown,
  ThumbsUp
} from '@phosphor-icons/react'
import { RepeatedWaveform } from './RepeatedWaveform'
import { LoopLines } from './LoopLines'
import { LoadingLoader } from './LoadingLoader'
import { DiscoverNearbyPopover } from './DiscoverNearbyPopover'
import { DiscoverKindPicker } from './DiscoverKindPicker'
import { DiscoverReclassifyPicker } from './DiscoverReclassifyPicker'
import { ROLE_LABELS } from '@shared/autoArrangeLabels'
import { stemColorVar } from '../theme/typeColor'
import {
  discoverSlotKindToArrangeRole,
  slotKindsLabel,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'
import {
  RADIO_DIG_STOP_TOOLTIP,
  RADIO_DIG_TOOLTIP,
  RADIO_DIG_WORD,
  RADIO_HOOK_WORD,
  RADIO_HOOK_RELEASE_TOOLTIP,
  RADIO_HOOK_TOOLTIP
} from '@shared/radioHooks'
import { type RadioSlotFlag } from '@shared/radioSlotFlags'
import { type RadioApproach } from '@shared/radioApproach'
import {
  buildMatchMeter,
  discoverRoleLabel,
  reclassifyKindSources,
  MATCH_METER_STEPS
} from '@shared/discoverMatchMeter'
import type { ArrangeRole } from '@shared/stemRole'
import { discoverWindowLayout } from '@shared/discoverWindowLayout'
import { startPointerDrag } from './dragUtils'
import { type Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
import type { DiscoverSlot } from './DiscoverPanel'
import { RadioRowPlates } from './RadioRowPlates'
import type { RadioRowPlates as RadioRowPlatesModel } from '@shared/radioRowPlates'
import {
  peekResolvedCandidateStem,
  resolveCandidateStem,
  type ResolvedCandidateStem
} from './discoverCandidateStem'
import {
  DISCOVER_ROW_COLUMN_GAP,
  DISCOVER_ROW_GRID_COLUMNS,
  DISCOVER_WAVEFORM_COLUMN,
  DISCOVER_WAVEFORM_HEIGHT,
  DISCOVER_WAVEFORM_MIN_WIDTH
} from './discoverRowGrid'

// Hand-drawn padlock glyph (open/closed shackle), styled after Phosphor's
// Lock/LockOpen icons -- but drawn directly as inline SVG geometry rather
// than pulling in an icon library, matching TransportBar.tsx's own
// MetronomeIcon/SettingsGearIcon convention and its "no emoji in chrome"
// design-system rule (CLAUDE.md): this codebase deliberately avoids an icon
// package. Monochrome via currentColor so it inherits the lock button's own
// state color (same as every other hand-drawn glyph in this app).
function LockGlyph({ locked }: { locked: boolean }): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      {/* Shackle arc -- closed drops all the way to the body's top edge on
          both sides; open stops short on the right, same "lifted latch"
          read as Phosphor's own LockOpen. */}
      <path d={locked ? 'M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7' : 'M5.5 7 V5 a2.5 2.5 0 0 1 5 0'} />
      <circle cx="8" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** One 18px square on a Discover row. Every new control on the row
 * (2026-09-29, docs/superpowers/specs/2026-09-29-discover-row-icons-and-
 * source-dial-design.md) is one of these, so the states cannot drift
 * between buttons:
 *
 *   `on`: the padlock's own treatment, an inverted fill -- "hold longer".
 *   `soft`: lit but outlined -- "change next", a request that is spent on
 *     the next change and then gone.
 *   `pulsing`: the reroll this button started is still in flight.
 *   `disabled`: the whole button at 0.35 opacity, state styling kept.
 *   `toggle`: an on/off control, so `aria-pressed` is always present
 *     (false when off) -- the role must not change with the state.
 *   `ariaExpanded`: a menu trigger; `soft` there means "open", not
 *     "pressed", so it gets aria-expanded + aria-haspopup instead.
 *
 * Monochrome in every state, per tokens.css: colour on this row is for
 * audio only. */
function RowIconButton({
  gridColumn,
  tooltip,
  onClick,
  children,
  state = 'off',
  disabled = false,
  dimmed = false,
  pulsing = false,
  hidden = false,
  toggle = false,
  ariaExpanded,
  buttonRef,
  ariaLabel
}: {
  /** The row grid's track; omitted, the button takes no placement (radio view plan Task 5). */
  gridColumn?: number
  tooltip: string
  /** A stable accessible name for a toggle whose tooltip flips (default: the tooltip). */
  ariaLabel?: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
  state?: 'off' | 'on' | 'soft'
  disabled?: boolean
  /** Looks disabled but still takes clicks -- a row waiting for the loop
   * top, where a plain click is ignored by the handler but a Cmd-click
   * lands a change right away (2026-09-29). */
  dimmed?: boolean
  pulsing?: boolean
  hidden?: boolean
  toggle?: boolean
  ariaExpanded?: boolean
  buttonRef?: React.Ref<HTMLButtonElement>
}): React.JSX.Element {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled || hidden}
      data-tooltip={tooltip}
      aria-label={ariaLabel ?? tooltip}
      aria-pressed={toggle ? state !== 'off' : undefined}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaExpanded === undefined ? undefined : 'menu'}
      // The pending pulse is a class (DiscoverPanel's <style>), so the radio view's
      // reduced-motion rule can stop it.
      className={pulsing ? 'discover-pending' : undefined}
      style={{
        gridColumn,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        visibility: hidden ? 'hidden' : 'visible',
        pointerEvents: hidden ? 'none' : 'auto',
        background:
          state === 'on'
            ? 'var(--ra-text)'
            : state === 'soft'
              ? 'var(--ra-bg-row-active)'
              : 'transparent',
        border: `1px solid ${state === 'off' ? 'var(--ra-border)' : 'var(--ra-text)'}`,
        color:
          state === 'on'
            ? 'var(--ra-bg-frame)'
            : state === 'soft'
              ? 'var(--ra-text)'
              : 'var(--ra-text-2)',
        // Disabled dims the WHOLE button and keeps its state styling, so a
        // padlocked row that is hooked reads as a dimmed lit hand: the flag
        // is inert but still readable. A pulsing button is also disabled
        // (it started the roll in flight), and its pulse is on opacity, so
        // the animation wins there rather than fighting a fixed value.
        opacity: (disabled || dimmed) && !pulsing ? 0.35 : undefined,
        cursor: disabled ? 'default' : 'pointer'
      }}
    >
      {children}
    </button>
  )
}

/** Radio's role toggles on a row (spec anointed-stems sections 2 and 3; planning decision 7),
 * in the radio layout's button line: the hook (Phosphor Repeat, pressed while the row has a hook
 * in any state; greyed on a padlocked row) and dig (Shovel, pressed on the one dug row; a
 * padlocked row may be dug). One component so the radio-view redesign can move both into its
 * radio-role slot unchanged. */
function RadioRoleButtons({
  hookSet,
  locked,
  onToggleHook,
  dug,
  onToggleDig
}: {
  hookSet: boolean
  locked: boolean
  onToggleHook: () => void
  dug: boolean
  onToggleDig: () => void
}): React.JSX.Element {
  return (
    <>
      <RowIconButton
        tooltip={hookSet ? RADIO_HOOK_RELEASE_TOOLTIP : RADIO_HOOK_TOOLTIP}
        ariaLabel={RADIO_HOOK_WORD}
        onClick={onToggleHook}
        toggle
        state={hookSet ? 'on' : 'off'}
        disabled={locked && !hookSet}
      >
        <Repeat size={12} weight={hookSet ? 'fill' : 'regular'} />
      </RowIconButton>
      <RowIconButton
        tooltip={dug ? RADIO_DIG_STOP_TOOLTIP : RADIO_DIG_TOOLTIP}
        ariaLabel={RADIO_DIG_WORD}
        onClick={onToggleDig}
        toggle
        state={dug ? 'on' : 'off'}
      >
        <Shovel size={12} weight={dug ? 'fill' : 'regular'} />
      </RowIconButton>
    </>
  )
}

export function DiscoverSlotRow({
  slot,
  radioApproach,
  rerolling,
  manualWaiting,
  previewing,
  soloed,
  favourited,
  maxBarLength,
  onToggleLock,
  radioFlag,
  radioOn,
  hookIn,
  hookSet,
  hookAwayName,
  onToggleHook,
  onBringHookBack,
  dug,
  onToggleDig,
  onLike,
  listenOnlyStars,
  nearbyCreator,
  onToggleReplaceSoon,
  onRemove,
  onDuplicate,
  onReroll,
  onRerollRandom,
  onTogglePreview,
  onToggleSolo,
  onResolvedChange,
  onSlotResolutionAbandoned,
  onGainChange,
  onSwapFromNearby,
  onChangeKinds,
  onReclassify,
  soundSourceEndlesss,
  soundSourceAudioIn,
  layout,
  rowNumber,
  plates
}: {
  slot: DiscoverSlot
  /** Set while radio is about to change THIS row, and null otherwise.
   *
   * Direct report, 2026-09-29: "i don't see any preparatory blinking on
   * the channels about to transition... right now it just drops when the
   * loop ends and everything seems cramped for time." Two stages of ONE
   * wait (see @shared/radioApproach): `armed` is a pick chosen and warmed
   * ahead of time, `held` is that same change now decided and waiting
   * only for the next loop top. Only `state` is drawn -- the row breathes
   * at two luminances and the red playhead says when -- but both stages
   * measure the same quantity, so the brightness step cannot move what
   * the row is telling him. */
  radioApproach: RadioApproach | null
  /** True while THIS slot's own rerollSlot call is in flight -- drives the
   * reroll button's disabled/label-swap state, matching
   * LibraryBrowser.tsx's own downloadingRiffCID-driven disabled + label
   * convention. */
  rerolling: boolean
  /** True while a manual change on THIS row waits for radio's next loop
   * top. Same kind, nearby jam and any stem are DIMMED with the look
   * `rerolling` gives them, but not disabled: a plain second click on a
   * waiting row is ignored by the handlers (Elling, 2026-09-29), while a
   * Cmd-click lands a change right away, replacing the waiting one.
   * Duplicate and remove stay live. */
  manualWaiting: boolean
  /** True while THIS slot is currently included in the playing mix
   * (DiscoverPanel's own `previewingSlotIds`). Toggled-on slots play
   * TOGETHER, looped, like the Upcycle reference this screen is modeled on
   * -- not a one-at-a-time solo. */
  previewing: boolean
  /** True while THIS slot is the ONLY one currently in the playing mix
   * (DiscoverPanel's own `previewingSlotIds.size === 1 && ...has(slot.id)`)
   * -- drives the "S" button's active state, matching ChannelRow.tsx's own
   * `soloed` computed-fresh-from-mute-state convention (not a separately
   * persisted "which slot is soloed" flag). Direct request, 2026-09-15
   * (Upcycle-inspired). */
  soloed: boolean
  /** True when this slot's own resolved candidate's stemCID is in
   * DiscoverPanel's own `stemFavourites` set -- direct request,
   * 2026-09-16, star a stem so the global "prefer faves" toggle can
   * bias future rolls toward it. Persisted (see
   * StoreContext.tsx's useStemFavourites), not per-session. */
  favourited: boolean
  /** The loop's length in bars: the longest currently-resolved slot's own
   * barLength, across every row (DiscoverPanel's own `maxBarLength`). No
   * longer the tiling reference -- every row tiles its stem across the same
   * fixed window (discoverWindowLayout), and this only places the loop-top
   * lines, and grows the window when the loop is longer than 32 bars. 0
   * before anything in the loop has resolved yet. The playhead is no longer
   * the row's: since 2026-09-30 there is ONE, drawn by DiscoverPanel over
   * every row at once (sweepLineRef). */
  maxBarLength: number
  onToggleLock: () => void
  /** What this row has been told about radio's next change: `hook` to hold
   * it, `replace-soon` to hurry it, null for neither. At most one row in
   * the panel carries `hook`; any number can carry `replace-soon`. See
   * src/shared/radioSlotFlags.ts. */
  radioFlag: RadioSlotFlag | null
  /** Whether radio is running. 👎 only means anything while it is, so it
   * is hidden -- but still RENDERED -- when it is not; 👍's hold half is
   * skipped, and its holding look not drawn. */
  radioOn: boolean
  /** The 👍 -- toggles this stem's star and, when starring, hooks the
   * stem (DiscoverPanel's likeSlot -> likeRadioSlot, likeRadioStem). */
  onLike: () => void
  /** Discover artist mode, listen only: 👍 holds but stars nothing, and
   * its tooltip says so. The button stays un-dimmed -- it still holds. */
  listenOnlyStars: boolean
  /** Discover artist mode: the nearby popover shows only this creator's
   * stems. Undefined in own mode. */
  nearbyCreator: string | undefined
  /** The 👎 ("change soon", once "change next") -- toggles `replace-soon`
   * on this row (toggleRadioReplaceSoon). */
  onToggleReplaceSoon: () => void
  onRemove: () => void
  /** DiscoverPanel's own duplicateSlot(id) -- clones this slot's current
   * state (kind, candidate, gain, lock, seedStem) into a brand-new slot
   * appended to the end of the list. See duplicateSlot's own doc comment
   * for why the new row needs no special-casing to resolve/auto-join the
   * mix. `immediate` is Cmd held on the click (2026-09-29): while radio
   * runs, the stem lands right away instead of waiting for the loop top --
   * the same flag on onReroll, onRerollRandom and onSwapFromNearby. */
  onDuplicate: (immediate: boolean) => void
  onReroll: (immediate: boolean) => void
  /** DiscoverPanel's own rerollRandomSlot -- bypasses confirmed/embedding/
   * instrument matching entirely, picking any stem from the user's own
   * library at random. Direct request: an escape hatch for exactly the
   * "stuck at no match regardless of chaos/confirmation" case. */
  onRerollRandom: (immediate: boolean) => void
  /** DiscoverPanel's own updateSlotGain -- fires on every tick of a drag
   * directly on this row's own waveform (handleGainDragStart, below),
   * mirroring StemWaveformRow.tsx's own "envelope" volume-drag gesture
   * rather than a separate slider widget. */
  onGainChange: (gain: number) => void
  /** Toggles whether THIS slot is included in DiscoverPanel's own shared
   * playing mix -- the row itself doesn't own any audio state, it only
   * asks the parent to flip its own membership (see DiscoverPanel's own
   * toggleSlotPreview). Originally triggered two ways -- clicking the
   * row's own waveform (doubling as volume-drag via onMouseDown) or a
   * dedicated "mute"/"unmute" button, added 2026-09-15 because the
   * waveform click alone wasn't discoverable as mute -- but the waveform
   * click made it too easy to mute a slot by accident while reaching for
   * the gain drag on the same element. Direct request, 2026-09-20: the
   * dedicated "m" button is now the ONLY way to trigger this; the
   * waveform itself no longer calls it at all. Doesn't render (not merely
   * disabled) until resolvedStem exists -- nothing to add to/remove from
   * the mix before then. */
  onTogglePreview: () => void
  /** Solos THIS slot -- see DiscoverPanel's own toggleSlotSolo for the
   * exact semantics (drop every other slot out of the mix; a second click
   * while already the sole soloed slot restores every resolved slot).
   * Only shown once there's a real stem to solo (matching the mute
   * button's own guard, just below). */
  onToggleSolo: () => void
  /** Reports this row's own effective resolved stem (or null) up to
   * DiscoverPanel every time it changes -- resolved on arrival, invalidated
   * on reroll, cleared on unmount/removal -- so the parent's
   * resolvedStemsRef and any currently-playing mix this slot is part of
   * stay in sync with what's actually showing on screen, rather than
   * DiscoverPanel needing to re-resolve candidates itself. */
  onResolvedChange: (stem: ResolvedCandidateStem | null) => void
  /** DiscoverPanel's own forgetSlotResolution(id) (plus the matching
   * previewing-mix cleanup) -- called once when this row's own resolution
   * hits a TERMINAL failure state (resolveFailed or noMatchFound, both
   * computed locally below), as opposed to onResolvedChange(null) above,
   * which now stays a no-op for the transient "mid-reroll, still
   * resolving" case. See this row's own dedicated effect for why the two
   * are kept separate. */
  onSlotResolutionAbandoned: () => void
  /** DiscoverPanel's own swapSlotFromNearby -- called when the user picks a
   * candidate from this slot's own "explore nearby" popover. An undoable
   * swap, like a reroll: instant with radio off or Cmd held, otherwise
   * waiting for the loop top. Returns false when the pick was ignored (the
   * row already waits), so the popover stays centred where it was. See
   * swapSlotFromNearby's own doc comment in DiscoverPanel. */
  onSwapFromNearby: (candidate: DiscoverCandidate, immediate: boolean) => boolean
  /** DiscoverPanel's own changeSlotKinds -- fired by the kind picker on
   * every chip toggle (the panel rerolls this slot). */
  onChangeKinds: (kinds: DiscoverSlotKind[]) => void
  /** DiscoverPanel's own reclassifySlot -- fired by the match meter's
   * reclassify picker with the chosen role. */
  onReclassify: (role: ArrangeRole) => void
  /** The source dial as a filter (soundSourceForLean) -- passed as two
   * primitive booleans, not one object, so this row's own re-render checks
   * stay cheap; combined into a real DiscoverSoundSourceFilter object only
   * where actually needed below (the "explore nearby" popover). */
  soundSourceEndlesss: boolean
  soundSourceAudioIn: boolean
  /** Radio's hook (@shared/radioHooks) is IN on this row: 👍's holding mark. */
  hookIn: boolean
  /** The row has a hook in any state: its toggle (track 16) is pressed. */
  hookSet: boolean
  /** The away hook's stem name, shown dimmed after the readout's label (tap: bring it back);
   * null unless its hook is away. */
  hookAwayName: string | null
  onToggleHook: () => void
  onBringHookBack: () => void
  /** Radio's dig (@shared/radioDig) is on this row: its toggle is pressed. */
  dug: boolean
  onToggleDig: () => void
  /** Which assembly of the row's parts (radio view plan Task 7): today's grid, or, while radio
   * runs, the radio view's button line over a full-width waveform. The same parts either way,
   * and the same DiscoverSlotRow, so switching never remounts the row. */
  layout: 'grid' | 'radio'
  /** The row's place in the list, from 1: the radio layout's accessible name. */
  rowNumber: number
  /** The radio layout's plates on the waveform (@shared/radioRowPlates): label and tail, cue,
   * fold. Null with radio off (the grid draws none). */
  plates: RadioRowPlatesModel | null
}): React.JSX.Element {
  // Resolves the slot's own candidate down to a real, locally-downloaded
  // Stem (resolveCandidateStem, defined above) -- Waveform needs a real
  // on-disk path to decode (getPeaks/getBrightness both read the file
  // directly), and a DiscoverCandidate carries no local path of its own
  // until resolved. Re-resolves whenever `slot.candidate` itself changes
  // identity (a fresh reroll) -- `cancelled` guards against a stale,
  // slower-resolving previous candidate's download completing AFTER a
  // newer reroll has already replaced it, same stale-response guard
  // convention as this session's own useStemFeatureScan.ts. An empty slot,
  // or one whose candidate hasn't resolved yet (still downloading, or
  // resolution failed), renders a plain placeholder box instead of calling
  // Waveform with nothing to decode.
  //
  // `resolved` is paired with the candidate it was resolved FOR (rather
  // than reset to null synchronously at the top of the effect below,
  // which react-hooks/set-state-in-effect flags as a cascading-render
  // risk) -- `resolvedStem` below derives the "not ready yet" placeholder
  // state by comparing `resolved.candidate` against the CURRENT
  // `slot.candidate` identity, so a fresh reroll reads as unresolved
  // immediately (same visible behavior as an explicit reset) without ever
  // calling setState synchronously in the effect body.
  //
  // Real, reported bug this tri-state status fixes: resolveCandidateStem
  // returns null (never throws) for its own documented, EXPECTED failure
  // modes (a since-deleted riff, a download that doesn't actually contain
  // the target stem, ...) -- a plain {candidate, stem} pair had no way to
  // represent that outcome, so a failed resolution left `resolved` (and
  // therefore the "resolving" spinner below) stuck exactly where it
  // started: indistinguishable from "still genuinely in progress," forever.
  // That's the identical "looks hung, no indication anything happened"
  // symptom this whole loading-state feature was added to fix, just moved
  // onto the failure path instead of the loading path. `status: 'failed'`
  // gives the failure path its own real, terminal, visually distinct
  // state instead.
  const [resolved, setResolved] = useState<
    | { candidate: DiscoverCandidate; status: 'ready'; stem: Stem }
    | { candidate: DiscoverCandidate; status: 'failed' }
    | null
  >(null)
  // Which of this row's own reroll buttons started the roll in flight, so
  // that one pulses and the others only dim. A roll started from anywhere
  // else (radio, the phone, the panel's roll-all) leaves this stale, but it
  // is only read while `rerolling`, and it is cleared the first render
  // `rerolling` is false. That needs a gap between rolls: if radio or the
  // phone starts a second roll on this slot while the first is still in
  // flight, `rerolling` never drops and the first button keeps pulsing for
  // a roll it did not start. Rare and harmless, so accepted as is.
  const [rerollAction, setRerollAction] = useState<'similar' | 'random' | null>(null)
  if (!rerolling && rerollAction !== null) setRerollAction(null)

  useEffect(() => {
    let cancelled = false
    if (!slot.candidate) return
    const candidate = slot.candidate
    void resolveCandidateStem(candidate).then((stem) => {
      if (cancelled) return
      setResolved(
        stem
          ? { candidate, status: 'ready', stem: { slot: 1, ...stem } }
          : { candidate, status: 'failed' }
      )
    })
    return () => {
      cancelled = true
    }
  }, [slot.candidate])

  // A seeded slot (see DiscoverSlot's own seedStem doc comment) is already
  // resolved -- there is nothing to fetch, so this is derived at render time
  // rather than pushed into `resolved` via setState in the effect above
  // (same react-hooks/set-state-in-effect reasoning as the comment above the
  // effect: avoid a synchronous setState in an effect body when the value
  // can just be computed directly instead). `candidate: slot.candidate` here
  // is always `null` for a seeded slot (seedStem and candidate are mutually
  // exclusive -- see rollForSlot/rollRandomForSlot's own seedStem-clearing
  // below), which is also why the effect above never needs its own
  // seedStem branch: `!slot.candidate` already short-circuits it whenever
  // this row is seeded.
  // Memoized -- direct report, 2026-09-17, root-caused as part of
  // investigating why "sometimes the waveforms blink away" and playback
  // interruptions felt worse on Shelf-seeded loops specifically: an
  // inline object literal here (the version this replaces) gets a NEW
  // identity on every single render, so `resolvedStem` below (derived
  // from `seedResolved` for every seeded slot) also gets a new identity
  // every render -- which re-fires the `[resolvedStem]` effect further
  // down on every render, which calls onResolvedChange, which (via
  // reportSlotResolution) updates resolvedBarLengths/schedules an engine
  // sync, which re-renders this row, which creates a NEW seedResolved
  // object again... a self-sustaining loop with no natural end, pegging
  // the main thread and re-sending a full buildEngineProject/
  // engineLoadProject to the native engine on every animation frame for
  // as long as ANY seeded slot exists. Memoizing on the underlying data
  // (slot.seedStem/slot.candidate) instead of recreating the object every
  // render breaks the loop: the object's identity now only changes when
  // what it actually represents changes.
  const seedResolved = useMemo(
    () =>
      slot.seedStem
        ? {
            candidate: slot.candidate,
            status: 'ready' as const,
            stem: { slot: 1, ...slot.seedStem }
          }
        : null,
    [slot.seedStem, slot.candidate]
  )

  // Already resolved elsewhere (radio warms its pick a whole interval
  // early): read it on THIS render rather than waiting a microtask for
  // the effect above -- see settledCandidateStems. Preferred over
  // `resolved` even once that arrives, so resolvedStem keeps one identity
  // and the [resolvedStem] effect below does not report it twice.
  const peekResolved = useMemo(() => {
    if (!slot.candidate) return null
    const stem = peekResolvedCandidateStem(slot.candidate)
    return stem
      ? { candidate: slot.candidate, status: 'ready' as const, stem: { slot: 1, ...stem } }
      : null
  }, [slot.candidate])

  const resolvedForCurrent =
    seedResolved ?? peekResolved ?? (resolved?.candidate === slot.candidate ? resolved : null)
  const resolvedStem = resolvedForCurrent?.status === 'ready' ? resolvedForCurrent.stem : null
  const resolveFailed = resolvedForCurrent?.status === 'failed'
  // A candidate exists but hasn't SETTLED yet either way (no ready stem,
  // no confirmed failure) -- genuinely in flight (downloading/decoding via
  // resolveCandidateStem above), not "empty" and not "failed." Direct
  // report: without this distinction the placeholder ring looked identical
  // whether a slot had nothing at all, was actively working, or had
  // already failed for good (e.g. a since-deleted riff) -- reading as
  // stuck/broken in every one of those cases, including the one where the
  // spinner would otherwise have kept insisting it was still working.
  const resolving = slot.candidate !== null && resolvedStem === null && !resolveFailed
  // A reroll actually COMPLETED but found nothing that matched this slot's
  // kind/constraints at all (rollForSlot/rerollSlot left slot.candidate
  // null) -- distinct from resolveFailed (a real candidate WAS found but
  // couldn't be downloaded/decoded). Direct report, 2026-09-17: "just tried
  // to add a vocal and i think it didn't find an appropriate one... but
  // there was no indication what happened. no failure message" -- the
  // placeholder below used to show a plain neutral-bordered empty box for
  // this exact case, visually identical to a slot that's simply never been
  // touched yet.
  const noMatchFound =
    !rerolling && !resolving && !resolveFailed && slot.candidate === null && slot.hasRerolled
  // Direct report, 2026-09-21: "the dotted outline is good but seems to
  // appear quite late in the process" -- `resolving` alone only covers the
  // download/decode half (a candidate already picked); the candidate SEARCH
  // before it (rerolling, getDiscoverCandidates in flight) left an empty
  // slot's placeholder looking untouched. `working` spans both halves, so
  // the lit outline + loader show from the moment of the click.
  const working = resolving || (rerolling && resolvedStem === null)

  // "Explore nearby" popover state -- position (screen coords, set from the
  // trigger button's own getBoundingClientRect on open) or null when closed.
  // See DiscoverNearbyPopover.tsx.
  const [nearbyMenu, setNearbyMenu] = useState<{ x: number; y: number } | null>(null)
  const nearbyButtonRef = useRef<HTMLButtonElement>(null)
  // Stable across renders (useCallback, empty deps) -- DiscoverNearbyPopover's
  // own outside-click dismissal effect depends on this identity ([onClose,
  // ignoreRef]), and this row re-renders on every playhead tick while
  // anything is previewing (DiscoverPanel re-renders on its own usePos(),
  // and this row with it). An inline `() => setNearbyMenu(null)` closure would be
  // torn down and rebuilt on every one of those ticks, real bug found live:
  // "clicking out of the near panel should close it instead of having to
  // click the near button again" -- the dismiss listener's own
  // setTimeout(0)-delayed (re-)attach never got a settled window to catch a
  // real click while playback kept remounting the effect out from under it.
  const closeNearbyMenu = useCallback(() => setNearbyMenu(null), [])

  // "Kind picker" popover state -- same position/dismissal pattern as
  // nearbyMenu above. See DiscoverKindPicker.tsx.
  const [kindMenu, setKindMenu] = useState<{ x: number; y: number } | null>(null)
  const kindButtonRef = useRef<HTMLButtonElement>(null)
  // Stable identity -- same playhead-tick re-render reasoning as closeNearbyMenu.
  const closeKindMenu = useCallback(() => setKindMenu(null), [])

  // Match meter (docs/superpowers/specs/2026-09-22-discover-promise-vs-
  // delivery-design.md, Phase 2) -- one compact readout per requested kind,
  // under the kind label. Mask kinds say why the stem was admitted
  // (tag/guess/confirmed, from the candidate's kindSources, or the
  // slot's own reclassify); trait kinds show 5-step bars from the stem's
  // library percentile. Trait entries only for a candidate rollForSlot
  // picked (pickBar paired with it): random/nearby/seeded candidates never
  // had percentiles computed, and empty bars there would misreport them as
  // unanalysed. Nothing at all without a candidate.
  const meterEntries = useMemo(() => {
    const candidate = slot.candidate
    if (!candidate) return []
    const fromRoll = slot.pickBar?.candidate === candidate
    const reclassified = slot.reclassified?.candidate === candidate ? slot.reclassified : undefined
    return buildMatchMeter({
      kinds: slot.kinds,
      kindSources: reclassified
        ? reclassifyKindSources(slot.kinds, reclassified.role)
        : (candidate.kindSources ?? {}),
      traitPercentiles: candidate.traitPercentiles ?? {},
      barUsed: fromRoll ? (slot.pickBar?.barUsed ?? null) : null,
      barRequested: slot.pickBar?.barRequested,
      reclassified: reclassified
        ? { role: reclassified.role, label: discoverRoleLabel(reclassified.role, ROLE_LABELS) }
        : undefined
    }).filter((entry) => entry.type === 'mask' || fromRoll)
  }, [slot.candidate, slot.kinds, slot.pickBar, slot.reclassified])

  // Reclassify picker -- same position/dismissal pattern as kindMenu, anchored
  // on whichever meter source word was clicked; the whole meter is the
  // dismissal ignoreRef so clicking another source word just re-anchors.
  const [reclassifyMenu, setReclassifyMenu] = useState<{
    x: number
    y: number
    currentRole: ArrangeRole | null
  } | null>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const closeReclassifyMenu = useCallback(() => setReclassifyMenu(null), [])

  // Direct request, 2026-09-16: "i imported a batch of rifffs using the
  // import from library feature and attempting to discover the individual
  // riffs i find that i cannot use the adjacent rifffs feature. it should
  // know the adjacent rifffs still, right?" -- a Shelf-sourced slot
  // (seedStem set, candidate null) has no explicit riffCID to anchor
  // adjacency from, but findRiffForStemPath can recover one from the
  // seeded stem's own already-downloaded local path (its basename IS its
  // own StemCID -- see that function's own doc comment). Only attempted
  // for a seedStem-only slot; a slot with a real `candidate` already has
  // everything it needs and skips this entirely (see the null guard
  // clearing seedStemAnchor below, so a later reroll landing a real
  // candidate doesn't leave a stale anchor around).
  // Paired with the seed stem path it was looked up FOR -- same
  // resolved/resolvedForCurrent identity-comparison convention this file
  // (and DiscoverNearbyPopover.tsx) already uses elsewhere, so a stale
  // "candidate went from null back to null via a different seedStem"
  // transition, or the null-when-nothing-to-look-up case, never needs a
  // synchronous setState at the top of the effect body (which
  // react-hooks/set-state-in-effect flags as a cascading-render risk) --
  // it's derived from a key mismatch at render time instead.
  const [seedStemLookup, setSeedStemLookup] = useState<{
    path: string
    anchor: DiscoverCandidate | null
  } | null>(null)
  const seedStemLookupPath = slot.candidate === null ? (slot.seedStem?.path ?? null) : null
  useEffect(() => {
    if (seedStemLookupPath === null) return
    const seedStem = slot.seedStem
    if (!seedStem) return
    let cancelled = false
    window.rifffApi
      .findRiffForStemPath(seedStemLookupPath)
      .then((result) => {
        if (cancelled) return
        setSeedStemLookup({
          path: seedStemLookupPath,
          anchor: result
            ? {
                stemCID: result.stemCID,
                jamCID: result.jamCID,
                riffCID: result.riffCID,
                presetName: seedStem.name,
                creatorUserName: seedStem.author,
                slotKinds: slot.kinds,
                traitValues: {},
                traitPercentiles: {},
                kindSources: {},
                drumSubRole: null,
                riffBpm: result.bpm,
                riffCreationTime: result.creationTime
              }
            : null
        })
      })
      .catch((err) => {
        console.error('DiscoverSlotRow: findRiffForStemPath failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slot.seedStem/slot.kinds are read inside via the closure above, not tracked as deps here; seedStemLookupPath already changes whenever slot.seedStem's own path does (it's derived from it). kinds only change via the picker (Task 6/combination slots), which sets the new kinds synchronously but only rerolls (and thus only lands a real `candidate`, which is what nulls out seedStemLookupPath) once that reroll's own IPC round trip resolves -- so a kinds edit and seedStemLookupPath going null are two SEPARATE updates, not the same one. Harmless, not a bug: the anchor object's own `slotKinds` field is only read for display labeling, and DiscoverNearbyPopover reads slot.kinds directly rather than through this anchor, so a momentarily-stale slotKinds value here is never actually shown. Listing slot.kinds as a dep would only cause a redundant re-lookup of the same path.
  }, [seedStemLookupPath])
  const seedStemAnchor = seedStemLookup?.path === seedStemLookupPath ? seedStemLookup.anchor : null
  // The real candidate always wins when present; a seedStem-only slot
  // falls back to whatever findRiffForStemPath managed to recover (or
  // null, if the stem isn't part of any currently-known jam -- a real
  // possibility for a locally-recorded take or an import unrelated to any
  // Endlesss jam, handled the same as "no candidate" already was: the
  // button just doesn't render).
  const nearbyAnchor: DiscoverCandidate | null = slot.candidate ?? seedStemAnchor

  // Direct request: adjust gain by dragging vertically on the waveform
  // itself -- StemWaveformRow.tsx's own "envelope" volume-drag gesture,
  // reused here (startPointerDrag, same deltaY/ROW_HEIGHT scale) instead of
  // a separate slider widget. Deliberately does NOT call onEnd/check
  // `moved`: unlike the real timeline's SET_VOLUME (an undo-tracked
  // dispatch, only committed once on release), onGainChange writes directly
  // into this component's own pre-placement `slots` state on every tick --
  // there's nothing to "commit" separately, and no undo history to spare
  // from a flood of intermediate values. Direct request, 2026-09-20: the
  // waveform button no longer has an onClick at all (mute moved to the
  // dedicated "m" button only) -- a plain click here is now simply inert,
  // not a toggle.
  function handleGainDragStart(e: React.MouseEvent): void {
    const startGain = slot.gain
    startPointerDrag(e, (_dx, deltaY) => {
      onGainChange(Math.max(0, Math.min(1, startGain - deltaY / DISCOVER_WAVEFORM_HEIGHT)))
    })
  }

  // Reports the effective resolved stem up to DiscoverPanel every time it
  // changes -- on the way in (a fresh resolution lands), on the way out (a
  // reroll invalidates the old one, this row unmounts/gets removed). Does
  // NOT depend on `onResolvedChange` itself: that's a fresh closure every
  // DiscoverPanel render (it wraps reportSlotResolution with this row's own
  // slot.id), and depending on it would re-fire this effect -- and
  // potentially restart a playing mix -- on every unrelated parent
  // re-render instead of only when THIS row's own resolvedStem actually
  // changes.
  useEffect(() => {
    onResolvedChange(resolvedStem)
    return () => onResolvedChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [resolvedStem])

  // Direct reports, 2026-09-17, found in code review of the fix for
  // "sometimes it stops the playback... starts all of the loops from the
  // beginning": onResolvedChange(null) above (via the effect's own
  // cleanup) is now a deliberate no-op in DiscoverPanel for the "mid-
  // reroll, still resolving" case -- necessary so a reroll doesn't
  // transiently drop out of the mix and cause the exact restart/blink bugs
  // that fix addressed. But resolveFailed/noMatchFound are TERMINAL, not
  // transient -- nothing further is coming without the user taking another
  // action (reroll again, or remove the slot) -- so silently keeping the
  // OLD stem's audio playing forever under a UI that says "failed"/"no
  // match" (and, via hasStemToActOn below, HIDES the mute/solo/favourite
  // controls that would let the user silence it) is a real regression, not
  // "doesn't interrupt the flow." This is the one signal DiscoverPanel
  // still needs to treat as a genuine, permanent forget -- separate from
  // the shared resolvedStem effect above, which must stay a no-op-on-null
  // for the transient case.
  //
  // CRITICAL, found in a second round of code review: this first shipped
  // as `if (resolveFailed || noMatchFound) onSlotResolutionAbandoned()`
  // with NO resolvedStem guard, deps `[resolveFailed, noMatchFound,
  // onSlotResolutionAbandoned]`. Two compounding bugs: (1) noMatchFound is
  // TRUE for every Shelf-seeded slot (candidate: null, hasRerolled: true
  // -- see buildSeedSlotsFromStems -- exactly the shape noMatchFound's own
  // definition can't distinguish from "rerolled into nothing"), even
  // though a seeded slot has a perfectly good resolvedStem via
  // seedResolved -- so this effect abandoned every Shelf-seeded slot on
  // mount, forgetting its resolution and dropping it from the mix right
  // after the OTHER effect (above) had just added it, making Shelf-seeded
  // Discover content silently unplayable (and unrecoverable -- toggling
  // the waveform can't re-add a slot whose own resolvedStemsRef entry
  // keeps getting deleted again every render). (2) listing
  // onSlotResolutionAbandoned in the deps -- a fresh closure every
  // DiscoverPanel render, per its own call site -- meant this effect
  // re-ran on every one of THIS component's own ~30Hz playhead-tick
  // re-renders while previewing, not once per transition, exactly the
  // footgun the onResolvedChange effect above already documents avoiding.
  // Fixed by (a) requiring resolvedStem === null too -- a seeded slot's
  // resolvedStem is never null, so this can no longer fire for one
  // regardless of what noMatchFound alone says -- and (b) depending on
  // resolvedStem/resolveFailed/noMatchFound (real values, not a closure
  // identity) instead of the callback prop, matching the sibling effect's
  // own established convention exactly.
  useEffect(() => {
    if (resolvedStem === null && (resolveFailed || noMatchFound)) onSlotResolutionAbandoned()
    // Same reasoning as the onResolvedChange effect above: onSlotResolutionAbandoned
    // is a fresh closure every parent render (wraps abandonSlotResolution with this
    // row's own slot.id) and depending on it would re-fire this effect on every
    // unrelated parent re-render instead of only when THIS row's own
    // resolvedStem/resolveFailed/noMatchFound actually change. Safe to omit:
    // abandonSlotResolution only reads refs (resolvedStemsRef/resolvedBarLengthsRef/
    // previewingSlotIdsRef) plus setState, no stale closed-over state to go wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedStem, resolveFailed, noMatchFound])

  // Direct report, 2026-09-16: "the buttons shouldn't disappear when they
  // are rerolling" -- gating the mute/solo/favourite group on resolvedStem
  // alone meant it vanished the instant a reroll landed a new
  // slot.candidate, since resolvedForCurrent's own identity check (see
  // resolvedStem's own derivation above) immediately stops matching the OLD
  // resolved stem, well before the NEW one's own resolve finishes.
  // slot.candidate itself is set synchronously the moment a roll/reroll
  // lands (rollForSlot's own setSlots call) and stays valid throughout the
  // resolve that follows, so treating either as "there's something real
  // here to act on" keeps the group visible continuously through a reroll,
  // only truly hiding for a slot that's never been rolled at all (both
  // null). resolvedStem alone still covers a seedStem-only slot
  // (Shelf-sourced, no candidate ever, but resolvedStem resolves
  // synchronously via seedResolved).
  const hasStemToActOn = resolvedStem !== null || slot.candidate !== null

  // Direct report, 2026-09-17: "when i open something in discover,
  // sometimes some tracks are already muted." Root cause: the mute
  // button above is gated on hasStemToActOn (candidate OR resolvedStem,
  // widened 2026-09-16 so it doesn't flicker away mid-reroll -- see that
  // button's own comment), but its ON/OFF look was driven by `previewing`
  // alone (previewingSlotIds membership) -- and a slot only ever JOINS
  // previewingSlotIds once reportSlotResolution's success branch fires,
  // i.e. once resolvedStem actually lands. That leaves a real, visible
  // window -- every slot's OWN first roll, or a reroll, however brief --
  // where hasStemToActOn is already true (there's a candidate) but
  // previewing is still false (nothing to preview yet): the mute button
  // rendered in its hard-filled "muted" look even though nothing was ever
  // actually muted, just not resolved yet. Several slots resolving at
  // slightly different speeds after a fresh open/seed (some cached,
  // some genuinely downloading) is exactly when this was most visible --
  // "SOME tracks already muted," not all, and only "sometimes." Fixed by
  // deriving the button's own look from resolution state, not bare
  // previewing: still-resolving reads as its eventual default (about to
  // autoplay, matching the "it all should autoplay" convention
  // elsewhere in this file) rather than a false "muted," while a
  // genuinely terminal resolveFailed keeps the muted look (correct --
  // nothing is ever going to play there without a fresh reroll). Once
  // resolvedStem exists, this is identical to `!previewing`, same as
  // before.
  const showsAsMuted = resolvedStem !== null ? !previewing : resolveFailed
  // The one row radio holds longer, drawn on its 👍 (see that button).
  const holding = radioOn && hookIn

  // Where each part sits in the row grid (radio view plan Task 5); nowhere in the radio layout,
  // which is a flex line and a waveform, not a grid (Task 7).
  const radioLayout = layout === 'radio'
  const at = (n: number): { gridColumn?: number } => (radioLayout ? {} : { gridColumn: n })

  // Direct request, 2026-09-15: "an X for remove" -- icon-only, same
  // as every other row button now.
  const removeButton = (
    <button
      onClick={onRemove}
      data-tooltip="remove"
      aria-label="remove"
      style={{
        ...at(1),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        fontFamily: 'inherit',
        fontSize: 10,
        background: 'transparent',
        border: '1px solid var(--ra-border)',
        color: 'var(--ra-text-2)',
        cursor: 'pointer'
      }}
    >
      X
    </button>
  )
  const lockButton = (
    <button
      onClick={onToggleLock}
      data-tooltip={slot.locked ? 'unlock' : 'lock'}
      aria-label={slot.locked ? 'unlock' : 'lock'}
      style={{
        ...at(2),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        background: slot.locked ? 'var(--ra-stretch-on-bg)' : 'transparent',
        border: `1px solid ${slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
        color: slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
        cursor: 'pointer'
      }}
    >
      <LockGlyph locked={slot.locked} />
    </button>
  )
  // A single guard around a fragment is safe here (rather than one
  // guard per button, as this used to be split) because each button
  // below carries its own explicit gridColumn -- omitting all three
  // leaves columns 3/4 (and 👍's 14) empty instead of shifting anything after
  // them. See hasStemToActOn's own doc comment above for why it's
  // "has a candidate OR resolvedStem," not resolvedStem alone.
  const muteSolo = hasStemToActOn && (
    <>
      {/* Direct request, 2026-09-15: "can we add a mute for each
            channel" -- toggleSlotPreview already existed (the waveform
            itself was already clickable to the same effect), but wasn't
            discoverable as a mute control -- only a hover tooltip
            explained it. Same handler as the waveform click, so either
            one keeps the other in sync; only shown once there's a real
            stem to mute (matching the waveform toggle's own guard). */}
      <button
        onClick={onTogglePreview}
        data-tooltip={showsAsMuted ? 'unmute' : 'mute'}
        aria-label={showsAsMuted ? 'unmute' : 'mute'}
        style={{
          ...at(3),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 10,
          // Direct request, 2026-09-15: "mute should look exactly
          // like mute on the arrangement view" -- matches
          // ChannelRow.tsx's own muteButtonStyle exactly
          // (background/border/color-by-state, which reads as
          // "inverted" at a glance: a hard filled/colored look
          // when OFF/muted, a plain/transparent look when
          // ON/playing), rather than this row's own earlier ad hoc
          // treatment (transparent-when-off instead of the real
          // `--ra-bg-row-active` fill every other unmuted mute
          // button in this app uses). Driven by showsAsMuted (see
          // its own doc comment above), not bare `previewing` --
          // still-resolving no longer renders as falsely muted.
          background: showsAsMuted ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${showsAsMuted ? 'var(--ra-mute-on)' : 'var(--ra-border)'}`,
          color: showsAsMuted ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        {/* Lowercase "m" -- matches ChannelRow.tsx's own mute
              button glyph exactly (its solo/record siblings are also
              lowercase single letters), rather than this row's own
              earlier uppercase "M". */}
        m
      </button>
      {/* Direct request, 2026-09-15 (Upcycle-inspired): a solo
            button next to mute, same M/S pairing Upcycle's own cards use
            and ChannelRow.tsx already has on the real arrangement.
            Matches ChannelRow.tsx's own soloButtonStyle exactly (a soft
            tinted background with the accent color on border/text, not
            a hard fill like mute's). */}
      <button
        onClick={onToggleSolo}
        data-tooltip={soloed ? 'unsolo' : 'solo'}
        aria-label={soloed ? 'unsolo' : 'solo'}
        style={{
          ...at(4),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 10,
          background: soloed ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${soloed ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: soloed ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        s
      </button>
    </>
  )
  // Direct report, 2026-09-17: "tooltip over the waveforms on
  // discover prevents user from dragging the volume, so remove it" --
  // this wrapper used to carry a data-tooltip whose own text included
  // a live `drag for volume (N%)` readout, updating on every tick of
  // a gain drag -- the tooltip box re-rendering/resizing itself right
  // above the cursor mid-drag read as actively interfering with the
  // drag gesture, not just cosmetically noisy. Removed outright rather
  // than trimmed -- the inner button's own aria-label (below) still
  // carries a plain accessible name (drag to adjust volume), just
  // without the drag hint or the live percentage.
  const waveformCell = (
    <div
      style={{
        ...at(DISCOVER_WAVEFORM_COLUMN),
        // The radio layout's waveform is the row's full width (less its padding).
        ...(radioLayout
          ? { width: '100%', minWidth: 0 }
          : { minWidth: DISCOVER_WAVEFORM_MIN_WIDTH }),
        position: 'relative'
      }}
    >
      {resolvedStem ? (
        // Direct request, 2026-09-20: "clicking on wave shouldn't mute
        // it, leave that to the M button" -- clicking the waveform used
        // to double as mute/unmute (onTogglePreview), same click-the-
        // thumbnail-to-hear-it convention Shelf.tsx's own tiles and
        // ClusterStemsBrowser.tsx's own waveform rows use elsewhere in
        // this app -- but that made it too easy to mute a slot by
        // accident while reaching for the gain-drag gesture on the same
        // element. The dedicated "m" button (below) is now the ONLY way
        // to toggle this slot in/out of the shared mix; the waveform
        // itself only responds to a vertical drag (handleGainDragStart).
        // Direct report, 2026-09-15: the previewing-outline (a near-white
        // `--ra-stretch-on` box around the whole waveform) read as an
        // unwanted white halo -- removed; the dedicated mute button below
        // already carries this row's own on/off state, and the playhead
        // line (drawn over every row by DiscoverPanel) shows real
        // playback directly.
        <button
          onMouseDown={handleGainDragStart}
          aria-label="drag to adjust volume"
          // Direct request, 2026-09-20: "date could be a tooltip on
          // hover.. in discovery and in arranger or sketch" --
          // resolvedStem.creationTime is the OWNING RIFF's own real
          // creation date (see ResolvedCandidateStem's own doc
          // comment), undefined only for content resolved via the
          // live Endlesss API path (not Discover's own, which always
          // reads the local, already-synced library), in which case
          // this simply omits the tooltip rather than showing a wrong
          // date. Same year/month/day format LibraryBrowser.tsx's own
          // date-grouped riff listing already uses.
          data-tooltip={
            resolvedStem.creationTime
              ? new Date(resolvedStem.creationTime * 1000).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })
              : undefined
          }
          style={{
            position: 'relative',
            width: '100%',
            height: DISCOVER_WAVEFORM_HEIGHT,
            padding: 0,
            background: 'transparent',
            border: 'none',
            overflow: 'hidden',
            cursor: 'ns-resize',
            // Same 2026-09-21 report as `working` above -- a slot that
            // already has a stem keeps showing it while a reroll
            // searches, so the waveform itself breathes until the new
            // pick lands (then it swaps to the dotted placeholder while
            // that pick downloads/decodes).
            animation: rerolling ? 'discover-slot-working 1100ms ease-in-out infinite' : undefined
          }}
        >
          {/* Tiled, not a single stretched-to-fit Waveform -- direct
          report: every slot used to render at the same width regardless
          of its real bar length, making a 1-bar drum hit look the same
          size as an 8-bar bassline. Every row shows the SAME fixed
          window of bars (32, or the loop's length when a longer stem is
          in play -- discoverWindowLayout, spec 2026-09-29-discover-
          fixed-waveform-window-design.md), so a bar is the same width in
          every row and no row rescales when a longer or shorter stem
          arrives elsewhere. The stem repeats from bar 0 to fill the
          window, exactly how it will actually sound once looped, the
          last tile cut off at the window edge (this button's own
          `overflow: hidden` clips it). Restart lines mark each repeat,
          loop-top lines each wrap of the whole loop (the shared
          LoopLines, arrange's own restart line). Everything is a
          PERCENT of the window, which keeps this row's own flex-fluid
          width working without a real DOM measurement.
          Direct request: gain is shown/adjusted directly on the
          waveform (StemWaveformRow.tsx's own "envelope" volume
          treatment), not a separate slider -- a dim gray layer always
          renders full-height underneath; the real-color layer on top is
          clipped from the top down by `gainClipPct`, so a lower gain
          visibly cuts more of the bright waveform away, revealing gray
          underneath (same "gray means quieter" language the real
          envelope uses), with a thin line marking the exact cutoff. */}
          {(() => {
            // The tile cap (DISCOVER_MAX_TILES) lives in the layout
            // module now: a real crash, found live, came from an
            // unbounded tile count, each tile once mounting a real <Waveform>
            // (dozens of SVG rects), twice. Tiles are CSS mask repeats now,
            // but the cap still sets the minimum repeat width a sub-bar
            // one-shot is drawn at.
            const layout = discoverWindowLayout({
              stemBars: resolvedStem.barLength,
              loopBars: maxBarLength
            })
            const gainClipPct = (1 - slot.gain) * 100
            return (
              <>
                {/* ONE element per layer, not one <Waveform> per tile
                (Elling, 2026-09-30: "i think it's slowing the app down
                having so many of them on there"). RepeatedWaveform
                paints the stem once as a CSS mask and repeats it every
                tile width, so a 1-bar stem is 2 divs instead of 64 SVGs
                of ~128 rects each. The tile maths (and its minimum
                width) still come from discoverWindowLayout. The old
                per-tile blink (2026-09-17, keys shifting with the shared
                loop length) cannot recur: there are no per-tile nodes
                left to remount, and the mask is peeked synchronously
                from the warm peak cache. */}
                <RepeatedWaveform
                  path={resolvedStem.path}
                  color="var(--ra-text-4)"
                  tileWidthPct={layout.tiles[0]?.widthPct ?? 100}
                />
                {/* Full-color layer on top -- suppressed entirely while
                muted (not currently in the preview mix), same "mute
                always wins" convention StemWaveformRow.tsx's own
                real-arrangement waveform uses (its own `{!muted && ...}`
                guard just above). Direct report, 2026-09-15: "when
                muted, a waveform should be grey" -- muted rows here
                used to still show the full-color layer (just clipped by
                gain), reading as "playing, just quiet" rather than
                "off," unlike every other muted waveform in this app. */}
                {previewing && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      clipPath: `inset(${gainClipPct}% 0 0 0)`
                    }}
                  >
                    <RepeatedWaveform
                      path={resolvedStem.path}
                      color={stemColorVar(resolvedStem)}
                      tileWidthPct={layout.tiles[0]?.widthPct ?? 100}
                    />
                  </div>
                )}
                {previewing && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: `${gainClipPct}%`,
                      height: 1,
                      background: 'var(--ra-text)',
                      pointerEvents: 'none'
                    }}
                  />
                )}
                <LoopLines lefts={layout.restartLinePcts.map((p) => `${p}%`)} kind="restart" />
                <LoopLines lefts={layout.loopTopLinePcts.map((p) => `${p}%`)} kind="loopTop" />
              </>
            )
          })()}
        </button>
      ) : (
        <div
          style={{
            width: '100%',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            border: `1px dashed ${
              working
                ? 'var(--ra-stretch-on)'
                : resolveFailed || noMatchFound
                  ? 'var(--ra-mute-on)'
                  : 'var(--ra-border)'
            }`,
            // Static (no animation) once settled either way (failed/no-
            // match, or truly empty) -- discover-slot-pulse is still
            // used for both "this stopped" cases, not just resolveFailed
            // -- a rerolled slot that found nothing is equally worth
            // flagging, not a silent dead end.
            animation:
              resolveFailed || noMatchFound
                ? 'discover-slot-pulse 900ms ease-in-out infinite'
                : undefined
          }}
        >
          {/* Direct report, 2026-09-15 (v3): the previous scrolling-
            waveform reel read as too busy -- replaced with the shared
            LoadingLoader component (the same "still working" indicator
            BeatPicker.tsx/ClusterStemsBrowser.tsx already use), small
            and subtle, for brand consistency instead of a custom
            animation. */}
          {/* Direct report, 2026-09-17: bumped this up to size={120} once
              (read as "a jarring 2px sliver against the 40px-tall
              waveform it replaces"), then reverted -- "i was fine with
              it being the dotted line... add 1px to the height," then
              "i think it needs 1 more px to be stable." size=16 (the
              original) gave a 2px-tall, 1px-thick bar (LoadingLoader's
              own height = round(size*9/60) formula); size=24 keeps the
              same 1px-thick dotted-line look at 4px tall -- +2px total
              from the original, arrived at over two rounds of "+1px." */}
          {working && <LoadingLoader size={24} />}
          {/* Visible, not just a hover tooltip -- direct report,
              2026-09-17: rerolling into a genuine no-match dead end
              ("just tried to add a vocal... no indication what
              happened, no failure message") needs to read as a real
              outcome, not just silently stay in the same empty-looking
              box the slot started in before it was ever touched. */}
          {noMatchFound && (
            <span style={{ fontSize: 9, color: 'var(--ra-mute-on)' }}>no match</span>
          )}
        </div>
      )}
      {/* The radio layout's plates: label and tail, cue, fold (RadioRowPlates). */}
      {radioLayout && plates !== null && (
        <RadioRowPlates
          plates={plates}
          slotId={slot.id}
          hookAwayName={hookAwayName}
          onBringHookBack={onBringHookBack}
        />
      )}
    </div>
  )
  // Kind label + match meter stacked in the 110px label column --
  // see the meter's own comment on meterEntries above.
  const kindsBlock = (
    <div
      style={{
        ...at(7),
        // The radio layout keeps the button line one 20px line: the label, then the meter.
        ...(radioLayout
          ? {
              width: 'auto',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap'
            }
          : { width: 110, flexDirection: 'column', gap: 3 }),
        display: 'flex',
        minWidth: 0
      }}
    >
      <button
        ref={kindButtonRef}
        disabled={slot.locked}
        onClick={(e) => {
          if (kindMenu) {
            closeKindMenu()
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          setKindMenu({ x: rect.left, y: rect.bottom + 4 })
        }}
        aria-expanded={kindMenu !== null}
        aria-label={`kinds: ${slotKindsLabel(slot.kinds)}`}
        data-tooltip={slot.locked ? 'unlock first' : slotKindsLabel(slot.kinds)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          ...(radioLayout ? { maxWidth: 110 } : { width: 110 }),
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 9,
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          color: kindMenu ? 'var(--ra-text)' : 'var(--ra-text-3)',
          cursor: slot.locked ? 'default' : 'pointer'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {slotKindsLabel(slot.kinds)}
        </span>
        {!slot.locked && <span aria-hidden="true">▾</span>}
      </button>
      {meterEntries.length > 0 && (
        <div
          ref={meterRef}
          aria-label="match"
          style={{
            display: 'flex',
            flexWrap: radioLayout ? 'nowrap' : 'wrap',
            columnGap: 6,
            rowGap: 2,
            fontSize: 8,
            lineHeight: '10px',
            color: 'var(--ra-text-3)'
          }}
        >
          {meterEntries.map((entry) =>
            entry.type === 'mask' ? (
              <span key={`mask-${entry.kind ?? 'reclassified'}`} style={{ whiteSpace: 'nowrap' }}>
                {entry.label}:{' '}
                <button
                  onClick={(e) => {
                    if (reclassifyMenu) {
                      closeReclassifyMenu()
                      return
                    }
                    const rect = e.currentTarget.getBoundingClientRect()
                    setReclassifyMenu({
                      x: rect.left,
                      y: rect.bottom + 4,
                      currentRole:
                        entry.kind !== null
                          ? discoverSlotKindToArrangeRole(entry.kind)
                          : (slot.reclassified?.role ?? null)
                    })
                  }}
                  aria-expanded={reclassifyMenu !== null}
                  aria-label={entry.tooltip}
                  data-tooltip={entry.tooltip}
                  style={{
                    padding: 0,
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    lineHeight: 'inherit',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px dotted var(--ra-text-4)',
                    color: reclassifyMenu ? 'var(--ra-text)' : 'var(--ra-text-2)',
                    cursor: 'pointer'
                  }}
                >
                  {entry.source}
                </button>
              </span>
            ) : (
              <span
                key={`trait-${entry.kind}`}
                data-tooltip={entry.tooltip}
                aria-label={entry.tooltip}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  whiteSpace: 'nowrap'
                }}
              >
                {entry.label}
                {/* CSS cells, not the ▮▯ glyphs: Silkscreen has neither,
                  and a fallback-font glyph would break the pixel look.
                  Grey chrome only -- no new colour. */}
                <span aria-hidden="true" style={{ display: 'inline-flex', gap: 1 }}>
                  {Array.from({ length: MATCH_METER_STEPS }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        width: 3,
                        height: 6,
                        background: i < entry.filled ? 'var(--ra-text-2)' : 'var(--ra-text-4)'
                      }}
                    />
                  ))}
                </span>
              </span>
            )
          )}
        </div>
      )}
    </div>
  )
  // The four rerolls, as icons (2026-09-29). The decorative dice that
  // used to sit here and spin while a roll was in flight is gone:
  // the button that STARTED the roll pulses instead, and the others
  // dim, which says the same thing about the right button.
  const skipButton = (
    <RowIconButton
      gridColumn={at(10).gridColumn}
      tooltip="skip"
      onClick={(e) => {
        setRerollAction('similar')
        onReroll(e.metaKey)
      }}
      disabled={rerolling}
      dimmed={manualWaiting}
      pulsing={rerolling && rerollAction === 'similar'}
    >
      <SkipForward size={12} />
    </RowIconButton>
  )
  const nearbyButton = nearbyAnchor !== null && (
    <RowIconButton
      gridColumn={at(11).gridColumn}
      tooltip="nearby jam"
      buttonRef={nearbyButtonRef}
      onClick={(e) => {
        if (nearbyMenu) {
          closeNearbyMenu()
          return
        }
        const rect = e.currentTarget.getBoundingClientRect()
        setNearbyMenu({ x: rect.left, y: rect.bottom + 4 })
      }}
      state={nearbyMenu ? 'soft' : 'off'}
      ariaExpanded={nearbyMenu !== null}
      disabled={rerolling}
      dimmed={manualWaiting}
    >
      <Compass size={12} />
    </RowIconButton>
  )
  const anyStemButton = (
    <RowIconButton
      gridColumn={at(12).gridColumn}
      tooltip="any stem"
      onClick={(e) => {
        setRerollAction('random')
        onRerollRandom(e.metaKey)
      }}
      disabled={rerolling}
      dimmed={manualWaiting}
      pulsing={rerolling && rerollAction === 'random'}
    >
      <Shuffle size={12} />
    </RowIconButton>
  )
  const duplicateButton = (
    <RowIconButton
      gridColumn={at(13).gridColumn}
      tooltip="duplicate"
      onClick={(e) => onDuplicate(e.metaKey)}
    >
      <Copy size={12} />
    </RowIconButton>
  )
  // 👍 (2026-10-01, the web radio's full-mode row buttons):
  // replaces both the star (direct request, 2026-09-16) and the
  // separate "hold longer" hand. With 👎, the last two tracks of
  // the row, side by side (Elling, 2026-10-01). It TOGGLES
  // the star -- filled ThumbsUp and the star's own
  // `--ra-recording-live` treatment while the stem is starred --
  // and, when it stars, turns hold longer on if it is off
  // (likeRadioSlot). While this row holds, the button takes the
  // padlock-style inverted fill the hand used to, so the one
  // holding row is still visible. Only shown once there's a
  // real stem to like, same guard as mute/solo -- its track stays
  // reserved either way, so nothing shifts.
  // In the radio layout 👍 shows only the star: holding is the bar at the row's left edge there.
  const likeInverted = holding && !radioLayout
  const likeButton = hasStemToActOn && (
    <button
      onClick={onLike}
      // Listen-only with radio off: no star to give and no hold to
      // take, so 👍 does nothing -- dimmed, like any dead control.
      disabled={listenOnlyStars && !radioOn}
      data-tooltip={
        listenOnlyStars && !radioOn
          ? 'listening only, nothing is starred'
          : listenOnlyStars
            ? holding
              ? 'holding · listening only, nothing is starred'
              : 'hold · listening only, nothing is starred'
            : holding
              ? favourited
                ? 'unlike · holding'
                : 'like · holding'
              : favourited
                ? 'unlike'
                : 'like'
      }
      aria-label={listenOnlyStars ? 'hold, listening only' : favourited ? 'unlike' : 'like'}
      aria-pressed={favourited}
      aria-description={holding ? 'holding longer' : undefined}
      style={{
        ...at(14),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        background: likeInverted ? 'var(--ra-text)' : 'var(--ra-bg-row-active)',
        border: `1px solid ${favourited ? 'var(--ra-recording-live)' : likeInverted ? 'var(--ra-text)' : 'var(--ra-border)'}`,
        color: favourited
          ? 'var(--ra-recording-live)'
          : likeInverted
            ? 'var(--ra-bg-frame)'
            : listenOnlyStars && !radioOn
              ? 'var(--ra-text-4)'
              : 'var(--ra-text-2)',
        cursor: listenOnlyStars && !radioOn ? 'default' : 'pointer'
      }}
    >
      <ThumbsUp size={12} weight={favourited ? 'fill' : 'regular'} />
    </button>
  )
  // 👎, CHANGE SOON -- radio's replace-soon (once "change next",
  // renamed with the web radio's row buttons, 2026-10-01): "replace
  // this", on radio's clock instead of now. The LAST track, beside
  // 👍 (Elling, 2026-10-01). Filled while set. Hidden while radio is
  // off -- with `visibility`, so its track stays reserved and 👍
  // never moves -- and greyed on a padlocked row.
  const dislikeButton = (
    <RowIconButton
      gridColumn={at(15).gridColumn}
      tooltip="change soon"
      onClick={onToggleReplaceSoon}
      toggle
      state={radioFlag === 'replace-soon' ? 'soft' : 'off'}
      disabled={slot.locked}
      hidden={!radioOn}
    >
      <ThumbsDown size={12} weight={radioFlag === 'replace-soon' ? 'fill' : 'regular'} />
    </RowIconButton>
  )
  // RADIO'S ROLE TOGGLES (RadioRoleButtons), after 👎 in the radio layout's button line.
  const roleButtons = (
    <RadioRoleButtons
      hookSet={hookSet}
      locked={slot.locked}
      onToggleHook={onToggleHook}
      dug={dug}
      onToggleDig={onToggleDig}
    />
  )
  const popovers = (
    <>
      {nearbyMenu && nearbyAnchor !== null && (
        <DiscoverNearbyPopover
          x={nearbyMenu.x}
          y={nearbyMenu.y}
          startCandidate={nearbyAnchor}
          kinds={slot.kinds}
          soundSource={{ endlesss: soundSourceEndlesss, audioIn: soundSourceAudioIn }}
          onPick={onSwapFromNearby}
          onClose={closeNearbyMenu}
          ignoreRef={nearbyButtonRef}
          creator={nearbyCreator}
        />
      )}
      {reclassifyMenu && slot.candidate && (
        <DiscoverReclassifyPicker
          x={reclassifyMenu.x}
          y={reclassifyMenu.y}
          currentRole={reclassifyMenu.currentRole}
          onPick={onReclassify}
          onClose={closeReclassifyMenu}
          ignoreRef={meterRef}
        />
      )}
      {kindMenu && !slot.locked && (
        <DiscoverKindPicker
          x={kindMenu.x}
          y={kindMenu.y}
          kinds={slot.kinds}
          onChange={onChangeKinds}
          onClose={closeKindMenu}
          ignoreRef={kindButtonRef}
        />
      )}
    </>
  )

  // The breath (see the grid's `background` below for why it is what it is): one expression,
  // read by both layouts.
  const approachBackground =
    radioApproach === null
      ? undefined
      : radioApproach.state === 'held'
        ? 'color-mix(in srgb, var(--ra-bg-row-active), var(--ra-border) calc(var(--discover-breath, 0.5) * 100%))'
        : 'color-mix(in srgb, transparent, var(--ra-bg-row-active) calc(var(--discover-breath, 0.5) * 100%))'

  // THE RADIO LAYOUT (radio view plan Task 7, spec 1.2): the web radio's full-mode row. A button
  // line (m s skip 👍 👎 hook dig, then any stem, nearby, duplicate, kinds and meter, lock,
  // remove) over a full-width waveform carrying the plates. The SAME part constants as the grid,
  // so every button keeps one implementation; a missing conditional part just closes up the flex
  // line. The row's root stays a div in a Fragment with the popovers after it, as in the grid.
  // Its 6px side padding is the playhead overlay's inset in DiscoverPanel: keep them equal.
  if (radioLayout) {
    return (
      <>
        <div
          role="group"
          aria-label={
            plates?.info != null && plates.info.label !== ''
              ? `row ${rowNumber}: ${plates.info.label}`
              : `row ${rowNumber}`
          }
          style={{
            position: 'relative',
            padding: '4px 6px',
            marginBottom: 4,
            background: approachBackground
          }}
        >
          {holding && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                top: 6,
                bottom: 6,
                width: 2,
                background: 'color-mix(in srgb, var(--ra-text) 45%, transparent)',
                pointerEvents: 'none'
              }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20 }}>
            {muteSolo}
            {skipButton}
            {likeButton}
            {dislikeButton}
            <span data-slot="radio-role" style={{ display: 'contents' }}>
              {roleButtons}
            </span>
            <span style={{ marginLeft: 'auto' }} />
            {anyStemButton}
            {nearbyButton}
            {duplicateButton}
            {kindsBlock}
            {lockButton}
            {removeButton}
          </div>
          {waveformCell}
        </div>
        {popovers}
      </>
    )
  }

  return (
    <>
      <div
        style={{
          display: 'grid',
          // 15 tracks, explicit gridColumn on every child below (including
          // conditionally-rendered ones): 1 delete, 2 lock, 3 mute, 4 solo,
          // 5 waveform (1fr), 6 spacer, 7 kind/category label + match
          // meter, 8 spacer, 9 divider, 10 skip (SkipForward, the old
          // "same kind"), 11 nearby jam, 12 any stem, 13 duplicate, 14 👍
          // like, 15 👎 change soon. (Radio's hook and dig, and fold's
          // readout, are the radio layout's: this grid only renders with radio
          // off, radio view plan Task 13.) (2026-10-01, the web radio's row
          // buttons: the star and "hold longer" tracks became one 👍, and
          // 👍/👎 then moved together to the END of the row, after
          // duplicate -- every gridColumn renumbered in one pass each time;
          // the history below uses the numbers of its own day.) Duplicate (direct request, 2026-09-20:
          // "add duplicate channel to discover") was appended as a NEW
          // last track rather than inserted earlier and renumbering
          // everything after it -- this row's own explicit-position
          // discipline (see below) makes a renumber a real risk of an
          // off-by-one somewhere across this many hardcoded gridColumn
          // values, for no real UX benefit over just adding one more
          // track at the end. Mute/solo/favourite moved next to lock and
          // the kind label moved down next to similar/adjacent/random --
          // direct
          // request, 2026-09-17, freeing up much more width for the
          // waveform (now 1fr against only three fixed-width siblings
          // instead of six). Explicit positions matter -- without them, a
          // conditional child that renders NO DOM node (see
          // hasStemToActOn/nearbyAnchor below) makes grid auto-placement
          // shift every LATER item one track left to fill the gap instead
          // of leaving its own column empty, which is exactly the state
          // every freshly-added slot passes through (no candidate/resolved
          // stem yet). Real bug, found in code review.
          // Direct report, 2026-09-17 (screenshot): the last three tracks
          // used to be `auto auto auto` -- fine while every row always
          // rendered all three buttons, but "adjacent" is conditionally
          // rendered (nearbyAnchor !== null), and each slot row is its OWN
          // independent grid (a separate <div> per row, not one shared
          // grid), so an `auto` track's size is computed per-row from
          // ONLY that row's own content. A row missing "adjacent" (e.g. a
          // seedStem-only slot, or one that's never resolved) auto-sizes
          // that column down toward zero, which leaves MORE leftover width
          // for that SAME row's own 1fr waveform/placeholder track to
          // claim -- so its waveform visibly renders wider than every
          // other row's. Fixed pixel widths (matching the old
          // fixed-role-label-width fix for the identical class of bug)
          // make every row's non-1fr tracks identical regardless of which
          // optional buttons happen to render.
          // 2026-09-29, radio controls and the icon row: track 6, once an
          // empty 14px spacer, widened to 18px for "hold longer"; track 11,
          // once the 16px decorative dice, is now 18px for "change next";
          // a new 1px divider track 12 was inserted, so the four rerolls
          // moved from 12-15 (70px text buttons) to 13-16 (18px icon
          // squares). That insert DID renumber every gridColumn after it,
          // done by hand in one pass. Every non-waveform track stays a
          // FIXED pixel width, for the reason above; only the 1fr waveform
          // grows, and it gets all the width the text buttons gave up.
          // The template itself is DISCOVER_ROW_GRID_COLUMNS, shared with
          // the one-playhead overlay above the row list so the two cannot
          // drift apart (2026-09-30).
          gridTemplateColumns: DISCOVER_ROW_GRID_COLUMNS,
          alignItems: 'center',
          columnGap: DISCOVER_ROW_COLUMN_GAP,
          // No horizontal padding: the overlay relies on the rows' column
          // 7 starting where its own does.
          padding: '8px 0',
          // A ROW RADIO IS ABOUT TO CHANGE. The row breathes, slowly,
          // and the red playhead already sweeping it says when -- because
          // a change now lands at the loop top (e5810f4 stages the swap a
          // lap early and the engine applies it at bar 0), so the
          // playhead reaching a loop-top line, or the end of its sweep,
          // IS the moment it happens.
          //
          // Elling, 2026-09-29, after two passes at drawing this as a
          // progress rule with a countdown beside it: "i still don't
          // understand 'this bar'.. i think the fade in and out
          // indication is clear enough that 'something is going to happen
          // on this one soon'" and then "can't it be the red playhead
          // indicator instead of a progress bar? that would streamline
          // the ui". So: no rule, no chip, no words. Both of the things
          // this used to draw are built from something already on screen
          // instead.
          //
          // WHAT IS ACCEPTED HERE, rather than solved: the playhead
          // crosses a loop top every lap (since 2026-09-30 it is one line
          // sweeping several laps, not one per lap), so a change three
          // laps out cannot be read off it as three laps -- the row simply reads "coming" until
          // the lap it lands in. That is the whole intended message.
          // Radio still KNOWS the real number (radioChangeWait above, and
          // @shared/radioApproach, which is still measured and still
          // tested); nothing draws it.
          //
          // LOCKED TO THE MUSIC, since 2026-09-30. The breath used to be a
          // 2600ms CSS animation, kept deliberately unrelated to the tempo
          // and never restarted at the wrap, on the argument that a fade
          // with no beat in it could not be mistaken for something
          // counting. In practice each row's animation started whenever
          // that row began breathing, so two breathing rows drifted in and
          // out of step with each other. Elling: "can the fade be a bit
          // slower, and synchronized across all waves? right now they can
          // be out of sync.. maybe even synced to half the tempo" -- and,
          // given the choice, one full breath (dim -> bright -> dim) every
          // 4 bars. So the breath is now a function of the transport:
          // discoverBreath (@shared/discoverBreath, tested) of the
          // absolute bar count, written once per tick as --discover-breath
          // on the rows' wrapper by the playhead's layout effect (see
          // rowsRef). Every row mixes by the same number, so they move
          // together, and each breath starts dim on a 4-bar line. Still
          // no hard edge: it is cosine-eased at both ends, so it rises and
          // settles rather than ticking, and 4 bars is slower than any
          // beat the playhead is counting. While the transport is stopped
          // it holds still at the midpoint -- a steady half-tint, which
          // still tells armed from held.
          //
          // BACKGROUND, not opacity. discover-slot-working fades the
          // WAVEFORM, and reusing that here would dim audio information
          // for bars at a time and read as "this row is busy" -- the row
          // is not busy, it is next. Chrome carries the message; the stem
          // is left exactly as bright as every other stem. NO HUE: colour
          // is spent on audio only, so both ends of both depths are the
          // panel's own ground and the fills its controls already use.
          //
          // Two depths, luminance only: dimmer while the pick is merely
          // armed (transparent <-> --ra-bg-row-active), brighter once the
          // change is decided and the next wrap is the one
          // (--ra-bg-row-active <-> --ra-border). Same pace either way, so
          // the difference reads as weight rather than as urgency
          // counting down. The 0.5 fallback is the stopped value, for the
          // one frame before the effect has written the variable.
          background: approachBackground,
          borderBottom: '1px solid var(--ra-border-soft)'
        }}
      >
        {removeButton}
        {lockButton}
        {muteSolo}
        {waveformCell}
        <div style={{ gridColumn: 6 }} />
        {kindsBlock}
        <div style={{ gridColumn: 8 }} />
        <div style={{ gridColumn: 9, width: 1, height: 18, background: 'var(--ra-border)' }} />
        {skipButton}
        {nearbyButton}
        {anyStemButton}
        {duplicateButton}
        {likeButton}
        {dislikeButton}
      </div>
      {popovers}
    </>
  )
}
