// src/renderer/src/components/ClusterStemsBrowser.tsx
import { useEffect, useMemo, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { useStemPreviewPlayback } from '../state/useStemPreviewPlayback'
import { stemKey, type BusId } from '@shared/types'
import { useStemFeatureScan } from '../audio/useStemFeatureScan'
import { toFeatureArray, standardizeFeatures } from '@shared/stemFeatures'
import {
  computeMergeSequence,
  cutAtKWithIds,
  splitNode,
  type CutNode
} from '@shared/agglomerativeCluster'
import { clusterProvenance, type BusProvenance } from '@shared/busProvenance'
import {
  emptyBusCentroidStore,
  recordConfirmedStem,
  suggestBus,
  type BusCentroidStore
} from '@shared/busCentroids'
import { stemTileGeometryFromFields } from '../state/selectors'
import { Waveform } from './Waveform'
import { LoadingLoader } from './LoadingLoader'
import { stemColorVar } from '../theme/typeColor'
import type { ProjectRef } from '@shared/types'

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
// state 'confirmed' matches the original boolean `active` meaning exactly
// (this row's own busOf already agrees). 'suggested' is new -- a lighter,
// dashed-border hint for a bus the centroid classifier proposed but the
// user hasn't clicked yet, distinguishable from both "confirmed" and "just
// one of the other four options."
function buttonStyle(state?: 'confirmed' | 'suggested'): React.CSSProperties {
  const confirmed = state === 'confirmed'
  const suggested = state === 'suggested'
  return {
    fontFamily: 'inherit',
    fontSize: 9,
    padding: '3px 8px',
    background: confirmed ? 'var(--ra-stretch-on-bg)' : 'transparent',
    border: `1px ${suggested && !confirmed ? 'dashed' : 'solid'} ${confirmed || suggested ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: confirmed ? 'var(--ra-stretch-on)' : suggested ? 'var(--ra-text)' : 'var(--ra-text-2)',
    fontWeight: confirmed ? 700 : 400,
    cursor: 'pointer',
    outline: 'none'
  }
}

export function ClusterStemsBrowser({
  onClose,
  currentSketch
}: {
  onClose: () => void
  currentSketch: ProjectRef
}): React.JSX.Element {
  const dispatch = useDispatch()
  const rifffs = useAppSelector((s) => s.rifffs)
  const playedBarsOverrides = useAppSelector((s) => s.playedBars)
  const leftCropOverrides = useAppSelector((s) => s.leftCrop)
  const stretchOverrides = useAppSelector((s) => s.stretch)
  const stateBpm = useAppSelector((s) => s.bpm)
  const playing = usePlaying()
  const pos = usePos()

  // previewingKeys/startPreview -- including the mute-snapshot-on-open,
  // the unmount cleanup that restores it, and the async-ordering fix for
  // the 2026-08-22 stale-mute-state bug -- are owned by
  // useStemPreviewPlayback, shared with AutoArrangeRoleStep.tsx's own
  // per-stem preview (built to mirror this modal's mechanism as closely as
  // possible). See that hook's own doc comment for why this is a shared
  // hook rather than two copies of correctness-critical async ordering.
  const { previewingKeys, startPreview } = useStemPreviewPlayback()
  const busOf = useAppSelector((s) => s.busOf)

  // Global, cross-project classifier state (see busCentroids.ts) -- loaded
  // once on mount. Starts empty (every suggestBus() call returns null,
  // i.e. no suggestions at all) until enough real confirmations have
  // trained it, which is the correct cold-start behavior: this modal falls
  // straight back to its original all-DSP-clustering flow rather than ever
  // blocking on the fetch.
  //
  // centroidStore keeps updating live (trainCentroids below writes to it on
  // every real confirm, and persists it for future sessions) but
  // centroidStoreSnapshot is set ONCE, the first time the real store loads,
  // and never again -- `partitioned` below reads suggestions from the
  // frozen snapshot, not the live store. Without this split, confirming
  // ANY bus mid-tidy-up retrains the live store, which can immediately
  // flip an unrelated, already-visible DSP-cluster stem into "suggested"
  // and yank it out of the list the user is actively working through --
  // reported as the suggestion UI feeling "jolting"/like it "took over."
  // Freezing the snapshot means the suggested/DSP split for this session is
  // decided once, at open time, and stays put no matter how much training
  // happens while the user works.
  const [centroidStore, setCentroidStore] = useState<BusCentroidStore>(emptyBusCentroidStore)
  const [centroidStoreSnapshot, setCentroidStoreSnapshot] =
    useState<BusCentroidStore>(emptyBusCentroidStore)
  useEffect(() => {
    void window.rifffApi.getBusCentroids().then((store) => {
      setCentroidStore(store)
      setCentroidStoreSnapshot(store)
    })
  }, [])

  // Restoring the pre-solo mute snapshot and pausing playback now happens
  // automatically via useStemPreviewPlayback's own unmount-cleanup effect,
  // the moment onClose's state flip (App.tsx) unmounts this component --
  // see that hook's own doc comment. This wrapper is kept only because it's
  // already the name the close button and the Escape handler below call.
  function handleClose(): void {
    onClose()
  }

  const stems = useMemo<ClusterableStem[]>(() => {
    const out: ClusterableStem[] = []
    for (const rifff of Object.values(rifffs)) {
      if (rifff.startBar === undefined) continue
      const stretchOn = stretchOverrides[rifff.groupId] ?? true
      for (const stem of rifff.stems) {
        // Mirrors clipGeometryFromFields's own visibleBars/shownBars
        // derivation exactly (selectors.ts's stemTileGeometryFromFields,
        // shared with AutoArrangeRoleStep.tsx's own per-stem thumbnails) --
        // see that function's own doc comment for why skipping the
        // stretch-off tempo scaling here was a real bug, not just a
        // cosmetic approximation.
        const geometry = stemTileGeometryFromFields({
          startBar: rifff.startBar,
          playedBarsOverride: playedBarsOverrides[rifff.groupId],
          leftCropBars: leftCropOverrides[rifff.groupId] ?? 0,
          rifffBarLength: rifff.barLength,
          stretchOn,
          rifffBpm: rifff.bpm,
          stateBpm,
          stemBarLength: stem.barLength
        })
        out.push({
          key: stemKey(rifff.groupId, stem.slot),
          groupId: rifff.groupId,
          slot: stem.slot,
          name: `${rifff.name} - ${stem.name}`,
          path: stem.path,
          tileSpanBars: geometry.tileSpanBars,
          color: stemColorVar(stem),
          startBar: geometry.startBar,
          visibleBars: geometry.visibleBars
        })
      }
    }
    return out
  }, [rifffs, playedBarsOverrides, leftCropOverrides, stretchOverrides, stateBpm])

  const [clusterCount, setClusterCount] = useState(DEFAULT_CLUSTER_COUNT)

  const scanItems = useMemo(() => stems.map((s) => ({ key: s.key, path: s.path })), [stems])
  const { loading, featuresByKey } = useStemFeatureScan(scanItems)

  // Mirrors the old `computed` shape's own two derived pieces exactly --
  // analyzedStems (only the stems that scanned successfully) and
  // rawVectorsByKey (toFeatureArray-flattened, raw/unstandardized, since
  // trainCentroids below needs raw space -- see busCentroids.ts's own doc
  // comment) -- so every downstream consumer needs zero further changes
  // beyond what Step 2 below updates.
  const computed = useMemo(() => {
    if (loading) return null
    const analyzedStems = stems.filter((s) => featuresByKey.has(s.key))
    const rawVectorsByKey = new Map<string, number[]>()
    for (const s of analyzedStems) {
      const features = featuresByKey.get(s.key)
      if (features) rawVectorsByKey.set(s.key, toFeatureArray(features))
    }
    return { analyzedStems, rawVectorsByKey }
  }, [loading, stems, featuresByKey])

  // Splits the analyzed population in two: stems the centroid classifier
  // confidently auto-slots (excluded from DSP clustering entirely, shown
  // instead as their own "suggested" rows below) vs. everything else
  // (already busOf-assigned, or no confident suggestion) which goes
  // through the original DSP clustering exactly as before. Recomputed
  // whenever busOf changes (accepting a suggestion or a DSP row removes
  // that stem from `stems` -- wait, no, it stays placed; busOf just gains
  // an entry, which flips that stem into the "already assigned" bucket on
  // the next pass) or centroidStoreSnapshot changes -- which, deliberately,
  // only happens once per modal session (see centroidStoreSnapshot's own
  // doc comment above for why suggestions read the frozen snapshot rather
  // than the live, continuously-training centroidStore). mergeSequence --
  // the expensive O(n^3) part -- only ever re-runs when the actual DSP
  // population changes, not on every keystroke elsewhere in the modal.
  const partitioned = useMemo(() => {
    if (!computed) return null
    const { analyzedStems, rawVectorsByKey } = computed
    const suggestions = new Map<BusId, ClusterableStem[]>()
    const dspStems: ClusterableStem[] = []
    for (const stem of analyzedStems) {
      if (busOf[stem.key] !== undefined) {
        dspStems.push(stem)
        continue
      }
      const raw = rawVectorsByKey.get(stem.key)
      const suggestedBus = raw ? suggestBus(centroidStoreSnapshot, raw) : null
      if (suggestedBus) {
        const list = suggestions.get(suggestedBus) ?? []
        list.push(stem)
        suggestions.set(suggestedBus, list)
      } else {
        dspStems.push(stem)
      }
    }
    const dspVectors = dspStems.map((s) => rawVectorsByKey.get(s.key)!)
    return {
      suggestions,
      dspStems,
      mergeSequence: computeMergeSequence(standardizeFeatures(dspVectors))
    }
  }, [computed, busOf, centroidStoreSnapshot])

  const suggestedGroups = useMemo<{ busId: BusId; members: ClusterableStem[] }[]>(() => {
    if (!partitioned) return []
    return BUS_IDS.filter((busId) => (partitioned.suggestions.get(busId)?.length ?? 0) > 0).map(
      (busId) => ({ busId, members: partitioned.suggestions.get(busId)! })
    )
  }, [partitioned])

  // Node ids the user has manually split further via a row's own "split"
  // button, layered on TOP of the slider's global cut (see clusters below)
  // rather than replacing it -- refine just the rows that need it without
  // touching any other row's own grouping. Moving the slider naturally
  // supersedes stale entries here: a different k almost never re-produces
  // the same dendrogram node ids, so old split flags just stop matching
  // anything rather than needing an explicit reset.
  const [splitNodeIds, setSplitNodeIds] = useState<Set<number>>(() => new Set())

  const clusters = useMemo<ClusterGroup[]>(() => {
    if (!partitioned) return []
    const { dspStems, mergeSequence } = partitioned
    const baseCut = cutAtKWithIds(
      mergeSequence,
      dspStems.length,
      Math.min(clusterCount, dspStems.length)
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
          ? splitNode(mergeSequence, dspStems.length, node.id)
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
      .map((node) => ({ id: node.id, members: node.members.map((i) => dspStems[i]) }))
      .sort((a, b) => b.members.length - a.members.length)
  }, [partitioned, clusterCount, splitNodeIds])

  // Stored focus index can point past the end once the row list shrinks
  // (slider moved to a lower cluster count) -- clamped inline at every read
  // site below rather than via a syncing effect (which would need a
  // synchronous setState in its body, see the `computed`/loading comment
  // above for why this codebase's linter forbids that pattern).
  const [focusedRow, setFocusedRow] = useState(0)
  const clampedFocusedRow = Math.min(focusedRow, Math.max(0, clusters.length - 1))

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
    void startPreview(new Set(members.map((m) => m.key)), undefined, targetBar)
  }

  // A single thumbnail click/scrub -- targetBar is computed in ClusterRow
  // from the actual click position within the thumbnail, not just the
  // clip's start (see ClusterRow's handlePointerDown below).
  function previewStem(stem: ClusterableStem, targetBar: number): void {
    void startPreview(new Set([stem.key]), stem.groupId, targetBar)
  }

  // Folds every member's own raw feature vector into the centroid store
  // and persists the result -- called from EVERY real confirm (both a
  // suggestion accept and an ordinary DSP-cluster assign), so the
  // classifier keeps learning from all real tidy-up activity, not just
  // from the suggestion flow specifically. A no-op if `computed` hasn't
  // resolved yet (shouldn't happen -- assignCluster is only reachable once
  // rows are already showing, which implies feature extraction finished)
  // or if every member is going to 'aux' (recordConfirmedStem's own no-op,
  // see busCentroids.ts).
  function trainCentroids(members: ClusterableStem[], busId: BusId): void {
    if (!computed) return
    let nextStore = centroidStore
    for (const m of members) {
      const raw = computed.rawVectorsByKey.get(m.key)
      if (raw) nextStore = recordConfirmedStem(nextStore, busId, raw)
    }
    if (nextStore !== centroidStore) {
      setCentroidStore(nextStore)
      void window.rifffApi.saveBusCentroids(nextStore)
    }
  }

  // Forward-captures every member's BusId into the library-wide
  // StemCategories table (design spec §2) -- fire-and-forget, mirrors how
  // trainCentroids above already sits alongside the ASSIGN_STEMS_TO_BUS
  // dispatch rather than blocking on it. Uses each member's own `path`
  // (content-addressed by StemCID for a real library stem -- see
  // stemCategoriesStore.ts's own doc comment); a member whose path doesn't
  // resolve to a real StemCID is silently skipped by the main-process side,
  // not an error here.
  function recordBusCategories(members: ClusterableStem[], busId: BusId): void {
    void window.rifffApi.upsertStemCategoryBus(
      members.map((m) => ({ path: m.path, busId })),
      'tidyup',
      currentSketch
    )
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
    trainCentroids(members, busId)
    recordBusCategories(members, busId)
    setCelebratingRow(rowIndex)
    window.setTimeout(() => {
      setCelebratingRow((current) => (current === rowIndex ? null : current))
    }, 500)
  }

  // Suggested rows live in their own list, separate from the DSP
  // dendrogram's own row indices -- own play-toggle/celebration state
  // rather than reusing playRow/celebratingRow's numeric indices, which
  // would otherwise collide (row 0 of "suggested" isn't row 0 of the DSP
  // clusters below it).
  const [celebratingSuggestedBus, setCelebratingSuggestedBus] = useState<BusId | null>(null)

  function playSuggestedGroup(members: ClusterableStem[]): void {
    const isThisGroupAlreadyPlaying =
      playing &&
      previewingKeys.size === members.length &&
      members.every((m) => previewingKeys.has(m.key))
    if (isThisGroupAlreadyPlaying) {
      dispatch({ type: 'PAUSE' })
      return
    }
    const targetBar = Math.min(...members.map((m) => m.startBar))
    void startPreview(new Set(members.map((m) => m.key)), undefined, targetBar)
  }

  function assignSuggestedGroup(
    suggestedBus: BusId,
    members: ClusterableStem[],
    busId: BusId
  ): void {
    dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
    trainCentroids(members, busId)
    recordBusCategories(members, busId)
    setCelebratingSuggestedBus(suggestedBus)
    window.setTimeout(() => {
      setCelebratingSuggestedBus((current) => (current === suggestedBus ? null : current))
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

        {!loading && suggestedGroups.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, color: 'var(--ra-text-3)', margin: '0 0 6px' }}>
              suggested from past tidy-ups -- click a bus to confirm, or pick a different one
            </p>
            {suggestedGroups.map(({ busId, members }) => (
              <ClusterRow
                key={`suggested-${busId}`}
                members={members}
                focused={false}
                celebrating={celebratingSuggestedBus === busId}
                provenanceOverride="suggested"
                splittable={false}
                suggestedBus={busId}
                onAssign={(assignBusId) => assignSuggestedGroup(busId, members, assignBusId)}
                onPlay={() => playSuggestedGroup(members)}
                onSplit={() => {}}
                onPreviewStem={previewStem}
                previewingKeys={previewingKeys}
                playing={playing}
                pos={pos}
              />
            ))}
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
  celebrating,
  provenanceOverride,
  splittable = true,
  suggestedBus
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
  /** Set explicitly for an auto-slot suggestion row, which has no
   * name/clustering signal of its own for clusterProvenance to infer from
   * -- overrides that inference entirely rather than feeding it a fake
   * members list. */
  provenanceOverride?: BusProvenance
  /** False for a suggestion row -- there's no dendrogram behind it, so
   * "split into closest sub-groups" has nothing to operate on. */
  splittable?: boolean
  /** The centroid classifier's own proposed bus for a suggestion row --
   * drawn with buttonStyle's 'suggested' state until/unless the user
   * clicks a bus (any bus, including this one) to actually confirm it. */
  suggestedBus?: BusId
}): React.JSX.Element {
  const busOf = useAppSelector((s) => s.busOf)
  const provenance = provenanceOverride ?? clusterProvenance(members.map((m) => m.name))

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
          style={{
            ...buttonStyle(rowIsPreviewing && playing ? 'confirmed' : undefined),
            whiteSpace: 'nowrap'
          }}
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
        {members.length > 1 && splittable && (
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
              style={buttonStyle(
                assignedBus === busId
                  ? 'confirmed'
                  : suggestedBus === busId
                    ? 'suggested'
                    : undefined
              )}
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
