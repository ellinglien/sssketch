// src/renderer/src/components/DiscoverRadioMenu.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RADIO_CHANNELS_MAX,
  RADIO_CHANNELS_MIN,
  RADIO_GRID_OPTIONS,
  RADIO_PACE_BARS,
  RADIO_PACE_OPTIONS,
  adjustRadioPaceWindow,
  radioPaceWindowPreset,
  type RadioPace,
  type RadioSettings
} from '@shared/radioSchedule'
import { RADIO_DROP_OUT_OPTIONS } from '@shared/radioDropOut'

const CHANNEL_OPTIONS: number[] = Array.from(
  { length: RADIO_CHANNELS_MAX - RADIO_CHANNELS_MIN + 1 },
  (_, i) => RADIO_CHANNELS_MIN + i
)

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
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
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

  function row(label: string, chips: React.JSX.Element[]): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 76,
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
  const channelsRow = row(
    'channels',
    CHANNEL_OPTIONS.map((n) =>
      chip(String(n), settings.channels === n, () => onChange({ channels: n }))
    )
  )

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
          'change on',
          RADIO_GRID_OPTIONS.map((g) => chip(g, settings.grid === g, () => onChange({ grid: g })))
        )}
      {channelsRow}
      {mode === 'running' &&
        row(
          'drop-outs',
          RADIO_DROP_OUT_OPTIONS.map((d) =>
            chip(d, settings.dropOuts === d, () => onChange({ dropOuts: d }))
          )
        )}
      {mode === 'running' && row('reroll', [chip('new bed', false, onNewBed)])}
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        {mode === 'start'
          ? 'pick a pace to start'
          : 'a new pace restarts the loop, keeping these stems'}
      </span>
    </div>
  )
}
