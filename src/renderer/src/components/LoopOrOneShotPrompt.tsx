// src/renderer/src/components/LoopOrOneShotPrompt.tsx
import { useEffect, useState } from 'react'
import { useAppSelector } from '../state/StoreContext'
import { guessLoopBars, LOOP_BAR_CANDIDATES } from '@shared/loopBarGuess'

export type LoopOrOneShotChoice =
  { type: 'oneShot' } | { type: 'loop'; barCount: number } | { type: 'cancel' }

// Same backdrop+panel structure as LockInConfirmDialog.tsx -- sharp
// corners, var(--ra-*) tokens. Icon-only buttons, no text labels -- direct
// request, 2026-09-16: "simplify the buttons and text in that prompt so
// it's minimal," matching this app's established "hand-drawn SVG glyph,
// title attribute for the tooltip, no text label" convention
// (DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/StarIcon/NearbyIcon etc.).
function iconButtonStyle(active = false): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    background: active ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
    border: '1px solid var(--ra-border)',
    color: active ? 'var(--ra-play-on-ink)' : 'var(--ra-text)',
    cursor: 'pointer'
  }
}

function CancelIcon(): React.JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M3 3 L13 13 M13 3 L3 13" />
    </svg>
  )
}

function BackIcon(): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3 L5 8 L10 13" />
    </svg>
  )
}

// A single filled play triangle -- "plays once," deliberately plain
// (no loop arrows) to read as the opposite of LoopIcon below.
function OneShotIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M4 2.5 L13 8 L4 13.5 Z" />
    </svg>
  )
}

// Two arcs, each ending in its own arrowhead, forming a closed loop --
// the classic "repeat" read, distinct from DiscoverPanel.tsx's own
// ShuffleIcon (two independent crossing lanes, a different action).
function LoopIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6 a5 5 0 0 1 9 -1.5" />
      <path d="M13 10 a5 5 0 0 1 -9 1.5" />
      <path d="M10.5 2.5 L12 4.5 L14 3.3" />
      <path d="M5.5 13.5 L4 11.5 L2 12.7" />
    </svg>
  )
}

/** Shelf's/Timeline's own drop-import prompt for a file that didn't match
 * Endlesss's stem-filename convention (importRifff returned null) -- asks
 * whether the dropped file(s) are a one-shot hit or a real musical loop,
 * since this codebase has no way to tell automatically (no audio-content
 * bpm/beat detection anywhere). "Ask every time" was Elling's own explicit
 * choice over auto-guessing or defaulting to one-shot always; icon-only
 * buttons (2026-09-16 follow-up: "simplify the buttons and text... so
 * it's minimal") keep that choice a two-click, glance-and-go decision
 * rather than a paragraph to read.
 *
 * `paths.length` may be > 1 (a multi-file drag) -- the choice made here
 * applies uniformly to every path (one-shot for all, or the SAME bar
 * count for all loops), the common case for a batch of same-length
 * breaks/loops dragged from one pack together. Per-file bar counts
 * aren't supported -- YAGNI until a real report asks for it. */
export function LoopOrOneShotPrompt({
  paths,
  onResolve
}: {
  paths: string[]
  onResolve: (choice: LoopOrOneShotChoice) => void
}): React.JSX.Element {
  const projectBpm = useAppSelector((s) => s.bpm)
  const [mode, setMode] = useState<'choosing' | 'loop'>('choosing')
  // Pre-filled bar-count guess (loopBarGuess.ts's guessLoopBars, from the
  // FIRST dropped path's own real duration) -- always user-correctable,
  // never a silent final answer. Falls back to a plain default candidate
  // while the duration read is in flight or if it fails (e.g. an
  // unreadable/non-WAV file).
  const [barCountText, setBarCountText] = useState(String(LOOP_BAR_CANDIDATES[1]))

  useEffect(() => {
    let cancelled = false
    const firstPath = paths[0]
    if (!firstPath) return
    window.rifffApi.getWavDurationSeconds(firstPath).then((durationSec) => {
      if (cancelled || durationSec === null) return
      setBarCountText(String(guessLoopBars(durationSec, projectBpm)))
    })
    return () => {
      cancelled = true
    }
    // Only ever recompute for a fresh prompt (a new paths identity) --
    // projectBpm drifting while this dialog is open shouldn't yank the
    // user's already-showing guess out from under them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths])

  const parsedBarCount = Number.parseInt(barCountText, 10)
  const validBarCount = Number.isFinite(parsedBarCount) && parsedBarCount > 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-modal)',
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)', flex: 1, whiteSpace: 'nowrap' }}>
            {paths.length === 1
              ? 'not an endlesss export'
              : `${paths.length} files, not endlesss exports`}
          </span>
          <button
            onClick={() => onResolve({ type: 'cancel' })}
            title="cancel"
            style={iconButtonStyle()}
          >
            <CancelIcon />
          </button>
        </div>
        {mode === 'choosing' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onResolve({ type: 'oneShot' })}
              title="one-shot -- plays once at its own speed"
              style={iconButtonStyle()}
            >
              <OneShotIcon />
            </button>
            <button
              onClick={() => setMode('loop')}
              title="loop -- stretches to project tempo, tiles across bars"
              style={iconButtonStyle()}
            >
              <LoopIcon />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setMode('choosing')} title="back" style={iconButtonStyle()}>
              <BackIcon />
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={barCountText}
              onChange={(e) => setBarCountText(e.target.value)}
              autoFocus
              title="bar count"
              style={{
                width: 40,
                fontFamily: 'inherit',
                fontSize: 11,
                padding: '4px 6px',
                background: 'var(--ra-bg-row-active)',
                border: '1px solid var(--ra-border)',
                color: 'var(--ra-text)'
              }}
            />
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>bars</span>
            <button
              onClick={() => validBarCount && onResolve({ type: 'loop', barCount: parsedBarCount })}
              disabled={!validBarCount}
              title="import as loop"
              style={iconButtonStyle(validBarCount)}
            >
              <LoopIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
