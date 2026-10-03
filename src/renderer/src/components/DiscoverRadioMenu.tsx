// src/renderer/src/components/DiscoverRadioMenu.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RADIO_CHANNELS_MAX,
  RADIO_CHANNELS_MIN,
  RADIO_LOOP_END_OPTIONS,
  RADIO_PHRASE_OPTIONS,
  radioPaceLevelOf,
  type RadioSettings
} from '@shared/radioSchedule'
import { RADIO_PACE_LABEL, RADIO_PACE_TOOLTIP, radioPaceLabel } from '@shared/radioPace'
import {
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES,
  toggleTurnaroundFamily
} from '@shared/radioTurnaround'
import { RADIO_DENSITY_OPTIONS, radioDensityOf, radioFavesOf } from '@shared/radioSchedule'
import { FAVES_LABEL, FAVES_TOOLTIP } from '@shared/discoverFaves'
import { RADIO_TRANSITIONS_OPTIONS } from '@shared/radioTransition'
import { FOLD_SEED_TEXT_MAX, cleanFoldSeed, newFoldSeed } from '@shared/radioFold'

/** A fold fader, 0..100. Local while dragging, and committed (persisted) only when the drag or
 * key press ends: every step of a drag would otherwise write the settings file. */
function FoldSlider({
  label,
  value,
  onCommit
}: {
  label: string
  value: number
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        aria-label={label}
        value={draft ?? value}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        style={{ width: 96, accentColor: 'var(--ra-text)' }}
      />
      <span style={{ fontSize: 9, minWidth: 20, textAlign: 'right', color: 'var(--ra-text)' }}>
        {draft ?? value}
      </span>
    </span>
  )
}

/** The pace slider (@shared/radioPace, spec 2026-10-03-radio-pace-slider-design), 0..100, with
 * its readout in words (slow, mid, fast, ludicrous) or bars -- in fold mode, fold's own window in
 * bars below 80 (radioPaceLabel's `fold`). Like FoldSlider it is local while
 * dragging and commits only when the drag or key press ends -- one decision, one settings write,
 * and in a running radio one radioClockForPace. `onDraft` reports the position as it moves, for
 * the start chip, which starts at wherever the slider is even before a release has persisted. */
function PaceSlider({
  value,
  fold,
  onCommit,
  onDraft
}: {
  value: number
  /** Fold mode is on: below 80 the readout names fold's own window (`8-32 bars`). */
  fold: boolean
  onCommit: (v: number) => void
  onDraft?: (v: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  const shown = draft ?? value
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        aria-label={RADIO_PACE_LABEL}
        aria-valuetext={radioPaceLabel(shown, { fold })}
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDraft(v)
          onDraft?.(v)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        style={{ width: 96, accentColor: 'var(--ra-text)' }}
      />
      <span style={{ fontSize: 9, minWidth: 64, color: 'var(--ra-text)' }}>
        {radioPaceLabel(shown, { fold })}
      </span>
    </span>
  )
}

/** The fold seed: any text (v2, cleanFoldSeed), typed or pasted, committed on enter or when
 * focus leaves. A box left empty goes back to the seed in use. */
function FoldSeedInput({
  value,
  onCommit
}: {
  value: string
  onCommit: (seed: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft !== null) {
      // the same cleaning as normalizeFoldSeed, but nothing falls back to the default here
      const kept = cleanFoldSeed(draft)
      if (kept !== null && kept !== value) onCommit(kept)
    }
    setDraft(null)
  }
  return (
    <input
      key="seed"
      aria-label="fold seed"
      value={draft ?? value}
      maxLength={FOLD_SEED_TEXT_MAX}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      onBlur={commit}
      style={{
        fontFamily: 'inherit',
        fontSize: 9,
        width: 84,
        padding: 'var(--ra-s-0) 4px',
        background: 'transparent',
        border: '1px solid var(--ra-border)',
        color: 'var(--ra-text)'
      }}
    />
  )
}

const CHANNEL_OPTIONS: number[] = Array.from(
  { length: RADIO_CHANNELS_MAX - RADIO_CHANNELS_MIN + 1 },
  (_, i) => RADIO_CHANNELS_MIN + i
)

/** The `loop end` row's chips. The number is the longest a layer may be
 * and still turn over on its own cycle, so 0 -- no layer is shorter than
 * that -- is every layer waiting for the loop top, which is what the old
 * `change on: loop end` chip did. */
function loopEndLabel(bars: number): string {
  return bars === 0 ? 'always' : `${bars} bars`
}

/** The `phrase` row's chips. The CEILING, where `loop end` above is the
 * floor: 0 is no phrase grid at all, which is every boundary the loop
 * itself offers and is what shipped. */
function phraseLabel(bars: number): string {
  return bars === 0 ? 'loop' : `${bars} bars`
}

/** Radio's own controls, behind the radio button rather than spread across
 * the Discover screen -- Elling set that constraint himself: radio stays
 * something you press and listen to. Position, dismissal and chip styling
 * all mirror DiscoverKindPicker.tsx exactly.
 *
 * TWO MODES, from one direct instruction (2026-09-28): "the initial prompt
 * should be slow mid fast so the app knows how to start everything.
 * otherwise changing course should reset the whole thing."
 *
 *   `start`   -- radio is off and the button was pressed. Pace is a
 *                PROMPT: the slider and a `start` chip, which starts radio
 *                at the slider's position (2026-10-03; three chips did it
 *                before the slider). Channels sits beside it because it is
 *                the other thing decided at the starting moment (it sizes
 *                the bed radio lays down). Escape or a click outside
 *                cancels.
 *   `running` -- radio is on and the chevron was pressed. Everything is
 *                here. The pace slider is NOT a course change (it was a
 *                chip that reset the clock and re-triggered the bed until
 *                2026-10-03): it is heard from the next interval and takes
 *                nothing back (DiscoverPanel's pace effect).
 *
 * The pace control MOVED here from the actions row, which is the argument
 * for this menu existing at all rather than just being somewhere to put
 * new things: the row used to grow three chips whenever radio was on and
 * now grows one chevron. The row gets simpler as the feature gets richer.
 *
 * `channels` is chips rather than the literal slider Elling asked for:
 * five values, two characters each, is smaller and more precise than a
 * drag and it matches every other row. It sets what radio STARTS with,
 * never what Discover allows -- there is no cap on addSlot and none is
 * being added.
 *
 * `loop end` and `phrase` are two rows for two different questions and
 * are deliberately not one row. `loop end` is the SMALLEST boundary a
 * change may land on and is capped at the loop; `phrase` is the largest,
 * and it is the only thing that can hold a change past a loop top. A
 * single row would have to answer both with one number and could not.
 *
 * `transitions` and `turnover` are stored in RadioSettings but have NO ROW
 * here yet, deliberately: nothing reads either field until phases D and E,
 * and a chip that visibly does nothing is worse than a chip that is not
 * there. Each is one row of this file away when its phase lands. */
export function DiscoverRadioMenu({
  x,
  y,
  mode,
  settings,
  onChange,
  onStart,
  onNewBed,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  mode: 'start' | 'running'
  settings: RadioSettings
  onChange: (patch: Partial<RadioSettings>) => void
  /** The start prompt's `start` chip: radio starts at this pace level (the slider's position,
   * which may not have persisted yet -- the panel must not read it back from settings). */
  onStart: (level: number) => void
  /** Reroll every unlocked layer, landing together at the next loop top.
   * Separate from a pace change on purpose: changing how often a layer
   * turns over is not a request for different music. */
  onNewBed: () => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  // Where the pace slider is, for the start chip: the draft while dragging, else the setting.
  const [paceDraft, setPaceDraft] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    // Escape closes ONLY this menu: capture phase, propagation stopped, so
    // LibraryBrowser's window-level Escape (close the whole library) never
    // sees it.
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose, ignoreRef])

  function chip(label: string, on: boolean, onClick: () => void): React.JSX.Element {
    return (
      <button
        key={label}
        aria-pressed={on}
        onClick={onClick}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: 'var(--ra-s-0) 8px',
          background: on ? 'var(--ra-bg-row-active)' : 'transparent',
          border: `1px solid ${on ? 'var(--ra-text)' : 'var(--ra-border)'}`,
          color: on ? 'var(--ra-text)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        {label}
      </button>
    )
  }

  function row(label: string, chips: React.JSX.Element[], tooltip?: string): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          data-tooltip={tooltip}
          style={{
            // Fits the longest label, `turnarounds`, with room before its chips.
            width: 92,
            flexShrink: 0,
            fontSize: 9,
            color: 'var(--ra-text-3)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ra-track-eyebrow)'
          }}
        >
          {label}
        </span>
        {chips}
      </div>
    )
  }

  // THE PACE SLIDER (2026-10-03) replaces the slow / mid / fast chips and the min / max bar
  // steppers: one value, 0..100, whose readout says slow, mid, fast or ludicrous at those
  // positions and the bars between. Committed on release. While radio runs it is NOT a course
  // change any more: it is heard from the next interval (sooner when moved faster), and takes
  // nothing back (DiscoverPanel's pace effect, radioClockForPace). In the start prompt a `start`
  // chip beside it starts radio at the slider's position.
  const paceLevel = radioPaceLevelOf(settings)
  const paceRow = row(
    RADIO_PACE_LABEL,
    [
      <PaceSlider
        key="pace"
        value={paceLevel}
        fold={settings.foldMode}
        onCommit={(v) => onChange({ paceLevel: v })}
        onDraft={setPaceDraft}
      />,
      ...(mode === 'start'
        ? [
            chip('start', false, () => {
              const level = paceDraft ?? paceLevel
              // Written only when it moved: the slider's own release usually persisted it already.
              if (level !== settings.paceLevel) onChange({ paceLevel: level })
              onStart(level)
            })
          ]
        : [])
    ],
    RADIO_PACE_TOOLTIP
  )
  // `density: arc` (2026-10-01, @shared/radioDensity) grows and thins the
  // rows itself, starting from two on an empty panel, so `channels` -- the
  // size of the starting bed -- only shows while the arc is off.
  const density = radioDensityOf(settings)
  const densityRow = row(
    'density',
    RADIO_DENSITY_OPTIONS.map((d) => chip(d, density === d, () => onChange({ density: d })))
  )
  const channelsRow =
    density === 'off'
      ? row(
          'channels',
          CHANNEL_OPTIONS.map((n) =>
            chip(String(n), settings.channels === n, () => onChange({ channels: n }))
          )
        )
      : null

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="radio settings"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      {paceRow}
      {mode === 'running' &&
        row(
          'loop end',
          RADIO_LOOP_END_OPTIONS.map((n) =>
            chip(loopEndLabel(n), settings.loopEndOverBars === n, () =>
              onChange({ loopEndOverBars: n })
            )
          )
        )}
      {mode === 'running' &&
        row(
          'phrase',
          RADIO_PHRASE_OPTIONS.map((n) =>
            chip(phraseLabel(n), settings.phraseBars === n, () => onChange({ phraseBars: n }))
          )
        )}
      {densityRow}
      {channelsRow}
      {/* The drop-outs row, renamed (2026-10-02, @shared/radioTurnaround): how often a phrase
          end gets a turnaround -- a drop, a wash, a filter move or a riser. */}
      {mode === 'running' &&
        row(
          'turnarounds',
          RADIO_TURNAROUNDS_OPTIONS.map((d) =>
            chip(d, settings.turnarounds === d, () => onChange({ turnarounds: d }))
          ),
          'end of phrase'
        )}
      {/* The turnarounds' controls (spec section 4a), only while they are on: which families a
          phrase end may draw (none is off) and how deep they go. */}
      {mode === 'running' &&
        settings.turnarounds !== 'off' &&
        row(
          'moves',
          TURNAROUND_FAMILIES.map((f) =>
            chip(f, settings.turnaroundMoves.includes(f), () =>
              onChange({ turnaroundMoves: toggleTurnaroundFamily(settings.turnaroundMoves, f) })
            )
          ),
          'which moves'
        )}
      {mode === 'running' &&
        settings.turnarounds !== 'off' &&
        row(
          'depth',
          TURNAROUND_DEPTH_OPTIONS.map((d) =>
            chip(d, settings.turnaroundDepth === d, () => onChange({ turnaroundDepth: d }))
          ),
          'how far'
        )}
      {/* The field shipped with the settings object on 2026-09-28 and had
          no row until phase E, deliberately: a chip for something nothing
          reads is a lie. Now it is read (DiscoverPanel's pickTransition)
          and this is its control. A TEMPERAMENT, not a list of moves --
          the changing layer's own kinds pick which move inside it, so
          there is no grid to fill in. */}
      {mode === 'running' &&
        row(
          'transitions',
          RADIO_TRANSITIONS_OPTIONS.map((t) =>
            chip(t, settings.transitions === t, () => onChange({ transitions: t }))
          )
        )}
      {/* The faves dial (@shared/discoverFaves): the same value as Discover's dial -- how often
          a pick is drawn only from starred stems, and how much the rest lean to them. A fader
          like bend's, committed on release so a drag writes the settings once. */}
      {mode === 'running' &&
        row(
          FAVES_LABEL,
          [
            <FoldSlider
              key="faves"
              label={FAVES_LABEL}
              value={radioFavesOf(settings)}
              onCommit={(v) => onChange({ faves: v })}
            />
          ],
          FAVES_TOOLTIP
        )}
      {/* Fold mode (@shared/radioFold): one anchor at full length, one or two short rhythmic
          rows looping at odd lengths against it and realigning every 30-120 s; seeded rules, so
          a seed replays them. Only meaningful while radio runs, so only shown then. */}
      {mode === 'running' &&
        row(
          'fold',
          [
            chip('off', !settings.foldMode, () => onChange({ foldMode: false })),
            chip('on', settings.foldMode, () => onChange({ foldMode: true }))
          ],
          'layers in other time signatures'
        )}
      {/* Renamed (v2, 2026-10-03): `how folded` is bend, `clash` mismatch; the settings keep
          `fold` and `clash`, so a saved file still reads. The tooltips are longer than this
          menu's usual two or three words: Elling asked for the explanation. */}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'bend',
          [
            <FoldSlider
              key="fold"
              label="bend"
              value={settings.fold}
              onCommit={(v) => onChange({ fold: v })}
            />
          ],
          'how far layers bend off the beat'
        )}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'mismatch',
          [
            <FoldSlider
              key="clash"
              label="mismatch"
              value={settings.clash}
              onCommit={(v) => onChange({ clash: v })}
            />
          ],
          'how unlike the rest new layers are'
        )}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'seed',
          [
            <FoldSeedInput
              key="seed"
              value={settings.foldSeed}
              onCommit={(seed) => onChange({ foldSeed: seed })}
            />,
            chip('new', false, () => onChange({ foldSeed: newFoldSeed() }))
          ],
          'same seed, same folding. any text'
        )}
      {mode === 'running' && row('reroll', [chip('new bed', false, onNewBed)])}
      {/* maxWidth, not a wider menu: the chip rows set the width and the
          hint wraps inside it. Without it this span is one long line and
          the menu grows to fit it. */}
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)', maxWidth: 260 }}>
        {mode === 'start'
          ? 'set a pace and start'
          : 'pace is heard from the next change, and takes nothing back. above fast the phrase shortens, and from 71 changes may come at every loop top. from 80 changes may land mid-loop on bar lines, every 4, 2 or 1 bars, as cuts, long layers included. above 70 a change may turn over more than one row, up to four at 100, all landing together. below that, a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle. phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started. transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop. density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added. turnarounds mark the end of each phrase. fold loops one or two short layers at odd lengths against the beat, and changes come every 8 to 32 bars while it is on'}
      </span>
    </div>
  )
}
