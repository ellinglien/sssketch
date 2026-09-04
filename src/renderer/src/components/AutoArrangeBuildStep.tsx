import { useMemo, useState } from 'react'
import {
  computeCandidates,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangeStemInput
} from '@shared/autoArrangeEngine'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { applyBuildStep, selectTopCandidates } from '@shared/autoArrangeBuildStep'
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
  // this one stem," not "preview this one row."
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

  // Plays every currently-ACTIVE stem (buildState.activeStemKeys) together --
  // "what has the arrangement built up to so far, heard as one thing" -- as
  // opposed to togglePreviewStem's single-stem audition of a candidate that
  // hasn't been picked yet. This is the primary listening action for this
  // step; per-candidate ▶ buttons are secondary (see their downplayed
  // styling below) since candidates are ALTERNATIVES to choose between, not
  // things meant to play together with each other.
  function playCurrentArrangement(): void {
    const isAlreadyPlayingCurrent =
      playing &&
      previewingKeys.size === buildState.activeStemKeys.length &&
      buildState.activeStemKeys.every((k) => previewingKeys.has(k))
    if (isAlreadyPlayingCurrent) {
      dispatch({ type: 'PAUSE' })
      return
    }
    const startBars = buildState.activeStemKeys
      .map((k) => stemGeometryByKey.get(k)?.startBar)
      .filter((b): b is number => b !== undefined)
    if (startBars.length === 0) return
    void startPreview(new Set(buildState.activeStemKeys), undefined, Math.min(...startBars))
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
    peakReached: false,
    lastExitStep: {}
  })
  const [moves, setMoves] = useState<ArrangeMoveRecord[]>([])

  // stepIndex here is the step candidates are being generated FOR (i.e. the
  // step about to be picked) -- applyBuildStep below is called separately,
  // at pick time, with this same stepIndex value to record an exit's
  // lastExitStep at the step it actually happened on.
  const candidates = selectTopCandidates(computeCandidates(stems, buildState, stepIndex))

  const isPlayingCurrentArrangement =
    playing &&
    buildState.activeStemKeys.length > 0 &&
    previewingKeys.size === buildState.activeStemKeys.length &&
    buildState.activeStemKeys.every((k) => previewingKeys.has(k))

  const includedCount = stems.filter((s) => s.included).length
  const tooFewStems = includedCount < 2

  function pick(candidate: ArrangeCandidate): void {
    const result = applyBuildStep(moves, buildState, stems, stepIndex, candidate)
    setMoves(result.moves)
    setBuildState(result.buildState)

    if (result.complete) {
      onComplete(result.moves, stepIndex + 1)
      return
    }
    setStepIndex(stepIndex + 1)
  }

  function finishNow(): void {
    onComplete(moves, stepIndex + 1)
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
          step {stepIndex + 1} -- {buildState.activeStemKeys.length} active
        </div>
        {buildState.activeStemKeys.length > 0 && (
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
            title="play everything active so far, together"
          >
            {isPlayingCurrentArrangement ? '■' : '▶'} hear the arrangement so far (
            {buildState.activeStemKeys.length} stem
            {buildState.activeStemKeys.length === 1 ? '' : 's'})
          </button>
        )}
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', marginBottom: 12 }}>
          pick a move below to apply it and continue -- each candidate&apos;s own small ▶ just
          previews that one stem in isolation, it doesn&apos;t combine with the others
        </div>
        {tooFewStems && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            only {includedCount} stem{includedCount === 1 ? '' : 's'} included -- not enough
            material for a real build/breakdown arc, this will be a trivial arrangement.
          </div>
        )}
        {candidates.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            no candidates -- finish below
          </div>
        ) : (
          candidates.map((c) => {
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
                key={`${c.stemKey}-${c.moveType}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  padding: '4px 6px',
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  outline: isPreviewing ? '1px solid var(--ra-stretch-on)' : 'none',
                  outlineOffset: -1
                }}
              >
                <button
                  onClick={() => fs && togglePreviewStem(fs)}
                  disabled={!fs}
                  style={playButtonStyle(isThisStemPlaying)}
                  title="solo + preview this stem, from its own clip start"
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
                  onClick={() => pick(c)}
                  title="apply this move and continue to the next step"
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 0,
                    fontSize: 11,
                    // Deliberately distinct from the row's own background
                    // (var(--ra-bg-row-active), matching the ▶ preview
                    // button and the row container itself) -- this is the
                    // one control in the row that COMMITS a change, so it
                    // needs to read as an actionable button, not blend into
                    // the row like a label. Confirmed by user feedback: the
                    // prior identical-background styling made it unclear
                    // this was clickable at all.
                    border: '1px solid var(--ra-border-strong)',
                    background: 'var(--ra-bg-row)',
                    color: 'var(--ra-text)',
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
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
