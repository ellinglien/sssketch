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
import type { RadioSettings } from '@shared/radioSchedule'
import {
  radioStripModel,
  soundDialPosition,
  soundDialValue,
  type RadioStripContext,
  type RadioStripControl
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
import { BracketToggle } from './BracketToggle'
import { RADIO_STICKY_BACKGROUND } from './RadioTopLine'
import {
  ActionButton,
  FoldSeedInput,
  FoldSlider,
  ControlField,
  FireButton,
  SegmentBar,
  StripChip,
  StripDial,
  StripGroup,
  StripWordSwitch
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

/** A sound panel slider as a strip dial (saturation, pump, echo): local while it turns, and one
 * SET_SOUND_SETTINGS on release, exactly as the sound panel's project mode commits. */
function StripSoundDial({
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
  const [draft, setDraft] = useState<number | null>(null)
  return (
    <StripDial
      label={label}
      value={draft ?? soundDialPosition(control)}
      onChange={setDraft}
      onCommit={(pos) => {
        onSoundPatch(control.patch(soundDialValue(control, pos)))
        setDraft(null)
      }}
      defaultValue={SOUND_DIAL_DEFAULTS.get(control.id) ?? soundDialPosition(control)}
      tooltip={tooltip}
      disabled={disabled}
    />
  )
}

const caption: React.CSSProperties = { fontSize: 9, color: 'var(--ra-text-3)' }

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

export function RadioStrip(props: RadioStripProps): React.JSX.Element {
  const { settings, onSettingsChange, ctx } = props
  const groups = radioStripModel(settings, ctx)

  function control(c: RadioStripControl): React.JSX.Element | null {
    switch (c.kind) {
      case 'chips':
        return (
          <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span data-tooltip={c.tooltip} style={caption}>
              {c.label}
            </span>
            {c.chips.map((chip) => (
              <StripChip
                key={chip.label}
                label={chip.label}
                on={chip.on}
                disabled={c.disabled}
                onClick={() => onSettingsChange(chip.patch)}
              />
            ))}
          </span>
        )
      case 'slider':
        return (
          <span
            key={c.id}
            data-tooltip={c.tooltip}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={caption}>{c.label}</span>
            {
              <FoldSlider
                label={c.label}
                value={c.value}
                width={72}
                onCommit={(v) => onSettingsChange(c.patch(v))}
              />
            }
          </span>
        )
      case 'switch':
        return (
          <StripWordSwitch
            key={c.id}
            label={c.label}
            on={c.on}
            tooltip={c.tooltip}
            onChange={(on) => onSettingsChange(c.patch(on))}
          />
        )
      case 'seed':
        return (
          <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span data-tooltip={c.tooltip} style={caption}>
              {c.label}
            </span>
            <FoldSeedInput value={c.value} onCommit={(s) => onSettingsChange(c.patch(s))} />
            <StripChip
              label="new"
              on={false}
              onClick={() => onSettingsChange(c.patch(newFoldSeed()))}
            />
          </span>
        )
      case 'sound':
        return (
          <StripSoundDial
            key={c.id}
            label={c.label}
            control={c.control}
            tooltip={c.tooltip}
            disabled={c.disabled}
            onSoundPatch={props.sound.onSoundPatch}
          />
        )
      case 'panel':
        return panelControl(c)
    }
  }

  function panelControl(c: RadioStripControl): React.JSX.Element | null {
    const { picks, sound } = props
    switch (c.id) {
      case 'reverb':
        return (
          <StripDial
            key={c.id}
            label={c.label}
            ariaLabel="master reverb"
            value={sound.reverb}
            onChange={sound.onReverbDraft}
            onCommit={sound.onReverbCommit}
            defaultValue={0}
            tooltip={c.tooltip}
            disabled={c.disabled}
          />
        )
      case 'filter':
        return (
          <StripDial
            key={c.id}
            label={c.label}
            ariaLabel="master filter cutoff"
            value={sound.cutoff}
            onChange={sound.onCutoff}
            // The mode's own open end, as the master strip's: "nothing is happening" either way.
            defaultValue={neutralCutoff(sound.filterMode) * 100}
            tooltip={c.tooltip}
            disabled={c.disabled}
          />
        )
      case 'res':
        return (
          <StripDial
            key={c.id}
            label={c.label}
            ariaLabel="master filter resonance"
            value={sound.resonance}
            onChange={sound.onResonance}
            defaultValue={0}
            tooltip={c.tooltip}
            disabled={c.disabled}
          />
        )
      case 'filter-mode':
        return (
          <button
            key={c.id}
            onClick={sound.onFilterMode}
            disabled={c.disabled}
            title={sound.filterMode === 'lowpass' ? 'low pass' : 'high pass'}
            style={{
              fontFamily: 'inherit',
              background: 'transparent',
              border: '1px solid var(--ra-border)',
              color: c.disabled ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
              fontSize: 'var(--ra-fs-9)',
              padding: '2px 5px',
              cursor: c.disabled ? 'default' : 'pointer'
            }}
          >
            {sound.filterMode === 'lowpass' ? 'lo pass' : 'hi pass'}
          </button>
        )
      case 'faves':
        return (
          <StripDial
            key={c.id}
            label={c.label}
            value={picks.faves}
            onChange={picks.onFavesPreview}
            onCommit={picks.onFavesCommit}
            defaultValue={DEFAULT_FAVES}
            tooltip={picks.favesTooltip}
            dimmed={c.dimmed}
          />
        )
      case 'source':
        return (
          <StripDial
            key={c.id}
            label={c.label}
            value={picks.source}
            onChange={picks.onSource}
            defaultValue={DEFAULT_SOURCE_LEAN}
            tooltip={c.tooltip}
            before="endlesss"
            after="other"
          />
        )
      case 'matching':
        return (
          <StripDial
            key={c.id}
            label={c.label}
            value={picks.matching}
            onChange={picks.onMatching}
            defaultValue={100 - DEFAULT_DISCOVER_CHAOS}
            tooltip={c.tooltip}
          />
        )
      case 'artist':
        return (
          <button
            key={c.id}
            ref={picks.artistButtonRef}
            onClick={picks.onArtistButton}
            aria-expanded={picks.artistOpen}
            data-tooltip={c.tooltip}
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              padding: '6px 10px',
              background: 'transparent',
              border: '1px solid var(--ra-border)',
              color: picks.artistActive ? 'var(--ra-text)' : 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            {picks.artistLabel}
          </button>
        )
      case 'my-sounds':
        return (
          <BracketToggle
            key={c.id}
            checked={!c.disabled && picks.mySounds}
            onChange={picks.onMySounds}
            label={c.label}
            disabled={c.disabled}
            tooltip={picks.mySoundsTooltip}
          />
        )
      default:
        return null
    }
  }

  return (
    <>
      <RadioLiveBar
        {...props}
        controls={groups.filter((g) => g.place === 'live').flatMap((g) => g.controls)}
      />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px 24px',
          padding: '8px 12px 10px',
          background: RADIO_STICKY_BACKGROUND
        }}
      >
        {groups
          .filter((g) => g.place === 'columns')
          .map((g) => (
            <StripGroup key={g.id} caption={g.caption}>
              {g.controls.map(control)}
            </StripGroup>
          ))}
      </div>
    </>
  )
}
