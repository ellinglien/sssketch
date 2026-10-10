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
  addBakedShapeProcessLanes,
  addShapeLane,
  bakeShapeFragmentProcesses,
  copyShapeFragment,
  discardOrphanedShapeProcessPreview,
  duplicateShapeFragment,
  finishShapeLaneGain,
  groupShapeEdits,
  isolateShapeFragmentRange,
  moveShapeFragment,
  normalizeShapeClipProcess,
  previewShapeLaneGain,
  removeShapeFragmentRange,
  redoShape,
  removeShapeFragments,
  removeShapeLane,
  resizeShapeFragment,
  reverseShapeFragments,
  replaceShapeLaneSource,
  resetShapeLane,
  resetShapeRiff,
  setShapeFragmentCharacter,
  setShapeFragmentFormant,
  setShapeFragmentProcess,
  setShapeFragmentRate,
  setShapeFragmentTransform,
  shapeClipTransform,
  shapeFragmentEndBars,
  shapeFragmentLengthBars,
  shapeFragmentRate,
  shapeRenderFingerprint,
  shapeRenderSegments,
  shapeWaveformLayout,
  SHAPE_PITCH_SEMITONE_LIMIT,
  splitShapeFragment,
  toggleShapeFragmentsDisabled,
  undoShape,
  type ShapeDraft,
  type ShapeBakeProcessItem,
  type ShapeLane,
  type ShapeMaterializedStem
} from '@shared/shape'
import type { ShapeClipProcessV1, ShapeSourceStem, Stem } from '@shared/types'
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
import { ArrowCounterClockwise, Eye, EyeSlash, SkipForward } from '@phosphor-icons/react'

const SHAPE_RENDER_IDLE_MS = 260

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

interface ShapeProcessSession {
  unitId: string
  before: ShapeDraft
  workingBase: ShapeDraft
  fragmentIds: Set<string>
  originalSelected: Set<string>
  originalRange: ShapeRangeSelection | null
  process: ShapeClipProcessV1
  bypass: boolean
  dirty: boolean
}

export interface ShapeProcessRackUnit {
  id: string
  process: ShapeClipProcessV1
}

type ShapeClipMenu =
  | ({ kind: 'clip'; x: number; y: number } & ShapeCursorTarget)
  | ({ kind: 'range'; x: number; y: number } & ShapeRangeSelection)

function InspectorNumber({
  value,
  min,
  max,
  suffix,
  signed,
  defaultValue,
  disabled,
  compact = false,
  onCommit
}: {
  value: number | null
  min: number
  max: number
  suffix: string
  signed?: boolean
  defaultValue?: number
  disabled?: boolean
  compact?: boolean
  onCommit: (value: number) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value === null ? '' : String(value))
  const display = value === null ? '—' : `${signed && value > 0 ? '+' : ''}${value}`
  const modified = value !== null && defaultValue !== undefined && value !== defaultValue
  function commitAndClose(): void {
    if (text.trim() === '') {
      setText(value === null ? '' : String(value))
      setEditing(false)
      return
    }
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setText(value === null ? '' : String(value))
      setEditing(false)
      return
    }
    const next = Math.max(min, Math.min(max, Math.round(parsed)))
    setText(String(next))
    setEditing(false)
    onCommit(next)
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? 0 : 4
      }}
    >
      {editing ? (
        <input
          autoFocus
          aria-label={`enter ${suffix} value`}
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitAndClose}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitAndClose()
            if (event.key === 'Escape') {
              setText(value === null ? '' : String(value))
              setEditing(false)
            }
          }}
          style={{
            width: compact ? 42 : 50,
            height: compact ? 19 : 24,
            padding: compact ? '0 3px' : '0 5px',
            border: `1px solid ${modified ? 'color-mix(in srgb, var(--ra-type-fx) 34%, var(--ra-border))' : 'var(--ra-text-3)'}`,
            outline: 'none',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-3)',
            fontFamily: 'inherit',
            fontSize: compact ? 8 : 10,
            textAlign: 'right'
          }}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          title="double-click to enter a value"
          onDoubleClick={() => {
            if (disabled) return
            setText(value === null ? '' : String(value))
            setEditing(true)
          }}
          style={{
            width: compact ? 42 : 50,
            height: compact ? 19 : 24,
            padding: compact ? '0 3px' : '0 5px',
            border: `1px solid ${modified ? 'color-mix(in srgb, var(--ra-type-fx) 34%, var(--ra-border))' : 'var(--ra-border)'}`,
            background: modified
              ? 'color-mix(in srgb, var(--ra-type-fx) 6%, var(--ra-bg-row-active))'
              : 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-3)',
            fontFamily: 'inherit',
            fontSize: compact ? 8 : 10,
            textAlign: 'right',
            cursor: disabled ? 'default' : 'text',
            opacity: disabled ? 0.45 : 1
          }}
        >
          {display}
          {compact && suffix ? <span style={{ marginLeft: 2 }}>{suffix}</span> : null}
        </button>
      )}
      {!compact && <span style={{ color: 'var(--ra-text-4)', fontSize: 8 }}>{suffix}</span>}
    </div>
  )
}

function commonNumber(values: number[]): number | null {
  if (values.length === 0) return null
  return values.every((value) => value === values[0]) ? values[0] : null
}

type ShapeProcessType = ShapeClipProcessV1['type']

const SHAPE_PROCESS_CATALOG: ReadonlyArray<{ type: ShapeProcessType; label: string }> = [
  { type: 'wavefold', label: 'Wavefold' },
  { type: 'saturation', label: 'Saturation' },
  { type: 'hard-clip', label: 'Hard Clip' },
  { type: 'rectify', label: 'Rectify' },
  { type: 'bit-crush', label: 'Bit Crush' },
  { type: 'rate-crush', label: 'Rate Crush' },
  { type: 'ring-mod', label: 'Ring Mod' },
  { type: 'comb', label: 'Comb' },
  { type: 'smear', label: 'Smear' }
]

function shapeProcessLabel(type: ShapeProcessType): string {
  return SHAPE_PROCESS_CATALOG.find((item) => item.type === type)?.label ?? type
}

function defaultShapeProcess(type: ShapeProcessType): ShapeClipProcessV1 {
  switch (type) {
    case 'wavefold':
      return { type, drive: 2, bias: 0, mix: 1 }
    case 'saturation':
      return { type, drive: 9, bias: 0, outputDb: 0, mix: 1 }
    case 'hard-clip':
      return { type, threshold: 0.5, symmetry: 0, mix: 1 }
    case 'rectify':
      return { type, mode: 'full', drive: 1, mix: 1 }
    case 'bit-crush':
      return { type, bits: 8, dither: 0, mix: 1 }
    case 'rate-crush':
      return { type, factor: 8, jitter: 0, mix: 1 }
    case 'ring-mod':
      return { type, frequencyHz: 100, shape: 0, mix: 1 }
    case 'comb':
      return { type, delayMs: 12, feedback: 0.5, damping: 0.5, mix: 0.5 }
    case 'smear':
      return { type, timeMs: 80, scatter: 0.5, mix: 1 }
  }
}

function ProcessKnob({
  label,
  value,
  min,
  max,
  defaultValue,
  suffix,
  signed,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  suffix: string
  signed?: boolean
  onChange: (value: number) => void
}): React.JSX.Element {
  const dialValue = ((value - min) / (max - min)) * 100
  const defaultDialValue = ((defaultValue - min) / (max - min)) * 100
  const fromDial = (next: number): number =>
    Math.max(min, Math.min(max, Math.round(min + (next / 100) * (max - min))))
  return (
    <div
      style={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2
      }}
    >
      <span style={{ fontSize: 7, color: 'var(--ra-text-3)' }}>{label}</span>
      <Dial
        value={dialValue}
        defaultValue={defaultDialValue}
        size={28}
        inkColor="var(--ra-text-2)"
        ariaLabel={`${label} ${value}${suffix}`}
        onChange={(next) => onChange(fromDial(next))}
      />
      <InspectorNumber
        key={`${label}-${value}`}
        value={value}
        min={min}
        max={max}
        suffix={suffix}
        signed={signed}
        defaultValue={defaultValue}
        compact
        onCommit={onChange}
      />
    </div>
  )
}

function ShapeProcessControls({
  process,
  onChange
}: {
  process: ShapeClipProcessV1
  onChange: (process: ShapeClipProcessV1) => void
}): React.JSX.Element {
  const controls: React.JSX.Element[] = []
  switch (process.type) {
    case 'wavefold':
      controls.push(
        <ProcessKnob
          key="drive"
          label="drive"
          value={Math.round(process.drive)}
          min={1}
          max={16}
          defaultValue={2}
          suffix="×"
          onChange={(drive) => onChange({ ...process, drive })}
        />,
        <ProcessKnob
          key="bias"
          label="bias"
          value={Math.round(process.bias * 100)}
          min={-100}
          max={100}
          defaultValue={0}
          suffix="%"
          signed
          onChange={(bias) => onChange({ ...process, bias: bias / 100 })}
        />
      )
      break
    case 'saturation':
      controls.push(
        <ProcessKnob
          key="drive"
          label="drive"
          value={Math.round(process.drive)}
          min={1}
          max={16}
          defaultValue={9}
          suffix="×"
          onChange={(drive) => onChange({ ...process, drive })}
        />,
        <ProcessKnob
          key="bias"
          label="bias"
          value={Math.round(process.bias * 100)}
          min={-100}
          max={100}
          defaultValue={0}
          suffix="%"
          signed
          onChange={(bias) => onChange({ ...process, bias: bias / 100 })}
        />,
        <ProcessKnob
          key="output"
          label="output"
          value={Math.round(process.outputDb)}
          min={-24}
          max={24}
          defaultValue={0}
          suffix="dB"
          signed
          onChange={(outputDb) => onChange({ ...process, outputDb })}
        />
      )
      break
    case 'hard-clip':
      controls.push(
        <ProcessKnob
          key="threshold"
          label="threshold"
          value={Math.round(process.threshold * 100)}
          min={5}
          max={100}
          defaultValue={50}
          suffix="%"
          onChange={(threshold) => onChange({ ...process, threshold: threshold / 100 })}
        />,
        <ProcessKnob
          key="symmetry"
          label="symmetry"
          value={Math.round(process.symmetry * 100)}
          min={-100}
          max={100}
          defaultValue={0}
          suffix="%"
          signed
          onChange={(symmetry) => onChange({ ...process, symmetry: symmetry / 100 })}
        />
      )
      break
    case 'rectify':
      controls.push(
        <div key="mode" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 8, color: 'var(--ra-text-3)', textAlign: 'center' }}>mode</span>
          <button
            style={{ ...buttonStyle(process.mode === 'half'), height: 26 }}
            onClick={() => onChange({ ...process, mode: 'half' })}
          >
            half
          </button>
          <button
            style={{ ...buttonStyle(process.mode === 'full'), height: 26 }}
            onClick={() => onChange({ ...process, mode: 'full' })}
          >
            full
          </button>
        </div>,
        <ProcessKnob
          key="drive"
          label="drive"
          value={Math.round(process.drive)}
          min={1}
          max={8}
          defaultValue={1}
          suffix="×"
          onChange={(drive) => onChange({ ...process, drive })}
        />
      )
      break
    case 'bit-crush':
      controls.push(
        <ProcessKnob
          key="bits"
          label="depth"
          value={process.bits}
          min={2}
          max={16}
          defaultValue={8}
          suffix="bit"
          onChange={(bits) => onChange({ ...process, bits })}
        />,
        <ProcessKnob
          key="dither"
          label="dither"
          value={Math.round(process.dither * 100)}
          min={0}
          max={100}
          defaultValue={0}
          suffix="%"
          onChange={(dither) => onChange({ ...process, dither: dither / 100 })}
        />
      )
      break
    case 'rate-crush':
      controls.push(
        <ProcessKnob
          key="factor"
          label="hold"
          value={process.factor}
          min={1}
          max={64}
          defaultValue={8}
          suffix="×"
          onChange={(factor) => onChange({ ...process, factor })}
        />,
        <ProcessKnob
          key="jitter"
          label="jitter"
          value={Math.round(process.jitter * 100)}
          min={0}
          max={100}
          defaultValue={0}
          suffix="%"
          onChange={(jitter) => onChange({ ...process, jitter: jitter / 100 })}
        />
      )
      break
    case 'ring-mod':
      controls.push(
        <ProcessKnob
          key="frequency"
          label="frequency"
          value={Math.round(process.frequencyHz)}
          min={1}
          max={2000}
          defaultValue={100}
          suffix="Hz"
          onChange={(frequencyHz) => onChange({ ...process, frequencyHz })}
        />,
        <ProcessKnob
          key="shape"
          label="shape"
          value={Math.round(process.shape * 100)}
          min={0}
          max={100}
          defaultValue={0}
          suffix="%"
          onChange={(shape) => onChange({ ...process, shape: shape / 100 })}
        />
      )
      break
    case 'comb':
      controls.push(
        <ProcessKnob
          key="delay"
          label="delay"
          value={Math.round(process.delayMs)}
          min={1}
          max={50}
          defaultValue={12}
          suffix="ms"
          onChange={(delayMs) => onChange({ ...process, delayMs })}
        />,
        <ProcessKnob
          key="feedback"
          label="feedback"
          value={Math.round(process.feedback * 100)}
          min={-95}
          max={95}
          defaultValue={50}
          suffix="%"
          signed
          onChange={(feedback) => onChange({ ...process, feedback: feedback / 100 })}
        />,
        <ProcessKnob
          key="damping"
          label="damping"
          value={Math.round(process.damping * 100)}
          min={0}
          max={100}
          defaultValue={50}
          suffix="%"
          onChange={(damping) => onChange({ ...process, damping: damping / 100 })}
        />
      )
      break
    case 'smear':
      controls.push(
        <ProcessKnob
          key="time"
          label="time"
          value={Math.round(process.timeMs)}
          min={5}
          max={250}
          defaultValue={80}
          suffix="ms"
          onChange={(timeMs) => onChange({ ...process, timeMs })}
        />,
        <ProcessKnob
          key="scatter"
          label="scatter"
          value={Math.round(process.scatter * 100)}
          min={0}
          max={100}
          defaultValue={50}
          suffix="%"
          onChange={(scatter) => onChange({ ...process, scatter: scatter / 100 })}
        />
      )
      break
  }
  controls.push(
    <ProcessKnob
      key="mix"
      label="mix"
      value={Math.round(process.mix * 100)}
      min={0}
      max={100}
      defaultValue={Math.round(defaultShapeProcess(process.type).mix * 100)}
      suffix="%"
      onChange={(mix) => onChange({ ...process, mix: mix / 100 })}
    />
  )
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${controls.length}, minmax(0, 1fr))`,
        alignItems: 'start',
        columnGap: 2,
        rowGap: 4
      }}
    >
      {controls}
    </div>
  )
}

function ShapeClipInspector({
  draft,
  selected,
  rangeSelection,
  onTransform,
  onRate,
  onCharacter,
  onFormant,
  processRack,
  processSession,
  onProcessRackAdd,
  onProcessRackRemove,
  onProcessOpen,
  onProcessChange,
  onProcessBypass,
  onProcessApply,
  onProcessAddStem,
  onProcessCancel,
  processBaking,
  processBakeDestination,
  processError
}: {
  draft: ShapeDraft
  selected: ReadonlySet<string>
  rangeSelection: ShapeRangeSelection | null
  onTransform: (pitchSemitones: number, detuneCents: number) => void
  onRate: (rate: number) => void
  onCharacter: (character: 'smooth' | 'raw') => void
  onFormant: (formantSemitones: number) => void
  processRack: readonly ShapeProcessRackUnit[]
  processSession: Pick<ShapeProcessSession, 'unitId' | 'process' | 'bypass' | 'dirty'> | null
  onProcessRackAdd: (type: ShapeProcessType) => void
  onProcessRackRemove: (unitId: string) => void
  onProcessOpen: (unitId: string, process: ShapeClipProcessV1) => void
  onProcessChange: (unitId: string, process: ShapeClipProcessV1) => void
  onProcessBypass: (bypass: boolean) => void
  onProcessApply: () => void
  onProcessAddStem: () => void
  onProcessCancel: () => void
  processBaking: boolean
  processBakeDestination: 'replace' | 'stem' | null
  processError: string | null
}): React.JSX.Element {
  const [processPickerOpen, setProcessPickerOpen] = useState(false)
  const targets = draft.lanes.flatMap((lane) =>
    lane.fragments
      .filter(
        (fragment) =>
          selected.has(fragment.id) ||
          (rangeSelection?.laneId === lane.id && rangeSelection.clipId === fragment.id)
      )
      .map((fragment) => ({ lane, fragment, transform: shapeClipTransform(fragment) }))
  )
  const pitch = commonNumber(targets.map((target) => target.transform.pitchSemitones))
  const detune = commonNumber(targets.map((target) => target.transform.detuneCents))
  const rate = commonNumber(targets.map((target) => target.transform.rate))
  const formant = commonNumber(targets.map((target) => target.transform.formantSemitones))
  const character =
    targets.length > 0 &&
    targets.every((target) => target.transform.character === targets[0].transform.character)
      ? targets[0].transform.character
      : null
  const enabled = targets.length > 0
  const targetLabel = rangeSelection
    ? `region · ${targets[0]?.lane.source.name ?? 'clip'}`
    : targets.length === 1
      ? targets[0].lane.source.name
      : targets.length > 1
        ? `${targets.length} clips`
        : 'select a clip or region'
  const applyPitch = (value: number): void => onTransform(value, detune ?? 0)
  const applyDetune = (value: number): void => onTransform(pitch ?? 0, value)
  const halfRate = Math.max(0.25, (rate ?? 1) / 2)
  const doubleRate = Math.min(4, (rate ?? 1) * 2)
  const smallButton = (disabled = false, active = false): React.CSSProperties => ({
    ...buttonStyle(active),
    height: 24,
    minWidth: 0,
    padding: '0 4px',
    opacity: disabled ? 0.35 : 1
  })
  const compactStepButton = (disabled = false, active = false): React.CSSProperties => ({
    ...smallButton(disabled, active),
    height: 20,
    padding: '0 2px',
    fontSize: 8
  })
  const compactDivider: React.CSSProperties = {
    height: 1,
    background: 'var(--ra-border)',
    margin: '6px 0 4px'
  }

  return (
    <aside
      aria-label="clip inspector"
      style={{
        width: 248,
        flex: 'none',
        borderLeft: '1px solid var(--ra-border)',
        background: 'var(--ra-bg-bar)',
        padding: '12px 11px',
        overflowY: 'auto'
      }}
    >
      <div
        title={targetLabel}
        style={{
          height: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          borderBottom: '1px solid var(--ra-border)'
        }}
      >
        <span
          style={{
            flex: 'none',
            fontSize: 9,
            color: 'var(--ra-text-2)',
            letterSpacing: '0.08em'
          }}
        >
          INSPECTOR
        </span>
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: enabled ? 'var(--ra-text-2)' : 'var(--ra-text-4)',
            fontSize: 9
          }}
        >
          {targetLabel}
        </span>
      </div>
      <div
        style={{
          marginTop: 8,
          padding: 7,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-sub)',
          opacity: processSession || processBaking ? 0.42 : 1,
          pointerEvents: processSession || processBaking ? 'none' : 'auto'
        }}
      >
        <div style={{ marginBottom: 5 }}>
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)', letterSpacing: '0.08em' }}>
            TRANSFORM
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--ra-text-2)', marginBottom: 3 }}>Transpose</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 44px 1fr 1fr',
            alignItems: 'center',
            gap: 3
          }}
        >
          {[-12, -1].map((delta) => (
            <button
              key={delta}
              disabled={!enabled}
              style={compactStepButton(!enabled)}
              onClick={() =>
                applyPitch(
                  Math.max(
                    -SHAPE_PITCH_SEMITONE_LIMIT,
                    Math.min(SHAPE_PITCH_SEMITONE_LIMIT, (pitch ?? 0) + delta)
                  )
                )
              }
            >
              {delta}
            </button>
          ))}
          <InspectorNumber
            key={`pitch-${pitch ?? 'mixed'}-${enabled}`}
            value={enabled ? pitch : null}
            min={-SHAPE_PITCH_SEMITONE_LIMIT}
            max={SHAPE_PITCH_SEMITONE_LIMIT}
            suffix="st"
            signed
            defaultValue={0}
            disabled={!enabled}
            compact
            onCommit={applyPitch}
          />
          {[1, 12].map((delta) => (
            <button
              key={delta}
              disabled={!enabled}
              style={compactStepButton(!enabled)}
              onClick={() =>
                applyPitch(
                  Math.max(
                    -SHAPE_PITCH_SEMITONE_LIMIT,
                    Math.min(SHAPE_PITCH_SEMITONE_LIMIT, (pitch ?? 0) + delta)
                  )
                )
              }
            >
              +{delta}
            </button>
          ))}
        </div>

        <div style={compactDivider} />
        <div style={{ fontSize: 9, color: 'var(--ra-text-2)', marginBottom: 3 }}>Detune</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 44px 1fr',
            alignItems: 'center',
            gap: 3
          }}
        >
          <button
            disabled={!enabled}
            style={compactStepButton(!enabled)}
            onClick={() => applyDetune(Math.max(-50, (detune ?? 0) - 10))}
          >
            −10
          </button>
          <InspectorNumber
            key={`detune-${detune ?? 'mixed'}-${enabled}`}
            value={enabled ? detune : null}
            min={-50}
            max={50}
            suffix="ct"
            signed
            defaultValue={0}
            disabled={!enabled}
            compact
            onCommit={applyDetune}
          />
          <button
            disabled={!enabled}
            style={compactStepButton(!enabled)}
            onClick={() => applyDetune(Math.min(50, (detune ?? 0) + 10))}
          >
            +10
          </button>
        </div>
        <div style={compactDivider} />
        <div
          title="spectral envelope shift"
          style={{ fontSize: 9, color: 'var(--ra-text-2)', marginBottom: 3 }}
        >
          Formant
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 44px 1fr 1fr',
            alignItems: 'center',
            gap: 3
          }}
        >
          {[-3, -1].map((delta) => (
            <button
              key={delta}
              disabled={!enabled}
              style={compactStepButton(!enabled)}
              onClick={() => onFormant(Math.max(-12, Math.min(12, (formant ?? 0) + delta)))}
            >
              {delta}
            </button>
          ))}
          <InspectorNumber
            key={`formant-${formant ?? 'mixed'}-${enabled}`}
            value={enabled ? formant : null}
            min={-12}
            max={12}
            suffix="st"
            signed
            defaultValue={0}
            disabled={!enabled}
            compact
            onCommit={onFormant}
          />
          {[1, 3].map((delta) => (
            <button
              key={delta}
              disabled={!enabled}
              style={compactStepButton(!enabled)}
              onClick={() => onFormant(Math.max(-12, Math.min(12, (formant ?? 0) + delta)))}
            >
              +{delta}
            </button>
          ))}
        </div>
        <div style={compactDivider} />
        <div
          style={{
            minHeight: 22,
            display: 'grid',
            gridTemplateColumns: 'auto 30px 24px 30px 1fr auto',
            alignItems: 'center',
            gap: 4
          }}
        >
          <div
            title="speed + pitch · changes clip length"
            style={{ fontSize: 9, color: 'var(--ra-text-2)' }}
          >
            Rate
          </div>
          <button
            disabled={!enabled || rate === 0.25}
            style={compactStepButton(!enabled || rate === 0.25)}
            title="halve the current playback rate"
            onClick={() => onRate(halfRate)}
          >
            ½×
          </button>
          <button
            disabled={!enabled || rate === 1}
            aria-label="reset playback rate"
            title="reset playback rate"
            style={{
              ...compactStepButton(!enabled || rate === 1),
              padding: 0,
              display: 'grid',
              placeItems: 'center'
            }}
            onClick={() => onRate(1)}
          >
            <ArrowCounterClockwise size={12} weight="bold" />
          </button>
          <button
            disabled={!enabled || rate === 4}
            style={compactStepButton(!enabled || rate === 4)}
            title="double the current playback rate"
            onClick={() => onRate(doubleRate)}
          >
            2×
          </button>
          <button
            disabled={!enabled}
            aria-pressed={character === 'smooth'}
            onClick={() => onCharacter(character === 'smooth' ? 'raw' : 'smooth')}
            title="smooth anti-aliasing — off uses crispy Raw resampling"
            style={{
              border: 0,
              padding: 0,
              background: 'transparent',
              color: character === 'smooth' ? 'var(--ra-text-2)' : 'var(--ra-text-4)',
              fontFamily: 'inherit',
              fontSize: 8,
              cursor: enabled ? 'pointer' : 'default',
              opacity: enabled ? 1 : 0.35
            }}
          >
            smooth
          </button>
          <span
            style={{
              padding: '2px 3px',
              border: `1px solid ${rate !== null && rate !== 1 ? 'color-mix(in srgb, var(--ra-type-fx) 34%, var(--ra-border))' : 'transparent'}`,
              background:
                rate !== null && rate !== 1
                  ? 'color-mix(in srgb, var(--ra-type-fx) 6%, transparent)'
                  : 'transparent',
              color: 'var(--ra-text-4)',
              fontSize: 8,
              textAlign: 'right'
            }}
          >
            {rate === null ? 'mixed' : `${rate}×`}
          </span>
        </div>
      </div>
      {processRack.map((unit) => {
        const activeUnit = processSession?.unitId === unit.id
        const anotherUnitLocked = processSession !== null && processSession.dirty && !activeUnit
        const displayedProcess = activeUnit ? processSession.process : unit.process
        return (
          <div
            key={unit.id}
            data-shape-intervention-card={unit.id}
            style={{
              marginTop: 6,
              padding: 6,
              border: `1px solid ${activeUnit ? 'var(--ra-text-3)' : 'var(--ra-border)'}`,
              background: 'var(--ra-bg-row-sub)',
              opacity: processBaking || anotherUnitLocked ? 0.48 : 1,
              pointerEvents: processBaking || anotherUnitLocked ? 'none' : 'auto'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: activeUnit ? 4 : 0
              }}
            >
              <button
                type="button"
                disabled={!enabled || activeUnit}
                aria-expanded={activeUnit}
                title={activeUnit ? undefined : 'open this intervention'}
                onClick={() => onProcessOpen(unit.id, unit.process)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 20,
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  color: activeUnit ? 'var(--ra-text-2)' : 'var(--ra-text-3)',
                  fontFamily: 'inherit',
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textAlign: 'left',
                  cursor: enabled && !activeUnit ? 'pointer' : 'default',
                  opacity: enabled ? 1 : 0.35
                }}
              >
                {shapeProcessLabel(unit.process.type).toUpperCase()}
              </button>
              {activeUnit && (
                <button
                  aria-pressed={!processSession.bypass}
                  aria-label={
                    processSession.bypass ? 'preview intervention' : 'bypass intervention'
                  }
                  title={
                    processSession.bypass ? 'preview intervention' : 'hear before intervention'
                  }
                  style={{
                    width: 20,
                    height: 20,
                    marginRight: 4,
                    padding: 0,
                    display: 'grid',
                    placeItems: 'center',
                    border: '1px solid var(--ra-border)',
                    background: 'transparent',
                    color: processSession.bypass ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
                    cursor: 'pointer'
                  }}
                  onClick={() => onProcessBypass(!processSession.bypass)}
                >
                  {processSession.bypass ? <EyeSlash size={13} /> : <Eye size={13} />}
                </button>
              )}
              <button
                aria-label={`remove ${shapeProcessLabel(unit.process.type)} intervention`}
                title="remove this intervention"
                onClick={() => onProcessRackRemove(unit.id)}
                style={{
                  width: 20,
                  height: 20,
                  padding: 0,
                  border: '1px solid var(--ra-border)',
                  background: 'transparent',
                  color: 'var(--ra-text-3)',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
            {activeUnit && (
              <>
                <ShapeProcessControls
                  process={displayedProcess}
                  onChange={(process) => onProcessChange(unit.id, process)}
                />
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1.15fr',
                    gap: 3,
                    marginTop: 6
                  }}
                >
                  <button style={compactStepButton()} onClick={onProcessCancel}>
                    cancel
                  </button>
                  <button
                    style={{
                      ...compactStepButton(),
                      color: 'color-mix(in srgb, var(--ra-type-fx) 58%, var(--ra-text-3))',
                      borderColor: 'color-mix(in srgb, var(--ra-type-fx) 34%, var(--ra-border))',
                      background:
                        'color-mix(in srgb, var(--ra-type-fx) 7%, var(--ra-bg-row-active))'
                    }}
                    onClick={onProcessApply}
                  >
                    {processBakeDestination === 'replace' ? 'baking…' : 'bake'}
                  </button>
                  <button
                    style={{
                      ...compactStepButton(),
                      color: 'var(--ra-text-3)',
                      borderColor: 'var(--ra-border-strong)',
                      background: 'var(--ra-bg-row-active)'
                    }}
                    onClick={onProcessAddStem}
                    title="render this intervention to a new stem lane"
                  >
                    {processBakeDestination === 'stem' ? 'adding…' : '+ stem'}
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
      <button
        disabled={processSession !== null || processBaking}
        style={{
          ...buttonStyle(),
          display: 'block',
          width: 'auto',
          marginTop: 8,
          opacity: processSession === null && !processBaking ? 1 : 0.35
        }}
        onClick={() => setProcessPickerOpen((open) => !open)}
      >
        + intervention
      </button>
      {processPickerOpen ? (
        <div
          style={{
            marginTop: 5,
            padding: 6,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-sub)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4
          }}
        >
          {SHAPE_PROCESS_CATALOG.map((item) => (
            <button
              key={item.type}
              style={{ ...buttonStyle(), padding: '0 4px' }}
              onClick={() => {
                setProcessPickerOpen(false)
                onProcessRackAdd(item.type)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {processError && (
        <div style={{ marginTop: 7, fontSize: 8, color: 'var(--ra-text-3)', lineHeight: 1.4 }}>
          {processError}
        </div>
      )}
    </aside>
  )
}

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
  onRemove,
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
  onRemove: () => void
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
          const length = shapeFragmentLengthBars(fragment)
          const transform = shapeClipTransform(fragment)
          const waveformSource = transform.bakedBase ?? lane.source
          const waveform = shapeWaveformLayout(
            fragment.sourceStartBars,
            waveformSource.barLength,
            length,
            transform.rate
          )
          const isSelected = selected.has(fragment.id)
          const clipStart = fragment.destStartBars
          const clipEnd = shapeFragmentEndBars(fragment)
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
              rate: shapeFragmentRate(fragment),
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
                  path={waveformSource.path}
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
                cursorBar <= shapeFragmentEndBars(fragment) && (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
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
              flex: 1,
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
          <button
            disabled={rolling || draft.lanes.length <= 1}
            aria-label={`remove ${lane.source.name} stem`}
            title={draft.lanes.length <= 1 ? 'Shape needs at least one stem' : 'remove stem'}
            onClick={onRemove}
            style={{
              ...buttonStyle(),
              flex: 'none',
              width: 20,
              height: 20,
              padding: 0,
              color: 'var(--ra-text-3)',
              opacity: rolling || draft.lanes.length <= 1 ? 0.35 : 1
            }}
          >
            ×
          </button>
        </div>
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
  processRack,
  onProcessRackChange,
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
  processRack: readonly ShapeProcessRackUnit[]
  onProcessRackChange: (rack: ShapeProcessRackUnit[]) => void
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
  const [processSession, setProcessSession] = useState<ShapeProcessSession | null>(null)
  const [processBakeDestination, setProcessBakeDestination] = useState<'replace' | 'stem' | null>(
    null
  )
  const processBaking = processBakeDestination !== null
  const processBakeInFlightRef = useRef(false)
  const [processError, setProcessError] = useState<string | null>(null)
  const [razor, setRazor] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
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
  const mountedRef = useRef(true)
  useEffect(() => {
    // React Fast Refresh runs effect cleanup while preserving refs and state.
    // Restore the mounted flag when the refreshed effect starts again; otherwise
    // a completed intervention Bake is discarded and `adding…` remains forever.
    mountedRef.current = true
    if (!processBakeInFlightRef.current) setProcessBakeDestination(null)
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    currentRef.current = { id: draft.id, fingerprint: renderFingerprint }
    draftRef.current = draft
  }, [draft, renderFingerprint])
  useEffect(() => {
    if (processSession) return
    const recovered = discardOrphanedShapeProcessPreview(draft)
    if (recovered === draft) return
    setDraft((current) =>
      current?.id === draft.id && current.revision === draft.revision ? recovered : current
    )
  }, [draft, processSession, setDraft])
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
    // Inspector buttons are intended for rapid repeated input. Retire an
    // obsolete native render as soon as the recipe changes, then wait for a
    // short idle window before rendering only the final accumulated value.
    const previousJob = jobRef.current
    if (previousJob) {
      jobRef.current = null
      void window.rifffApi.cancelShapeMaterialization(previousJob)
    }
    const id = window.setTimeout(() => {
      const jobId = `${renderRequest.draftId}:${crypto.randomUUID()}`
      const expected = { id: renderRequest.draftId, fingerprint: renderRequest.fingerprint }
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
    }, SHAPE_RENDER_IDLE_MS)
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

  const applyInspectorTransform = useCallback(
    (pitchSemitones: number, detuneCents: number): void => {
      if (rangeSelection) {
        const isolated = isolateShapeFragmentRange(
          draft,
          rangeSelection.laneId,
          rangeSelection.clipId,
          rangeSelection.startBar,
          rangeSelection.endBar
        )
        const transformed = setShapeFragmentTransform(
          isolated.draft,
          new Set([isolated.fragmentId]),
          { pitchSemitones, detuneCents }
        )
        const next = groupShapeEdits(draft, transformed)
        applyDraft(next)
        setSelected(new Set([isolated.fragmentId]))
        setCursorTarget({ laneId: rangeSelection.laneId, clipId: isolated.fragmentId })
        setRangeSelection(null)
        return
      }
      applyDraft(setShapeFragmentTransform(draft, selected, { pitchSemitones, detuneCents }))
    },
    [applyDraft, draft, rangeSelection, selected]
  )

  const applyInspectorRate = useCallback(
    (rate: number): void => {
      if (rangeSelection) {
        const isolated = isolateShapeFragmentRange(
          draft,
          rangeSelection.laneId,
          rangeSelection.clipId,
          rangeSelection.startBar,
          rangeSelection.endBar
        )
        const transformed = setShapeFragmentRate(
          isolated.draft,
          new Set([isolated.fragmentId]),
          rate
        )
        applyDraft(groupShapeEdits(draft, transformed))
        setSelected(new Set([isolated.fragmentId]))
        setCursorTarget({ laneId: rangeSelection.laneId, clipId: isolated.fragmentId })
        setRangeSelection(null)
        return
      }
      applyDraft(setShapeFragmentRate(draft, selected, rate))
    },
    [applyDraft, draft, rangeSelection, selected]
  )

  const applyInspectorCharacter = useCallback(
    (character: 'smooth' | 'raw'): void => {
      if (rangeSelection) {
        const isolated = isolateShapeFragmentRange(
          draft,
          rangeSelection.laneId,
          rangeSelection.clipId,
          rangeSelection.startBar,
          rangeSelection.endBar
        )
        const transformed = setShapeFragmentCharacter(
          isolated.draft,
          new Set([isolated.fragmentId]),
          character
        )
        applyDraft(groupShapeEdits(draft, transformed))
        setSelected(new Set([isolated.fragmentId]))
        setCursorTarget({ laneId: rangeSelection.laneId, clipId: isolated.fragmentId })
        setRangeSelection(null)
        return
      }
      applyDraft(setShapeFragmentCharacter(draft, selected, character))
    },
    [applyDraft, draft, rangeSelection, selected]
  )

  const applyInspectorFormant = useCallback(
    (formantSemitones: number): void => {
      if (rangeSelection) {
        const isolated = isolateShapeFragmentRange(
          draft,
          rangeSelection.laneId,
          rangeSelection.clipId,
          rangeSelection.startBar,
          rangeSelection.endBar
        )
        const transformed = setShapeFragmentFormant(
          isolated.draft,
          new Set([isolated.fragmentId]),
          formantSemitones
        )
        applyDraft(groupShapeEdits(draft, transformed))
        setSelected(new Set([isolated.fragmentId]))
        setCursorTarget({ laneId: rangeSelection.laneId, clipId: isolated.fragmentId })
        setRangeSelection(null)
        return
      }
      applyDraft(setShapeFragmentFormant(draft, selected, formantSemitones))
    },
    [applyDraft, draft, rangeSelection, selected]
  )

  const openShapeProcess = useCallback(
    (unitId: string, requestedProcess: ShapeClipProcessV1): void => {
      if (processSession?.dirty) return
      const process = normalizeShapeClipProcess(requestedProcess)
      if (!process) return
      const before = processSession?.before ?? draft
      const originalSelected = processSession
        ? new Set(processSession.originalSelected)
        : new Set(selected)
      const originalRange = processSession?.originalRange
        ? { ...processSession.originalRange }
        : rangeSelection
          ? { ...rangeSelection }
          : null
      if (originalSelected.size === 0 && !originalRange) return
      let workingBase = before
      let fragmentIds = new Set(originalSelected)
      if (originalRange) {
        const isolated = isolateShapeFragmentRange(
          before,
          originalRange.laneId,
          originalRange.clipId,
          originalRange.startBar,
          originalRange.endBar
        )
        workingBase = isolated.draft
        fragmentIds = new Set([isolated.fragmentId])
        setSelected(fragmentIds)
        setCursorBar(Math.min(originalRange.startBar, originalRange.endBar))
        setCursorTarget({ laneId: originalRange.laneId, clipId: isolated.fragmentId })
        setRangeSelection(null)
      }
      setProcessError(null)
      setMode('shaped')
      setProcessSession({
        unitId,
        before,
        workingBase,
        fragmentIds,
        originalSelected,
        originalRange,
        process,
        bypass: false,
        dirty: false
      })
      setDraft(setShapeFragmentProcess(workingBase, fragmentIds, process))
    },
    [draft, processSession, rangeSelection, selected, setDraft]
  )

  const previewShapeProcess = useCallback(
    (unitId: string, process: ShapeClipProcessV1): void => {
      const nextProcess = normalizeShapeClipProcess(process)
      if (!nextProcess) return
      onProcessRackChange(
        processRack.map((unit) => (unit.id === unitId ? { ...unit, process: nextProcess } : unit))
      )
      if (!processSession) {
        openShapeProcess(unitId, nextProcess)
        return
      }
      if (processSession.unitId !== unitId) return
      setProcessSession({ ...processSession, process: nextProcess, bypass: false, dirty: true })
      setDraft(
        setShapeFragmentProcess(processSession.workingBase, processSession.fragmentIds, nextProcess)
      )
    },
    [onProcessRackChange, openShapeProcess, processRack, processSession, setDraft]
  )

  const bypassShapeProcess = useCallback(
    (bypass: boolean): void => {
      if (!processSession || processSession.bypass === bypass) return
      setProcessSession({ ...processSession, bypass })
      setDraft(
        bypass
          ? processSession.workingBase
          : setShapeFragmentProcess(
              processSession.workingBase,
              processSession.fragmentIds,
              processSession.process
            )
      )
    },
    [processSession, setDraft]
  )

  const bakeShapeProcess = useCallback(
    async (destination: 'replace' | 'stem'): Promise<void> => {
      if (!processSession || processBaking || processBakeInFlightRef.current) return
      const session = processSession
      const preview = draft
      const processed = setShapeFragmentProcess(
        session.workingBase,
        session.fragmentIds,
        session.process
      )
      const items: ShapeBakeProcessItem[] = processed.lanes.flatMap((lane) =>
        lane.fragments.flatMap((fragment) => {
          if (!session.fragmentIds.has(fragment.id)) return []
          const transform = shapeClipTransform(fragment)
          if (!transform.process) return []
          return [
            {
              fragmentId: fragment.id,
              source: transform.bakedBase ?? {
                path: lane.source.path,
                durationSec: lane.source.durationSec,
                barLength: lane.source.barLength
              },
              process: transform.process
            }
          ]
        })
      )
      if (items.length === 0) return
      const addedLaneCount = processed.lanes.filter((lane) =>
        lane.fragments.some((fragment) => session.fragmentIds.has(fragment.id))
      ).length
      if (destination === 'stem' && draft.lanes.length + addedLaneCount > MAX_RIFFF_STEM_SLOTS) {
        setProcessError(
          addedLaneCount === 1
            ? 'No empty stem lane is available.'
            : `Not enough empty stem lanes are available (${addedLaneCount} needed).`
        )
        return
      }
      // React state does not update until the next render, so two clicks in the
      // same frame can both observe processBaking=false. The ref closes that
      // gap synchronously and guarantees one durable bake per Add gesture.
      processBakeInFlightRef.current = true
      setProcessBakeDestination(destination)
      setProcessError(null)
      try {
        const result = await window.rifffApi.bakeShapeProcess({
          jobId: `${draft.id}:${draft.revision}:add-process-${destination}:${crypto.randomUUID()}`,
          items
        })
        if (
          !mountedRef.current ||
          draftRef.current.id !== preview.id ||
          draftRef.current.revision !== preview.revision ||
          result.bases.length !== items.length
        ) {
          await window.rifffApi.cleanupUncommittedShapeAssets(
            result.bases.map((item) => item.source.path)
          )
          return
        }
        const bakedBases = new Map(result.bases.map((item) => [item.fragmentId, item.source]))
        if (destination === 'stem') {
          const added = addBakedShapeProcessLanes(
            session.before,
            processed,
            session.fragmentIds,
            bakedBases
          )
          applyDraft(added.draft)
          setSelected(new Set(added.fragmentIds))
          setRangeSelection(null)
          const firstAdded = added.draft.lanes
            .flatMap((lane) => lane.fragments.map((fragment) => ({ lane, fragment })))
            .find(({ fragment }) => added.fragmentIds.includes(fragment.id))
          if (firstAdded) {
            setCursorBar(firstAdded.fragment.destStartBars)
            setCursorTarget({ laneId: firstAdded.lane.id, clipId: firstAdded.fragment.id })
          }
        } else {
          const baked = bakeShapeFragmentProcesses(processed, bakedBases)
          applyDraft(groupShapeEdits(session.before, baked))
        }
        setProcessSession(null)
      } catch (error) {
        console.error('ShapePanel: failed to add process:', error)
        if (mountedRef.current)
          setProcessError(error instanceof Error ? error.message : 'Failed to add process.')
      } finally {
        processBakeInFlightRef.current = false
        if (mountedRef.current) setProcessBakeDestination(null)
      }
    },
    [applyDraft, draft, processBaking, processSession]
  )

  const applyShapeProcess = useCallback(
    (): Promise<void> => bakeShapeProcess('replace'),
    [bakeShapeProcess]
  )

  const addShapeProcessStem = useCallback(
    (): Promise<void> => bakeShapeProcess('stem'),
    [bakeShapeProcess]
  )

  const cancelShapeProcess = useCallback((): void => {
    if (!processSession) return
    setDraft(processSession.before)
    setSelected(new Set(processSession.originalSelected))
    setRangeSelection(processSession.originalRange)
    if (processSession.originalRange) {
      setCursorTarget({
        laneId: processSession.originalRange.laneId,
        clipId: processSession.originalRange.clipId
      })
    }
    setProcessSession(null)
  }, [processSession, setDraft])

  useEffect(() => {
    if (!processSession || processSession.dirty || processBaking) return
    const collapseCleanIntervention = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      const card = event.target.closest('[data-shape-intervention-card]')
      if (card?.getAttribute('data-shape-intervention-card') === processSession.unitId) return
      cancelShapeProcess()
    }
    document.addEventListener('pointerdown', collapseCleanIntervention, true)
    return () => document.removeEventListener('pointerdown', collapseCleanIntervention, true)
  }, [cancelShapeProcess, processBaking, processSession])

  const addProcessRackUnit = useCallback(
    (type: ShapeProcessType): void => {
      if (processSession || processBaking) return
      const unit: ShapeProcessRackUnit = {
        id: crypto.randomUUID(),
        process: defaultShapeProcess(type)
      }
      onProcessRackChange([...processRack, unit])
      openShapeProcess(unit.id, unit.process)
    },
    [onProcessRackChange, openShapeProcess, processBaking, processRack, processSession]
  )

  const removeProcessRackUnit = useCallback(
    (unitId: string): void => {
      if (processBaking) return
      if (processSession?.unitId === unitId) cancelShapeProcess()
      onProcessRackChange(processRack.filter((unit) => unit.id !== unitId))
    },
    [cancelShapeProcess, onProcessRackChange, processBaking, processRack, processSession?.unitId]
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
      if (processSession) {
        if (event.key === 'Escape') cancelShapeProcess()
        return
      }
      if (processBaking) return
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
              at < shapeFragmentEndBars(fragment)
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
    cancelShapeProcess,
    createEdgesForRange,
    cutClipAt,
    cursorBar,
    cursorTarget,
    draft,
    onClose,
    owns,
    playbackStartBar,
    playing,
    processSession,
    processBaking,
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
          disabled={processSession !== null || processBaking}
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
          disabled={processSession !== null || processBaking}
          style={buttonStyle(mode === 'original')}
          title="switch the preview between your Shape edits and the untouched source riff"
        >
          preview: {mode === 'original' ? 'original' : 'shaped'}
        </button>
        <span style={{ color: 'var(--ra-text-4)', fontSize: 9 }}>{draft.targetBpm} bpm</span>
        <button
          onClick={() => applyDraft(undoShape(draft))}
          style={buttonStyle()}
          disabled={processSession !== null || processBaking || !draft.past.length}
        >
          undo
        </button>
        <button
          onClick={() => applyDraft(redoShape(draft))}
          style={buttonStyle()}
          disabled={processSession !== null || processBaking || !draft.future.length}
        >
          redo
        </button>
        <button
          onClick={() => applyDraft(resetShapeRiff(draft))}
          disabled={processSession !== null || processBaking}
          style={buttonStyle()}
        >
          reset riff
        </button>
        <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--ra-text-4)' }}>snap</span>
        <button
          ref={snapButtonRef}
          disabled={processSession !== null || processBaking}
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
        <button
          onClick={() => saveDraft('keep')}
          disabled={processSession !== null || processBaking || !!saving}
          style={buttonStyle()}
        >
          {saving === 'keep' ? 'keeping…' : (keptLabel ?? 'keep')}
        </button>
        <button
          onClick={() => saveDraft('shelf')}
          disabled={processSession !== null || processBaking || !!saving}
          style={buttonStyle()}
        >
          {saving === 'shelf' ? 'saving…' : 'add to shelf'}
        </button>
        <button
          onClick={() => saveDraft('timeline')}
          disabled={processSession !== null || processBaking || !!saving}
          style={buttonStyle()}
        >
          {saving === 'timeline' ? 'saving…' : 'add to timeline'}
        </button>
        <button
          onClick={() => {
            if (processSession) cancelShapeProcess()
            onClose()
          }}
          disabled={processBaking}
          aria-label="close shape riff"
          style={buttonStyle()}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            position: 'relative',
            overflow: 'auto',
            borderTop: '1px solid var(--ra-border)',
            flex: 1,
            minWidth: 0,
            pointerEvents: processSession || processBaking ? 'none' : 'auto'
          }}
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
              onRemove={() => {
                applyDraft(removeShapeLane(draft, lane.id))
                setMuted((current) => {
                  const next = new Set(current)
                  next.delete(lane.id)
                  return next
                })
                setSoloed((current) => (current === lane.id ? null : current))
                setRollingLanes((current) => {
                  const next = new Set(current)
                  next.delete(lane.id)
                  return next
                })
                setLaneKinds((current) => {
                  const next = { ...current }
                  delete next[lane.id]
                  return next
                })
                setCursorTarget((current) => (current?.laneId === lane.id ? null : current))
              }}
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
              <div
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              >
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
              <div
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              >
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
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 25,
              height:
                draft.lanes.length * 72 + (draft.lanes.length < MAX_RIFFF_STEM_SLOTS ? 50 : 0),
              left: `calc(${SHAPE_LEFT_WIDTH}px + (100% - ${SHAPE_LEFT_WIDTH + SHAPE_RIGHT_WIDTH}px) * ${playheadPct / 100})`,
              width: 1,
              background: `color-mix(in srgb, var(--ra-text) ${shapePlaying ? 38 : 20}%, transparent)`,
              pointerEvents: 'none'
            }}
          />
        </div>
        <ShapeClipInspector
          draft={draft}
          selected={selected}
          rangeSelection={rangeSelection}
          onTransform={applyInspectorTransform}
          onRate={applyInspectorRate}
          onCharacter={applyInspectorCharacter}
          onFormant={applyInspectorFormant}
          processRack={processRack}
          processSession={processSession}
          onProcessRackAdd={addProcessRackUnit}
          onProcessRackRemove={removeProcessRackUnit}
          onProcessOpen={openShapeProcess}
          onProcessChange={previewShapeProcess}
          onProcessBypass={bypassShapeProcess}
          onProcessApply={() => void applyShapeProcess()}
          onProcessAddStem={() => void addShapeProcessStem()}
          onProcessCancel={cancelShapeProcess}
          processBaking={processBaking}
          processBakeDestination={processBakeDestination}
          processError={processError}
        />
      </div>
      <div
        style={{
          flex: 'none',
          alignSelf: 'flex-start',
          maxWidth: 'calc(100% - 12px)',
          height: 25,
          display: 'flex',
          alignItems: 'center',
          borderTop: '1px solid var(--ra-border)',
          borderRight: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-bar)'
        }}
      >
        <button
          aria-pressed={helpOpen}
          aria-label="toggle clip editor help"
          title="clip editor help"
          onClick={() => setHelpOpen((open) => !open)}
          style={{
            ...buttonStyle(helpOpen),
            width: 25,
            minWidth: 25,
            height: 24,
            padding: 0,
            border: 0,
            borderRight: '1px solid var(--ra-border)',
            background: 'transparent',
            color: helpOpen ? 'var(--ra-text-2)' : 'var(--ra-text-4)'
          }}
        >
          ?
        </button>
        {helpOpen && (
          <div
            style={{
              padding: '0 9px',
              color: 'var(--ra-text-4)',
              fontSize: 8,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            clip header: select / drag · clip edges: trim · clip body: click cursor / drag region ·
            cmd-e create edge(s) · cmd-1/2 grid · 0 disable
          </div>
        )}
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
