import { useState } from 'react'
import { useAppState, useDispatch, useHistory, usePos, usePlaying } from '../state/StoreContext'
import { positionLabel, elapsedLabel } from '@shared/visuals'
import { SNAP_DIVS } from '../state/store'

export function TransportBar(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const history = useHistory()
  const pos = usePos()
  const playing = usePlaying()

  // Decoupled from state.bpm while focused: SET_TEMPO clamps to [40, 200], and a
  // controlled input that snaps back to the clamped value on every keystroke makes
  // multi-digit typing impossible (e.g. typing "1" of "120" clamps to 40 mid-type,
  // then further digits compound against that clamped value instead of "120").
  // Free-type locally, only committing (and clamping) on blur/Enter. Resynced
  // during render rather than an effect (React's "adjust state while rendering"
  // pattern) whenever state.bpm changes from elsewhere (±buttons, loading a
  // project) while the field isn't being actively edited.
  const [tempoText, setTempoText] = useState(String(state.bpm))
  const [tempoFocused, setTempoFocused] = useState(false)
  if (!tempoFocused && tempoText !== String(state.bpm)) {
    setTempoText(String(state.bpm))
  }

  function commitTempo(): void {
    setTempoFocused(false)
    const bpm = Number(tempoText)
    if (!Number.isNaN(bpm) && tempoText.trim() !== '') {
      dispatch({ type: 'SET_TEMPO', bpm })
    } else {
      setTempoText(String(state.bpm))
    }
  }

  return (
    <div
      style={{
        height: 46,
        background: 'var(--ra-bg-bar)',
        borderBottom: '1px solid var(--ra-border)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }}
    >
      <button
        onClick={() => dispatch({ type: playing ? 'PAUSE' : 'PLAY' })}
        aria-label={playing ? 'Pause' : 'Play'}
        style={{
          width: 36,
          height: 26,
          borderRadius: 0,
          border: '1px solid var(--ra-border-strong)',
          background: playing ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
          color: playing ? 'var(--ra-play-on-ink)' : 'var(--ra-text)'
        }}
      >
        {playing ? '❙❙' : '▶'}
      </button>
      <button
        onClick={() => dispatch({ type: 'STOP' })}
        aria-label="Stop"
        style={{
          width: 28,
          height: 26,
          borderRadius: 0,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-active)',
          color: 'var(--ra-text-2)'
        }}
      >
        ■
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{positionLabel(pos)}</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
          {elapsedLabel(pos, state.bpm)}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 26,
          borderLeft: '1px solid var(--ra-border)',
          borderRight: '1px solid var(--ra-border)',
          padding: '0 10px'
        }}
      >
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm - 1 })}
          aria-label="Decrease tempo"
          style={{
            width: 20,
            height: 20,
            borderRadius: 0,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)'
          }}
        >
          −
        </button>
        <input
          type="number"
          value={tempoText}
          onFocus={() => setTempoFocused(true)}
          onChange={(e) => setTempoText(e.target.value)}
          onBlur={commitTempo}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Tempo (BPM)"
          style={{
            fontSize: 14,
            fontWeight: 700,
            width: 44,
            textAlign: 'center',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            border: '1px solid var(--ra-border)',
            borderRadius: 0,
            height: 20
          }}
        />
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm + 1 })}
          aria-label="Increase tempo"
          style={{
            width: 20,
            height: 20,
            borderRadius: 0,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)'
          }}
        >
          +
        </button>
      </div>

      <button
        onClick={() => dispatch({ type: 'CYCLE_SNAP' })}
        aria-label="Cycle snap grid"
        style={{
          height: 22,
          borderRadius: 0,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-active)',
          color: 'var(--ra-text-2)',
          fontSize: 10,
          padding: '0 8px'
        }}
      >
        snap 1/{SNAP_DIVS[state.snapIdx]}
      </button>

      <button
        onClick={() => dispatch({ type: 'TOGGLE_VOLUME_DRAG_MODE' })}
        aria-label="Toggle volume drag mode"
        title={state.volumeDragMode ? 'envelope drag: on (V)' : 'envelope drag: off (V)'}
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.volumeDragMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        envelope
      </button>

      <button
        onClick={() => dispatch({ type: 'TOGGLE_COMPACT_MODE' })}
        aria-label="Toggle compact mode"
        title={state.compactMode ? 'compact mode: on (Tab)' : 'compact mode: off (Tab)'}
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.compactMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.compactMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.compactMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        compact
      </button>

      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={history.undo}
          disabled={!history.canUndo}
          aria-label="Undo"
          title="Undo (Cmd+Z)"
          style={{
            width: 22,
            height: 22,
            borderRadius: 0,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: history.canUndo ? 'var(--ra-text)' : 'var(--ra-text-4)',
            fontSize: 11
          }}
        >
          ↶
        </button>
        <button
          onClick={history.redo}
          disabled={!history.canRedo}
          aria-label="Redo"
          title="Redo (Cmd+Shift+Z)"
          style={{
            width: 22,
            height: 22,
            borderRadius: 0,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: history.canRedo ? 'var(--ra-text)' : 'var(--ra-text-4)',
            fontSize: 11
          }}
        >
          ↷
        </button>
      </div>
    </div>
  )
}
