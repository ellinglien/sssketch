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
  addShapeLane,
  copyShapeFragment,
  duplicateShapeFragment,
  finishShapeLaneGain,
  groupShapeEdits,
  isolateShapeFragmentRange,
  moveShapeFragment,
  previewShapeLaneGain,
  removeShapeFragmentRange,
  redoShape,
  removeShapeFragments,
  resizeShapeFragment,
  reverseShapeFragments,
  replaceShapeLaneSource,
  resetShapeLane,
  resetShapeRiff,
  shapeRenderFingerprint,
  shapeRenderSegments,
  shapeWaveformLayout,
  splitShapeFragment,
  toggleShapeFragmentsDisabled,
  undoShape,
  type ShapeDraft,
  type ShapeLane,
  type ShapeMaterializedStem
} from '@shared/shape'
import type { ShapeFragmentRecipe, ShapeSourceStem, Stem } from '@shared/types'
import {
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_SLOT_KIND_OPTIONS,
  isTraitSlotKind,
  slotKindsLabel,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'
import { DEFAULT_DISCOVER_CHAOS, pickReroll, rankCandidates } from '@shared/discoverRanking'
import { DEFAULT_SOURCE_LEAN, drawSoundSource } from '@shared/discoverSlotModifier'
import { MAX_RIFFF_STEM_SLOTS } from '@shared/riffStemSlots'
import { usePlaying, usePos } from '../state/StoreContext'
import { useCrossPreview, type CrossPreviewMember } from '../state/useCrossPreview'
import { RepeatedWaveform } from './RepeatedWaveform'
import { typeColorVar } from '../theme/typeColor'
import {
  adjustShapeSnapIndex,
  shapeClipDragDestination,
  shapeClipResizeDestination,
  shapeGridSizePct,
  shapeOwnsKey,
  shapePlaybackStartBar
} from './shapeKeyboard'
import { resolveCandidateStem } from './discoverCandidateStem'
import { Dial } from './Dial'
import { LoadingLoader } from './LoadingLoader'
import { ContextMenu } from './ContextMenu'
import { DiscoverKindPicker } from './DiscoverKindPicker'
import { discoverSlotKindForSoundType } from '../audio/discoverSeed'
import { SkipForward } from '@phosphor-icons/react'

const SNAP_CHOICES = [
  { label: '1 bar', bars: 1 },
  { label: '1/4', bars: 0.25 },
  { label: '1/8', bars: 0.125 },
  { label: '1/16', bars: 0.0625 },
  { label: '1/32', bars: 0.03125 },
  { label: 'off', bars: 0 }
] as const

const SHAPE_LEFT_WIDTH = 132
const SHAPE_RIGHT_WIDTH = 96

function buttonStyle(active = false): React.CSSProperties {
  return {
    height: 25,
    border: `1px solid ${active ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    borderRadius: 0,
    background: active ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
    color: active ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
    fontSize: 10,
    padding: '0 8px',
    cursor: 'pointer'
  }
}

function fragmentEnd(fragment: ShapeFragmentRecipe): number {
  return fragment.destStartBars + fragment.sourceEndBars - fragment.sourceStartBars
}

function snapBar(value: number, size: number, limit: number): number {
  const snapped = size > 0 ? Math.round(value / size) * size : value
  return Math.max(0, Math.min(limit, snapped))
}

interface ShapeCursorTarget {
  laneId: string
  clipId: string
}

interface ShapeRangeSelection extends ShapeCursorTarget {
  startBar: number
  endBar: number
}

type ShapeClipMenu =
  | ({ kind: 'clip'; x: number; y: number } & ShapeCursorTarget)
  | ({ kind: 'range'; x: number; y: number } & ShapeRangeSelection)

function cryptoFraction(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000
}

function randomShapeSlotKind(): DiscoverSlotKind {
  return DISCOVER_SLOT_KIND_OPTIONS[
    crypto.getRandomValues(new Uint32Array(1))[0] % DISCOVER_SLOT_KIND_OPTIONS.length
  ]
}

function discoveredShapeSource(
  stem: Awaited<ReturnType<typeof resolveCandidateStem>>
): ShapeSourceStem | null {
  if (!stem) return null
  return {
    author: stem.author,
    name: stem.name,
    type: stem.type,
    path: stem.path,
    durationSec: stem.durationSec,
    barLength: stem.barLength,
    phaseSourcePath: stem.phaseSourcePath,
    phaseBars: stem.phaseBars,
    creationTime: stem.creationTime
  }
}

function laneMembers(
  draft: ShapeDraft,
  rendered: readonly ShapeMaterializedStem[],
  mode: 'original' | 'shaped',
  muted: ReadonlySet<string>,
  soloed: string | null
): CrossPreviewMember[] {
  return draft.lanes.flatMap((lane, index) => {
    if (muted.has(lane.id) || (soloed !== null && soloed !== lane.id)) return []
    const result = rendered[index]
    if (mode === 'shaped' && !result) return []
    const stem: Omit<Stem, 'slot'> =
      mode === 'original'
        ? { ...lane.source }
        : {
            ...lane.source,
            path: result.path,
            durationSec: result.durationSec,
            barLength: draft.loopBars,
            phaseSourcePath: result.path,
            phaseBars: 0,
            trimStartSec: undefined,
            trimEndSec: undefined,
            oneShot: undefined
          }
    return [{ stem, gain: lane.gain }]
  })
}

function ShapeLaneRow({
  draft,
  lane,
  selected,
  muted,
  soloed,
  snapSize,
  cursorBar,
  cursorTarget,
  rangeSelection,
  razor,
  rolling,
  kinds,
  onDraft,
  onSelect,
  onLaneSelect,
  onClipHeaderSelect,
  onClipBodyClick,
  onClipRangeSelect,
  onClipContextMenu,
  onMute,
  onSolo,
  onGainPreview,
  onGainCommit,
  onSkip,
  onChangeKinds,
  onSeek
}: {
  draft: ShapeDraft
  lane: ShapeLane
  selected: ReadonlySet<string>
  muted: boolean
  soloed: boolean
  snapSize: number
  cursorBar: number
  cursorTarget: ShapeCursorTarget | null
  rangeSelection: ShapeRangeSelection | null
  razor: boolean
  rolling: boolean
  kinds: DiscoverSlotKind[]
  onDraft: (next: ShapeDraft) => void
  onSelect: (id: string, additive: boolean) => void
  onLaneSelect: (ids: string[], additive: boolean) => void
  onClipHeaderSelect: (laneId: string, clipId: string, startBar: number) => void
  onClipBodyClick: (laneId: string, clipId: string, bar: number) => void
  onClipRangeSelect: (laneId: string, clipId: string, startBar: number, endBar: number) => void
  onClipContextMenu: (
    laneId: string,
    clipId: string,
    x: number,
    y: number,
    range: ShapeRangeSelection | null
  ) => void
  onMute: () => void
  onSolo: () => void
  onGainPreview: (gain: number) => void
  onGainCommit: (startingGain: number, gain: number) => void
  onSkip: () => void
  onChangeKinds: (kinds: DiscoverSlotKind[]) => void
  onSeek: (bar: number) => void
}): React.JSX.Element {
  const laneRef = useRef<HTMLDivElement>(null)
  const kindButtonRef = useRef<HTMLButtonElement>(null)
  const [kindMenu, setKindMenu] = useState<{ x: number; y: number } | null>(null)
  const closeKindMenu = useCallback(() => setKindMenu(null), [])
  const gainStartRef = useRef<number | null>(null)
  const clipDragPreviewRef = useRef<HTMLDivElement>(null)
  const clipDragRef = useRef<{
    pointerId: number
    clipId: string
    startClientX: number
    grabOffsetBars: number
    lengthBars: number
    destination: number
    copyStarted: boolean
    moved: boolean
  } | null>(null)
  const clipResizeRef = useRef<{
    pointerId: number
    clipId: string
    edge: 'left' | 'right'
    destination: number
    startClientX: number
    moved: boolean
  } | null>(null)
  const bodyDragRef = useRef<{
    pointerId: number
    clipId: string
    startBar: number
    startClientX: number
    moved: boolean
  } | null>(null)
  useEffect(
    () => () => {
      document.documentElement.classList.remove('ra-shape-resizing-left', 'ra-shape-resizing-right')
    },
    []
  )
  const minorGridPct = snapSize < 1 ? shapeGridSizePct(draft.loopBars, snapSize) : null
  const color = lane.source.recordedInApp
    ? 'var(--ra-recording-live)'
    : typeColorVar(lane.source.type)
  const wholeLaneSelected =
    lane.fragments.length > 0 && lane.fragments.every((fragment) => selected.has(fragment.id))

  function rawBarAt(clientX: number): number {
    const rect = laneRef.current!.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * draft.loopBars
  }

  function barAt(clientX: number): number {
    return snapBar(rawBarAt(clientX), snapSize, draft.loopBars)
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${SHAPE_LEFT_WIDTH}px minmax(0, 1fr) ${SHAPE_RIGHT_WIDTH}px`,
        minHeight: 72
      }}
    >
      <div
        style={{
          borderRight: '1px solid var(--ra-border)',
          borderBottom: '1px solid var(--ra-border)',
          padding: '6px 7px',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: '16px 1fr',
          gap: 4
        }}
      >
        <div
          role="button"
          tabIndex={0}
          title="select every clip in this stem"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            onLaneSelect(
              lane.fragments.map((fragment) => fragment.id),
              event.metaKey || event.ctrlKey || event.shiftKey
            )
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onLaneSelect(
              lane.fragments.map((fragment) => fragment.id),
              event.metaKey || event.ctrlKey || event.shiftKey
            )
          }}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 5,
            fontSize: 9,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: 'pointer',
            background: wholeLaneSelected
              ? `color-mix(in srgb, ${color} 13%, transparent)`
              : undefined
          }}
        >
          <span style={{ color }}>{lane.source.type}</span>
          <span style={{ color: 'var(--ra-text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {lane.source.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button onClick={onMute} style={buttonStyle(muted)} title="temporary monitor mute">
            m
          </button>
          <button onClick={onSolo} style={buttonStyle(soloed)} title="temporary monitor solo">
            s
          </button>
          <Dial
            value={lane.gain * 100}
            onChange={(value) => {
              if (gainStartRef.current === null) gainStartRef.current = lane.gain
              onGainPreview(value / 100)
            }}
            onCommit={(value) => {
              const startingGain = gainStartRef.current ?? lane.gain
              gainStartRef.current = null
              onGainCommit(startingGain, value / 100)
            }}
            defaultValue={100}
            size={22}
            ariaLabel={`${lane.source.name} volume`}
            tooltip="per-stem volume"
            inkColor="var(--ra-text-2)"
          />
        </div>
      </div>
      <div
        ref={laneRef}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if (!razor) onSeek(barAt(event.clientX))
          if (event.target === event.currentTarget) onSelect('', false)
        }}
        style={{
          position: 'relative',
          borderBottom: '1px solid var(--ra-border)',
          overflow: 'hidden'
        }}
      >
        {lane.fragments.map((fragment) => {
          const length = fragment.sourceEndBars - fragment.sourceStartBars
          const waveform = shapeWaveformLayout(
            fragment.sourceStartBars,
            lane.source.barLength,
            length
          )
          const isSelected = selected.has(fragment.id)
          const clipStart = fragment.destStartBars
          const clipEnd = fragmentEnd(fragment)
          const clipBarAt = (clientX: number): number =>
            Math.max(clipStart, Math.min(clipEnd, barAt(clientX)))
          const activeRange =
            rangeSelection?.laneId === lane.id && rangeSelection.clipId === fragment.id
              ? rangeSelection
              : null
          const resizeDestinationAt = (
            clientX: number,
            edge: 'left' | 'right',
            bypassSnap: boolean
          ): number =>
            shapeClipResizeDestination({
              rawBar: rawBarAt(clientX),
              edge,
              clipStart,
              clipEnd,
              sourceStart: fragment.sourceStartBars,
              sourceEnd: fragment.sourceEndBars,
              reversed: !!fragment.reversed,
              snapBars: bypassSnap ? 0 : snapSize,
              loopBars: draft.loopBars
            })
          const showResizePreview = (edge: 'left' | 'right', destination: number): void => {
            const preview = clipDragPreviewRef.current
            if (!preview) return
            const start = edge === 'left' ? destination : clipStart
            const end = edge === 'right' ? destination : clipEnd
            preview.style.display = 'block'
            preview.style.left = `${(start / draft.loopBars) * 100}%`
            preview.style.width = `${((end - start) / draft.loopBars) * 100}%`
          }
          const beginResize = (
            event: React.PointerEvent<HTMLDivElement>,
            edge: 'left' | 'right'
          ): void => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            onSelect(fragment.id, event.metaKey || event.ctrlKey || event.shiftKey)
            onClipHeaderSelect(lane.id, fragment.id, fragment.destStartBars)
            const destination = edge === 'left' ? clipStart : clipEnd
            clipResizeRef.current = {
              pointerId: event.pointerId,
              clipId: fragment.id,
              edge,
              destination,
              startClientX: event.clientX,
              moved: false
            }
            document.documentElement.classList.remove(
              'ra-shape-resizing-left',
              'ra-shape-resizing-right'
            )
            document.documentElement.classList.add(`ra-shape-resizing-${edge}`)
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          const moveResize = (event: React.PointerEvent<HTMLDivElement>): void => {
            const drag = clipResizeRef.current
            if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id) return
            event.preventDefault()
            event.stopPropagation()
            if (!drag.moved && Math.abs(event.clientX - drag.startClientX) < 2) return
            drag.moved = true
            const destination = resizeDestinationAt(
              event.clientX,
              drag.edge,
              event.metaKey || event.ctrlKey
            )
            if (destination === drag.destination) return
            drag.destination = destination
            showResizePreview(drag.edge, destination)
          }
          const finishResize = (event: React.PointerEvent<HTMLDivElement>): void => {
            const drag = clipResizeRef.current
            if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id) return
            event.preventDefault()
            event.stopPropagation()
            clipResizeRef.current = null
            document.documentElement.classList.remove(
              'ra-shape-resizing-left',
              'ra-shape-resizing-right'
            )
            if (clipDragPreviewRef.current) clipDragPreviewRef.current.style.display = 'none'
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
            if (!drag.moved) return
            drag.destination = resizeDestinationAt(
              event.clientX,
              drag.edge,
              event.metaKey || event.ctrlKey
            )
            onDraft(resizeShapeFragment(draft, lane.id, fragment.id, drag.edge, drag.destination))
          }
          const cancelResize = (event: React.PointerEvent<HTMLDivElement>): void => {
            const drag = clipResizeRef.current
            if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id) return
            clipResizeRef.current = null
            document.documentElement.classList.remove(
              'ra-shape-resizing-left',
              'ra-shape-resizing-right'
            )
            if (clipDragPreviewRef.current) clipDragPreviewRef.current.style.display = 'none'
          }
          return (
            <div
              key={fragment.id}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                const clickedBar = clipBarAt(event.clientX)
                const rangeStart = activeRange
                  ? Math.min(activeRange.startBar, activeRange.endBar)
                  : 0
                const rangeEnd = activeRange
                  ? Math.max(activeRange.startBar, activeRange.endBar)
                  : 0
                const clickedSelectedRange =
                  activeRange !== null &&
                  event.clientY - rect.top >= 16 &&
                  clickedBar >= rangeStart &&
                  clickedBar <= rangeEnd
                onClipContextMenu(
                  lane.id,
                  fragment.id,
                  event.clientX,
                  event.clientY,
                  clickedSelectedRange ? activeRange : null
                )
              }}
              style={{
                position: 'absolute',
                left: `${(fragment.destStartBars / draft.loopBars) * 100}%`,
                width: `${(length / draft.loopBars) * 100}%`,
                top: 7,
                bottom: 7,
                overflow: 'hidden',
                boxSizing: 'border-box',
                border: '1px solid var(--ra-border)',
                background: isSelected
                  ? `color-mix(in srgb, ${color} 13%, var(--ra-bg-row-active))`
                  : 'var(--ra-bg-row-active)',
                opacity: fragment.disabled ? 0.34 : 1,
                cursor: razor ? 'crosshair' : 'default'
              }}
            >
              <div
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  onSelect(fragment.id, event.metaKey || event.ctrlKey || event.shiftKey)
                  onClipHeaderSelect(lane.id, fragment.id, fragment.destStartBars)
                  const rect = event.currentTarget.parentElement!.getBoundingClientRect()
                  clipDragRef.current = {
                    pointerId: event.pointerId,
                    clipId: fragment.id,
                    startClientX: event.clientX,
                    grabOffsetBars: ((event.clientX - rect.left) / rect.width) * length,
                    lengthBars: length,
                    destination: fragment.destStartBars,
                    copyStarted: event.altKey,
                    moved: false
                  }
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  const drag = clipDragRef.current
                  if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id)
                    return
                  event.stopPropagation()
                  if (!drag.moved && Math.abs(event.clientX - drag.startClientX) < 3) return
                  drag.moved = true
                  event.currentTarget.style.cursor = 'grabbing'
                  const destination = shapeClipDragDestination(
                    rawBarAt(event.clientX) - drag.grabOffsetBars,
                    drag.lengthBars,
                    snapSize,
                    draft.loopBars
                  )
                  if (
                    destination === drag.destination &&
                    clipDragPreviewRef.current?.style.display === 'block'
                  )
                    return
                  drag.destination = destination
                  const preview = clipDragPreviewRef.current
                  if (!preview) return
                  preview.style.display = 'block'
                  preview.style.left = `${(destination / draft.loopBars) * 100}%`
                  preview.style.width = `${(drag.lengthBars / draft.loopBars) * 100}%`
                }}
                onPointerUp={(event) => {
                  const drag = clipDragRef.current
                  if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id)
                    return
                  event.stopPropagation()
                  clipDragRef.current = null
                  event.currentTarget.style.cursor = 'grab'
                  if (clipDragPreviewRef.current) clipDragPreviewRef.current.style.display = 'none'
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  if (!drag.moved) return
                  onDraft(
                    drag.copyStarted || event.altKey
                      ? copyShapeFragment(draft, lane.id, fragment.id, drag.destination)
                      : moveShapeFragment(draft, lane.id, fragment.id, drag.destination)
                  )
                }}
                onPointerCancel={(event) => {
                  const drag = clipDragRef.current
                  if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id)
                    return
                  clipDragRef.current = null
                  event.currentTarget.style.cursor = 'grab'
                  if (clipDragPreviewRef.current) clipDragPreviewRef.current.style.display = 'none'
                }}
                onLostPointerCapture={(event) => {
                  const drag = clipDragRef.current
                  if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id)
                    return
                  clipDragRef.current = null
                  event.currentTarget.style.cursor = 'grab'
                  if (clipDragPreviewRef.current) clipDragPreviewRef.current.style.display = 'none'
                }}
                style={{
                  position: 'absolute',
                  inset: '0 0 auto 0',
                  height: 15,
                  zIndex: 4,
                  borderBottom: '1px solid var(--ra-border)',
                  background: isSelected
                    ? `color-mix(in srgb, ${color} 34%, var(--ra-bg-row-active))`
                    : 'color-mix(in srgb, var(--ra-bg-row-active) 88%, var(--ra-text))',
                  cursor: 'grab',
                  touchAction: 'none',
                  userSelect: 'none'
                }}
                title="drag or click to select clip"
              >
                <div
                  className="ra-shape-clip-edge ra-shape-clip-edge--left"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`trim the start of ${lane.source.name}`}
                  onPointerDown={(event) => beginResize(event, 'left')}
                  onPointerMove={moveResize}
                  onPointerUp={finishResize}
                  onPointerCancel={cancelResize}
                  onLostPointerCapture={cancelResize}
                  style={{ left: 0 }}
                />
                <span
                  style={{
                    display: 'block',
                    padding: '2px 5px',
                    color: isSelected ? 'var(--ra-text)' : 'var(--ra-text-3)',
                    fontSize: 8,
                    lineHeight: '10px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden'
                  }}
                >
                  {lane.source.name}
                </span>
                <div
                  className="ra-shape-clip-edge ra-shape-clip-edge--right"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`trim the end of ${lane.source.name}`}
                  onPointerDown={(event) => beginResize(event, 'right')}
                  onPointerMove={moveResize}
                  onPointerUp={finishResize}
                  onPointerCancel={cancelResize}
                  onLostPointerCapture={cancelResize}
                  style={{ right: 0 }}
                />
              </div>
              <div
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  const bar = clipBarAt(event.clientX)
                  onClipBodyClick(lane.id, fragment.id, bar)
                  if (razor) return
                  bodyDragRef.current = {
                    pointerId: event.pointerId,
                    clipId: fragment.id,
                    startBar: bar,
                    startClientX: event.clientX,
                    moved: false
                  }
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  const drag = bodyDragRef.current
                  if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id)
                    return
                  event.stopPropagation()
                  if (Math.abs(event.clientX - drag.startClientX) >= 3) drag.moved = true
                  if (drag.moved)
                    onClipRangeSelect(lane.id, fragment.id, drag.startBar, clipBarAt(event.clientX))
                }}
                onPointerUp={(event) => {
                  const drag = bodyDragRef.current
                  if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== fragment.id)
                    return
                  event.stopPropagation()
                  if (drag.moved)
                    onClipRangeSelect(lane.id, fragment.id, drag.startBar, clipBarAt(event.clientX))
                  bodyDragRef.current = null
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onPointerCancel={() => {
                  bodyDragRef.current = null
                }}
                style={{
                  position: 'absolute',
                  inset: '16px 0 0',
                  cursor: razor ? 'crosshair' : 'text',
                  transform: fragment.reversed ? 'scaleX(-1)' : undefined,
                  touchAction: 'none',
                  userSelect: 'none'
                }}
                title={
                  razor
                    ? 'click to cut clip'
                    : 'click to set the insert marker · drag to select a time region'
                }
              >
                <RepeatedWaveform
                  path={lane.source.path}
                  color={color}
                  tileWidthPct={waveform.tileWidthPct}
                  maskPositionPct={waveform.maskOffsetPct}
                />
              </div>
              {activeRange && (
                <span
                  aria-label="selected clip region"
                  style={{
                    position: 'absolute',
                    top: 16,
                    bottom: 0,
                    left: `${((Math.min(activeRange.startBar, activeRange.endBar) - clipStart) / length) * 100}%`,
                    width: `${(Math.abs(activeRange.endBar - activeRange.startBar) / length) * 100}%`,
                    zIndex: 5,
                    pointerEvents: 'none',
                    background: `color-mix(in srgb, ${color} 22%, transparent)`
                  }}
                />
              )}
              {cursorTarget?.laneId === lane.id &&
                cursorTarget.clipId === fragment.id &&
                cursorBar >= fragment.destStartBars &&
                cursorBar <= fragmentEnd(fragment) && (
                  <span
                    className="ra-shape-insert-marker"
                    style={{
                      left: `${((cursorBar - fragment.destStartBars) / length) * 100}%`
                    }}
                    aria-hidden="true"
                  />
                )}
              {fragment.disabled && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--ra-text-2)',
                    fontSize: 9,
                    background:
                      'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--ra-bg-page) 55%, transparent) 5px 7px)'
                  }}
                >
                  disabled
                </span>
              )}
            </div>
          )
        })}
        <div
          ref={clipDragPreviewRef}
          aria-hidden="true"
          style={{
            display: 'none',
            position: 'absolute',
            top: 7,
            bottom: 7,
            zIndex: 8,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            border: `1px solid color-mix(in srgb, ${color} 64%, var(--ra-border))`,
            background: `color-mix(in srgb, ${color} 13%, var(--ra-bg-row-active))`,
            opacity: 0.7
          }}
        >
          <div
            style={{
              height: 15,
              boxSizing: 'border-box',
              borderBottom: '1px solid var(--ra-border)',
              background: `color-mix(in srgb, ${color} 34%, var(--ra-bg-row-active))`
            }}
          >
            <span
              style={{
                display: 'block',
                padding: '2px 5px',
                color: 'var(--ra-text-2)',
                fontSize: 8,
                lineHeight: '10px',
                whiteSpace: 'nowrap',
                overflow: 'hidden'
              }}
            >
              {lane.source.name}
            </span>
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            pointerEvents: 'none',
            opacity: 0.42,
            backgroundImage: minorGridPct
              ? 'linear-gradient(to right, var(--ra-border-strong) 1px, transparent 1px), linear-gradient(to right, color-mix(in srgb, var(--ra-text-4) 46%, transparent) 1px, transparent 1px)'
              : 'linear-gradient(to right, var(--ra-border-strong) 1px, transparent 1px)',
            backgroundSize: minorGridPct
              ? `${100 / draft.loopBars}% 100%, ${minorGridPct}% 100%`
              : `${100 / draft.loopBars}% 100%`
          }}
        />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: '20px 1fr',
          alignItems: 'center',
          gap: 3,
          padding: '0 6px',
          borderLeft: '1px solid var(--ra-border)',
          borderBottom: '1px solid var(--ra-border)'
        }}
      >
        <button
          ref={kindButtonRef}
          disabled={rolling}
          onClick={(event) => {
            if (kindMenu) {
              closeKindMenu()
              return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            setKindMenu({ x: rect.right, y: rect.bottom + 4 })
          }}
          aria-expanded={kindMenu !== null}
          aria-haspopup="menu"
          title={slotKindsLabel(kinds)}
          style={{
            minWidth: 0,
            padding: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            border: 'none',
            background: 'transparent',
            color: kindMenu ? 'var(--ra-text)' : 'var(--ra-text-3)',
            fontFamily: 'inherit',
            fontSize: 8,
            textAlign: 'left',
            cursor: rolling ? 'default' : 'pointer'
          }}
        >
          {slotKindsLabel(kinds)} ▾
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button
            onClick={onSkip}
            disabled={rolling}
            style={{
              ...buttonStyle(),
              width: 29,
              padding: 0,
              display: 'grid',
              placeItems: 'center'
            }}
            title={`skip to another ${slotKindsLabel(kinds)} stem`}
          >
            {rolling ? <LoadingLoader size={10} /> : <SkipForward size={12} />}
          </button>
          <button onClick={() => onDraft(resetShapeLane(draft, lane.id))} style={buttonStyle()}>
            reset
          </button>
        </div>
        {kindMenu && (
          <DiscoverKindPicker
            x={kindMenu.x}
            y={kindMenu.y}
            kinds={kinds}
            onChange={onChangeKinds}
            onClose={closeKindMenu}
            ignoreRef={kindButtonRef}
          />
        )}
      </div>
    </div>
  )
}

export function ShapePanel({
  draft,
  setDraft,
  onClose,
  onKeep,
  onAddToShelf,
  onAddToTimeline,
  initialSourceLean,
  onSourceLeanCommit,
  onPreviewStopReady,
  active
}: {
  draft: ShapeDraft
  setDraft: Dispatch<SetStateAction<ShapeDraft | null>>
  onClose: () => void
  onKeep: (draft: ShapeDraft) => Promise<'✓ kept' | 'already kept'>
  onAddToShelf: (draft: ShapeDraft) => Promise<void>
  onAddToTimeline: (draft: ShapeDraft) => Promise<void>
  initialSourceLean: number
  onSourceLeanCommit: (sourceLean: number) => void
  onPreviewStopReady: (stop: (() => void) | null) => void
  active: boolean
}): React.JSX.Element {
  const playing = usePlaying()
  const pos = usePos()
  const { preview, stop, owns } = useCrossPreview('shape-preview')
  const [rendered, setRendered] = useState<ShapeMaterializedStem[]>([])
  const [renderState, setRenderState] = useState<'rendering' | 'ready' | 'error'>('rendering')
  const [mode, setMode] = useState<'original' | 'shaped'>('shaped')
  const [snapIndex, setSnapIndex] = useState(1)
  const [snapMenu, setSnapMenu] = useState<{ x: number; y: number } | null>(null)
  const snapButtonRef = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [soloed, setSoloed] = useState<string | null>(null)
  const [saving, setSaving] = useState<'keep' | 'shelf' | 'timeline' | null>(null)
  const [keptLabel, setKeptLabel] = useState<string | null>(null)
  const [renderEpoch, setRenderEpoch] = useState(0)
  const [playbackIntent, setPlaybackIntent] = useState(false)
  const savingRef = useRef(false)
  const [cursorBar, setCursorBar] = useState(0)
  const [cursorTarget, setCursorTarget] = useState<ShapeCursorTarget | null>(null)
  const [rangeSelection, setRangeSelection] = useState<ShapeRangeSelection | null>(null)
  const [razor, setRazor] = useState(false)
  const [clipMenu, setClipMenu] = useState<ShapeClipMenu | null>(null)
  const [sourceLean, setSourceLean] = useState(initialSourceLean)
  const [matching, setMatching] = useState(100 - DEFAULT_DISCOVER_CHAOS)
  const [discoverBusy, setDiscoverBusy] = useState<string | null>(null)
  const [rollingLanes, setRollingLanes] = useState<Set<string>>(new Set())
  const [laneKinds, setLaneKinds] = useState<Record<string, DiscoverSlotKind[]>>({})
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const renderedRef = useRef<ShapeMaterializedStem[]>([])
  const retiredPreviewPathsRef = useRef(new Set<string>())
  const renderedVersionRef = useRef(0)
  const jobRef = useRef<string | null>(null)
  const renderFingerprint = useMemo(() => shapeRenderFingerprint(draft), [draft])
  const renderRequest = useMemo(
    () => ({
      draftId: draft.id,
      targetBpm: draft.targetBpm,
      loopBars: draft.loopBars,
      lanes: draft.lanes.map((lane) => ({
        source: lane.source,
        segments: shapeRenderSegments(lane)
      })),
      fingerprint: renderFingerprint
    }),
    // renderFingerprint deliberately stands in for draft.lanes: gain-only
    // lane changes must not create another set of preview WAVs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.id, draft.loopBars, draft.targetBpm, renderFingerprint]
  )
  const currentRef = useRef({ id: draft.id, fingerprint: renderFingerprint })
  const draftRef = useRef(draft)
  const positionRef = useRef(pos)
  const playbackIntentRef = useRef(false)
  const smoothNextPreviewRef = useRef(false)
  const laneRequestRef = useRef(new Map<string, string>())
  const asyncRequestEpochRef = useRef(0)
  useEffect(() => {
    currentRef.current = { id: draft.id, fingerprint: renderFingerprint }
    draftRef.current = draft
  }, [draft, renderFingerprint])
  useEffect(() => {
    positionRef.current = pos
  }, [pos])
  useEffect(() => {
    if (active) return
    asyncRequestEpochRef.current += 1
    laneRequestRef.current.clear()
    queueMicrotask(() => {
      setDiscoverBusy(null)
      setRollingLanes(new Set())
    })
  }, [active])

  const members = useMemo(
    () => laneMembers(draft, rendered, mode, muted, soloed),
    [draft, rendered, mode, muted, soloed]
  )

  const cleanupRetiredPreviews = useCallback((): void => {
    const paths = [...retiredPreviewPathsRef.current]
    retiredPreviewPathsRef.current.clear()
    if (paths.length > 0) void window.rifffApi.cleanupShapePreview(paths)
  }, [])

  const beginPreview = useCallback(
    (fromBar = cursorBar) => {
      if (!active) return
      if (mode === 'shaped' && rendered.length !== draft.lanes.length) return
      playbackIntentRef.current = true
      setPlaybackIntent(true)
      const smoothSwap = smoothNextPreviewRef.current
      const renderedVersion = renderedVersionRef.current
      smoothNextPreviewRef.current = false
      void preview(
        `riff:${draft.id}:${mode}`,
        members,
        draft.targetBpm,
        draft.loopBars,
        fromBar,
        smoothSwap
      ).then((loaded) => {
        if (loaded && renderedVersionRef.current === renderedVersion) cleanupRetiredPreviews()
      })
    },
    [
      active,
      cursorBar,
      draft.id,
      draft.lanes.length,
      draft.loopBars,
      draft.targetBpm,
      members,
      mode,
      preview,
      cleanupRetiredPreviews,
      rendered.length
    ]
  )

  const stopPreview = useCallback((): Promise<void> => {
    setCursorBar(((positionRef.current % draft.loopBars) + draft.loopBars) % draft.loopBars)
    playbackIntentRef.current = false
    setPlaybackIntent(false)
    return stop()
  }, [draft.loopBars, stop])

  const handoffPreview = useCallback(() => {
    stopPreview()
    const job = jobRef.current
    jobRef.current = null
    if (job) void window.rifffApi.cancelShapeMaterialization(job)
    setRenderEpoch((value) => value + 1)
  }, [stopPreview])

  useEffect(() => {
    onPreviewStopReady(handoffPreview)
    return () => onPreviewStopReady(null)
  }, [handoffPreview, onPreviewStopReady])

  useEffect(() => {
    if (!active) return
    const id = window.setTimeout(() => {
      const jobId = `${renderRequest.draftId}:${crypto.randomUUID()}`
      const expected = { id: renderRequest.draftId, fingerprint: renderRequest.fingerprint }
      const previousJob = jobRef.current
      if (previousJob) void window.rifffApi.cancelShapeMaterialization(previousJob)
      jobRef.current = jobId
      setRenderState('rendering')
      void window.rifffApi
        .materializeShape({
          jobId,
          mode: 'preview',
          targetBpm: renderRequest.targetBpm,
          loopBars: renderRequest.loopBars,
          lanes: renderRequest.lanes
        })
        .then((result) => {
          if (
            jobRef.current !== jobId ||
            currentRef.current.id !== expected.id ||
            currentRef.current.fingerprint !== expected.fingerprint
          ) {
            void window.rifffApi.cleanupShapePreview(result.stems.map((stem) => stem.path))
            return
          }
          const old = renderedRef.current
          renderedVersionRef.current += 1
          renderedRef.current = result.stems
          setRendered(result.stems)
          setRenderState('ready')
          for (const stem of old) retiredPreviewPathsRef.current.add(stem.path)
        })
        .catch((error) => {
          if (jobRef.current !== jobId) return
          console.error('ShapePanel: preview materialization failed:', error)
          setRenderState('error')
          stopPreview()
        })
    }, 140)
    return () => window.clearTimeout(id)
  }, [active, renderRequest, renderEpoch, stopPreview])

  useEffect(() => {
    if (!playing || renderState !== 'ready' || !playbackIntentRef.current || !owns()) return
    beginPreview(positionRef.current % draft.loopBars)
  }, [beginPreview, draft.loopBars, owns, playing, renderState])

  useEffect(() => {
    const retiredPaths = retiredPreviewPathsRef.current
    return () => {
      const job = jobRef.current
      jobRef.current = null
      if (job) void window.rifffApi.cancelShapeMaterialization(job)
      const paths = renderedRef.current.map((stem) => stem.path)
      for (const path of retiredPaths) paths.push(path)
      retiredPaths.clear()
      void stopPreview().finally(() => {
        if (paths.length > 0) void window.rifffApi.cleanupShapePreview(paths)
      })
    }
  }, [stopPreview])

  const applyDraft = useCallback(
    (next: ShapeDraft): void => {
      if (next === draft) return
      setDraft(next)
      setSelected((ids) => {
        const valid = new Set(
          [...ids].filter((id) =>
            next.lanes.some((lane) => lane.fragments.some((f) => f.id === id))
          )
        )
        return valid
      })
      setRangeSelection((range) =>
        range &&
        next.lanes.some(
          (lane) =>
            lane.id === range.laneId &&
            lane.fragments.some((fragment) => fragment.id === range.clipId)
        )
          ? range
          : null
      )
    },
    [draft, setDraft]
  )

  const saveDraft = useCallback(
    (destination: 'keep' | 'shelf' | 'timeline' = 'shelf'): void => {
      if (savingRef.current) return
      savingRef.current = true
      setSaving(destination)
      const save =
        destination === 'keep'
          ? onKeep(draft).then((label) => {
              setKeptLabel(label)
              window.setTimeout(() => setKeptLabel(null), label === 'already kept' ? 1500 : 700)
            })
          : destination === 'shelf'
            ? onAddToShelf(draft)
            : onAddToTimeline(draft)
      void save
        .catch(() => undefined)
        .finally(() => {
          savingRef.current = false
          setSaving(null)
        })
    },
    [draft, onAddToShelf, onAddToTimeline, onKeep]
  )

  const playbackStartBar = useCallback(
    (continueFromStop: boolean): number =>
      shapePlaybackStartBar(
        draft.lanes.flatMap((lane) =>
          lane.fragments
            .filter((fragment) => selected.has(fragment.id))
            .map((fragment) => fragment.destStartBars)
        ),
        cursorBar,
        continueFromStop
      ),
    [cursorBar, draft.lanes, selected]
  )

  useEffect(() => {
    if (!clipMenu) return
    const close = (): void => setClipMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [clipMenu])

  const cutClipAt = useCallback(
    (laneId: string, clipId: string, at: number): void => {
      const ids: [string, string] = [crypto.randomUUID(), crypto.randomUUID()]
      const next = splitShapeFragment(draft, laneId, clipId, at, ids)
      if (next === draft) return
      applyDraft(next)
      setSelected(new Set([ids[1]]))
      setCursorTarget({ laneId, clipId: ids[1] })
    },
    [applyDraft, draft]
  )

  const createEdgesForRange = useCallback(
    (range: ShapeRangeSelection): void => {
      const isolated = isolateShapeFragmentRange(
        draft,
        range.laneId,
        range.clipId,
        range.startBar,
        range.endBar
      )
      applyDraft(isolated.draft)
      setSelected(new Set([isolated.fragmentId]))
      setCursorBar(Math.min(range.startBar, range.endBar))
      setCursorTarget({ laneId: range.laneId, clipId: isolated.fragmentId })
      setRangeSelection(null)
    },
    [applyDraft, draft]
  )

  const findDiscoveredStem = useCallback(
    async (
      kinds: DiscoverSlotKind[],
      random: boolean,
      targetBpm: number,
      replacing?: ShapeSourceStem
    ): Promise<ShapeSourceStem | null> => {
      const sourceDraw = drawSoundSource(sourceLean, cryptoFraction)
      const isReplacement = (source: ShapeSourceStem): boolean =>
        replacing !== undefined &&
        (source.path === replacing.path ||
          (source.name === replacing.name && source.author === replacing.author))
      if (random) {
        for (const source of [sourceDraw.first, sourceDraw.fallback]) {
          if (!source) continue
          for (let attempt = 0; attempt < 4; attempt += 1) {
            const candidate = await window.rifffApi.getRandomDiscoverCandidate(
              kinds,
              false,
              undefined,
              source
            )
            if (!candidate) break
            const resolved = discoveredShapeSource(await resolveCandidateStem(candidate))
            if (resolved && !isReplacement(resolved)) return resolved
          }
        }
        return null
      }
      for (const source of [sourceDraw.first, sourceDraw.fallback]) {
        if (!source) continue
        let pool = rankCandidates(
          await window.rifffApi.getDiscoverCandidates(kinds, false, undefined, source),
          {
            targetBpm,
            targetTraits: kinds.filter(isTraitSlotKind)
          }
        )
        while (pool.length > 0) {
          const candidate = pickReroll(pool, 100 - matching)
          if (!candidate) break
          pool = pool.filter((item) => item.candidate.stemCID !== candidate.stemCID)
          const resolved = discoveredShapeSource(await resolveCandidateStem(candidate))
          if (resolved && !isReplacement(resolved)) return resolved
        }
      }
      return null
    },
    [matching, sourceLean]
  )

  const skipLane = useCallback(
    async (lane: ShapeLane, kinds: DiscoverSlotKind[]): Promise<void> => {
      const draftId = draftRef.current.id
      const projectKey = draftRef.current.projectKey
      const targetBpm = draftRef.current.targetBpm
      const requestEpoch = asyncRequestEpochRef.current
      const requestId = crypto.randomUUID()
      laneRequestRef.current.set(lane.id, requestId)
      const isCurrent = (): boolean =>
        draftRef.current.id === draftId &&
        draftRef.current.projectKey === projectKey &&
        asyncRequestEpochRef.current === requestEpoch &&
        laneRequestRef.current.get(lane.id) === requestId
      setDiscoverError(null)
      setRollingLanes((current) => new Set(current).add(lane.id))
      try {
        const replacement = await findDiscoveredStem(kinds, false, targetBpm, lane.source)
        if (!isCurrent()) return
        if (!replacement) {
          setDiscoverError('no similar replacement found')
          return
        }
        setDraft((current) =>
          current?.id === draftId && current.projectKey === projectKey
            ? replaceShapeLaneSource(current, lane.id, replacement)
            : current
        )
      } catch (error) {
        if (!isCurrent()) return
        console.error('ShapePanel: failed to skip a stem:', error)
        setDiscoverError('could not replace that stem')
      } finally {
        if (isCurrent()) {
          laneRequestRef.current.delete(lane.id)
          setRollingLanes((current) => {
            const next = new Set(current)
            next.delete(lane.id)
            return next
          })
        }
      }
    },
    [findDiscoveredStem, setDraft]
  )

  const addDiscoveredLane = useCallback(
    async (kind: DiscoverSlotKind | 'random'): Promise<void> => {
      if (draftRef.current.lanes.length >= MAX_RIFFF_STEM_SLOTS || discoverBusy) return
      const draftId = draftRef.current.id
      const projectKey = draftRef.current.projectKey
      const targetBpm = draftRef.current.targetBpm
      const requestEpoch = asyncRequestEpochRef.current
      const isCurrent = (): boolean =>
        draftRef.current.id === draftId &&
        draftRef.current.projectKey === projectKey &&
        asyncRequestEpochRef.current === requestEpoch
      setDiscoverBusy(kind)
      setDiscoverError(null)
      try {
        const stem = await findDiscoveredStem(
          [kind === 'random' ? randomShapeSlotKind() : kind],
          kind === 'random',
          targetBpm
        )
        if (!isCurrent()) return
        if (!stem) {
          setDiscoverError('no matching stem found')
          return
        }
        setDraft((current) =>
          current?.id === draftId &&
          current.projectKey === projectKey &&
          current.lanes.length < MAX_RIFFF_STEM_SLOTS
            ? addShapeLane(current, stem)
            : current
        )
      } catch (error) {
        if (!isCurrent()) return
        console.error('ShapePanel: failed to add a discovered stem:', error)
        setDiscoverError('could not add that stem')
      } finally {
        if (isCurrent()) setDiscoverBusy(null)
      }
    },
    [discoverBusy, findDiscoveredStem, setDraft]
  )

  const addSampleLane = useCallback(async (): Promise<void> => {
    if (draftRef.current.lanes.length >= MAX_RIFFF_STEM_SLOTS || discoverBusy) return
    const draftId = draftRef.current.id
    const projectKey = draftRef.current.projectKey
    const targetBpm = draftRef.current.targetBpm
    const requestEpoch = asyncRequestEpochRef.current
    const isCurrent = (): boolean =>
      draftRef.current.id === draftId &&
      draftRef.current.projectKey === projectKey &&
      asyncRequestEpochRef.current === requestEpoch
    setDiscoverBusy('sample')
    setDiscoverError(null)
    try {
      const paths = await window.rifffApi.pickDiscoverLoopSeedPaths()
      for (const path of paths) {
        if (!isCurrent()) break
        const imported = await window.rifffApi.importDiscoverLoopSeed(path, targetBpm)
        if (!isCurrent()) break
        if (!imported) continue
        const source: ShapeSourceStem = { author: '', type: 'fx', ...imported }
        setDraft((current) =>
          current?.id === draftId &&
          current.projectKey === projectKey &&
          current.lanes.length < MAX_RIFFF_STEM_SLOTS
            ? addShapeLane(current, source)
            : current
        )
      }
    } finally {
      if (isCurrent()) setDiscoverBusy(null)
    }
  }, [discoverBusy, setDraft])

  useEffect(() => {
    if (!active) return
    function keydown(event: KeyboardEvent): void {
      const command = event.metaKey || event.ctrlKey
      if (!shapeOwnsKey(event.key, event.code, command)) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code === 'Space') {
        if (playing && playbackIntentRef.current && owns()) stopPreview()
        else beginPreview(playbackStartBar(event.shiftKey))
        return
      }
      if (event.key === 'Escape') {
        if (rangeSelection) setRangeSelection(null)
        else if (selected.size > 0) setSelected(new Set())
        else onClose()
        return
      }
      if (command && event.key.toLowerCase() === 's') {
        saveDraft()
        return
      }
      if (command && event.key.toLowerCase() === 'z') {
        applyDraft(event.shiftKey ? redoShape(draft) : undoShape(draft))
        return
      }
      if (command && event.key === '1') {
        setSnapIndex((index) => adjustShapeSnapIndex(index, SNAP_CHOICES.length - 2, 'narrower'))
        return
      }
      if (command && event.key === '2') {
        setSnapIndex((index) => adjustShapeSnapIndex(index, SNAP_CHOICES.length - 2, 'wider'))
        return
      }
      if (command && event.key.toLowerCase() === 'e') {
        if (rangeSelection) {
          createEdgesForRange(rangeSelection)
          return
        }
        if (cursorTarget) {
          cutClipAt(cursorTarget.laneId, cursorTarget.clipId, cursorBar)
          return
        }
        let next = draft
        const editPosition = playing ? positionRef.current % draft.loopBars : cursorBar
        const at = snapBar(editPosition, SNAP_CHOICES[snapIndex].bars, draft.loopBars)
        for (const lane of draft.lanes) {
          const targets = lane.fragments.filter(
            (fragment) =>
              (selected.size === 0 || selected.has(fragment.id)) &&
              at > fragment.destStartBars &&
              at < fragmentEnd(fragment)
          )
          for (const fragment of targets) next = splitShapeFragment(next, lane.id, fragment.id, at)
        }
        applyDraft(groupShapeEdits(draft, next))
        return
      }
      if (command && event.key.toLowerCase() === 'd') {
        let next = draft
        for (const lane of draft.lanes) {
          for (const fragment of lane.fragments) {
            if (selected.has(fragment.id)) next = duplicateShapeFragment(next, lane.id, fragment.id)
          }
        }
        applyDraft(groupShapeEdits(draft, next))
        return
      }
      if (event.key === '0') {
        applyDraft(toggleShapeFragmentsDisabled(draft, selected))
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (rangeSelection) {
          const removed = removeShapeFragmentRange(
            draft,
            rangeSelection.laneId,
            rangeSelection.clipId,
            rangeSelection.startBar,
            rangeSelection.endBar
          )
          applyDraft(removed)
          setCursorBar(Math.min(rangeSelection.startBar, rangeSelection.endBar))
          setCursorTarget(null)
          setRangeSelection(null)
          setSelected(new Set())
          return
        }
        applyDraft(removeShapeFragments(draft, selected))
        setSelected(new Set())
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [
    active,
    applyDraft,
    beginPreview,
    createEdgesForRange,
    cutClipAt,
    cursorBar,
    cursorTarget,
    draft,
    onClose,
    owns,
    playbackStartBar,
    playing,
    rangeSelection,
    saveDraft,
    selected,
    snapIndex,
    stopPreview
  ])

  const shapePlaying = playing && playbackIntent
  const shownPosition = shapePlaying ? pos % draft.loopBars : cursorBar
  const playheadPct = (shownPosition / draft.loopBars) * 100
  const rulerSnapBars = SNAP_CHOICES[snapIndex].bars
  const rulerMinorGridPct =
    rulerSnapBars < 1 ? shapeGridSizePct(draft.loopBars, rulerSnapBars) : null
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ra-bg-page)',
        color: 'var(--ra-text)'
      }}
    >
      <style>{`
        @keyframes ra-shape-marker-pulse {
          0%, 100% { opacity: 0.24; }
          50% { opacity: 0.58; }
        }
        .ra-shape-insert-marker {
          position: absolute;
          top: 15px;
          bottom: 0;
          z-index: 6;
          width: 1px;
          background: color-mix(in srgb, var(--ra-text) 64%, transparent);
          pointer-events: none;
          animation: ra-shape-marker-pulse 1.05s steps(2, end) infinite;
        }
        .ra-shape-clip-menu button:hover {
          background: #4a4a4a !important;
          color: #ffffff !important;
        }
        .ra-shape-clip-edge {
          position: absolute;
          top: 0;
          bottom: 0;
          z-index: 7;
          width: 6px;
          touch-action: none;
        }
        .ra-shape-clip-edge--left,
        html.ra-shape-resizing-left,
        html.ra-shape-resizing-left * {
          cursor: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAJaSURBVHgBtVZLjtpAEHX7h7FhZkAQAlEkC7GCJRfgEtwHrsMpuARbxAYQ4iM2AcS4u/PK2KMe4s94pJRk9b+r6lXVa2vafxaWty6lfHQY05L6EEnjbynAJWw6nYZ7FosF2+/3YX8+n2vj8VgOBgM5mUykekT7qtDlOKyjawyHQ8v3fQd9t9VqeZ1Ox43GFhQZkaeJxpp5inC5vt1urfV6/ed5DdC4y+UyiIY86byedjHhSrDsdjtzs9nY8Vz8kdTrdet4PBrxEa2IRPBY+LxqtdqQj6hKVTB+w+eMRiOzsAI6gCDajUajin5LVVAqlXqu63Ywfo1iYaTFIBUius9xHCmEYM/7AJG4XC6EufA8T2iP7JGFFHxs0HUJa9mTggCwBcgm3u/3uVSKopCC2+3GDodD6JA6f71euWEY3LZtMZvNRKS0mAI6QBAhU5JOCngmVquViLKquAfIIkYeUPCA96c1QBa2SAItA51sibKC8v8FX1vNIrQ/4dkLZVla9uR6QByEKpaqxYoHH9SQRXR5EnpAluLCZw9+vUGoBoiLsmDKTdPT6fTPXLlcNs7ns3G/33XFmGKuEASEMbpUye0UqqA1i2ilcCVTDChNm83mpypVya5Wq+m9Xk8nUtSKClkUkZhXqVSaMkGg4BXr3+Mi0kHWI5DcNM13WN0G9j5aH0H/jfYHqjnkIQQ69ZKsB4diIPGgcATzThOc8wDKGJEdrA8AYYBUzqSKVAVx+cM6uuAdD4sAB4WPCyyXRIJ4PoNutxvyURpdfOmvgkyGonBv/PATfMqjn1oIfwGqMUPKPvTX4QAAAABJRU5ErkJggg==") 12 12, w-resize !important;
        }
        .ra-shape-clip-edge--right,
        html.ra-shape-resizing-right,
        html.ra-shape-resizing-right * {
          cursor: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAJeSURBVHgBtVVLquJAFK18/OvDb9sh0ojYA3HoBtyE61HX4ybcgEOnQoMTQXEgHdFYVX1uuuLLy0tM8uBdKJJUpe65534Z+2bRojallN4ZxH9nL95lJgBcfO4tl0ttvV7rwfNOpyNXq5WU71ZkByDF2+1W2+12+mazMXq9nua6rn44HGS/3xetVosPBgMBIEE4r0DMT4jaf8zJZEIKTShwwv/Ytl3BwyV71EovxGCxWJBbCs1m80254rnUdx2sStPp1Ay6NDXAbDYjt5RIkQyID1CtVjvdbpdY5FhMoviixx3s93tRr9dZpVKx4bbfISN0zjnd1fxsygQwHo8lLdM0OZQLbIkwwPF41JKsJ4kKsmcS3MTP5zO/3W5uqVR6hP9DfJhlWYkBjmRAtIlBPp8Xl8uFY4sHzx3HYWnFjNr0WQBENBoNCRZhS71v1MozreMkNshI1edNWPwBoFwua8oAlhTkWFH5ncd6w7KCaYrnT6oRAOST6iAuBl67IAshmm9xmEGxWJRJLkoCL6AW6sgiO8TAarfbNWKgqj69BFqFQcZitQDwKwgABhbev+4iEmp2sNKAgiOC/Cd45meZyqLsANSqT6eTodqBl4phPQCnaqdsY5kAfEVoE9KnT97xl/pHGIYhKMgAeJmnnwpNDRA2HA6ZruuiVqv9AJPi9Xo1EAuB5x1xv2NWiNFo9LVWQVYVCgUJCx+5XO4ONg5a9F96orKvCPId7uGYByKp0CKbnbr0ICDMBSmEcMHCcxcABWbBg0bmfD6XSTM5thcpEI6A0+xlsNYDoKFPjTCNcpJ/v05k/nA351QAAAAASUVORK5CYII=") 12 12, e-resize !important;
        }
      `}</style>
      <div
        style={{
          height: 48,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 12px',
          borderBottom: '1px solid var(--ra-border)'
        }}
      >
        <button
          onClick={() =>
            playing && playbackIntentRef.current && owns()
              ? stopPreview()
              : beginPreview(playbackStartBar(false))
          }
          style={buttonStyle(shapePlaying)}
        >
          {shapePlaying ? '■ stop' : '▶ play'}
        </button>
        <button
          onClick={() => setRazor((value) => !value)}
          style={{
            ...buttonStyle(razor),
            width: 29,
            padding: 0,
            display: 'grid',
            placeItems: 'center'
          }}
          aria-pressed={razor}
          aria-label="razor tool"
          title="razor tool — click a clip body to cut"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <g transform="rotate(180 8 8)">
              <path
                d="M2 4.5h12l-1.7 7H3.7L2 4.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinejoin="miter"
              />
              <path d="M6 7h4v2H6Z" fill="none" stroke="currentColor" strokeWidth="1" />
            </g>
          </svg>
        </button>
        <button
          onClick={() => setMode((value) => (value === 'shaped' ? 'original' : 'shaped'))}
          style={buttonStyle(mode === 'original')}
          title="switch the preview between your Shape edits and the untouched source riff"
        >
          preview: {mode === 'original' ? 'original' : 'shaped'}
        </button>
        <span style={{ color: 'var(--ra-text-4)', fontSize: 9 }}>{draft.targetBpm} bpm</span>
        <button
          onClick={() => applyDraft(undoShape(draft))}
          style={buttonStyle()}
          disabled={!draft.past.length}
        >
          undo
        </button>
        <button
          onClick={() => applyDraft(redoShape(draft))}
          style={buttonStyle()}
          disabled={!draft.future.length}
        >
          redo
        </button>
        <button onClick={() => applyDraft(resetShapeRiff(draft))} style={buttonStyle()}>
          reset riff
        </button>
        <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--ra-text-4)' }}>snap</span>
        <button
          ref={snapButtonRef}
          onClick={() => {
            if (snapMenu) {
              setSnapMenu(null)
              return
            }
            const rect = snapButtonRef.current?.getBoundingClientRect()
            if (rect) setSnapMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
          style={{ ...buttonStyle(), minWidth: 48, padding: '0 6px' }}
          aria-haspopup="menu"
          aria-expanded={snapMenu !== null}
        >
          {SNAP_CHOICES[snapIndex].label} ▾
        </button>
        {snapMenu && (
          <ContextMenu
            x={snapMenu.x}
            y={snapMenu.y}
            ignoreRef={snapButtonRef}
            items={SNAP_CHOICES.map((choice, index) => ({
              label: `${index === snapIndex ? '✓ ' : ''}${choice.label}`,
              onClick: () => setSnapIndex(index)
            }))}
            onClose={() => setSnapMenu(null)}
          />
        )}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--ra-text-4)' }}>
          {renderState === 'rendering'
            ? 'rendering preview…'
            : renderState === 'error'
              ? 'preview failed'
              : 'ready'}
        </span>
        <button onClick={() => saveDraft('keep')} disabled={!!saving} style={buttonStyle()}>
          {saving === 'keep' ? 'keeping…' : (keptLabel ?? 'keep')}
        </button>
        <button onClick={() => saveDraft('shelf')} disabled={!!saving} style={buttonStyle()}>
          {saving === 'shelf' ? 'saving…' : 'add to shelf'}
        </button>
        <button onClick={() => saveDraft('timeline')} disabled={!!saving} style={buttonStyle()}>
          {saving === 'timeline' ? 'saving…' : 'add to timeline'}
        </button>
        <button onClick={onClose} aria-label="close shape riff" style={buttonStyle()}>
          ×
        </button>
      </div>
      <div style={{ padding: '8px 12px', color: 'var(--ra-text-4)', fontSize: 9 }}>
        clip header: select / drag · clip edges: trim · clip body: click cursor / drag region ·
        cmd-e create edge(s) · cmd-1/2 grid · 0 disable
      </div>
      <div
        style={{ position: 'relative', overflow: 'auto', borderTop: '1px solid var(--ra-border)' }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${SHAPE_LEFT_WIDTH}px minmax(0, 1fr) ${SHAPE_RIGHT_WIDTH}px`,
            height: 25,
            color: 'var(--ra-text-4)',
            fontSize: 8,
            borderBottom: '1px solid var(--ra-border)'
          }}
        >
          <div style={{ borderRight: '1px solid var(--ra-border)' }} />
          <div
            aria-label="shape riff timeline ruler"
            title="click to set the edit position"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const rect = event.currentTarget.getBoundingClientRect()
              const raw = ((event.clientX - rect.left) / rect.width) * draft.loopBars
              const bar = snapBar(raw, SNAP_CHOICES[snapIndex].bars, draft.loopBars)
              setCursorBar(bar)
              setRangeSelection(null)
              if (shapePlaying) void window.rifffApi.engineSetPosition(bar)
            }}
            style={{
              position: 'relative',
              cursor: 'crosshair',
              backgroundImage: rulerMinorGridPct
                ? 'linear-gradient(to right, var(--ra-border-strong) 1px, transparent 1px), linear-gradient(to right, color-mix(in srgb, var(--ra-border) 55%, transparent) 1px, transparent 1px)'
                : 'linear-gradient(to right, var(--ra-border-strong) 1px, transparent 1px)',
              backgroundSize: rulerMinorGridPct
                ? `${100 / draft.loopBars}% 100%, ${rulerMinorGridPct}% 100%`
                : `${100 / draft.loopBars}% 100%`
            }}
          >
            {Array.from({ length: Math.floor(draft.loopBars) + 1 }, (_, bar) => (
              <span
                key={bar}
                style={{
                  position: 'absolute',
                  left: `${(bar / draft.loopBars) * 100}%`,
                  top: 7,
                  paddingLeft: bar === draft.loopBars ? 0 : 3,
                  transform: bar === draft.loopBars ? 'translateX(-100%)' : undefined,
                  pointerEvents: 'none'
                }}
              >
                {bar + 1}
              </span>
            ))}
          </div>
          <div style={{ borderLeft: '1px solid var(--ra-border)' }} />
        </div>
        {draft.lanes.map((lane) => (
          <ShapeLaneRow
            key={lane.id}
            draft={draft}
            lane={lane}
            selected={selected}
            muted={muted.has(lane.id)}
            soloed={soloed === lane.id}
            snapSize={SNAP_CHOICES[snapIndex].bars}
            cursorBar={cursorBar}
            cursorTarget={cursorTarget}
            rangeSelection={rangeSelection}
            razor={razor}
            rolling={rollingLanes.has(lane.id)}
            kinds={laneKinds[lane.id] ?? [discoverSlotKindForSoundType(lane.source.type)]}
            onDraft={applyDraft}
            onSelect={(id, additive) => {
              if (!id) setRangeSelection(null)
              setSelected((current) => {
                if (!id) return new Set()
                if (!additive) return new Set([id])
                const next = new Set(current)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }}
            onLaneSelect={(ids, additive) => {
              setRangeSelection(null)
              setCursorTarget(null)
              setSelected((current) => {
                if (!additive) return new Set(ids)
                const next = new Set(current)
                const remove = ids.every((id) => next.has(id))
                for (const id of ids) {
                  if (remove) next.delete(id)
                  else next.add(id)
                }
                return next
              })
            }}
            onClipHeaderSelect={(laneId, clipId, startBar) => {
              setCursorBar(startBar)
              setCursorTarget({ laneId, clipId })
              setRangeSelection(null)
            }}
            onClipBodyClick={(laneId, clipId, bar) => {
              setCursorBar(bar)
              setRangeSelection(null)
              setSelected(new Set())
              if (razor) cutClipAt(laneId, clipId, bar)
              else setCursorTarget({ laneId, clipId })
              if (shapePlaying) void window.rifffApi.engineSetPosition(bar)
            }}
            onClipRangeSelect={(laneId, clipId, startBar, endBar) => {
              if (Math.abs(endBar - startBar) < 1e-9) {
                setRangeSelection(null)
                return
              }
              setRangeSelection({ laneId, clipId, startBar, endBar })
              setSelected(new Set())
              setCursorBar(Math.min(startBar, endBar))
              setCursorTarget({ laneId, clipId })
            }}
            onClipContextMenu={(laneId, clipId, x, y, range) => {
              if (range) {
                setClipMenu({ kind: 'range', ...range, x, y })
                return
              }
              setSelected((current) => (current.has(clipId) ? current : new Set([clipId])))
              setCursorTarget({ laneId, clipId })
              setRangeSelection(null)
              setClipMenu({ kind: 'clip', laneId, clipId, x, y })
            }}
            onMute={() =>
              setMuted((current) => {
                const next = new Set(current)
                if (next.has(lane.id)) next.delete(lane.id)
                else next.add(lane.id)
                return next
              })
            }
            onSolo={() => {
              smoothNextPreviewRef.current = playing && playbackIntentRef.current && owns()
              setSoloed((current) => (current === lane.id ? null : lane.id))
            }}
            onGainPreview={(gain) =>
              setDraft((current) =>
                current ? previewShapeLaneGain(current, lane.id, gain) : current
              )
            }
            onGainCommit={(startingGain, gain) =>
              setDraft((current) =>
                current
                  ? finishShapeLaneGain(
                      previewShapeLaneGain(current, lane.id, gain),
                      lane.id,
                      startingGain
                    )
                  : current
              )
            }
            onSkip={() =>
              void skipLane(
                lane,
                laneKinds[lane.id] ?? [discoverSlotKindForSoundType(lane.source.type)]
              )
            }
            onChangeKinds={(kinds) => {
              if (rollingLanes.has(lane.id)) return
              setLaneKinds((current) => ({ ...current, [lane.id]: kinds }))
              void skipLane(lane, kinds)
            }}
            onSeek={(bar) => {
              setCursorBar(bar)
              if (shapePlaying) void window.rifffApi.engineSetPosition(bar)
            }}
          />
        ))}
        {draft.lanes.length < MAX_RIFFF_STEM_SLOTS && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `${SHAPE_LEFT_WIDTH}px minmax(0, 1fr) ${SHAPE_RIGHT_WIDTH}px`,
              minHeight: 50,
              color: 'var(--ra-text-4)',
              fontSize: 9
            }}
          >
            <div style={{ borderRight: '1px solid var(--ra-border)' }} />
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                margin: 6,
                border: '1px dashed var(--ra-border)'
              }}
            >
              empty stem lane
            </div>
            <div style={{ borderLeft: '1px solid var(--ra-border)' }} />
          </div>
        )}
        <div
          style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--ra-border)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--ra-text)', marginRight: 4 }}>
            add a stem that is:
          </span>
          {DISCOVER_SLOT_KIND_OPTIONS.map((kind) => (
            <Fragment key={kind}>
              {kind === 'bassHeavy' && (
                <span style={{ width: 1, height: 18, background: 'var(--ra-border)' }} />
              )}
              <button
                onClick={() => void addDiscoveredLane(kind)}
                disabled={!!discoverBusy || draft.lanes.length >= MAX_RIFFF_STEM_SLOTS}
                style={buttonStyle()}
              >
                {discoverBusy === kind ? '…' : DISCOVER_SLOT_KIND_LABEL[kind]}
              </button>
            </Fragment>
          ))}
          <span style={{ width: 1, height: 18, background: 'var(--ra-border)' }} />
          <button
            onClick={() => void addDiscoveredLane('random')}
            disabled={!!discoverBusy || draft.lanes.length >= MAX_RIFFF_STEM_SLOTS}
            style={buttonStyle()}
          >
            {discoverBusy === 'random' ? '…' : '+ random'}
          </button>
          <button
            onClick={() => void addSampleLane()}
            disabled={!!discoverBusy || draft.lanes.length >= MAX_RIFFF_STEM_SLOTS}
            style={buttonStyle()}
          >
            {discoverBusy === 'sample' ? '…' : '+ sample'}
          </button>
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 18,
              paddingTop: 7
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 7, color: 'var(--ra-text-3)' }}>endlesss</span>
                <Dial
                  value={sourceLean}
                  onChange={setSourceLean}
                  onCommit={onSourceLeanCommit}
                  defaultValue={DEFAULT_SOURCE_LEAN}
                  size={28}
                  ariaLabel="source"
                  tooltip="other sounds clockwise"
                />
                <span style={{ fontSize: 7, color: 'var(--ra-text-3)' }}>other</span>
              </div>
              <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>source</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Dial
                value={matching}
                onChange={setMatching}
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
              style={{ width: '100%', textAlign: 'center', fontSize: 8, color: 'var(--ra-text-3)' }}
            >
              {discoverError}
            </span>
          )}
        </div>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 25,
            height: draft.lanes.length * 72 + (draft.lanes.length < MAX_RIFFF_STEM_SLOTS ? 50 : 0),
            left: `calc(${SHAPE_LEFT_WIDTH}px + (100% - ${SHAPE_LEFT_WIDTH + SHAPE_RIGHT_WIDTH}px) * ${playheadPct / 100})`,
            width: 1,
            background: `color-mix(in srgb, var(--ra-text) ${shapePlaying ? 38 : 20}%, transparent)`,
            pointerEvents: 'none'
          }}
        />
      </div>
      {clipMenu && (
        <div
          className="ra-shape-clip-menu"
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(clipMenu.x, window.innerWidth - 176)),
            top: Math.max(8, Math.min(clipMenu.y, window.innerHeight - 150)),
            zIndex: 'var(--ra-z-fullscreen-popover)',
            width: 168,
            padding: '3px 0',
            border: '1px solid #5a5a5a',
            background: '#202020',
            boxShadow: '0 7px 22px rgba(0, 0, 0, 0.72)',
            display: 'grid',
            gap: 0
          }}
        >
          {(clipMenu.kind === 'range'
            ? [
                {
                  label: 'create edges',
                  action: () => createEdgesForRange(clipMenu)
                }
              ]
            : [
                {
                  label: 'duplicate clip',
                  action: () =>
                    applyDraft(duplicateShapeFragment(draft, clipMenu.laneId, clipMenu.clipId))
                },
                {
                  label: 'reverse clip',
                  action: () => applyDraft(reverseShapeFragments(draft, new Set([clipMenu.clipId])))
                },
                {
                  label: 'disable / enable',
                  action: () =>
                    applyDraft(toggleShapeFragmentsDisabled(draft, new Set([clipMenu.clipId])))
                },
                {
                  label: 'delete clip',
                  action: () => applyDraft(removeShapeFragments(draft, new Set([clipMenu.clipId])))
                }
              ]
          ).map(({ label, action }) => (
            <button
              key={label}
              onClick={() => {
                action()
                setClipMenu(null)
              }}
              style={{
                display: 'block',
                width: '100%',
                height: 25,
                padding: '0 14px',
                border: 'none',
                borderTop: label === 'delete clip' ? '1px solid #414141' : 'none',
                background: '#202020',
                color: 'var(--ra-text)',
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: 10,
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
