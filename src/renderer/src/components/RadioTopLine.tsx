// src/renderer/src/components/RadioTopLine.tsx
//
// The radio view's top line (spec 2026-10-03-sssketch-radio-view-design section 1.1; the web
// radio's `.top`): while radio runs, Discover's two header rows become this one sticky line.
// Left, play/stop and `radio` (the stop) with its interval line; middle, the readout's status line,
// the phrase ruler and fold's status line; right, undo and redo. Values and callbacks only.
import type { RadioReadout } from '@shared/radioReadout'

/** Behind the sticky bars: the library box's own fill (LibraryBrowser), so nothing shows through
 * and nothing looks like a second panel. */
export const RADIO_STICKY_BACKGROUND = 'var(--ra-bg-bar)'

export function RadioTopLine({
  playing,
  canPlay,
  onPlayToggle,
  onStopRadio,
  radioButtonRef,
  progress,
  readout,
  foldSummary,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: {
  playing: boolean
  /** Something is in the mix (play/stop does nothing otherwise). */
  canPlay: boolean
  onPlayToggle: () => void
  onStopRadio: () => void
  radioButtonRef: React.RefObject<HTMLButtonElement | null>
  /** How far through the current interval, 0..1. */
  progress: number
  readout: RadioReadout | null
  foldSummary: string | null
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}): React.JSX.Element {
  const square: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    padding: 0
  }
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        // Above the rows wrapper, which is position: relative and would paint over it.
        zIndex: 2,
        background: RADIO_STICKY_BACKGROUND,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '4px 0 8px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 }}>
        <button
          onClick={onPlayToggle}
          disabled={!canPlay}
          data-tooltip={playing ? 'stop' : 'play'}
          aria-label={playing ? 'stop' : 'play'}
          style={{
            ...square,
            fontSize: 11,
            border: '1px solid var(--ra-border-strong)',
            background: !canPlay
              ? 'var(--ra-bg-row-active)'
              : playing
                ? 'var(--ra-play-on)'
                : 'var(--ra-bg-row-active)',
            color: !canPlay
              ? 'var(--ra-text-4)'
              : playing
                ? 'var(--ra-play-on-ink)'
                : 'var(--ra-text)',
            cursor: !canPlay ? 'default' : 'pointer'
          }}
        >
          {playing ? '■' : '▶'}
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            ref={radioButtonRef}
            onClick={onStopRadio}
            data-tooltip="stop radio"
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              padding: '6px 14px',
              background: 'var(--ra-play-on)',
              border: '1px solid var(--ra-border-strong)',
              color: 'var(--ra-play-on-ink)',
              cursor: 'pointer'
            }}
          >
            radio
          </button>
          {/* How far through the current interval: a line, not a number that jitters. */}
          <div style={{ height: 2, background: 'var(--ra-border)' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.round(progress * 100)}%`,
                background: 'var(--ra-text-3)'
              }}
            />
          </div>
        </div>
      </div>
      {/* The readout. Not a live region: its counts move every bar. */}
      <div
        style={{
          flex: '1 1 0',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          fontSize: 9,
          color: 'var(--ra-text-2)'
        }}
      >
        {readout !== null && readout.statusLine !== '' && (
          <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'center' }}>
            {readout.statusLine}
          </span>
        )}
        {readout !== null && readout.ruler.ticks > 0 && (
          <span
            aria-hidden
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', maxWidth: 320 }}
          >
            <span style={{ display: 'flex', gap: 1, flex: 1, height: 1 }}>
              {Array.from({ length: readout.ruler.ticks }, (_, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    background: i < readout.ruler.filled ? 'var(--ra-text)' : 'var(--ra-text-4)'
                  }}
                />
              ))}
            </span>
            {readout.ruler.end !== null && (
              <span style={{ whiteSpace: 'nowrap', fontSize: 9, color: 'var(--ra-text-3)' }}>
                {readout.ruler.end}
              </span>
            )}
          </span>
        )}
        {foldSummary !== null && (
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%'
            }}
          >
            {foldSummary}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          data-tooltip="undo"
          aria-label="undo"
          style={{
            ...square,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: canUndo ? 'var(--ra-text-2)' : 'var(--ra-text-4)',
            cursor: canUndo ? 'pointer' : 'default'
          }}
        >
          <UndoIcon />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          data-tooltip="redo"
          aria-label="redo"
          style={{
            ...square,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: canRedo ? 'var(--ra-text-2)' : 'var(--ra-text-4)',
            cursor: canRedo ? 'pointer' : 'default'
          }}
        >
          <RedoIcon />
        </button>
      </div>
    </div>
  )
}

// Hand-drawn undo/redo glyphs (a curved "back" arrow, redo is the exact
// same shape mirrored horizontally rather than a second hand-derived
// coordinate set). Direct request, 2026-09-15 (Upcycle-inspired):
// undo/redo for Discover's own reroll/add/remove actions. Used here and by
// DiscoverPanel's header.
export function UndoIcon(): React.JSX.Element {
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
      style={{ flexShrink: 0 }}
    >
      <path d="M13 6 H7 a4 4 0 0 0 -4 4 v1" />
      <path d="M5.5 8 l-2.5 2 l2.5 2" />
    </svg>
  )
}

export function RedoIcon(): React.JSX.Element {
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
      style={{ flexShrink: 0 }}
    >
      <g transform="scale(-1,1) translate(-16,0)">
        <path d="M13 6 H7 a4 4 0 0 0 -4 4 v1" />
        <path d="M5.5 8 l-2.5 2 l2.5 2" />
      </g>
    </svg>
  )
}
