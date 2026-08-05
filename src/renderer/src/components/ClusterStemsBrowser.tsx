// src/renderer/src/components/ClusterStemsBrowser.tsx
import { useEffect, useMemo, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import { stemKey, type BusId } from '@shared/types'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { toFeatureArray, standardizeFeatures } from '@shared/stemFeatures'
import { computeMergeSequence, cutAtK, type MergeStep } from '@shared/agglomerativeCluster'
import { clusterProvenance } from '@shared/busProvenance'
import { markManualSeek } from '../state/manualSeek'
import { Waveform } from './Waveform'
import { stemColorVar } from '../theme/typeColor'

const DEFAULT_CLUSTER_COUNT = 8
const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']

interface ClusterableStem {
  key: string
  groupId: string
  slot: number
  name: string
  path: string
  color: string
  /** The bar this stem's own rifff is placed at on the timeline -- what a
   * thumbnail click scrubs the transport to (see handleThumbnailClick on
   * ClusterRow below). Not the stem's own internal offset within its clip,
   * just where that whole clip starts playing. */
  startBar: number
}

// See ProjectLibraryBrowser.tsx's own buttonStyle doc comment -- buttons in
// this app have no default chrome, so every button needs an explicit
// dark-theme style or it falls back to near-invisible default control chrome.
function buttonStyle(active?: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 9,
    padding: '3px 8px',
    background: active ? 'var(--ra-bg-row-active)' : 'transparent',
    border: '1px solid var(--ra-border)',
    color: 'var(--ra-text-2)',
    cursor: 'pointer'
  }
}

export function ClusterStemsBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dispatch = useDispatch()
  const rifffs = useAppSelector((s) => s.rifffs)
  const playing = usePlaying()

  const stems = useMemo<ClusterableStem[]>(() => {
    const out: ClusterableStem[] = []
    for (const rifff of Object.values(rifffs)) {
      if (rifff.startBar === undefined) continue
      for (const stem of rifff.stems) {
        out.push({
          key: stemKey(rifff.groupId, stem.slot),
          groupId: rifff.groupId,
          slot: stem.slot,
          name: `${rifff.name} - ${stem.name}`,
          path: stem.path,
          color: stemColorVar(stem),
          startBar: rifff.startBar
        })
      }
    }
    return out
  }, [rifffs])

  // Bundles the merge sequence together with the exact `stems` array
  // reference it was computed for, in one state slot -- lets `loading` be
  // DERIVED (computed !== null && computed.forStems === stems) instead of
  // tracked as its own separate useState flipped synchronously at the top
  // of the effect below. react-hooks/set-state-in-effect (this codebase's
  // configured linter, see BeatPicker.tsx's/ChannelRow.tsx's own comments
  // on the same rule) flags a setState call that runs synchronously in an
  // effect's setup body; a plain "setLoading(true)" before the async work
  // starts is exactly that. Every setComputed call below happens only
  // after an `await` (inside the async IIFE's continuation, or in its
  // .catch handler), which is not synchronous within the effect body, so
  // this restructuring sidesteps the rule instead of suppressing it.
  const [computed, setComputed] = useState<{
    forStems: ClusterableStem[]
    mergeSequence: MergeStep[]
  } | null>(null)
  const loading = computed === null || computed.forStems !== stems
  const [clusterCount, setClusterCount] = useState(DEFAULT_CLUSTER_COUNT)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rawVectors = await Promise.all(
        stems.map(async (s) => {
          const features = await getStemFeatures(s.path)
          return toFeatureArray(features)
        })
      )
      if (cancelled) return
      const standardized = standardizeFeatures(rawVectors)
      setComputed({ forStems: stems, mergeSequence: computeMergeSequence(standardized) })
    })().catch((err) => {
      if (!cancelled) {
        console.error('ClusterStemsBrowser: feature extraction/clustering failed', err)
        // Empty merge sequence still resolves `loading` to false (see the
        // derivation above) -- cutAtK on an empty merge list just leaves
        // every stem as its own singleton cluster, a reasonable fallback
        // rather than leaving the modal stuck on "analyzing..." forever.
        setComputed({ forStems: stems, mergeSequence: [] })
      }
    })
    return () => {
      cancelled = true
    }
  }, [stems])

  const clusters = useMemo(() => {
    if (!computed || computed.forStems !== stems) return []
    const indexGroups = cutAtK(
      computed.mergeSequence,
      stems.length,
      Math.min(clusterCount, stems.length)
    )
    return indexGroups
      .map((indices) => indices.map((i) => stems[i]))
      .sort((a, b) => b.length - a.length)
  }, [computed, stems, clusterCount])

  // Stored focus index can point past the end once the row list shrinks
  // (slider moved to a lower cluster count) -- clamped inline at every read
  // site below rather than via a syncing effect (which would need a
  // synchronous setState in its body, see the `computed`/loading comment
  // above for why this codebase's linter forbids that pattern).
  const [focusedRow, setFocusedRow] = useState(0)
  const clampedFocusedRow = Math.min(focusedRow, Math.max(0, clusters.length - 1))

  function assignCluster(members: ClusterableStem[], busId: BusId): void {
    for (const member of members) {
      dispatch({ type: 'ASSIGN_TO_BUS', stemKey: member.key, busId })
    }
  }

  // Arrow keys move focus between rows; number keys 1-5 assign the
  // focused row's cluster to the corresponding bus (BUS_IDS[0..4]).
  // Escape closes the modal, matching this app's existing modal-dismiss
  // convention.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedRow((row) => Math.min(clusters.length - 1, row + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedRow((row) => Math.max(0, row - 1))
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key >= '1' && e.key <= '5') {
        const busIndex = Number(e.key) - 1
        const busId = BUS_IDS[busIndex]
        const activeCluster = clusters[clampedFocusedRow]
        if (busId && activeCluster) assignCluster(activeCluster, busId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assignCluster/onClose are stable closures over dispatch/props each render; re-binding every render is unnecessary and would thrash the listener on every keystroke's own state update
  }, [clusters, clampedFocusedRow])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          padding: 10,
          fontSize: 11
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span className="ra-eyebrow">cluster stems</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
              clusters: {clusterCount}
            </span>
            <input
              type="range"
              min={1}
              max={Math.max(1, Math.min(20, stems.length))}
              value={clusterCount}
              onChange={(e) => setClusterCount(Number(e.target.value))}
            />
            <button
              onClick={onClose}
              aria-label="Close cluster stems browser"
              style={buttonStyle()}
            >
              ×
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', padding: 12 }}>
            analyzing {stems.length} stems…
          </div>
        )}

        {!loading && stems.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', padding: 12 }}>
            no stems placed on the timeline yet
          </div>
        )}

        {!loading &&
          clusters.map((members, i) => (
            <ClusterRow
              key={i}
              members={members}
              focused={i === clampedFocusedRow}
              onAssign={(busId) => assignCluster(members, busId)}
              playing={playing}
            />
          ))}
      </div>
    </div>
  )
}

function ClusterRow({
  members,
  onAssign,
  playing,
  focused
}: {
  members: ClusterableStem[]
  onAssign: (busId: BusId) => void
  playing: boolean
  focused: boolean
}): React.JSX.Element {
  const dispatch = useDispatch()
  const busOf = useAppSelector((s) => s.busOf)
  const provenance = clusterProvenance(members.map((m) => m.name))

  // Derived from the REAL store state, not local component state -- so a
  // previously-confirmed assignment still shows as highlighted if the
  // modal is closed and reopened, or if the slider re-partitions clusters
  // and this exact membership recurs. Only shown as "assigned" when EVERY
  // member of this cluster already carries the same busId; a mixed
  // cluster shows no highlight rather than a misleading single answer.
  const assignedBus = useMemo<BusId | null>(() => {
    if (members.length === 0) return null
    const first = busOf[members[0].key]
    if (!first) return null
    const allMatch = members.every((m) => busOf[m.key] === first)
    return allMatch ? first : null
  }, [members, busOf])

  function handleSolo(): void {
    dispatch({ type: 'SOLO_STEMS', stemKeys: members.map((m) => m.key) })
  }

  // Scrubs the transport to this stem's own clip start and plays from
  // there -- same pattern as StemWaveformRow.tsx's own handleRegionMouseDown
  // click-to-scrub branch (SELECT the owning rifff, SET_POS, and if already
  // playing, tell the engine directly + mark the manual seek so the next
  // straggler position tick from the engine doesn't flicker the playhead
  // back for a frame).
  function handleThumbnailClick(stem: ClusterableStem): void {
    dispatch({ type: 'SELECT', groupId: stem.groupId })
    dispatch({ type: 'SET_POS', pos: stem.startBar })
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(stem.startBar)
    }
  }

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--ra-border-soft)',
        borderLeft: focused ? '2px solid var(--ra-border-strong)' : '2px solid transparent',
        paddingLeft: focused ? 10 : 12,
        background: focused ? 'var(--ra-bg-row-sub)' : 'transparent'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--ra-text)', width: 120 }}>cluster</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)', width: 60 }}>
          {members.length} clip{members.length === 1 ? '' : 's'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 90 }}>{provenance}</span>
        <button onClick={handleSolo} style={buttonStyle()}>
          ▶ solo all
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {BUS_IDS.map((busId, i) => (
            <button
              key={busId}
              onClick={() => onAssign(busId)}
              style={buttonStyle(assignedBus === busId)}
              title={`press ${i + 1} while this row is focused`}
            >
              {busId}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 3, overflowX: 'auto' }}>
        {members.slice(0, 8).map((m) => (
          <div
            key={m.key}
            onClick={() => handleThumbnailClick(m)}
            title={`${m.name} — click to scrub + preview`}
            style={{
              width: 64,
              height: 32,
              flexShrink: 0,
              position: 'relative',
              cursor: 'pointer'
            }}
          >
            <Waveform path={m.path} color={m.color} opacity={1} />
          </div>
        ))}
        {members.length > 8 && (
          <div
            style={{
              width: 64,
              height: 32,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              color: 'var(--ra-text-3)'
            }}
          >
            +{members.length - 8} more
          </div>
        )}
      </div>
    </div>
  )
}
