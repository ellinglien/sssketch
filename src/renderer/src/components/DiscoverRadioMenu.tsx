// src/renderer/src/components/DiscoverRadioMenu.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RADIO_CHANNELS_MAX,
  RADIO_CHANNELS_MIN,
  RADIO_LOOP_END_OPTIONS,
  RADIO_PACE_BARS,
  RADIO_PACE_OPTIONS,
  RADIO_PHRASE_OPTIONS,
  adjustRadioPaceWindow,
  radioPaceWindowPreset,
  type RadioPace,
  type RadioSettings
} from '@shared/radioSchedule'
import {
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES,
  toggleTurnaroundFamily
} from '@shared/radioTurnaround'
import { RADIO_DENSITY_OPTIONS, radioDensityOf } from '@shared/radioSchedule'
import { RADIO_TRANSITIONS_OPTIONS } from '@shared/radioTransition'

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
 *                PROMPT: picking one starts radio. Channels sits beside it
 *                because it is the other thing decided at the starting
 *                moment (it sizes the bed radio lays down), and nothing
 *                else is shown, because nothing else is a starting
 *                decision. No OK button -- the pace chip IS the commit,
 *                and Escape or a click outside cancels.
 *   `running` -- radio is on and the chevron was pressed. Everything is
 *                here, and a pace chip is now a COURSE CHANGE: it resets
 *                the clock and rerolls the whole unlocked bed on the next
 *                loop top (see DiscoverPanel's armRadioCourseChange).
 *
 * The pace chips MOVED here from the actions row, which is the argument
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
  onPace,
  onNewBed,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  mode: 'start' | 'running'
  settings: RadioSettings
  onChange: (patch: Partial<RadioSettings>) => void
  /** A pace CHIP, which is not an ordinary setting write: in `start` it
   * starts radio, in `running` it is the dramatic course change. The panel
   * owns both, so this only reports the chip. */
  onPace: (pace: RadioPace) => void
  /** Reroll every unlocked layer, landing together at the next loop top.
   * Separate from a pace change on purpose: changing how often a layer
   * turns over is not a request for different music. */
  onNewBed: () => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

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

  /** One edge of the pace window, as a value between two steppers.
   *
   * Elling, 2026-09-28: "maybe allow for a specific range selection
   * instead of just slow mid and fast?". Steppers rather than a slider or
   * a number field because the range is 1..64 -- too many for chips, and a
   * drag cannot land on an exact bar count, which is the whole thing he
   * asked for. Stepping an edge is deliberately NOT a course change: a
   * reset per keypress while settling a number would be unusable. */
  function stepper(edge: 'min' | 'max'): React.JSX.Element {
    function step(delta: number): void {
      onChange({ paceBars: adjustRadioPaceWindow(settings.paceBars, edge, delta) })
    }
    function arrow(label: string, delta: number, tooltip: string): React.JSX.Element {
      return (
        <button
          onClick={() => step(delta)}
          data-tooltip={tooltip}
          aria-label={tooltip}
          style={{
            fontFamily: 'inherit',
            fontSize: 9,
            width: 16,
            padding: 'var(--ra-s-0) 0',
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          {label}
        </button>
      )
    }
    return (
      <span key={edge} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {arrow('-', -1, `${edge} down`)}
        <span style={{ fontSize: 9, minWidth: 16, textAlign: 'center', color: 'var(--ra-text)' }}>
          {settings.paceBars[edge]}
        </span>
        {arrow('+', 1, `${edge} up`)}
      </span>
    )
  }

  // Lit from the WINDOW, not from the stored preset -- once he steps an
  // edge the window is no longer `mid`, and a chip still claiming to be
  // would be lying about what the clock is drawing from.
  const activePreset = radioPaceWindowPreset(settings.paceBars)
  const paceRow = row(
    'pace',
    RADIO_PACE_OPTIONS.map((p) =>
      chip(p, activePreset === p, () => {
        // Sets the window too: a preset IS its window, and the point of
        // pressing one is to go back to a known place.
        onChange({ pace: p, paceBars: { ...RADIO_PACE_BARS[p] } })
        onPace(p)
      })
    )
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
      {mode === 'running' && row('bars', [stepper('min'), stepper('max')])}
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
      {mode === 'running' && row('reroll', [chip('new bed', false, onNewBed)])}
      {/* maxWidth, not a wider menu: the chip rows set the width and the
          hint wraps inside it. Without it this span is one long line and
          the menu grows to fit it. */}
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)', maxWidth: 260 }}>
        {mode === 'start'
          ? 'pick a pace to start'
          : 'a new pace restarts the loop, keeping these stems. a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle. phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started. transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop. density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added. turnarounds mark the end of each phrase'}
      </span>
    </div>
  )
}
