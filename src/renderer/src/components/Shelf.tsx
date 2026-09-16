import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import { PolarGlyph } from './PolarGlyph'
import { stemColorVar } from '../theme/typeColor'
import { classifyStems } from '../audio/classifyStems'
import { setGrabOffsetBars } from './dragGrabOffset'
import { suppressNextSyntheticClick } from './dragUtils'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { stemKey } from '@shared/types'
import type { Rifff } from '@shared/types'
import { formatBpm } from '@shared/format'

const TILE_SIZE = 42

// A stable empty-Set reference for the "batch selection is stale" case
// below, rather than allocating a fresh one every render.
const EMPTY_SELECTION: Set<string> = new Set()

export function Shelf({
  onImported,
  onOpenLibrary,
  onSeedDiscover
}: {
  onImported: (groupId: string) => void
  /** Opens whichever library browser is the default entry point -- the
   * Endlesss login tab, not LORE, per direct feedback (LORE's warehouse
   * path only ever resolves on one specific machine; Endlesss login works
   * for anyone). LORE stays reachable via that browser's own "switch to
   * lore" link. */
  onOpenLibrary: () => void
  /** Seeds Discover's own looper with this riff's stems, then opens it
   * already showing them -- direct request, 2026-09-16 (right-click a
   * Shelf tile). App.tsx owns the actual seeding + opening (it's the one
   * component with access to both Shelf and LibraryBrowser), so this is
   * just "here's the riff the user picked," nothing more. See
   * docs/superpowers/specs/2026-09-16-discover-seed-stems-design.md --
   * live drag onto Discover isn't possible (Discover's own full-screen
   * modal covers Shelf entirely), so this is triggered explicitly instead. */
  onSeedDiscover: (rifff: Rifff) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const library = Object.values(state.rifffs)
  const [dragOver, setDragOver] = useState(false)
  // Hovering a tile previews its meta in the header line without changing
  // selection — falls back to the current selection so the line isn't just
  // blank whenever the mouse isn't over the tray at all.
  const [hoverId, setHoverId] = useState<string | null>(null)
  // Which shelf tile (if any) is currently looping a preview — clicking a
  // tile without dragging it to the arranger previews it, matching the LORE
  // library browser's own click-to-preview convention.
  const [previewingGroupId, setPreviewingGroupId] = useState<string | null>(null)
  // Batch selection (shift-click range, cmd/ctrl-click toggle) — separate
  // from state.sel, which remains the single "anchor" tile that drives
  // preview/detail-line/Inspector exactly as before. A plain click always
  // collapses this back down to just that one tile. Same convention as the
  // LORE library browser's own multi-select.
  const [rawMultiSelected, setMultiSelected] = useState<Set<string>>(new Set())
  // A shift/cmd-click batch always includes its own anchor tile (state.sel)
  // as a member -- shift-click's range always spans from state.sel to the
  // clicked tile inclusive; cmd/ctrl-click's toggle can in principle remove
  // the anchor itself, an accepted edge case here. So once state.sel moves
  // to something OUTSIDE this batch -- a click in the arranger, sketch
  // mode, or a Tidy Up preview -- the batch is stale and treated as empty,
  // without needing an effect or a ref to detect "state.sel changed" (this
  // project's linter forbids setState-in-effect and ref reads/writes
  // during render; see ClusterStemsBrowser.tsx's own "derive instead of
  // reset" comment for the same convention elsewhere in this codebase).
  // Reported 2026-09-01: shelf selection should clear on arranger/sketch
  // interaction, and vice versa.
  const multiSelected =
    state.sel !== null && rawMultiSelected.has(state.sel) ? rawMultiSelected : EMPTY_SELECTION
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  // Bumped on every click so a preview whose decode is still in flight when
  // a different tile gets clicked knows it's been superseded and shouldn't
  // push its (now-stale) sources once it finally resolves.
  const previewGenerationRef = useRef(0)
  const previewTokenRef = useRef(0)

  // Stable across renders (useCallback, empty deps) so it's safe to pass to
  // registerActivePreview/reference from effect cleanups without triggering
  // re-subscriptions.
  const stopTilePreview = useCallback(() => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  useEffect(() => {
    return () => stopTilePreview()
  }, [stopTilePreview])

  // Delete/Backspace removes the targeted rifff(s) from the library
  // entirely (DELETE_RIFFFS) — not just from the timeline (that's
  // App.tsx's/SketchStrip's own domain, guarded to skip unplaced rifffs so
  // this doesn't double-fire with theirs). Targets the current
  // multi-selection if there is one, otherwise just the single anchor
  // (state.sel) — and only ever rifffs that are actually unplaced, since a
  // placed one belongs to whichever arranger view owns it.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const targetIds =
        multiSelected.size > 0 ? multiSelected : new Set(state.sel ? [state.sel] : [])
      const groupIds = [...targetIds].filter((id) => state.rifffs[id]?.startBar === undefined)
      if (groupIds.length === 0) return
      dispatch({ type: 'DELETE_RIFFFS', groupIds })
      setMultiSelected(new Set())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [multiSelected, state.sel, state.rifffs, dispatch])

  // Shift-click extends/shrinks a range from the current anchor (state.sel);
  // cmd/ctrl-click toggles just the clicked tile in/out of the batch,
  // leaving the anchor alone. Neither previews audio — multi-selecting to
  // batch-drag or batch-delete shouldn't also start a preview loop, unlike
  // a plain click. A plain click always collapses back to a single
  // selection AND previews, exactly as before.
  function handleTileClick(e: React.MouseEvent, rifff: Rifff): void {
    if (e.shiftKey && state.sel) {
      const anchorIndex = library.findIndex((r) => r.groupId === state.sel)
      const clickedIndex = library.findIndex((r) => r.groupId === rifff.groupId)
      if (anchorIndex === -1 || clickedIndex === -1) {
        setMultiSelected(new Set([rifff.groupId]))
        return
      }
      const [start, end] =
        anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
      setMultiSelected(new Set(library.slice(start, end + 1).map((r) => r.groupId)))
      return
    }
    if (e.metaKey || e.ctrlKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev)
        if (next.has(rifff.groupId)) next.delete(rifff.groupId)
        else next.add(rifff.groupId)
        return next
      })
      return
    }
    setMultiSelected(new Set())
    dispatch({ type: 'SELECT', groupId: rifff.groupId })
    previewGenerationRef.current += 1
    const generation = previewGenerationRef.current
    stopTilePreview()
    if (previewingGroupId === rifff.groupId) {
      setPreviewingGroupId(null)
      return
    }
    setPreviewingGroupId(rifff.groupId)
    if (playing) dispatch({ type: 'PAUSE' })
    void startPreviewLoop(
      getAudioContext(),
      rifff.stems.map((s) => ({
        path: s.path,
        gain: state.vol[stemKey(rifff.groupId, s.slot)] ?? 1,
        durationSec: s.durationSec
      })),
      () => previewGenerationRef.current !== generation
    ).then((sources) => {
      if (previewGenerationRef.current !== generation) {
        stopPreviewSources(sources)
        return
      }
      previewSourcesRef.current.push(...sources)
      if (sources.length > 0) previewTokenRef.current = registerActivePreview(stopTilePreview)
    })
  }

  // Shared by both import entry points below (drag-drop and the "+" tile's
  // own file-dialog click) -- everything past "we have some paths" is
  // identical either way.
  async function importFromPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    try {
      const rifff = await window.rifffApi.importRifff(paths)
      if (rifff) {
        dispatch({ type: 'ADD_TO_SHELF', rifff })
        // Downbeat correction now happens right at import, not on first
        // placement — by the time it's dragged onto the timeline it's already
        // baked and usable, rather than needing a separate step afterward.
        onImported(rifff.groupId)
        // Not awaited — a quick heuristic guess (bass/drums only; everything
        // else stays 'fx') that fills in shortly after import without blocking
        // it or the beat-picker opening.
        classifyStems(rifff, dispatch).catch((err) => {
          console.error('Shelf: failed to classify stem types:', err)
        })
      }
    } catch (err) {
      // importRifff normally swallows its own errors and resolves null; this only
      // fires for something unexpected at the IPC layer itself (e.g. the main
      // process handler throwing before returning). No notification UI exists yet
      // (Task 10 doesn't add one) — surface it to the console so it's at least
      // discoverable rather than a silent no-op.
      console.error('importRifff failed:', err)
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    // Electron no longer augments dropped File objects with a real `.path` (removed
    // as of Electron 32+); resolve each one's filesystem path via the preload bridge.
    const paths = Array.from(e.dataTransfer.files).map((f) => window.rifffApi.getPathForFile(f))
    if (paths.length === 0) {
      // Diagnostic only, not a fix: some source apps (e.g. Endlesss) may not put
      // real OS file entries on the drag at all, in which case dataTransfer.files
      // is empty and there's nothing we can import. Logging what the drag actually
      // carried makes that distinguishable from "we dropped it wrong" next time.
      console.warn(
        'Shelf: drop had no usable files. dataTransfer.types:',
        e.dataTransfer.types,
        'items:',
        Array.from(e.dataTransfer.items).map((i) => ({ kind: i.kind, type: i.type }))
      )
      return
    }
    await importFromPaths(paths)
  }

  async function handlePickImport(): Promise<void> {
    await importFromPaths(await window.rifffApi.pickRifffImportPaths())
  }

  const detailRifff = state.rifffs[hoverId ?? state.sel ?? ''] ?? null

  return (
    <div
      style={{
        padding: '11px 14px',
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 9
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, height: 14 }}>
        <span className="ra-eyebrow">rifff library</span>
        <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>{library.length}</span>
        <span style={{ flex: 1 }} />
        {detailRifff && (
          <span style={{ fontSize: 9, color: 'var(--ra-text-2)', whiteSpace: 'nowrap' }}>
            {detailRifff.name} — {formatBpm(detailRifff.bpm)} BPM · {detailRifff.stems.length} stems
            · {detailRifff.barLength} bars
          </span>
        )}
      </div>
      <div
        onMouseLeave={() => setHoverId(null)}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 5,
          alignItems: 'center',
          // Capped rather than growing unbounded with library size — App.tsx's
          // .ra-frame is now a fixed height (see its own comment on why), so
          // an uncapped library that wraps to many rows would squeeze the
          // arranger below it instead of just making the whole window taller
          // the way it used to. Roughly 2 rows of TILE_SIZE(42) tiles; scrolls
          // internally past that.
          maxHeight: 100,
          overflowY: 'auto'
        }}
      >
        {library.map((rifff) => {
          const selected = state.sel === rifff.groupId
          const hovered = hoverId === rifff.groupId
          const previewing = previewingGroupId === rifff.groupId
          const batchSelected = multiSelected.has(rifff.groupId)
          const placed = rifff.startBar !== undefined
          // Already placed on the timeline dims further than the normal idle
          // state — it's already in the arrangement, so the shelf's default
          // (unlit) view should draw the eye toward what's still available to
          // drag in, not what's already been used. Active interaction state
          // (selected/hovered/previewing/batch-selected) still lights it up
          // normally regardless of placement — greying out is only the idle
          // default, not a suppression of interaction feedback.
          const lit = selected || hovered || previewing || batchSelected
          return (
            <button
              key={rifff.groupId}
              draggable
              onDragStart={(e) => {
                suppressNextSyntheticClick()
                e.dataTransfer.setData('text/rifff-shelf-source-id', rifff.groupId)
                // Dragging a tile that's part of an active multi-selection
                // carries the whole batch — SketchStrip reads this to place
                // all of them at once. Falls back to the singular id above
                // for anything that only understands single-tile drops
                // (the normal Timeline), which just places the one tile
                // under the cursor rather than the whole batch.
                if (multiSelected.size > 1 && multiSelected.has(rifff.groupId)) {
                  e.dataTransfer.setData(
                    'text/rifff-shelf-source-ids',
                    JSON.stringify([...multiSelected])
                  )
                }
                // Not yet placed — there's no existing on-timeline position to
                // preserve an offset from, and without this the module could
                // still be holding a stale value left behind by a previous
                // in-arranger reposition drag.
                setGrabOffsetBars(0)
                // Dragging into the arranger is a clear "done previewing, now
                // placing it" signal — whatever tile was previewing (this one
                // or a different one) should stop, not keep looping alongside
                // wherever the drag ends up.
                stopTilePreview()
                setPreviewingGroupId(null)
              }}
              onMouseEnter={() => setHoverId(rifff.groupId)}
              onClick={(e) => handleTileClick(e, rifff)}
              onContextMenu={(e) => {
                e.preventDefault()
                onSeedDiscover(rifff)
              }}
              title={`${rifff.name} — click to preview, drag to arrange, right-click to seed Discover with these stems, shift/cmd-click to multi-select, delete to remove from library`}
              style={{
                width: TILE_SIZE,
                height: TILE_SIZE,
                flex: 'none',
                padding: 2,
                border: previewing
                  ? '1px solid var(--ra-playhead)'
                  : batchSelected
                    ? '1px solid var(--ra-stretch-on)'
                    : '1px solid transparent',
                cursor: 'grab',
                background: 'transparent',
                opacity: lit ? 1 : placed ? 0.4 : 0.72
              }}
            >
              <PolarGlyph
                stems={rifff.stems}
                identityColor={stemColorVar(rifff.stems[0])}
                size={TILE_SIZE - 4}
              />
            </button>
          )
        })}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => void handlePickImport()}
          role="button"
          title="drop rifff folders or stems straight from endlesss, or click to pick from disk"
          style={{
            flex: 1,
            minWidth: 150,
            height: TILE_SIZE,
            border: `1px dashed ${dragOver ? 'var(--ra-text-2)' : 'var(--ra-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            color: 'var(--ra-text-4)',
            cursor: 'pointer'
          }}
        >
          +
        </div>
        <button
          onClick={onOpenLibrary}
          data-tour-id="tour-import"
          style={{
            height: 18,
            borderRadius: 0,
            padding: '0 6px',
            fontSize: 9,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-2)'
          }}
        >
          import
        </button>
      </div>
    </div>
  )
}
