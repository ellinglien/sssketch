import { useEffect, useState } from 'react'
import { useAppSelector } from '../state/StoreContext'
import { computeDensityScore, densityLabel } from '@shared/stemDensityScore'
import { resolveStemRole, type StemRoleInfo } from '@shared/stemRole'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { stemKey as buildStemKey, type SoundType } from '@shared/types'

interface Props {
  groupId: string
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

/** Shown before an auto-arrangement run to let the user confirm/correct each
 * stem's soundType (and drop stems that shouldn't be arranged at all) before
 * autoArrangeEngine.ts sees them. `uncertain` (from resolveStemRole) flags
 * stems this can't classify with any real signal -- never tidied AND still
 * on the unresolved 'fx' default -- so the user knows which rows are guesses.
 * Styled after TidyUpNudgeModal.tsx's conventions: see docs/design.md. */
export function AutoArrangeRoleStep({ groupId, onConfirm, onCancel }: Props): React.JSX.Element {
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const busOf = useAppSelector((s) => s.busOf)

  const [roles, setRoles] = useState<StemRoleInfo[] | null>(null)
  const [densities, setDensities] = useState<Record<string, number>>({})

  // useEffect (not useMemo) -- this has a real async side effect and needs a
  // real cancellation cleanup on unmount/dep change, which only useEffect's
  // return value actually wires up (see ClusterStemsBrowser.tsx's own
  // load-on-mount effects for the same pattern in this codebase).
  useEffect(() => {
    if (!rifff) return
    const stems = rifff.stems
    let cancelled = false
    async function load(): Promise<void> {
      // Role resolution itself is synchronous and can't fail -- resolve it
      // up front for every stem regardless of how feature extraction goes.
      const resolved: StemRoleInfo[] = stems.map((stem) => {
        const key = buildStemKey(groupId, stem.slot)
        return resolveStemRole(stem, key, busOf[key] ?? null)
      })
      // Promise.allSettled, not Promise.all/a plain await loop -- mirrors
      // ClusterStemsBrowser.tsx's own handling of getStemFeatures, which is
      // documented (stemFeaturesCache.ts) as able to reject on a corrupt/
      // unreadable stem file. Unlike that browser (which excludes a failed
      // stem from clustering entirely), a failed stem here still needs a row
      // in the roles list, so it falls back to density score 0 ('sparse') --
      // the least presumptuous default -- rather than being dropped.
      const results = await Promise.allSettled(
        stems.map((stem) => getStemFeatures(stem.path).then(computeDensityScore))
      )
      if (cancelled) return
      const densityByKey: Record<string, number> = {}
      results.forEach((result, i) => {
        const key = buildStemKey(groupId, stems[i].slot)
        if (result.status === 'fulfilled') {
          densityByKey[key] = result.value
        } else {
          console.error(
            'AutoArrangeRoleStep: feature extraction failed for stem',
            stems[i].path,
            result.reason
          )
          densityByKey[key] = 0
        }
      })
      setRoles(resolved)
      setDensities(densityByKey)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [groupId, rifff, busOf])

  if (!rifff) {
    return <div style={{ padding: 20, color: 'var(--ra-text-2)' }}>no rifff found</div>
  }

  if (!roles) {
    return <div style={{ padding: 20, color: 'var(--ra-text-2)' }}>analyzing stems...</div>
  }

  function updateRole(stemKey: string, patch: Partial<StemRoleInfo>): void {
    setRoles((prev) => prev!.map((r) => (r.stemKey === stemKey ? { ...r, ...patch } : r)))
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
          width: 480,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 12 }}>
          confirm stem roles
        </div>
        {roles.map((role) => (
          <div
            key={role.stemKey}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
              borderBottom: '1px solid var(--ra-border-soft)'
            }}
          >
            <input
              type="checkbox"
              checked={role.included}
              onChange={(e) => updateRole(role.stemKey, { included: e.target.checked })}
            />
            <select
              value={role.soundType}
              onChange={(e) => updateRole(role.stemKey, { soundType: e.target.value as SoundType })}
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
        ))}
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
