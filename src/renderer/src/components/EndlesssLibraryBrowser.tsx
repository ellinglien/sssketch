import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoreJam, LoreResolvedRiff, LoreRiffSummary } from '@shared/loreLibrary'
import { computeOwnerFraction } from '@shared/loreLibrary'
import { sqrtGain } from '@shared/mixGain'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { buildImportedRifff } from '../audio/importResolvedRiff'
import { usePlaying, useDispatch, useAppState } from '../state/StoreContext'
import { useBusy } from '../state/BusyContext'
import { formatBpm } from '@shared/format'
import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { EndlesssLoginPanel } from './EndlesssLoginPanel'
import { riffCircleColor } from '../theme/riffCircleColor'
import { LoadingLoader } from './LoadingLoader'

const SHARED_FEED_STORAGE_KEY = 'sssketch:endlesssSharedFeedUsername'
const SHARED_FEED_PAGE_SIZE = 30

// How many riffs past the one just selected to warm the local stem cache
// for in the background -- the person browsing is very likely to click one
// of the next few next, especially when stepping through chronologically,
// so this makes that step feel instant instead of re-triggering the same
// resolve-then-download round trip on every click.
const PREFETCH_COUNT = 3

// Ceiling on how many riffs the fill-the-visible-area auto-load effects
// (below) will fetch on their own before giving up and leaving the rest to
// manual "load more"/scrolling. Without this, a tall modal against a feed
// with hundreds of riffs (SHARED_FEED_PAGE_SIZE is only 30) chain-fetches
// page after page in the background the moment a tab/jam opens -- confirmed
// live as a real regression: clicking a riff while that chain is still
// running visibly stalls (the click's own resolve queues behind the
// in-flight background requests), so nothing plays until the chain finally
// stops. 120 is enough to make a freshly opened tab look reasonably
// populated without turning "fill the space" into "fetch the whole feed."
const AUTO_FILL_MAX_RIFFS = 120

type EndlesssTab = 'shared-feed' | 'private-jams'
type AuthStatus =
  { loggedIn: false } | { loggedIn: true; userId: string; username: string; expiresAt: number }

interface RiffDateGroup {
  label: string
  riffs: LoreRiffSummary[]
}

/** Groups riffs by local calendar date -- without this, a jam's riff grid is
 * an undifferentiated wall of identically-sized, identically-colored circles
 * (Endlesss-direct listings carry no bpm at list time, unlike LORE's own
 * listRiffs, so there's no tempo axis to sub-group by here). Switching
 * between jams with no visual date breaks makes it look like nothing
 * happened even when the riff set genuinely changed -- see
 * LoreLibraryBrowser.tsx's own groupRiffsByDateAndTempo for the same idea
 * with a tempo axis added on top. Riffs already arrive sorted by
 * creationTime DESC (see listRiffsInJam), so a single linear scan suffices. */
function groupRiffsByDate(riffs: LoreRiffSummary[]): RiffDateGroup[] {
  const groups: RiffDateGroup[] = []
  for (const riff of riffs) {
    const label = new Date(riff.creationTime * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
    let group = groups[groups.length - 1]
    if (!group || group.label !== label) {
      group = { label, riffs: [] }
      groups.push(group)
    }
    group.riffs.push(riff)
  }
  return groups
}

/** True if `jamName` is exactly the account's own username, OR the
 * username repeated back-to-back some whole number of times ("elling",
 * "ellingelling", etc.) -- confirmed live that at least one real personal
 * jam is named with the username doubled, not just once, so a plain
 * equality check missed it entirely (the jam list came back empty). Still
 * deliberately NOT a substring match -- see the filter's own doc comment
 * for why that let through every collab jam that merely mentions the
 * person by name. */
function isPersonalJamName(jamName: string, username: string): boolean {
  const name = jamName.trim().toLowerCase()
  const user = username.trim().toLowerCase()
  if (user === '' || name === '' || name.length % user.length !== 0) return false
  return name === user.repeat(name.length / user.length)
}

/** One riff's preview circle -- shared between the shared-feed and
 * private-jams tabs so both get the same click/pulse/imported-badge
 * behavior for free rather than reimplementing it twice. `playing` drives
 * the fade-in/out brightness pulse (reuses RifffBlockRow.tsx's own
 * `ra-rec-pulse` keyframe by name -- duplicate `@keyframes` declarations
 * with identical rules are harmless, so this file mounts its own copy via
 * <style> rather than depending on that component happening to have
 * mounted first). onClick receives the raw MouseEvent (not just a plain
 * callback) so the CALLER can read shiftKey/metaKey/ctrlKey for
 * shift/cmd-click multi-select -- see EndlesssLibraryBrowser's own
 * handleRiffClick, mirroring LoreLibraryBrowser.tsx's identical pattern. A
 * plain click toggles: selecting the already-selected riff calls onClick
 * with the same riffCID again, and the caller turns that into a deselect. */
function RiffCircle({
  title,
  selected,
  multiSelected,
  playing,
  fullyCached,
  imported,
  ownerFraction,
  onClick
}: {
  title: string
  selected: boolean
  /** In the batch (shift/cmd-click) selection but NOT the anchor -- gets
   * its own, weaker ring than `selected`'s. See handleRiffClick. */
  multiSelected: boolean
  playing: boolean
  fullyCached: boolean
  imported: boolean
  /** 0-1, drives brightness the same way LORE's own riff circles do -- see
   * riffCircleColor. Endlesss-direct listings don't always have this at
   * list time (only the shared-feed path does, since its listing response
   * embeds full stem docs; the private-jam path fills it in progressively
   * as riffs get resolved/prefetched -- see jamOwnerFractions). */
  ownerFraction: number
  onClick: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div style={{ position: 'relative', width: 18, height: 18 }}>
      <button
        onClick={onClick}
        title={title}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          // Same cue hierarchy as LoreLibraryBrowser's own riff circles:
          // anchor selection ring, then batch-selection ring, then "not
          // everything's downloaded yet" (dashed), else a plain solid
          // border -- see downloadMissingStemsFor, already wired to fetch
          // whatever's missing the moment a riff is selected, so showing
          // the circle before it's fully cached is safe.
          border: selected
            ? '2px solid var(--ra-playhead)'
            : multiSelected
              ? '2px solid var(--ra-stretch-on)'
              : fullyCached
                ? '1px solid var(--ra-border)'
                : '1px dashed var(--ra-text-3)',
          padding: 0,
          background: riffCircleColor(ownerFraction),
          cursor: 'pointer',
          animation: playing ? 'ra-rec-pulse 1.4s ease-in-out infinite' : undefined
        }}
      />
      {imported && (
        <span
          title="already imported"
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--ra-stretch-on)',
            border: '1px solid var(--ra-bg-bar)',
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  )
}

export function EndlesssLibraryBrowser({
  onClose,
  onImported,
  onSwitchToLore
}: {
  onClose: () => void
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  /** Called when the user clicks the "lore library" tab -- App.tsx owns
   * which browser component is actually mounted (see the App.tsx wiring
   * task). */
  onSwitchToLore: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<EndlesssTab>('shared-feed')
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ loggedIn: false })

  const [feedUsername, setFeedUsername] = useState(
    () => localStorage.getItem(SHARED_FEED_STORAGE_KEY) ?? ''
  )
  useEffect(() => {
    try {
      localStorage.setItem(SHARED_FEED_STORAGE_KEY, feedUsername)
    } catch {
      // localStorage unavailable -- not worth surfacing as an error
    }
  }, [feedUsername])

  const [feedRiffs, setFeedRiffs] = useState<LoreRiffSummary[]>([])
  const feedRiffGroups = useMemo(() => groupRiffsByDate(feedRiffs), [feedRiffs])
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedNextOffset, setFeedNextOffset] = useState(0)
  const [feedLoading, setFeedLoading] = useState(false)
  // Measured to decide whether to auto-load more pages -- see the
  // fill-the-visible-area effect below.
  const feedGridRef = useRef<HTMLDivElement>(null)
  const jamGridRef = useRef<HTMLDivElement>(null)

  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  // The batch/multi-selection (shift-click range, cmd/ctrl-click toggle) --
  // separate from selectedRiffCID, which remains the "anchor" riff that
  // drives preview/detail-line exactly as before. A plain click always
  // collapses this back down to just that one riff (or empty, on
  // toggle-off). Mirrors LoreLibraryBrowser.tsx's own selectedRiffCIDs.
  const [selectedRiffCIDs, setSelectedRiffCIDs] = useState<Set<string>>(new Set())
  const [resolvedRiff, setResolvedRiff] = useState<LoreResolvedRiff | null>(null)
  // Which riffCID, if any, actually has live audio sources playing right
  // now -- NOT the same thing as "a riff is resolved/selected". Resolving
  // can legitimately finish with zero playable stems (stem download failed,
  // or every stem in the riff turned out undownloadable -- see
  // downloadMissingStemsFor), in which case there's nothing to play even
  // though resolvedRiff is non-null. Driving the circle's pulse off
  // resolvedRiff alone made the UI lie in that case: the circle would fade
  // in/out forever with no audio ever actually starting. Set only in the
  // async .then once sources are actually pushed; deliberately NOT reset to
  // null by stopPreview itself (that would be a synchronous setState call
  // inside an effect body, which react-hooks/set-state-in-effect correctly
  // flags) -- instead each RiffCircle's `playing` prop below also requires
  // `selectedRiffCID === riff.riffCID`, which already flips to false the
  // instant selection changes (a plain state update from the click handler,
  // visible on the very next render, well before the resolve effect even
  // runs) -- so the stale riffCID left behind here never renders as playing.
  const [playingRiffCID, setPlayingRiffCID] = useState<string | null>(null)
  // Set once startPreviewLoop's attempt for a riff has SETTLED, regardless
  // of outcome -- distinct from playingRiffCID (which only ever gets set on
  // success). Used to gate the "no audio available" message below on
  // whether playback was genuinely tried and failed, rather than on a
  // proxy signal like "every stem's path is null" -- that proxy missed a
  // real case seen live: some stems WERE cached (so the old check didn't
  // fire), yet nothing played and no message showed either, silently.
  // Checking previewAttemptedForCID === selectedRiffCID && playingRiffCID
  // !== selectedRiffCID catches any "we tried, it didn't work" outcome,
  // whatever the underlying reason.
  const [previewAttemptedForCID, setPreviewAttemptedForCID] = useState<string | null>(null)
  const [importedRiffGroupIds, setImportedRiffGroupIds] = useState<Map<string, string>>(new Map())
  const [busyRiffCID, setBusyRiffCID] = useState<string | null>(null)
  const previewTokenRef = useRef(0)
  // Shared accumulator across BOTH resolve effects (shared-feed's and jam's)
  // -- mirrors LoreLibraryBrowser.tsx's own previewSourcesRef exactly, and
  // for the same reason: a per-effect-run closure over just that run's own
  // `sources` array isn't enough. startPreviewLoop's decode is itself async,
  // so a stale run (superseded by a newer riff selection before it finishes)
  // can still land AFTER the newer run has already registered its own
  // preview as "active" -- nothing would ever stop the stale run's sources,
  // since unregisterActivePreview only clears whichever stop function is
  // CURRENTLY registered, not ones a later run silently overwrote. Pushing
  // every run's sources onto one shared, ref-stable array and having
  // stopPreview() (called eagerly at the top of every new run, and on
  // unmount) stop everything currently in it -- not just the latest run's
  // own sources -- closes that gap: even a late-arriving stale resolve gets
  // swept up the next time selection changes.
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])

  const stopPreview = useCallback(() => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  const [jams, setJams] = useState<LoreJam[]>([])
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)
  const [jamRiffs, setJamRiffs] = useState<LoreRiffSummary[]>([])
  const jamRiffGroups = useMemo(() => groupRiffsByDate(jamRiffs), [jamRiffs])
  const [jamRiffsHasMore, setJamRiffsHasMore] = useState(false)
  const [jamRiffsNextOffset, setJamRiffsNextOffset] = useState(0)
  const [jamRiffsLoading, setJamRiffsLoading] = useState(false)
  // ownerFraction, filled in progressively as jam riffs get resolved
  // (selection or prefetch) -- see the private-jams resolve effect and the
  // jam prefetch effect below. Endlesss's lightweight rifffLoopsByCreateTime
  // view (listRiffsInJam) has no per-stem creator info, unlike the
  // shared-feed listing, which embeds full stem docs and can compute
  // ownerFraction eagerly server-side (see endlesssApi.ts).
  const [jamOwnerFractions, setJamOwnerFractions] = useState<Map<string, number>>(new Map())

  const [feedSyncStatus, setFeedSyncStatus] = useState<{
    riffCount: number
    updatedAt: number
    complete: boolean
  } | null>(null)
  const [jamSyncStatus, setJamSyncStatus] = useState<{
    riffCount: number
    updatedAt: number
    complete: boolean
  } | null>(null)
  // { done, total } while a sync for the CURRENTLY relevant source/jam is
  // running, null otherwise. Filtered from the broadcast onEndlesssSyncProgress
  // stream (which covers every source, not just whichever this component
  // cares about right now) down to just shared-feed and the selected jam.
  const [feedSyncProgress, setFeedSyncProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  const [jamSyncProgress, setJamSyncProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  // Whether a sync is currently believed to be in flight -- deliberately
  // separate from feedSyncProgress/jamSyncProgress's {done,total} shape.
  // Confirmed live: the walk phase (paging through listSharedFeed/
  // listRiffsInJam to find what's new) can take real time with zero
  // progress events, since total isn't known until the walk finishes and
  // the resolve phase starts. Driving "is syncing" off the optimistic
  // {done:0, total:0} set on click via `done < total` reads as false
  // (0 < 0), so the button silently reverted to its idle label the instant
  // it was clicked and looked entirely unresponsive for however long the
  // walk took -- this flag stays true from click until the matching
  // progress event actually reports done === total, independent of what
  // those numbers are.
  const [feedSyncing, setFeedSyncing] = useState(false)
  const [jamSyncing, setJamSyncing] = useState(false)
  // Snapshot of feedSyncStatus/jamSyncStatus's riffCount taken the moment a
  // sync starts -- lets the "synced: N riffs" status line count up live
  // (baseCount + progress.done) as riffs actually land in the index during
  // the resolve phase, without polling endlesssSyncStatus*() on every
  // single progress event (that re-reads and re-parses the WHOLE index
  // file off disk each call -- fine once at the end, wasteful dozens/
  // hundreds of times over the course of one sync).
  const [feedSyncBaseCount, setFeedSyncBaseCount] = useState(0)
  const [jamSyncBaseCount, setJamSyncBaseCount] = useState(0)

  const playing = usePlaying()
  const dispatch = useDispatch()
  const state = useAppState()
  const setBusy = useBusy()

  // Auto-effective username: whoever's logged in, once authenticated --
  // matches the design spec's "logging in swaps the plain username lookup
  // for the authenticated session automatically" UX. Logging in already
  // identifies the account by username (it's the only credential Endlesss
  // login uses besides the password), so asking for it a second time here
  // would be pure redundancy -- the manual field only matters pre-login, for
  // the "peek at a public feed with no account" quick path.
  const effectiveUsername = authStatus.loggedIn ? authStatus.username : feedUsername.trim()

  // Only used for the scroll-triggered "load more" (append) case, invoked
  // from the onScroll event handler below -- a synchronous setFeedLoading(true)
  // there is fine (matches LoreLibraryBrowser.tsx's own handleLoadMore, which
  // is likewise event-handler-triggered, not effect-triggered). The initial
  // per-tab/username load is handled separately below without going through
  // this function, since calling it synchronously from a useEffect body trips
  // the react-hooks/set-state-in-effect rule.
  function loadFeed(offset: number, append: boolean): void {
    if (effectiveUsername === '') return
    setFeedLoading(true)
    window.rifffApi
      .endlesssListSharedFeed(effectiveUsername, offset, SHARED_FEED_PAGE_SIZE)
      .then((page) => {
        setFeedRiffs((prev) => (append ? [...prev, ...page.riffs] : page.riffs))
        setFeedHasMore(page.hasMore)
        setFeedNextOffset(page.nextOffset)
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListSharedFeed() failed:', err)
      })
      .finally(() => setFeedLoading(false))
  }

  // Tracks the last (tab, username) pair seen -- compared during render
  // (not in an effect) so switching tabs/usernames clears the stale riff
  // selection (and primes the loading flag) in the same render pass,
  // matching LoreLibraryBrowser.tsx's own resetForJamCID pattern rather
  // than calling setState synchronously inside a useEffect body.
  //
  // The key itself must be updated on EVERY render where it changes,
  // regardless of which tab is active -- gating the update behind
  // `tab === 'shared-feed'` (as an earlier version of this code did) lets
  // resetForFeedKey go stale while the user is away on the private-jams
  // tab: switching shared-feed -> private-jams -> back to shared-feed with
  // the SAME username would recompute the same feedKey the stale ref still
  // holds, so the reset below would silently fail to fire and leave a
  // stale selection/preview pointing at whatever was selected before the
  // user left the tab. Both tabs' reset *bodies* clear selection/preview
  // state on entry (private-jams just skips the shared-feed-only
  // feedLoading priming) -- symmetric on purpose, since a riff selected on
  // one tab must never leak into the other tab's import panel.
  const [resetForFeedKey, setResetForFeedKey] = useState<string | null>(null)
  const feedKey = `${tab}:${effectiveUsername}`
  if (feedKey !== resetForFeedKey) {
    setResetForFeedKey(feedKey)
    if (tab === 'shared-feed') {
      setSelectedRiffCID(null)
      setSelectedRiffCIDs(new Set())
      setResolvedRiff(null)
      setFeedLoading(effectiveUsername !== '')
    } else if (tab === 'private-jams') {
      setSelectedRiffCID(null)
      setSelectedRiffCIDs(new Set())
      setResolvedRiff(null)
    }
  }

  useEffect(() => {
    if (tab !== 'shared-feed' || effectiveUsername === '') return
    let cancelled = false
    window.rifffApi
      .endlesssListSharedFeed(effectiveUsername, 0, SHARED_FEED_PAGE_SIZE)
      .then((page) => {
        if (cancelled) return
        setFeedRiffs(page.riffs)
        setFeedHasMore(page.hasMore)
        setFeedNextOffset(page.nextOffset)
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListSharedFeed() failed:', err)
      })
      .finally(() => {
        if (!cancelled) setFeedLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab, effectiveUsername])

  // Keeps loading more pages until the grid actually overflows its
  // container (or there's nothing left to load) -- SHARED_FEED_PAGE_SIZE's
  // 30 tiny circles didn't come close to filling this modal's height, so
  // the scroll-triggered load-more below never got a chance to fire: there
  // was nothing to scroll. Confirmed live -- a fresh feed rendered one
  // sparse row with a huge empty gap above the "load more" button. Deferred
  // through a microtask (not called directly) so the eventual
  // setFeedLoading(true) inside loadFeed doesn't read as a synchronous
  // setState-in-effect.
  useEffect(() => {
    if (tab !== 'shared-feed' || !feedHasMore || feedLoading) return
    if (feedRiffs.length >= AUTO_FILL_MAX_RIFFS) return
    const el = feedGridRef.current
    if (!el || el.scrollHeight > el.clientHeight) return
    void Promise.resolve().then(() => loadFeed(feedNextOffset, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFeed intentionally excluded, it's a plain function recreated every render, not a stable dependency
  }, [tab, feedRiffs, feedHasMore, feedLoading, feedNextOffset])

  useEffect(() => {
    // Eager, unconditional stop -- fires every time selectedRiffCID changes
    // (including to null, which is how clicking the already-selected riff
    // again toggles playback off), matching LoreLibraryBrowser.tsx's own
    // resolve effect exactly. This is what actually prevents overlapping
    // previews: stopPreview() sweeps up EVERYTHING in the shared
    // previewSourcesRef, including any not-yet-registered stale run whose
    // startPreviewLoop only just resolved -- see previewSourcesRef's own
    // doc comment for why a per-run closure alone isn't enough.
    stopPreview()
    if (!selectedRiffCID) return
    let cancelled = false
    window.rifffApi
      .endlesssResolveSharedFeedRiff(selectedRiffCID)
      .then(async (resolved) => {
        if (cancelled || !resolved) return
        setResolvedRiff(resolved)
        if (playing) dispatch({ type: 'PAUSE' })
        const cachedStems = resolved.stems.filter((s) => s.path !== null)
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
        previewSourcesRef.current.push(...sources)
        if (cancelled) return
        setPreviewAttemptedForCID(selectedRiffCID)
        if (sources.length > 0) {
          previewTokenRef.current = registerActivePreview(stopPreview)
          setPlayingRiffCID(selectedRiffCID)
        }
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssResolveSharedFeedRiff() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playing/dispatch/stopPreview intentionally excluded, matching LoreLibraryBrowser.tsx's own established pattern for this exact kind of effect
  }, [selectedRiffCID])

  // Warms the local stem cache for the next few riffs after the one just
  // selected -- resolveSharedFeedRiff's own downloadMissingStemsFor is a
  // no-op for anything already on disk, so calling it again once the user
  // actually clicks one of these is cheap; this just moves that download
  // earlier so it's usually already done by the time they get there.
  // Fire-and-forget: failures here aren't worth surfacing, the real resolve
  // on actual selection will report them normally.
  useEffect(() => {
    if (tab !== 'shared-feed' || !selectedRiffCID) return
    const idx = feedRiffs.findIndex((r) => r.riffCID === selectedRiffCID)
    if (idx === -1) return
    for (const riff of feedRiffs.slice(idx + 1, idx + 1 + PREFETCH_COUNT)) {
      window.rifffApi.endlesssResolveSharedFeedRiff(riff.riffCID).catch(() => {})
    }
  }, [tab, selectedRiffCID, feedRiffs])

  useEffect(() => {
    return () => stopPreview()
  }, [stopPreview])

  useEffect(() => {
    return window.rifffApi.onEndlesssSyncProgress((progress) => {
      if (progress.source === 'shared' && progress.key === effectiveUsername) {
        setFeedSyncProgress({ done: progress.done, total: progress.total })
        if (progress.done === progress.total) {
          setFeedSyncing(false)
          void window.rifffApi
            .endlesssSyncStatusSharedFeed(effectiveUsername)
            .then(setFeedSyncStatus)
        }
      }
      if (progress.source === 'jam' && progress.key === selectedJamCID) {
        setJamSyncProgress({ done: progress.done, total: progress.total })
        if (progress.done === progress.total && selectedJamCID) {
          setJamSyncing(false)
          void window.rifffApi.endlesssSyncStatusJam(selectedJamCID).then(setJamSyncStatus)
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveUsername/selectedJamCID intentionally excluded so this subscription is set up once; the callback reads their latest values via closure since it's re-created fresh each render but the subscription itself doesn't need to be torn down and rebuilt on every keystroke/selection change
  }, [])

  useEffect(() => {
    let cancelled = false
    if (tab !== 'shared-feed' || effectiveUsername === '') {
      // Deferred through a microtask (not called directly) so this doesn't
      // read as a synchronous setState-in-effect -- same established
      // workaround as the AUTO_FILL effects above.
      void Promise.resolve().then(() => {
        if (!cancelled) setFeedSyncStatus(null)
      })
      return () => {
        cancelled = true
      }
    }
    window.rifffApi.endlesssSyncStatusSharedFeed(effectiveUsername).then((status) => {
      if (!cancelled) setFeedSyncStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [tab, effectiveUsername])

  useEffect(() => {
    let cancelled = false
    if (!selectedJamCID) {
      void Promise.resolve().then(() => {
        if (!cancelled) setJamSyncStatus(null)
      })
      return () => {
        cancelled = true
      }
    }
    window.rifffApi.endlesssSyncStatusJam(selectedJamCID).then((status) => {
      if (!cancelled) setJamSyncStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [selectedJamCID])

  useEffect(() => {
    if (tab !== 'private-jams' || !authStatus.loggedIn) return
    let cancelled = false
    const username = authStatus.username
    window.rifffApi
      .endlesssListJams()
      .then((jams) => {
        if (cancelled) return
        // A membership view lists every jam the account has ever joined --
        // for an active account that's frequently dozens of collaborative
        // jams, most of which LORE's own browser already covers (it syncs
        // everything, this direct path is specifically for browsing WITHOUT
        // LORE). Per direct feedback: narrow this list down to jams that are
        // actually this person's own -- by Endlesss convention, a personal
        // jam's default (never-renamed) name is just the owner's username
        // (possibly repeated -- see isPersonalJamName). An earlier version
        // of this filter matched any jam whose name merely CONTAINED the
        // username, which still let through every collab/remix jam that
        // happens to mention them by name ("Elling's House of Pies", "Remix
        // Inspo: Elling", etc.) -- this is what actually isolates the real
        // personal jam(s).
        setJams(jams.filter((jam) => isPersonalJamName(jam.name, username)))
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListJams() failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [tab, authStatus])

  // Fetches ownerFraction for every riffCID in a freshly (or newly appended)
  // loaded jam page in one batched pass -- see endlesssApi.ts's own
  // listRiffOwnership doc comment for why this is cheap (two _all_docs
  // round trips regardless of page size, no audio ever downloaded). Without
  // this, jamOwnerFractions was only ever filled in by the resolve/prefetch
  // effects below, which only run once a riff is actually clicked -- every
  // circle read as an identical flat gray "mystery dot" until then, per
  // direct feedback ("hunting in the dark... clicking something hoping it
  // turns white").
  //
  // Queued and drained one at a time (ownershipInFlightRef), NOT fired
  // concurrently per page -- clicking "load more" repeatedly used to launch
  // a new heavy _all_docs batch on top of whatever was already in flight,
  // and confirmed live that this is exactly what made clicking a riff to
  // preview it stall: the click's own resolve request queued up behind a
  // pile of still-running ownership fetches on the same host. Capping
  // concurrency to 1 here keeps the wire free enough for an actual
  // click-to-play request to get through promptly; the queue still gets
  // through every page eventually, just serially instead of all at once.
  const ownershipQueueRef = useRef<{ jamId: string; riffCIDs: string[] }[]>([])
  const ownershipInFlightRef = useRef(false)

  function drainOwnershipQueue(): void {
    if (ownershipInFlightRef.current || !authStatus.loggedIn) return
    const next = ownershipQueueRef.current.shift()
    if (!next) return
    ownershipInFlightRef.current = true
    window.rifffApi
      .endlesssListRiffOwnership(next.jamId, next.riffCIDs, authStatus.username)
      .then((fractions) => {
        setJamOwnerFractions((prev) => {
          const merged = new Map(prev)
          for (const [riffCID, fraction] of Object.entries(fractions)) merged.set(riffCID, fraction)
          return merged
        })
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListRiffOwnership() failed:', err)
      })
      .finally(() => {
        ownershipInFlightRef.current = false
        drainOwnershipQueue()
      })
  }

  function fetchOwnershipFor(jamId: string, riffCIDs: string[]): void {
    if (!authStatus.loggedIn || riffCIDs.length === 0) return
    ownershipQueueRef.current.push({ jamId, riffCIDs })
    drainOwnershipQueue()
  }

  useEffect(() => {
    if (!selectedJamCID) return
    let cancelled = false
    window.rifffApi
      .endlesssListRiffs(selectedJamCID, {})
      .then((page) => {
        if (cancelled) return
        setJamRiffs(page.riffs)
        setJamRiffsHasMore(page.hasMore)
        setJamRiffsNextOffset(page.nextOffset)
        fetchOwnershipFor(
          selectedJamCID,
          page.riffs.map((r) => r.riffCID)
        )
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListRiffs() failed:', err)
      })
      .finally(() => {
        if (!cancelled) setJamRiffsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchOwnershipFor intentionally excluded, it's a plain function recreated every render (closes over authStatus) not a stable dependency; including it would re-run this effect on every render
  }, [selectedJamCID])

  function loadMoreJamRiffs(): void {
    if (!selectedJamCID || jamRiffsLoading) return
    setJamRiffsLoading(true)
    window.rifffApi
      .endlesssListRiffs(selectedJamCID, { offset: jamRiffsNextOffset })
      .then((page) => {
        setJamRiffs((prev) => [...prev, ...page.riffs])
        setJamRiffsHasMore(page.hasMore)
        setJamRiffsNextOffset(page.nextOffset)
        fetchOwnershipFor(
          selectedJamCID,
          page.riffs.map((r) => r.riffCID)
        )
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListRiffs() (load more) failed:', err)
      })
      .finally(() => setJamRiffsLoading(false))
  }

  // Same fill-the-visible-area idea as the shared-feed grid above -- DEFAULT_RIFF_PAGE_SIZE
  // (200) usually already overflows this modal on its own, but a small jam
  // shouldn't be left with the same sparse-page/dead-scroll problem just
  // because it happens to have fewer riffs than that.
  useEffect(() => {
    if (!selectedJamCID || !jamRiffsHasMore || jamRiffsLoading) return
    if (jamRiffs.length >= AUTO_FILL_MAX_RIFFS) return
    const el = jamGridRef.current
    if (!el || el.scrollHeight > el.clientHeight) return
    void Promise.resolve().then(() => loadMoreJamRiffs())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMoreJamRiffs intentionally excluded, it's a plain function recreated every render, not a stable dependency
  }, [selectedJamCID, jamRiffs, jamRiffsHasMore, jamRiffsLoading])

  useEffect(() => {
    // Eager, unconditional stop -- see the shared-feed resolve effect's own
    // doc comment for why this (not the cleanup below) is what actually
    // prevents overlapping previews.
    stopPreview()
    if (tab !== 'private-jams' || !selectedRiffCID || !selectedJamCID) return
    let cancelled = false
    window.rifffApi
      .endlesssResolveRiff(selectedJamCID, selectedRiffCID)
      .then(async (resolved) => {
        if (cancelled || !resolved) return
        setResolvedRiff(resolved)
        if (authStatus.loggedIn) {
          const fraction = computeOwnerFraction(
            resolved.stems.map((s) => s.creatorUserName),
            authStatus.username
          )
          setJamOwnerFractions((prev) => new Map(prev).set(selectedRiffCID, fraction))
        }
        if (playing) dispatch({ type: 'PAUSE' })
        const cachedStems = resolved.stems.filter((s) => s.path !== null)
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
        previewSourcesRef.current.push(...sources)
        if (cancelled) return
        setPreviewAttemptedForCID(selectedRiffCID)
        if (sources.length > 0) {
          previewTokenRef.current = registerActivePreview(stopPreview)
          setPlayingRiffCID(selectedRiffCID)
        }
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssResolveRiff() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches the shared-feed resolve effect's own established exclusions
  }, [tab, selectedJamCID, selectedRiffCID])

  // Same idea as the shared-feed prefetch effect above, plus this is also
  // how jamOwnerFractions gets filled in for riffs the person hasn't
  // explicitly clicked yet -- resolving downloads stem docs (with
  // creatorUserName) as a side effect regardless of why it was triggered.
  useEffect(() => {
    if (tab !== 'private-jams' || !selectedJamCID || !selectedRiffCID || !authStatus.loggedIn) {
      return
    }
    const idx = jamRiffs.findIndex((r) => r.riffCID === selectedRiffCID)
    if (idx === -1) return
    const username = authStatus.username
    for (const riff of jamRiffs.slice(idx + 1, idx + 1 + PREFETCH_COUNT)) {
      window.rifffApi
        .endlesssResolveRiff(selectedJamCID, riff.riffCID)
        .then((resolved) => {
          if (!resolved) return
          const fraction = computeOwnerFraction(
            resolved.stems.map((s) => s.creatorUserName),
            username
          )
          setJamOwnerFractions((prev) => new Map(prev).set(riff.riffCID, fraction))
        })
        .catch(() => {})
    }
  }, [tab, selectedJamCID, selectedRiffCID, jamRiffs, authStatus])

  /** Shared core of both single-riff Import and the cmd/shift-click batch
   * Import below -- builds the Rifff, dispatches it onto the shelf (and its
   * per-stem volume overrides) if there's anything new to add, and tracks
   * the riffCID -> groupId mapping either way. Deliberately does NOT call
   * onImported or touch busy state itself, since the batch path needs to
   * accumulate every riff's result across a loop before firing onImported
   * once at the end, rather than once per riff. */
  function importOneResolved(
    riffCID: string,
    resolved: LoreResolvedRiff
  ): { groupId: string; rifff: Rifff } | null {
    const existingGroupId = importedRiffGroupIds.get(riffCID)
    const existing = existingGroupId ? state.rifffs[existingGroupId] : undefined
    const folderPathLabel = tab === 'shared-feed' ? 'endlesss shared feed' : 'endlesss private jam'
    const result = buildImportedRifff(riffCID, resolved, existing, 'endlesss', folderPathLabel)
    if (!result) return null
    const { groupId, rifff, newStemSlots } = result
    if (newStemSlots.length > 0 || !existing) {
      dispatch({ type: 'ADD_TO_SHELF', rifff })
      for (const stem of resolved.stems.filter((s) => s.path !== null)) {
        if (Math.abs(stem.gain - 1.0) > 1e-6) {
          dispatch({
            type: 'SET_VOLUME',
            stemKey: stemKey(groupId, stem.slot),
            volume: stem.gain
          })
        }
      }
      setImportedRiffGroupIds((prev) => new Map(prev).set(riffCID, groupId))
    }
    return { groupId, rifff }
  }

  function handleImport(riffCID: string, resolved: LoreResolvedRiff): void {
    setBusy('importing rifff…')
    setBusyRiffCID(riffCID)
    try {
      const result = importOneResolved(riffCID, resolved)
      if (!result) return
      onImported([result.groupId], [result.rifff])
    } finally {
      setBusy(null)
      setBusyRiffCID(null)
    }
  }

  /** Batch import for shift/cmd-click multi-selection -- mirrors
   * LoreLibraryBrowser.tsx's own handleImportSelected. The anchor riff
   * (selectedRiffCID) reuses its already-resolved data (resolvedRiff, from
   * the preview effect) rather than re-fetching it; every other selected
   * riff is resolved on demand here, sequentially -- a handful of riffs
   * from one shift-click doesn't need anything fancier, and sequential
   * keeps per-riff failures easy to reason about (one bad riff logs and the
   * rest still import). Resolving differs by tab (shared-feed vs. a
   * specific jam), unlike LORE which only ever has one riff source. */
  async function handleImportSelected(): Promise<void> {
    if (tab === 'private-jams' && !selectedJamCID) return
    setBusy('importing rifffs…')
    try {
      const groupIds: string[] = []
      const rifffs: Rifff[] = []
      for (const riffCID of selectedRiffCIDs) {
        try {
          const resolved =
            riffCID === selectedRiffCID && resolvedRiff
              ? resolvedRiff
              : tab === 'shared-feed'
                ? await window.rifffApi.endlesssResolveSharedFeedRiff(riffCID)
                : await window.rifffApi.endlesssResolveRiff(selectedJamCID!, riffCID)
          if (resolved) {
            const result = importOneResolved(riffCID, resolved)
            if (result) {
              groupIds.push(result.groupId)
              rifffs.push(result.rifff)
            }
          }
        } catch (err) {
          console.error(
            `EndlesssLibraryBrowser: failed to import riff ${riffCID} during batch import:`,
            err
          )
        }
      }
      if (groupIds.length > 0) onImported(groupIds, rifffs)
    } finally {
      setBusy(null)
    }
  }

  /** Standard file-browser multi-select convention, mirroring
   * LoreLibraryBrowser.tsx's own handleRiffClick exactly: plain click
   * selects just this one riff (and becomes the new anchor/preview, or
   * deselects if it's already the anchor -- the toggle-to-stop behavior
   * this component already had); shift-click extends a contiguous range
   * from the current anchor to this riff, based on order in `riffList`
   * (the tab's own flat riff array -- feedRiffs or jamRiffs, NOT the
   * date-grouped view, though both share the same underlying order);
   * cmd/ctrl-click toggles this one riff in or out of the selection
   * without disturbing the rest, and moves the anchor to it. */
  function handleRiffClick(
    e: React.MouseEvent,
    riffCID: string,
    riffList: LoreRiffSummary[]
  ): void {
    if (e.shiftKey && selectedRiffCID) {
      const anchorIndex = riffList.findIndex((r) => r.riffCID === selectedRiffCID)
      const clickedIndex = riffList.findIndex((r) => r.riffCID === riffCID)
      if (anchorIndex === -1 || clickedIndex === -1) {
        setSelectedRiffCID(riffCID)
        setSelectedRiffCIDs(new Set([riffCID]))
        return
      }
      const [start, end] =
        anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
      setSelectedRiffCIDs(new Set(riffList.slice(start, end + 1).map((r) => r.riffCID)))
      // Anchor deliberately stays put -- repeated shift-clicks keep
      // extending/shrinking the range from the same starting point.
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
    const toggled = selectedRiffCID === riffCID ? null : riffCID
    setSelectedRiffCID(toggled)
    setSelectedRiffCIDs(toggled ? new Set([toggled]) : new Set())
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 900,
          height: 600,
          maxWidth: '90vw',
          maxHeight: '85vh',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Same keyframe name as RifffBlockRow.tsx's own rec-dot pulse --
            mounted here too (not shared) since RiffCircle needs it and this
            component doesn't otherwise depend on that one having rendered
            first; duplicate identical @keyframes rules are harmless. */}
        <style>{`
          @keyframes ra-rec-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.25; }
          }
        `}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onSwitchToLore}
              style={{
                fontSize: 10,
                color: 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              lore library
            </button>
            <button
              onClick={() => setTab('shared-feed')}
              className={tab === 'shared-feed' ? 'ra-eyebrow' : undefined}
              style={{
                fontSize: tab === 'shared-feed' ? undefined : 10,
                color: tab === 'shared-feed' ? undefined : 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              my shared feed
            </button>
            <button
              onClick={() => setTab('private-jams')}
              className={tab === 'private-jams' ? 'ra-eyebrow' : undefined}
              style={{
                fontSize: tab === 'private-jams' ? undefined : 10,
                color: tab === 'private-jams' ? undefined : 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              my private jam
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

        <div style={{ marginTop: 10 }}>
          <EndlesssLoginPanel onStatusChange={setAuthStatus} />
        </div>

        {tab === 'shared-feed' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginTop: 10,
              flex: 1,
              minHeight: 0
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {authStatus.loggedIn ? (
                <span style={{ fontSize: 11, color: 'var(--ra-text-2)' }}>
                  showing @{authStatus.username}&rsquo;s shared feed
                </span>
              ) : (
                <input
                  type="text"
                  value={feedUsername}
                  onChange={(e) => setFeedUsername(e.target.value)}
                  placeholder="endlesss username — no login needed for public shares"
                  style={{
                    height: 24,
                    fontSize: 11,
                    background: 'var(--ra-bg-row-active)',
                    color: 'var(--ra-text)',
                    border: '1px solid var(--ra-border)',
                    borderRadius: 0,
                    padding: '0 6px',
                    width: 260
                  }}
                />
              )}
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                {feedRiffs.length} rifffs{feedHasMore ? '+' : ''}
              </span>
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                {feedSyncing
                  ? feedSyncProgress && feedSyncProgress.done === 0 && feedSyncProgress.total > 0
                    ? `discovering… ${feedSyncProgress.total} found`
                    : `synced: ${feedSyncBaseCount + (feedSyncProgress?.done ?? 0)} rifffs so far`
                  : feedSyncStatus
                    ? `synced: ${feedSyncStatus.riffCount} rifffs${feedSyncStatus.complete ? '' : ' (partial)'}`
                    : 'not yet synced'}
              </span>
              <button
                onClick={() => {
                  setFeedSyncing(true)
                  setFeedSyncProgress(null)
                  setFeedSyncBaseCount(feedSyncStatus?.riffCount ?? 0)
                  window.rifffApi.endlesssStartSyncSharedFeed(effectiveUsername).catch((err) => {
                    console.error(
                      'EndlesssLibraryBrowser: endlesssStartSyncSharedFeed() failed:',
                      err
                    )
                    setFeedSyncing(false)
                  })
                }}
                disabled={feedSyncing}
                style={{
                  height: 20,
                  borderRadius: 0,
                  padding: '0 8px',
                  fontSize: 9,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {feedSyncing && <LoadingLoader size={16} />}
                {feedSyncing
                  ? feedSyncProgress !== null
                    ? `syncing… ${feedSyncProgress.done}/${feedSyncProgress.total}`
                    : 'syncing…'
                  : feedSyncStatus?.complete
                    ? 'check for new rifffs'
                    : 'sync for instant playback'}
              </button>
            </div>

            <div
              ref={feedGridRef}
              onScroll={(e) => {
                if (!feedHasMore || feedLoading) return
                const el = e.currentTarget
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 200)
                  loadFeed(feedNextOffset, true)
              }}
              style={{
                overflowY: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              {feedRiffGroups.map((group) => (
                <div key={group.label}>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--ra-text-3)',
                      display: 'block',
                      marginBottom: 3
                    }}
                  >
                    {group.label}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {group.riffs.map((riff) => (
                      <RiffCircle
                        key={riff.riffCID}
                        title={`${riff.userName || 'shared rifff'} · ${formatBpm(riff.bpm)} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                        selected={selectedRiffCID === riff.riffCID}
                        multiSelected={
                          selectedRiffCID !== riff.riffCID && selectedRiffCIDs.has(riff.riffCID)
                        }
                        playing={
                          selectedRiffCID === riff.riffCID && playingRiffCID === riff.riffCID
                        }
                        fullyCached={riff.cachedStemCount >= riff.stemCount}
                        imported={importedRiffGroupIds.has(riff.riffCID)}
                        ownerFraction={riff.ownerFraction}
                        onClick={(e) => handleRiffClick(e, riff.riffCID, feedRiffs)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {feedRiffs.length === 0 && !feedLoading && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  {effectiveUsername === ''
                    ? 'enter a username above to browse its shared feed'
                    : 'no shared rifffs found'}
                </div>
              )}
            </div>

            {feedHasMore && (
              <button
                onClick={() => loadFeed(feedNextOffset, true)}
                disabled={feedLoading}
                style={{
                  alignSelf: 'center',
                  height: 22,
                  borderRadius: 0,
                  padding: '0 12px',
                  fontSize: 10,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: feedLoading ? 'var(--ra-text-4)' : 'var(--ra-text-2)'
                }}
              >
                {feedLoading ? 'loading…' : 'load more'}
              </button>
            )}

            {/* Always rendered at a fixed height (not conditionally mounted)
                so this area doesn't appear/disappear as selection changes --
                confirmed live that a popping-in-and-out details bar reads as
                the whole panel flickering/jumping every time a riff gets
                selected or deselected. */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', height: 24 }}>
              <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                {resolvedRiff && selectedRiffCID ? (
                  <>
                    {formatBpm(resolvedRiff.bpm)} BPM · {resolvedRiff.stems.length} stems (
                    {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                    {resolvedRiff.stems.length > 0 &&
                      previewAttemptedForCID === selectedRiffCID &&
                      playingRiffCID !== selectedRiffCID && (
                        <span style={{ color: 'var(--ra-mute-on)' }}>
                          {' '}
                          · no audio available (
                          {resolvedRiff.stems.every((s) => s.path === null)
                            ? 'stems failed to download'
                            : 'cached but failed to play'}
                          )
                        </span>
                      )}
                  </>
                ) : (
                  <span style={{ color: 'var(--ra-text-3)' }}>select a rifff to preview</span>
                )}
              </div>
              <button
                onClick={() => {
                  if (!selectedRiffCID || !resolvedRiff) return
                  if (selectedRiffCIDs.size > 1) {
                    void handleImportSelected()
                  } else {
                    handleImport(selectedRiffCID, resolvedRiff)
                  }
                }}
                disabled={busyRiffCID !== null || !resolvedRiff || !selectedRiffCID}
                style={{
                  height: 24,
                  borderRadius: 0,
                  padding: '0 12px',
                  fontSize: 10,
                  border: '1px solid var(--ra-border-strong)',
                  background:
                    selectedRiffCID && importedRiffGroupIds.has(selectedRiffCID)
                      ? 'var(--ra-stretch-on-bg)'
                      : 'var(--ra-bg-row-active)',
                  color:
                    selectedRiffCID && importedRiffGroupIds.has(selectedRiffCID)
                      ? 'var(--ra-stretch-on)'
                      : 'var(--ra-text)'
                }}
              >
                {selectedRiffCIDs.size > 1
                  ? `import ${selectedRiffCIDs.size} rifffs`
                  : selectedRiffCID && importedRiffGroupIds.has(selectedRiffCID)
                    ? 'imported ✓ — import again'
                    : 'import'}
              </button>
            </div>
          </div>
        )}

        {tab === 'private-jams' && !authStatus.loggedIn && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-3)' }}>
            log in above to see your private jams
          </div>
        )}

        {tab === 'private-jams' && authStatus.loggedIn && (
          <div style={{ display: 'flex', gap: 12, marginTop: 10, flex: 1, minHeight: 0 }}>
            <div style={{ width: 200, flexShrink: 0, overflowY: 'auto' }}>
              {jams.map((jam) => (
                <button
                  key={jam.jamCID}
                  onClick={() => {
                    setSelectedJamCID(jam.jamCID)
                    setSelectedRiffCID(null)
                    setSelectedRiffCIDs(new Set())
                    setResolvedRiff(null)
                    setJamRiffsLoading(true)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 6px',
                    fontSize: 11,
                    border: 'none',
                    borderRadius: 0,
                    background:
                      selectedJamCID === jam.jamCID ? 'var(--ra-bg-row-active)' : 'transparent',
                    color: 'var(--ra-text)'
                  }}
                >
                  {jam.name}
                </button>
              ))}
              {jams.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>no jams found</div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {!selectedJamCID && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)' }}>
                  select a jam to browse its rifffs
                </div>
              )}
              {selectedJamCID && (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                      {jamSyncing
                        ? jamSyncProgress && jamSyncProgress.done === 0 && jamSyncProgress.total > 0
                          ? `discovering… ${jamSyncProgress.total} found`
                          : `synced: ${jamSyncBaseCount + (jamSyncProgress?.done ?? 0)} rifffs so far`
                        : jamSyncStatus
                          ? `synced: ${jamSyncStatus.riffCount} rifffs${jamSyncStatus.complete ? '' : ' (partial)'}`
                          : 'not yet synced'}
                    </span>
                    <button
                      onClick={() => {
                        setJamSyncing(true)
                        setJamSyncProgress(null)
                        setJamSyncBaseCount(jamSyncStatus?.riffCount ?? 0)
                        window.rifffApi.endlesssStartSyncJam(selectedJamCID).catch((err) => {
                          console.error(
                            'EndlesssLibraryBrowser: endlesssStartSyncJam() failed:',
                            err
                          )
                          setJamSyncing(false)
                        })
                      }}
                      disabled={jamSyncing}
                      style={{
                        height: 20,
                        borderRadius: 0,
                        padding: '0 8px',
                        fontSize: 9,
                        border: '1px solid var(--ra-border)',
                        background: 'var(--ra-bg-row-active)',
                        color: 'var(--ra-text-2)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      {jamSyncing && <LoadingLoader size={16} />}
                      {jamSyncing
                        ? jamSyncProgress !== null
                          ? `syncing… ${jamSyncProgress.done}/${jamSyncProgress.total}`
                          : 'syncing…'
                        : jamSyncStatus?.complete
                          ? 'check for new rifffs'
                          : 'sync this jam for instant playback'}
                    </button>
                  </div>
                  <div
                    ref={jamGridRef}
                    onScroll={(e) => {
                      if (!jamRiffsHasMore || jamRiffsLoading) return
                      const el = e.currentTarget
                      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMoreJamRiffs()
                    }}
                    style={{
                      overflowY: 'auto',
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8
                    }}
                  >
                    {jamRiffGroups.map((group) => (
                      <div key={group.label}>
                        <span
                          style={{
                            fontSize: 9,
                            color: 'var(--ra-text-3)',
                            display: 'block',
                            marginBottom: 3
                          }}
                        >
                          {group.label}
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {group.riffs.map((riff) => (
                            <RiffCircle
                              key={riff.riffCID}
                              title={`${new Date(riff.creationTime * 1000).toLocaleDateString()} · ${riff.stemCount} stems`}
                              selected={selectedRiffCID === riff.riffCID}
                              multiSelected={
                                selectedRiffCID !== riff.riffCID &&
                                selectedRiffCIDs.has(riff.riffCID)
                              }
                              playing={
                                selectedRiffCID === riff.riffCID && playingRiffCID === riff.riffCID
                              }
                              fullyCached={riff.cachedStemCount >= riff.stemCount}
                              imported={importedRiffGroupIds.has(riff.riffCID)}
                              ownerFraction={
                                jamOwnerFractions.get(riff.riffCID) ?? riff.ownerFraction
                              }
                              onClick={(e) => handleRiffClick(e, riff.riffCID, jamRiffs)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {jamRiffsHasMore && (
                    <button
                      onClick={loadMoreJamRiffs}
                      disabled={jamRiffsLoading}
                      style={{
                        alignSelf: 'center',
                        marginTop: 8,
                        height: 22,
                        borderRadius: 0,
                        padding: '0 12px',
                        fontSize: 10,
                        border: '1px solid var(--ra-border)',
                        background: 'var(--ra-bg-row-active)',
                        color: jamRiffsLoading ? 'var(--ra-text-4)' : 'var(--ra-text-2)'
                      }}
                    >
                      {jamRiffsLoading ? 'loading…' : 'load more'}
                    </button>
                  )}

                  {/* Always rendered at a fixed height once a jam is
                      selected -- see the shared-feed tab's identical block
                      for why this stays mounted instead of appearing/
                      disappearing with riff selection. */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      marginTop: 8,
                      height: 24
                    }}
                  >
                    <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                      {resolvedRiff && selectedRiffCID ? (
                        <>
                          {formatBpm(resolvedRiff.bpm)} BPM · {resolvedRiff.stems.length} stems (
                          {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                          {resolvedRiff.stems.length > 0 &&
                            previewAttemptedForCID === selectedRiffCID &&
                            playingRiffCID !== selectedRiffCID && (
                              <span style={{ color: 'var(--ra-mute-on)' }}>
                                {' '}
                                · no audio available (
                                {resolvedRiff.stems.every((s) => s.path === null)
                                  ? 'stems failed to download'
                                  : 'cached but failed to play'}
                                )
                              </span>
                            )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--ra-text-3)' }}>select a rifff to preview</span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        if (!selectedRiffCID || !resolvedRiff) return
                        if (selectedRiffCIDs.size > 1) {
                          void handleImportSelected()
                        } else {
                          handleImport(selectedRiffCID, resolvedRiff)
                        }
                      }}
                      disabled={busyRiffCID !== null || !resolvedRiff || !selectedRiffCID}
                      style={{
                        height: 24,
                        borderRadius: 0,
                        padding: '0 12px',
                        fontSize: 10,
                        border: '1px solid var(--ra-border-strong)',
                        background:
                          selectedRiffCID && importedRiffGroupIds.has(selectedRiffCID)
                            ? 'var(--ra-stretch-on-bg)'
                            : 'var(--ra-bg-row-active)',
                        color:
                          selectedRiffCID && importedRiffGroupIds.has(selectedRiffCID)
                            ? 'var(--ra-stretch-on)'
                            : 'var(--ra-text)'
                      }}
                    >
                      {selectedRiffCIDs.size > 1
                        ? `import ${selectedRiffCIDs.size} rifffs`
                        : selectedRiffCID && importedRiffGroupIds.has(selectedRiffCID)
                          ? 'imported ✓ — import again'
                          : 'import'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
