import { useEffect, useMemo, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { usePlacedFlatStems, type FlatStem } from '../state/usePlacedFlatStems'
import { useStemPreviewPlayback } from '../state/useStemPreviewPlayback'
import { stemTileGeometryFromFields, type StemTileGeometry } from '../state/selectors'
import { buildDensityMap, computeDensityScore, densityLabel } from '@shared/stemDensityScore'
import {
  resolveStemRole,
  type ArrangeRole,
  type StemFrequency,
  type StemRoleInfo
} from '@shared/stemRole'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { Waveform } from './Waveform'
import { typeColorVar } from '../theme/typeColor'
import { stemKey } from '@shared/types'
import { playButtonStyle } from './autoArrangeStyles'

interface Props {
  onConfirm: (roles: StemRoleInfo[]) => void
  onCancel: () => void
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

// Display labels for StemFrequency, in this app's lowercase, no-exclamation-
// marks copy voice. Order matches the enum's own low-to-high intent.
const FREQUENCY_OPTIONS: { value: StemFrequency; label: string }[] = [
  { value: 'once', label: 'once' },
  { value: 'occasional', label: 'occasional' },
  { value: 'frequent', label: 'frequent' },
  { value: 'veryFrequent', label: 'very frequent' }
]

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
export function AutoArrangeRoleStep({ onConfirm, onCancel }: Props): React.JSX.Element {
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

  // useEffect (not useMemo) -- this has a real async side effect and needs a
  // real cancellation cleanup on unmount/dep change, which only useEffect's
  // return value actually wires up (see ClusterStemsBrowser.tsx's own
  // load-on-mount effects for the same pattern in this codebase).
  useEffect(() => {
    if (flatStems.length === 0) return
    let cancelled = false
    async function load(): Promise<void> {
      // Role resolution itself is synchronous and can't fail -- resolve it
      // up front for every stem regardless of how feature extraction goes.
      const resolved: StemRoleInfo[] = flatStems.map(({ stem, stemKey: key }) =>
        resolveStemRole(stem, key, busOf[key] ?? null)
      )
      // Promise.allSettled, not Promise.all/a plain await loop -- mirrors
      // ClusterStemsBrowser.tsx's own handling of getStemFeatures, which is
      // documented (stemFeaturesCache.ts) as able to reject on a corrupt/
      // unreadable stem file. Unlike that browser (which excludes a failed
      // stem from clustering entirely), a failed stem here still needs a row
      // in the roles list, so it falls back to density score 0 ('sparse') --
      // the least presumptuous default -- rather than being dropped.
      const results = await Promise.allSettled(
        flatStems.map(({ stem }) => getStemFeatures(stem.path).then(computeDensityScore))
      )
      if (cancelled) return
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.error(
            'AutoArrangeRoleStep: feature extraction failed for stem',
            flatStems[i].stem.path,
            result.reason
          )
        }
      })
      setRoles(resolved)
      // buildDensityMap is keyed to one groupId per call -- build it per
      // owning rifff over the matching slice of `results` (flatStems is built
      // by flatMap over placedRifffs in the same order, so slices line up),
      // then merge. Keeps the shared helper's single-rifff shape intact
      // rather than reshaping it for a multi-rifff caller.
      let cursor = 0
      const densityMap: Record<string, number> = {}
      for (const rifff of placedRifffs) {
        const sliceResults = results.slice(cursor, cursor + rifff.stems.length)
        Object.assign(densityMap, buildDensityMap(rifff.stems, rifff.groupId, sliceResults))
        cursor += rifff.stems.length
      }
      setDensities(densityMap)
    }
    // Promise.allSettled above only guards a getStemFeatures rejection --
    // this outer .catch() is a second, wider net (mirrors
    // ClusterStemsBrowser.tsx:283-288) so anything else unexpected thrown
    // inside load() still lands on a safe fallback state instead of leaving
    // the modal wedged on "analyzing stems..." forever with an unhandled
    // rejection.
    load().catch((err: unknown) => {
      if (!cancelled) {
        console.error('AutoArrangeRoleStep: role/feature load failed', err)
        setRoles([])
        setDensities({})
      }
    })
    return () => {
      cancelled = true
    }
  }, [flatStems, placedRifffs, busOf])

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
                  onChange={(e) =>
                    updateRole(role.stemKey, { arrangeRole: e.target.value as ArrangeRole })
                  }
                  style={selectStyle}
                >
                  {ARRANGE_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <select
                  value={role.frequency}
                  onChange={(e) =>
                    updateRole(role.stemKey, { frequency: e.target.value as StemFrequency })
                  }
                  title="how often this stem should re-enter during the release phase, and its priority relative to other stems"
                  style={selectStyle}
                >
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
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
          <button
            onClick={() => onConfirm(roles)}
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
            continue
          </button>
        </div>
      </div>
    </div>
  )
}
