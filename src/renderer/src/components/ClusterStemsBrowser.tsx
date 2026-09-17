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
  emptyCategoryCentroidStore,
  suggestCategory,
  type CategoryCentroidStore
} from '@shared/categoryCentroids'
import {
  ARRANGE_ROLE_OPTIONS,
  ARRANGE_ROLE_TO_BUS,
  DRUM_SUB_ROLE_OPTIONS,
  DRUM_SUB_ROLE_LABELS,
  type ArrangeRole,
  type DrumSubRole
} from '@shared/stemRole'
import { stemTileGeometryFromFields } from '../state/selectors'
import { Waveform } from './Waveform'
import { LoadingLoader } from './LoadingLoader'
import { stemColorVar } from '../theme/typeColor'
import type { ProjectRef } from '@shared/types'
import { useCachedStemEmbeddings } from '../audio/useCachedStemEmbeddings'
import { suggestCategoryFromEmbedding, type ConfirmedEmbedding } from '@shared/embeddingMatch'
import { guessArrangeRoleFromPresetName } from '@shared/presetNames'

const DEFAULT_CLUSTER_COUNT = 8
const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']

// Shared across every unsplit suggested group so `.get(busId) ?? EMPTY_NODE_ID_SET`
// doesn't allocate a fresh empty Set on every render.
const EMPTY_NODE_ID_SET: ReadonlySet<number> = new Set()

/** Lazily splits a flat, non-dendrogram group (a "suggested" row's own
 * members -- there's no real clustering behind it until this is actually
 * called) into however many rows `splitNodeIds` has flagged, via the same
 * agglomerativeCluster.ts primitives (computeMergeSequence/cutAtKWithIds/
 * splitNode) the real DSP `clusters` useMemo below already uses -- computes
 * a fresh local dendrogram over just THESE members every call rather than
 * sharing the DSP population's own mergeSequence, since a suggested
 * group's membership has nothing to do with which stems the DSP side is
 * clustering (2026-09-15, direct request: "real split, on demand" for
 * suggested rows). `members.length <= 1` short-circuits (nothing to
 * cluster) as does an unsplit group (no ids flagged yet, the common case)
 * -- both return the whole group as a single row, matching a plain
 * suggested row's original shape exactly when nothing's been split. */
function expandFlatGroupIntoRows(
  members: ClusterableStem[],
  rawVectorsByKey: Map<string, number[]>,
  splitNodeIds: ReadonlySet<number>
): { nodeId: number; members: ClusterableStem[] }[] {
  if (members.length <= 1 || splitNodeIds.size === 0) {
    return [{ nodeId: -1, members }]
  }
  const vectors = members.map((m) => rawVectorsByKey.get(m.key)!)
  const mergeSequence = computeMergeSequence(standardizeFeatures(vectors))
  let nodes: CutNode[] = cutAtKWithIds(mergeSequence, members.length, 1)
  let changed = true
  while (changed) {
    changed = false
    const next: CutNode[] = []
    for (const node of nodes) {
      const children = splitNodeIds.has(node.id)
        ? splitNode(mergeSequence, members.length, node.id)
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
  return nodes.map((node) => ({ nodeId: node.id, members: node.members.map((i) => members[i]) }))
}

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
  /** The stem's own raw Endlesss preset/type name (Stem.name), NOT this
   * interface's own `name` above (which is a "rifff - stem" DISPLAY string
   * for the UI) -- guessArrangeRoleFromPresetName below needs the real,
   * unprefixed name to match against its lookup table. Added 2026-09-15,
   * closing a real gap: AutoArrangeRoleStep.tsx's own suggestions already
   * consult this via resolveStemRole, but Tidy Up's never did, which is
   * why Arrange mode's suggestions felt meaningfully better -- reported
   * directly by Elling ("arrange mode is much better at guessing
   * currently... tidy up doesn't seem to be using it at all"). */
  presetName: string
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
// panel behind it and reading as not-pressed-at-all.
//
// No outline:none override here (there used to be one -- see 2026-08-05
// screenshot report: a plain keyboard-focused, UNassigned "aux" button
// looked "selected" purely from the BROWSER'S OWN default focus ring,
// which was bright/bold enough to be confusable with the "confirmed"
// active state's own bright near-white border). The app-wide focus rule
// (global.css, added for the 2026-09-16 unified UI consistency pass) uses
// a deliberately dim, muted outline (var(--ra-border-strong)) instead of
// the browser default -- distinct enough from the bright "confirmed"
// border that the original confusability shouldn't reproduce, while still
// giving every button in this file a real focus indicator (which, with
// outline:none, none of them had at all).
//
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
    padding: 'var(--ra-s-0) 8px',
    background: confirmed ? 'var(--ra-stretch-on-bg)' : 'transparent',
    border: `1px ${suggested && !confirmed ? 'dashed' : 'solid'} ${confirmed || suggested ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: confirmed ? 'var(--ra-stretch-on)' : suggested ? 'var(--ra-text)' : 'var(--ra-text-2)',
    fontWeight: confirmed ? 700 : 400,
    cursor: 'pointer'
  }
}

// Hand-drawn SVG glyph -- no icon library, same convention as
// DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/LockGlyph etc. Direct
// request, 2026-09-16: replace the "split" text button.
function ForkIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2 V7" />
      <path d="M8 7 L3.5 13" />
      <path d="M8 7 L12.5 13" />
    </svg>
  )
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

  // Frozen the moment this component mounts (useState's lazy initializer
  // runs exactly once, and busOf is already-available store state, not an
  // async fetch -- no separate mount-effect needed, unlike
  // centroidStoreSnapshot below). `partitioned` reads THIS, not live busOf,
  // to decide which row/section a stem belongs to (2026-09-15, real bug
  // reported twice during Elling's own live testing: first as rows "jumping
  // to another location" when confirming one, then -- after an earlier fix
  // attempt moved confirmed stems into their own separate section -- as
  // "confirmed suggested stems relocate when they're approved... they
  // should stay where they are"). A stem's row placement (which suggested
  // group, or the DSP cluster it landed in) is decided once, from whatever
  // busOf looked like the moment Tidy Up opened, and never moves again for
  // the rest of this session -- confirming a bus only ever changes that
  // row's OWN button highlighting (ClusterRow's `assignedBus`, which reads
  // live busOf independently), never which row it's in.
  const [busOfSnapshot] = useState(() => busOf)

  // Global, cross-project classifier state (see categoryCentroids.ts) --
  // loaded once on mount. Starts empty (every suggestCategory() call returns
  // null, i.e. no suggestions at all) until enough real confirmations have
  // trained it server-side, which is the correct cold-start behavior: this
  // modal falls straight back to its original all-DSP-clustering flow
  // rather than ever blocking on the fetch.
  //
  // Frozen the first time the real store loads, never again -- `partitioned`
  // below reads suggestions from this frozen snapshot, not a live,
  // continuously-retraining store (training itself is now entirely
  // server-side, see categoryCentroidTraining.ts, triggered by the
  // upsert-stem-category-bus IPC handler that recordBusCategories below
  // calls). Without freezing this snapshot, confirming ANY bus mid-tidy-up
  // would retrain the suggestion set shown here, which can immediately flip
  // an unrelated, already-visible DSP-cluster stem into "suggested" and yank
  // it out of the list the user is actively working through -- reported as
  // the suggestion UI feeling "jolting"/like it "took over." Freezing the
  // snapshot means the suggested/DSP split for this session is decided
  // once, at open time, and stays put no matter how much training happens
  // server-side while the user works.
  const [centroidStoreSnapshot, setCentroidStoreSnapshot] = useState<CategoryCentroidStore>(
    emptyCategoryCentroidStore
  )
  useEffect(() => {
    void window.rifffApi.getCategoryCentroids().then(setCentroidStoreSnapshot)
  }, [])

  // Same frozen-once-per-mount pattern as centroidStoreSnapshot above --
  // confirmed bus-axis embeddings, fetched once and read by `partitioned`
  // below via suggestCategoryFromEmbedding, which ranks above the centroid
  // classifier when confident.
  const [confirmedBusEmbeddings, setConfirmedBusEmbeddings] = useState<ConfirmedEmbedding[]>([])
  useEffect(() => {
    void window.rifffApi.getConfirmedEmbeddings('bus').then(setConfirmedBusEmbeddings)
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
          presetName: stem.name,
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
  const embeddingByKey = useCachedStemEmbeddings(scanItems)

  // Mirrors the old `computed` shape's own two derived pieces exactly --
  // analyzedStems (only the stems that scanned successfully) and
  // rawVectorsByKey (toFeatureArray-flattened, raw/unstandardized, since
  // suggestCategory below needs raw space -- see categoryCentroids.ts's own
  // doc comment) -- so every downstream consumer needs zero further changes
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

  // Splits the analyzed population in two: stems that get a confident
  // auto-slot suggestion (excluded from DSP clustering entirely, shown
  // instead as their own "suggested" rows below) vs. everything else
  // (already assigned per busOfSnapshot, or no confident suggestion) which
  // goes through the original DSP clustering exactly as before. Reads
  // busOfSnapshot, NOT live busOf -- deliberately does NOT react to a
  // confirmation made during this session (2026-09-15, real bug reported
  // twice during Elling's own live testing: first as rows "jumping to
  // another location" when confirming one -- because busOf changing
  // retriggered the DSP dendrogram over a population that still included
  // the just-confirmed stem, reshuffling every OTHER row's own membership
  // -- then, after an earlier fix attempt moved confirmed stems into their
  // own separate section instead, as "confirmed suggested stems relocate
  // when they're approved... they should stay where they are". A stem's
  // row placement is decided ONCE, from whatever busOfSnapshot captured at
  // mount, and never recomputed from confirmations made in this session --
  // a row's own "confirmed" highlighting still updates live and correctly,
  // since ClusterRow's `assignedBus` reads live busOf independently of
  // this partitioning decision.
  //
  // A suggestion prefers an embedding-nearest-neighbor match
  // (suggestCategoryFromEmbedding, confirmedBusEmbeddings) when this stem's
  // embedding has been extracted and one is confident, falling back to the
  // centroid classifier (suggestCategory, centroidStoreSnapshot) otherwise
  // -- same embedding-preferred, centroid-fallback shape as
  // roleEmbeddingRefinement.ts's own refineRoleWithEmbeddingOrCentroidSuggestion.
  // centroidStoreSnapshot/confirmedBusEmbeddings are themselves frozen once
  // per modal session for the exact same "don't jolt the user mid-session"
  // reason busOfSnapshot now is (see centroidStoreSnapshot's own doc
  // comment above). mergeSequence -- the expensive O(n^3) part -- only ever
  // re-runs when the actual DSP population changes, not on every keystroke
  // elsewhere in the modal.
  const partitioned = useMemo(() => {
    if (!computed) return null
    const { analyzedStems, rawVectorsByKey } = computed
    const suggestions = new Map<BusId, ClusterableStem[]>()
    const dspStems: ClusterableStem[] = []
    for (const stem of analyzedStems) {
      if (busOfSnapshot[stem.key] !== undefined) {
        dspStems.push(stem)
        continue
      }
      const raw = rawVectorsByKey.get(stem.key)
      const embedding = embeddingByKey.get(stem.key)
      const embeddingSuggestedBus = embedding
        ? (suggestCategoryFromEmbedding(confirmedBusEmbeddings, embedding) as BusId | null)
        : null
      const centroidSuggestedBus = raw
        ? (suggestCategory(centroidStoreSnapshot, 'bus', raw) as BusId | null)
        : null
      // Falls back to a real Endlesss preset-name match (same
      // guessArrangeRoleFromPresetName lookup resolveStemRole.ts's own
      // priority chain already uses for AutoArrangeRoleStep.tsx) when
      // neither the embedding nor the centroid classifier has anything --
      // added 2026-09-15, closing a real gap reported directly by Elling:
      // Arrange mode's suggestions felt meaningfully better than Tidy Up's
      // because AutoArrangeRoleStep.tsx already consulted preset names via
      // resolveStemRole, while this suggestion path never did. Mapped from
      // ArrangeRole to BusId via ARRANGE_ROLE_TO_BUS -- same mapping
      // assignCluster/assignSuggestedGroup already use for the picker's
      // own 8 buttons.
      const presetGuess = guessArrangeRoleFromPresetName(stem.presetName)
      const presetSuggestedBus = presetGuess ? ARRANGE_ROLE_TO_BUS[presetGuess.arrangeRole] : null
      const suggestedBus = embeddingSuggestedBus ?? centroidSuggestedBus ?? presetSuggestedBus
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
      rawVectorsByKey,
      mergeSequence: computeMergeSequence(standardizeFeatures(dspVectors))
    }
  }, [computed, busOfSnapshot, centroidStoreSnapshot, embeddingByKey, confirmedBusEmbeddings])

  // Node ids the user has manually split a SUGGESTED group further into,
  // keyed by that group's own bus -- same idea as splitNodeIds below (for
  // real DSP-cluster rows), but scoped per suggested-group since a
  // suggested row has no dendrogram of its own until split is actually
  // clicked (2026-09-15, direct request: "real split, on demand" for
  // suggested rows, which previously had no split button at all -- see
  // expandFlatGroupIntoRows below).
  const [suggestedSplitNodeIds, setSuggestedSplitNodeIds] = useState<Map<BusId, Set<number>>>(
    () => new Map()
  )

  function splitSuggestedGroup(busId: BusId, nodeId: number): void {
    setSuggestedSplitNodeIds((prev) => {
      const next = new Map(prev)
      const nodeIds = new Set(next.get(busId) ?? [])
      nodeIds.add(nodeId)
      next.set(busId, nodeIds)
      return next
    })
  }

  const suggestedGroups = useMemo<
    { busId: BusId; nodeId: number; members: ClusterableStem[] }[]
  >(() => {
    if (!partitioned) return []
    const out: { busId: BusId; nodeId: number; members: ClusterableStem[] }[] = []
    for (const busId of BUS_IDS) {
      const members = partitioned.suggestions.get(busId)
      if (!members || members.length === 0) continue
      const splitIds = suggestedSplitNodeIds.get(busId) ?? EMPTY_NODE_ID_SET
      for (const sub of expandFlatGroupIntoRows(members, partitioned.rawVectorsByKey, splitIds)) {
        out.push({ busId, nodeId: sub.nodeId, members: sub.members })
      }
    }
    return out
  }, [partitioned, suggestedSplitNodeIds])

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

  // Forward-captures every member's BusId into the library-wide
  // StemCategories table (design spec §2) -- fire-and-forget, sits alongside
  // the ASSIGN_STEMS_TO_BUS dispatch rather than blocking on it. This call
  // is also what triggers server-side centroid training (see
  // categoryCentroidTraining.ts, wired into the upsert-stem-category-bus IPC
  // handler) -- there is no client-side training left to mirror. Uses each
  // member's own `path` (content-addressed by StemCID for a real library
  // stem -- see stemCategoriesStore.ts's own doc comment); a member whose
  // path doesn't resolve to a real StemCID is silently skipped by the
  // main-process side, not an error here.
  function recordBusCategories(members: ClusterableStem[], busId: BusId): void {
    void window.rifffApi.upsertStemCategoryBus(
      members.map((m) => ({ path: m.path, busId })),
      'tidyup',
      currentSketch
    )
  }

  // The ArrangeRole equivalent of recordBusCategories above, added
  // 2026-09-14 (direct request) alongside the 8-category picker below --
  // every Tidy Up assignment now trains BOTH the bus and arrangeRole/
  // drumSubRole centroid classifiers, not just AutoArrangeWizard/
  // DrawArrangeWizard's own role-confirmation step (see
  // categoryCentroidTraining.ts's trainCentroidsFromRoleEntries, wired into
  // the SAME upsert-stem-category-role IPC handler this calls into) --
  // Tidy Up is used far more often than the auto-arrange role step, so this
  // is a real accuracy win with no extra clicks for the 5 shared
  // categories, where arrangeRole is always fully determined by the bus
  // just assigned. Fire-and-forget, matching recordBusCategories exactly;
  // a member whose path doesn't resolve to a real StemCID is silently
  // skipped by the main-process side, not an error here.
  function recordRoleCategories(
    members: ClusterableStem[],
    arrangeRole: ArrangeRole,
    drumSubRole?: DrumSubRole
  ): void {
    void window.rifffApi.upsertStemCategoryRole(
      members.map((m) => ({ path: m.path, arrangeRole, drumSubRole })),
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

  // `category` is one of ARRANGE_ROLE_OPTIONS' 8 values, not just a BusId --
  // the 3 without a bus of their own (textureFx/fill/vocal) route to 'aux'
  // (see ARRANGE_ROLE_TO_BUS's own doc comment, shared/stemRole.ts) while
  // still recording the finer category via recordRoleCategories. For the 5
  // shared categories this is unchanged from before except for also now
  // calling recordRoleCategories (see its own doc comment above).
  function assignCluster(
    rowIndex: number,
    members: ClusterableStem[],
    category: ArrangeRole
  ): void {
    const busId = ARRANGE_ROLE_TO_BUS[category]
    dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
    recordBusCategories(members, busId)
    recordRoleCategories(members, category)
    setCelebratingRow(rowIndex)
    window.setTimeout(() => {
      setCelebratingRow((current) => (current === rowIndex ? null : current))
    }, 500)
  }

  // Refines an already-'drums'-assigned row to a specific kit piece --
  // never changes busId (already 'drums', assigned via assignCluster
  // above) or re-dispatches ASSIGN_STEMS_TO_BUS, just records the finer
  // drumSubRole. Two thin wrappers below (one per celebration scheme, DSP
  // row index vs. suggested-row busId -- same split as assignCluster vs.
  // assignSuggestedGroup) share this celebration-free core.
  function assignDrumSubRole(members: ClusterableStem[], drumSubRole: DrumSubRole): void {
    recordRoleCategories(members, 'drums', drumSubRole)
  }

  function assignDrumSubRoleForRow(
    rowIndex: number,
    members: ClusterableStem[],
    drumSubRole: DrumSubRole
  ): void {
    assignDrumSubRole(members, drumSubRole)
    setCelebratingRow(rowIndex)
    window.setTimeout(() => {
      setCelebratingRow((current) => (current === rowIndex ? null : current))
    }, 500)
  }

  function assignDrumSubRoleForSuggestedGroup(
    busId: BusId,
    nodeId: number,
    members: ClusterableStem[],
    drumSubRole: DrumSubRole
  ): void {
    assignDrumSubRole(members, drumSubRole)
    const target = { busId, nodeId }
    setCelebratingSuggested(target)
    window.setTimeout(() => {
      setCelebratingSuggested((current) =>
        current?.busId === target.busId && current.nodeId === target.nodeId ? null : current
      )
    }, 500)
  }

  // Suggested rows live in their own list, separate from the DSP
  // dendrogram's own row indices -- own play-toggle/celebration state
  // rather than reusing playRow/celebratingRow's numeric indices, which
  // would otherwise collide (row 0 of "suggested" isn't row 0 of the DSP
  // clusters below it). Keyed by {busId, nodeId} rather than busId alone
  // (2026-09-15) -- now that a suggested group can be split into several
  // rows sharing the same busId (see expandFlatGroupIntoRows), busId alone
  // could no longer identify a single row.
  const [celebratingSuggested, setCelebratingSuggested] = useState<{
    busId: BusId
    nodeId: number
  } | null>(null)

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
    nodeId: number,
    members: ClusterableStem[],
    category: ArrangeRole
  ): void {
    const busId = ARRANGE_ROLE_TO_BUS[category]
    dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
    recordBusCategories(members, busId)
    recordRoleCategories(members, category)
    const target = { busId: suggestedBus, nodeId }
    setCelebratingSuggested(target)
    window.setTimeout(() => {
      setCelebratingSuggested((current) =>
        current?.busId === target.busId && current.nodeId === target.nodeId ? null : current
      )
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

  // Arrow keys move focus between rows; number keys 1-8 assign the focused
  // row's cluster to the corresponding category (ARRANGE_ROLE_OPTIONS[0..7],
  // extended from the original 1-5/BUS_IDS[0..4] range when the picker grew
  // to 8 categories, 2026-09-14). Escape closes the modal, matching this
  // app's existing modal-dismiss convention.
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
      } else if (e.key >= '1' && e.key <= '8') {
        const categoryIndex = Number(e.key) - 1
        const category = ARRANGE_ROLE_OPTIONS[categoryIndex]
        const activeCluster = clusters[clampedFocusedRow]
        if (category && activeCluster) {
          assignCluster(clampedFocusedRow, activeCluster.members, category)
        }
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
          // Widened from 640 (2026-09-14, direct request) -- the 8-category
          // picker (up from the original 5 buses) was wrapping to 2 lines
          // on most rows, and this gives most of them room to fit on one.
          width: 860,
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
            {suggestedGroups.map(({ busId, nodeId, members }) => (
              <ClusterRow
                key={`suggested-${busId}-${nodeId}`}
                members={members}
                focused={false}
                celebrating={
                  celebratingSuggested?.busId === busId && celebratingSuggested.nodeId === nodeId
                }
                provenanceOverride="suggested"
                suggestedBus={busId}
                onAssign={(category) => assignSuggestedGroup(busId, nodeId, members, category)}
                onAssignDrumSubRole={(drumSubRole) =>
                  assignDrumSubRoleForSuggestedGroup(busId, nodeId, members, drumSubRole)
                }
                onPlay={() => playSuggestedGroup(members)}
                onSplit={() => splitSuggestedGroup(busId, nodeId)}
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
              onAssign={(category) => assignCluster(i, members, category)}
              onAssignDrumSubRole={(drumSubRole) =>
                assignDrumSubRoleForRow(i, members, drumSubRole)
              }
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
  onAssignDrumSubRole,
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
  /** One of ARRANGE_ROLE_OPTIONS' 8 values -- see ARRANGE_ROLE_TO_BUS's own
   * doc comment (shared/stemRole.ts) for how the 3 without a real bus
   * (textureFx/fill/vocal) still resolve to a concrete BusId assignment. */
  onAssign: (category: ArrangeRole) => void
  /** Only ever fires for 'kick'/'snare'/'hihat'/'clap'/'perc' -- write-only,
   * same as onAssign for the 3 bus-less categories: there's no persisted
   * signal to derive "which sub-role is currently assigned" from (busOf
   * only tracks BusId), so the select below always starts back at "drums
   * (generic)" rather than remembering a prior pick across reopens. */
  onAssignDrumSubRole: (drumSubRole: DrumSubRole) => void
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
          aria-label={rowIsPreviewing && playing ? 'stop cluster' : 'play cluster'}
          style={{
            ...buttonStyle(rowIsPreviewing && playing ? 'confirmed' : undefined),
            whiteSpace: 'nowrap'
          }}
          title="solo + play this whole cluster, from its own earliest clip"
        >
          {rowIsPreviewing && playing ? '■' : '▶'}
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
            aria-label="split cluster"
            style={{ ...buttonStyle(), whiteSpace: 'nowrap' }}
            title="split this cluster into its two closest sub-groups"
          >
            <ForkIcon />
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ARRANGE_ROLE_OPTIONS.map((category, i) => (
            <button
              key={category}
              onClick={() => onAssign(category)}
              style={buttonStyle(
                assignedBus === ARRANGE_ROLE_TO_BUS[category]
                  ? 'confirmed'
                  : suggestedBus === category
                    ? 'suggested'
                    : undefined
              )}
              title={`press ${i + 1} while this row is focused${
                category === 'textureFx' || category === 'fill' || category === 'vocal'
                  ? ' -- routes to the aux bus, tagged as ' + category
                  : ''
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
      {/* Only meaningful once this row is drums-assigned (any of: the DRUMS
          button above, or a past confirmation -- both land on busId
          'drums') -- see onAssignDrumSubRole's own doc comment above for why
          this is write-only and always starts back at "drums (generic)"
          rather than remembering a prior pick. */}
      {assignedBus === 'drums' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>kit piece</span>
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value
              if (value) onAssignDrumSubRole(value as DrumSubRole)
            }}
            title="optionally refine which drum kit piece this is -- helps treat different drum stems as genuinely different roles"
            style={{
              height: 20,
              borderRadius: 0,
              fontSize: 9,
              border: '1px solid var(--ra-border)',
              background: 'transparent',
              color: 'var(--ra-text-2)'
            }}
          >
            <option value="">drums (generic)</option>
            {DRUM_SUB_ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {DRUM_SUB_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 3, overflowX: 'auto', marginTop: 6 }}>
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
