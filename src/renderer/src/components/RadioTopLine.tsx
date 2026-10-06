// src/renderer/src/components/RadioTopLine.tsx
//
// The radio view's top line (spec 2026-10-03-sssketch-radio-view-design section 1.1; the web
// radio's `.top`): while radio runs, Discover's two header rows become this one sticky line.
// Left, play/stop and `radio` (the stop) with its interval line inside its bottom edge; then the
// readout (status line, phrase ruler, fold's line); then the mix actions (RadioMixActions, passed
// in: they act on what is playing); right, the `simple / advanced` switch (spec
// 2026-10-05-radio-simple-view-design), undo and redo. Values and callbacks only.
import type { ReactNode } from 'react'
import { RADIO_VIEW_FRAME } from './discoverRowGrid'
import { Segmented } from './RadioControls'
import { radioRulerCells, type RadioReadout } from '@shared/radioReadout'
import { RADIO_VIEWS, RADIO_VIEW_TOOLTIP, type RadioView } from '@shared/radioView'

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
  actions,
  view,
  onViewChange,
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
  /** The mix actions (RadioMixActions): they act on what is playing. */
  actions: ReactNode
  /** The view shown (simple or advanced), and the switch's choice. What shows, never what plays. */
  view: RadioView
  onViewChange: (view: RadioView) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}): React.JSX.Element {
  const square: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'var(--ra-h-live)',
    height: 'var(--ra-h-live)',
    padding: 0
  }
  const rulerGap = readout !== null && readout.ruler.ticks > 32 ? 1 : 2
  const rulerInk = {
    played: 'var(--ra-text-2)',
    now: 'var(--ra-text)',
    'ahead-bar': 'var(--ra-border-strong)',
    ahead: 'var(--ra-border)'
  } as const
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        // Above the rows wrapper, which is position: relative and would paint over it.
        zIndex: 2,
        background: RADIO_STICKY_BACKGROUND,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        // Tight rows: at the 945 minimum it wraps to two lines, and the box is short.
        gap: 'var(--ra-s-2) var(--ra-s-7)',
        padding: '6px var(--ra-s-7)',
        borderBottom: '1px solid var(--ra-border)',
        ...RADIO_VIEW_FRAME
      }}
    >
      {/* Transport: play/stop, then `radio` (the stop) with its interval line inside its bottom
          edge: a line, not a number that jitters. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ra-s-2)', flexShrink: 0 }}>
        <button
          onClick={onPlayToggle}
          disabled={!canPlay}
          data-tooltip={playing ? 'stop' : 'play'}
          aria-label={playing ? 'stop' : 'play'}
          style={{
            ...square,
            fontSize: 'var(--ra-fs-13)',
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
        <button
          ref={radioButtonRef}
          onClick={onStopRadio}
          data-tooltip="stop radio"
          style={{
            position: 'relative',
            overflow: 'hidden',
            fontFamily: 'inherit',
            fontSize: 'var(--ra-fs-11)',
            height: 'var(--ra-h-live)',
            padding: '0 var(--ra-s-6)',
            background: 'var(--ra-play-on)',
            border: '1px solid var(--ra-border-strong)',
            color: 'var(--ra-play-on-ink)',
            cursor: 'pointer'
          }}
        >
          radio
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              height: 2,
              width: `${Math.round(progress * 100)}%`,
              background: 'var(--ra-play-on-ink)'
            }}
          />
        </button>
      </div>
      {/* The readout. Not a live region: its counts move every bar. */}
      <div
        style={{
          flex: '1 1 360px',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 5
        }}
      >
        {readout !== null && readout.statusLine !== '' && (
          <span
            title={readout.statusLine}
            style={{
              fontSize: 'var(--ra-fs-10)',
              color: 'var(--ra-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%'
            }}
          >
            {readout.statusLine}
          </span>
        )}
        {readout !== null && readout.ruler.ticks > 0 && (
          <span
            aria-hidden
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', maxWidth: 360 }}
          >
            <span style={{ display: 'flex', gap: rulerGap, flex: 1, height: 4 }}>
              {radioRulerCells(readout.ruler).map((cell, i) => (
                <span key={i} style={{ flex: 1, background: rulerInk[cell] }} />
              ))}
            </span>
            {readout.ruler.end !== null && (
              <span
                style={{
                  whiteSpace: 'nowrap',
                  fontSize: 'var(--ra-fs-9)',
                  color: 'var(--ra-text-3)'
                }}
              >
                {readout.ruler.end}
              </span>
            )}
          </span>
        )}
        {foldSummary !== null && (
          <span
            style={{
              fontSize: 'var(--ra-fs-9)',
              color: 'var(--ra-text-2)',
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
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--ra-s-1)' }}
      >
        {actions}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--ra-s-2)',
          flexShrink: 0,
          paddingLeft: 'var(--ra-s-5)',
          borderLeft: '1px solid var(--ra-border)'
        }}
      >
        {/* The view switch: the strip's word switch (Segmented), buttons, so Tab and Enter
            reach it. Its tooltip says what the other view adds or leaves out. */}
        <Segmented
          ariaLabel="radio view"
          size="live"
          options={RADIO_VIEWS.map((v) => ({
            label: v,
            on: view === v,
            tooltip: RADIO_VIEW_TOOLTIP[view],
            onClick: () => (view === v ? undefined : onViewChange(v))
          }))}
        />
        <button
          onClick={onUndo}
          disabled={!canUndo}
          data-tooltip="undo"
          aria-label="undo"
          style={{
            ...square,
            background: 'transparent',
            border: '1px solid var(--ra-border-strong)',
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
            border: '1px solid var(--ra-border-strong)',
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
