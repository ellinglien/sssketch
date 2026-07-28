import { useAppState, useDispatch } from '../state/StoreContext'
import { resolveOffsetKey, stretchRatio } from '../state/selectors'
import { dbLabel, offsetLabels } from '@shared/visuals'
import { stemKey } from '@shared/types'
import { SNAP_DIVS } from '../state/store'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'

export function Inspector(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const groupId = state.sel

  if (!groupId || !state.rifffs[groupId]) {
    return (
      <div
        style={{
          width: 308,
          flexShrink: 0,
          background: 'var(--ra-bg-bar)',
          borderLeft: '1px solid var(--ra-border)'
        }}
      >
        <div style={{ padding: '12px 14px' }}>
          <span className="ra-eyebrow">inspector</span>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--ra-text-3)' }}>
            select a rifff block to inspect it
          </div>
        </div>
      </div>
    )
  }

  const rifff = state.rifffs[groupId]
  const color = typeColorVar(rifff.stems[0]?.type ?? 'fx')
  const stretchOn = state.stretch[groupId] ?? true
  const ratio = stretchRatio(state, groupId)
  const groupOffsetKey = resolveOffsetKey(state, groupId, rifff.stems[0]?.slot ?? 0)
  const groupOffsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const labels = offsetLabels(groupOffsetSteps, snapDiv, state.bpm)
  const unlinked = !!state.unlinked[groupId]

  const section = (children: React.JSX.Element): React.JSX.Element => (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ra-border)' }}>
      {children}
    </div>
  )

  return (
    <div
      style={{
        width: 308,
        flexShrink: 0,
        background: 'var(--ra-bg-bar)',
        borderLeft: '1px solid var(--ra-border)'
      }}
    >
      {section(
        <>
          <span className="ra-eyebrow">inspector</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <PolarGlyph stems={rifff.stems} identityColor={color} size={34} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>{rifff.name}</span>
          </div>
          <div
            onClick={async () => {
              const folder = await window.rifffApi.pickFolder()
              if (!folder) return
              const reimported = await window.rifffApi.importRifff([folder])
              if (!reimported) return
              dispatch({
                type: 'ADD_TO_SHELF',
                rifff: { ...reimported, groupId, startBar: rifff.startBar }
              })
            }}
            style={{
              marginTop: 6,
              fontSize: 10,
              color: 'var(--ra-text-3)',
              wordBreak: 'break-all',
              cursor: 'pointer'
            }}
            title="click to re-import this rifff from its source folder"
          >
            {rifff.folderPath}/
          </div>
        </>
      )}

      {section(
        <>
          <span className="ra-eyebrow">tempo</span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8
            }}
          >
            <div>
              <span style={{ fontSize: 19, fontWeight: 700 }}>{rifff.bpm}</span>
              <span style={{ margin: '0 6px' }}>→</span>
              <span style={{ fontSize: 19, fontWeight: 700, color }}>{state.bpm}</span>
            </div>
            <button
              onClick={() => dispatch({ type: 'TOGGLE_STRETCH', groupId })}
              style={{
                height: 22,
                borderRadius: 6,
                padding: '0 8px',
                fontSize: 10,
                background: stretchOn && ratio !== 1 ? 'var(--ra-stretch-on-bg)' : 'transparent',
                border: `1px solid ${stretchOn && ratio !== 1 ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: stretchOn && ratio !== 1 ? 'var(--ra-stretch-on)' : 'var(--ra-text-3)'
              }}
            >
              {stretchOn ? 'stretch on' : 'native'}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ra-text-2)' }}>
            {ratio === 1
              ? 'native tempo — nothing to stretch.'
              : stretchOn
                ? `stretched ${(ratio * 100).toFixed(1)}% to fit the project grid. pitch preserved.`
                : 'playing at source tempo — will drift against the grid.'}
          </div>
        </>
      )}

      {section(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="ra-eyebrow">offset</span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              grid 1/{snapDiv} · {labels.msPerStep}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => dispatch({ type: 'NUDGE_OFFSET', key: groupOffsetKey, delta: -1 })}
              style={{
                width: 26,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--ra-border-strong)'
              }}
            >
              −
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--ra-text-4)' }}>
              −8 / 0 / +8
            </div>
            <button
              onClick={() => dispatch({ type: 'NUDGE_OFFSET', key: groupOffsetKey, delta: 1 })}
              style={{
                width: 26,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--ra-border-strong)'
              }}
            >
              +
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 8
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: groupOffsetSteps ? color : 'var(--ra-text-2)'
                }}
              >
                {labels.grid}
              </span>
              <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ra-text-3)' }}>
                {labels.ms}
              </span>
            </div>
            <button
              onClick={() => dispatch({ type: 'ZERO_OFFSET', key: groupOffsetKey })}
              style={{ height: 20, borderRadius: 4, padding: '0 6px', fontSize: 10 }}
            >
              zero
            </button>
          </div>
        </>
      )}

      {section(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ra-eyebrow">stems</span>
            <button
              onClick={() => dispatch({ type: unlinked ? 'RELINK' : 'UNLINK', groupId })}
              style={{
                height: 20,
                borderRadius: 4,
                padding: '0 6px',
                fontSize: 10,
                color: unlinked ? 'var(--ra-text-2)' : 'var(--ra-mute-on)',
                border: `1px solid ${unlinked ? 'var(--ra-border)' : 'color-mix(in srgb, var(--ra-mute-on) 55%, transparent)'}`
              }}
            >
              {unlinked ? 'relink group' : 'unlink group'}
            </button>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {rifff.stems.map((stem) => {
              const key = stemKey(groupId, stem.slot)
              const muted = !!state.mute[key]
              const volume = state.vol[key] ?? 1
              return (
                <div
                  key={stem.slot}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, height: 24 }}
                >
                  <button
                    onClick={() => dispatch({ type: 'CYCLE_TYPE', groupId, slot: stem.slot })}
                    title="click to change sound type"
                    style={{
                      width: 6,
                      height: 12,
                      borderRadius: 2,
                      background: typeColorVar(stem.type),
                      border: 'none',
                      padding: 0
                    }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{stem.slot}</span>
                  <span
                    style={{
                      fontSize: 11,
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {stem.name}
                  </span>
                  <button
                    onClick={() => dispatch({ type: 'TOGGLE_MUTE', stemKey: key })}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: muted ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
                      color: muted ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)',
                      fontSize: 9,
                      border: 'none'
                    }}
                  >
                    m
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(volume * 100)}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_VOLUME',
                        stemKey: key,
                        volume: Number(e.target.value) / 100
                      })
                    }
                    style={{ width: 82 }}
                  />
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--ra-text-3)',
                      width: 30,
                      textAlign: 'right'
                    }}
                  >
                    {muted ? 'mute' : dbLabel(volume)}
                  </span>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--ra-text-3)' }}>
            source: {rifff.stems[0]?.author}
            {new Set(rifff.stems.map((s) => s.author)).size > 1 ? ' and others' : ''}, copied into
            your rifff library.
          </div>
        </>
      )}
    </div>
  )
}
