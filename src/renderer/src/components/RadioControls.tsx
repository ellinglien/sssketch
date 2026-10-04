// src/renderer/src/components/RadioControls.tsx
//
// Radio's controls, shared by the start prompt (RadioStartPrompt) and the radio
// view's strip (spec 2026-10-03-sssketch-radio-view-design). Values and callbacks only: no
// state here outlives a gesture, and nothing reads the panel.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RADIO_PACE_LABEL, radioPaceLabel } from '@shared/radioPace'
import { FOLD_SEED_TEXT_MAX, cleanFoldSeed } from '@shared/radioFold'
import { segmentBarFills, segmentBarKey, segmentBarValueAt } from '@shared/radioSegmentBar'
import { Dial } from './Dial'
import { dialValueAfterWheel } from './dialMath'
import { suppressNextSyntheticClick } from './dragUtils'

/** Width of a range slider unless the caller says otherwise: the menu's. The strip passes 72. */
const RANGE_WIDTH = 96

/** A fold fader, 0..100. Local while dragging, and committed (persisted) only when the drag or
 * key press ends: every step of a drag would otherwise write the settings file.
 *
 * A pointer gesture lets go of focus when it ends (spec 1.3): a range input keeps focus after a
 * drag and swallows the page's keys (`t`, the arrows) until something else is clicked. A Tab
 * focus is kept, so the keyboard still works the slider. */
export function FoldSlider({
  label,
  value,
  onCommit,
  width = RANGE_WIDTH
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  width?: number
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  // The draft as of the last event, read by commit: blur() below fires onBlur synchronously,
  // inside the same handler, with this render's `draft` still in its closure -- a commit reading
  // the state would commit twice. Reading and clearing the ref makes the second one a no-op.
  const draftRef = useRef<number | null>(null)
  const pointerRef = useRef(false)
  const commit = (): void => {
    const d = draftRef.current
    draftRef.current = null
    if (d !== null && d !== value) onCommit(d)
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
        onChange={(e) => {
          const v = Number(e.target.value)
          draftRef.current = v
          setDraft(v)
        }}
        onPointerDown={() => {
          pointerRef.current = true
        }}
        onPointerUp={(e) => {
          commit()
          if (pointerRef.current) {
            pointerRef.current = false
            e.currentTarget.blur()
          }
        }}
        onKeyUp={commit}
        onBlur={commit}
        style={{ width, accentColor: 'var(--ra-text)' }}
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
 * the start chip, which starts at wherever the slider is even before a release has persisted.
 * Like FoldSlider it lets go of focus after a pointer gesture, never after a Tab. */
export function PaceSlider({
  value,
  fold,
  onCommit,
  onDraft,
  width = RANGE_WIDTH
}: {
  value: number
  /** Fold mode is on: below 80 the readout names fold's own window (`8-32 bars`). */
  fold: boolean
  onCommit: (v: number) => void
  onDraft?: (v: number) => void
  width?: number
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  // The draft as of the last event, read by commit: blur() below fires onBlur synchronously,
  // inside the same handler, with this render's `draft` still in its closure -- a commit reading
  // the state would commit twice. Reading and clearing the ref makes the second one a no-op.
  const draftRef = useRef<number | null>(null)
  const pointerRef = useRef(false)
  const commit = (): void => {
    const d = draftRef.current
    draftRef.current = null
    if (d !== null && d !== value) onCommit(d)
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
          draftRef.current = v
          setDraft(v)
          onDraft?.(v)
        }}
        onPointerDown={() => {
          pointerRef.current = true
        }}
        onPointerUp={(e) => {
          commit()
          if (pointerRef.current) {
            pointerRef.current = false
            e.currentTarget.blur()
          }
        }}
        onKeyUp={commit}
        onBlur={commit}
        style={{ width, accentColor: 'var(--ra-text)' }}
      />
      <span style={{ fontSize: 9, minWidth: 64, color: 'var(--ra-text)' }}>
        {radioPaceLabel(shown, { fold })}
      </span>
    </span>
  )
}

/** The fold seed: any text (v2, cleanFoldSeed), typed or pasted, committed on enter or when
 * focus leaves. A box left empty goes back to the seed in use.
 *
 * Escape reverts the box and stops THERE: React's stopPropagation stops the native event at the
 * React root, before LibraryBrowser's window-level Escape (which closes the whole library) and
 * App's window shortcuts (the seed field lives in the strip, which has no Escape of its own). */
export function FoldSeedInput({
  value,
  onCommit
}: {
  value: string
  onCommit: (seed: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  // As the sliders' draftRef: Escape's blur() fires onBlur in the same handler, before the
  // reverted state renders, so commit reads the ref, which Escape has already cleared.
  const draftRef = useRef<string | null>(null)
  const commit = (): void => {
    const d = draftRef.current
    draftRef.current = null
    if (d !== null) {
      // the same cleaning as normalizeFoldSeed, but nothing falls back to the default here
      const kept = cleanFoldSeed(d)
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
      onChange={(e) => {
        draftRef.current = e.target.value
        setDraft(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          e.stopPropagation()
          // reverted first, so the blur's commit finds nothing to commit
          draftRef.current = null
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
      onBlur={commit}
      style={{
        fontFamily: 'inherit',
        fontSize: 'var(--ra-fs-10)',
        flex: 1,
        minWidth: 0,
        height: 'var(--ra-h-control)',
        padding: '0 var(--ra-s-2)',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        color: 'var(--ra-text)'
      }}
    />
  )
}

// ---------------------------------------------------------------------------------------------
// The strip's widgets (RadioStrip, plan Task 8). Monochrome, sharp corners, the app's font.

/** A chip: the old radio menu's, as a component. `dimmed` draws faint ink (the turn chips'
 * `not now`); `disabled` is the browser's. */
export function StripChip({
  label,
  on,
  onClick,
  tooltip,
  dimmed = false,
  disabled = false
}: {
  label: string
  on: boolean
  onClick: () => void
  tooltip?: string
  dimmed?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const ink = dimmed ? 'var(--ra-text-4)' : on ? 'var(--ra-text)' : 'var(--ra-text-2)'
  return (
    <button
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
      data-tooltip={tooltip}
      style={{
        fontFamily: 'inherit',
        fontSize: 9,
        padding: 'var(--ra-s-0) 8px',
        background: on ? 'var(--ra-bg-row-active)' : 'transparent',
        border: `1px solid ${on ? 'var(--ra-text)' : 'var(--ra-border)'}`,
        color: ink,
        cursor: disabled ? 'default' : 'pointer'
      }}
    >
      {label}
    </button>
  )
}

/** One button reading `fold: on` / `fold: off`: a mode switch whose state is a word. */
export function StripWordSwitch({
  label,
  on,
  onChange,
  tooltip
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
  tooltip?: string
}): React.JSX.Element {
  return (
    <button
      aria-pressed={on}
      aria-label={`${label} mode`}
      onClick={() => onChange(!on)}
      data-tooltip={tooltip}
      style={{
        fontFamily: 'inherit',
        fontSize: 9,
        padding: 'var(--ra-s-0) 8px',
        background: 'transparent',
        border: '1px solid var(--ra-border)',
        color: 'var(--ra-text-2)',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      {label}:{' '}
      <span style={{ color: on ? 'var(--ra-text)' : 'var(--ra-text-3)' }}>{on ? 'on' : 'off'}</span>
    </button>
  )
}

/** A small Dial with its caption to the right, on one line. `before` / `after` are the source
 * dial's end captions (`endlesss` / `other`); `dimmed` is the add row's faves treatment. */
export function StripDial({
  label,
  value,
  onChange,
  onCommit,
  defaultValue,
  tooltip,
  disabled = false,
  dimmed = false,
  before,
  after,
  ariaLabel = label
}: {
  label: string
  value: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  defaultValue: number
  tooltip?: string
  disabled?: boolean
  dimmed?: boolean
  before?: ReactNode
  after?: ReactNode
  /** When the caption alone is not a good name (the master dials: `master level`). */
  ariaLabel?: string
}): React.JSX.Element {
  const caption = { fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' } as const
  return (
    <span
      data-tooltip={tooltip}
      style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: dimmed ? 0.4 : 1 }}
    >
      {/* With end captions the label leads (`source endlesss ◑ other`), else it follows. */}
      {before !== undefined && <span style={caption}>{label}</span>}
      {before !== undefined && <span style={caption}>{before}</span>}
      <Dial
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        defaultValue={defaultValue}
        size={22}
        ariaLabel={ariaLabel}
        disabled={disabled}
      />
      {after !== undefined && <span style={caption}>{after}</span>}
      {before === undefined && <span style={caption}>{label}</span>}
    </span>
  )
}

/** One captioned group of the strip (play, picks, shape, fold, sound, mix). Wraps inside itself
 * so a narrow window never scrolls sideways. */
export function StripGroup({
  caption,
  children
}: {
  caption: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={caption}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 10px',
        minWidth: 0,
        maxWidth: '100%'
      }}
    >
      <span style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-4)' }}>{caption}</span>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The control language (radio view design pass 2026-10-04, plan Task 5): one segment bar for
// every 0-100 value, one segmented row for every choice, dashed fire buttons, action buttons.
// Monochrome, sharp corners, tokens only. Unused until the view's tasks wire them in.

export type ControlSize = 'live' | 'control'

const sizeHeight = (size: ControlSize): string =>
  size === 'live' ? 'var(--ra-h-live)' : 'var(--ra-h-control)'

/** The label/readout header every control has, over its control. `dimmed` is StripDial's 0.4
 * (faves in artist mode: dimmed but live). */
export function ControlField({
  label,
  readout,
  tooltip,
  disabled = false,
  dimmed = false,
  live = false,
  children
}: {
  label: string
  readout?: ReactNode
  tooltip?: string
  disabled?: boolean
  dimmed?: boolean
  /** In the live bar the readout is `--ra-text`, not `--ra-text-2`. */
  live?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ra-s-1)',
        minWidth: 0,
        opacity: disabled ? 'var(--ra-opacity-disabled)' : dimmed ? 0.4 : 1
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--ra-s-2)',
          fontSize: 'var(--ra-fs-9)'
        }}
      >
        <span data-tooltip={tooltip} style={{ color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {readout !== undefined && (
          <span style={{ color: live ? 'var(--ra-text)' : 'var(--ra-text-2)' }}>{readout}</span>
        )}
      </div>
      {children}
    </div>
  )
}

/** The wheel commits this long after the last notch, as Dial's does. */
const WHEEL_COMMIT_DELAY_MS = 200

/** A 0-100 value as cells (`cells`, default 10), at full resolution: the last lit cell is
 * partly filled. Press or drag sets the value under the pointer to 1; the wheel moves it as a
 * Dial does; arrows move it 1 (Shift 10), PageUp/PageDown 10, Home/End the ends; double-click
 * resets to `defaultValue`.
 *
 * `onChange` is the live half (every move, a preview), `onCommit` the finished gesture (pointer
 * up, a key, a double-click, 200ms after the last wheel notch). A caller whose onChange is
 * already the commit passes no onCommit. `onDraft` reports the position as it moves, for a
 * caller that wants it before any commit (the start chip). The gesture is self-contained, as
 * Dial's is: preventDefault + stopPropagation at press, suppressNextSyntheticClick after a turn,
 * and a pointer gesture lets go of focus when it ends (a Tab focus is kept). */
export function SegmentBar({
  label,
  value,
  onChange,
  onCommit,
  onDraft,
  defaultValue,
  cells = 10,
  size,
  disabled = false,
  ariaValueText,
  tooltip,
  cellHeight
}: {
  label: string
  value: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  onDraft?: (value: number) => void
  defaultValue: number
  cells?: number
  /** A cell height other than the size's (the start prompt's bar is --ra-h-control tall). */
  cellHeight?: string
  size: ControlSize
  disabled?: boolean
  ariaValueText?: string
  tooltip?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const dragRef = useRef<{ startValue: number; latest: number } | null>(null)
  const latest = useRef({ value, onChange, onCommit, disabled })
  useEffect(() => {
    latest.current = { value, onChange, onCommit, disabled }
  }, [value, onChange, onCommit, disabled])
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The value a wheel burst has reached: `value` only catches up once the caller re-renders.
  const wheelValueRef = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    function handleWheel(e: WheelEvent): void {
      if (latest.current.disabled) return
      e.preventDefault()
      e.stopPropagation()
      const from = wheelValueRef.current ?? latest.current.value
      const next = dialValueAfterWheel(from, e.deltaY)
      if (next === from) return
      wheelValueRef.current = next
      latest.current.onChange(next)
      if (wheelTimerRef.current !== null) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(() => {
        wheelTimerRef.current = null
        wheelValueRef.current = null
        latest.current.onCommit?.(next)
      }, WHEEL_COMMIT_DELAY_MS)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      if (wheelTimerRef.current !== null) clearTimeout(wheelTimerRef.current)
    }
  }, [])

  const valueAt = (e: React.PointerEvent<HTMLDivElement>): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return segmentBarValueAt(e.clientX - r.left, r.width)
  }
  const move = (next: number): void => {
    const drag = dragRef.current
    if (!drag || next === drag.latest) return
    drag.latest = next
    setDraft(next)
    onChange(next)
    onDraft?.(next)
  }
  /** Ends the turn from wherever the browser says it ended; commits only one that moved. */
  const endDrag = (el: HTMLDivElement | null): void => {
    const drag = dragRef.current
    dragRef.current = null
    setDraft(null)
    if (!drag) return
    el?.blur()
    if (drag.latest === drag.startValue) return
    suppressNextSyntheticClick()
    onCommit?.(drag.latest)
  }

  const shown = draft ?? value
  const fills = segmentBarFills(shown, cells)
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      aria-valuetext={ariaValueText}
      data-tooltip={tooltip}
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled) return
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startValue: value, latest: value }
        move(valueAt(e))
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onPointerMove={(e) => {
        if (dragRef.current && !disabled) move(valueAt(e))
      }}
      onPointerUp={(e) => endDrag(e.currentTarget)}
      onPointerCancel={(e) => endDrag(e.currentTarget)}
      onLostPointerCapture={(e) => endDrag(e.currentTarget)}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (disabled || value === defaultValue) return
        onChange(defaultValue)
        onCommit?.(defaultValue)
      }}
      onKeyDown={(e) => {
        if (disabled) return
        const next = segmentBarKey(value, e.key, e.shiftKey)
        if (next === null) return
        e.preventDefault()
        onChange(next)
        // A key press is its own finished gesture: one step, one commit.
        onCommit?.(next)
      }}
      style={{
        display: 'flex',
        gap: 2,
        height: cellHeight ?? (size === 'live' ? 'var(--ra-h-live)' : 'var(--ra-s-6)'),
        opacity: disabled ? 'var(--ra-opacity-disabled)' : 1,
        cursor: disabled ? 'default' : 'ew-resize',
        touchAction: 'none'
      }}
    >
      {fills.map((fill, i) => (
        <div key={i} style={{ flex: 1, background: 'var(--ra-border)' }}>
          <div style={{ width: `${fill * 100}%`, height: '100%', background: 'var(--ra-text)' }} />
        </div>
      ))}
    </div>
  )
}

/** A row of equal-width choices, single or multi. Selected is the filled `--ra-text` block with
 * dark ink, everywhere. */
export function Segmented({
  options,
  size,
  disabled = false,
  multi = false,
  ariaLabel
}: {
  options: { label: string; on: boolean; onClick: () => void; tooltip?: string }[]
  size: ControlSize
  disabled?: boolean
  /** Several may be on at once: the buttons are toggles and the group says so. */
  multi?: boolean
  ariaLabel: string
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-multi={multi || undefined}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        opacity: disabled ? 'var(--ra-opacity-disabled)' : 1
      }}
    >
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={o.on}
          disabled={disabled}
          tabIndex={disabled ? -1 : undefined}
          data-tooltip={o.tooltip}
          onClick={o.onClick}
          style={{
            flex: '1 1 0',
            minHeight: sizeHeight(size),
            padding: '0 var(--ra-s-2)',
            fontFamily: 'inherit',
            fontSize: size === 'live' ? 'var(--ra-fs-10)' : 'var(--ra-fs-9)',
            whiteSpace: 'nowrap',
            background: o.on ? 'var(--ra-text)' : 'transparent',
            color: o.on ? 'var(--ra-bg-page)' : 'var(--ra-text-2)',
            border: `1px solid ${o.on ? 'var(--ra-text)' : 'var(--ra-border-strong)'}`,
            cursor: disabled ? 'default' : 'pointer'
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A momentary move (`fire now`): dashed, fires once and is never selected. `held` is a move
 * that is armed and waiting (inverted, aria-pressed); `notNow` is one that cannot fire right
 * now (faint). `:active` inverts too, via `.radio-fire` in DiscoverPanel's style block. */
export function FireButton({
  label,
  held = false,
  notNow = false,
  onClick,
  tooltip,
  ariaLabel,
  primary = false
}: {
  label: string
  held?: boolean
  notNow?: boolean
  onClick: () => void
  tooltip?: string
  ariaLabel?: string
  primary?: boolean
}): React.JSX.Element {
  const border = notNow
    ? 'var(--ra-border-strong)'
    : primary
      ? 'var(--ra-text)'
      : 'var(--ra-text-2)'
  return (
    <button
      type="button"
      className="radio-fire"
      aria-pressed={held || undefined}
      aria-label={ariaLabel}
      data-tooltip={tooltip}
      onClick={onClick}
      style={{
        height: 'var(--ra-h-live)',
        padding: '0 var(--ra-s-3)',
        fontFamily: 'inherit',
        fontSize: 'var(--ra-fs-10)',
        whiteSpace: 'nowrap',
        background: held ? 'var(--ra-text)' : 'transparent',
        color: held ? 'var(--ra-bg-page)' : notNow ? 'var(--ra-text-3)' : 'var(--ra-text)',
        border: `1px dashed ${held ? 'var(--ra-text)' : border}`,
        cursor: 'pointer'
      }}
    >
      {label}
    </button>
  )
}

/** A mix action (`keep`, `drop`, ...). `emphasis` is the one that matters (`keep`); `pulse` is
 * the add-pulse the old strip's buttons had. */
export function ActionButton({
  label,
  onClick,
  disabled = false,
  tooltip,
  pulse = false,
  emphasis = false
}: {
  label: string
  /** The click event comes through for Cmd (`similar all` is immediate with it). */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  tooltip?: string
  pulse?: boolean
  emphasis?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      data-tooltip={tooltip}
      onClick={onClick}
      style={{
        height: 'var(--ra-h-live)',
        padding: emphasis ? '0 18px' : '0 var(--ra-s-4)',
        fontFamily: 'inherit',
        fontSize: emphasis ? 'var(--ra-fs-11)' : 'var(--ra-fs-9)',
        whiteSpace: 'nowrap',
        background: 'transparent',
        color: disabled ? 'var(--ra-text-4)' : 'var(--ra-text)',
        border: `1px solid ${emphasis && !disabled ? 'var(--ra-text)' : 'var(--ra-border-strong)'}`,
        cursor: disabled ? 'default' : 'pointer',
        animation: pulse ? 'discover-add-pulse 500ms ease-out' : undefined
      }}
    >
      {label}
    </button>
  )
}
