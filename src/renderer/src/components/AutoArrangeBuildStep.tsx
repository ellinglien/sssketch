import { useMemo, useState } from 'react'
import {
  computeCandidates,
  MIN_STEMS_FOR_FULL_ARC,
  PHASE_STEP_TARGETS,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangePhase,
  type ArrangeStemInput
} from '@shared/autoArrangeEngine'
import { activeStemKeysPerStep, type ArrangeMoveRecord } from '@shared/autoArrangeApply'
import {
  advanceToNextStep,
  applyCandidate,
  selectTopCandidates
} from '@shared/autoArrangeBuildStep'
import { useAppSelector, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { usePlacedFlatStems, type FlatStem } from '../state/usePlacedFlatStems'
import { useStemPreviewPlayback } from '../state/useStemPreviewPlayback'
import { stemTileGeometryFromFields, type StemTileGeometry } from '../state/selectors'
import { Waveform } from './Waveform'
import { typeColorVar } from '../theme/typeColor'
import { stemKey as buildStemKey } from '@shared/types'
import { playButtonStyle } from './autoArrangeStyles'

interface Props {
  stems: ArrangeStemInput[]
  onComplete: (moves: ArrangeMoveRecord[], totalSteps: number) => void
  onCancel: () => void
}

// 'enter'/'exit' are this engine's own internal move-type vocabulary
// (autoArrangeEngine.ts) -- clear to someone reading the code, not
// necessarily to someone reading a button. Friendlier verbs for display only;
// the underlying ArrangeCandidate.moveType value is untouched.
const MOVE_LABELS: Record<string, string> = {
  enter: 'bring in',
  exit: 'pull out',
  fill: 'fill'
}

// Stem names in real Endlesss material are frequently unintelligible
// (auto-generated/generic) and can't be relied on to identify a candidate --
// the stem's own arrangeRole (already user-confirmed in the previous wizard
// step) is a far more useful label here. Mirrors the friendly-label intent
// of AutoArrangeRoleStep.tsx's role dropdown, kept local since that
// component shows the raw camelCase value in its own <option>s today.
const ROLE_LABELS: Record<string, string> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux',
  textureFx: 'texture/fx',
  fill: 'fill',
  vocal: 'vocal'
}

// Lowercase, no jargon -- matches MOVE_LABELS/ROLE_LABELS's own convention.
// 'build' reads as "building up" rather than the bare engine phase name,
// since "build" on its own reads more like a verb/button than a section
// name in the eyebrow's sentence context.
const PHASE_LABELS: Record<ArrangePhase, string> = {
  intro: 'intro',
  build: 'building up',
  peak: 'peak',
  breakdown: 'breakdown',
  outro: 'outro'
}

/** Second step of the auto-arrangement wizard, shown after AutoArrangeRoleStep.tsx
 * confirms each stem's role. Drives autoArrangeEngine.ts's computeCandidates/
 * advanceBuildState/isArrangementComplete one step at a time, letting the user
 * pick from the top weighted candidates rather than fully automating the
 * build/breakdown arc. The actual stop-condition and top-N-candidate logic
 * live in autoArrangeBuildStep.ts (tested there) -- this component is just
 * the click-through presentation. Styled after AutoArrangeRoleStep.tsx /
 * TidyUpNudgeModal.tsx's conventions: see docs/design.md.
 *
 * Per-candidate audio preview (2026-09): `stems` (ArrangeStemInput[], from
 * @shared/autoArrangeEngine) deliberately carries no file path or owning
 * rifff groupId -- it's pure engine input, consumed by tested
 * weighting/candidate logic that has no business knowing about playback.
 * Rather than widen that shared shape for a display-only need, this
 * component calls usePlacedFlatStems() directly (same StoreContext hook
 * AutoArrangeRoleStep.tsx and AutoArrangeWizard.tsx already call) and looks
 * up each candidate's own FlatStem (path, groupId) by stemKey. Per-stem tile
 * geometry (stemGeometryByKey), the waveform thumbnail, click-to-scrub, and
 * the playhead overlay are all copied verbatim from AutoArrangeRoleStep.tsx
 * -- see that component's own doc comments for why each piece is shaped the
 * way it is. */
export function AutoArrangeBuildStep({ stems, onComplete, onCancel }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const playedBarsOverrides = useAppSelector((s) => s.playedBars)
  const leftCropOverrides = useAppSelector((s) => s.leftCrop)
  const stretchOverrides = useAppSelector((s) => s.stretch)
  const stateBpm = useAppSelector((s) => s.bpm)
  const playing = usePlaying()
  const pos = usePos()
  const { placedRifffs, flatStemsByKey } = usePlacedFlatStems()

  const { previewingKeys, startPreview } = useStemPreviewPlayback()

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

  // Mirrors AutoArrangeRoleStep.tsx's togglePreviewStem -- not a per-row
  // pause-toggle on the outer candidate button, since a stemKey can appear
  // in more than one candidate row (an enter framing and a fill framing of
  // the same stem within one step) and this is still fundamentally "preview
  // this one stem," not "preview this one row." Also selects the candidate
  // row this play button belongs to (candidateKey, the same composite string
  // used by the select button) -- per Elling's feedback, playing a move
  // option should select it too, not leave selection as a separate click.
  // Selecting still isn't committing (apply below remains the only thing
  // that calls pick()), and this always selects rather than toggling, even
  // on the click that PAUSES playback -- pausing to re-listen to something
  // else shouldn't also lose your place.
  function togglePreviewStem(fs: FlatStem, candidateKey: string): void {
    setSelectedCandidateKey(candidateKey)
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

  // Plays every currently-ACTIVE stem (buildState.activeStemKeys) together --
  // "what has the arrangement built up to so far, heard as one thing" -- as
  // opposed to togglePreviewStem's single-stem audition of a candidate that
  // hasn't been picked yet. This is the primary listening action for this
  // step; per-candidate ▶ buttons are secondary (see their downplayed
  // styling below) since candidates are ALTERNATIVES to choose between, not
  // things meant to play together with each other.
  function playCurrentArrangement(): void {
    if (isPlayingCurrentArrangement) {
      dispatch({ type: 'PAUSE' })
      return
    }
    const startBars = [...previewStemKeys]
      .map((k) => stemGeometryByKey.get(k)?.startBar)
      .filter((b): b is number => b !== undefined)
    if (startBars.length === 0) return
    void startPreview(previewStemKeys, undefined, Math.min(...startBars))
  }

  // Mirrors AutoArrangeRoleStep.tsx's handleThumbnailClick exactly -- the
  // click fraction is applied against tileSpanBars (one raw-tile
  // repetition), not visibleBars, because the thumbnail only ever renders
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

  const [stepIndex, setStepIndex] = useState(0)
  const [buildState, setBuildState] = useState<ArrangeBuildState>({
    activeStemKeys: [],
    phase: 'intro',
    stepsInPhase: 0,
    lastExitStep: {}
  })
  const [moves, setMoves] = useState<ArrangeMoveRecord[]>([])

  // Select-then-confirm (2026-09): clicking a candidate row used to commit
  // it immediately -- no way to back out, no way to tell "I'm auditing
  // this" from "I meant to apply this." Per Elling's feedback, clicking a
  // candidate now only SELECTS it (toggle -- click again to deselect, click
  // a different one to switch); the bottom "apply" button is the only thing
  // that actually calls pick(). Keyed on the SAME composite string as each
  // row's own React `key` (`${stemKey}-${moveType}`) since one stemKey can
  // appear in more than one candidate row (e.g. an 'enter' framing and a
  // 'fill' framing of the same stem within a single step) and selection
  // needs to distinguish between them, not just track a stemKey.
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)

  // stepIndex here is the step candidates are being generated FOR (i.e. the
  // step about to be picked) -- applyBuildStep below is called separately,
  // at pick time, with this same stepIndex value to record an exit's
  // lastExitStep at the step it actually happened on.
  const candidates = selectTopCandidates(computeCandidates(stems, buildState, stepIndex))

  // Defensive lookup, not a trust boundary in practice: candidates is this
  // same step's own list, so a stale selectedCandidateKey (referring to a
  // stemKey/moveType combo no longer present) shouldn't normally happen --
  // but if it ever did, selectedCandidate comes back undefined and the
  // apply button below simply reads as disabled rather than calling pick()
  // with undefined.
  const selectedCandidate = candidates.find(
    (cand) => `${cand.stemKey}-${cand.moveType}` === selectedCandidateKey
  )
  const selectedRole = selectedCandidate
    ? stems.find((s) => s.stemKey === selectedCandidate.stemKey)?.role
    : undefined
  const selectedFs = selectedCandidate ? flatStemsByKey.get(selectedCandidate.stemKey) : undefined
  const applyLabel = selectedCandidate
    ? `apply: ${MOVE_LABELS[selectedCandidate.moveType] ?? selectedCandidate.moveType} ${
        (selectedRole && ROLE_LABELS[selectedRole]) ??
        selectedRole ??
        selectedFs?.stem.name ??
        selectedCandidate.stemKey
      }`
    : 'apply move'

  // What "hear the arrangement so far" (and the build-progress grid's
  // current column) should actually play. With nothing selected, that's
  // just the locked-in baseline (buildState.activeStemKeys). With a
  // candidate selected but not yet applied, this previews what picking it
  // WOULD do instead -- letting the user hear a prospective move before
  // committing to it, not just the stem in isolation the way each row's own
  // small ▶ does. 'fill' is treated the same as 'enter' for this preview
  // (both mean "this stem sounds during the step"); it doesn't persist past
  // this preview since pick()/applyBuildStep (unchanged) are what actually
  // decide fill's real one-step-only effect once applied.
  const previewStemKeys = selectedCandidate
    ? (() => {
        const next = new Set(buildState.activeStemKeys)
        if (selectedCandidate.moveType === 'exit') next.delete(selectedCandidate.stemKey)
        else next.add(selectedCandidate.stemKey)
        return next
      })()
    : new Set(buildState.activeStemKeys)

  const isPlayingCurrentArrangement =
    playing &&
    previewStemKeys.size > 0 &&
    previewingKeys.size === previewStemKeys.size &&
    [...previewStemKeys].every((k) => previewingKeys.has(k))

  // Build-progress grid: one row per included stem, one column per step so
  // far -- see this component's own module doc comment / activeStemKeysPerStep's
  // (autoArrangeApply.ts) for why this exists (Elling: "not sure what, but
  // visual connection seems important" -- the step counter alone gave no
  // sense of the shape being built). historyPerStep covers every ALREADY-
  // DECIDED step (0..stepIndex-1); the current, in-progress step is rendered
  // separately below using previewStemKeys, so a selected-but-not-yet-applied
  // pick shows up immediately as a distinct (hollow/dimmed) preview instead
  // of only appearing once committed.
  const historyPerStep = activeStemKeysPerStep(moves, stepIndex - 1)
  const gridStems = (() => {
    const included = stems.filter((s) => s.included)
    const totalByLabel = new Map<string, number>()
    for (const s of included) {
      const label = ROLE_LABELS[s.role] ?? s.role
      totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    return included.map((s) => {
      const label = ROLE_LABELS[s.role] ?? s.role
      const total = totalByLabel.get(label) ?? 1
      if (total <= 1) return { stem: s, label }
      const index = (seen.get(label) ?? 0) + 1
      seen.set(label, index)
      return { stem: s, label: `${label} ${index}` }
    })
  })()

  const includedCount = stems.filter((s) => s.included).length
  const tooFewStems = includedCount < MIN_STEMS_FOR_FULL_ARC

  // Applies one candidate and stays on the CURRENT step -- multi-move-per-
  // step: computeCandidates below recomputes fresh against the updated
  // buildState on the next render, so another candidate can be picked and
  // applied immediately without leaving this step. nextStep() (below) is
  // the only thing that now advances stepIndex.
  function pick(candidate: ArrangeCandidate): void {
    const result = applyCandidate(moves, buildState, stems, stepIndex, candidate)
    setMoves(result.moves)
    setBuildState(result.buildState)

    if (result.complete) {
      onComplete(result.moves, stepIndex + 1)
    }
  }

  // Advances to the next step (and, once the current phase's target is
  // reached, rolls into the next phase) -- the explicit action multi-move-
  // per-step needs now that applying a candidate no longer does this by
  // itself.
  function nextStep(): void {
    const result = advanceToNextStep(buildState, stepIndex)
    setBuildState(result.buildState)
    setStepIndex(result.stepIndex)
    setSelectedCandidateKey(null)

    if (result.complete) {
      onComplete(moves, result.stepIndex + 1)
    }
  }

  function finishNow(): void {
    onComplete(moves, stepIndex + 1)
  }

  // The only caller of pick() now -- pick() itself is untouched, it just
  // used to be invoked directly from each row's button. Resets the
  // selection after applying (defensive: the component is about to
  // re-render for the next step's own fresh candidate list anyway, but
  // avoids any stale-selection carryover if step-transition logic ever
  // changes).
  function applySelected(): void {
    if (!selectedCandidate) return
    pick(selectedCandidate)
    setSelectedCandidateKey(null)
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
          // Widened from the original 420 -- the per-candidate play button +
          // waveform thumbnail (added alongside the existing move-type/
          // reason text) need the room, same reasoning as
          // AutoArrangeRoleStep.tsx's own 480 -> 560 widening.
          width: 520,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 8 }}>
          {PHASE_LABELS[buildState.phase]} -- step{' '}
          {Math.min(buildState.stepsInPhase + 1, PHASE_STEP_TARGETS[buildState.phase])} of{' '}
          {PHASE_STEP_TARGETS[buildState.phase]} ({buildState.activeStemKeys.length} active)
        </div>
        {gridStems.length > 0 && (
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 'fit-content' }}>
              {gridStems.map(({ stem, label }) => {
                const fs = flatStemsByKey.get(stem.stemKey)
                const color = fs ? typeColorVar(fs.stem.type) : 'var(--ra-text-3)'
                const wasActive = buildState.activeStemKeys.includes(stem.stemKey)
                const willBeActive = previewStemKeys.has(stem.stemKey)
                const currentCell: 'active' | 'pending-add' | 'pending-remove' | 'empty' =
                  willBeActive && wasActive
                    ? 'active'
                    : willBeActive
                      ? 'pending-add'
                      : wasActive
                        ? 'pending-remove'
                        : 'empty'
                return (
                  <div key={stem.stemKey} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        width: 62,
                        flexShrink: 0,
                        fontSize: 9,
                        color: 'var(--ra-text-3)',
                        textAlign: 'right',
                        paddingRight: 4,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={label}
                    >
                      {label}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {historyPerStep.map((activeAtStep, i) => (
                        <div
                          key={i}
                          title={`step ${i + 1}`}
                          style={{
                            width: 10,
                            height: 10,
                            flexShrink: 0,
                            background: activeAtStep.includes(stem.stemKey) ? color : 'transparent',
                            border: `1px solid ${
                              activeAtStep.includes(stem.stemKey)
                                ? 'transparent'
                                : 'var(--ra-border)'
                            }`
                          }}
                        />
                      ))}
                      <div
                        title={`step ${stepIndex + 1} (current)`}
                        style={{
                          width: 10,
                          height: 10,
                          flexShrink: 0,
                          background:
                            currentCell === 'active' || currentCell === 'pending-remove'
                              ? color
                              : 'transparent',
                          opacity: currentCell === 'pending-remove' ? 0.35 : 1,
                          border:
                            currentCell === 'pending-add'
                              ? `1px dashed ${color}`
                              : currentCell === 'empty'
                                ? '1px solid var(--ra-border)'
                                : `1px solid var(--ra-stretch-on)`
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {previewStemKeys.size > 0 && (
          <button
            onClick={playCurrentArrangement}
            style={{
              ...playButtonStyle(isPlayingCurrentArrangement),
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              fontSize: 11,
              marginBottom: 12
            }}
            title={
              selectedCandidate
                ? 'play everything active so far, PLUS the currently selected (not yet applied) pick'
                : 'play everything active so far, together'
            }
          >
            {isPlayingCurrentArrangement ? '■' : '▶'}{' '}
            {selectedCandidate ? 'hear with this pick' : 'hear the arrangement so far'} (
            {previewStemKeys.size} stem
            {previewStemKeys.size === 1 ? '' : 's'})
          </button>
        )}
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', marginBottom: 12 }}>
          select a candidate below (or play its small ▶, which selects it too), then use apply to
          commit it -- applying keeps you on this step, so you can layer or pull several moves
          together before using next step to move on. That small ▶ previews just that one stem in
          isolation, it doesn&apos;t combine with the others.
        </div>
        {tooFewStems && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            only {includedCount} stem{includedCount === 1 ? '' : 's'} included -- the full
            intro/build/peak/breakdown/outro arc works best with more variety; expect it to feel
            thin.
          </div>
        )}
        {candidates.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            no candidates -- use next step to keep going, or finish below to stop here.
          </div>
        ) : (
          candidates.map((c) => {
            const candidateKey = `${c.stemKey}-${c.moveType}`
            const isSelected = candidateKey === selectedCandidateKey
            const fs = flatStemsByKey.get(c.stemKey)
            const stemRole = stems.find((s) => s.stemKey === c.stemKey)?.role
            const isPreviewing = previewingKeys.has(c.stemKey)
            const isThisStemPlaying = isPreviewing && playing
            const geometry = fs ? stemGeometryByKey.get(fs.stemKey) : undefined

            // Mirrors AutoArrangeRoleStep.tsx's own playhead derivation
            // exactly -- see that component's doc comment.
            let showPlayhead = false
            let playheadFraction = 0
            if (geometry) {
              const barsIntoClip = pos - geometry.startBar
              const withinClip =
                geometry.visibleBars > 0 && barsIntoClip >= 0 && barsIntoClip < geometry.visibleBars
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
              <div
                key={candidateKey}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  padding: '4px 6px',
                  // isSelected and isPreviewing are kept on different visual
                  // channels even though playing a candidate now also selects
                  // it (togglePreviewStem above): a candidate can still be
                  // selected but silent (selected via the select button,
                  // never played), so isPreviewing's thin outline (also on
                  // the thumbnail box below) and isSelected's own border/
                  // background treatment on this OUTER row read as separate
                  // facts rather than being collapsed into one.
                  border: `1px solid ${isSelected ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                  background: isSelected ? 'var(--ra-bg-row)' : 'var(--ra-bg-row-active)',
                  outline: isPreviewing ? '1px solid var(--ra-stretch-on)' : 'none',
                  outlineOffset: -3
                }}
              >
                <button
                  onClick={() => fs && togglePreviewStem(fs, candidateKey)}
                  disabled={!fs}
                  style={{
                    ...playButtonStyle(isThisStemPlaying),
                    // Downplayed relative to the select/apply flow, which is
                    // still the primary interaction in this row -- this ▶
                    // now also selects the row it's on (togglePreviewStem
                    // above), but it's still not a commit: apply below
                    // remains the only thing that calls pick(). Smaller
                    // footprint and a muted, borderless default so it
                    // doesn't compete with the select button next to it; the
                    // active/playing state still uses playButtonStyle's own
                    // bright --ra-stretch-on treatment unchanged, so "is this
                    // playing" stays just as unambiguous as before.
                    fontSize: 8,
                    padding: '2px 6px',
                    border: isThisStemPlaying
                      ? '1px solid var(--ra-stretch-on)'
                      : '1px solid transparent',
                    color: isThisStemPlaying ? 'var(--ra-stretch-on)' : 'var(--ra-text-3)'
                  }}
                  title="preview this stem, and select this move"
                >
                  {isThisStemPlaying ? '■' : '▶'}
                </button>
                {fs && geometry ? (
                  <div
                    onClick={(e) => handleThumbnailClick(e, fs, geometry)}
                    title={`${fs.stem.name} — click to preview from this point`}
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
                    <Waveform path={fs.stem.path} color={typeColorVar(fs.stem.type)} opacity={1} />
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
                <button
                  onClick={() => {
                    setSelectedCandidateKey(
                      candidateKey === selectedCandidateKey ? null : candidateKey
                    )
                  }}
                  title="select this move -- use apply below to commit it"
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 0,
                    fontSize: 11,
                    // Selected reads as a filled/bright control (the
                    // --ra-stretch-on "on" treatment used elsewhere for a
                    // committed toggle state) -- deliberately a DIFFERENT
                    // visual channel than isPreviewing's thin outline on the
                    // outer row/thumbnail, so a candidate that's selected
                    // AND currently previewing shows both at once without
                    // either reading as the other. This button no longer
                    // commits anything by itself -- clicking it only
                    // selects/deselects; the bottom "apply" button is the
                    // sole thing that calls pick().
                    border: `1px solid ${isSelected ? 'var(--ra-stretch-on)' : 'var(--ra-border-strong)'}`,
                    background: isSelected ? 'var(--ra-stretch-on)' : 'var(--ra-bg-row)',
                    color: isSelected ? 'var(--ra-play-on-ink)' : 'var(--ra-text)',
                    fontWeight: isSelected ? 700 : 400,
                    cursor: 'pointer'
                  }}
                >
                  {MOVE_LABELS[c.moveType] ?? c.moveType}{' '}
                  {(stemRole && ROLE_LABELS[stemRole]) ?? stemRole ?? fs?.stem.name ?? c.stemKey} --{' '}
                  {c.reason}
                </button>
              </div>
            )
          })
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button
            onClick={applySelected}
            disabled={!selectedCandidate}
            title={selectedCandidate ? applyLabel : 'select a candidate above first'}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              fontWeight: 700,
              border: '1px solid var(--ra-stretch-on)',
              background: 'var(--ra-stretch-on)',
              color: 'var(--ra-play-on-ink)',
              // This app's disabled convention (docs/design.md, mirrored in
              // ContextMenu.tsx): dim to 30% opacity + not-allowed cursor,
              // rather than swapping to a separate "disabled" palette.
              cursor: selectedCandidate ? 'pointer' : 'not-allowed',
              opacity: selectedCandidate ? 1 : 0.3
            }}
          >
            {applyLabel}
          </button>
          <button
            onClick={nextStep}
            disabled={!!selectedCandidate}
            title={
              selectedCandidate
                ? 'apply or deselect your pick before moving to the next step'
                : 'move on to the next step -- rolls into the next phase once its target is reached'
            }
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)',
              // Same disabled convention as applySelected above (docs/design.md,
              // mirrored in ContextMenu.tsx): dim to 30% opacity + not-allowed
              // cursor rather than a separate "disabled" palette.
              cursor: selectedCandidate ? 'not-allowed' : 'pointer',
              opacity: selectedCandidate ? 0.3 : 1
            }}
          >
            next step
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
          <button
            onClick={finishNow}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)'
            }}
          >
            finish now
          </button>
        </div>
      </div>
    </div>
  )
}
