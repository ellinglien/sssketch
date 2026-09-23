import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { usePlacedFlatStems, type FlatStem } from '../state/usePlacedFlatStems'
import { useStemPreviewPlayback } from '../state/useStemPreviewPlayback'
import { stemTileGeometryFromFields, type StemTileGeometry } from '../state/selectors'
import { stemKey as buildStemKey } from '@shared/types'
import { Waveform } from './Waveform'
import { playButtonStyle } from './autoArrangeStyles'
import {
  DRAW_ARRANGE_SECTIONS,
  movesFromDrawnGrid,
  type ArrangeMoveRecord
} from '@shared/autoArrangeApply'

export interface GridStem {
  stemKey: string
  label: string
  typeColor: string
}

interface Props {
  stems: GridStem[]
  onApply: (moves: ArrangeMoveRecord[], totalSteps: number) => void
  onCancel: () => void
}

const CELL_SIZE = 18

/** Second step of the Draw Arrangement wizard (after DrawArrangeWizard.tsx's
 * own role-confirmation step, which reuses AutoArrangeRoleStep.tsx) -- a
 * fixed DRAW_ARRANGE_SECTIONS-column grid, one row per included stem, where
 * the user directly paints which 4-bar section each stem is active in,
 * rather than stepping through autoArrangeEngine.ts's weighted-candidate
 * flow (AutoArrangeBuildStep.tsx). Phase-free and fill-free by design -- see
 * the approved design spec's non-goals: a cell is only ever active/inactive,
 * full stop, and movesFromDrawnGrid (autoArrangeApply.ts) only ever emits
 * 'enter'/'exit' moves from it, never 'fill'.
 *
 * `stems` is already the wizard's own filtered/included list -- this
 * component doesn't know about StemRoleInfo/engine-shaped types at all, on
 * purpose, so it stays a pure drawing surface reusable outside the
 * auto-arrange role-confirmation flow if that's ever wanted.
 *
 * Styled after AutoArrangeBuildStep.tsx / AutoArrangeRoleStep.tsx's shared
 * conventions: see docs/design.md. The build-progress grid in
 * AutoArrangeBuildStep.tsx is this component's closest visual reference --
 * same left-label-column + colored-square-per-active-section language, just
 * editable here instead of read-only. Per-row waveform/play button and the
 * section-preview button below reuse those same two components' own
 * placedRifffs/stemGeometryByKey/useStemPreviewPlayback plumbing verbatim --
 * this plays back the REAL, currently-placed stems from their own real
 * positions (a proxy for what the drawn arrangement will sound like), not a
 * simulation of the eventual built/windowed result -- same approximation
 * AutoArrangeBuildStep.tsx's own "hear the arrangement so far" already uses. */
export function DrawArrangeGridStep({ stems, onApply, onCancel }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const playedBarsOverrides = useAppSelector((s) => s.playedBars)
  const leftCropOverrides = useAppSelector((s) => s.leftCrop)
  const stretchOverrides = useAppSelector((s) => s.stretch)
  const stateBpm = useAppSelector((s) => s.bpm)
  const playing = usePlaying()
  const pos = usePos()
  const { placedRifffs, flatStemsByKey } = usePlacedFlatStems()
  const { previewingKeys, startPreview } = useStemPreviewPlayback()

  const [grid, setGrid] = useState<Record<string, boolean[]>>(() =>
    Object.fromEntries(stems.map((s) => [s.stemKey, new Array(DRAW_ARRANGE_SECTIONS).fill(false)]))
  )

  // Which section the clickable strip above the grid (and the outline on
  // the grid's own matching column) currently has selected -- what "preview
  // section" below plays.
  const [selectedSection, setSelectedSection] = useState(0)

  // Tracks an in-progress click-and-drag paint gesture, and the single
  // on/off value that gesture paints with -- decided ONCE, from the cell
  // the drag started on (the OPPOSITE of its own current state), then
  // applied uniformly to every cell the drag touches afterward, regardless
  // of which stem's row it crosses into. A plain click (no drag) is exactly
  // this same rule with zero additional cells touched, which is what makes
  // it read as a plain toggle -- click a hollow cell to fill it, click a
  // filled one to clear it -- with no separate draw/erase mode control
  // needed: dragging FROM a filled cell erases the cells it crosses,
  // dragging from a hollow one draws them. Both refs, not state -- neither
  // needs to trigger a render on its own.
  const isDraggingRef = useRef(false)
  const dragValueRef = useRef(false)

  // Document-level, not a plain onPointerUp on the grid -- the pointer can
  // be released outside the grid's own bounds (dragged off the edge while
  // painting a run of cells) and the drag still needs to end cleanly in
  // that case, or a later pointerenter somewhere else entirely would keep
  // painting.
  useEffect(() => {
    function handlePointerUp(): void {
      isDraggingRef.current = false
    }
    document.addEventListener('pointerup', handlePointerUp)
    return () => document.removeEventListener('pointerup', handlePointerUp)
  }, [])

  function setCellValue(stemKey: string, index: number, value: boolean): void {
    setGrid((prev) => {
      const row = prev[stemKey]
      if (!row || row[index] === value) return prev
      const nextRow = row.slice()
      nextRow[index] = value
      return { ...prev, [stemKey]: nextRow }
    })
  }

  function handleCellPointerDown(stemKey: string, index: number): void {
    const current = grid[stemKey]?.[index] ?? false
    const value = !current
    dragValueRef.current = value
    isDraggingRef.current = true
    setCellValue(stemKey, index, value)
  }

  function handleCellPointerEnter(stemKey: string, index: number): void {
    if (!isDraggingRef.current) return
    setCellValue(stemKey, index, dragValueRef.current)
  }

  const nothingDrawn = Object.values(grid).every((cells) => cells.every((c) => !c))

  function handleApply(): void {
    if (nothingDrawn) return
    onApply(movesFromDrawnGrid(grid), DRAW_ARRANGE_SECTIONS)
  }

  // Per-stem geometry (real current placement on the real timeline) --
  // copied verbatim from AutoArrangeRoleStep.tsx/AutoArrangeBuildStep.tsx.
  const stemGeometryByKey = useMemo(() => {
    const map = new Map<string, StemTileGeometry>()
    for (const rifff of placedRifffs) {
      if (rifff.startBar === undefined) continue
      const stretchOn = stretchOverrides[rifff.groupId] ?? true
      for (const stem of rifff.stems) {
        map.set(
          buildStemKey(rifff.groupId, stem.slot),
          stemTileGeometryFromFields({
            startBar: rifff.startBar,
            playedBarsOverride: playedBarsOverrides[rifff.groupId],
            leftCropBars: leftCropOverrides[rifff.groupId] ?? 0,
            rifffBarLength: rifff.barLength,
            stretchOn,
            rifffBpm: rifff.bpm,
            stateBpm,
            stemBarLength: stem.barLength
          })
        )
      }
    }
    return map
  }, [placedRifffs, playedBarsOverrides, leftCropOverrides, stretchOverrides, stateBpm])

  // Per-row play button -- mirrors AutoArrangeRoleStep.tsx's togglePreviewStem
  // exactly: pressing it again on the stem it's ALREADY previewing pauses;
  // pressing it on a different stem always re-previews from that stem's own
  // real current start bar.
  function togglePreviewStem(fs: FlatStem): void {
    const isThisStemAlreadyPlaying =
      playing && previewingKeys.size === 1 && previewingKeys.has(fs.stemKey)
    if (isThisStemAlreadyPlaying) {
      dispatch({ type: 'PAUSE' })
      return
    }
    void startPreview(
      new Set([fs.stemKey]),
      fs.groupId,
      stemGeometryByKey.get(fs.stemKey)?.startBar ?? 0
    )
  }

  // Mirrors AutoArrangeRoleStep.tsx's handleThumbnailClick exactly -- the
  // click fraction is applied against tileSpanBars (one raw-tile
  // repetition), not visibleBars, since the thumbnail only ever renders
  // that one pass of the raw source file.
  function handleThumbnailClick(
    e: React.MouseEvent<HTMLDivElement>,
    fs: FlatStem,
    geometry: StemTileGeometry
  ): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0
    const clampedFraction = Math.max(0, Math.min(1, fraction))
    void startPreview(
      new Set([fs.stemKey]),
      fs.groupId,
      geometry.startBar + clampedFraction * geometry.tileSpanBars
    )
  }

  // "preview section N" -- plays every stem active in the currently
  // SELECTED section together, from each one's own real current start bar.
  // Mirrors AutoArrangeBuildStep.tsx's own playCurrentArrangement exactly,
  // just filtered to one drawn section instead of buildState.activeStemKeys.
  const activeInSelectedSection = stems
    .filter((s) => grid[s.stemKey]?.[selectedSection])
    .map((s) => s.stemKey)

  const isPreviewingSelectedSection =
    playing &&
    activeInSelectedSection.length > 0 &&
    previewingKeys.size === activeInSelectedSection.length &&
    activeInSelectedSection.every((k) => previewingKeys.has(k))

  function previewSelectedSection(): void {
    if (isPreviewingSelectedSection) {
      dispatch({ type: 'PAUSE' })
      return
    }
    const startBars = activeInSelectedSection
      .map((k) => stemGeometryByKey.get(k)?.startBar)
      .filter((b): b is number => b !== undefined)
    if (startBars.length === 0) return
    void startPreview(new Set(activeInSelectedSection), undefined, Math.min(...startBars))
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20,
          width: 520,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 8 }}>
          draw arrangement
        </div>
        <button
          onClick={previewSelectedSection}
          disabled={activeInSelectedSection.length === 0}
          style={{
            ...playButtonStyle(isPreviewingSelectedSection),
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            fontSize: 11,
            marginBottom: 12,
            opacity: activeInSelectedSection.length === 0 ? 0.3 : 1,
            cursor: activeInSelectedSection.length === 0 ? 'not-allowed' : 'pointer'
          }}
          title="play this section"
        >
          {isPreviewingSelectedSection ? '■' : '▶'} preview section {selectedSection + 1}
          {activeInSelectedSection.length > 0
            ? ` (${activeInSelectedSection.length} stem${activeInSelectedSection.length === 1 ? '' : 's'})`
            : ''}
        </button>
        {stems.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            no stems to draw an arrangement for
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 'fit-content' }}>
              {/* Section-selector strip -- a clickable progress-bar-like row
                  of thin segments, one per section, aligned with the grid
                  columns below via the same fixed-width spacers every stem
                  row uses for its own play button/waveform/label. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 24, flexShrink: 0 }} />
                <div style={{ width: 56, flexShrink: 0 }} />
                <div style={{ width: 90, flexShrink: 0 }} />
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: DRAW_ARRANGE_SECTIONS }, (_, i) => (
                    <div
                      key={i}
                      onClick={() => setSelectedSection(i)}
                      title={`section ${i + 1}`}
                      style={{
                        width: CELL_SIZE,
                        height: 8,
                        flexShrink: 0,
                        borderRadius: 0,
                        cursor: 'pointer',
                        background:
                          i === selectedSection ? 'var(--ra-stretch-on)' : 'var(--ra-border)'
                      }}
                    />
                  ))}
                </div>
              </div>
              {stems.map((stem) => {
                const cells = grid[stem.stemKey] ?? []
                const fs = flatStemsByKey.get(stem.stemKey)
                const isPreviewing = previewingKeys.has(stem.stemKey)
                const isThisStemPlaying = isPreviewing && playing
                const geometry = fs ? stemGeometryByKey.get(fs.stemKey) : undefined

                // Mirrors AutoArrangeRoleStep.tsx's own playhead derivation
                // exactly -- see that component's doc comment.
                let showPlayhead = false
                let playheadFraction = 0
                if (geometry) {
                  const barsIntoClip = pos - geometry.startBar
                  const withinClip =
                    geometry.visibleBars > 0 &&
                    barsIntoClip >= 0 &&
                    barsIntoClip < geometry.visibleBars
                  const barsIntoTile =
                    geometry.tileSpanBars > 0
                      ? ((barsIntoClip % geometry.tileSpanBars) + geometry.tileSpanBars) %
                        geometry.tileSpanBars
                      : 0
                  playheadFraction =
                    geometry.tileSpanBars > 0 ? barsIntoTile / geometry.tileSpanBars : 0
                  showPlayhead = isPreviewing && playing && withinClip
                }

                return (
                  <div key={stem.stemKey} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      onClick={() => fs && togglePreviewStem(fs)}
                      disabled={!fs}
                      style={{
                        ...playButtonStyle(isThisStemPlaying),
                        width: 24,
                        padding: '3px 0',
                        textAlign: 'center'
                      }}
                      title="preview this stem"
                    >
                      {isThisStemPlaying ? '■' : '▶'}
                    </button>
                    {fs && geometry ? (
                      <div
                        onClick={(e) => handleThumbnailClick(e, fs, geometry)}
                        title={fs.stem.name}
                        style={{
                          width: 56,
                          height: 28,
                          flexShrink: 0,
                          position: 'relative',
                          cursor: 'pointer',
                          outline: isPreviewing ? '1px solid var(--ra-stretch-on)' : 'none',
                          outlineOffset: -1
                        }}
                      >
                        <Waveform path={fs.stem.path} color={stem.typeColor} opacity={1} />
                        {showPlayhead && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 0,
                              bottom: 0,
                              left: `${playheadFraction * 100}%`,
                              width: 1,
                              background: 'var(--ra-playhead)',
                              pointerEvents: 'none'
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <div style={{ width: 56, height: 28, flexShrink: 0 }} />
                    )}
                    <div
                      style={{
                        width: 90,
                        flexShrink: 0,
                        fontSize: 9,
                        color: 'var(--ra-text-2)',
                        textAlign: 'right',
                        paddingRight: 6,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={stem.label}
                    >
                      {stem.label}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {cells.map((active, i) => (
                        <div
                          key={i}
                          title={`section ${i + 1}`}
                          onPointerDown={() => handleCellPointerDown(stem.stemKey, i)}
                          onPointerEnter={() => handleCellPointerEnter(stem.stemKey, i)}
                          style={{
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            flexShrink: 0,
                            borderRadius: 0,
                            cursor: 'pointer',
                            background: active ? stem.typeColor : 'transparent',
                            border: `1px solid ${active ? stem.typeColor : 'var(--ra-border)'}`,
                            outline:
                              i === selectedSection ? '1px solid var(--ra-stretch-on)' : 'none',
                            outlineOffset: -1,
                            touchAction: 'none'
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleApply}
            disabled={nothingDrawn}
            title={nothingDrawn ? 'draw a section' : 'apply arrangement'}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              fontWeight: 700,
              border: '1px solid var(--ra-stretch-on)',
              background: 'var(--ra-stretch-on)',
              color: 'var(--ra-play-on-ink)',
              // This app's disabled convention (docs/design.md): dim to 30%
              // opacity + not-allowed cursor, rather than a separate
              // disabled color palette.
              cursor: nothingDrawn ? 'not-allowed' : 'pointer',
              opacity: nothingDrawn ? 0.3 : 1
            }}
          >
            apply arrangement
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
}
