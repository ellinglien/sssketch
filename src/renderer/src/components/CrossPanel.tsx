import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import {
  addCrossDiscoveredSource,
  addCrossSource,
  assembleCrossRifff,
  clearCrossCenter,
  crossCommitIsCurrent,
  crossParentOnSide,
  crossSourceForRow,
  duplicateCrossRow,
  finishCrossGainDrag,
  moveCrossRow,
  previewCrossGain,
  redoCross,
  removeCrossRow,
  replaceCrossRowSource,
  setCrossTargetBpm,
  swapCrossSides,
  toggleCrossAudible,
  toggleCrossSolo,
  undoCross,
  type CrossCenterRow,
  type CrossDraft,
  type CrossParent,
  type CrossSourceOccurrence
} from '@shared/cross'
import {
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_SLOT_KIND_OPTIONS,
  isTraitSlotKind,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'
import { DEFAULT_DISCOVER_CHAOS, pickReroll, rankCandidates } from '@shared/discoverRanking'
import { DEFAULT_SOURCE_LEAN, drawSoundSource } from '@shared/discoverSlotModifier'
import { MAX_RIFFF_STEM_SLOTS } from '@shared/riffStemSlots'
import type { Stem } from '@shared/types'
import type { DiscoverCandidate } from '@shared/discoverCandidate'
import { typeColorVar } from '../theme/typeColor'
import { discoverSlotKindForSoundType } from '../audio/discoverSeed'
import { Waveform } from './Waveform'
import { LoadingLoader } from './LoadingLoader'
import { Dial } from './Dial'
import { resolveCandidateStem } from './discoverCandidateStem'
import { Copy, Shuffle, SkipForward } from '@phosphor-icons/react'
import { useAppSelector, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { resolvedPlayedBarsFromFields } from '../state/selectors'
import { useCrossPreview, type CrossPreviewMode } from '../state/useCrossPreview'

const SOURCE_DRAG_TYPE = 'application/x-sssketch-cross-source'
const ROW_DRAG_TYPE = 'application/x-sssketch-cross-row'
type CrossTarget = 'left' | 'center' | 'right'

function cryptoFraction(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000
}

function CrossPlaybackIndicator(): React.JSX.Element {
  return (
    <span className="ra-cross-playing-indicator" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

function CrossWaveformPlayhead({ pct }: { pct: number | null }): React.JSX.Element | null {
  if (pct === null) return null
  return (
    <span className="ra-cross-waveform-playhead" style={{ left: `${pct}%` }} aria-hidden="true" />
  )
}

function randomCrossSlotKind(): DiscoverSlotKind {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % DISCOVER_SLOT_KIND_OPTIONS.length
  return DISCOVER_SLOT_KIND_OPTIONS[index]
}

function sourceMembers(
  parent: CrossParent,
  muted: ReadonlySet<string> = new Set()
): { stem: Omit<Stem, 'slot'>; gain: number }[] {
  return parent.sources.flatMap((source) =>
    source.stem && !muted.has(source.id) ? [{ stem: source.stem, gain: source.gain }] : []
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

function discoverSource(
  candidate: DiscoverCandidate,
  kinds: DiscoverSlotKind[],
  stem: Awaited<ReturnType<typeof resolveCandidateStem>>
): CrossSourceOccurrence | null {
  if (!stem) return null
  return {
    id: `discover:${crypto.randomUUID()}`,
    parentId: 'discover',
    sourceSlot: 0,
    stem: {
      author: stem.author,
      name: stem.name,
      type: stem.type,
      path: stem.path,
      durationSec: stem.durationSec,
      barLength: stem.barLength,
      phaseSourcePath: stem.phaseSourcePath,
      phaseBars: stem.phaseBars,
      creationTime: stem.creationTime
    },
    gain: 1,
    discover: { candidate, kinds }
  }
}

function sampleSource(result: {
  name: string
  path: string
  durationSec: number
  barLength: number
}): CrossSourceOccurrence {
  return {
    id: `sample:${crypto.randomUUID()}`,
    parentId: 'sample',
    sourceSlot: 0,
    stem: { author: '', type: 'fx', ...result },
    gain: 1
  }
}

function SourceRow({
  source,
  added,
  active,
  playheadPct,
  audible,
  soloed,
  onAdd,
  onSelect,
  onToggleMute,
  onToggleSolo
}: {
  source: CrossSourceOccurrence
  added: boolean
  active: boolean
  playheadPct: number | null
  audible: boolean
  soloed: boolean
  onAdd: () => void
  onSelect: () => void
  onToggleMute: () => void
  onToggleSolo: () => void
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
        gridTemplateColumns: '28px 28px minmax(0, 1fr) 34px',
        gap: 4,
        padding: 5,
        opacity: stem ? (audible ? 1 : 0.55) : 0.45
      }}
    >
      <button
        onClick={onToggleMute}
        disabled={!stem}
        title={audible ? 'mute' : 'unmute'}
        data-active={!audible}
        className="ra-cross-row-button"
      >
        m
      </button>
      <button
        onClick={onToggleSolo}
        disabled={!stem}
        title={soloed ? 'unsolo' : 'solo'}
        data-active={soloed}
        className="ra-cross-row-button"
      >
        s
      </button>
      <button
        onClick={onSelect}
        disabled={!stem}
        title={stem ? 'play this riff' : 'stem unavailable'}
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
        {stem && <CrossWaveformPlayhead pct={playheadPct} />}
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
  selected,
  playing,
  playheadPct,
  muted,
  onAdd,
  onSelect,
  onToggleMute,
  onToggleSolo
}: {
  parent: CrossParent
  draft: CrossDraft
  selected: boolean
  playing: boolean
  playheadPct: number | null
  muted: ReadonlySet<string>
  onAdd: (sourceId: string) => void
  onSelect: () => void
  onToggleMute: (parent: CrossParent, sourceId: string) => void
  onToggleSolo: (parent: CrossParent, sourceId: string) => void
}): React.JSX.Element {
  const added = useMemo(() => new Set(draft.center.map((row) => row.sourceId)), [draft.center])
  const availableCount = parent.sources.filter((source) => source.stem).length
  const audibleCount = parent.sources.filter(
    (source) => source.stem && !muted.has(source.id)
  ).length
  return (
    <section
      style={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        outline: selected ? '1px solid var(--ra-border-strong)' : '1px solid transparent',
        outlineOffset: 4
      }}
    >
      <button
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 28,
          border: 'none',
          padding: 0,
          background: 'transparent',
          color: 'inherit',
          textAlign: 'left'
        }}
      >
        <span
          className="ra-eyebrow"
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {parent.label}
        </span>
        <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>{Math.round(parent.bpm)} bpm</span>
        <span
          style={{ width: 12, color: selected ? 'var(--ra-playhead)' : 'var(--ra-text-4)' }}
          aria-label={selected ? (playing ? 'playing' : 'selected') : undefined}
        >
          {selected && playing ? <CrossPlaybackIndicator /> : selected ? '●' : ''}
        </span>
      </button>
      {parent.sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          added={added.has(source.id)}
          active={selected && playing}
          playheadPct={selected && playing ? playheadPct : null}
          audible={!muted.has(source.id)}
          soloed={availableCount > 1 && audibleCount === 1 && !muted.has(source.id)}
          onAdd={() => onAdd(source.id)}
          onSelect={onSelect}
          onToggleMute={() => onToggleMute(parent, source.id)}
          onToggleSolo={() => onToggleSolo(parent, source.id)}
        />
      ))}
    </section>
  )
}

function CenterRow({
  row,
  source,
  index,
  soloed,
  rolling,
  playheadPct,
  onDropAt,
  onDraftChange,
  onSelect,
  onSkip,
  onRandomize,
  onDuplicate
}: {
  row: CrossCenterRow
  source: CrossSourceOccurrence
  index: number
  soloed: boolean
  rolling: boolean
  playheadPct: number | null
  onDropAt: (event: React.DragEvent, index: number) => void
  onDraftChange: Dispatch<SetStateAction<CrossDraft | null>>
  onSelect: () => void
  onSkip: () => void
  onRandomize: () => void
  onDuplicate: () => void
}): React.JSX.Element {
  const stem = source.stem!
  function beginGainDrag(event: React.PointerEvent): void {
    event.preventDefault()
    const startY = event.clientY
    const startGain = row.gain
    let moved = false
    const move = (next: PointerEvent): void => {
      if (Math.abs(startY - next.clientY) >= 3) moved = true
      if (!moved) return
      const gain = Math.max(0, Math.min(1, startGain + (startY - next.clientY) / 90))
      onDraftChange((draft) => (draft ? previewCrossGain(draft, row.id, gain) : draft))
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      if (moved) {
        onDraftChange((draft) => (draft ? finishCrossGainDrag(draft, row.id, startGain) : draft))
      } else {
        onSelect()
      }
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
        gridTemplateColumns: '28px 28px minmax(0, 1fr) 28px 28px 28px 28px',
        gap: 4,
        padding: 5
      }}
    >
      <button
        onClick={() =>
          onDraftChange((draft) => (draft ? toggleCrossAudible(draft, row.id) : draft))
        }
        title={row.audible ? 'mute' : 'unmute'}
        data-active={!row.audible}
        className="ra-cross-row-button"
      >
        m
      </button>
      <button
        onClick={() => onDraftChange((draft) => (draft ? toggleCrossSolo(draft, row.id) : draft))}
        title={soloed ? 'unsolo' : 'solo'}
        data-active={soloed}
        className="ra-cross-row-button"
      >
        s
      </button>
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
        <CrossWaveformPlayhead pct={playheadPct} />
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
        onClick={onSkip}
        disabled={rolling}
        title="skip to a similar stem"
        className="ra-cross-row-button"
      >
        {rolling ? <LoadingLoader size={10} /> : <SkipForward size={12} />}
      </button>
      <button
        onClick={onRandomize}
        disabled={rolling}
        title="any stem"
        className="ra-cross-row-button"
      >
        <Shuffle size={12} />
      </button>
      <button onClick={onDuplicate} title="duplicate" className="ra-cross-row-button">
        <Copy size={12} />
      </button>
      <button
        onClick={() => onDraftChange((draft) => (draft ? removeCrossRow(draft, row.id) : draft))}
        title="remove"
        className="ra-cross-row-button"
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
  const projectBpm = useAppSelector((state) => state.bpm)
  const playing = usePlaying()
  const pos = usePos()
  const { preview } = useCrossPreview()
  const [selectedTarget, setSelectedTarget] = useState<CrossTarget>(() =>
    draft.center.length > 0 ? 'center' : 'left'
  )
  const [committing, setCommitting] = useState<'shelf' | 'timeline' | null>(null)
  const [committed, setCommitted] = useState<'shelf' | 'timeline' | null>(null)
  const [sideMuted, setSideMuted] = useState<Set<string>>(() => new Set())
  const [rollingRows, setRollingRows] = useState<Set<string>>(() => new Set())
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const draftRef = useRef(draft)
  const currentProjectKeyRef = useRef(currentProjectKey)
  const committingRef = useRef(false)
  const left = crossParentOnSide(draft, 'left')
  const right = crossParentOnSide(draft, 'right')
  const sideMutedKey = [...sideMuted].sort().join('|')

  useEffect(() => {
    draftRef.current = draft
    currentProjectKeyRef.current = currentProjectKey
  }, [currentProjectKey, draft])

  useEffect(() => {
    if (draft.targetBpm === projectBpm) return
    setDraft((value) => (value ? setCrossTargetBpm(value, projectBpm) : value))
  }, [draft.targetBpm, projectBpm, setDraft])

  function toggleSideMute(sourceId: string): void {
    setSideMuted((before) => {
      const next = new Set(before)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }

  function toggleSideSolo(parent: CrossParent, sourceId: string): void {
    setSideMuted((before) => {
      const available = parent.sources.filter((source) => source.stem).map((source) => source.id)
      const audible = available.filter((id) => !before.has(id))
      const restoreAll = audible.length === 1 && audible[0] === sourceId
      const next = new Set(before)
      for (const id of available) {
        if (restoreAll || id === sourceId) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  async function findDiscoveredSource(
    kinds: DiscoverSlotKind[],
    replacingSourceId?: string
  ): Promise<CrossSourceOccurrence | null> {
    const current = draftRef.current
    const sourceDraw = drawSoundSource(current.sourceLean ?? DEFAULT_SOURCE_LEAN, cryptoFraction)
    let candidates = await window.rifffApi.getDiscoverCandidates(
      kinds,
      false,
      undefined,
      sourceDraw.first
    )
    const used = new Set(
      current.center.flatMap((row) => {
        const source = crossSourceForRow(current, row)
        return source?.discover ? [source.discover.candidate.stemCID] : []
      })
    )
    const replacing = replacingSourceId
      ? current.discoveredSources?.find((source) => source.id === replacingSourceId)
      : undefined
    if (replacing?.discover) used.add(replacing.discover.candidate.stemCID)
    let unused = candidates.filter((candidate) => !used.has(candidate.stemCID))
    if (unused.length === 0 && sourceDraw.fallback) {
      const fallback = await window.rifffApi.getDiscoverCandidates(
        kinds,
        false,
        undefined,
        sourceDraw.fallback
      )
      const fallbackUnused = fallback.filter((candidate) => !used.has(candidate.stemCID))
      if (fallbackUnused.length > 0 || candidates.length === 0) {
        candidates = fallback
        unused = fallbackUnused
      }
    }
    const pool =
      unused.length > 0
        ? unused
        : candidates.filter((candidate) => {
            return candidate.stemCID !== replacing?.discover?.candidate.stemCID
          })
    const ranked = rankCandidates(pool, {
      targetBpm: current.targetBpm,
      targetTraits: kinds.filter(isTraitSlotKind)
    })
    const picked = pickReroll(ranked, 100 - (current.matching ?? 100 - DEFAULT_DISCOVER_CHAOS))
    if (!picked) return null
    return discoverSource(picked, kinds, await resolveCandidateStem(picked))
  }

  async function findRandomDiscoveredSource(
    kinds: DiscoverSlotKind[],
    replacingSourceId?: string
  ): Promise<CrossSourceOccurrence | null> {
    const draftNow = draftRef.current
    const current = replacingSourceId
      ? draftNow.discoveredSources?.find((source) => source.id === replacingSourceId)
      : undefined
    const sourceDraw = drawSoundSource(draftNow.sourceLean ?? DEFAULT_SOURCE_LEAN, cryptoFraction)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let candidate = await window.rifffApi.getRandomDiscoverCandidate(
        kinds,
        false,
        undefined,
        sourceDraw.first
      )
      if (!candidate && sourceDraw.fallback) {
        candidate = await window.rifffApi.getRandomDiscoverCandidate(
          kinds,
          false,
          undefined,
          sourceDraw.fallback
        )
      }
      if (!candidate) return null
      if (candidate.stemCID === current?.discover?.candidate.stemCID) continue
      return discoverSource(candidate, kinds, await resolveCandidateStem(candidate))
    }
    return null
  }

  async function addDiscoveredStem(kind: DiscoverSlotKind): Promise<void> {
    const key = `add:${kind}`
    const draftId = draftRef.current.id
    const projectKey = draftRef.current.projectKey
    setDiscoverError(null)
    setRollingRows((before) => new Set(before).add(key))
    try {
      const source = await findDiscoveredSource([kind])
      if (!source) {
        setDiscoverError(`no ${DISCOVER_SLOT_KIND_LABEL[kind]} stem found`)
        return
      }
      setDraft((value) =>
        value?.id === draftId && value.projectKey === projectKey
          ? addCrossDiscoveredSource(value, source)
          : value
      )
    } catch (error) {
      console.error('CrossPanel: failed to add a discovered stem:', error)
      setDiscoverError('could not add that stem')
    } finally {
      setRollingRows((before) => {
        const next = new Set(before)
        next.delete(key)
        return next
      })
    }
  }

  async function addRandomStem(): Promise<void> {
    const key = 'add:random'
    const kinds = [randomCrossSlotKind()]
    const draftId = draftRef.current.id
    const projectKey = draftRef.current.projectKey
    setDiscoverError(null)
    setRollingRows((before) => new Set(before).add(key))
    try {
      const source = await findRandomDiscoveredSource(kinds)
      if (!source) {
        setDiscoverError('no random stem found')
        return
      }
      setDraft((value) =>
        value?.id === draftId && value.projectKey === projectKey
          ? addCrossDiscoveredSource(value, source)
          : value
      )
    } catch (error) {
      console.error('CrossPanel: failed to add a random stem:', error)
      setDiscoverError('could not add a random stem')
    } finally {
      setRollingRows((before) => {
        const next = new Set(before)
        next.delete(key)
        return next
      })
    }
  }

  async function skipCenterRow(row: CrossCenterRow): Promise<void> {
    const source = crossSourceForRow(draftRef.current, row)
    if (!source?.stem) return
    const kinds = source.discover?.kinds ?? [discoverSlotKindForSoundType(source.stem.type)]
    const draftId = draftRef.current.id
    const projectKey = draftRef.current.projectKey
    setDiscoverError(null)
    setRollingRows((before) => new Set(before).add(row.id))
    try {
      const replacement = await findDiscoveredSource(kinds, source.id)
      if (!replacement) {
        setDiscoverError('no similar replacement found')
        return
      }
      setDraft((value) =>
        value?.id === draftId && value.projectKey === projectKey
          ? replaceCrossRowSource(value, row.id, replacement)
          : value
      )
    } catch (error) {
      console.error('CrossPanel: failed to skip a center stem:', error)
      setDiscoverError('could not replace that stem')
    } finally {
      setRollingRows((before) => {
        const next = new Set(before)
        next.delete(row.id)
        return next
      })
    }
  }

  async function randomizeCenterRow(row: CrossCenterRow): Promise<void> {
    const source = crossSourceForRow(draftRef.current, row)
    if (!source?.stem) return
    const kinds = source.discover?.kinds ?? [discoverSlotKindForSoundType(source.stem.type)]
    const draftId = draftRef.current.id
    const projectKey = draftRef.current.projectKey
    setDiscoverError(null)
    setRollingRows((before) => new Set(before).add(row.id))
    try {
      const replacement = await findRandomDiscoveredSource(kinds, source.id)
      if (!replacement) {
        setDiscoverError('no random replacement found')
        return
      }
      setDraft((value) =>
        value?.id === draftId && value.projectKey === projectKey
          ? replaceCrossRowSource(value, row.id, replacement)
          : value
      )
    } catch (error) {
      console.error('CrossPanel: failed to randomize a center stem:', error)
      setDiscoverError('could not replace that stem')
    } finally {
      setRollingRows((before) => {
        const next = new Set(before)
        next.delete(row.id)
        return next
      })
    }
  }

  async function addSample(): Promise<void> {
    const draftId = draftRef.current.id
    const projectKey = draftRef.current.projectKey
    const paths = await window.rifffApi.pickDiscoverLoopSeedPaths()
    for (const path of paths) {
      const result = await window.rifffApi.importDiscoverLoopSeed(path, draftRef.current.targetBpm)
      if (!result) continue
      const source = sampleSource(result)
      setDraft((value) =>
        value?.id === draftId && value.projectKey === projectKey
          ? addCrossDiscoveredSource(value, source)
          : value
      )
    }
  }

  function changeTempo(nextBpm: number): void {
    dispatch({ type: 'SET_TEMPO', bpm: nextBpm })
    setDraft((value) => (value ? setCrossTargetBpm(value, nextBpm) : value))
  }

  const playTarget = useCallback(
    async (target: CrossTarget): Promise<void> => {
      let mode: CrossPreviewMode = 'center'
      let members: ReturnType<typeof sourceMembers> = []
      let loopBars = 1
      if (target === 'center') {
        members = centerMembers(draft, true)
        loopBars = centerLoopBars(draft)
      } else {
        const parent = crossParentOnSide(draft, target)
        mode = `riff:${parent.id}`
        members = sourceMembers(parent, sideMuted)
        loopBars = parent.barLength
      }
      if (members.length === 0) {
        dispatch({ type: 'PAUSE' })
        return
      }
      await preview(mode, members, draft.targetBpm, loopBars)
    },
    [dispatch, draft, preview, sideMuted]
  )

  function selectAndPlay(target: CrossTarget): void {
    setSelectedTarget(target)
    void playTarget(target)
  }

  useEffect(() => {
    if (!playing) return
    void playTarget(selectedTarget)
    // Revision and sideMutedKey are the audio-content triggers. playTarget
    // is deliberately omitted: its identity also changes with ordinary
    // renders that do not change what the musician is hearing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.revision, sideMutedKey])

  useEffect(() => {
    function handleSpace(e: KeyboardEvent): void {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (playing) dispatch({ type: 'PAUSE' })
      else void playTarget(selectedTarget)
    }
    window.addEventListener('keydown', handleSpace, { capture: true })
    return () => window.removeEventListener('keydown', handleSpace, { capture: true })
  }, [dispatch, playTarget, playing, selectedTarget])

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
  const selectedLoopBars =
    selectedTarget === 'center'
      ? centerLoopBars(draft)
      : crossParentOnSide(draft, selectedTarget).barLength
  const playheadPct =
    playing && selectedLoopBars > 0
      ? ((((pos % selectedLoopBars) + selectedLoopBars) % selectedLoopBars) / selectedLoopBars) *
        100
      : null
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
        .ra-cross-row-button {
          display: grid;
          place-items: center;
          min-width: 0;
          border: 1px solid var(--ra-border);
          border-radius: 0;
          padding: 0;
          background: transparent;
          color: var(--ra-text-2);
          font-size: 10px;
        }
        .ra-cross-row-button[data-active='true'] {
          background: var(--ra-play-on);
          color: var(--ra-play-on-ink);
        }
        .ra-cross-row-button:disabled {
          color: var(--ra-text-4);
          cursor: default;
        }
        .ra-cross-divider {
          width: 1px;
          align-self: stretch;
          background: var(--ra-border);
        }
        .ra-cross-add-chip {
          border: none;
          padding: 3px 5px;
          background: transparent;
          color: var(--ra-text-2);
          font-size: 9px;
        }
        .ra-cross-add-chip:hover:not(:disabled) {
          color: var(--ra-text);
          background: var(--ra-bg-row-active);
        }
        .ra-cross-add-chip:disabled {
          color: var(--ra-text-4);
          cursor: default;
        }
        .ra-cross-playing-indicator {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 1px;
          width: 12px;
          height: 12px;
          color: var(--ra-playhead);
        }
        .ra-cross-playing-indicator > i {
          width: 2px;
          height: 8px;
          background: currentColor;
          transform-origin: center;
          animation: ra-cross-playing-meter 720ms ease-in-out infinite alternate;
        }
        .ra-cross-playing-indicator > i:nth-child(2) {
          animation-delay: -480ms;
        }
        .ra-cross-playing-indicator > i:nth-child(3) {
          animation-delay: -240ms;
        }
        .ra-cross-waveform-playhead {
          position: absolute;
          z-index: 2;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--ra-playhead);
          opacity: 0.42;
          pointer-events: none;
          transform: translateX(-0.5px);
        }
        @keyframes ra-cross-playing-meter {
          from { transform: scaleY(0.3); opacity: 0.55; }
          to { transform: scaleY(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ra-cross-playing-indicator > i {
            animation: none;
          }
          .ra-cross-playing-indicator > i:nth-child(1),
          .ra-cross-playing-indicator > i:nth-child(3) {
            transform: scaleY(0.55);
          }
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
        <button
          className="ra-cross-button"
          data-active={playing}
          onClick={() => (playing ? dispatch({ type: 'PAUSE' }) : void playTarget(selectedTarget))}
          aria-label={playing ? 'pause Cross' : 'play Cross'}
        >
          {playing ? '■' : '▶'}
        </button>
        <span className="ra-cross-divider" />
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>tempo</span>
        <button
          className="ra-cross-button"
          onClick={() => changeTempo(projectBpm - 1)}
          aria-label="Decrease tempo"
        >
          −
        </button>
        <span
          style={{
            minWidth: 38,
            textAlign: 'center',
            fontSize: 10,
            color: 'var(--ra-text)'
          }}
        >
          {Math.round(projectBpm)}
        </span>
        <button
          className="ra-cross-button"
          onClick={() => changeTempo(projectBpm + 1)}
          aria-label="Increase tempo"
        >
          +
        </button>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>bpm</span>
        <span className="ra-cross-divider" />
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
          selected={selectedTarget === 'left'}
          playing={playing}
          playheadPct={playheadPct}
          muted={sideMuted}
          onAdd={(sourceId) =>
            setDraft((value) => (value ? addCrossSource(value, sourceId) : value))
          }
          onSelect={() => selectAndPlay('left')}
          onToggleMute={(_parent, sourceId) => toggleSideMute(sourceId)}
          onToggleSolo={toggleSideSolo}
        />

        <section
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            outline:
              selectedTarget === 'center'
                ? '1px solid var(--ra-border-strong)'
                : '1px solid transparent',
            outlineOffset: 4
          }}
        >
          <button
            onClick={() => selectAndPlay('center')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 28,
              border: 'none',
              padding: 0,
              background: 'transparent',
              color: 'inherit',
              textAlign: 'left'
            }}
          >
            <span className="ra-eyebrow" style={{ flex: 1 }}>
              new cross
            </span>
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>
              {draft.center.length} / {MAX_RIFFF_STEM_SLOTS}
            </span>
            <span
              style={{
                width: 12,
                color: selectedTarget === 'center' ? 'var(--ra-playhead)' : 'var(--ra-text-4)'
              }}
              aria-label={
                selectedTarget === 'center' ? (playing ? 'playing' : 'selected') : undefined
              }
            >
              {selectedTarget === 'center' && playing ? (
                <CrossPlaybackIndicator />
              ) : selectedTarget === 'center' ? (
                '●'
              ) : (
                ''
              )}
            </span>
          </button>
          {draft.center.map((row, index) => {
            const source = crossSourceForRow(draft, row)
            return source?.stem ? (
              <CenterRow
                key={row.id}
                row={row}
                source={source}
                index={index}
                soloed={
                  draft.center.length > 1 &&
                  row.audible &&
                  draft.center.filter((item) => item.audible).length === 1
                }
                rolling={rollingRows.has(row.id)}
                playheadPct={selectedTarget === 'center' ? playheadPct : null}
                onDropAt={handleDropAt}
                onDraftChange={setDraft}
                onSelect={() => selectAndPlay('center')}
                onSkip={() => void skipCenterRow(row)}
                onRandomize={() => void randomizeCenterRow(row)}
                onDuplicate={() =>
                  setDraft((value) => (value ? duplicateCrossRow(value, row.id) : value))
                }
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
          <div
            style={{
              marginTop: 6,
              padding: '8px 4px',
              borderTop: '1px solid var(--ra-border)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--ra-text)', marginRight: 4 }}>
              add a stem that is:
            </span>
            {DISCOVER_SLOT_KIND_OPTIONS.map((kind) => (
              <Fragment key={kind}>
                {kind === 'bassHeavy' && <span className="ra-cross-divider" />}
                <button
                  className="ra-cross-add-chip"
                  onClick={() => void addDiscoveredStem(kind)}
                  disabled={
                    draft.center.length >= MAX_RIFFF_STEM_SLOTS || rollingRows.has(`add:${kind}`)
                  }
                >
                  {rollingRows.has(`add:${kind}`) ? '…' : DISCOVER_SLOT_KIND_LABEL[kind]}
                </button>
              </Fragment>
            ))}
            <span className="ra-cross-divider" />
            <button
              className="ra-cross-add-chip"
              onClick={() => void addRandomStem()}
              disabled={
                draft.center.length >= MAX_RIFFF_STEM_SLOTS || rollingRows.has('add:random')
              }
            >
              {rollingRows.has('add:random') ? '…' : '+ random'}
            </button>
            <button
              className="ra-cross-add-chip"
              onClick={() => void addSample()}
              disabled={draft.center.length >= MAX_RIFFF_STEM_SLOTS}
            >
              + sample
            </button>
            <div
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 18,
                marginTop: 5,
                paddingTop: 7,
                borderTop: '1px solid var(--ra-border)'
              }}
            >
              <div
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 7, color: 'var(--ra-text-3)' }}>endlesss</span>
                  <Dial
                    value={draft.sourceLean ?? DEFAULT_SOURCE_LEAN}
                    onChange={(sourceLean) =>
                      setDraft((value) => (value ? { ...value, sourceLean } : value))
                    }
                    defaultValue={DEFAULT_SOURCE_LEAN}
                    size={28}
                    ariaLabel="source"
                    tooltip="other sounds clockwise"
                  />
                  <span style={{ fontSize: 7, color: 'var(--ra-text-3)' }}>other</span>
                </div>
                <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>source</span>
              </div>
              <div
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              >
                <Dial
                  value={draft.matching ?? 100 - DEFAULT_DISCOVER_CHAOS}
                  onChange={(matching) =>
                    setDraft((value) => (value ? { ...value, matching } : value))
                  }
                  defaultValue={100 - DEFAULT_DISCOVER_CHAOS}
                  size={28}
                  ariaLabel="matching"
                  tooltip="more matching clockwise"
                />
                <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>matching</span>
              </div>
            </div>
            {discoverError && (
              <span
                style={{
                  width: '100%',
                  textAlign: 'center',
                  fontSize: 8,
                  color: 'var(--ra-text-3)'
                }}
              >
                {discoverError}
              </span>
            )}
          </div>
        </section>

        <SourceColumn
          parent={right}
          draft={draft}
          selected={selectedTarget === 'right'}
          playing={playing}
          playheadPct={playheadPct}
          muted={sideMuted}
          onAdd={(sourceId) =>
            setDraft((value) => (value ? addCrossSource(value, sourceId) : value))
          }
          onSelect={() => selectAndPlay('right')}
          onToggleMute={(_parent, sourceId) => toggleSideMute(sourceId)}
          onToggleSolo={toggleSideSolo}
        />
      </div>
    </div>
  )
}
