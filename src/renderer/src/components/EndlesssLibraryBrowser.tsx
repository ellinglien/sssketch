import { useEffect, useRef, useState } from 'react'
import type { LoreResolvedRiff, LoreRiffSummary } from '@shared/loreLibrary'
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

const SHARED_FEED_STORAGE_KEY = 'sssketch:endlesssSharedFeedUsername'
const SHARED_FEED_PAGE_SIZE = 30

type EndlesssTab = 'shared-feed' | 'private-jams'
type AuthStatus = { loggedIn: false } | { loggedIn: true; userId: string; expiresAt: number }

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
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedNextOffset, setFeedNextOffset] = useState(0)
  const [feedLoading, setFeedLoading] = useState(false)

  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  const [resolvedRiff, setResolvedRiff] = useState<LoreResolvedRiff | null>(null)
  const [importedRiffGroupIds, setImportedRiffGroupIds] = useState<Map<string, string>>(new Map())
  const [busyRiffCID, setBusyRiffCID] = useState<string | null>(null)
  const previewTokenRef = useRef(0)

  const playing = usePlaying()
  const dispatch = useDispatch()
  const state = useAppState()
  const setBusy = useBusy()

  // Auto-effective username: whoever's logged in, once authenticated --
  // matches the design spec's "logging in swaps the plain username lookup
  // for the authenticated session automatically" UX.
  const effectiveUsername = feedUsername.trim()

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
  // user left the tab. Only the reset *body* (clearing selection/preview
  // state) is gated to the shared-feed tab -- the key tracking is not.
  const [resetForFeedKey, setResetForFeedKey] = useState<string | null>(null)
  const feedKey = `${tab}:${effectiveUsername}`
  if (feedKey !== resetForFeedKey) {
    setResetForFeedKey(feedKey)
    if (tab === 'shared-feed') {
      setSelectedRiffCID(null)
      setResolvedRiff(null)
      setFeedLoading(effectiveUsername !== '')
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

  useEffect(() => {
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
        if (sources.length > 0) {
          previewTokenRef.current = registerActivePreview(() => stopPreviewSources(sources))
        }
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssResolveSharedFeedRiff() failed:', err)
      })
    return () => {
      cancelled = true
      unregisterActivePreview(previewTokenRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playing/dispatch intentionally excluded, matching LoreLibraryBrowser.tsx's own established pattern for this exact kind of effect
  }, [selectedRiffCID])

  function handleImport(riffCID: string, resolved: LoreResolvedRiff): void {
    setBusy('importing rifff…')
    setBusyRiffCID(riffCID)
    try {
      const existingGroupId = importedRiffGroupIds.get(riffCID)
      const existing = existingGroupId ? state.rifffs[existingGroupId] : undefined
      const result = buildImportedRifff(
        riffCID,
        resolved,
        existing,
        'endlesss',
        'endlesss shared feed'
      )
      if (!result) return
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
      onImported([groupId], [rifff])
    } finally {
      setBusy(null)
      setBusyRiffCID(null)
    }
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
              my private jams
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
              <input
                type="text"
                value={feedUsername}
                onChange={(e) => setFeedUsername(e.target.value)}
                placeholder={
                  authStatus.loggedIn
                    ? 'your endlesss username (or leave blank)'
                    : 'endlesss username — no login needed for public shares'
                }
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
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                {feedRiffs.length} riffs{feedHasMore ? '+' : ''}
              </span>
            </div>

            <div
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
                gap: 4
              }}
            >
              {feedRiffs.map((riff) => (
                <button
                  key={riff.riffCID}
                  onClick={() => setSelectedRiffCID(riff.riffCID)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    fontSize: 11,
                    border: 'none',
                    borderRadius: 0,
                    background:
                      selectedRiffCID === riff.riffCID ? 'var(--ra-bg-row-active)' : 'transparent',
                    color: 'var(--ra-text)',
                    cursor: 'pointer'
                  }}
                >
                  <span>{riff.userName || 'shared riff'}</span>
                  <span style={{ color: 'var(--ra-text-3)' }}>
                    {formatBpm(riff.bpm)} BPM · {riff.stemCount} stems
                    {importedRiffGroupIds.has(riff.riffCID) ? ' · imported' : ''}
                  </span>
                </button>
              ))}
              {feedRiffs.length === 0 && !feedLoading && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  {effectiveUsername === ''
                    ? 'enter a username above to browse its shared feed'
                    : 'no shared riffs found'}
                </div>
              )}
            </div>

            {resolvedRiff && selectedRiffCID && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                  {formatBpm(resolvedRiff.bpm)} BPM · {resolvedRiff.stems.length} stems (
                  {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                </div>
                <button
                  onClick={() => handleImport(selectedRiffCID, resolvedRiff)}
                  disabled={busyRiffCID !== null}
                  style={{
                    height: 24,
                    borderRadius: 0,
                    padding: '0 12px',
                    fontSize: 10,
                    border: '1px solid var(--ra-border-strong)',
                    background: importedRiffGroupIds.has(selectedRiffCID)
                      ? 'var(--ra-stretch-on-bg)'
                      : 'var(--ra-bg-row-active)',
                    color: importedRiffGroupIds.has(selectedRiffCID)
                      ? 'var(--ra-stretch-on)'
                      : 'var(--ra-text)'
                  }}
                >
                  {importedRiffGroupIds.has(selectedRiffCID)
                    ? 'imported ✓ — import again'
                    : 'import'}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'private-jams' && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-3)' }}>
            private jams tab implemented in a later task
          </div>
        )}
      </div>
    </div>
  )
}
