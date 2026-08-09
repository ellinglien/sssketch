// src/renderer/src/components/ClusterStemsBrowser.tsx
import { useEffect, useMemo, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { stemKey, type BusId } from '@shared/types'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { toFeatureArray, standardizeFeatures } from '@shared/stemFeatures'
import {
  computeMergeSequence,
  cutAtKWithIds,
  splitNode,
  type CutNode,
  type MergeStep
} from '@shared/agglomerativeCluster'
import { clusterProvenance } from '@shared/busProvenance'
import { markManualSeek } from '../state/manualSeek'
import { resolvedPlayedBarsFromFields } from '../state/selectors'
import { Waveform } from './Waveform'
import { LoadingLoader } from './LoadingLoader'
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
  /** How many bars long this clip's own box actually is on the timeline
   * (played length minus left-crop, then tempo-scaled by rifffBpm/stateBpm
   * when stretch is off) -- the exact same "shownBars" this clip renders
   * at in the main timeline (see clipGeometryFromFields in selectors.ts).
   * Used with startBar and the live transport `pos` to compute where a
   * playhead line falls inside this thumbnail, AND as the real seek target
   * when a thumbnail is clicked -- getting this wrong for a stretch-off,
   * off-tempo clip was the root cause of a real reported bug: clicking the
   * loudest part of a waveform would seek to the wrong point, since the
   * click's fraction was being applied against a bar-span that didn't
   * match where that fraction actually falls on the real timeline. */
  visibleBars: number
  /** How many bars ONE tile repetition of this stem's raw source file
   * spans on the timeline (stem.barLength, tempo-scaled the same way as
   * visibleBars above) -- mirrors tileOffsetsPx's own tileWidthPx
   * derivation exactly (selectors.ts). The <Waveform> thumbnail renders
   * that raw source file's own peaks ONCE, edge-to-edge -- it does NOT
   * re-render a phase-shifted, multiply-tiled view the way the main
   * timeline's StemWaveformRow does. So the playhead fraction inside a
   * thumbnail must be "how far into the CURRENT tile repetition are we"
   * (barsIntoClip mod tileSpanBars), not "how far into the whole clip,"
   * or it drifts out of sync with the actual repeating waveform shape the
   * moment a clip's played span covers more than one tile -- a real,
   * reported bug ("the waveform doesn't represent what I'm hearing"). */
  tileSpanBars: number
}

interface ClusterGroup {
  /** The dendrogram node id this row corresponds to (see CutNode in
   * agglomerativeCluster.ts) -- what the per-row "split" button passes to
   * splitNode to break exactly this cluster into its two children,
   * independent of every other row. */
  id: number
  members: ClusterableStem[]
}

// See ProjectLibraryBrowser.tsx's own buttonStyle doc comment -- buttons in
// this app have no default chrome, so every button needs an explicit
// dark-theme style or it falls back to near-invisible default control chrome.
//
// Active state reuses ChannelRow.tsx's own solo-button visual language
// (bright near-white border/text vs. dim gray) rather than a background
// swap -- the modal's own panel background is itself var(--ra-bg-row-active),
// so a background-only "active" indicator was blending straight into the
// panel behind it and reading as not-pressed-at-all. outline:none overrides
// the browser's own default focus ring, which was otherwise visually
// indistinguishable from "this bus is assigned" (see 2026-08-05 screenshot
// report: a plain keyboard-focused, UNassigned "aux" button looked "selected"
// purely from the native focus outline).
function buttonStyle(active?: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 9,
    padding: '3px 8px',
    background: active ? 'var(--ra-stretch-on-bg)' : 'transparent',
    border: `1px solid ${active ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: active ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
    outline: 'none'
  }
}

export function ClusterStemsBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dispatch = useDispatch()
  const rifffs = useAppSelector((s) => s.rifffs)
  const playedBarsOverrides = useAppSelector((s) => s.playedBars)
  const leftCropOverrides = useAppSelector((s) => s.leftCrop)
  const stretchOverrides = useAppSelector((s) => s.stretch)
  const stateBpm = useAppSelector((s) => s.bpm)
  const playing = usePlaying()
  const pos = usePos()

  // Snapshot of the REAL mute state as it was the moment this modal opened.
  // `mute` itself is read fresh every render (it changes as SOLO_STEMS runs
  // while browsing clusters below); `muteSnapshot` is deliberately frozen to
  // whatever `mute` was on the very FIRST render only (useState's lazy
  // initializer runs exactly once) so it stays the pre-solo baseline. On
  // close, handleClose below restores exactly this snapshot, so any
  // SOLO_STEMS preview-auditioning done while the modal was open never
  // leaves a lasting mute change on the real arrangement once you're back
  // playing it normally.
  const mute = useAppSelector((s) => s.mute)
  const [muteSnapshot] = useState(() => mute)

  function handleClose(): void {
    dispatch({ type: 'RESTORE_MUTE', mute: muteSnapshot })
    // Leaving the labelling session should leave the transport silent, not
    // still running whatever cluster was last soloed/previewed -- PAUSE
    // (not STOP) so it just stops where it is, not rewinding to bar 0.
    dispatch({ type: 'PAUSE' })
    onClose()
  }

  const stems = useMemo<ClusterableStem[]>(() => {
    const out: ClusterableStem[] = []
    for (const rifff of Object.values(rifffs)) {
      if (rifff.startBar === undefined) continue
      // Mirrors clipGeometryFromFields's own visibleBars/shownBars derivation
      // exactly (selectors.ts) -- see ClusterableStem.visibleBars's own doc
      // comment for why skipping the stretch-off tempo scaling here was a
      // real bug, not just a cosmetic approximation.
      const playedBars = resolvedPlayedBarsFromFields(
        playedBarsOverrides[rifff.groupId],
        rifff.barLength
      )
      const leftCropBars = leftCropOverrides[rifff.groupId] ?? 0
      const stretchOn = stretchOverrides[rifff.groupId] ?? true
      const tempoScale = stretchOn ? 1 : rifff.bpm / stateBpm
      const rawVisibleBars = playedBars - leftCropBars
      const visibleBars = rawVisibleBars * tempoScale
      for (const stem of rifff.stems) {
        out.push({
          key: stemKey(rifff.groupId, stem.slot),
          groupId: rifff.groupId,
          slot: stem.slot,
          name: `${rifff.name} - ${stem.name}`,
          path: stem.path,
          tileSpanBars: stem.barLength * tempoScale,
          color: stemColorVar(stem),
          startBar: rifff.startBar,
          visibleBars
        })
      }
    }
    return out
  }, [rifffs, playedBarsOverrides, leftCropOverrides, stretchOverrides, stateBpm])

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
    // The subset of `forStems` that successfully extracted features --
    // everything downstream (rawVectors, mergeSequence, and clusters built
    // via cutAtK below) is indexed against THIS array, not `forStems`
    // itself, so a stem dropped for a failed extraction can't desync the
    // index mapping. `forStems` is kept only as the staleness key against
    // the outer `stems` memo (see `loading` below) -- it must stay the
    // exact reference the effect was launched with, not the filtered
    // subset, or a `stems` identity change would never be detected.
    analyzedStems: ClusterableStem[]
    mergeSequence: MergeStep[]
  } | null>(null)
  const loading = computed === null || computed.forStems !== stems
  const [clusterCount, setClusterCount] = useState(DEFAULT_CLUSTER_COUNT)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Promise.allSettled, not Promise.all -- a single stem with a
      // corrupt/unreadable file rejecting shouldn't sink feature
      // extraction for every OTHER stem in the project (Promise.all would
      // reject as a whole the instant any one input rejects). Each
      // rejected stem is logged and excluded from the clustering
      // population entirely, rather than either crashing the modal or
      // substituting a zero vector -- a fake zero-vector data point would
      // corrupt standardizeFeatures' per-dimension mean/stddev for every
      // OTHER stem too.
      const results = await Promise.allSettled(
        stems.map(async (s) => {
          const features = await getStemFeatures(s.path)
          return toFeatureArray(features)
        })
      )
      if (cancelled) return
      const analyzedStems: ClusterableStem[] = []
      const rawVectors: number[][] = []
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          analyzedStems.push(stems[i])
          rawVectors.push(result.value)
        } else {
          console.error(
            'ClusterStemsBrowser: feature extraction failed for stem',
            stems[i].path,
            result.reason
          )
        }
      })
      const standardized = standardizeFeatures(rawVectors)
      setComputed({
        forStems: stems,
        analyzedStems,
        mergeSequence: computeMergeSequence(standardized)
      })
    })().catch((err) => {
      if (!cancelled) {
        console.error('ClusterStemsBrowser: feature extraction/clustering failed', err)
        // Empty merge sequence still resolves `loading` to false (see the
        // derivation above) -- cutAtK on an empty merge list just leaves
        // every stem as its own singleton cluster, a reasonable fallback
        // rather than leaving the modal stuck on "analyzing..." forever.
        setComputed({ forStems: stems, analyzedStems: [], mergeSequence: [] })
      }
    })
    return () => {
      cancelled = true
    }
  }, [stems])

  // Node ids the user has manually split further via a row's own "split"
  // button, layered on TOP of the slider's global cut (see clusters below)
  // rather than replacing it -- refine just the rows that need it without
  // touching any other row's own grouping. Moving the slider naturally
  // supersedes stale entries here: a different k almost never re-produces
  // the same dendrogram node ids, so old split flags just stop matching
  // anything rather than needing an explicit reset.
  const [splitNodeIds, setSplitNodeIds] = useState<Set<number>>(() => new Set())

  const clusters = useMemo<ClusterGroup[]>(() => {
    if (!computed || computed.forStems !== stems) return []
    const { analyzedStems, mergeSequence } = computed
    const baseCut = cutAtKWithIds(
      mergeSequence,
      analyzedStems.length,
      Math.min(clusterCount, analyzedStems.length)
    )

    // Expand any node flagged for a manual split -- repeatedly, since a
    // child produced by one split could itself be flagged for a further
    // split (splitNodeIds can hold ids at multiple dendrogram depths).
    let nodes: CutNode[] = baseCut
    let changed = true
    while (changed) {
      changed = false
      const next: CutNode[] = []
      for (const node of nodes) {
        const children = splitNodeIds.has(node.id)
          ? splitNode(mergeSequence, analyzedStems.length, node.id)
          : null
        if (children) {
          next.push(children[0], children[1])
          changed = true
        } else {
          next.push(node)
        }
      }
      nodes = next
    }

    return nodes
      .map((node) => ({ id: node.id, members: node.members.map((i) => analyzedStems[i]) }))
      .sort((a, b) => b.members.length - a.members.length)
  }, [computed, stems, clusterCount, splitNodeIds])

  // Stored focus index can point past the end once the row list shrinks
  // (slider moved to a lower cluster count) -- clamped inline at every read
  // site below rather than via a syncing effect (which would need a
  // synchronous setState in its body, see the `computed`/loading comment
  // above for why this codebase's linter forbids that pattern).
  const [focusedRow, setFocusedRow] = useState(0)
  const clampedFocusedRow = Math.min(focusedRow, Math.max(0, clusters.length - 1))

  // Which exact stem keys are the current preview target -- the single
  // source of truth for "what's actually audible right now," decoupled
  // from mere bar-range overlap with the transport's own position. A
  // thumbnail only gets to show a playhead line when its OWN key is in
  // this set (see ClusterRow below); previously the playhead was derived
  // purely from "does this clip's bar range contain the current position,"
  // which lit up any OTHER stem's thumbnail whenever the transport simply
  // passed through that clip's bars on the timeline, muted or not.
  const [previewingKeys, setPreviewingKeys] = useState<Set<string>>(() => new Set())

  // Shared by playRow/previewStem below: solos exactly `keys`, jumps the
  // transport to `targetBar` (seeking the live engine if already playing,
  // or starting playback fresh at that bar otherwise), and marks `keys` as
  // the current preview target. Centralizing the seek here -- rather than
  // resuming from wherever the transport already happened to be -- is what
  // makes "what's playing" deterministic: press a button, hear THAT thing,
  // from its own start, every time.
  function startPreview(
    keys: Set<string>,
    groupIdToSelect: string | undefined,
    targetBar: number
  ): void {
    setPreviewingKeys(keys)
    dispatch({ type: 'SOLO_STEMS', stemKeys: [...keys] })
    if (groupIdToSelect) dispatch({ type: 'SELECT', groupId: groupIdToSelect })
    dispatch({ type: 'SET_POS', pos: targetBar })
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(targetBar)
    } else {
      dispatch({ type: 'PLAY' })
    }
  }

  // The row-level "play" button -- seeks to the EARLIEST member's own
  // clip start (not wherever the transport already was) so a cluster
  // spanning many different timeline positions still starts somewhere
  // meaningful and audible immediately.
  function playRow(rowIndex: number, members: ClusterableStem[]): void {
    // Pressing "playing" again on the SAME row it's already showing on
    // stops playback instead of re-triggering it -- a real toggle, not a
    // one-way button. PAUSE (not STOP) so it stops right where it is
    // rather than rewinding to bar 0. Only an EXACT match of the current
    // preview set counts as "this row" -- switching to a different row
    // (or a single thumbnail click elsewhere) is a genuine re-preview, not
    // a toggle-off, matching startPreview's own idempotent-not-toggling
    // design below.
    const isThisRowAlreadyPlaying =
      playing &&
      previewingKeys.size === members.length &&
      members.every((m) => previewingKeys.has(m.key))
    if (isThisRowAlreadyPlaying) {
      dispatch({ type: 'PAUSE' })
      return
    }
    setFocusedRow(rowIndex)
    const targetBar = Math.min(...members.map((m) => m.startBar))
    startPreview(new Set(members.map((m) => m.key)), undefined, targetBar)
  }

  // A single thumbnail click/scrub -- targetBar is computed in ClusterRow
  // from the actual click position within the thumbnail, not just the
  // clip's start (see ClusterRow's handlePointerDown below).
  function previewStem(stem: ClusterableStem, targetBar: number): void {
    startPreview(new Set([stem.key]), stem.groupId, targetBar)
  }

  // Assigning a bus no longer auto-advances/plays the next row -- that
  // read as the UI making a decision FOR you mid-listen. Instead a brief
  // celebratory pulse on the just-assigned row acknowledges the action
  // and invites you to keep going yourself (arrow keys / click "play" on
  // whichever row you want next), matching direct user feedback that the
  // auto-skip felt presumptuous. `celebratingRow` is cleared by its own
  // timeout rather than needing an onAnimationEnd round-trip through
  // ClusterRow.
  const [celebratingRow, setCelebratingRow] = useState<number | null>(null)

  function assignCluster(rowIndex: number, members: ClusterableStem[], busId: BusId): void {
    dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
    setCelebratingRow(rowIndex)
    window.setTimeout(() => {
      setCelebratingRow((current) => (current === rowIndex ? null : current))
    }, 500)
  }

  // Splits one specific row's cluster into its two dendrogram children,
  // on top of whatever the global slider already produced -- see
  // splitNodeIds above. A no-op for an already-singleton row (splitNode
  // returns null; nothing gets added to the set, so nothing re-renders
  // differently).
  function splitCluster(nodeId: number): void {
    setSplitNodeIds((prev) => {
      const next = new Set(prev)
      next.add(nodeId)
      return next
    })
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
        handleClose()
      } else if (e.key >= '1' && e.key <= '5') {
        const busIndex = Number(e.key) - 1
        const busId = BUS_IDS[busIndex]
        const activeCluster = clusters[clampedFocusedRow]
        if (busId && activeCluster) assignCluster(clampedFocusedRow, activeCluster.members, busId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assignCluster/handleClose are stable closures over dispatch/props each render; re-binding every render is unnecessary and would thrash the listener on every keystroke's own state update
  }, [clusters, clampedFocusedRow])

  const sliderMax = Math.max(1, Math.min(20, stems.length))
  const sliderFillPercent = ((clusterCount - 1) / Math.max(1, sliderMax - 1)) * 100

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
      onClick={handleClose}
    >
      {/* One-time keyframes for the row-assignment celebration pulse, plus
          this app's first custom-styled <input type="range"> (a plain
          browser slider was the one control here that didn't look like it
          belonged in sssketch at all) -- plain <style> tag, no CSS-in-JS
          dependency, matching this codebase's inline-style-everywhere
          convention for this component. Sharp corners throughout (no
          border-radius anywhere), per this app's own design system. */}
      <style>{`
        @keyframes cluster-assign-pulse {
          0% { box-shadow: 0 0 0 0 var(--ra-stretch-on); }
          35% { box-shadow: 0 0 0 3px var(--ra-stretch-on); }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .cluster-count-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 120px;
          height: 2px;
          outline: none;
          cursor: pointer;
        }
        .cluster-count-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 10px;
          height: 10px;
          background: var(--ra-stretch-on);
          border: 1px solid var(--ra-stretch-on);
          cursor: pointer;
        }
        .cluster-count-slider::-moz-range-thumb {
          width: 10px;
          height: 10px;
          background: var(--ra-stretch-on);
          border: 1px solid var(--ra-stretch-on);
          border-radius: 0;
          cursor: pointer;
        }
        .cluster-count-slider::-moz-range-track {
          height: 2px;
          background: transparent;
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          padding: 10,
          fontSize: 11
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span className="ra-eyebrow">tidy up</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
              clusters: {clusterCount}
            </span>
            <input
              className="cluster-count-slider"
              type="range"
              min={1}
              max={sliderMax}
              value={clusterCount}
              onChange={(e) => setClusterCount(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, var(--ra-stretch-on) ${sliderFillPercent}%, var(--ra-border) ${sliderFillPercent}%)`
              }}
            />
            <button onClick={handleClose} aria-label="Close tidy up browser" style={buttonStyle()}>
              ×
            </button>
          </div>
        </div>
        <p style={{ fontSize: 10, color: 'var(--ra-text-3)', margin: '0 0 12px' }}>
          group similar-sounding stems, then assign each cluster to a bus below -- exporting to
          ableton packs everything by bus instead of one track per stem.
        </p>

        {loading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 24
            }}
          >
            <LoadingLoader size={48} />
            <span className="ra-eyebrow">analyzing {stems.length} stems…</span>
          </div>
        )}

        {!loading && stems.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', padding: 12 }}>
            no stems placed on the timeline yet
          </div>
        )}

        {!loading &&
          clusters.map(({ id, members }, i) => (
            <ClusterRow
              key={id}
              members={members}
              focused={i === clampedFocusedRow}
              celebrating={i === celebratingRow}
              onAssign={(busId) => assignCluster(i, members, busId)}
              onPlay={() => playRow(i, members)}
              onSplit={() => splitCluster(id)}
              onPreviewStem={previewStem}
              previewingKeys={previewingKeys}
              playing={playing}
              pos={pos}
            />
          ))}
      </div>
    </div>
  )
}

function ClusterRow({
  members,
  onAssign,
  onPlay,
  onSplit,
  onPreviewStem,
  previewingKeys,
  playing,
  pos,
  focused,
  celebrating
}: {
  members: ClusterableStem[]
  onAssign: (busId: BusId) => void
  onPlay: () => void
  onSplit: () => void
  onPreviewStem: (stem: ClusterableStem, targetBar: number) => void
  previewingKeys: Set<string>
  playing: boolean
  pos: number
  focused: boolean
  celebrating: boolean
}): React.JSX.Element {
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

  // True while ANY of this row's own members is the current preview
  // target -- covers both "play" (every member) and a single thumbnail
  // click (just one member) as the same "this row is what's live" signal
  // for the play button's own active styling below.
  const rowIsPreviewing = members.some((m) => previewingKeys.has(m.key))

  // Computes exactly where within ONE TILE REPETITION the click landed,
  // from the click's pixel offset within the 64px-wide thumbnail, and
  // hands it up to the parent's previewStem -- against tileSpanBars, not
  // the whole clip's visibleBars, because the thumbnail only ever renders
  // ONE pass of the stem's raw source file (see tileSpanBars's own doc
  // comment on ClusterableStem for why using the whole clip span here was
  // a real, reported bug: clicking a point in the waveform would seek to
  // a position that didn't correspond to what's actually drawn there).
  // Kept centralized in the parent's previewStem/startPreview (not
  // dispatched directly here) so previewingKeys always has one source of
  // truth.
  function handleThumbnailClick(e: React.MouseEvent<HTMLDivElement>, m: ClusterableStem): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0
    const clampedFraction = Math.max(0, Math.min(1, fraction))
    onPreviewStem(m, m.startBar + clampedFraction * m.tileSpanBars)
  }

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--ra-border-soft)',
        borderLeft: focused ? '2px solid var(--ra-border-strong)' : '2px solid transparent',
        paddingLeft: focused ? 10 : 12,
        background: focused ? 'var(--ra-bg-row-sub)' : 'transparent',
        // Wraps the WHOLE card, not just the thumbnail(s) -- same accent as
        // the per-thumbnail outline below, so "this is what's playing"
        // reads at both the row level and the individual-clip level, not
        // just a small box easy to miss at a glance.
        outline: rowIsPreviewing ? '1px solid var(--ra-stretch-on)' : 'none',
        outlineOffset: -1,
        animation: celebrating ? 'cluster-assign-pulse 500ms ease-out' : undefined
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <button
          onClick={onPlay}
          style={{ ...buttonStyle(rowIsPreviewing && playing), whiteSpace: 'nowrap' }}
          title="solo + play this whole cluster, from its own earliest clip"
        >
          {rowIsPreviewing && playing ? '■ playing' : '▶ play'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)', width: 60 }}>
          {members.length} clip{members.length === 1 ? '' : 's'}
        </span>
        {/* "clustered" is the expected/default case for any real
            multi-member row -- repeating it on every single row is just
            noise (same complaint as the removed per-row "cluster" label).
            Only worth showing when it's actually informative: a singleton
            row whose provenance came from somewhere other than real
            clustering. */}
        {provenance !== 'clustered' && (
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 90 }}>{provenance}</span>
        )}
        {members.length > 1 && (
          <button
            onClick={onSplit}
            style={{ ...buttonStyle(), whiteSpace: 'nowrap' }}
            title="split this cluster into its two closest sub-groups"
          >
            split
          </button>
        )}
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
        {members.slice(0, 8).map((m) => {
          const isPreviewTarget = previewingKeys.has(m.key)
          // showPlayhead's bounds check uses the whole clip's real
          // on-timeline span (visibleBars) -- only draw a line while the
          // transport is genuinely somewhere inside this clip at all.
          // playheadFraction's OWN position, though, is "how far into the
          // CURRENT tile repetition" (barsIntoClip mod tileSpanBars), to
          // match what <Waveform> actually renders (one pass of the raw
          // source file, not the whole tiled clip) -- see tileSpanBars's
          // doc comment on ClusterableStem.
          const barsIntoClip = pos - m.startBar
          const withinClip = m.visibleBars > 0 && barsIntoClip >= 0 && barsIntoClip < m.visibleBars
          const barsIntoTile =
            m.tileSpanBars > 0
              ? ((barsIntoClip % m.tileSpanBars) + m.tileSpanBars) % m.tileSpanBars
              : 0
          const playheadFraction = m.tileSpanBars > 0 ? barsIntoTile / m.tileSpanBars : 0
          const showPlayhead = isPreviewTarget && playing && withinClip
          return (
            <div
              key={m.key}
              onClick={(e) => handleThumbnailClick(e, m)}
              title={`${m.name} — click to preview from this point`}
              style={{
                width: 64,
                height: 32,
                flexShrink: 0,
                position: 'relative',
                cursor: 'pointer',
                outline: isPreviewTarget ? '1px solid var(--ra-stretch-on)' : 'none',
                outlineOffset: -1
              }}
            >
              <Waveform path={m.path} color={m.color} opacity={1} />
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
          )
        })}
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
