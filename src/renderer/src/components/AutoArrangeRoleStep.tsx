import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { usePlacedFlatStems, type FlatStem } from '../state/usePlacedFlatStems'
import { useStemPreviewPlayback } from '../state/useStemPreviewPlayback'
import { stemTileGeometryFromFields, type StemTileGeometry } from '../state/selectors'
import { buildDensityMap, computeDensityScore, densityLabel } from '@shared/stemDensityScore'
import {
  resolveStemRole,
  type ArrangeRole,
  type DrumSubRole,
  type StemFrequency,
  type StemRoleInfo
} from '@shared/stemRole'
import { MIN_STEMS_FOR_FULL_ARC } from '@shared/autoArrangeEngine'
import { useStemFeatureScan } from '../audio/useStemFeatureScan'
import { Waveform } from './Waveform'
import { typeColorVar } from '../theme/typeColor'
import { stemKey } from '@shared/types'
import { playButtonStyle } from './autoArrangeStyles'
import { startPointerDrag } from './dragUtils'
import { elapsedLabel } from '@shared/visuals'
import { ARRANGE_STEP_BARS, DRAW_ARRANGE_SECTIONS } from '@shared/autoArrangeApply'
import { minSectionsForShape, type ArrangeShape } from '@shared/autoArrangeAutomation'
import { emptyCategoryCentroidStore, type CategoryCentroidStore } from '@shared/categoryCentroids'
import { refineRoleWithCentroidSuggestion } from '@shared/roleCentroidRefinement'
import { toFeatureArray } from '@shared/stemFeatures'

interface Props {
  onConfirm: (
    roles: StemRoleInfo[],
    buildOptions?: { targetSections: number; shape: ArrangeShape }
  ) => void
  onCancel: () => void
  // New, both optional -- omitting either preserves today's exact
  // Auto-Arrange behavior unchanged. Added for Draw Arrangement's reuse
  // of this same role-confirmation step (see DrawArrangeWizard.tsx).
  showFrequency?: boolean
  skippable?: boolean
  // Default true -- Auto-Arrange's own call site (AutoArrangeWizard.tsx)
  // needs these; Draw Arrangement's (DrawArrangeWizard.tsx) explicitly
  // passes false, since a drawn arrangement's length/shape come from the
  // grid itself, not an upfront choice, and the warning text below
  // specifically references phases Draw Arrangement doesn't have.
  showLengthAndShape?: boolean
}

// The 8 arrangement-oriented categories, replacing the old raw-SoundType
// dropdown per direct feedback (2026-09-01: "audioIn doesn't really help
// with arrangement, does it?"). See ArrangeRole's own doc comment
// (shared/stemRole.ts) for what each of the non-obvious ones means.
const ARRANGE_ROLE_OPTIONS: ArrangeRole[] = [
  'drums',
  'bass',
  'lead',
  'backing',
  'aux',
  'textureFx',
  'fill',
  'vocal'
]

// Shown only for a row whose arrangeRole is 'drums' -- see DrumSubRole's own
// doc comment (shared/stemRole.ts). '' (empty string) is the <select>'s own
// "no sub-role, stay generic" option, mapped to/from `undefined` at the
// onChange boundary rather than adding a real '' value to the DrumSubRole
// type itself.
const DRUM_SUB_ROLE_OPTIONS: DrumSubRole[] = ['kick', 'snare', 'hihat', 'clap', 'perc']
const DRUM_SUB_ROLE_LABELS: Record<DrumSubRole, string> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  clap: 'clap',
  perc: 'perc / other'
}

// Ordered low-to-high -- index 0..3 maps directly onto the frequency
// slider's own value (min=0, max=3, step=1). See StemFrequency's own doc
// comment (shared/stemRole.ts) for what each level means to the engine
// (re-entry eligibility + cooldown + enter-weight multiplier).
const FREQUENCY_LEVELS: StemFrequency[] = ['once', 'occasional', 'frequent', 'veryFrequent']

// Display labels, in this app's lowercase, no-exclamation-marks copy voice --
// shown as text next to the slider so a bare slider position ("1") still
// reads as something meaningful.
const FREQUENCY_LABELS: Record<StemFrequency, string> = {
  once: 'once',
  occasional: 'occasional',
  frequent: 'frequent',
  veryFrequent: 'very frequent'
}

const selectStyle: React.CSSProperties = {
  height: 22,
  borderRadius: 0,
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text)'
}

/** Shown before an auto-arrangement run to let the user confirm/correct each
 * stem's arrangeRole (and drop stems that shouldn't be arranged at all)
 * before autoArrangeEngine.ts sees them. arrangeRole is an arrangement-
 * oriented taxonomy (see ArrangeRole's own doc comment in shared/stemRole.ts)
 * seeded from busId/soundType but edited independently -- the raw soundType/
 * busId signal is still shown alongside it as context. `uncertain` (from
 * resolveStemRole) flags stems this can't classify with any real signal --
 * never tidied AND still on the unresolved 'fx' default -- so the user knows
 * which rows are guesses.
 * Styled after TidyUpNudgeModal.tsx's conventions: see docs/design.md.
 *
 * Scope: like Tidy Up, this pools stems from EVERY rifff currently placed on
 * the timeline (rifff.startBar !== undefined -- the same sentinel selectors.ts
 * uses throughout, e.g. groupIdAtPosition/loopLengthBars), not one target
 * rifff -- there's no "currently selected rifff" convention in this app for
 * a single-target design to hang off of. */
export function AutoArrangeRoleStep({
  onConfirm,
  onCancel,
  showFrequency = true,
  skippable = false,
  showLengthAndShape = true
}: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const busOf = useAppSelector((s) => s.busOf)
  const playedBarsOverrides = useAppSelector((s) => s.playedBars)
  const leftCropOverrides = useAppSelector((s) => s.leftCrop)
  const stretchOverrides = useAppSelector((s) => s.stretch)
  const stateBpm = useAppSelector((s) => s.bpm)
  const playing = usePlaying()
  const pos = usePos()
  const { placedRifffs, flatStems, flatStemsByKey } = usePlacedFlatStems()

  const [roles, setRoles] = useState<StemRoleInfo[] | null>(null)
  const [densities, setDensities] = useState<Record<string, number>>({})

  // Default 10 sections (40 bars) -- identical to today's fixed total, so a
  // user who never touches the drag control gets the same length auto-arrange
  // has always produced.
  const [targetSections, setTargetSections] = useState(10)
  const [shape, setShape] = useState<ArrangeShape>('buildUp')
  const [isDraggingLength, setIsDraggingLength] = useState(false)
  const targetSectionsAtDragStart = useRef(targetSections)

  // Switching shape can raise the minimum selectable length (e.g. from
  // startFull's 2 up to buildUp's 5) -- clamp up, never down, so a
  // previously-chosen longer length is never silently shortened just
  // because you changed shape. Applied directly in the shape button's own
  // onClick below rather than via a useEffect keyed on `shape` -- shape
  // only ever changes from that one click, and a setState-on-shape-change
  // effect would fire synchronously in the effect body, tripping this
  // codebase's react-hooks/set-state-in-effect rule (see
  // ClusterStemsBrowser.tsx/BeatPicker.tsx's own comments on the same
  // rule for precedent).
  function selectShape(next: ArrangeShape): void {
    setShape(next)
    setTargetSections((prev) => Math.max(prev, minSectionsForShape(next)))
  }

  // previewingKeys/startPreview -- including muteSnapshot, the unmount
  // cleanup that restores it, and the async-ordering fix for the
  // 2026-08-22 stale-mute-state bug -- are owned by useStemPreviewPlayback,
  // shared verbatim with ClusterStemsBrowser.tsx (Tidy Up), which this
  // step's own preview was built to mirror as closely as possible. See
  // that hook's own doc comment for why this is a shared hook rather than
  // a second copy.
  const { previewingKeys, startPreview } = useStemPreviewPlayback()

  // Per-stem playback geometry (where its clip starts, how many bars of it
  // are actually on the timeline, how many bars one raw-tile repetition
  // spans), keyed by stemKey -- shared verbatim with ClusterStemsBrowser.tsx
  // (Tidy Up)'s own ClusterableStem derivation via selectors.ts's
  // stemTileGeometryFromFields, now that this step ALSO renders a per-stem
  // waveform thumbnail with click-to-scrub and a playhead overlay (see that
  // function's own doc comment for why this can't be approximated -- both
  // visibleBars and tileSpanBars have a real, previously-reported-bug
  // history). Also replaces the old startBar-only startBarByGroupId map
  // below: every stem in a rifff shares that rifff's own startBar, so a
  // single per-stem geometry map covers both needs.
  const stemGeometryByKey = useMemo(() => {
    const map = new Map<string, StemTileGeometry>()
    for (const rifff of placedRifffs) {
      if (rifff.startBar === undefined) continue
      const stretchOn = stretchOverrides[rifff.groupId] ?? true
      for (const stem of rifff.stems) {
        map.set(
          stemKey(rifff.groupId, stem.slot),
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

  // Mirrors SketchStrip.tsx's own draggable-bar-count control: reuses the
  // same shared startPointerDrag helper (dragUtils.ts), drag up increases
  // the value (screen Y decreases upward, so -deltaY is positive going
  // up), committed live as you drag rather than only on release -- there's
  // no separate "confirm" step here the way SketchStrip's SET_PLAYED_BARS
  // dispatch needs, since nothing is dispatched until "continue"/"skip" is
  // clicked anyway.
  const LENGTH_DRAG_PX_PER_STEP = 20

  function handleLengthPointerDown(e: React.MouseEvent): void {
    targetSectionsAtDragStart.current = targetSections
    setIsDraggingLength(true)
    startPointerDrag(
      e,
      (_deltaX, deltaY) => {
        const stepsMoved = Math.round(-deltaY / LENGTH_DRAG_PX_PER_STEP)
        const min = minSectionsForShape(shape)
        const next = Math.max(
          min,
          Math.min(DRAW_ARRANGE_SECTIONS, targetSectionsAtDragStart.current + stepsMoved)
        )
        setTargetSections(next)
      },
      () => setIsDraggingLength(false)
    )
  }

  // Per-row play button -- pressing it again on the stem it's ALREADY
  // previewing stops playback instead of re-triggering it (a real toggle);
  // pressing it on a different stem always re-previews from that stem's own
  // start, matching startPreview's own idempotent-not-toggling design.
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

  // A single thumbnail click/scrub -- mirrors ClusterStemsBrowser.tsx's own
  // handleThumbnailClick exactly: the click's fraction within the 64px-wide
  // thumbnail is applied against tileSpanBars (one raw-tile repetition),
  // NOT visibleBars (the whole clip's on-timeline span), because the
  // thumbnail only ever renders that one pass of the raw source file. Not a
  // toggle -- clicking anywhere in the waveform always re-previews from
  // that exact point, even if this stem is already the one playing.
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

  // Loaded once on mount, same "frozen for this session" pattern as
  // ClusterStemsBrowser.tsx's own centroidStoreSnapshot -- there's no
  // equivalent "jolting suggestions mid-session" concern here (this
  // component shows one role per stem, not a reshuffling suggested-groups
  // list), but loading once and never refetching is still the simplest
  // correct choice, and keeps this consistent with the established
  // pattern rather than inventing a second one.
  const [centroidStore, setCentroidStore] = useState<CategoryCentroidStore>(
    emptyCategoryCentroidStore
  )
  useEffect(() => {
    void window.rifffApi.getCategoryCentroids().then(setCentroidStore)
  }, [])

  const scanItems = useMemo(
    () => flatStems.map(({ stem, stemKey: key }) => ({ key, path: stem.path })),
    [flatStems]
  )
  const { loading: scanLoading, featuresByKey } = useStemFeatureScan(scanItems)

  // buildDensityMap's own PromiseSettledResult<number>[] shape (one entry
  // per stem, in flatStems order, 'fulfilled' with a density score or
  // 'rejected') is reused as-is here -- rather than changing that shared
  // helper's own signature, a scanned-but-missing feature (a stem
  // useStemFeatureScan's own Promise.allSettled excluded) is turned back
  // into an equivalent 'rejected' entry, and buildDensityMap's existing
  // "rejected -> density score 0, 'sparse'" fallback handles it exactly
  // the same way a genuinely rejected extraction always has.
  const densityResults = useMemo<PromiseSettledResult<number>[]>(
    () =>
      flatStems.map(({ stem, stemKey: key }) => {
        const features = featuresByKey.get(key)
        return features
          ? { status: 'fulfilled', value: computeDensityScore(features) }
          : { status: 'rejected', reason: new Error(`no scanned features for stem ${stem.path}`) }
      }),
    [flatStems, featuresByKey]
  )

  useEffect(() => {
    if (flatStems.length === 0) return
    if (scanLoading) return
    // Role resolution itself is synchronous and can't fail -- resolve it
    // for every stem once the shared scan hook has settled, then let the
    // centroid classifier refine any stem with no confirmed busId (see
    // roleCentroidRefinement.ts's own doc comment for the full priority
    // order and why this ranks above a PresetName match too).
    const resolved: StemRoleInfo[] = flatStems.map(({ stem, stemKey: key }) => {
      const base = resolveStemRole(stem, key, busOf[key] ?? null)
      const features = featuresByKey.get(key)
      const raw = features ? toFeatureArray(features) : null
      return refineRoleWithCentroidSuggestion(base, raw, centroidStore)
    })
    // buildDensityMap is keyed to one groupId per call -- build it per
    // owning rifff over the matching slice of `densityResults` (flatStems is
    // built by flatMap over placedRifffs in the same order, so slices line
    // up), then merge. Keeps the shared helper's single-rifff shape intact
    // rather than reshaping it for a multi-rifff caller.
    let cursor = 0
    const densityMap: Record<string, number> = {}
    for (const rifff of placedRifffs) {
      const sliceResults = densityResults.slice(cursor, cursor + rifff.stems.length)
      Object.assign(densityMap, buildDensityMap(rifff.stems, rifff.groupId, sliceResults))
      cursor += rifff.stems.length
    }
    // Deferred through a microtask (not called directly) so this doesn't
    // read as a synchronous setState-in-effect -- same established
    // workaround as BeatPicker.tsx's own initialStepsRef reset effect.
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setRoles(resolved)
      setDensities(densityMap)
    })
    return () => {
      cancelled = true
    }
  }, [flatStems, placedRifffs, busOf, scanLoading, densityResults, centroidStore, featuresByKey])

  if (placedRifffs.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--ra-text-2)' }}>no rifffs on the timeline yet</div>
    )
  }

  if (!roles) {
    return <div style={{ padding: 20, color: 'var(--ra-text-2)' }}>analyzing stems...</div>
  }

  function updateRole(stemKey: string, patch: Partial<StemRoleInfo>): void {
    setRoles((prev) => prev!.map((r) => (r.stemKey === stemKey ? { ...r, ...patch } : r)))
  }

  // Row-level "play all" -- mirrors ClusterStemsBrowser.tsx's own playRow,
  // adapted from "this cluster's members" to "every currently-included
  // stem," since "how do these stems sound together" is exactly what's
  // relevant while confirming roles/inclusion. Same toggle-vs-re-preview
  // semantics: pressing it again while it's already the active preview set
  // stops playback; pressing it any other time re-previews from the
  // earliest included clip's own start bar.
  const includedKeys = roles.filter((r) => r.included).map((r) => r.stemKey)
  function togglePlayAllIncluded(): void {
    if (includedKeys.length === 0) return
    const isAlreadyPlaying =
      playing &&
      previewingKeys.size === includedKeys.length &&
      includedKeys.every((key) => previewingKeys.has(key))
    if (isAlreadyPlaying) {
      dispatch({ type: 'PAUSE' })
      return
    }
    // Filters out any stemKey that can't resolve a geometry entry, rather
    // than defaulting it into the Math.min aggregate at bar 0 -- a
    // resolvable stem silently contributing a fabricated 0 would be a
    // wrong seek target, not just a missing one.
    const resolvedStartBars = includedKeys
      .map((key) => stemGeometryByKey.get(key)?.startBar)
      .filter((startBar): startBar is number => startBar !== undefined)
    if (resolvedStartBars.length === 0) return
    const targetBar = Math.min(...resolvedStartBars)
    void startPreview(new Set(includedKeys), undefined, targetBar)
  }
  const allIncludedPlaying =
    playing &&
    includedKeys.length > 0 &&
    previewingKeys.size === includedKeys.length &&
    includedKeys.every((key) => previewingKeys.has(key))

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
      {/* Custom range-input styling, matching ClusterStemsBrowser.tsx's own
          .cluster-count-slider convention exactly (this app's one other
          custom-styled <input type="range">) -- plain <style> tag, no
          CSS-in-JS dependency, sharp corners throughout, no border-radius
          anywhere. One shared class covers every per-row frequency slider
          below. */}
      <style>{`
        .arrange-frequency-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 70px;
          height: 2px;
          outline: none;
          cursor: pointer;
        }
        .arrange-frequency-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 10px;
          height: 10px;
          background: var(--ra-stretch-on);
          border: 1px solid var(--ra-stretch-on);
          cursor: pointer;
        }
        .arrange-frequency-slider::-moz-range-thumb {
          width: 10px;
          height: 10px;
          background: var(--ra-stretch-on);
          border: 1px solid var(--ra-stretch-on);
          border-radius: 0;
          cursor: pointer;
        }
        .arrange-frequency-slider::-moz-range-track {
          height: 2px;
          background: transparent;
        }
      `}</style>
      <div
        style={{
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20,
          // Widened from the original 480 -- the per-row waveform thumbnail
          // (64px, added alongside the existing controls) needs the room.
          width: 560,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12
          }}
        >
          <div className="ra-eyebrow">confirm stem roles</div>
          <button
            onClick={togglePlayAllIncluded}
            disabled={includedKeys.length === 0}
            style={{
              ...playButtonStyle(allIncludedPlaying),
              marginLeft: 'auto',
              opacity: includedKeys.length === 0 ? 0.3 : 1,
              cursor: includedKeys.length === 0 ? 'not-allowed' : 'pointer'
            }}
            title="solo + play every currently included stem together, from the earliest one's own start"
          >
            {allIncludedPlaying ? '■ playing all' : '▶ play all included'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', marginBottom: 12 }}>
          this treats every stem currently placed on the timeline as fresh material -- finishing it
          replaces what&apos;s there now, even if you&apos;ve already run it before.
        </div>
        {showLengthAndShape && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>length</span>
                <span
                  onMouseDown={handleLengthPointerDown}
                  title="drag up/down to change the built arrangement's length"
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'ns-resize',
                    color: isDraggingLength ? 'var(--ra-stretch-on)' : 'var(--ra-text)',
                    userSelect: 'none'
                  }}
                >
                  {elapsedLabel(targetSections * ARRANGE_STEP_BARS, stateBpm)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(
                  [
                    { value: 'buildUp', label: 'build up' },
                    { value: 'stayBusy', label: 'stay busy' },
                    { value: 'startFull', label: 'start full' }
                  ] as const
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => selectShape(value)}
                    style={{
                      height: 20,
                      borderRadius: 0,
                      padding: '0 8px',
                      fontSize: 9,
                      border: `1px solid ${shape === value ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                      background: shape === value ? 'var(--ra-stretch-on-bg)' : 'transparent',
                      color: shape === value ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                      cursor: 'pointer'
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {includedKeys.length < MIN_STEMS_FOR_FULL_ARC && (
              <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
                only {includedKeys.length} stem{includedKeys.length === 1 ? '' : 's'} included --{' '}
                {shape === 'startFull'
                  ? 'thinning everything out works best with more variety'
                  : 'the full intro/build/peak/breakdown/outro arc works best with more variety'}
                ; expect it to feel thin.
              </div>
            )}
          </>
        )}
        {roles.map((role) => {
          const fs = flatStemsByKey.get(role.stemKey)
          const isPreviewing = previewingKeys.has(role.stemKey)
          const isThisStemPlaying = isPreviewing && playing
          const geometry = fs ? stemGeometryByKey.get(fs.stemKey) : undefined

          // Mirrors ClusterStemsBrowser.tsx's ClusterRow playhead derivation
          // exactly -- see its own doc comment. showPlayhead's bounds check
          // uses the whole clip's real on-timeline span (visibleBars), but
          // playheadFraction's own position is "how far into the CURRENT
          // tile repetition" (barsIntoClip mod tileSpanBars), to match what
          // <Waveform> actually renders (one pass of the raw source file,
          // not the whole tiled clip).
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
            playheadFraction = geometry.tileSpanBars > 0 ? barsIntoTile / geometry.tileSpanBars : 0
            showPlayhead = isPreviewing && playing && withinClip
          }

          // Two sub-rows rather than one flat flex list: the row was already
          // cramped at 7 inline controls before the frequency select landed
          // (play button, 64px waveform, checkbox, arrangeRole select, raw
          // soundType/busId provenance label, density label, optional
          // uncertain badge) with no logical grouping and no wrap/overflow
          // guard at the panel's fixed 560px width. Top line is media/
          // playback (play button + waveform thumbnail); bottom line is
          // role/metadata/preference controls (checkbox, arrangeRole select,
          // frequency select, density/provenance labels, uncertain badge),
          // allowed to wrap rather than overflow.
          return (
            <div
              key={role.stemKey}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '6px 0',
                borderBottom: '1px solid var(--ra-border-soft)',
                outline: isPreviewing ? '1px solid var(--ra-stretch-on)' : 'none',
                outlineOffset: -1
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                      width: 64,
                      height: 32,
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
                  <div style={{ width: 64, height: 32, flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
                  {fs?.stem.name ?? role.stemKey}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  paddingLeft: 74
                }}
              >
                <input
                  type="checkbox"
                  checked={role.included}
                  onChange={(e) => updateRole(role.stemKey, { included: e.target.checked })}
                />
                <select
                  value={role.arrangeRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as ArrangeRole
                    // Clear a stale sub-role the instant arrangeRole moves
                    // away from 'drums' -- engineRoleFor already ignores
                    // drumSubRole for any other role, but leaving it set
                    // would silently reappear (and read as meaningful) if
                    // the user switches back to 'drums' later.
                    updateRole(role.stemKey, {
                      arrangeRole: nextRole,
                      drumSubRole: nextRole === 'drums' ? role.drumSubRole : undefined
                    })
                  }}
                  style={selectStyle}
                >
                  {ARRANGE_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {role.arrangeRole === 'drums' && (
                  <select
                    value={role.drumSubRole ?? ''}
                    onChange={(e) =>
                      updateRole(role.stemKey, {
                        drumSubRole:
                          e.target.value === '' ? undefined : (e.target.value as DrumSubRole)
                      })
                    }
                    title="optionally refine which drum kit piece this is -- helps treat different drum stems as genuinely different roles"
                    style={selectStyle}
                  >
                    <option value="">drums (generic)</option>
                    {DRUM_SUB_ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {DRUM_SUB_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                )}
                {showFrequency && (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    title="how often this stem should re-enter during the release phase, and its priority relative to other stems"
                  >
                    <input
                      className="arrange-frequency-slider"
                      type="range"
                      min={0}
                      max={FREQUENCY_LEVELS.length - 1}
                      step={1}
                      value={FREQUENCY_LEVELS.indexOf(role.frequency)}
                      onChange={(e) =>
                        updateRole(role.stemKey, {
                          frequency: FREQUENCY_LEVELS[Number(e.target.value)]
                        })
                      }
                      style={{
                        background: `linear-gradient(to right, var(--ra-stretch-on) ${
                          (FREQUENCY_LEVELS.indexOf(role.frequency) /
                            (FREQUENCY_LEVELS.length - 1)) *
                          100
                        }%, var(--ra-border) ${
                          (FREQUENCY_LEVELS.indexOf(role.frequency) /
                            (FREQUENCY_LEVELS.length - 1)) *
                          100
                        }%)`
                      }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--ra-text-2)', minWidth: 62 }}>
                      {FREQUENCY_LABELS[role.frequency]}
                    </span>
                  </div>
                )}
                {/* Raw seeding signal (soundType, and busId when this stem was
                    already tidied) -- kept visible as context for the
                    arrangeRole guess above, same secondary-label treatment as
                    density. */}
                <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
                  {role.soundType}
                  {role.busId ? ` · ${role.busId}` : ''}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
                  {densityLabel(densities[role.stemKey] ?? 0)}
                </span>
                {role.uncertain && (
                  <span style={{ fontSize: 10, color: 'var(--ra-mute-on)' }}>uncertain</span>
                )}
              </div>
            </div>
          )
        })}
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
          {skippable && (
            <button
              onClick={() =>
                onConfirm(roles, showLengthAndShape ? { targetSections, shape } : undefined)
              }
              disabled={includedKeys.length === 0}
              title={includedKeys.length === 0 ? 'include at least one stem first' : undefined}
              style={{
                height: 22,
                borderRadius: 0,
                padding: '0 10px',
                fontSize: 10,
                border: '1px solid var(--ra-border)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text-2)',
                // This app's disabled convention (docs/design.md): dim to
                // 30% opacity + not-allowed cursor, rather than a separate
                // disabled color palette. Without this, confirming with
                // nothing included silently does nothing at all -- the old
                // interactive build screen at least showed "no candidates"
                // for a click or two; the automated build has no such
                // implicit feedback.
                opacity: includedKeys.length === 0 ? 0.3 : 1,
                cursor: includedKeys.length === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              skip
            </button>
          )}
          <button
            onClick={() =>
              onConfirm(roles, showLengthAndShape ? { targetSections, shape } : undefined)
            }
            disabled={includedKeys.length === 0}
            title={includedKeys.length === 0 ? 'include at least one stem first' : undefined}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)',
              // Same disabled convention as above -- see that button's own
              // comment for why this matters more now than it used to.
              opacity: includedKeys.length === 0 ? 0.3 : 1,
              cursor: includedKeys.length === 0 ? 'not-allowed' : 'pointer'
            }}
          >
            continue
          </button>
        </div>
      </div>
    </div>
  )
}
