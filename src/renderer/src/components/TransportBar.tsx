import { useAppState, useDispatch } from '../state/StoreContext'
import { positionLabel, elapsedLabel } from '@shared/visuals'
import { SNAP_DIVS } from '../state/store'

export function TransportBar(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()

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
        onClick={() => dispatch({ type: state.playing ? 'PAUSE' : 'PLAY' })}
        aria-label={state.playing ? 'Pause' : 'Play'}
        style={{
          width: 36,
          height: 26,
          borderRadius: 6,
          border: '1px solid var(--ra-border-strong)',
          background: state.playing ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
          color: state.playing ? 'var(--ra-play-on-ink)' : 'var(--ra-text)'
        }}
      >
        {state.playing ? '❙❙' : '▶'}
      </button>
      <button
        onClick={() => dispatch({ type: 'STOP' })}
        aria-label="Stop"
        style={{
          width: 28,
          height: 26,
          borderRadius: 6,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-active)',
          color: 'var(--ra-text-2)'
        }}
      >
        ■
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{positionLabel(state.pos)}</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
          {elapsedLabel(state.pos, state.bpm)}
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
        <span className="ra-eyebrow">tempo</span>
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm - 1 })}
          aria-label="Decrease tempo"
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)'
          }}
        >
          −
        </button>
        <input
          type="number"
          value={state.bpm}
          onChange={(e) => {
            const bpm = Number(e.target.value)
            if (!Number.isNaN(bpm)) dispatch({ type: 'SET_TEMPO', bpm })
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
            borderRadius: 4,
            height: 20
          }}
        />
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm + 1 })}
          aria-label="Increase tempo"
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
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
          borderRadius: 6,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-active)',
          color: 'var(--ra-text-2)',
          fontSize: 10,
          padding: '0 8px'
        }}
      >
        snap 1/{SNAP_DIVS[state.snapIdx]}
      </button>

      <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ra-text-3)' }}>
        chevron opens stems · block selects
      </div>
    </div>
  )
}
