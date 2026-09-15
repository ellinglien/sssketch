import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  RiffLibraryJam,
  RiffLibraryResolvedRiff,
  RiffLibraryRiffSummary,
  RiffFilters
} from '@shared/riffLibraryTypes'
import {
  instrumentMaskToSoundType,
  RIFF_LIBRARY_USERNAME,
  RIFF_LIBRARY_ROOT_NAMES,
  RIFF_LIBRARY_SCALE_NAMES
} from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { sqrtGain } from '@shared/mixGain'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { classifyStems } from '../audio/classifyStems'
import { buildImportedRifff } from '../audio/importResolvedRiff'
import {
  usePlaying,
  useDispatch,
  useAppState,
  useRiffFavourites,
  useRiffFavouritesActions
} from '../state/StoreContext'
import { useBusy } from '../state/BusyContext'
import { formatBpm } from '@shared/format'
import { bytesLabel } from '@shared/visuals'
import { stemKey, type Rifff } from '@shared/types'
import type { ProjectRef } from '@shared/types'
import { EndlesssLoginPanel } from './EndlesssLoginPanel'
import { RiffCircle } from './RiffCircle'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { LoadingLoader } from './LoadingLoader'
import { ContextMenu } from './ContextMenu'
import { DiscoverPanel, type DiscoverSlot } from './DiscoverPanel'

// Persisted locally (not in project files or app state) since it's a
// per-person identity setting, not something that travels with a project —
// each tester on their own machine sets their own username once here and
// it sticks across sessions, rather than being baked into the app.
const RIFF_LIBRARY_USERNAME_STORAGE_KEY = 'sssketch:riffLibraryUsername'
// Pre-rename key -- see docs/superpowers/specs/
// 2026-08-14-riff-library-rename-design.md §3. Only ever read once, by
// loadStoredRiffLibraryUsername's own one-time carry-forward below; never
// written again after this app version ships.
const LEGACY_LORE_USERNAME_STORAGE_KEY = 'sssketch:loreUsername'

function loadStoredRiffLibraryUsername(): string {
  try {
    const current = localStorage.getItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY)
    if (current !== null) return current
    // One-time carry-forward from the pre-rename key, so nobody's already-
    // set username setting silently resets just because the storage key
    // itself was renamed. Never runs again once the new key exists (the
    // branch above already returns first on every subsequent call).
    const legacy = localStorage.getItem(LEGACY_LORE_USERNAME_STORAGE_KEY)
    if (legacy !== null) {
      // Persisting the carry-forward is best-effort -- if the write/delete
      // below throws (e.g. quota exceeded), still return the legacy value
      // we already have in hand rather than silently falling back to the
      // default, even though the migration itself didn't stick this time.
      try {
        localStorage.setItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY, legacy)
        localStorage.removeItem(LEGACY_LORE_USERNAME_STORAGE_KEY)
      } catch (err) {
        console.error('LibraryBrowser: failed to persist riff library username carry-forward:', err)
      }
      return legacy
    }
    return RIFF_LIBRARY_USERNAME
  } catch {
    return RIFF_LIBRARY_USERNAME
  }
}

type AuthStatus =
  { loggedIn: false } | { loggedIn: true; userId: string; username: string; expiresAt: number }

interface RiffTempoGroup {
  bpm: number // rounded to the nearest whole BPM — the grouping key for "similar tempos"
  riffs: RiffLibraryRiffSummary[]
}

interface RiffDateGroup {
  label: string
  tempoGroups: RiffTempoGroup[]
}

/** Groups riffs by local calendar date, then by tempo within each date —
 * date > tempo. A jam with thousands of riffs otherwise renders as one
 * undifferentiated wall of circles with no sense of when anything was made
 * or which ones actually belong together tempo-wise. Riffs already arrive
 * sorted by CreationTime DESC (see listRiffs), so a single linear scan is
 * enough for the date grouping: consecutive riffs sharing the same date
 * label just extend the current group. Tempo grouping keys on the rounded
 * whole-number BPM (not exact equality) — LORE's own BPMrnd column carries
 * floating-point noise (see formatBpm's own doc comment), so two riffs that
 * are really "the same tempo" rarely match exactly. Each date's tempo
 * groups are then sorted numerically ascending, for easy scanning rather
 * than whatever order they happened to occur in that day. */
function groupRiffsByDateAndTempo(riffs: RiffLibraryRiffSummary[]): RiffDateGroup[] {
  const dateGroups: RiffDateGroup[] = []
  for (const riff of riffs) {
    const label = new Date(riff.creationTime * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
    let dateGroup = dateGroups[dateGroups.length - 1]
    if (!dateGroup || dateGroup.label !== label) {
      dateGroup = { label, tempoGroups: [] }
      dateGroups.push(dateGroup)
    }
    const bpm = Math.round(riff.bpm)
    let tempoGroup = dateGroup.tempoGroups.find((g) => g.bpm === bpm)
    if (!tempoGroup) {
      tempoGroup = { bpm, riffs: [] }
      dateGroup.tempoGroups.push(tempoGroup)
    }
    tempoGroup.riffs.push(riff)
  }
  for (const dateGroup of dateGroups) {
    dateGroup.tempoGroups.sort((a, b) => a.bpm - b.bpm)
  }
  return dateGroups
}

// Matches loreWarehouse.ts's RIFF_CONTEXT_WINDOW_BEFORE * 2 (10 before, 10
// after) -- kept as a separate constant here rather than imported since the
// renderer can't import from src/main/* (Node-only modules).
const RIFF_ID_JUMP_WINDOW_SIZE = 20

// Triggers the next page fetch this far (in px) before the riff grid's
// scroll container actually bottoms out, so the next page is ready before
// the user hits a dead stop — replaces an earlier explicit "load more"
// button with plain infinite scroll.
const SCROLL_LOAD_MORE_THRESHOLD_PX = 200

// Above this many riffs, starting a sync warns first rather than just
// diving in — a judgment call, not a measured number: syncJam's own
// SYNC_CONCURRENCY (loreWarehouseSync.ts) is 3, and a jam this size is
// enough riffs that "I didn't realize this would take a while" becomes a
// real risk, not enough that it's obviously huge either way.
const LARGE_JAM_RIFF_THRESHOLD = 300

// The riff-library-sync-progress IPC channel keys shared-feed events by the
// bare username (see riff-library-sync-start-shared-feed's handler in
// src/main/index.ts), not the synthetic `shared:<username>` jamCID this
// component's own jam
// list/selection uses -- strip the prefix so a jamCID can always be turned
// into the same key the progress events themselves use, for both syncing
// state (syncingKeys) and progress display (syncProgressByKey).
function syncKeyFor(jamCID: string): string {
  return jamCID.startsWith('shared:') ? jamCID.slice('shared:'.length) : jamCID
}

export function LibraryBrowser({
  onClose,
  onImported,
  currentSketch,
  discoverConsented,
  setDiscoverConsented
}: {
  onClose: () => void
  /** Called once import(s) succeed with every newly-created groupId (one for
   * a single import, several for a batch) — lets the caller drive downbeat
   * correction (open BeatPicker for the first one, propagate its picked
   * offset to the rest) the same way drag-and-drop import already does.
   * `rifffs` (batch import only) carries the actual imported Rifff data
   * alongside the ids, so the caller can pick a better default than "first
   * imported" without reading back through `state.rifffs`, which wouldn't
   * yet reflect this batch's dispatches at the point onImported fires
   * (React hasn't re-rendered yet). */
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  currentSketch: ProjectRef
  /** App.tsx's Frame() own single source of truth for Discover's
   * whole-library-scan consent — threaded straight through to
   * DiscoverPanel below, same lift-up-and-thread-down pattern already
   * used for discoverSlots/discoverChaos just below (this component
   * itself doesn't read either, it's purely a pass-through here). */
  discoverConsented: boolean
  setDiscoverConsented: (value: boolean) => Promise<void>
}): React.JSX.Element {
  const riffFavourites = useRiffFavourites()
  const { toggleRiffFavourite } = useRiffFavouritesActions()
  const [libraryMode, setLibraryMode] = useState<'browse' | 'discover'>('browse')
  // Lifted out of DiscoverPanel (rather than owned internally there) so
  // the in-progress discover loop survives switching `libraryMode` back
  // and forth within one open LibraryBrowser session -- DiscoverPanel
  // itself unmounts/remounts every time `libraryMode` flips (it's
  // rendered conditionally below, as a sibling of the 'browse' block),
  // but LibraryBrowser does not, so state living here (not in
  // DiscoverPanel) survives that unmount. See
  // docs/superpowers/specs/2026-09-14-library-wide-discover-design.md
  // §8.1 ("survives closing and reopening the Discover tab").
  const [discoverSlots, setDiscoverSlots] = useState<DiscoverSlot[]>([])
  const [discoverChaos, setDiscoverChaos] = useState(35)
  // Undo/redo history for Discover's own slot-content actions (add/remove
  // slot, reroll one, random-reroll one, reroll all) -- lifted up here for
  // the exact same reason discoverSlots itself is: DiscoverPanel unmounts
  // on every 'browse' <-> 'discover' switch, so history kept there would
  // silently vanish the moment you glanced at another tab. Direct request,
  // 2026-09-15 (Upcycle-inspired). Each entry is a full snapshot of
  // discoverSlots at the moment just before an undoable action ran.
  const [discoverUndoStack, setDiscoverUndoStack] = useState<DiscoverSlot[][]>([])
  const [discoverRedoStack, setDiscoverRedoStack] = useState<DiscoverSlot[][]>([])

  // Auth (gates sync-triggering and live jam-membership discovery)
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ loggedIn: false })

  // Warehouse availability + external folder config (unchanged from LoreLibraryBrowser.tsx)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [warehouseRoot, setWarehouseRootState] = useState<string | null>(null)
  // True iff the currently active riff library root is sssketch's own
  // self-built one, rather than a user-pointed real external LORE archive
  // -- see importResolvedRiff's own use of this for friendlyRiffName's
  // suffix (item 5 of docs/superpowers/specs/
  // 2026-08-14-riff-library-rename-design.md). Defaults to true (the
  // overwhelmingly common case) until the real fetch above resolves, so a
  // riff resolved in the brief window before that first fetch completes
  // still gets labeled correctly for the common case.
  const [isOwnRiffLibrary, setIsOwnRiffLibrary] = useState(true)

  // Jam sidebar
  const [jamFilter, setJamFilter] = useState('')
  const [syncedJams, setSyncedJams] = useState<RiffLibraryJam[]>([])
  const [membershipJams, setMembershipJams] = useState<RiffLibraryJam[] | null>(null)
  // The account's own personal jam -- by Endlesss convention, every account
  // has exactly one private jam named identically to its own username,
  // distinct from any group jams it has joined. Tracked separately from
  // membershipJams (rather than just filtering membershipJams inline
  // wherever needed) since the auto-sync effect below needs it as a stable
  // dependency, and needs the jam's name (for loreSyncStartJam) without
  // depending on visibleJams -- which is itself filtered by jamFilter, so a
  // `.find()` against it could miss the own jam entirely while the user has
  // something typed into the jam search box.
  const [ownJam, setOwnJam] = useState<RiffLibraryJam | null>(null)
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)
  // Right-click "remove from sync" menu on a sidebar jam row -- jamCID/
  // jamName are captured at open time rather than read back from
  // sidebarJams at click time, so the menu still knows what it's acting on
  // even if the list re-sorts (e.g. a sync starting/finishing elsewhere)
  // while it's open.
  const [jamContextMenu, setJamContextMenu] = useState<{
    x: number
    y: number
    jamCID: string
    jamName: string
  } | null>(null)

  // Per-jam sync status/trigger. syncStatus itself stays a single value (it's
  // "the detail pane's own fetch for whichever jam is selected", re-fetched
  // by the effect below whenever selectedJamCID changes) but syncingKeys/
  // syncProgressByKey/syncBaseCountByKey are keyed by jam (via syncKeyFor),
  // not single shared values -- real bug this fixed: with a single global
  // `syncing` boolean, starting a sync on jam A and then merely SELECTING
  // jam B (without starting anything) left `syncing` stuck true forever,
  // since the progress listener's completion check only ever compared
  // against whichever jam was CURRENTLY selected, so jam A's own completion
  // event stopped matching the instant selection moved on. That left the
  // sync button disabled for every jam, permanently, until you switched back
  // to A. The backend (loreWarehouseSync.ts's syncsInFlight, keyed per jam)
  // already supported multiple jams syncing at once -- this was purely a
  // renderer-side state-shape bug. Real prior art checked directly against
  // LORE itself (OUROVEON's own Endlesss warehouse sync tool, this app's own
  // design precedent -- see doc/LORE.warehouse.MD in github.com/OUROcorp/
  // OUROVEON): its Data Warehouse table shows live "riffs (+N remaining)"
  // progress per JAM ROW regardless of which jam you're viewing, which is
  // the same "don't lose visibility into a jam once you look away from it"
  // property the per-jam keying below (plus the sidebar row indicator further
  // down) is aiming for here.
  const [syncStatus, setSyncStatus] = useState<{ riffCount: number; complete: boolean } | null>(
    null
  )
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set())
  const [syncProgressByKey, setSyncProgressByKey] = useState<
    Record<string, { done: number; total: number; bytesDone: number }>
  >({})
  const [syncBaseCountByKey, setSyncBaseCountByKey] = useState<Record<string, number>>({})
  // The jam's live riff count straight from Endlesss (not the local
  // warehouse) -- fetched below whenever a private jam is selected, purely
  // to warn before starting a sync that's going to take a while. null both
  // before the fetch resolves and for a shared-feed selection (no jam id to
  // ask about), and jamRiffCount's own "never throws" convention means a
  // failed fetch also just leaves this null -- either way, the warning
  // below simply doesn't fire rather than blocking sync on this being
  // unavailable.
  const [liveJamRiffCount, setLiveJamRiffCount] = useState<number | null>(null)
  // Bumped whenever a sync completes for the currently-selected jam, purely
  // to give the riff-fetch effect below a dependency that changes on sync
  // completion -- selectedJamCID itself doesn't change when a sync finishes,
  // so without this the riff grid would stay empty after a first-ever sync
  // until the user picked a different jam and back.
  const [riffRefreshToken, setRiffRefreshToken] = useState(0)

  // Riff list + pagination (single flat list -- no more per-tab duplication)
  const [riffs, setRiffs] = useState<RiffLibraryRiffSummary[]>([])
  const riffGroups = useMemo(() => groupRiffsByDateAndTempo(riffs), [riffs])
  // Whether the warehouse has more riffs beyond the currently-loaded page(s)
  // for the current jam/filters — some of Elling's real jams have 20,000+
  // riffs, so loreListRiffs is paginated rather than ever fetching/rendering
  // all of them at once. See handleLoadMore.
  const [hasMoreRiffs, setHasMoreRiffs] = useState(false)
  const [loadingMoreRiffs, setLoadingMoreRiffs] = useState(false)
  // The offset to request for the *next* page — tracks raw SQL rows consumed
  // server-side, not riffs.length, which can diverge once the
  // onlyFullyCached filter drops some rows from a page.
  const nextOffsetRef = useRef(0)
  const gridRef = useRef<HTMLDivElement>(null)

  // Riff-ID jump (unchanged from LoreLibraryBrowser.tsx)
  const [riffIdInput, setRiffIdInput] = useState('')
  const [riffIdNotFound, setRiffIdNotFound] = useState(false)
  // Set by handleGoToRiffId, consumed by the riff-fetch effect below once
  // the centered page for this jump has loaded -- see that effect's own
  // comment for why this can't just be done inline in handleGoToRiffId
  // itself (the render-time jam-change reset a few lines down would wipe out
  // an immediately-set selectedRiffCID before the fetch even starts).
  const [pendingJump, setPendingJump] = useState<{ offset: number; matchedRiffCID: string } | null>(
    null
  )
  // Per-riff DOM node refs, populated by each riff circle's own ref callback
  // -- lets handleGoToRiffId's target scroll into view once its page has
  // loaded, the same way a normal click never needs to (the user is already
  // looking at whatever they clicked).
  const riffNodeRefs = useRef(new Map<string, HTMLDivElement>())

  // Filters (unchanged from LoreLibraryBrowser.tsx)
  const [bpmMinFilter, setBpmMinFilter] = useState('')
  const [bpmMaxFilter, setBpmMaxFilter] = useState('')
  // '' means "any" for both -- root/scale are only sent together (a key is
  // a root+scale pair, see RiffFilters' own doc comment), so a lone pick on
  // either side doesn't filter anything until both are set.
  const [rootFilter, setRootFilter] = useState('')
  const [scaleFilter, setScaleFilter] = useState('')
  const [userNameFilter, setUserNameFilter] = useState('')
  const [onlyFullyCached, setOnlyFullyCached] = useState(false)
  // Which username "you" are, for ownerFraction (drives the ownership
  // brightness coloring) and the "only mine" filter — editable and
  // persisted per-machine (see loadStoredRiffLibraryUsername), not
  // hardcoded, since other people testing this app aren't Elling.
  const [riffLibraryUsername, setRiffLibraryUsername] = useState(loadStoredRiffLibraryUsername)
  const [onlyContainsMe, setOnlyContainsMe] = useState(false)
  // <input type="date"> values (YYYY-MM-DD strings, or '' for unset) —
  // converted to unix-seconds boundaries (start/end of day) when building
  // the query filters below, since CreationTime is stored as unix seconds.
  const [dateFromFilter, setDateFromFilter] = useState('')
  const [dateToFilter, setDateToFilter] = useState('')
  // Tracks the last jamCID a riff selection was reset for — compared during
  // render (not in an effect) so switching jams clears the stale riff
  // selection in the same render pass, matching the "adjust state while
  // rendering" pattern TransportBar.tsx's own tempo-resync already uses,
  // rather than the extra render cycle a useEffect-based reset would cause.
  const [resetForJamCID, setResetForJamCID] = useState<string | null>(null)

  // Selection & preview
  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  // The batch/multi-selection (shift-click range, cmd/ctrl-click toggle) --
  // separate from selectedRiffCID, which remains the "anchor" riff that
  // drives preview/detail-line/PolarGlyph exactly as before. A plain click
  // always collapses this back down to just that one riff.
  const [selectedRiffCIDs, setSelectedRiffCIDs] = useState<Set<string>>(new Set())
  if (selectedJamCID !== resetForJamCID) {
    setResetForJamCID(selectedJamCID)
    setSelectedRiffCID(null)
    setSelectedRiffCIDs(new Set())
  }

  const [resolvedRiff, setResolvedRiff] = useState<RiffLibraryResolvedRiff | null>(null)
  const [playingRiffCID, setPlayingRiffCID] = useState<string | null>(null)
  // riffCID -> the groupId it was imported as, so re-clicking Import after
  // more of a riff's stems finish downloading in the background (see
  // ensureStemsDownloaded) merges the newly-available ones into that SAME
  // rifff/tile instead of leaving a stale, permanently-incomplete one behind
  // and creating an unrelated duplicate — see importResolvedRiff.
  const [importedRiffGroupIds, setImportedRiffGroupIds] = useState<Map<string, string>>(new Map())
  // Which riff (if any) currently has a download-missing-stems fetch in
  // flight — a single riffCID rather than a Set, since only one download can
  // be triggered at a time from this panel (the button/import action that
  // starts one is disabled while it's running).
  const [downloadingRiffCID, setDownloadingRiffCID] = useState<string | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewTokenRef = useRef(0)
  // Invalidates any in-flight background sync (see runBackgroundSync) --
  // bumped every time the resolve/preview effect below re-runs (a new riff
  // selected, or selection cleared entirely by a jam switch), so clicking
  // somewhere else always redirects/stops the walk instead of two queues
  // racing each other.
  const syncQueueTokenRef = useRef(0)

  const playing = usePlaying()
  const dispatch = useDispatch()
  const appState = useAppState()
  const setBusy = useBusy()

  // Stable across renders (useCallback, empty deps) so it's safe to pass to
  // registerActivePreview/reference from effect cleanups without triggering
  // re-subscriptions.
  const stopPreview = useCallback(() => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  // ---------------------------------------------------------------------
  // Jam list unification
  // ---------------------------------------------------------------------

  useEffect(() => {
    window.rifffApi
      .riffLibraryAvailable()
      .then(setAvailable)
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryAvailable() failed:', err)
        setAvailable(false)
      })
  }, [])

  useEffect(() => {
    if (available === null) return
    window.rifffApi
      .riffLibraryRoot()
      .then(setWarehouseRootState)
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryRoot() failed:', err)
      })
    window.rifffApi
      .riffLibraryIsOwn()
      .then(setIsOwnRiffLibrary)
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryIsOwn() failed:', err)
      })
  }, [available])

  useEffect(() => {
    if (!available) return
    window.rifffApi
      .riffLibraryListJams(jamFilter)
      .then(setSyncedJams)
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryListJams() failed:', err)
      })
  }, [jamFilter, available])

  useEffect(() => {
    let cancelled = false
    if (!authStatus.loggedIn) {
      // Deferred through a microtask (not called directly) so this doesn't
      // read as a synchronous setState-in-effect -- same established
      // workaround EndlesssLibraryBrowser.tsx's own feedSyncStatus/
      // jamSyncStatus effects use for this exact shape (early-return branch
      // that just wants to reset state to null).
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setMembershipJams(null)
          setOwnJam(null)
        }
      })
      return () => {
        cancelled = true
      }
    }
    window.rifffApi
      .endlesssListJams()
      .then((liveJams) => {
        if (cancelled) return
        const sharedFeedEntry: RiffLibraryJam = {
          jamCID: `shared:${authStatus.username}`,
          name: 'Shared Feed',
          lastRiffTime: 0
        }
        // Full membership list -- every jam the account has ever joined or
        // participated in (per endlesssListJams' own contract), not narrowed
        // down. Separately, still pick out the account's own private jam
        // (name equality against the logged-in username, case-insensitive/
        // trimmed) purely so it -- along with Shared Feed -- can be pinned
        // to the top of the sidebar and auto-synced on login (see ownJam's
        // own doc comment above and the two auto-sync effects further
        // down); it stays IN the full list too, not pulled out of it.
        const needle = authStatus.username.trim().toLowerCase()
        setOwnJam(liveJams.find((j) => j.name.trim().toLowerCase() === needle) ?? null)
        setMembershipJams([sharedFeedEntry, ...liveJams])
      })
      .catch((err) => {
        console.error('LibraryBrowser: endlesssListJams() failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [authStatus])

  // Union of both sources, deduplicated by jamCID -- syncedJams entries win
  // on conflict (they carry a real lastRiffTime from the warehouse;
  // membershipJams entries never do, per endlesssListJams' own contract).
  const visibleJams = useMemo(() => {
    const byId = new Map<string, RiffLibraryJam>()
    for (const jam of membershipJams ?? []) byId.set(jam.jamCID, jam)
    for (const jam of syncedJams) byId.set(jam.jamCID, jam)
    const merged = [...byId.values()]
    merged.sort((a, b) => b.lastRiffTime - a.lastRiffTime)
    if (jamFilter.trim() === '') return merged
    const needle = jamFilter.trim().toLowerCase()
    return merged.filter((j) => j.name.toLowerCase().includes(needle))
  }, [syncedJams, membershipJams, jamFilter])

  // Sidebar-only ordering -- pulls whichever jams are actively syncing to
  // the very top (so a background sync stays visible without hunting
  // through the list), then Shared Feed and the account's own private jam
  // (see ownJam) right after -- these two are the ones auto-synced below,
  // so they're also the two most likely to matter on any given visit.
  // visibleJams itself (used elsewhere for name lookups) stays sorted by
  // lastRiffTime, unaffected. Stable within each group.
  const sidebarJams = useMemo(() => {
    const syncing: RiffLibraryJam[] = []
    const pinned: RiffLibraryJam[] = []
    const rest: RiffLibraryJam[] = []
    for (const jam of visibleJams) {
      if (syncingKeys.has(syncKeyFor(jam.jamCID))) syncing.push(jam)
      else if (jam.jamCID.startsWith('shared:') || jam.jamCID === ownJam?.jamCID) pinned.push(jam)
      else rest.push(jam)
    }
    return [...syncing, ...pinned, ...rest]
  }, [visibleJams, syncingKeys, ownJam])

  // ---------------------------------------------------------------------
  // Sync status + trigger
  // ---------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    if (!selectedJamCID) {
      // Deferred through a microtask -- see the membershipJams effect above
      // for why (avoids a synchronous setState-in-effect on this early-
      // return-to-null branch).
      void Promise.resolve().then(() => {
        if (!cancelled) setSyncStatus(null)
      })
      return () => {
        cancelled = true
      }
    }
    window.rifffApi
      .riffLibrarySyncStatus(selectedJamCID)
      .then((status) => {
        if (!cancelled) setSyncStatus(status)
      })
      .catch((err) => {
        console.error('LibraryBrowser: riffLibrarySyncStatus() failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [selectedJamCID])

  // See liveJamRiffCount's own doc comment above -- shared-feed selections
  // (jamCID prefixed "shared:") have no real jam id to ask Endlesss about,
  // so this only fires for an actual private jam.
  useEffect(() => {
    let cancelled = false
    if (!selectedJamCID || selectedJamCID.startsWith('shared:')) {
      void Promise.resolve().then(() => {
        if (!cancelled) setLiveJamRiffCount(null)
      })
      return () => {
        cancelled = true
      }
    }
    window.rifffApi
      .endlesssJamRiffCount(selectedJamCID)
      .then((count) => {
        if (!cancelled) setLiveJamRiffCount(count)
      })
      .catch((err) => {
        console.error('LibraryBrowser: endlesssJamRiffCount() failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [selectedJamCID])

  // Purely a running display update -- does NOT drive completion. Real bug
  // this fixed: loreWarehouseSync.ts's onProgress always calls back with
  // `total` set equal to `done` (there's no cheap way to know a jam's real
  // total riff count upfront -- see loreWarehouseSync.ts's own SyncProgress
  // doc comment), so `progress.done === progress.total` is true on literally
  // the FIRST riff resolved, not the last. The previous version of this
  // effect used exactly that comparison to decide "the sync just finished,"
  // which cleared the syncing indicator (and re-fetched syncStatus) after
  // one riff while the backend kept working on hundreds more, invisibly --
  // a real contributor to this feature reading as a black box. Completion
  // is now driven by the sync's own start-promise resolving instead (see
  // finishSyncingKey, called from handleStartSync's own .then()/.catch()),
  // which is unambiguous: the async function returned, so the sync (or its
  // abort) is genuinely done.
  useEffect(() => {
    return window.rifffApi.onRiffLibrarySyncProgress((progress) => {
      setSyncProgressByKey((prev) => ({ ...prev, [progress.key]: progress }))
    })
  }, [])

  // Shared by handleStartSync's own .then()/.catch() below -- runs once a
  // sync's start-promise has genuinely resolved (natural completion, an
  // abort, or an error all funnel through one or the other), so it's the
  // one place completion is actually detected, not the progress listener
  // above (see that effect's own doc comment for why). `viewingJamCID` is
  // whichever jam was selected at the moment handleStartSync was called for
  // THIS key -- closed over per-call rather than read fresh, so switching
  // selection mid-sync doesn't misdirect the detail-pane refresh to
  // whatever jam happens to be selected when this actually fires.
  const finishSyncingKey = useCallback(
    (key: string, viewingJamCID: string) => {
      setSyncingKeys((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      // Keeps the sidebar's "(not synced)" labels accurate even for a jam
      // that finished syncing in the background while a different jam was
      // selected -- without this, only the jam you happened to be looking
      // at when it finished ever lost its "(not synced)" suffix.
      window.rifffApi
        .riffLibraryListJams(jamFilter)
        .then(setSyncedJams)
        .catch((err) => {
          console.error('LibraryBrowser: riffLibraryListJams() refresh failed:', err)
        })
      if (syncKeyFor(viewingJamCID) !== key) return
      setRiffRefreshToken((t) => t + 1)
      window.rifffApi
        .riffLibrarySyncStatus(viewingJamCID)
        .then(setSyncStatus)
        .catch((err) => {
          console.error('LibraryBrowser: riffLibrarySyncStatus() failed:', err)
        })
    },
    [jamFilter]
  )

  // Core sync trigger, decoupled from selection -- shared by handleStartSync
  // (the button click, gated on the large-jam confirm dialog below) and the
  // auto-sync effects further down (shared feed + the account's own private
  // jam, triggered on login with no button click and no confirm dialog --
  // see those effects' own comments for why a confirmation prompt would be
  // wrong there).
  const startSyncForJam = useCallback(
    (jamCID: string, jamName: string, baseCount: number) => {
      const key = syncKeyFor(jamCID)
      if (syncingKeys.has(key)) return
      setSyncingKeys((prev) => new Set(prev).add(key))
      setSyncBaseCountByKey((prev) => ({ ...prev, [key]: baseCount }))
      setSyncProgressByKey((prev) => {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      const promise = jamCID.startsWith('shared:')
        ? window.rifffApi.riffLibrarySyncStartSharedFeed(jamCID.slice('shared:'.length))
        : window.rifffApi.riffLibrarySyncStartJam(jamCID, jamName)
      promise
        .catch((err) => {
          console.error('LibraryBrowser: sync failed:', err)
        })
        .then(() => finishSyncingKey(key, jamCID))
    },
    [syncingKeys, finishSyncingKey]
  )

  const handleStartSync = useCallback(() => {
    if (!selectedJamCID) return
    if (syncingKeys.has(syncKeyFor(selectedJamCID))) return
    // A rough, deliberately hedged estimate ("+", not a promise) -- there's
    // no reliable way to know from here how much of a jam's audio is
    // already cached locally vs. needs downloading, which dominates real
    // sync time far more than this per-riff constant does. 0.3s/riff is a
    // conservative floor assuming mostly-cached content; a jam needing lots
    // of fresh downloads will take substantially longer than this suggests.
    //
    // Gates on NEW riffs since the last sync (liveJamRiffCount minus
    // whatever's already synced), not the jam's raw total -- syncStatus is
    // only for the currently-selected jam, which is exactly the one this
    // button acts on. A jam with 10,000 riffs that's already fully synced
    // and just needs 3 new ones shouldn't get the same "this could take a
    // while" warning as a genuinely large first-time sync; only an
    // unsynced (or never-before-seen) jam sees the warning keyed off its
    // full size.
    const alreadySyncedCount = syncStatus?.riffCount ?? 0
    const newRiffCount =
      liveJamRiffCount !== null ? Math.max(0, liveJamRiffCount - alreadySyncedCount) : null
    if (newRiffCount !== null && newRiffCount > LARGE_JAM_RIFF_THRESHOLD) {
      const estimatedMinutes = Math.max(1, Math.round((newRiffCount * 0.3) / 60))
      const message =
        alreadySyncedCount > 0
          ? `this jam has ~${newRiffCount} new riffs since your last sync — catching up could take ${estimatedMinutes}+ minutes depending on how much needs downloading. continue?`
          : `this jam has ~${liveJamRiffCount} riffs — syncing could take ${estimatedMinutes}+ minutes depending on how much needs downloading. continue?`
      if (!window.confirm(message)) {
        return
      }
    }
    startSyncForJam(
      selectedJamCID,
      visibleJams.find((j) => j.jamCID === selectedJamCID)?.name ?? selectedJamCID,
      syncStatus?.riffCount ?? 0
    )
  }, [selectedJamCID, syncStatus, visibleJams, liveJamRiffCount, syncingKeys, startSyncForJam])

  // Auto-syncs Shared Feed the moment the account logs in -- per direct
  // feedback, these two (this one and the own-jam effect just below) are the
  // ones that matter by default, so neither should need a manual sync click.
  // No large-jam confirm dialog here (unlike handleStartSync) -- a
  // window.confirm() firing unprompted right after login would be a jarring
  // surprise, not a helpful warning; the shared feed is walked oldest-first
  // in bounded pages besides; see syncSharedFeed's own doc comment.
  useEffect(() => {
    if (!authStatus.loggedIn) return
    const username = authStatus.username
    // Deferred through a microtask, same as this component's other
    // early-resolve effects (see the membershipJams effect above) --
    // startSyncForJam's setSyncingKeys call is a real setState, so calling
    // it synchronously in the effect body trips the lint rule against
    // synchronous setState-in-effect (cascading renders).
    void Promise.resolve().then(() => {
      startSyncForJam(`shared:${username}`, 'Shared Feed', 0)
    })
    // Intentionally fires once per login (authStatus.loggedIn/.username
    // transition), not on every startSyncForJam identity change (which
    // itself changes whenever syncingKeys does, or this would refire
    // mid-sync).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus.loggedIn, authStatus.loggedIn ? authStatus.username : null])

  // Same auto-sync, for the account's own private jam once it's been
  // identified (see the membershipJams effect's own doc comment for how
  // "own jam" is determined). Fires once ownJam transitions from null to a
  // real value, not on every render.
  useEffect(() => {
    if (!ownJam) return
    const jam = ownJam
    void Promise.resolve().then(() => {
      startSyncForJam(jam.jamCID, jam.name, 0)
    })
    // See the shared-feed auto-sync effect just above for why
    // startSyncForJam is intentionally excluded here too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownJam])

  const handleAbortSync = useCallback(() => {
    if (!selectedJamCID) return
    // Passes selectedJamCID as-is, NOT syncKeyFor(selectedJamCID) --
    // riffLibrarySyncAbort's `key` param must match syncsInFlight's own
    // internal key convention in riffLibrarySync.ts (`shared:<username>`
    // for a shared-feed sync, matching Jams/Riffs' OwnerJamCID storage
    // convention exactly), which is a DIFFERENT convention from the
    // syncKeyFor()-stripped bare-username keys this component's own
    // syncingKeys/syncProgressByKey maps use for display purposes. Passing
    // the stripped form here was a real bug: it silently made "cancel"
    // a no-op for the shared feed specifically (abortSync's own
    // syncsInFlight.get(key) lookup always missed).
    window.rifffApi.riffLibrarySyncAbort(selectedJamCID).catch((err) => {
      console.error('LibraryBrowser: riffLibrarySyncAbort() failed:', err)
    })
  }, [selectedJamCID])

  /** Right-click "remove from sync" on a sidebar jam row -- deletes that
   * jam's warehouse rows (and, if `deleteFiles`, whichever of its stems'
   * downloaded audio isn't still needed by some other synced jam; see
   * removeJamSync's own doc comment in loreWarehouseSync.ts for why that
   * check matters). Refuses (with an explanatory alert, not a silent
   * no-op) while this jam is actively syncing -- the same removeJamSync
   * call would otherwise reject anyway (a real race, not just wasted
   * work), so this catches the common case before even trying. */
  const handleRemoveJamSync = useCallback(
    (jamCID: string, jamName: string, deleteFiles: boolean) => {
      if (syncingKeys.has(syncKeyFor(jamCID))) {
        alert(`"${jamName}" is currently syncing — cancel the sync first, then try again.`)
        return
      }
      const consequence = deleteFiles
        ? 'remove it from sync AND delete its downloaded audio from disk'
        : 'remove it from sync (any already-downloaded audio stays on disk)'
      if (
        !window.confirm(
          `Really ${consequence} for "${jamName}"? Re-syncing it later will re-download everything from Endlesss from scratch.`
        )
      ) {
        return
      }
      window.rifffApi
        .riffLibraryRemoveJamSync(jamCID, deleteFiles)
        .then(() => {
          window.rifffApi
            .riffLibraryListJams(jamFilter)
            .then(setSyncedJams)
            .catch((err) => {
              console.error('LibraryBrowser: riffLibraryListJams() refresh failed:', err)
            })
          // Refreshes the detail pane back to "not synced" only if it's
          // currently showing the jam that was just removed -- otherwise
          // whatever jam IS selected keeps its own already-correct state.
          if (jamCID !== selectedJamCID) return
          setRiffRefreshToken((t) => t + 1)
          window.rifffApi
            .riffLibrarySyncStatus(jamCID)
            .then(setSyncStatus)
            .catch((err) => {
              console.error('LibraryBrowser: riffLibrarySyncStatus() failed:', err)
            })
        })
        .catch((err) => {
          console.error('LibraryBrowser: riffLibraryRemoveJamSync() failed:', err)
          alert(`Couldn't remove "${jamName}" from sync — see the console for details.`)
        })
    },
    [syncingKeys, jamFilter, selectedJamCID]
  )

  // ---------------------------------------------------------------------
  // Riff list fetch (filters + pagination + riff-ID jump)
  // ---------------------------------------------------------------------

  // Shared by the initial-page effect below and handleLoadMore — both need
  // the exact same filters, just a different offset. `limit` is only ever
  // passed by a riff-ID jump (see handleGoToRiffId) -- normal browsing
  // leaves it unset and gets the backend's own default full page.
  function buildRiffFilters(offset: number, limit?: number): RiffFilters {
    const filters: RiffFilters = {}
    if (dateFromFilter !== '') {
      filters.dateFrom = Math.floor(new Date(`${dateFromFilter}T00:00:00`).getTime() / 1000)
    }
    if (dateToFilter !== '') {
      filters.dateTo = Math.floor(new Date(`${dateToFilter}T23:59:59`).getTime() / 1000)
    }
    if (bpmMinFilter.trim() !== '' && !Number.isNaN(Number(bpmMinFilter))) {
      filters.bpmMin = Number(bpmMinFilter)
    }
    if (bpmMaxFilter.trim() !== '' && !Number.isNaN(Number(bpmMaxFilter))) {
      filters.bpmMax = Number(bpmMaxFilter)
    }
    if (rootFilter !== '' && scaleFilter !== '') {
      filters.root = Number(rootFilter)
      filters.scale = Number(scaleFilter)
    }
    if (userNameFilter.trim() !== '') filters.userName = userNameFilter.trim()
    if (onlyFullyCached) filters.onlyFullyCached = true
    // Always sent (not just while the "only mine" filter is checked) — this
    // also drives ownerFraction's brightness coloring on every riff shown,
    // not just the filtered subset.
    if (riffLibraryUsername.trim() !== '') filters.targetUser = riffLibraryUsername.trim()
    if (onlyContainsMe) filters.onlyContainsUser = true
    if (offset > 0) filters.offset = offset
    if (limit !== undefined) filters.limit = limit
    return filters
  }

  useEffect(() => {
    // No "deselect jam" affordance exists — selecting always moves to a new
    // non-null jamCID, so there's nothing to clear here; riffs simply starts
    // at its initial [] and is only ever populated once a jam is picked. The
    // grid itself is also only rendered when selectedJamCID !== null, so
    // even a theoretical stale value would never be visible.
    if (!selectedJamCID) return
    let cancelled = false
    // Captured once at the start of this effect run -- if handleGoToRiffId
    // set this for the jam we're now fetching, land on it once the page
    // loads; a later, unrelated jam-filter change re-runs this effect with
    // pendingJump already null again, so it goes back to the normal
    // offset-0/full-page behavior automatically.
    const jump = pendingJump
    window.rifffApi
      .riffLibraryListRiffs(
        selectedJamCID,
        buildRiffFilters(jump?.offset ?? 0, jump ? RIFF_ID_JUMP_WINDOW_SIZE : undefined)
      )
      .then((result) => {
        if (cancelled) return
        setRiffs(result.riffs)
        setHasMoreRiffs(result.hasMore)
        nextOffsetRef.current = result.nextOffset
        if (jump) {
          setPendingJump(null)
          setSelectedRiffCID(jump.matchedRiffCID)
          setSelectedRiffCIDs(new Set([jump.matchedRiffCID]))
          // Deferred one frame so the grid has actually re-rendered with
          // this page's riffs (and their ref callbacks have run) before
          // scrollIntoView looks the node up.
          requestAnimationFrame(() => {
            riffNodeRefs.current.get(jump.matchedRiffCID)?.scrollIntoView({ block: 'center' })
          })
        }
      })
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryListRiffs() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildRiffFilters closes over these same deps; listing both would be redundant and buildRiffFilters itself isn't stable across renders. pendingJump is read via the `jump` local, not listed, so a later handleGoToRiffId call (which also sets selectedJamCID) still re-triggers this effect through that dependency.
  }, [
    selectedJamCID,
    dateFromFilter,
    dateToFilter,
    bpmMinFilter,
    bpmMaxFilter,
    rootFilter,
    scaleFilter,
    userNameFilter,
    onlyFullyCached,
    riffLibraryUsername,
    onlyContainsMe,
    // Bumped by the sync-progress effect once a sync completes for the
    // currently-selected jam -- re-runs this same fetch (from offset 0) so
    // the grid actually shows the newly-synced riffs, since nothing else in
    // this dependency list changes when a sync finishes.
    riffRefreshToken
  ])

  function handleLoadMore(): void {
    if (!selectedJamCID || loadingMoreRiffs) return
    setLoadingMoreRiffs(true)
    window.rifffApi
      .riffLibraryListRiffs(selectedJamCID, buildRiffFilters(nextOffsetRef.current))
      .then((result) => {
        setRiffs((prev) => [...prev, ...result.riffs])
        setHasMoreRiffs(result.hasMore)
        nextOffsetRef.current = result.nextOffset
      })
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryListRiffs() (load more) failed:', err)
      })
      .finally(() => setLoadingMoreRiffs(false))
  }

  function handleGoToRiffId(): void {
    const id = riffIdInput.trim()
    if (id === '') return
    setRiffIdNotFound(false)
    window.rifffApi
      .riffLibraryResolveRiffWithContext(id)
      .then((result) => {
        if (!result) {
          setRiffIdNotFound(true)
          return
        }
        // Clears every filter (not riffLibraryUsername -- that's a persistent
        // identity setting, not a filter scope) so nothing hides the
        // centered window this jump is about to fetch.
        setDateFromFilter('')
        setDateToFilter('')
        setBpmMinFilter('')
        setBpmMaxFilter('')
        setRootFilter('')
        setScaleFilter('')
        setUserNameFilter('')
        setOnlyFullyCached(false)
        setOnlyContainsMe(false)
        setPendingJump({ offset: result.offset, matchedRiffCID: result.matchedRiffCID })
        setSelectedJamCID(result.jamCID)
      })
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryResolveRiffWithContext() failed:', err)
        setRiffIdNotFound(true)
      })
  }

  // ---------------------------------------------------------------------
  // Resolve/preview + background sync
  // ---------------------------------------------------------------------

  /** Patches just this one riff's cachedStemCount in the already-loaded
   * `riffs` list (the grid's own data) after a download — cheaper and more
   * immediate than re-running riffLibraryListRiffs, and the only field
   * riffCircleColor's "fully cached" check actually reads. */
  function patchRiffCacheCount(riffCID: string, resolved: RiffLibraryResolvedRiff): void {
    const cachedStemCount = resolved.stems.filter((s) => s.path !== null).length
    setRiffs((prev) => prev.map((r) => (r.riffCID === riffCID ? { ...r, cachedStemCount } : r)))
  }

  /** Fetches every not-yet-cached stem for `riffCID` directly from its
   * public storage URL (no Endlesss login involved) and returns the freshly
   * re-resolved riff, updating both resolvedRiff and the grid's own
   * cachedStemCount as a side effect. Shared by the explicit "download
   * missing stems" button and both import paths' auto-fetch fallback below.
   * Returns the ORIGINAL riff unchanged if the download fails (network
   * error, etc.) rather than null, so a caller chaining into an import still
   * has something to import. */
  async function ensureStemsDownloaded(
    riffCID: string,
    resolved: RiffLibraryResolvedRiff
  ): Promise<RiffLibraryResolvedRiff> {
    if (!resolved.stems.some((s) => s.path === null)) return resolved
    setDownloadingRiffCID(riffCID)
    try {
      const refreshed = await window.rifffApi.riffLibraryDownloadMissingStems(riffCID)
      if (!refreshed) return resolved
      if (riffCID === selectedRiffCID) setResolvedRiff(refreshed)
      patchRiffCacheCount(riffCID, refreshed)
      return refreshed
    } catch (err) {
      console.error(`LibraryBrowser: riffLibraryDownloadMissingStems(${riffCID}) failed:`, err)
      return resolved
    } finally {
      setDownloadingRiffCID(null)
    }
  }

  /** Same fetch as ensureStemsDownloaded, but for a riff in the background —
   * doesn't touch downloadingRiffCID (that drives the explicit button's and
   * Import's own disabled/label state; a background riff having nothing to
   * do with whatever's currently selected shouldn't make those look stuck)
   * or resolvedRiff unless it happens to already match what's selected.
   * Errors are logged and swallowed — one riff failing shouldn't stop the
   * walk from continuing to the next. */
  async function backgroundDownload(riffCID: string): Promise<void> {
    try {
      const refreshed = await window.rifffApi.riffLibraryDownloadMissingStems(riffCID)
      if (!refreshed) return
      patchRiffCacheCount(riffCID, refreshed)
      if (riffCID === selectedRiffCID) setResolvedRiff(refreshed)
    } catch (err) {
      console.error(`LibraryBrowser: background sync failed for riff ${riffCID}:`, err)
    }
  }

  /** Clicking a riff also starts filling in whatever's missing around it —
   * walks outward from centerRiffCID through the currently-loaded `riffs`
   * list (alternating forward/backward: +1, -1, +2, -2, ...) downloading
   * each not-fully-cached one's missing stems in sequence, one riff at a
   * time. `token` must still match syncQueueTokenRef.current before (and
   * between) each step — the moment a different riff gets clicked, the
   * resolve effect below bumps the ref in its own cleanup, and every
   * in-flight or not-yet-started step here just quietly stops rather than
   * fighting whatever queue started after it. Bounded by however many riffs
   * are already loaded — not literally the whole jam if it hasn't all been
   * paged in yet. */
  async function runBackgroundSync(token: number, centerRiffCID: string): Promise<void> {
    const centerIndex = riffs.findIndex((r) => r.riffCID === centerRiffCID)
    if (centerIndex === -1) return
    for (let delta = 1; ; delta++) {
      if (token !== syncQueueTokenRef.current) return
      const candidateIndices = [centerIndex + delta, centerIndex - delta].filter(
        (i) => i >= 0 && i < riffs.length
      )
      if (candidateIndices.length === 0) return // walked off both ends of the loaded list
      for (const idx of candidateIndices) {
        if (token !== syncQueueTokenRef.current) return
        const riff = riffs[idx]
        if (riff.cachedStemCount >= riff.stemCount) continue // nothing missing, skip the round trip
        await backgroundDownload(riff.riffCID)
      }
    }
  }

  useEffect(() => {
    stopPreview()
    // No "deselect riff" affordance exists — selecting always moves to a new
    // non-null riffCID, so there's nothing to clear here; resolvedRiff stays
    // stale-but-unrendered the same way riffs does above (the detail line is
    // only rendered when resolvedRiff is truthy).
    if (!selectedRiffCID) return
    let cancelled = false
    // Stable for this whole effect run's async chain — cleanup below
    // increments the ref itself, so by the time a new run starts,
    // syncQueueTokenRef.current already IS this run's own token.
    const syncQueueToken = syncQueueTokenRef.current
    window.rifffApi
      .riffLibraryResolveRiff(selectedRiffCID)
      .then(async (resolved) => {
        if (cancelled || !resolved) return
        setResolvedRiff(resolved)

        // Auto-preview on selection, full mix only — same reasoning as
        // BeatPicker's own preview: pause the main arrangement first so the
        // two don't play over each other.
        if (playing) dispatch({ type: 'PAUSE' })

        // previewLoop.ts itself no longer applies sqrtGain's stem-count
        // headroom normalization — Shelf.tsx's tile preview passes
        // state.vol, which already has that baked in from import time. This
        // riff hasn't been imported yet, though, so there's no state.vol
        // entry for it — its raw LORE GainsJSON gain never had sqrtGain
        // applied at all, so it has to be computed fresh here, same as this
        // preview always did.
        async function tryStartPreview(riff: RiffLibraryResolvedRiff): Promise<boolean> {
          const cachedStems = riff.stems.filter((s) => s.path !== null)
          if (cachedStems.length === 0) return false
          const gain = sqrtGain(cachedStems.length)
          const sources = await startPreviewLoop(
            getAudioContext(),
            cachedStems.map((s) => ({
              path: s.path!,
              gain: gain * s.gain,
              durationSec: s.durationSec
            })),
            () => cancelled
          )
          if (sources.length === 0) return false
          previewSourcesRef.current.push(...sources)
          previewTokenRef.current = registerActivePreview(stopPreview)
          setPlayingRiffCID(selectedRiffCID)
          return true
        }

        const startedOnFirstTry = await tryStartPreview(resolved)

        // Selecting a riff also starts syncing it (if anything's missing),
        // then keeps going outward to nearby riffs in the background — see
        // runBackgroundSync's own doc comment.
        if (cancelled) return
        const refreshed = await ensureStemsDownloaded(selectedRiffCID, resolved)
        if (cancelled || syncQueueToken !== syncQueueTokenRef.current) return
        if (!startedOnFirstTry) {
          // Nothing was cached locally yet on the first attempt (a riff
          // that's never been synced), so tryStartPreview above was a
          // guaranteed no-op -- retry now that ensureStemsDownloaded has
          // brought real stem paths in, so a never-synced riff plays on its
          // first click instead of requiring the user to click away and
          // back once the download quietly finishes in the background.
          await tryStartPreview(refreshed)
        }
        void runBackgroundSync(syncQueueToken, selectedRiffCID)
      })
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryResolveRiff() failed:', err)
      })
    return () => {
      cancelled = true
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the lint rule's concern (reading a ref that may have changed by cleanup time) is exactly the point here: this always bumps whatever the CURRENT token is, invalidating any queue started by this run or a still-in-flight later one, not a stale snapshot from when the effect started
      syncQueueTokenRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playing/dispatch intentionally excluded: this only re-runs on riff selection, matching BeatPicker's own pattern of reading transport state at the moment a preview starts rather than tracking it as a dependency
  }, [selectedRiffCID])

  useEffect(() => {
    return () => stopPreview()
  }, [stopPreview])

  // ---------------------------------------------------------------------
  // Selection, import, and favourite handlers
  // ---------------------------------------------------------------------

  /** Standard file-browser multi-select convention: plain click selects
   * just this one riff (and becomes the new anchor/preview); shift-click
   * extends a contiguous range from the current anchor to this riff, based
   * on their order in the currently-filtered `riffs` list; cmd/ctrl-click
   * toggles this one riff in or out of the selection without disturbing the
   * rest, and moves the anchor to it. */
  function handleRiffClick(e: React.MouseEvent, riffCID: string): void {
    if (e.shiftKey && selectedRiffCID) {
      const anchorIndex = riffs.findIndex((r) => r.riffCID === selectedRiffCID)
      const clickedIndex = riffs.findIndex((r) => r.riffCID === riffCID)
      if (anchorIndex === -1 || clickedIndex === -1) {
        setSelectedRiffCID(riffCID)
        setSelectedRiffCIDs(new Set([riffCID]))
        return
      }
      const [start, end] =
        anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
      setSelectedRiffCIDs(new Set(riffs.slice(start, end + 1).map((r) => r.riffCID)))
      // Anchor deliberately stays put — repeated shift-clicks keep extending
      // or shrinking the range from the same starting point, matching
      // standard file-browser shift-click behavior, rather than the range
      // jumping to a new anchor on every click.
      return
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedRiffCIDs((prev) => {
        const next = new Set(prev)
        if (next.has(riffCID)) next.delete(riffCID)
        else next.add(riffCID)
        return next
      })
      setSelectedRiffCID(riffCID)
      return
    }
    setSelectedRiffCID(riffCID)
    setSelectedRiffCIDs(new Set([riffCID]))
  }

  /** Builds a Rifff from a resolved riff and dispatches it, exactly as the
   * single-riff import button already did — extracted so the batch import
   * path (multiple riffs, each resolved on demand) can share the same logic
   * instead of duplicating it. Returns the (possibly reused) groupId, or
   * null (no-op) if the riff has no locally-cached stems at all and nothing
   * was previously imported either.
   *
   * If this riffCID was already imported once, this MERGES rather than
   * re-creates: only stems not already present (by slot) get added, onto
   * the SAME existing rifff/groupId, leaving its placement, name, and every
   * already-present stem's mute/volume/type untouched. Real bug this fixes:
   * a riff selected/imported before all its stems finished downloading in
   * the background (ensureStemsDownloaded) permanently missed whichever
   * ones weren't cached yet — re-importing via crypto.randomUUID() every
   * time just left the original incomplete tile sitting there and created
   * an unrelated duplicate alongside it, with no way back to a single
   * complete one.
   *
   * The actual build-vs-merge logic lives in buildImportedRifff
   * (audio/importResolvedRiff.ts), shared with every riff source this app
   * has ever had — this is a thin wrapper that owns this component's own
   * side effects (ADD_TO_SHELF, gain restoration, importedRiffGroupIds
   * tracking, classifyStems). Imports with sourceLabel 'library' when the
   * currently active riff library root is sssketch's own self-built one, or
   * 'lore' when the user has pointed sssketch at a real, externally-
   * connected LORE archive instead (see isOwnRiffLibrary, sourced from the
   * riff-library-is-own IPC channel) — see friendlyRiffName's own doc
   * comment for why this distinction matters. This component always reads
   * through riffLibraryStore.ts's riff-library-* channels either way; only
   * which underlying root is currently active changes what the resulting
   * riff should be labeled as having come from. */
  function importResolvedRiff(
    riffCID: string,
    resolved: RiffLibraryResolvedRiff
  ): { groupId: string; rifff: Rifff } | null {
    const existingGroupId = importedRiffGroupIds.get(riffCID)
    const existing = existingGroupId ? appState.rifffs[existingGroupId] : undefined
    const result = buildImportedRifff(
      riffCID,
      resolved,
      existing,
      isOwnRiffLibrary ? 'library' : 'lore',
      isOwnRiffLibrary ? 'riff library' : 'lore library'
    )
    if (!result) return null
    const { groupId, rifff, newStemSlots } = result
    if (newStemSlots.length === 0 && existing) return { groupId, rifff }

    dispatch({ type: 'ADD_TO_SHELF', rifff })
    for (const stem of resolved.stems.filter((s) => s.path !== null)) {
      if (Math.abs(stem.gain - 1.0) > 1e-6) {
        dispatch({ type: 'SET_VOLUME', stemKey: stemKey(groupId, stem.slot), volume: stem.gain })
      }
    }
    setImportedRiffGroupIds((prev) => new Map(prev).set(riffCID, groupId))

    // Same "fill in unclassified stems by ear" heuristic drag-and-drop import
    // already uses — the Instrument bitmask covers drum/note/bass/mic
    // confidently, but a stem with no matching bit (mapped to 'fx' above)
    // gets a second chance here, same as today's importer gives every stem.
    // Scoped to just the NEW stems on a merge — re-classifying an existing
    // stem here would silently overwrite any type the user picked by hand.
    const newStems = rifff.stems.filter((s) => newStemSlots.includes(s.slot))
    classifyStems({ ...rifff, stems: newStems }, dispatch).catch((err) => {
      console.error('LibraryBrowser: failed to classify stem types:', err)
    })
    return { groupId, rifff }
  }

  async function handleImport(): Promise<void> {
    if (!resolvedRiff || !selectedRiffCID) return
    setBusy('importing rifff…')
    try {
      const toImport = await ensureStemsDownloaded(selectedRiffCID, resolvedRiff)
      const result = importResolvedRiff(selectedRiffCID, toImport)
      if (result) onImported([result.groupId])
    } finally {
      setBusy(null)
    }
  }

  /** Batch import for shift/cmd-click multi-selection. The anchor riff
   * (selectedRiffCID) is already resolved (resolvedRiff, from the preview
   * effect) and reused directly; every other selected riff is resolved
   * on-demand here, sequentially — a handful of riffs at a time from one
   * shift-click doesn't need the batched-query machinery listRiffs uses for
   * hundreds of rows, and sequential keeps this simple and easy to reason
   * about failures for (one bad riff logs and moves on, same spirit as the
   * per-stem try/catch elsewhere in this component). Each riff also gets its
   * own auto-download-missing-stems pass, same as the single-import path. */
  async function handleImportSelected(): Promise<void> {
    setBusy('importing rifffs…')
    try {
      const groupIds: string[] = []
      const rifffs: Rifff[] = []
      for (const riffCID of selectedRiffCIDs) {
        try {
          const resolved =
            riffCID === selectedRiffCID && resolvedRiff
              ? resolvedRiff
              : await window.rifffApi.riffLibraryResolveRiff(riffCID)
          if (resolved) {
            const toImport = await ensureStemsDownloaded(riffCID, resolved)
            const result = importResolvedRiff(riffCID, toImport)
            if (result) {
              groupIds.push(result.groupId)
              rifffs.push(result.rifff)
            }
          }
        } catch (err) {
          console.error(
            `LibraryBrowser: failed to import riff ${riffCID} during batch import:`,
            err
          )
        }
      }
      if (groupIds.length > 0) onImported(groupIds, rifffs)
    } finally {
      setBusy(null)
    }
  }

  // Derived per-key lookups for whichever jam the detail pane is currently
  // showing -- selectedJamCID can be null (nothing selected), so this stays
  // undefined/false rather than throwing in that case.
  const selectedSyncKey = selectedJamCID ? syncKeyFor(selectedJamCID) : null
  const selectedSyncingHere = selectedSyncKey !== null && syncingKeys.has(selectedSyncKey)
  const selectedSyncProgress =
    selectedSyncKey !== null ? syncProgressByKey[selectedSyncKey] : undefined
  const selectedSyncBaseCount =
    (selectedSyncKey !== null ? syncBaseCountByKey[selectedSyncKey] : undefined) ?? 0

  // ---------------------------------------------------------------------
  // Escape-to-close
  // ---------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <style>{`@keyframes ra-rec-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.6); } }`}</style>
      <div
        style={{
          width: 900,
          height: 600,
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--ra-border)'
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setLibraryMode('browse')}
              style={{
                fontFamily: 'inherit',
                fontSize: 10,
                padding: '3px 8px',
                background: libraryMode === 'browse' ? 'var(--ra-stretch-on-bg)' : 'transparent',
                border: `1px solid ${libraryMode === 'browse' ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: libraryMode === 'browse' ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                fontWeight: libraryMode === 'browse' ? 700 : 400,
                cursor: 'pointer'
              }}
            >
              browse
            </button>
            <button
              onClick={() => setLibraryMode('discover')}
              style={{
                fontFamily: 'inherit',
                fontSize: 10,
                padding: '3px 8px',
                background: libraryMode === 'discover' ? 'var(--ra-stretch-on-bg)' : 'transparent',
                border: `1px solid ${libraryMode === 'discover' ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: libraryMode === 'discover' ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                fontWeight: libraryMode === 'discover' ? 700 : 400,
                cursor: 'pointer'
              }}
            >
              discover
            </button>
          </div>
          <button
            onClick={onClose}
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
            close
          </button>
        </div>

        {libraryMode === 'browse' && (
          <>
            <EndlesssLoginPanel onStatusChange={setAuthStatus} />

            {/* available === false in practice only happens for a misconfigured
            or unmounted EXTERNAL folder -- the self-built warehouse is
            created during app startup, before this component can ever
            mount, so that path is guaranteed to exist by the time we get
            here. If that startup guarantee ever changes, this copy would
            need to account for the self-built case too. */}
            {available === false ? (
              <div style={{ padding: 24 }}>
                <p>
                  riff archive not found at {warehouseRoot ?? '...'} — change its location from the
                  gear menu
                </p>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <div
                  style={{
                    width: 220,
                    overflowY: 'auto',
                    borderRight: '1px solid var(--ra-border)'
                  }}
                >
                  <input
                    type="text"
                    value={jamFilter}
                    onChange={(e) => setJamFilter(e.target.value)}
                    placeholder="filter jams..."
                    style={{
                      height: 24,
                      fontSize: 11,
                      background: 'var(--ra-bg-row-active)',
                      color: 'var(--ra-text)',
                      border: '1px solid var(--ra-border)',
                      borderRadius: 0,
                      padding: '0 6px',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        value={riffIdInput}
                        onChange={(e) => {
                          setRiffIdInput(e.target.value)
                          setRiffIdNotFound(false)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleGoToRiffId()
                        }}
                        placeholder="go to rifff ID..."
                        style={{
                          flex: 1,
                          height: 24,
                          fontSize: 11,
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          border: '1px solid var(--ra-border)',
                          borderRadius: 0,
                          padding: '0 6px'
                        }}
                      />
                      <button
                        onClick={handleGoToRiffId}
                        style={{
                          height: 24,
                          padding: '0 8px',
                          fontSize: 11,
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          border: '1px solid var(--ra-border)',
                          borderRadius: 0,
                          cursor: 'pointer'
                        }}
                      >
                        go
                      </button>
                    </div>
                    {riffIdNotFound && (
                      <span style={{ fontSize: 10, color: 'var(--ra-mute-on)' }}>
                        not found in local warehouse
                      </span>
                    )}
                  </div>
                  {sidebarJams.map((jam) => {
                    // Live per-row progress, visible regardless of which jam is
                    // currently selected -- matches LORE's own Data Warehouse
                    // table (doc/LORE.warehouse.MD in OUROVEON), which shows a
                    // "riffs (+N remaining)" count in every syncing jam's own row
                    // rather than only for whichever one you're looking at. This
                    // is what makes a background sync visible at all instead of
                    // reading as an opaque "black box" the moment you click
                    // elsewhere. Syncing jams are also sorted to the top (see
                    // sidebarJams) so a background sync doesn't require hunting
                    // through the list to check on.
                    const jamKey = syncKeyFor(jam.jamCID)
                    const isJamSyncing = syncingKeys.has(jamKey)
                    const jamProgress = syncProgressByKey[jamKey]
                    const isSynced = syncedJams.some((s) => s.jamCID === jam.jamCID)
                    return (
                      <button
                        key={jam.jamCID}
                        onClick={() => setSelectedJamCID(jam.jamCID)}
                        // Always attached, even for a jam this component's own
                        // isSynced check doesn't (yet) think is synced --
                        // syncedJams can lag reality (e.g. right after a sync
                        // finishes elsewhere, or an inaccurate/never-populated
                        // read on a jam that WAS actually synced in a past
                        // session), and gating the menu on it entirely hid the
                        // right-click affordance for real, previously-synced
                        // jams. Choosing "remove from sync" for a jam that
                        // truly has nothing synced is a safe, harmless no-op
                        // (removeJamSync's own deleteJamRows just finds
                        // nothing to delete), so there's no real downside to
                        // always offering it.
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setJamContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            jamCID: jam.jamCID,
                            jamName: jam.name
                          })
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          width: '100%',
                          textAlign: 'left',
                          padding: '5px 6px',
                          fontSize: 11,
                          border: 'none',
                          borderRadius: 0,
                          background:
                            selectedJamCID === jam.jamCID
                              ? 'var(--ra-bg-row-active)'
                              : 'transparent',
                          // Never-synced jams sit a shade dimmer than synced ones
                          // -- a color difference reads at a glance without the
                          // "(not synced)" suffix competing with the name for
                          // space, and synced/syncing jams keep full brightness.
                          color: isSynced || isJamSyncing ? 'var(--ra-text)' : 'var(--ra-text-2)'
                        }}
                      >
                        {isJamSyncing && <LoadingLoader size={10} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {jam.name}
                          {isJamSyncing &&
                            ` (syncing… ${(syncBaseCountByKey[jamKey] ?? 0) + (jamProgress?.done ?? 0)})`}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  {selectedJamCID === null && (
                    <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
                      select a jam to browse its rifffs
                    </div>
                  )}
                  {selectedJamCID !== null && (
                    <>
                      {/* Jam name + its sync trigger, right beside "where" this
                      content lives -- previously the sync button sat down in
                      the filter bar with everything else, easy to miss on a
                      never-synced jam since nothing about its position said
                      "this belongs to the jam you just picked." */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          flexWrap: 'wrap',
                          margin: '10px 12px 0'
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ra-text)' }}>
                          {visibleJams.find((j) => j.jamCID === selectedJamCID)?.name ??
                            selectedJamCID}
                        </span>
                        {authStatus.loggedIn && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                              {syncStatus
                                ? `synced: ${syncStatus.riffCount} riffs${syncStatus.complete ? '' : ' (partial)'}`
                                : 'not synced yet'}
                            </span>
                            <button
                              onClick={handleStartSync}
                              // Only disabled by THIS jam's own in-flight sync, not
                              // any other jam's -- see this component's own per-jam
                              // sync state doc comment (near syncingKeys'
                              // declaration) for the bug this fixed (a global
                              // `syncing` boolean left every jam's sync button
                              // disabled forever once you switched away from
                              // whichever jam happened to be syncing).
                              disabled={selectedSyncingHere}
                              // Matches the import button's own "primary action" weight
                              // (height 34 / fontSize 13 / fontWeight 700 / 2px border)
                              // rather than the tiny filter-bar utility styling this used
                              // to share with the "only fully cached" checkbox next to
                              // it — sync is the main thing this page does before you
                              // can browse anything at all, not a minor filter toggle.
                              // Highlighted (var(--ra-play-on)) specifically for the
                              // never-synced case, where clicking it isn't optional.
                              style={{
                                height: 34,
                                borderRadius: 0,
                                padding: '0 16px',
                                fontSize: 13,
                                fontWeight: 700,
                                border: '2px solid var(--ra-border-strong)',
                                background: syncStatus
                                  ? 'var(--ra-bg-row-active)'
                                  : 'var(--ra-play-on)',
                                color: syncStatus ? 'var(--ra-text)' : 'var(--ra-play-on-ink)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8
                              }}
                            >
                              {selectedSyncingHere ? <LoadingLoader size={16} /> : 'sync'}
                            </button>
                            {selectedSyncingHere && (
                              <button
                                onClick={handleAbortSync}
                                style={{
                                  height: 34,
                                  borderRadius: 0,
                                  padding: '0 12px',
                                  fontSize: 11,
                                  border: '2px solid var(--ra-border-strong)',
                                  background: 'transparent',
                                  color: 'var(--ra-text)'
                                }}
                              >
                                cancel
                              </button>
                            )}
                            {selectedSyncingHere && selectedSyncProgress && (
                              <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                                synced {selectedSyncBaseCount + selectedSyncProgress.done} so far
                                {selectedSyncProgress.bytesDone > 0 &&
                                  ` (${bytesLabel(selectedSyncProgress.bytesDone)})`}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          margin: '8px 12px 0'
                        }}
                      >
                        <input
                          type="date"
                          value={dateFromFilter}
                          onChange={(e) => setDateFromFilter(e.target.value)}
                          title="from date"
                          style={{
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 6px'
                          }}
                        />
                        <input
                          type="date"
                          value={dateToFilter}
                          onChange={(e) => setDateToFilter(e.target.value)}
                          title="to date"
                          style={{
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 6px'
                          }}
                        />
                        <input
                          type="number"
                          value={bpmMinFilter}
                          onChange={(e) => setBpmMinFilter(e.target.value)}
                          placeholder="bpm min"
                          style={{
                            width: 60,
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 6px'
                          }}
                        />
                        <input
                          type="number"
                          value={bpmMaxFilter}
                          onChange={(e) => setBpmMaxFilter(e.target.value)}
                          placeholder="bpm max"
                          style={{
                            width: 60,
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 6px'
                          }}
                        />
                        <select
                          value={rootFilter}
                          onChange={(e) => setRootFilter(e.target.value)}
                          title="key filter -- root and scale must both be set"
                          style={{
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 4px'
                          }}
                        >
                          <option value="">key: any</option>
                          {RIFF_LIBRARY_ROOT_NAMES.map((name, i) => (
                            <option key={name} value={i}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={scaleFilter}
                          onChange={(e) => setScaleFilter(e.target.value)}
                          title="key filter -- root and scale must both be set"
                          style={{
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 4px'
                          }}
                        >
                          <option value="">scale: any</option>
                          {RIFF_LIBRARY_SCALE_NAMES.map((name, i) => (
                            <option key={name} value={i}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={userNameFilter}
                          onChange={(e) => setUserNameFilter(e.target.value)}
                          placeholder="username"
                          style={{
                            width: 100,
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 6px'
                          }}
                        />
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10,
                            color: 'var(--ra-text-2)'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={onlyFullyCached}
                            onChange={(e) => setOnlyFullyCached(e.target.checked)}
                          />
                          only fully cached
                        </label>
                        <span
                          style={{
                            width: 1,
                            alignSelf: 'stretch',
                            background: 'var(--ra-border)'
                          }}
                        />
                        <input
                          type="text"
                          value={riffLibraryUsername}
                          onChange={(e) => setRiffLibraryUsername(e.target.value)}
                          placeholder="your username"
                          title="your username — drives the ownership coloring below and the 'only mine' filter, saved on this machine"
                          style={{
                            width: 100,
                            height: 22,
                            fontSize: 10,
                            background: 'var(--ra-bg-row-active)',
                            color: 'var(--ra-text)',
                            border: '1px solid var(--ra-border)',
                            borderRadius: 0,
                            padding: '0 6px'
                          }}
                        />
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10,
                            color: 'var(--ra-text-2)'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={onlyContainsMe}
                            onChange={(e) => setOnlyContainsMe(e.target.checked)}
                          />
                          only mine
                        </label>
                        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                          {riffs.length} rifffs{hasMoreRiffs ? '+' : ''}
                        </span>
                      </div>

                      <div
                        ref={gridRef}
                        onScroll={(e) => {
                          // Fires more auto-loading than a bottom-edge-only check
                          // would strictly need, but handleLoadMore's own
                          // loadingMoreRiffs guard already makes repeat calls a
                          // no-op while a page is in flight, so there's no real
                          // cost to checking on every scroll event rather than
                          // debouncing.
                          if (!hasMoreRiffs || loadingMoreRiffs) return
                          const el = e.currentTarget
                          const distanceFromBottom =
                            el.scrollHeight - el.scrollTop - el.clientHeight
                          if (distanceFromBottom < SCROLL_LOAD_MORE_THRESHOLD_PX) handleLoadMore()
                        }}
                        style={{
                          margin: '10px 12px 0',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          overflowY: 'auto',
                          flex: 1
                        }}
                      >
                        {riffGroups.map((group) => (
                          <div key={group.label}>
                            <span
                              className="ra-eyebrow"
                              style={{ fontSize: 8, display: 'block', marginBottom: 4 }}
                            >
                              {group.label}
                            </span>
                            {group.tempoGroups.map((tempoGroup) => (
                              <div key={tempoGroup.bpm} style={{ marginBottom: 6 }}>
                                <span
                                  style={{
                                    fontSize: 8,
                                    color: 'var(--ra-text-3)',
                                    display: 'block',
                                    marginBottom: 3
                                  }}
                                >
                                  {tempoGroup.bpm} BPM
                                </span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                  {tempoGroup.riffs.map((riff) => (
                                    <div
                                      key={riff.riffCID}
                                      ref={(el) => {
                                        if (el) riffNodeRefs.current.set(riff.riffCID, el)
                                        else riffNodeRefs.current.delete(riff.riffCID)
                                      }}
                                    >
                                      <RiffCircle
                                        title={`${formatBpm(riff.bpm)} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                                        selected={selectedRiffCID === riff.riffCID}
                                        multiSelected={
                                          selectedRiffCID !== riff.riffCID &&
                                          selectedRiffCIDs.has(riff.riffCID)
                                        }
                                        playing={
                                          selectedRiffCID === riff.riffCID &&
                                          playingRiffCID === riff.riffCID
                                        }
                                        fullyCached={riff.cachedStemCount >= riff.stemCount}
                                        imported={importedRiffGroupIds.has(riff.riffCID)}
                                        ownerFraction={riff.ownerFraction}
                                        favorited={riffFavourites.has(riff.riffCID)}
                                        onClick={(e) => handleRiffClick(e, riff.riffCID)}
                                        onContextMenu={(e) => {
                                          e.preventDefault()
                                          toggleRiffFavourite(riff.riffCID)
                                        }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                        {/* Loading more happens automatically on scroll (see the
                        container's own onScroll above) — this is feedback
                        only, not a control. */}
                        {loadingMoreRiffs && (
                          <span
                            style={{
                              alignSelf: 'flex-start',
                              fontSize: 9,
                              color: 'var(--ra-text-3)'
                            }}
                          >
                            loading…
                          </span>
                        )}
                      </div>

                      {resolvedRiff && (
                        <div
                          style={{
                            display: 'flex',
                            gap: 10,
                            alignItems: 'center',
                            margin: '10px 12px'
                          }}
                        >
                          <PolarGlyph
                            stems={resolvedRiff.stems
                              .filter((s) => s.path !== null)
                              .map((s) => ({
                                slot: s.slot,
                                author: s.creatorUserName,
                                name: s.presetName,
                                type:
                                  instrumentMaskToSoundType(s.instrumentMask) ??
                                  guessSoundTypeFromPresetName(s.presetName) ??
                                  'fx',
                                path: s.path!,
                                durationSec: s.durationSec,
                                barLength: s.barLength
                              }))}
                            identityColor={typeColorVar('fx')}
                            size={40}
                          />
                          <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                            {formatBpm(resolvedRiff.bpm)} BPM · {resolvedRiff.stems.length} stems (
                            {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                            <div style={{ marginTop: 2, color: 'var(--ra-text-3)' }}>
                              {resolvedRiff.stems.map((s) => s.creatorUserName || '?').join(', ')}
                            </div>
                          </div>
                          {resolvedRiff.stems.some((s) => s.path === null) && (
                            <button
                              onClick={() => {
                                if (!selectedRiffCID) return
                                setBusy('downloading stems…')
                                void ensureStemsDownloaded(selectedRiffCID, resolvedRiff).finally(
                                  () => setBusy(null)
                                )
                              }}
                              disabled={downloadingRiffCID !== null}
                              title="fetch missing stems directly from Endlesss's cloud storage — no LORE login needed, they're public files"
                              style={{
                                height: 24,
                                borderRadius: 0,
                                padding: '0 10px',
                                fontSize: 10,
                                border: '1px solid var(--ra-border)',
                                background: 'var(--ra-bg-row-active)',
                                color:
                                  downloadingRiffCID !== null
                                    ? 'var(--ra-text-4)'
                                    : 'var(--ra-text-2)'
                              }}
                            >
                              {downloadingRiffCID === selectedRiffCID
                                ? 'downloading…'
                                : 'download missing stems'}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (selectedRiffCIDs.size > 1) {
                                void handleImportSelected()
                              } else {
                                void handleImport()
                              }
                            }}
                            // No longer disabled just because nothing's cached yet — Import
                            // itself now auto-fetches missing stems first (ensureStemsDownloaded
                            // above), so a riff with zero cached stems is still importable, just
                            // slower. importResolvedRiff already no-ops safely (returns null) if
                            // that fetch fails and truly nothing ends up cached.
                            disabled={downloadingRiffCID !== null}
                            style={{
                              height: 34,
                              borderRadius: 0,
                              padding: '0 20px',
                              fontSize: 13,
                              fontWeight: 700,
                              border: '2px solid var(--ra-border-strong)',
                              background:
                                selectedRiffCID !== null &&
                                importedRiffGroupIds.has(selectedRiffCID)
                                  ? 'var(--ra-stretch-on-bg)'
                                  : 'var(--ra-bg-row-active)',
                              color:
                                selectedRiffCID !== null &&
                                importedRiffGroupIds.has(selectedRiffCID)
                                  ? 'var(--ra-stretch-on)'
                                  : 'var(--ra-text)'
                            }}
                          >
                            {selectedRiffCIDs.size > 1
                              ? `import ${selectedRiffCIDs.size} rifffs to project`
                              : selectedRiffCID !== null &&
                                  importedRiffGroupIds.has(selectedRiffCID)
                                ? 'imported to project ✓ — import again'
                                : 'import to project'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {libraryMode === 'discover' && (
          <DiscoverPanel
            currentSketch={currentSketch}
            slots={discoverSlots}
            setSlots={setDiscoverSlots}
            chaos={discoverChaos}
            setChaos={setDiscoverChaos}
            undoStack={discoverUndoStack}
            setUndoStack={setDiscoverUndoStack}
            redoStack={discoverRedoStack}
            setRedoStack={setDiscoverRedoStack}
            currentUsername={riffLibraryUsername}
            discoverConsented={discoverConsented}
            setDiscoverConsented={setDiscoverConsented}
          />
        )}
      </div>
      {/* Rendered INSIDE the modal's own zIndex:1000 stacking context
            (not as a sibling of it) -- ContextMenu's own zIndex is only 20,
            which is plenty to sit above everything else in here (nothing
            else in this modal sets an explicit z-index), but is nowhere
            near enough to beat the modal backdrop's 1000 if rendered as a
            sibling instead. That was a real bug: the menu opened (state
            updated, component mounted) but rendered fully hidden behind
            the backdrop, reading as "right-click does nothing" even
            though the handler itself was firing correctly. */}
      {jamContextMenu && (
        <ContextMenu
          x={jamContextMenu.x}
          y={jamContextMenu.y}
          onClose={() => setJamContextMenu(null)}
          items={[
            {
              label: 'remove from sync',
              onClick: () =>
                handleRemoveJamSync(jamContextMenu.jamCID, jamContextMenu.jamName, false)
            },
            {
              label: 'remove from sync + delete audio files',
              danger: true,
              onClick: () =>
                handleRemoveJamSync(jamContextMenu.jamCID, jamContextMenu.jamName, true)
            }
          ]}
        />
      )}
    </div>
  )
}
