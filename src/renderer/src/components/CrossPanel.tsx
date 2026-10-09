import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import {
  addCrossSource,
  assembleCrossRifff,
  clearCrossCenter,
  crossCommitIsCurrent,
  crossParentOnSide,
  crossSourceForRow,
  finishCrossGainDrag,
  moveCrossRow,
  previewCrossGain,
  redoCross,
  removeCrossRow,
  swapCrossSides,
  toggleCrossAudible,
  toggleCrossSolo,
  undoCross,
  type CrossCenterRow,
  type CrossDraft,
  type CrossParent,
  type CrossSourceOccurrence
} from '@shared/cross'
import { MAX_RIFFF_STEM_SLOTS } from '@shared/riffStemSlots'
import type { Stem } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { LoadingLoader } from './LoadingLoader'
import { useAppSelector, useDispatch } from '../state/StoreContext'
import { resolvedPlayedBarsFromFields } from '../state/selectors'
import { useCrossPreview, type CrossPreviewMode } from '../state/useCrossPreview'

const SOURCE_DRAG_TYPE = 'application/x-sssketch-cross-source'
const ROW_DRAG_TYPE = 'application/x-sssketch-cross-row'

function sourceMembers(parent: CrossParent): { stem: Omit<Stem, 'slot'>; gain: number }[] {
  return parent.sources.flatMap((source) =>
    source.stem ? [{ stem: source.stem, gain: source.gain }] : []
  )
}

function centerMembers(
  draft: CrossDraft,
  audibleOnly: boolean
): { stem: Omit<Stem, 'slot'>; gain: number }[] {
  return draft.center.flatMap((row) => {
    const source = crossSourceForRow(draft, row)
    if (!source?.stem || (audibleOnly && !row.audible)) return []
    return [{ stem: source.stem, gain: row.gain }]
  })
}

function centerLoopBars(draft: CrossDraft): number {
  const bars = centerMembers(draft, false).map(({ stem }) => stem.barLength)
  return bars.length > 0 ? Math.max(...bars) : 1
}

function SourceRow({
  source,
  added,
  active,
  onAdd,
  onPreview
}: {
  source: CrossSourceOccurrence
  added: boolean
  active: boolean
  onAdd: () => void
  onPreview: () => void
}): React.JSX.Element {
  const stem = source.stem
  return (
    <div
      draggable={stem !== null}
      onDragStart={(event) => {
        if (!stem) return
        event.dataTransfer.setData(SOURCE_DRAG_TYPE, source.id)
        event.dataTransfer.effectAllowed = 'copyMove'
      }}
      style={{
        minHeight: 54,
        border: `1px solid ${active ? 'var(--ra-playhead)' : 'var(--ra-border)'}`,
        background: 'var(--ra-bg-row)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 6,
        padding: 5,
        opacity: stem ? 1 : 0.45
      }}
    >
      <button
        onClick={onPreview}
        disabled={!stem}
        title={stem ? (active ? 'stop preview' : 'preview stem') : 'stem unavailable'}
        style={{
          position: 'relative',
          minWidth: 0,
          height: 42,
          overflow: 'hidden',
          border: 'none',
          padding: 0,
          background: 'var(--ra-bg-bar)',
          cursor: stem ? 'pointer' : 'default'
        }}
      >
        {stem && <Waveform path={stem.path} color={typeColorVar(stem.type)} />}
        <span
          style={{
            position: 'absolute',
            left: 5,
            top: 3,
            fontSize: 8,
            color: 'var(--ra-text)',
            textShadow: '0 1px 2px var(--ra-bg)'
          }}
        >
          {stem?.name ?? 'unavailable'}
        </span>
        {active && (
          <span style={{ position: 'absolute', right: 5, bottom: 3, fontSize: 9 }}>■</span>
        )}
      </button>
      <button
        onClick={onAdd}
        disabled={!stem || added}
        title={added ? 'already added' : stem ? 'add to cross' : 'stem unavailable'}
        style={{
          width: 34,
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          background: added ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          color: added ? 'var(--ra-stretch-on)' : 'var(--ra-text)',
          cursor: !stem || added ? 'default' : 'pointer'
        }}
      >
        {added ? '✓' : '+'}
      </button>
    </div>
  )
}

function SourceColumn({
  parent,
  draft,
  activeMode,
  onAdd,
  onPreviewSource,
  onPreviewParent
}: {
  parent: CrossParent
  draft: CrossDraft
  activeMode: CrossPreviewMode | null
  onAdd: (sourceId: string) => void
  onPreviewSource: (source: CrossSourceOccurrence) => void
  onPreviewParent: (parent: CrossParent) => void
}): React.JSX.Element {
  const added = useMemo(() => new Set(draft.center.map((row) => row.sourceId)), [draft.center])
  return (
    <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
        <span
          className="ra-eyebrow"
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {parent.label}
        </span>
        <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>{Math.round(parent.bpm)} bpm</span>
        <button
          onClick={() => onPreviewParent(parent)}
          style={{
            height: 24,
            borderRadius: 0,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)'
          }}
        >
          {activeMode === `riff:${parent.id}` ? '■ stop' : '▶ riff'}
        </button>
      </div>
      {parent.sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          added={added.has(source.id)}
          active={activeMode === `source:${source.id}`}
          onAdd={() => onAdd(source.id)}
          onPreview={() => onPreviewSource(source)}
        />
      ))}
    </section>
  )
}

function CenterRow({
  row,
  source,
  index,
  onDropAt,
  onDraftChange
}: {
  row: CrossCenterRow
  source: CrossSourceOccurrence
  index: number
  onDropAt: (event: React.DragEvent, index: number) => void
  onDraftChange: Dispatch<SetStateAction<CrossDraft | null>>
}): React.JSX.Element {
  const stem = source.stem!
  function beginGainDrag(event: React.PointerEvent): void {
    event.preventDefault()
    const startY = event.clientY
    const startGain = row.gain
    const move = (next: PointerEvent): void => {
      const gain = Math.max(0, Math.min(1, startGain + (startY - next.clientY) / 90))
      onDraftChange((draft) => (draft ? previewCrossGain(draft, row.id, gain) : draft))
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      onDraftChange((draft) => (draft ? finishCrossGainDrag(draft, row.id, startGain) : draft))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(ROW_DRAG_TYPE, row.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDropAt(event, index)}
      style={{
        minHeight: 54,
        border: '1px solid var(--ra-border-strong)',
        background: 'var(--ra-bg-row-active)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 28px 28px 28px',
        gap: 4,
        padding: 5
      }}
    >
      <button
        onPointerDown={beginGainDrag}
        title="drag vertically to adjust gain"
        style={{
          position: 'relative',
          minWidth: 0,
          height: 42,
          overflow: 'hidden',
          border: 'none',
          padding: 0,
          background: 'var(--ra-bg-bar)',
          cursor: 'ns-resize'
        }}
      >
        <Waveform path={stem.path} color="var(--ra-text-4)" />
        {row.audible && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              clipPath: `inset(${(1 - row.gain) * 100}% 0 0 0)`
            }}
          >
            <Waveform path={stem.path} color={typeColorVar(stem.type)} />
          </div>
        )}
        <span style={{ position: 'absolute', left: 5, top: 3, fontSize: 8 }}>
          {index + 1} · {stem.name}
        </span>
        {row.audible && (
          <span
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${(1 - row.gain) * 100}%`,
              borderTop: '1px solid var(--ra-text)'
            }}
          />
        )}
      </button>
      <button
        onClick={() =>
          onDraftChange((draft) => (draft ? toggleCrossAudible(draft, row.id) : draft))
        }
        title={row.audible ? 'mute' : 'unmute'}
        style={{ borderRadius: 0, border: '1px solid var(--ra-border)', background: 'transparent' }}
      >
        m
      </button>
      <button
        onClick={() => onDraftChange((draft) => (draft ? toggleCrossSolo(draft, row.id) : draft))}
        title="solo"
        style={{ borderRadius: 0, border: '1px solid var(--ra-border)', background: 'transparent' }}
      >
        s
      </button>
      <button
        onClick={() => onDraftChange((draft) => (draft ? removeCrossRow(draft, row.id) : draft))}
        title="remove"
        style={{ borderRadius: 0, border: '1px solid var(--ra-border)', background: 'transparent' }}
      >
        ×
      </button>
    </div>
  )
}

export function CrossPanel({
  draft,
  setDraft,
  currentProjectKey,
  onBack
}: {
  draft: CrossDraft
  setDraft: Dispatch<SetStateAction<CrossDraft | null>>
  currentProjectKey: string
  onBack: () => void
}): React.JSX.Element {
  const dispatch = useDispatch()
  const rifffs = useAppSelector((state) => state.rifffs)
  const playedBars = useAppSelector((state) => state.playedBars)
  const { preview, stop } = useCrossPreview()
  const [activeMode, setActiveMode] = useState<CrossPreviewMode | null>(null)
  const [committing, setCommitting] = useState<'shelf' | 'timeline' | null>(null)
  const [committed, setCommitted] = useState<'shelf' | 'timeline' | null>(null)
  const draftRef = useRef(draft)
  const currentProjectKeyRef = useRef(currentProjectKey)
  const committingRef = useRef(false)
  const left = crossParentOnSide(draft, 'left')
  const right = crossParentOnSide(draft, 'right')

  useEffect(() => {
    draftRef.current = draft
    currentProjectKeyRef.current = currentProjectKey
  }, [currentProjectKey, draft])

  const playCenter = useCallback(async (): Promise<void> => {
    const members = centerMembers(draft, true)
    if (members.length === 0) {
      stop()
      setActiveMode(null)
      return
    }
    setActiveMode('center')
    await preview('center', members, draft.targetBpm, centerLoopBars(draft))
  }, [draft, preview, stop])

  useEffect(() => {
    if (activeMode !== 'center') return
    const members = centerMembers(draft, true)
    if (members.length === 0) {
      stop()
      void Promise.resolve().then(() => setActiveMode(null))
      return
    }
    void preview('center', members, draft.targetBpm, centerLoopBars(draft))
    // revision is the intended trigger; the matching immutable draft is
    // captured here without re-arming on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.revision])

  function togglePreview(
    mode: CrossPreviewMode,
    members: ReturnType<typeof sourceMembers>,
    loopBars: number
  ): void {
    if (activeMode === mode) {
      stop()
      setActiveMode(null)
      return
    }
    setActiveMode(mode)
    void preview(mode, members, draft.targetBpm, loopBars)
  }

  function handleDropAt(event: React.DragEvent, index: number): void {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData(SOURCE_DRAG_TYPE)
    const rowId = event.dataTransfer.getData(ROW_DRAG_TYPE)
    if (sourceId) setDraft((value) => (value ? addCrossSource(value, sourceId, index) : value))
    else if (rowId) setDraft((value) => (value ? moveCrossRow(value, rowId, index) : value))
  }

  async function commit(destination: 'shelf' | 'timeline'): Promise<void> {
    if (committingRef.current) return
    const revision = draft.revision
    const projectKey = draft.projectKey
    const assembly = assembleCrossRifff(draft)
    if (!assembly) return
    committingRef.current = true
    setCommitting(destination)
    setCommitted(null)
    try {
      // Assembly is synchronous today. Keeping these captured guards here is
      // deliberate: phase materialization can make this await in a later
      // revision without allowing a stale Cross snapshot into another project.
      await Promise.resolve()
      const current = draftRef.current
      if (!crossCommitIsCurrent(revision, projectKey, current, currentProjectKeyRef.current)) return
      if (destination === 'shelf') {
        dispatch({ type: 'ADD_TO_SHELF', rifff: assembly.rifff, vol: assembly.vol })
      } else {
        const ends = Object.values(rifffs)
          .filter((rifff) => rifff.startBar !== undefined)
          .map(
            (rifff) =>
              (rifff.startBar ?? 0) +
              resolvedPlayedBarsFromFields(playedBars[rifff.groupId], rifff.barLength)
          )
        dispatch({
          type: 'PLACE_LOOP_ON_TIMELINE',
          stems: [assembly.rifff],
          startBar: ends.length > 0 ? Math.max(...ends) : 0,
          vol: assembly.vol
        })
      }
      setCommitted(destination)
      window.setTimeout(() => setCommitted(null), 800)
    } finally {
      committingRef.current = false
      setCommitting(null)
    }
  }

  const remainingSlots = MAX_RIFFF_STEM_SLOTS - draft.center.length
  const placeholders = Math.max(
    0,
    Math.min(
      remainingSlots,
      Math.max(1, Math.max(left.sources.length, right.sources.length) - draft.center.length)
    )
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <style>{`
        .ra-cross-button {
          min-height: 26px;
          border: 1px solid var(--ra-border-strong);
          border-radius: 0;
          padding: 0 10px;
          background: var(--ra-bg-row-active);
          color: var(--ra-text);
          font-size: 10px;
        }
        .ra-cross-button:disabled {
          opacity: var(--ra-opacity-disabled);
          cursor: default;
        }
        .ra-cross-button[data-active='true'] {
          background: var(--ra-play-on);
          color: var(--ra-play-on-ink);
        }
        .ra-cross-primary {
          min-width: 112px;
        }
        .ra-cross-close {
          width: 34px;
          padding: 0;
          font-size: 14px;
        }
      `}</style>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          borderBottom: '1px solid var(--ra-border)'
        }}
      >
        <span className="ra-eyebrow">cross</span>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
          project tempo · {Math.round(draft.targetBpm)} bpm
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="ra-cross-button"
          onClick={() => setDraft((value) => (value ? undoCross(value) : value))}
          disabled={!!committing || !draft.past.length}
        >
          undo
        </button>
        <button
          className="ra-cross-button"
          onClick={() => setDraft((value) => (value ? redoCross(value) : value))}
          disabled={!!committing || !draft.future.length}
        >
          redo
        </button>
        <button
          className="ra-cross-button"
          onClick={() => setDraft((value) => (value ? swapCrossSides(value) : value))}
          disabled={!!committing}
        >
          swap sides
        </button>
        <button
          className="ra-cross-button"
          onClick={() => setDraft((value) => (value ? clearCrossCenter(value) : value))}
          disabled={!!committing || draft.center.length === 0}
        >
          clear
        </button>
        <button
          className="ra-cross-button ra-cross-primary"
          onClick={() => void commit('shelf')}
          disabled={!!committing || draft.center.length === 0}
        >
          {committing === 'shelf' ? (
            <LoadingLoader size={12} />
          ) : committed === 'shelf' ? (
            '✓ added to shelf'
          ) : (
            'add to shelf'
          )}
        </button>
        <button
          className="ra-cross-button ra-cross-primary"
          onClick={() => void commit('timeline')}
          disabled={!!committing || draft.center.length === 0}
        >
          {committing === 'timeline' ? (
            <LoadingLoader size={12} />
          ) : committed === 'timeline' ? (
            '✓ added to timeline'
          ) : (
            'add to timeline'
          )}
        </button>
        <button
          className="ra-cross-button ra-cross-close"
          onClick={onBack}
          disabled={!!committing}
          aria-label="close Cross"
          title="close"
        >
          ×
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 1.25fr) minmax(180px, 1fr)',
          gap: 12,
          padding: 12,
          overflow: 'auto',
          flex: 1,
          minHeight: 0,
          pointerEvents: committing ? 'none' : 'auto',
          opacity: committing ? 0.65 : 1
        }}
      >
        <SourceColumn
          parent={left}
          draft={draft}
          activeMode={activeMode}
          onAdd={(sourceId) =>
            setDraft((value) => (value ? addCrossSource(value, sourceId) : value))
          }
          onPreviewSource={(source) =>
            source.stem &&
            togglePreview(
              `source:${source.id}`,
              [{ stem: source.stem, gain: source.gain }],
              source.stem.barLength
            )
          }
          onPreviewParent={(parent) =>
            togglePreview(`riff:${parent.id}`, sourceMembers(parent), parent.barLength)
          }
        />

        <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
            <span className="ra-eyebrow" style={{ flex: 1 }}>
              new cross
            </span>
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>
              {draft.center.length} / {MAX_RIFFF_STEM_SLOTS}
            </span>
            <button
              className="ra-cross-button"
              data-active={activeMode === 'center'}
              onClick={() =>
                activeMode === 'center' ? (stop(), setActiveMode(null)) : void playCenter()
              }
              disabled={draft.center.length === 0}
            >
              {activeMode === 'center' ? '■ stop' : '▶ mix'}
            </button>
          </div>
          {draft.center.map((row, index) => {
            const source = crossSourceForRow(draft, row)
            return source?.stem ? (
              <CenterRow
                key={row.id}
                row={row}
                source={source}
                index={index}
                onDropAt={handleDropAt}
                onDraftChange={setDraft}
              />
            ) : null
          })}
          {Array.from({ length: placeholders }, (_, offset) => {
            const index = draft.center.length + offset
            return (
              <div
                key={`empty-${index}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDropAt(event, index)}
                style={{
                  height: 52,
                  border: '1px dashed var(--ra-border)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--ra-text-4)',
                  fontSize: 9
                }}
              >
                drop stem here
              </div>
            )
          })}
        </section>

        <SourceColumn
          parent={right}
          draft={draft}
          activeMode={activeMode}
          onAdd={(sourceId) =>
            setDraft((value) => (value ? addCrossSource(value, sourceId) : value))
          }
          onPreviewSource={(source) =>
            source.stem &&
            togglePreview(
              `source:${source.id}`,
              [{ stem: source.stem, gain: source.gain }],
              source.stem.barLength
            )
          }
          onPreviewParent={(parent) =>
            togglePreview(`riff:${parent.id}`, sourceMembers(parent), parent.barLength)
          }
        />
      </div>
    </div>
  )
}
