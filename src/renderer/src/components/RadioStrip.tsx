// src/renderer/src/components/RadioStrip.tsx
//
// The radio view's strip (spec 2026-10-03-sssketch-radio-view-design section 1.3): every radio
// setting out front while radio runs, in the groups @shared/radioStripModel decides (which
// control, in what order, when it shows, what it says, what it sets). This file only draws them.
// Values and callbacks only: every handler is DiscoverPanel's own, passed in bundles, and every
// panel control is the element the header or the add row draws, with its look.
import { newFoldSeed } from '@shared/radioFold'
import type { RadioSettings } from '@shared/radioSchedule'
import {
  radioStripModel,
  type RadioStripContext,
  type RadioStripControl
} from '@shared/radioStripModel'
import {
  TURNAROUND_MOVE_LABEL,
  TURNAROUND_MOVES,
  type TurnaroundMove
} from '@shared/radioTurnaround'
import { DEFAULT_FAVES } from '@shared/discoverFaves'
import { DEFAULT_SOURCE_LEAN } from '@shared/discoverSlotModifier'
import { DEFAULT_DISCOVER_CHAOS } from '@shared/discoverRanking'
import { BracketToggle } from './BracketToggle'
import { DiceIcon } from './DiceIcon'
import {
  FoldSeedInput,
  FoldSlider,
  PaceSlider,
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
    can: { canTurn: boolean; moves: readonly TurnaroundMove[] } | null
    flash: string | null
    onTurn: (move?: TurnaroundMove) => void
  }
  mix: {
    rolling: boolean
    onSimilarAll: (immediate: boolean) => void
    keep: RadioStripAction
    hearts: RadioStripAction
    shelf: RadioStripAction
    timeline: RadioStripAction & { listenOnly: boolean }
  }
}

const caption: React.CSSProperties = { fontSize: 9, color: 'var(--ra-text-3)' }

/** The tempo field's small square buttons and field, as header row 1 draws them. */
const tempoStepStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  padding: 0,
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text)',
  cursor: 'pointer'
}

/** A header action button (keep, fetch hearts, add to shelf). */
function actionStyle(a: RadioStripAction): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '6px 14px',
    background: 'transparent',
    border: '1px solid var(--ra-border-strong)',
    color: a.disabled ? 'var(--ra-text-4)' : 'var(--ra-text)',
    cursor: a.disabled ? 'default' : 'pointer',
    animation: a.pulse ? 'discover-add-pulse 500ms ease-out' : undefined
  }
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
            {c.id === 'pace' ? (
              <PaceSlider
                value={c.value}
                fold={settings.foldMode}
                width={72}
                onCommit={(v) => onSettingsChange(c.patch(v))}
              />
            ) : (
              <FoldSlider
                label={c.label}
                value={c.value}
                width={72}
                onCommit={(v) => onSettingsChange(c.patch(v))}
              />
            )}
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
        return null
      case 'panel':
        return panelControl(c)
    }
  }

  function panelControl(c: RadioStripControl): React.JSX.Element | null {
    const { play, picks, turn, mix } = props
    switch (c.id) {
      case 'tempo':
        return (
          <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={caption}>tempo</span>
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
                fontSize: 10,
                width: 36,
                textAlign: 'center',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)',
                border: '1px solid var(--ra-border)',
                height: 18,
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
            <span style={caption}>bpm</span>
            {play.seedTempo !== null && play.seedTempo !== play.bpm && (
              <button
                onClick={play.onMatchSeed}
                title={`seed tempo ${play.seedTempo} bpm`}
                aria-label="Match seeded riff's own tempo"
                style={{
                  height: 18,
                  padding: '0 6px',
                  fontSize: 9,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text)',
                  cursor: 'pointer'
                }}
              >
                match seed ({play.seedTempo})
              </button>
            )}
          </span>
        )
      case 'skip':
        return (
          <button
            key={c.id}
            onClick={play.onSkip}
            data-tooltip={c.tooltip}
            aria-label={c.tooltip}
            style={{
              fontFamily: 'inherit',
              fontSize: 9,
              padding: 'var(--ra-s-0) 8px',
              background: 'transparent',
              border: '1px solid var(--ra-border)',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            {/* Keyed by the landing count, so each landing restarts the flicker (Task 12's CSS). */}
            <span
              key={play.skipFlicker}
              className={play.skipFlicker > 0 ? 'radio-landing-flicker' : undefined}
            >
              skip
            </span>
          </button>
        )
      case 'new-bed':
        return (
          <StripChip
            key={c.id}
            label={c.label}
            on={false}
            tooltip={c.tooltip}
            onClick={play.onNewBed}
          />
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
      case 'turn':
        return (
          <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => turn.onTurn()}
              data-tooltip={c.tooltip}
              aria-label={c.tooltip}
              style={{
                fontFamily: 'inherit',
                fontSize: 10,
                padding: '3px 10px',
                background: turn.shown !== null ? 'var(--ra-text)' : 'transparent',
                border: '1px solid var(--ra-border-strong)',
                color: turn.shown !== null ? 'var(--ra-bg-page)' : 'var(--ra-text)',
                cursor: 'pointer'
              }}
            >
              {turn.flash ?? (turn.shown !== null ? 'turning' : 'turn')}
            </button>
            {TURNAROUND_MOVES.map((move) => {
              const held = turn.shown !== null && turn.shown.move === move
              const notNow = turn.can !== null && !turn.can.moves.includes(move)
              return (
                <button
                  key={move}
                  onClick={() => turn.onTurn(move)}
                  data-tooltip={notNow ? 'not now' : `turn: ${TURNAROUND_MOVE_LABEL[move]}`}
                  aria-label={`turn: ${TURNAROUND_MOVE_LABEL[move]}`}
                  aria-pressed={held}
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 8,
                    padding: '1px 4px',
                    background: held ? 'var(--ra-text)' : 'transparent',
                    border: '1px solid var(--ra-border)',
                    color: held
                      ? 'var(--ra-bg-page)'
                      : notNow
                        ? 'var(--ra-text-4)'
                        : 'var(--ra-text-3)',
                    cursor: 'pointer'
                  }}
                >
                  {TURNAROUND_MOVE_LABEL[move]}
                </button>
              )
            })}
          </span>
        )
      case 'similar-all':
        return (
          <button
            key={c.id}
            onClick={(e) => mix.onSimilarAll(e.metaKey)}
            disabled={mix.rolling}
            aria-label={mix.rolling ? 'rerolling…' : 'similar all'}
            data-tooltip={mix.rolling ? 'rerolling…' : 'similar all'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: mix.rolling ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
              cursor: mix.rolling ? 'default' : 'pointer'
            }}
          >
            <DiceIcon size={18} spinning={mix.rolling} />
          </button>
        )
      case 'keep':
      case 'fetch-hearts':
      case 'add-to-shelf': {
        const a = c.id === 'keep' ? mix.keep : c.id === 'fetch-hearts' ? mix.hearts : mix.shelf
        return (
          <button
            key={c.id}
            onClick={a.onClick}
            disabled={a.disabled}
            data-tooltip={a.tooltip}
            style={actionStyle(a)}
          >
            {a.label}
          </button>
        )
      }
      case 'add-to-timeline': {
        const a = mix.timeline
        return (
          <button
            key={c.id}
            onClick={a.onClick}
            disabled={a.disabled}
            data-tooltip={a.tooltip}
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              padding: '6px 14px',
              // A dead button carries no audio information, so no accent.
              background: a.listenOnly ? 'transparent' : 'var(--ra-stretch-on-bg)',
              border: a.listenOnly
                ? '1px solid var(--ra-border)'
                : '1px solid var(--ra-stretch-on)',
              color: a.disabled ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
              cursor: a.disabled ? 'default' : 'pointer',
              animation: a.pulse ? 'discover-add-pulse 500ms ease-out' : undefined
            }}
          >
            {a.label}
          </button>
        )
      }
      default:
        return null
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px 24px',
        padding: '8px 12px 10px',
        borderTop: '1px solid var(--ra-border)'
      }}
    >
      {groups
        // The sound group lands in plan Task 9.
        .filter((g) => g.id !== 'sound')
        .map((g) => (
          <StripGroup key={g.id} caption={g.caption}>
            {g.controls.map(control)}
          </StripGroup>
        ))}
    </div>
  )
}
