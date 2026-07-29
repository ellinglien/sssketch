import { Fragment } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { resolveOffsetKey, stretchRatio } from '../state/selectors'
import { offsetLabels } from '@shared/visuals'
import { SNAP_DIVS } from '../state/store'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'

// A finer, snap-division-independent nudge step: 1ms of real time at this
// rifff's own bpm, computed with the same formula offsetLabels() itself uses
// internally (msPerStep = (60/bpm)*4*1000/snapDiv) so the two can never
// silently disagree. This makes each click's real-world effect deliberately
// tiny and constant regardless of whatever the global snap-grid setting
// happens to be — the whole point of separating "nudge precision" from
// "clip-placement snap precision".
const NUDGE_TARGET_MS = 1
function fineNudgeDelta(bpm: number, snapDiv: number): number {
  const msPerStep = ((60 / bpm) * 4 * 1000) / snapDiv
  return NUDGE_TARGET_MS / msPerStep
}

export function Inspector({
  onOpenBeatPicker
}: {
  onOpenBeatPicker: (groupId: string) => void
}): React.JSX.Element {
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ra-eyebrow">inspector</span>
            <button
              onClick={() => dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId })}
              title="remove from timeline (Delete)"
              style={{
                height: 20,
                borderRadius: 0,
                padding: '0 6px',
                fontSize: 10,
                border: '1px solid var(--ra-border)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text-2)'
              }}
            >
              remove from timeline
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <PolarGlyph stems={rifff.stems} identityColor={color} size={34} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>{rifff.name}</span>
          </div>
          <div
            onClick={async () => {
              try {
                const folder = await window.rifffApi.pickFolder()
                if (!folder) return
                const reimported = await window.rifffApi.importRifff([folder])
                if (!reimported) return
                dispatch({
                  type: 'ADD_TO_SHELF',
                  rifff: { ...reimported, groupId, startBar: rifff.startBar }
                })
              } catch (err) {
                console.error('Inspector: failed to re-import rifff from folder:', err)
              }
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
                borderRadius: 0,
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
            <span className="ra-eyebrow">nudge</span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              1ms/step
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              onClick={() =>
                dispatch({
                  type: 'NUDGE_OFFSET',
                  key: groupOffsetKey,
                  delta: -fineNudgeDelta(state.bpm, snapDiv)
                })
              }
              style={{
                width: 26,
                height: 24,
                borderRadius: 0,
                border: '1px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              −
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--ra-text-4)' }}>
              1ms steps
            </div>
            <button
              onClick={() =>
                dispatch({
                  type: 'NUDGE_OFFSET',
                  key: groupOffsetKey,
                  delta: fineNudgeDelta(state.bpm, snapDiv)
                })
              }
              style={{
                width: 26,
                height: 24,
                borderRadius: 0,
                border: '1px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
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
                {labels.ms}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onOpenBeatPicker(groupId)}
                title="downbeat correction is normally handled once, right at import — reopen this only if it drifted or needs redoing"
                style={{
                  height: 20,
                  borderRadius: 0,
                  padding: '0 6px',
                  fontSize: 10,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text-2)'
                }}
              >
                re-pick beat
              </button>
              <button
                onClick={() => dispatch({ type: 'ZERO_OFFSET', key: groupOffsetKey })}
                style={{
                  height: 20,
                  borderRadius: 0,
                  padding: '0 6px',
                  fontSize: 10,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text-2)'
                }}
              >
                zero
              </button>
            </div>
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
                borderRadius: 0,
                padding: '0 6px',
                fontSize: 10,
                background: 'var(--ra-bg-row-active)',
                color: unlinked ? 'var(--ra-text-2)' : 'var(--ra-mute-on)',
                border: `1px solid ${unlinked ? 'var(--ra-border)' : 'color-mix(in srgb, var(--ra-mute-on) 55%, transparent)'}`
              }}
            >
              {unlinked ? 'relink group' : 'unlink group'}
            </button>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {rifff.stems.map((stem) => {
              const stemOffsetKey = resolveOffsetKey(state, groupId, stem.slot)
              const stemOffsetSteps = state.off[stemOffsetKey] ?? 0
              const stemLabels = offsetLabels(stemOffsetSteps, snapDiv, state.bpm)
              return (
                <Fragment key={stem.slot}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 24 }}>
                    <button
                      onClick={() => dispatch({ type: 'CYCLE_TYPE', groupId, slot: stem.slot })}
                      title="click to change sound type"
                      style={{
                        width: 6,
                        height: 12,
                        borderRadius: 0,
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
                  </div>
                  {unlinked && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginLeft: 13,
                        marginBottom: 2
                      }}
                    >
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'NUDGE_OFFSET',
                            key: stemOffsetKey,
                            delta: -fineNudgeDelta(state.bpm, snapDiv)
                          })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 0,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          fontSize: 9,
                          color: stemOffsetSteps ? typeColorVar(stem.type) : 'var(--ra-text-3)',
                          minWidth: 24
                        }}
                      >
                        {stemLabels.ms}
                      </span>
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'NUDGE_OFFSET',
                            key: stemOffsetKey,
                            delta: fineNudgeDelta(state.bpm, snapDiv)
                          })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 0,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        +
                      </button>
                      <button
                        onClick={() => dispatch({ type: 'ZERO_OFFSET', key: stemOffsetKey })}
                        style={{
                          height: 16,
                          borderRadius: 0,
                          padding: '0 5px',
                          fontSize: 9,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text-2)'
                        }}
                      >
                        zero
                      </button>
                    </div>
                  )}
                </Fragment>
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
