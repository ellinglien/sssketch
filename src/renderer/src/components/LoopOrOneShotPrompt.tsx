// src/renderer/src/components/LoopOrOneShotPrompt.tsx
import { useEffect, useState } from 'react'
import { useAppSelector } from '../state/StoreContext'
import { guessLoopBars, LOOP_BAR_CANDIDATES } from '@shared/loopBarGuess'

export type LoopOrOneShotChoice =
  { type: 'oneShot' } | { type: 'loop'; barCount: number } | { type: 'cancel' }

// Same backdrop+panel structure and button styling as
// LockInConfirmDialog.tsx -- sharp corners, var(--ra-*) tokens, lowercase
// copy, no default button chrome (this app's buttons have none by
// default, per that file's own doc comment).
function buttonStyle(active = false): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '4px 10px',
    background: active ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
    border: '1px solid var(--ra-border)',
    color: active ? 'var(--ra-play-on-ink)' : 'var(--ra-text)',
    cursor: 'pointer'
  }
}

/** Shelf's own drop-import prompt for a file that didn't match Endlesss's
 * stem-filename convention (importRifff returned null) -- asks whether
 * the dropped file(s) are a one-shot hit or a real musical loop, since
 * this codebase has no way to tell automatically (no audio-content
 * bpm/beat detection anywhere). Real report, 2026-09-16: "it doesn't want
 * to loop... it is out of time although it is a perfect loop" -- the
 * prior fallback (importOneShot for everything) was correct for a one-
 * shot hit but silently wrong for a loop file. "Ask every time" was
 * Elling's own explicit choice over auto-guessing or defaulting to
 * one-shot always.
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
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          padding: 14,
          width: 320,
          fontSize: 11,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        {mode === 'choosing' ? (
          <>
            <p style={{ margin: 0, color: 'var(--ra-text)' }}>
              {paths.length === 1
                ? "this file doesn't look like an endlesss stem export -- how should it play?"
                : `${paths.length} files don't look like endlesss stem exports -- how should they play?`}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => onResolve({ type: 'oneShot' })} style={buttonStyle()}>
                one-shot -- plays once at its own speed
              </button>
              <button onClick={() => setMode('loop')} style={buttonStyle()}>
                loop -- stretches to project tempo, tiles across bars
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => onResolve({ type: 'cancel' })} style={buttonStyle()}>
                cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: 'var(--ra-text)' }}>
              how many bars is {paths.length === 1 ? 'this loop' : 'each loop'}?
            </p>
            <input
              type="number"
              min={1}
              step={1}
              value={barCountText}
              onChange={(e) => setBarCountText(e.target.value)}
              autoFocus
              style={{
                fontFamily: 'inherit',
                fontSize: 11,
                padding: '4px 6px',
                background: 'var(--ra-bg-row-active)',
                border: '1px solid var(--ra-border)',
                color: 'var(--ra-text)'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button onClick={() => setMode('choosing')} style={buttonStyle()}>
                back
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onResolve({ type: 'cancel' })} style={buttonStyle()}>
                  cancel
                </button>
                <button
                  onClick={() =>
                    validBarCount && onResolve({ type: 'loop', barCount: parsedBarCount })
                  }
                  disabled={!validBarCount}
                  style={buttonStyle(validBarCount)}
                >
                  import as loop
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
