// src/renderer/src/components/RadioControls.tsx
//
// Radio's controls, shared by the start prompt (RadioStartPrompt) and the radio
// view's strip (spec 2026-10-03-sssketch-radio-view-design). Values and callbacks only: no
// state here outlives a gesture, and nothing reads the panel.
import { useRef, useState, type ReactNode } from 'react'
import { RADIO_PACE_LABEL, radioPaceLabel } from '@shared/radioPace'
import { FOLD_SEED_TEXT_MAX, cleanFoldSeed } from '@shared/radioFold'
import { Dial } from './Dial'

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
