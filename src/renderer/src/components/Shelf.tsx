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
  isActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { stemKey } from '@shared/types'
import type { Rifff } from '@shared/types'
import { LIBRARY_ENTRY_POINTS, type LibraryEntryPoint } from '@shared/libraryEntryPoints'
import { formatBpm } from '@shared/format'
import { LoopOrOneShotPrompt, type LoopOrOneShotChoice } from './LoopOrOneShotPrompt'
import { importPathsWithChoice } from '../audio/importPathsWithChoice'
import { pauseArrangementBeforeShelfPreview } from '../audio/shelfPreviewHandoff'
import { toggleRiffBatchSelection } from './sketchRiffInteraction'

const TILE_SIZE = 42

export function Shelf({
  onImported,
  onOpenLibrary,
  onSeedDiscover,
  selectedRiffIds,
  selectionAnchorId,
  onSelectionChange
}: {
  onImported: (groupId: string) => void
  /** Opens the riff library on the half the pressed button names -- the two
   * buttons in this row's tail are the app's two distinct doors into it
   * (LIBRARY_ENTRY_POINTS), replacing the single "import" button plus the
   * browse/discover tab pair that used to live inside the browser's own
   * header. Direct request, 2026-09-23: "import and discover ... i think
   * they should be distinct buttons instead of tabs."
   *
   * Either door lands on the Endlesss login, not LORE, per earlier direct
   * feedback (LORE's warehouse path only ever resolves on one specific
   * machine; Endlesss login works for anyone). LORE stays reachable via that
   * browser's own "switch to lore" link. */
  onOpenLibrary: (entry: LibraryEntryPoint) => void
  /** Seeds Discover's own looper with this riff's stems, then opens it
   * already showing them -- direct request, 2026-09-16 (right-click a
   * Shelf tile). App.tsx owns the actual seeding + opening (it's the one
   * component with access to both Shelf and LibraryBrowser), so this is
   * just "here's the riff the user picked," nothing more. See
   * docs/superpowers/specs/2026-09-16-discover-seed-stems-design.md --
   * live drag onto Discover isn't possible (Discover's own full-screen
   * modal covers Shelf entirely), so this is triggered explicitly instead. */
  onSeedDiscover: (rifff: Rifff) => void
  /** Shared with Sketch so both surfaces render one persistent working set. */
  selectedRiffIds: ReadonlySet<string>
  selectionAnchorId: string | null
  onSelectionChange: (groupIds: Set<string>, anchorId: string | null) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const library = Object.values(state.rifffs)
  const [dragOver, setDragOver] = useState(false)
  // Set whenever importRifff couldn't make sense of a drop (none of the
  // paths matched Endlesss's own stem-filename convention) -- shows
  // LoopOrOneShotPrompt so the user decides how the file(s) should play,
  // rather than silently guessing. See importFromPaths' own comment below.
  const [loopPromptPaths, setLoopPromptPaths] = useState<string[] | null>(null)
  // Hovering a tile previews its meta in the header line without changing
  // selection — falls back to the current selection so the line isn't just
  // blank whenever the mouse isn't over the tray at all.
  const [hoverId, setHoverId] = useState<string | null>(null)
  // Which shelf tile (if any) is currently looping a preview — clicking a
  // tile without dragging it to the arranger previews it, matching the LORE
  // library browser's own click-to-preview convention.
  const [previewingGroupId, setPreviewingGroupId] = useState<string | null>(null)
  // Frame owns this selection and gives the same Set to Sketch. This keeps
  // the two views visually synchronized and preserves the chosen riffs
  // underneath fullscreen Cross/Discover workspaces. The separate anchor
  // prevents Sketch's playback auto-follow from rewriting a range choice.
  const updateSelection = useCallback(
    (next: Set<string>, anchorId: string | null = selectionAnchorId): void => {
      onSelectionChange(next, anchorId)
    },
    [onSelectionChange, selectionAnchorId]
  )
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  // Bumped on every click so a preview whose decode is still in flight when
  // a different tile gets clicked knows it's been superseded and shouldn't
  // push its (now-stale) sources once it finally resolves.
  const previewGenerationRef = useRef(0)
  const previewTokenRef = useRef(0)

  // Stable across renders (useCallback, empty deps) so it's safe to pass to
  // registerActivePreview/reference from effect cleanups without triggering
  // re-subscriptions.
  const stopTilePreviewAudio = useCallback(() => {
    // Cancels sources that already exist AND any file reads/decodes still
    // working toward a start. Every terminal path (drag, Discover, global
    // transport Play, unmount) comes through here.
    previewGenerationRef.current += 1
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  // The global preview registry can stop this from outside Shelf (for
  // example when the transport resumes). Clear the local play marker too,
  // so the next click starts immediately instead of acting on stale UI.
  const stopTilePreview = useCallback(() => {
    stopTilePreviewAudio()
    setPreviewingGroupId(null)
  }, [stopTilePreviewAudio])

  useEffect(() => {
    return () => stopTilePreviewAudio()
  }, [stopTilePreviewAudio])

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
        selectedRiffIds.size > 0 ? selectedRiffIds : new Set(state.sel ? [state.sel] : [])
      const groupIds = [...targetIds].filter((id) => state.rifffs[id]?.startBar === undefined)
      if (groupIds.length === 0) return
      dispatch({ type: 'DELETE_RIFFFS', groupIds })
      updateSelection(new Set(), null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRiffIds, state.sel, state.rifffs, dispatch, updateSelection])

  // Shift-click extends/shrinks a range from the shared selection anchor;
  // cmd/ctrl-click toggles just the clicked tile in/out of the batch,
  // leaving the anchor alone. Neither previews audio — multi-selecting to
  // batch-drag or batch-delete shouldn't also start a preview loop, unlike
  // a plain click. A plain click always collapses back to a single
  // selection AND previews, exactly as before.
  function handleTileClick(e: React.MouseEvent, rifff: Rifff): void {
    if (e.shiftKey && selectionAnchorId) {
      const anchorIndex = library.findIndex((r) => r.groupId === selectionAnchorId)
      const clickedIndex = library.findIndex((r) => r.groupId === rifff.groupId)
      if (anchorIndex === -1 || clickedIndex === -1) {
        updateSelection(new Set([rifff.groupId]), rifff.groupId)
        dispatch({ type: 'SELECT', groupId: rifff.groupId })
        return
      }
      const [start, end] =
        anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
      updateSelection(
        new Set(library.slice(start, end + 1).map((r) => r.groupId)),
        selectionAnchorId
      )
      return
    }
    if (e.metaKey || e.ctrlKey) {
      const anchorId = selectionAnchorId ?? rifff.groupId
      updateSelection(
        toggleRiffBatchSelection(selectedRiffIds, selectionAnchorId, rifff.groupId),
        anchorId
      )
      if (!selectionAnchorId) dispatch({ type: 'SELECT', groupId: rifff.groupId })
      return
    }
    updateSelection(new Set([rifff.groupId]), rifff.groupId)
    dispatch({ type: 'SELECT', groupId: rifff.groupId })
    stopTilePreview()
    if (previewingGroupId === rifff.groupId) {
      return
    }
    const generation = previewGenerationRef.current
    setPreviewingGroupId(rifff.groupId)
    // Own the global preview slot before the native handoff or decode starts.
    // PLAY can now cancel this request even while no Web Audio source exists.
    const previewToken = registerActivePreview(stopTilePreview)
    previewTokenRef.current = previewToken
    void (async () => {
      try {
        await pauseArrangementBeforeShelfPreview({
          playing,
          pauseArrangement: () => dispatch({ type: 'PAUSE' }),
          stopEngine: () => window.rifffApi.engineStop()
        })
      } catch (err) {
        // Do not start Web Audio when native silence could not be confirmed;
        // that would recreate the exact two-playback overlap this handoff
        // exists to prevent.
        if (!isActivePreview(previewToken)) return
        console.error('Shelf: failed to stop arrangement before preview:', err)
        stopTilePreview()
        return
      }
      if (previewGenerationRef.current !== generation || !isActivePreview(previewToken)) return
      const sources = await startPreviewLoop(
        getAudioContext(),
        rifff.stems.map((s) => ({
          path: s.path,
          gain: state.vol[stemKey(rifff.groupId, s.slot)] ?? 1,
          durationSec: s.durationSec
        })),
        () => previewGenerationRef.current !== generation || !isActivePreview(previewToken)
      )
      if (previewGenerationRef.current !== generation || !isActivePreview(previewToken)) {
        stopPreviewSources(sources)
        return
      }
      previewSourcesRef.current.push(...sources)
      if (sources.length === 0) stopTilePreview()
    })()
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
        return
      }
      // importRifff returns null when none of the given paths match
      // Endlesss's own stem-filename convention (buildRifff.ts's
      // parseStemFilename requires "<slot> - <author> - <name> -
      // <bpm>BPM - <timestamp>.wav") -- the common case for a plain
      // external sample dropped in from Finder rather than an Endlesss
      // export. Direct reports, 2026-09-16: "i'm not able to drag single
      // loops into the shelf" (first), then, after a one-shot-only
      // fallback shipped same day, "it doesn't want to loop... it is out
      // of time although it is a perfect loop" -- a one-shot import is
      // correct for a drum hit but silently wrong for a real loop file
      // (oneShot stems are never stretched/tiled, by design). Whether a
      // given external file is a one-shot or a loop can't be told apart
      // automatically (no audio-content bpm/beat detection anywhere in
      // this codebase) -- Elling's own explicit choice was to ask every
      // time rather than guess. resolveLoopPrompt (below) does the actual
      // import once the user answers.
      setLoopPromptPaths(paths)
    } catch (err) {
      // importRifff normally swallows its own errors and resolves null; this only
      // fires for something unexpected at the IPC layer itself (e.g. the main
      // process handler throwing before returning). No notification UI exists yet
      // (Task 10 doesn't add one) — surface it to the console so it's at least
      // discoverable rather than a silent no-op.
      console.error('importRifff failed:', err)
    }
  }

  // Resolves LoopOrOneShotPrompt's own choice for whatever paths are
  // currently pending (loopPromptPaths) -- one-shot uses importOneShot
  // (unchanged from the prior fallback), loop uses the new importLoop with
  // the user-given bar count applied uniformly to every path (see
  // LoopOrOneShotPrompt's own doc comment on why per-file bar counts
  // aren't supported). No classifyStems call for either branch: neither a
  // one-shot's nor a loop's single stem has an ambiguous type to classify
  // (both default to 'fx'), matching App.tsx's own importOneShot call site.
  async function resolveLoopPrompt(choice: LoopOrOneShotChoice): Promise<void> {
    const paths = loopPromptPaths
    setLoopPromptPaths(null)
    if (!paths) return
    const rifffs = await importPathsWithChoice(paths, choice)
    for (const rifff of rifffs) {
      dispatch({ type: 'ADD_TO_SHELF', rifff })
      onImported(rifff.groupId)
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
    <>
      {loopPromptPaths && (
        <LoopOrOneShotPrompt
          paths={loopPromptPaths}
          onResolve={(choice) => void resolveLoopPrompt(choice)}
        />
      )}
      <div
        style={{
          padding: '12px 14px',
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
              {detailRifff.name} — {formatBpm(detailRifff.bpm)} BPM · {detailRifff.stems.length}{' '}
              stems · {detailRifff.barLength} bars
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
            const selected = selectedRiffIds.has(rifff.groupId)
            const hovered = hoverId === rifff.groupId
            const previewing = previewingGroupId === rifff.groupId
            const placed = rifff.startBar !== undefined
            // Already placed on the timeline dims further than the normal idle
            // state — it's already in the arrangement, so the shelf's default
            // (unlit) view should draw the eye toward what's still available to
            // drag in, not what's already been used. Active interaction state
            // (selected/hovered/previewing/batch-selected) still lights it up
            // normally regardless of placement — greying out is only the idle
            // default, not a suppression of interaction feedback.
            const lit = selected || hovered || previewing
            return (
              <button
                key={rifff.groupId}
                className="ra-riff-tile ra-shelf-riff-tile"
                data-selected={selected}
                data-previewing={previewing}
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
                  if (selectedRiffIds.size > 1 && selectedRiffIds.has(rifff.groupId)) {
                    e.dataTransfer.setData(
                      'text/rifff-shelf-source-ids',
                      JSON.stringify([...selectedRiffIds])
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
                aria-pressed={selected}
                onContextMenu={(e) => {
                  e.preventDefault()
                  // Real root cause of a live report, 2026-09-16: "right
                  // clicking brings up the discovery panel... the preview
                  // continues to play" -- this tile's own preview
                  // (startPreviewLoop, plain Web Audio, entirely separate
                  // from the native engine Discover uses) was never stopped
                  // when seeding Discover, unlike LibraryBrowser.tsx's own
                  // Browse-tab preview (fixed the same day for the same
                  // reason) -- it just kept looping forever alongside
                  // whatever Discover started, making it hard to even tell
                  // whether Discover's own preview was working.
                  stopTilePreview()
                  setPreviewingGroupId(null)
                  onSeedDiscover(rifff)
                }}
                title={rifff.name}
                style={{
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  flex: 'none',
                  padding: 2,
                  boxSizing: 'border-box',
                  border: '1px solid transparent',
                  cursor: 'grab',
                  opacity: lit ? 1 : placed ? 0.4 : 0.72,
                  transition: 'opacity 80ms ease'
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
            title="import stems"
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
          {/* Two peer buttons, not a primary and a secondary: they are two
              equally real doors into the same browser (see
              LIBRARY_ENTRY_POINTS), and the browse/discover tab pair that
              used to sit inside its header is gone. Styled identically for
              that reason -- making one of them quieter would re-create the
              "discover is a sub-thing of import" reading the tabs had. */}
          {/* The tour anchor sits on the PAIR, not on one button: the tour's
              first step is "getting audio in", which is now both of these,
              and the tour is capped at seven steps so discover gets no step
              of its own to anchor. Keeps the same gap the row itself uses,
              so wrapping them changes nothing visually. */}
          <div style={{ display: 'flex', gap: 5 }}>
            <div data-tour-id="tour-import" style={{ display: 'flex', gap: 5 }}>
              {LIBRARY_ENTRY_POINTS.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onOpenLibrary(entry.id)}
                  data-tooltip={entry.tooltip}
                  style={{
                    // Direct follow-up report, 2026-09-17 (screenshot): the first
                    // "a bunch bigger" pass (height: 36) pushed this row's own
                    // content just past its maxHeight: 100 cap above, triggering
                    // an unwanted scrollbar on a row with nothing actually left
                    // to scroll to -- 28 is shorter than TILE_SIZE (42, the "+"
                    // drop-zone/tile height next to it), so it can never be the
                    // tallest thing in this row's own flex-wrap line.
                    height: 28,
                    borderRadius: 0,
                    padding: '0 14px',
                    fontSize: 12,
                    border: '1px solid var(--ra-border-strong)',
                    background: 'var(--ra-bg-row-active)',
                    color: 'var(--ra-text)'
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
