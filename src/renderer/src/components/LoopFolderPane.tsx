// src/renderer/src/components/LoopFolderPane.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoopEntry, LoopFolderListing } from '@shared/loopFolderTypes'
import type { Rifff } from '@shared/types'
import {
  buildLoopGroupTree,
  countLoopsInGroup,
  defaultExpandedGroupKeys,
  flattenLoopTreeOrder,
  type LoopGroupNode
} from '@shared/loopFolderTree'
import {
  EMPTY_LOOP_SELECTION,
  loopBarsLabel,
  loopTempoLabel,
  nextLoopSelection,
  type LoopSelection
} from '@shared/loopFolderView'
import { getAudioContext } from '../audio/peakCache'
import { decodeStemFile } from '../audio/decodeStemFile'
import {
  registerActivePreview,
  startPreviewLoop,
  stopPreviewSources,
  unregisterActivePreview
} from '../audio/previewLoop'
import { useDispatch, usePlaying } from '../state/StoreContext'
import { useBusy } from '../state/BusyContext'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'

const INDENT_PX = 12

/** One loop. A div, not a button: the tempo cell inside it becomes an
 * input, and an input inside a button is invalid. Waveform colour is the
 * 'fx' type colour -- a loop imports as type 'fx', so this is the colour
 * it will have on the shelf; no new colour. */
function LoopRow({
  loop,
  depth,
  selected,
  anchor,
  onClick
}: {
  loop: LoopEntry
  depth: number
  selected: boolean
  anchor: boolean
  onClick: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const tempo = loopTempoLabel(loop)
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: `0 12px 0 ${12 + depth * INDENT_PX}px`,
        cursor: 'pointer',
        fontSize: 11,
        background: selected ? 'var(--ra-bg-row-active)' : 'transparent',
        color: anchor ? 'var(--ra-text)' : 'var(--ra-text-2)'
      }}
    >
      <div style={{ position: 'relative', width: 120, height: 22, flexShrink: 0 }}>
        <Waveform path={loop.path} color={typeColorVar('fx')} />
      </div>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {loop.name}
      </span>
      <span
        style={{
          width: 44,
          textAlign: 'right',
          color: tempo.guessed ? 'var(--ra-text-3)' : 'inherit'
        }}
      >
        {tempo.text}
      </span>
      <span style={{ width: 52, textAlign: 'right', color: 'var(--ra-text-3)' }}>
        {loopBarsLabel(loop)}
      </span>
      <span style={{ width: 52, fontSize: 9, color: 'var(--ra-text-3)' }}>
        {loop.irregular ? 'irregular' : ''}
      </span>
    </div>
  )
}

/** The right-hand pane for a linked loop folder: its groups as a tree,
 * each loop a row, the import button at the foot. */
export function LoopFolderPane({
  folder,
  projectBpm,
  onImported,
  onLoopUpdated
}: {
  folder: LoopFolderListing
  projectBpm: number
  /** LibraryBrowser's own onImported -- the downbeat picker opens for the
   * batch exactly as it does after importing rifffs. */
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  onLoopUpdated: (entry: LoopEntry) => void
}): React.JSX.Element {
  const dispatch = useDispatch()
  const playing = usePlaying()
  const setBusy = useBusy()

  const tree = useMemo(() => buildLoopGroupTree(folder.loops), [folder.loops])
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedGroupKeys(tree))
  )
  const visibleLoops = useMemo(
    () => flattenLoopTreeOrder(tree, (key) => expanded.has(key)),
    [tree, expanded]
  )
  const visibleIds = useMemo(() => visibleLoops.map((l) => l.loopId), [visibleLoops])
  const loopsById = useMemo(() => new Map(folder.loops.map((l) => [l.loopId, l])), [folder.loops])
  const [selection, setSelection] = useState<LoopSelection>(EMPTY_LOOP_SELECTION)

  function toggleGroup(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ---- preview: the anchor loops, the same way a selected rifff does ----
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewTokenRef = useRef(0)
  const stopPreview = useCallback((): void => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])
  useEffect(() => () => stopPreview(), [stopPreview])

  useEffect(() => {
    stopPreview()
    const anchor = selection.anchor !== null ? loopsById.get(selection.anchor) : undefined
    if (!anchor || !folder.available) return
    let cancelled = false
    if (playing) dispatch({ type: 'PAUSE' })
    void startPreviewLoop(
      getAudioContext(),
      [{ path: anchor.path, gain: 1 }],
      () => cancelled
    ).then((sources) => {
      if (cancelled || sources.length === 0) return
      previewSourcesRef.current.push(...sources)
      previewTokenRef.current = registerActivePreview(stopPreview)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs on a new anchor only. loopsById changes whenever a row's length or tempo is filled in, and that must not restart a playing preview; transport state is read at the moment a preview starts, as LibraryBrowser's rifff preview does.
  }, [selection.anchor])

  // ---- lengths main could not read (non-WAV): measured from our decode ----
  const reportedRef = useRef<Set<string>>(new Set())
  const unmeasured = useMemo(
    () => visibleLoops.filter((l) => l.durationSec === null),
    [visibleLoops]
  )
  useEffect(() => {
    if (!folder.available) return
    let cancelled = false
    void (async () => {
      for (const loop of unmeasured) {
        if (cancelled) return
        if (reportedRef.current.has(loop.loopId)) continue
        reportedRef.current.add(loop.loopId)
        try {
          // Shares the Waveform's own in-flight decode of the same path.
          const buffer = await decodeStemFile(loop.path)
          const updated = await window.rifffApi.loopFoldersReportDuration(
            loop.loopId,
            buffer.duration,
            projectBpm
          )
          // Applied even if this run was superseded: main has stored it.
          if (updated) onLoopUpdated(updated)
        } catch (err) {
          // The renderer cannot decode every format the engine can. The
          // row keeps "? bars", and import still works through the engine.
          console.warn(`LoopFolderPane: could not measure ${loop.path}:`, err)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [unmeasured, folder.available, projectBpm, onLoopUpdated])

  // ---- import ----
  const allOrderedIds = useMemo(
    () => flattenLoopTreeOrder(tree, () => true).map((l) => l.loopId),
    [tree]
  )
  async function handleImport(): Promise<void> {
    const ids = allOrderedIds.filter((id) => selection.selected.has(id))
    if (ids.length === 0) return
    setBusy(ids.length > 1 ? 'importing loops…' : 'importing loop…')
    try {
      const rifffs = await window.rifffApi.loopFoldersImport(ids, projectBpm)
      for (const rifff of rifffs) dispatch({ type: 'ADD_TO_SHELF', rifff })
      if (rifffs.length > 0)
        onImported(
          rifffs.map((r) => r.groupId),
          rifffs
        )
    } catch (err) {
      console.error('LoopFolderPane: import failed:', err)
    } finally {
      setBusy(null)
    }
  }

  function renderGroup(node: LoopGroupNode<LoopEntry>): React.JSX.Element {
    const open = node.depth === 0 || expanded.has(node.key)
    return (
      <div key={node.key}>
        {node.depth > 0 && (
          <button
            onClick={() => toggleGroup(node.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              textAlign: 'left',
              height: 24,
              padding: `0 12px 0 ${12 + (node.depth - 1) * INDENT_PX}px`,
              border: 'none',
              borderRadius: 0,
              background: 'transparent',
              color: 'var(--ra-text-2)',
              fontSize: 10
            }}
          >
            <span style={{ width: 10 }}>{open ? '−' : '+'}</span>
            <span className="ra-eyebrow" style={{ flex: 1 }}>
              {node.name}
            </span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
              {countLoopsInGroup(node)}
            </span>
          </button>
        )}
        {open &&
          node.loops.map((loop) => (
            <LoopRow
              key={loop.loopId}
              loop={loop}
              depth={node.depth}
              selected={selection.selected.has(loop.loopId)}
              anchor={selection.anchor === loop.loopId}
              onClick={(e) =>
                setSelection((prev) =>
                  nextLoopSelection(prev, loop.loopId, visibleIds, {
                    shift: e.shiftKey,
                    toggle: e.metaKey || e.ctrlKey
                  })
                )
              }
            />
          ))}
        {open && node.children.map(renderGroup)}
      </div>
    )
  }

  const selectedCount = selection.selected.size
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ margin: '10px 12px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--ra-text)' }}>{folder.name}</span>
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
            {folder.available ? `${folder.loops.length} loops` : 'unavailable'}
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--ra-text-3)', marginTop: 2 }}>
          {folder.rootPath}
        </div>
      </div>

      {!folder.available ? (
        <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
          folder not found — plug its drive back in, then rescan
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {folder.loops.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
                no playable loops in this folder
              </div>
            ) : (
              renderGroup(tree)
            )}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              margin: '10px 12px',
              borderTop: '1px solid var(--ra-border)',
              paddingTop: 10
            }}
          >
            <button
              onClick={() => void handleImport()}
              disabled={selectedCount === 0}
              style={{
                height: 34,
                borderRadius: 0,
                padding: '0 20px',
                fontSize: 13,
                border: '2px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: selectedCount === 0 ? 'var(--ra-text-4)' : 'var(--ra-text)'
              }}
            >
              {selectedCount > 1 ? `import ${selectedCount} loops to project` : 'import to project'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
