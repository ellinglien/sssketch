import { useEffect, useMemo, useState } from 'react'
import { soloStemsMute } from '../state/store'
import {
  useAppSelector,
  useDispatch,
  useFlushEngineSyncNow,
  usePlaying
} from '../state/StoreContext'
import { usePlacedFlatStems, type FlatStem } from '../state/usePlacedFlatStems'
import { buildDensityMap, computeDensityScore, densityLabel } from '@shared/stemDensityScore'
import { resolveStemRole, type StemRoleInfo } from '@shared/stemRole'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { markManualSeek } from '../state/manualSeek'
import type { SoundType } from '@shared/types'

interface Props {
  onConfirm: (roles: StemRoleInfo[]) => void
  onCancel: () => void
}

const SOUND_TYPE_OPTIONS: SoundType[] = [
  'drums',
  'notes',
  'bass',
  'extInst',
  'sampler',
  'fx',
  'extFx',
  'audioIn'
]

// Mirrors ClusterStemsBrowser.tsx's own buttonStyle 'confirmed' state
// exactly -- bright near-white border/text vs. dim gray, reusing
// ChannelRow.tsx's solo-button visual language rather than a background
// swap (this modal's own panel background already reads too close to a
// background-only "active" indicator, same reasoning documented there).
// No 'suggested' state needed here -- this table has no bus-suggestion
// concept, just "is this playing right now."
function playButtonStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 9,
    padding: '3px 8px',
    borderRadius: 0,
    background: active ? 'var(--ra-stretch-on-bg)' : 'transparent',
    border: `1px solid ${active ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: active ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
    outline: 'none',
    whiteSpace: 'nowrap'
  }
}

/** Shown before an auto-arrangement run to let the user confirm/correct each
 * stem's soundType (and drop stems that shouldn't be arranged at all) before
 * autoArrangeEngine.ts sees them. `uncertain` (from resolveStemRole) flags
 * stems this can't classify with any real signal -- never tidied AND still
 * on the unresolved 'fx' default -- so the user knows which rows are guesses.
 * Styled after TidyUpNudgeModal.tsx's conventions: see docs/design.md.
 *
 * Scope: like Tidy Up, this pools stems from EVERY rifff currently placed on
 * the timeline (rifff.startBar !== undefined -- the same sentinel selectors.ts
 * uses throughout, e.g. groupIdAtPosition/loopLengthBars), not one target
 * rifff -- there's no "currently selected rifff" convention in this app for
 * a single-target design to hang off of. */
export function AutoArrangeRoleStep({ onConfirm, onCancel }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const rifffs = useAppSelector((s) => s.rifffs)
  const mute = useAppSelector((s) => s.mute)
  const busOf = useAppSelector((s) => s.busOf)
  const playing = usePlaying()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const { placedRifffs, flatStems, flatStemsByKey } = usePlacedFlatStems()

  const [roles, setRoles] = useState<StemRoleInfo[] | null>(null)
  const [densities, setDensities] = useState<Record<string, number>>({})

  // Snapshot of the REAL mute state as it stood the moment this step
  // mounted -- see ClusterStemsBrowser.tsx's own `muteSnapshot` doc comment
  // for the full rationale (frozen via useState's lazy initializer, which
  // runs exactly once). Restored below on unmount so any SOLO_STEMS
  // preview-auditioning done while confirming roles never leaks into the
  // real arrangement's mute state once the wizard moves on.
  const [muteSnapshot] = useState(() => mute)

  // Which exact stem keys are the current preview target -- mirrors
  // ClusterStemsBrowser.tsx's own `previewingKeys` exactly: the single
  // source of truth for "what's actually audible right now," used to
  // highlight a row (or the play-all control) as currently playing.
  const [previewingKeys, setPreviewingKeys] = useState<Set<string>>(() => new Set())

  // Where each placed rifff's own clip starts on the timeline, keyed by
  // groupId -- this table has no per-stem waveform thumbnail to click/scrub
  // (unlike ClusterStemsBrowser's ClusterRow), so a preview always starts
  // from the owning clip's own start bar rather than an arbitrary click
  // fraction within it.
  const startBarByGroupId = useMemo(() => {
    const map = new Map<string, number>()
    for (const rifff of placedRifffs) {
      if (rifff.startBar !== undefined) map.set(rifff.groupId, rifff.startBar)
    }
    return map
  }, [placedRifffs])

  // Playback started while confirming roles must never keep running once
  // this step is gone -- whether that's the user pressing cancel, or
  // AutoArrangeWizard.tsx advancing straight past this component to the
  // build step on confirm. Both paths unmount AutoArrangeRoleStep (the
  // wizard swaps its `step` state), so a single unmount cleanup here covers
  // both without AutoArrangeWizard needing to know anything about preview
  // playback at all. PAUSE (not STOP) so it stops right where it is rather
  // than rewinding to bar 0, matching ClusterStemsBrowser.tsx's handleClose.
  useEffect(() => {
    return () => {
      dispatch({ type: 'RESTORE_MUTE', mute: muteSnapshot })
      dispatch({ type: 'PAUSE' })
    }
  }, [dispatch, muteSnapshot])

  // Shared by the per-stem and play-all controls below -- see
  // ClusterStemsBrowser.tsx's own startPreview for the full rationale,
  // copied verbatim: solos exactly `keys`, jumps the transport to
  // `targetBar` (seeking the live engine if already playing, or starting
  // playback fresh otherwise), and marks `keys` as the current preview
  // target. Critically, this AWAITS flushEngineSyncNow BEFORE seeking/
  // playing, passing the solo's own mute map as an override rather than
  // dispatching SOLO_STEMS and hoping stateRef catches up in time -- the
  // exact ordering fix for the "I cannot hear the audio [in Tidy Up]"
  // stale-mute-state bug reported 2026-08-22 (see ClusterStemsBrowser.tsx).
  // A clip left muted in the arranger must never bleed into a preview
  // started from here either.
  async function startPreview(
    keys: Set<string>,
    groupIdToSelect: string | undefined,
    targetBar: number
  ): Promise<void> {
    setPreviewingKeys(keys)
    const soloedMute = soloStemsMute(rifffs, mute, [...keys])
    dispatch({ type: 'SOLO_STEMS', stemKeys: [...keys] })
    if (groupIdToSelect) dispatch({ type: 'SELECT', groupId: groupIdToSelect })
    dispatch({ type: 'SET_POS', pos: targetBar })
    await flushEngineSyncNow({ mute: soloedMute })
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(targetBar)
    } else {
      dispatch({ type: 'PLAY' })
    }
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
    void startPreview(new Set([fs.stemKey]), fs.groupId, startBarByGroupId.get(fs.groupId) ?? 0)
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
    const targetBar = Math.min(
      ...includedKeys.map(
        (key) => startBarByGroupId.get(flatStemsByKey.get(key)?.groupId ?? '') ?? 0
      )
    )
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
          width: 480,
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
          return (
            <div
              key={role.stemKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
                borderBottom: '1px solid var(--ra-border-soft)',
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
              <input
                type="checkbox"
                checked={role.included}
                onChange={(e) => updateRole(role.stemKey, { included: e.target.checked })}
              />
              <select
                value={role.soundType}
                onChange={(e) =>
                  updateRole(role.stemKey, { soundType: e.target.value as SoundType })
                }
                style={{
                  height: 22,
                  borderRadius: 0,
                  fontSize: 10,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text)'
                }}
              >
                {SOUND_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
                {densityLabel(densities[role.stemKey] ?? 0)}
              </span>
              {role.uncertain && (
                <span style={{ fontSize: 10, color: 'var(--ra-mute-on)' }}>uncertain</span>
              )}
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
