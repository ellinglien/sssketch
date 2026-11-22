// Held stems (spec 2026-11-22-held-stems-design): the strip of slot tiles under Discover's rows,
// in two labelled groups (drums, front). A tile shows its key and, when filled, the stem's name;
// click plays it (Cmd-click at once), its small `x` clears it. The slots and their rules are
// @shared/heldStems; the playing is DiscoverPanel's playHeldStem.
import type { CSSProperties } from 'react'
import {
  HELD_DRUM_SLOTS,
  HELD_SLOT_COUNT,
  heldSlotKinds,
  heldSlotLabel,
  type HeldStems
} from '@shared/heldStems'

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
  onPlay,
  onClear
}: {
  held: HeldStems
  onPlay: (index: number, immediate: boolean) => void
  onClear: (index: number) => void
}): React.JSX.Element {
  const tile = (index: number): React.JSX.Element => {
    const stem = held[index] ?? null
    const key = heldSlotLabel(index)
    if (stem === null) {
      return (
        <div
          key={index}
          data-tooltip={`empty · hover a row and press shift + ${key}`}
          style={{ ...TILE, borderStyle: 'dashed', color: 'var(--ra-text-4)' }}
        >
          {key}
        </div>
      )
    }
    const name = stem.presetName || 'stem'
    return (
      <div key={index} style={{ ...TILE, padding: 0, gap: 0 }}>
        <button
          type="button"
          onClick={(e) => onPlay(index, e.metaKey)}
          data-tooltip={`${name} · ${key} adds or removes it · cmd: at once`}
          aria-label={`held stem ${key}: ${name}`}
          style={{
            ...TILE,
            flex: 1,
            minWidth: 0,
            width: 'auto',
            height: '100%',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          <span>{key}</span>
          <span
            style={{
              color: 'var(--ra-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {name}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onClear(index)}
          data-tooltip="clear"
          aria-label={`clear held stem ${key}`}
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
  const group = (from: number, to: number): React.JSX.Element => (
    <div role="group" aria-label={`held ${heldSlotKinds(from)[0]}`} style={GROUP}>
      <span style={{ color: 'var(--ra-text-3)', fontSize: 'var(--ra-fs-9)' }}>
        {heldSlotKinds(from)[0]}
      </span>
      {Array.from({ length: to - from }, (_, i) => tile(from + i))}
    </div>
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', padding: '6px 0' }}>
      {group(0, HELD_DRUM_SLOTS)}
      {group(HELD_DRUM_SLOTS, HELD_SLOT_COUNT)}
    </div>
  )
}

const GROUP: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }
