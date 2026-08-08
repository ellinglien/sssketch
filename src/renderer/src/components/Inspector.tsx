import { Fragment } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { stretchRatio } from '../state/selectors'
import { offsetLabels } from '@shared/visuals'
import { SNAP_DIVS } from '../state/store'
import { PolarGlyph } from './PolarGlyph'
import { stemColorVar, typeColorVar } from '../theme/typeColor'
import { EditableText } from './EditableText'
import { formatBpm } from '@shared/format'
import type { Stem } from '@shared/types'

// A short, real summary of what's actually IN this rifff -- "drums, bass"
// -- rather than its arbitrary, often LORE-auto-generated name ("ivory
// osprey"), which carries no information about the clip's actual content.
// Same "most common types first, capped so it stays short" shape as
// buildAlsXml.ts's own summarizeSoundTypes, kept as a separate small copy
// here rather than a shared import -- that one runs in the main process
// against export data, this one's a presentational helper for a single
// component, and the two have no other reason to be coupled.
function summarizeStemTypes(stems: Stem[]): string {
  const counts = new Map<string, number>()
  for (const s of stems) counts.set(s.type, (counts.get(s.type) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type)
    .join(', ')
}

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
        </div>
      </div>
    )
  }

  const rifff = state.rifffs[groupId]
  const color = stemColorVar(rifff.stems[0])
  const stemTypeSummary = summarizeStemTypes(rifff.stems)
  const stretchOn = state.stretch[groupId] ?? true
  const isOneShot = rifff.stems.length === 1 && !!rifff.stems[0].oneShot
  const ratio = stretchRatio(state, groupId)
  const groupOffsetKey = groupId
  const groupOffsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const labels = offsetLabels(groupOffsetSteps, snapDiv, state.bpm)

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
          {/* The "remove from timeline" button that used to live here was
              redundant with the Delete key (which already does the exact
              same REMOVE_FROM_TIMELINE dispatch, see App.tsx's keydown
              handler) -- removed rather than kept as a second way to do
              the same thing. */}
          <span className="ra-eyebrow">inspector</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <PolarGlyph stems={rifff.stems} identityColor={color} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Real, non-arbitrary info leads -- what's actually IN this
                  clip, not its (often LORE-auto-generated, meaningless)
                  name. The name is still right here and still editable,
                  just visually secondary now -- see EditableText below. */}
              <div style={{ fontSize: 11, fontWeight: 700 }}>
                {rifff.stems.length} stem{rifff.stems.length === 1 ? '' : 's'}
                {stemTypeSummary && ` — ${stemTypeSummary}`}
              </div>
              {/* Only ever populated for LORE-sourced riffs (see Rifff.key's
                  own doc comment) -- absent for one-shots, recordings,
                  folder drag-and-drops, anything without that provenance. */}
              {rifff.key && (
                <div style={{ fontSize: 10, color: 'var(--ra-text-3)', marginTop: 2 }}>
                  {rifff.key}
                </div>
              )}
              <EditableText
                value={rifff.name}
                onCommit={(name) => dispatch({ type: 'RENAME_RIFFF', groupId, name })}
                title="click to rename"
                style={{ fontSize: 10, fontWeight: 400, color: 'var(--ra-text-3)', marginTop: 2 }}
              />
            </div>
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

      {!isOneShot &&
        section(
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
                <span style={{ fontSize: 11, fontWeight: 700 }}>{formatBpm(rifff.bpm)}</span>
                <span style={{ margin: '0 6px', fontSize: 11 }}>→</span>
                <span style={{ fontSize: 11, fontWeight: 700, color }}>{formatBpm(state.bpm)}</span>
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
          {/* No repeated "1ms steps" caption here -- the header row right
              above already says "1ms/step" once; stating it a second time
              between the buttons was pure redundancy, not information. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: groupOffsetSteps ? color : 'var(--ra-text-2)'
              }}
            >
              {labels.ms}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 6,
              marginTop: 8
            }}
          >
            <button
              onClick={() => onOpenBeatPicker(groupId)}
              title="loop start is normally picked once, right at import — reopen this only if it drifted or needs redoing"
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
              pick loop start
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
        </>
      )}

      {section(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ra-eyebrow">stems</span>
            {/* Meaningless (and hidden) for an already-single-stem rifff —
                there'd be nothing to split apart. One-way: there's no
                "regroup" — see UNGROUP's own doc comment in store.ts. */}
            {rifff.stems.length > 1 && (
              <button
                onClick={() => dispatch({ type: 'UNGROUP', groupId })}
                title="split every stem into its own independent clip — cannot be undone back into a group"
                style={{
                  height: 20,
                  borderRadius: 0,
                  padding: '0 6px',
                  fontSize: 10,
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-mute-on)',
                  border: '1px solid color-mix(in srgb, var(--ra-mute-on) 55%, transparent)'
                }}
              >
                ungroup
              </button>
            )}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {rifff.stems.map((stem) => {
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
                        // typeColorVar, not stemColorVar -- this swatch IS
                        // the sound-type editor (click cycles stem.type), so
                        // it needs to show the stem's real, current type
                        // color even for a recorded take, not a
                        // recordedInApp override that would mask what
                        // clicking here actually changes.
                        background: typeColorVar(stem.type),
                        border: 'none',
                        padding: 0
                      }}
                    />
                    <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{stem.slot}</span>
                    <EditableText
                      value={stem.name}
                      onCommit={(name) =>
                        dispatch({ type: 'RENAME_STEM', groupId, slot: stem.slot, name })
                      }
                      title="click to rename"
                      style={{
                        flex: 1,
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    />
                    {stem.author && (
                      <span
                        title={`created by ${stem.author}`}
                        style={{
                          fontSize: 9,
                          color: 'var(--ra-text-3)',
                          flexShrink: 0,
                          maxWidth: 60,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {stem.author}
                      </span>
                    )}
                  </div>
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
