import { useCallback, useEffect, useState } from 'react'
import { COACH_PREFILLED_LINE_TEMPLATES, pickLineVariant } from '@shared/coachLines'
import { buildCoachMapSections } from '@shared/coachMapTemplate'
import {
  coachPhraseLine,
  phraseAnswerOptions,
  readLoopPhrase,
  type LoopPhraseReading,
  type StemPhraseReading
} from '@shared/coachPhrase'
import { COACH_LOOP_ANSWERS, COACH_SHAPES } from '@shared/coachShapes'
import { coachSetupLine } from '@shared/coachWalk'
import type { LockedClimax } from '@shared/coachClimax'
import { getStemPhrase } from '../audio/phraseCache'
import { buildCoachMapActions } from '../state/coachMapPlacement'
import { useAppState, useDispatch } from '../state/StoreContext'
import type { Action } from '../state/store'
import { SssketchySprite } from './SssketchySprite'

const PANEL_WIDTH = 560

const buttonStyle: React.CSSProperties = {
  height: 22,
  borderRadius: 0,
  padding: '0 10px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)',
  cursor: 'pointer'
}

function chosenStyle(on: boolean): React.CSSProperties {
  return {
    ...buttonStyle,
    border: `1px solid ${on ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    background: on ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
    color: on ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
  }
}

const LOOP_ANSWER_LABEL: Record<string, string> = {
  drop: 'the drop',
  verse: 'a verse',
  intro: 'an intro',
  unsure: 'not sure'
}

/**
 * sssketchy inside the auto-arranger -- the only place he lives now (spec:
 * "A standalone flow is the wrong home. sssketchy lives in the auto-arranger
 * now, and nowhere else").
 *
 * THREE BLOCKS, ONE THOUGHT. The screen shows both opening questions and,
 * when there is one, the phrase report -- but his LINE is only ever about
 * the question still open (coachSetupLine), which is what keeps "one thought
 * at a time" true on a surface that is a form rather than a bubble.
 *
 * THE PHRASE RULE, which is the one most likely to be helpfully broken:
 * **the measurement is REPORTED, never applied.** Nothing here writes
 * `phrase` except a click -- either on one of the two offered bar counts, or
 * on build, which falls back to the loop's own NOMINAL length, the answer
 * the user would have given anyway. If the measurement is inconclusive
 * coachPhraseLine returns null and the whole block stays off the screen: he
 * says nothing rather than guessing. The measurement also never blocks --
 * if it has not landed by the time both questions are answered, the build
 * goes ahead at the nominal length.
 */
export function AutoArrangeCoachStep({
  climax,
  onCancel,
  onBuilt
}: {
  climax: LockedClimax
  onCancel: () => void
  onBuilt: () => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const [reading, setReading] = useState<LoopPhraseReading | null>(null)

  // Measured while the user answers the two questions above it. The setState
  // is inside the promise callback, never in the effect body -- a
  // synchronous one there is a lint error in this repo
  // (react-hooks/set-state-in-effect) as well as a cascading render.
  useEffect(() => {
    let cancelled = false
    const paths = climax.stems.map((stem) => ({ path: stem.path, bars: stem.barLength }))
    void Promise.allSettled(paths.map((p) => getStemPhrase(p.path, p.bars))).then((results) => {
      if (cancelled) return
      const readings: StemPhraseReading[] = results
        .filter((r): r is PromiseFulfilledResult<StemPhraseReading> => r.status === 'fulfilled')
        .map((r) => r.value)
      setReading(readLoopPhrase(readings, climax.barLength))
    })
    return (): void => {
      cancelled = true
    }
  }, [climax])

  // Recorded on the flow as soon as it lands -- a MEASUREMENT, which sizes
  // nothing by itself. COACH_SET_PHRASE is the only thing that sizes.
  useEffect(() => {
    if (reading === null) return
    dispatch({ type: 'COACH_SET_PHRASE_READING', reading })
  }, [dispatch, reading])

  const build = useCallback((): void => {
    if (coach === null || coach.loopIs === null || coach.shape === null) return
    const phraseBars = coach.phrase?.bars ?? climax.barLength
    // Built here AND rebuilt by the reducer from the same pure function over
    // the same inputs, so the two cannot disagree -- which is what lets
    // COACH_BUILD_MAP stay a one-field action instead of carrying a whole
    // section list through the store.
    const sections = buildCoachMapSections({
      shape: coach.shape,
      loopIs: coach.loopIs,
      phraseBars,
      climax,
      firstStartBar: 0
    })
    const built = buildCoachMapActions(state, { ...coach, sections }, sections)
    const actions: Action[] = [
      // COACH_BUILD_MAP refuses without an answered phrase, and not
      // answering is allowed: the report is silent whenever the measurement
      // agrees with the loop or cannot be made. So the nominal length is
      // written first, as the answer he would have given. It is still a
      // CLICK that writes it -- this one.
      ...(coach.phrase === null
        ? [
            {
              type: 'COACH_SET_PHRASE',
              phrase: { bars: phraseBars, source: 'nominal' }
            } satisfies Action
          ]
        : []),
      { type: 'COACH_BUILD_MAP', firstStartBar: 0 },
      ...built.actions,
      { type: 'COACH_RECORD_MAP_PLACEMENT', placedGroupIds: built.placedGroupIds },
      { type: 'SET_ARRANGER_MODE', mode: 'normal' },
      { type: 'SET_MAP_VIEW', on: true },
      { type: 'COACH_START_WALK', now: Date.now() }
    ]
    // ONE batch: the whole map, the clips under it and the walk it starts
    // are one undo step -- which is what makes "cmd+z puts everything back
    // on" true rather than a figure of speech. COACH_RECORD_MAP_PLACEMENT
    // rides in the SAME batch on purpose: it is transient, so dispatching it
    // separately would leave the map's lanes unknown after one undo.
    dispatch({ type: 'BATCH', actions })
    onBuilt()
  }, [climax, coach, dispatch, onBuilt, state])

  if (coach === null) return <div style={{ padding: 20 }}>no flow</div>

  const line = coachSetupLine(coach)
  const phraseLine = reading === null ? null : coachPhraseLine(reading, coach.lineSeed)
  const options = reading === null ? [] : phraseAnswerOptions(reading)
  const ready = coach.loopIs !== null && coach.shape !== null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        zIndex: 'var(--ra-z-modal)',
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
          width: PANEL_WIDTH,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--ra-s-5)', alignItems: 'flex-start' }}>
          <SssketchySprite animation="idle" size={48} onClick={(): void => {}} title="sssketchy" />
          <div style={{ flex: 1, fontSize: 11, lineHeight: 'var(--ra-lh-body)', minHeight: 34 }}>
            {line ?? (ready ? 'ready when you are.' : '')}
          </div>
        </div>

        <div className="ra-eyebrow" style={{ marginTop: 'var(--ra-s-7)' }}>
          what is this loop
        </div>
        <div style={{ display: 'flex', gap: 'var(--ra-s-1)', marginTop: 'var(--ra-s-2)' }}>
          {COACH_LOOP_ANSWERS.map((answer) => (
            <button
              key={answer}
              type="button"
              onClick={(): void => {
                dispatch({ type: 'COACH_SET_LOOP_ANSWER', loopIs: answer })
              }}
              style={chosenStyle(coach.loopIs === answer)}
            >
              {LOOP_ANSWER_LABEL[answer] ?? answer}
            </button>
          ))}
        </div>

        {coach.loopIs !== null && (
          <>
            <div className="ra-eyebrow" style={{ marginTop: 'var(--ra-s-7)' }}>
              how long a journey
            </div>
            <div style={{ display: 'flex', gap: 'var(--ra-s-1)', marginTop: 'var(--ra-s-2)' }}>
              {COACH_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  onClick={(): void => {
                    dispatch({ type: 'COACH_SET_SHAPE', shape: shape.id })
                  }}
                  style={{ ...chosenStyle(coach.shape === shape.id), height: 'auto', padding: 6 }}
                >
                  {/* The article's own letters, which read as a journey in a
                      way a list of six words does not. */}
                  <div>{shape.letters.join(' ')}</div>
                  <div style={{ marginTop: 2, fontSize: 9, color: 'var(--ra-text-3)' }}>
                    {shape.label} {'·'} about {shape.approxMinutes} min
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Silent when the measurement is inconclusive or simply agrees with
            the loop's stated length -- "if the measurement is inconclusive,
            sssketchy says nothing rather than guessing" (spec). */}
        {phraseLine !== null && (
          <>
            <div className="ra-eyebrow" style={{ marginTop: 'var(--ra-s-7)' }}>
              the phrase
            </div>
            <div
              style={{
                marginTop: 'var(--ra-s-2)',
                fontSize: 11,
                lineHeight: 'var(--ra-lh-body)',
                color: 'var(--ra-text)'
              }}
            >
              {phraseLine}
            </div>
            <div style={{ display: 'flex', gap: 'var(--ra-s-1)', marginTop: 'var(--ra-s-2)' }}>
              {options.map((option) => (
                <button
                  key={`${option.bars}-${option.source}`}
                  type="button"
                  onClick={(): void => {
                    dispatch({ type: 'COACH_SET_PHRASE', phrase: option })
                  }}
                  style={chosenStyle(coach.phrase?.bars === option.bars)}
                >
                  {option.bars} bars
                </button>
              ))}
            </div>
          </>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 'var(--ra-s-7)'
          }}
        >
          <button type="button" onClick={onCancel} style={buttonStyle}>
            cancel
          </button>
          <button
            type="button"
            onClick={build}
            disabled={!ready}
            title={ready ? undefined : 'answer both first'}
            style={{
              ...buttonStyle,
              border: '1px solid var(--ra-border-strong)',
              color: 'var(--ra-text)',
              opacity: ready ? 1 : 0.3,
              cursor: ready ? 'pointer' : 'not-allowed'
            }}
          >
            build the map
          </button>
        </div>

        {/* Said before the map is built rather than after, so the way out is
            known before there is anything to undo. Elling's own condition
            for the pre-fill being allowed at all. */}
        {ready && (
          <div style={{ marginTop: 'var(--ra-s-5)', fontSize: 10, color: 'var(--ra-text-3)' }}>
            {pickLineVariant(COACH_PREFILLED_LINE_TEMPLATES, coach.lineSeed)}
          </div>
        )}
      </div>
    </div>
  )
}
