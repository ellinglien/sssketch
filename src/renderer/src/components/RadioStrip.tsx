// src/renderer/src/components/RadioStrip.tsx
//
// The radio view's strip (spec 2026-10-03-sssketch-radio-view-design section 1.3): every radio
// setting out front while radio runs, in the groups @shared/radioStripModel decides (which
// control, in what order, when it shows, what it says, what it sets). This file only draws them.
// Values and callbacks only: every handler is DiscoverPanel's own, passed in bundles, and every
// panel control is the element the header or the add row draws, with its look.
import { useState } from 'react'
import { newFoldSeed } from '@shared/radioFold'
import { DEFAULT_SOUND_SETTINGS, type SoundSettingsPatch } from '@shared/radioSound'
import { soundPanelModel, type SoundSliderControl } from '@shared/soundPanelModel'
import { neutralCutoff, type FilterMode } from '@shared/toolkit'
import { DEFAULT_RADIO_SETTINGS, type RadioSettings } from '@shared/radioSchedule'
import {
  radioStripModel,
  soundDialPosition,
  soundDialValue,
  type RadioStripContext,
  type RadioStripControl,
  type RadioStripGroup
} from '@shared/radioStripModel'
import {
  TURNAROUND_MOVE_LABEL,
  TURNAROUND_MOVES,
  type TurnaroundMove
} from '@shared/radioTurnaround'
import { DEFAULT_RADIO_PACE_LEVEL, radioPaceLabel } from '@shared/radioPace'
import { DEFAULT_FAVES } from '@shared/discoverFaves'
import { DEFAULT_SOURCE_LEAN } from '@shared/discoverSlotModifier'
import { DEFAULT_DISCOVER_CHAOS } from '@shared/discoverRanking'
import { RADIO_STICKY_BACKGROUND } from './RadioTopLine'
import {
  ActionButton,
  ControlField,
  FireButton,
  FoldSeedInput,
  SegmentBar,
  Segmented
} from './RadioControls'

/** One of the mix group's action buttons: label, state and handler, as the header has them. */
export interface RadioStripAction {
  label: string
  disabled: boolean
  tooltip: string | undefined
  pulse: boolean
  onClick: () => void
}

export interface RadioStripProps {
  settings: RadioSettings
  onSettingsChange: (patch: Partial<RadioSettings>) => void
  ctx: RadioStripContext
  play: {
    tempoText: string
    onTempoText: (t: string) => void
    onTempoFocus: () => void
    onTempoCommit: () => void
    onTempoStep: (delta: 1 | -1) => void
    seedTempo: number | null
    bpm: number
    onMatchSeed: () => void
    onSkip: () => void
    onNewBed: () => void
    /** Bumped once per landing (plan Task 12); 0 draws no flicker. */
    skipFlicker: number
  }
  picks: {
    faves: number
    onFavesPreview: (v: number) => void
    onFavesCommit: (v: number) => void
    favesTooltip: string
    source: number
    onSource: (v: number) => void
    matching: number
    onMatching: (v: number) => void
    artistLabel: string
    artistActive: boolean
    artistOpen: boolean
    artistButtonRef: React.RefObject<HTMLButtonElement | null>
    onArtistButton: (e: React.MouseEvent<HTMLButtonElement>) => void
    mySounds: boolean
    onMySounds: () => void
    mySoundsTooltip: string | undefined
  }
  turn: {
    shown: { move: TurnaroundMove | null } | null
    /** The moves that could sound now (the rest read `not now`); null until the clock says. */
    can: { moves: readonly TurnaroundMove[] } | null
    flash: string | null
    onTurn: (move?: TurnaroundMove) => void
  }
  /** The master strip's dials (the strip's sound group, plan Task 9), and the open project's
   * sound for saturation, pump and echo. */
  sound: {
    level: number
    onLevel: (v: number) => void
    reverb: number
    onReverbDraft: (v: number) => void
    onReverbCommit: (v: number) => void
    cutoff: number
    onCutoff: (v: number) => void
    resonance: number
    onResonance: (v: number) => void
    filterMode: FilterMode
    onFilterMode: () => void
    /** One SET_SOUND_SETTINGS: undoable, saved with the project. */
    onSoundPatch: (patch: SoundSettingsPatch) => void
  }
}

/** The mix actions' state and handlers: what the top line's RadioMixActions draws. */
export interface RadioMixBundle {
  rolling: boolean
  onSimilarAll: (immediate: boolean) => void
  keep: RadioStripAction
  hearts: RadioStripAction
  shelf: RadioStripAction
  timeline: RadioStripAction
}

/** The model's `mix` group, as the top line's buttons: they act on what is playing. `keep` is
 * the emphasised one; a dead button reads `--ra-text-4`; `similar all` is a word, `rerolling…`
 * and disabled while it rolls (Cmd-click is still immediate). */
export function RadioMixActions({ mix }: { mix: RadioMixBundle }): React.JSX.Element {
  const b = (id: string, a: RadioStripAction, emphasis = false): React.JSX.Element => (
    <ActionButton
      key={id}
      label={a.label}
      onClick={a.onClick}
      disabled={a.disabled}
      tooltip={a.tooltip}
      pulse={a.pulse}
      emphasis={emphasis}
    />
  )
  return (
    <>
      <ActionButton
        label={mix.rolling ? 'rerolling…' : 'similar all'}
        onClick={(e) => mix.onSimilarAll(e.metaKey)}
        disabled={mix.rolling}
        tooltip={mix.rolling ? 'rerolling…' : 'similar all'}
      />
      {b('fetch-hearts', mix.hearts)}
      {b('add-to-shelf', mix.shelf)}
      {b('add-to-timeline', mix.timeline)}
      {b('keep', mix.keep, true)}
    </>
  )
}

/** Each sound panel slider's default, as a strip dial position: a sound dial's double-click. */
const SOUND_DIAL_DEFAULTS: ReadonlyMap<string, number> = new Map(
  soundPanelModel(DEFAULT_SOUND_SETTINGS)
    .flatMap((r) => r.controls)
    .flatMap((c) => (c.kind === 'slider' ? [[c.id, soundDialPosition(c)] as const] : []))
)

/** One 0-100 value of a column: a ControlField over a SegmentBar, with its number as the
 * readout. `onChange` is the live half (a preview, a draft), `onCommit` the release; a caller
 * with only `onChange` is live (source, matching, filter, res). The local draft only feeds the
 * readout, and remembers the committed value it started from: a drag that ends where it began
 * commits nothing, and its draft is stale once the value moves. */
function ColumnBar({
  label,
  ariaLabel = label,
  value,
  defaultValue,
  onChange,
  onCommit,
  disabled = false,
  dimmed = false,
  tooltip
}: {
  label: string
  ariaLabel?: string
  value: number
  defaultValue: number
  onChange?: (v: number) => void
  onCommit?: (v: number) => void
  disabled?: boolean
  dimmed?: boolean
  tooltip?: string
}): React.JSX.Element {
  const [draftRaw, setDraft] = useState<{ from: number; v: number } | null>(null)
  const shown = draftRaw !== null && draftRaw.from === value ? draftRaw.v : value
  return (
    <ControlField
      label={label}
      readout={shown}
      tooltip={tooltip}
      disabled={disabled}
      dimmed={dimmed}
    >
      <SegmentBar
        label={ariaLabel}
        value={value}
        size="control"
        defaultValue={defaultValue}
        disabled={disabled}
        tooltip={tooltip}
        onChange={(v) => {
          setDraft({ from: value, v })
          onChange?.(v)
        }}
        onCommit={
          onCommit === undefined
            ? undefined
            : (v) => {
                onCommit(v)
                setDraft(null)
              }
        }
      />
    </ControlField>
  )
}

/** A sound panel slider (saturation, pump, echo) as a column bar: local while it moves, and one
 * SET_SOUND_SETTINGS on release, exactly as the sound panel's project mode commits. */
function ColumnSoundBar({
  label,
  control,
  tooltip,
  disabled,
  onSoundPatch
}: {
  label: string
  control: SoundSliderControl
  tooltip: string | undefined
  disabled: boolean
  onSoundPatch: (patch: SoundSettingsPatch) => void
}): React.JSX.Element {
  return (
    <ColumnBar
      label={label}
      value={soundDialPosition(control)}
      defaultValue={SOUND_DIAL_DEFAULTS.get(control.id) ?? soundDialPosition(control)}
      tooltip={tooltip}
      disabled={disabled}
      onCommit={(pos) => onSoundPatch(control.patch(soundDialValue(control, pos)))}
    />
  )
}

const tempoStepStyle: React.CSSProperties = {
  width: 'var(--ra-h-live)',
  height: 'var(--ra-h-live)',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 'var(--ra-fs-13)',
  border: '1px solid var(--ra-border-strong)',
  background: 'transparent',
  color: 'var(--ra-text)',
  cursor: 'pointer'
}

/** The live bar (design pass: the controls that PLAY, 36px, raised under the rows, sticky at the
 * bottom): tempo, pace, skip, new bed, fire now (turn and the seven moves), level. */
function RadioLiveBar(
  props: RadioStripProps & { controls: readonly RadioStripControl[] }
): React.JSX.Element {
  const { settings, onSettingsChange, play, turn, sound, controls } = props
  const byId = (id: string): RadioStripControl | undefined => controls.find((c) => c.id === id)
  const pace = byId('pace')
  const level = byId('level')
  // The draft remembers the committed value it started from: a drag that ends where it began
  // commits nothing, so its draft would linger; once the value moves, the draft is stale.
  const paceValue = pace?.kind === 'slider' ? pace.value : 0
  const [paceDraftRaw, setPaceDraft] = useState<{ from: number; v: number } | null>(null)
  const paceDraft = paceDraftRaw !== null && paceDraftRaw.from === paceValue ? paceDraftRaw.v : null
  const paceShown = paceDraft ?? paceValue
  const paceReadout = radioPaceLabel(paceShown, { fold: settings.foldMode })
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        gap: 'var(--ra-s-7) 24px',
        padding: 'var(--ra-s-5) var(--ra-s-7) var(--ra-s-6)',
        background: 'var(--ra-bg-row-sub)',
        borderTop: '1px solid var(--ra-border-strong)',
        borderBottom: '1px solid var(--ra-border-strong)',
        // Sticky at the bottom, above the rows wrapper (position: relative, which would paint
        // over it), so the controls that play are always in reach.
        position: 'sticky',
        bottom: 0,
        zIndex: 2
      }}
    >
      <ControlField label="tempo" readout="bpm" live>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--ra-s-1)' }}>
          <button
            onClick={() => play.onTempoStep(-1)}
            aria-label="Decrease tempo"
            style={tempoStepStyle}
          >
            −
          </button>
          <input
            type="number"
            value={play.tempoText}
            onFocus={play.onTempoFocus}
            onChange={(e) => play.onTempoText(e.target.value)}
            onBlur={play.onTempoCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            aria-label="Tempo (BPM)"
            style={{
              fontFamily: 'inherit',
              fontSize: 'var(--ra-fs-13)',
              width: 56,
              height: 'var(--ra-h-live)',
              textAlign: 'center',
              background: 'var(--ra-bg-page)',
              color: 'var(--ra-text)',
              border: '1px solid var(--ra-border-strong)',
              padding: 0,
              WebkitAppearance: 'none',
              MozAppearance: 'textfield'
            }}
          />
          <button
            onClick={() => play.onTempoStep(1)}
            aria-label="Increase tempo"
            style={tempoStepStyle}
          >
            +
          </button>
          {play.seedTempo !== null && play.seedTempo !== play.bpm && (
            <button
              onClick={play.onMatchSeed}
              title={`seed tempo ${play.seedTempo} bpm`}
              aria-label="Match seeded riff's own tempo"
              style={{
                ...tempoStepStyle,
                width: 'auto',
                padding: '0 var(--ra-s-4)',
                fontSize: 'var(--ra-fs-9)',
                whiteSpace: 'nowrap'
              }}
            >
              match seed ({play.seedTempo})
            </button>
          )}
        </span>
      </ControlField>
      {pace?.kind === 'slider' && (
        <div style={{ width: 200 }}>
          <ControlField label={pace.label} tooltip={pace.tooltip} readout={paceReadout} live>
            <SegmentBar
              label={pace.label}
              value={pace.value}
              size="live"
              defaultValue={DEFAULT_RADIO_PACE_LEVEL}
              ariaValueText={paceReadout}
              tooltip={pace.tooltip}
              onChange={(v) => setPaceDraft({ from: paceValue, v })}
              onDraft={(v) => setPaceDraft({ from: paceValue, v })}
              onCommit={(v) => {
                onSettingsChange(pace.patch(v))
                setPaceDraft(null)
              }}
            />
          </ControlField>
        </div>
      )}
      <button
        onClick={play.onSkip}
        data-tooltip={byId('skip')?.tooltip}
        aria-label={byId('skip')?.tooltip}
        style={{
          fontFamily: 'inherit',
          fontSize: 'var(--ra-fs-13)',
          height: 'var(--ra-h-live)',
          padding: '0 18px',
          background: 'transparent',
          border: '1px solid var(--ra-text)',
          color: 'var(--ra-text)',
          cursor: 'pointer'
        }}
      >
        {/* Keyed by the landing count, so each landing restarts the flicker. */}
        <span
          key={play.skipFlicker}
          className={play.skipFlicker > 0 ? 'radio-landing-flicker' : undefined}
        >
          skip
        </span>
      </button>
      <button
        onClick={play.onNewBed}
        data-tooltip={byId('new-bed')?.tooltip}
        style={{
          fontFamily: 'inherit',
          fontSize: 'var(--ra-fs-10)',
          height: 'var(--ra-h-live)',
          padding: '0 var(--ra-s-5)',
          background: 'transparent',
          border: '1px solid var(--ra-border-strong)',
          color: 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        new bed
      </button>
      <ControlField label="fire now">
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ra-s-1)' }}>
          <FireButton
            primary
            label={turn.flash ?? (turn.shown !== null ? 'turning' : 'turn')}
            held={turn.shown !== null}
            tooltip={byId('turn')?.tooltip}
            ariaLabel={byId('turn')?.tooltip}
            onClick={() => turn.onTurn()}
          />
          {TURNAROUND_MOVES.map((move) => {
            const held = turn.shown !== null && turn.shown.move === move
            const notNow = turn.can !== null && !turn.can.moves.includes(move)
            return (
              <FireButton
                key={move}
                label={TURNAROUND_MOVE_LABEL[move]}
                held={held}
                notNow={notNow}
                tooltip={notNow ? 'not now' : `turn: ${TURNAROUND_MOVE_LABEL[move]}`}
                ariaLabel={`turn: ${TURNAROUND_MOVE_LABEL[move]}`}
                onClick={() => turn.onTurn(move)}
              />
            )
          })}
        </span>
      </ControlField>
      {level !== undefined && (
        <div style={{ width: 150, marginLeft: 'auto' }}>
          <ControlField label={level.label} tooltip={level.tooltip} readout={sound.level} live>
            <SegmentBar
              label="master level"
              value={sound.level}
              size="live"
              defaultValue={100}
              disabled={level.disabled}
              tooltip={level.tooltip}
              onChange={sound.onLevel}
            />
          </ControlField>
        </div>
      )}
    </div>
  )
}

/** The shaping columns (design pass: five quiet titled columns under the live bar, 26px
 * controls): picks, shape, moves, fold, sound. */
function RadioShapingColumns(
  props: RadioStripProps & { groups: readonly RadioStripGroup[] }
): React.JSX.Element {
  const { onSettingsChange, picks, sound, groups } = props

  function chipsLike(c: Extract<RadioStripControl, { kind: 'chips' }>): React.JSX.Element {
    return (
      <ControlField key={c.id} label={c.label} tooltip={c.tooltip} disabled={c.disabled}>
        <Segmented
          ariaLabel={c.label}
          size="control"
          multi={c.id === 'moves'}
          disabled={c.disabled}
          options={c.chips.map((chip) => ({
            label: chip.label,
            on: chip.on,
            onClick: () => onSettingsChange(chip.patch)
          }))}
        />
      </ControlField>
    )
  }

  function control(c: RadioStripControl): React.JSX.Element | null {
    switch (c.kind) {
      case 'chips':
        return chipsLike(c)
      case 'slider':
        return (
          <ColumnBar
            key={c.id}
            label={c.label}
            value={c.value}
            defaultValue={
              c.id === 'bend' ? DEFAULT_RADIO_SETTINGS.fold : DEFAULT_RADIO_SETTINGS.clash
            }
            tooltip={c.tooltip}
            disabled={c.disabled}
            onCommit={(v) => onSettingsChange(c.patch(v))}
          />
        )
      case 'switch':
        return (
          <ControlField key={c.id} label={c.label} tooltip={c.tooltip} disabled={c.disabled}>
            <Segmented
              ariaLabel={`${c.label} mode`}
              size="control"
              disabled={c.disabled}
              options={[
                { label: 'on', on: c.on, onClick: () => onSettingsChange(c.patch(true)) },
                { label: 'off', on: !c.on, onClick: () => onSettingsChange(c.patch(false)) }
              ]}
            />
          </ControlField>
        )
      case 'seed':
        return (
          <ControlField key={c.id} label={c.label} tooltip={c.tooltip} disabled={c.disabled}>
            <span
              style={{
                display: 'flex',
                gap: 'var(--ra-s-1)',
                pointerEvents: c.disabled ? 'none' : undefined
              }}
            >
              <FoldSeedInput value={c.value} onCommit={(s) => onSettingsChange(c.patch(s))} />
              <button
                type="button"
                disabled={c.disabled}
                tabIndex={c.disabled ? -1 : undefined}
                onClick={() => onSettingsChange(c.patch(newFoldSeed()))}
                style={{
                  height: 'var(--ra-h-control)',
                  padding: '0 var(--ra-s-3)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--ra-fs-9)',
                  background: 'transparent',
                  color: 'var(--ra-text-2)',
                  border: '1px solid var(--ra-border-strong)',
                  cursor: c.disabled ? 'default' : 'pointer'
                }}
              >
                new
              </button>
            </span>
          </ControlField>
        )
      case 'sound':
        return (
          <ColumnSoundBar
            key={c.id}
            label={c.label}
            control={c.control}
            tooltip={c.tooltip}
            disabled={c.disabled}
            onSoundPatch={sound.onSoundPatch}
          />
        )
      case 'panel':
        return panelControl(c)
    }
  }

  function panelControl(c: RadioStripControl): React.JSX.Element | null {
    switch (c.id) {
      case 'faves':
        return (
          <ColumnBar
            key={c.id}
            label={c.label}
            value={picks.faves}
            defaultValue={DEFAULT_FAVES}
            tooltip={picks.favesTooltip}
            dimmed={c.dimmed}
            onChange={picks.onFavesPreview}
            onCommit={picks.onFavesCommit}
          />
        )
      case 'source':
        return (
          <ColumnBar
            key={c.id}
            label={c.label}
            ariaLabel="source"
            value={picks.source}
            defaultValue={DEFAULT_SOURCE_LEAN}
            tooltip={c.tooltip}
            onChange={picks.onSource}
          />
        )
      case 'matching':
        return (
          <ColumnBar
            key={c.id}
            label={c.label}
            value={picks.matching}
            defaultValue={100 - DEFAULT_DISCOVER_CHAOS}
            tooltip={c.tooltip}
            onChange={picks.onMatching}
          />
        )
      case 'artist':
        return (
          <ControlField key={c.id} label={c.label} tooltip={c.tooltip}>
            <button
              type="button"
              ref={picks.artistButtonRef}
              onClick={picks.onArtistButton}
              aria-expanded={picks.artistOpen}
              data-tooltip={c.tooltip}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--ra-s-2)',
                width: '100%',
                minHeight: 'var(--ra-h-control)',
                padding: '0 var(--ra-s-2)',
                fontFamily: 'inherit',
                fontSize: 'var(--ra-fs-10)',
                background: picks.artistActive ? 'var(--ra-text)' : 'transparent',
                color: picks.artistActive ? 'var(--ra-bg-page)' : 'var(--ra-text-2)',
                border: `1px solid ${picks.artistActive ? 'var(--ra-text)' : 'var(--ra-border-strong)'}`,
                cursor: 'pointer'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {picks.artistLabel.replace(/^artist: /, '')}
              </span>
              <span aria-hidden>▾</span>
            </button>
          </ControlField>
        )
      case 'my-sounds': {
        const on = !c.disabled && picks.mySounds
        return (
          <ControlField
            key={c.id}
            label={c.label}
            tooltip={picks.mySoundsTooltip}
            disabled={c.disabled}
          >
            <Segmented
              ariaLabel={c.label}
              size="control"
              disabled={c.disabled}
              options={[
                { label: 'on', on, onClick: () => (on ? undefined : picks.onMySounds()) },
                { label: 'off', on: !on, onClick: () => (on ? picks.onMySounds() : undefined) }
              ]}
            />
          </ControlField>
        )
      }
      case 'reverb':
        return (
          <ColumnBar
            key={c.id}
            label={c.label}
            ariaLabel="master reverb"
            value={sound.reverb}
            defaultValue={0}
            tooltip={c.tooltip}
            disabled={c.disabled}
            onChange={sound.onReverbDraft}
            onCommit={sound.onReverbCommit}
          />
        )
      case 'filter':
        return (
          <ColumnBar
            key={c.id}
            label={c.label}
            ariaLabel="master filter cutoff"
            value={sound.cutoff}
            // The mode's own open end, as the master strip's: "nothing is happening" either way.
            defaultValue={neutralCutoff(sound.filterMode) * 100}
            tooltip={c.tooltip}
            disabled={c.disabled}
            onChange={sound.onCutoff}
          />
        )
      case 'res':
        return (
          <ColumnBar
            key={c.id}
            label={c.label}
            ariaLabel="master filter resonance"
            value={sound.resonance}
            defaultValue={0}
            tooltip={c.tooltip}
            disabled={c.disabled}
            onChange={sound.onResonance}
          />
        )
      case 'filter-mode': {
        const low = sound.filterMode === 'lowpass'
        return (
          <ControlField key={c.id} label={c.label} tooltip={c.tooltip} disabled={c.disabled}>
            <Segmented
              ariaLabel="filter mode"
              size="control"
              disabled={c.disabled}
              options={[
                {
                  label: 'lo pass',
                  on: low,
                  onClick: () => (low ? undefined : sound.onFilterMode())
                },
                {
                  label: 'hi pass',
                  on: !low,
                  onClick: () => (low ? sound.onFilterMode() : undefined)
                }
              ]}
            />
          </ControlField>
        )
      }
      default:
        return null
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        background: RADIO_STICKY_BACKGROUND
      }}
    >
      {groups.map((g) => (
        <div
          key={g.id}
          role="group"
          aria-label={g.caption}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ra-s-6)',
            minWidth: 0,
            padding: 'var(--ra-s-6) var(--ra-s-5) 18px',
            borderRight: '1px solid var(--ra-border)',
            borderBottom: '1px solid var(--ra-border)'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 'var(--ra-fs-10)', color: 'var(--ra-text-2)' }}>
              {g.caption}
            </span>
            {g.subtitle !== null && (
              <span style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-3)' }}>
                {g.subtitle}
              </span>
            )}
          </div>
          {g.controls.map((c) =>
            c.id === 'saturation' ? (
              <div
                key={c.id}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-6)' }}
              >
                <span
                  style={{
                    fontSize: 'var(--ra-fs-9)',
                    color: 'var(--ra-text-3)',
                    paddingBottom: 'var(--ra-s-1)',
                    borderBottom: '1px solid var(--ra-border)'
                  }}
                >
                  project sound · undoable
                </span>
                {control(c)}
              </div>
            ) : (
              control(c)
            )
          )}
        </div>
      ))}
    </div>
  )
}

export function RadioStrip(props: RadioStripProps): React.JSX.Element {
  const groups = radioStripModel(props.settings, props.ctx)
  return (
    <>
      <RadioLiveBar
        {...props}
        controls={groups.filter((g) => g.place === 'live').flatMap((g) => g.controls)}
      />
      <RadioShapingColumns {...props} groups={groups.filter((g) => g.place === 'columns')} />
    </>
  )
}
