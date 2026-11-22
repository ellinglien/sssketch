// Held stems (spec 2026-11-22-held-stems-design), "pads" on screen: the strip of nine tiles under
// Discover's rows. A tile shows its key and, when filled, the stem's name (its kinds in the
// tooltip); the name plays it (Cmd-click at once), its small `x` clears it. The number arms the
// pad: the rows then offer themselves and a click on one saves its stem there (the mouse's way to
// do shift + number). The pads and their rules are @shared/heldStems; the playing is
// DiscoverPanel's playHeldStem.
import type { CSSProperties } from 'react'
import { HELD_SLOT_COUNT, heldSlotLabel, heldStemKinds, type HeldStems } from '@shared/heldStems'
import { slotKindsLabel } from '@shared/discoverSlotKind'

const TILE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  width: 96,
  height: 20,
  padding: '0 4px',
  background: 'transparent',
  border: '1px solid var(--ra-border)',
  color: 'var(--ra-text-2)',
  fontFamily: 'inherit',
  fontSize: 'var(--ra-fs-9)',
  textAlign: 'left'
}

export function HeldStemsStrip({
  held,
  armed,
  onArm,
  onPlay,
  onClear
}: {
  held: HeldStems
  /** The pad waiting for a row to be clicked, or null. */
  armed: number | null
  onArm: (index: number) => void
  onPlay: (index: number, immediate: boolean) => void
  onClear: (index: number) => void
}): React.JSX.Element {
  const tile = (index: number): React.JSX.Element => {
    const stem = held[index] ?? null
    const key = heldSlotLabel(index)
    const isArmed = armed === index
    const armedLook: CSSProperties = isArmed
      ? { borderStyle: 'solid', borderColor: 'var(--ra-text)', color: 'var(--ra-text)' }
      : {}
    const armTooltip = isArmed
      ? 'click a row to save its stem here · esc cancels'
      : `save a row's stem to pad ${key}: click, then click the row · or hover a row and press shift + ${key}`
    if (stem === null) {
      return (
        <button
          key={index}
          type="button"
          onClick={() => onArm(index)}
          data-tooltip={armTooltip}
          aria-label={`pad ${key}, empty`}
          aria-pressed={isArmed}
          style={{
            ...TILE,
            borderStyle: 'dashed',
            color: 'var(--ra-text-4)',
            cursor: 'pointer',
            ...armedLook
          }}
        >
          <span>{key}</span>
          {isArmed && <span>click a row</span>}
        </button>
      )
    }
    const name = stem.presetName || 'stem'
    return (
      <div key={index} style={{ ...TILE, padding: 0, gap: 0, ...armedLook }}>
        <button
          type="button"
          onClick={() => onArm(index)}
          data-tooltip={armTooltip}
          aria-label={`replace pad ${key}`}
          aria-pressed={isArmed}
          style={{ ...TILE, width: 'auto', height: '100%', border: 'none', cursor: 'pointer' }}
        >
          {key}
        </button>
        <button
          type="button"
          onClick={(e) => onPlay(index, e.metaKey)}
          data-tooltip={`${name} · ${slotKindsLabel(heldStemKinds(stem))} · ${key} adds or removes it · cmd: at once`}
          aria-label={`pad ${key}: ${name}`}
          style={{
            ...TILE,
            flex: 1,
            minWidth: 0,
            width: 'auto',
            height: '100%',
            padding: 0,
            border: 'none',
            cursor: 'pointer'
          }}
        >
          <span
            style={{
              color: 'var(--ra-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {isArmed ? 'click a row' : name}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onClear(index)}
          data-tooltip="clear"
          aria-label={`clear pad ${key}`}
          style={{
            ...TILE,
            width: 'auto',
            height: '100%',
            border: 'none',
            color: 'var(--ra-text-3)',
            cursor: 'pointer'
          }}
        >
          x
        </button>
      </div>
    )
  }
  return (
    <div
      role="group"
      aria-label="pads"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 0' }}
    >
      {Array.from({ length: HELD_SLOT_COUNT }, (_, i) => tile(i))}
    </div>
  )
}
