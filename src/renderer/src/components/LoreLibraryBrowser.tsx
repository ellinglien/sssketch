import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoreJam, LoreRiffSummary, LoreResolvedRiff } from '@shared/loreLibrary'
import { instrumentMaskToSoundType, LORE_USERNAME } from '@shared/loreLibrary'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { usePlaying, useDispatch } from '../state/StoreContext'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { classifyStems } from '../audio/classifyStems'
import { stemKey } from '@shared/types'

/** Continuous brightness ramp from dark gray (0% ownership) to white (100%
 * ownership) — one brightness axis, no separate accent hue, matching the
 * app's existing "color spent only on things that carry information" design
 * language (see tokens.css).
 *
 * Used to render flat black for any riff missing cached stems, regardless of
 * ownership — but that collapsed two different meanings into the same
 * color: "not yours" and "not downloaded to this machine yet" (which, it
 * turns out, isn't necessarily temporary — some stems only ever get fetched
 * on demand by LORE itself, streamed live over the network rather than
 * pre-cached, so a riff can stay "not fully cached" indefinitely even though
 * every stem in it is real and downloadable — see downloadMissingStems).
 * Ownership brightness now always applies; "not fully cached" gets its own
 * dashed-border cue instead (see the circle's own border logic below). */
function riffCircleColor(riff: LoreRiffSummary): string {
  const lo = 60 // dark gray floor, not pure black, so 0% still reads as "a riff", not "empty"
  const hi = 237 // matches --ra-text's near-white value
  const v = Math.round(lo + riff.ownerFraction * (hi - lo))
  return `rgb(${v}, ${v}, ${v})`
}

// Persisted locally (not in project files or app state) since it's a
// per-person identity setting, not something that travels with a project —
// each tester on their own machine sets their own LORE username once here
// and it sticks across sessions, rather than being baked into the app.
const LORE_USERNAME_STORAGE_KEY = 'ssstitch:loreUsername'

function loadStoredLoreUsername(): string {
  try {
    return localStorage.getItem(LORE_USERNAME_STORAGE_KEY) ?? LORE_USERNAME
  } catch {
    return LORE_USERNAME
  }
}

interface RiffDateGroup {
  label: string
  riffs: LoreRiffSummary[]
}

/** Groups riffs by local calendar date, preserving each group's own
 * most-recent-first order — a jam with thousands of riffs otherwise renders
 * as one undifferentiated wall of circles with no sense of when anything was
 * made. Riffs already arrive sorted by CreationTime DESC (see listRiffs), so
 * a single linear scan is enough: consecutive riffs sharing the same date
 * label just extend the current group. */
function groupRiffsByDate(riffs: LoreRiffSummary[]): RiffDateGroup[] {
  const groups: RiffDateGroup[] = []
  for (const riff of riffs) {
    const label = new Date(riff.creationTime * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
    const current = groups[groups.length - 1]
    if (current && current.label === label) {
      current.riffs.push(riff)
    } else {
      groups.push({ label, riffs: [riff] })
    }
  }
  return groups
}

export function LoreLibraryBrowser({
  onClose,
  onImported
}: {
  onClose: () => void
  /** Called once import(s) succeed with every newly-created groupId (one for
   * a single import, several for a batch) — lets the caller drive downbeat
   * correction (open BeatPicker for the first one, propagate its picked
   * offset to the rest) the same way drag-and-drop import already does. */
  onImported: (groupIds: string[]) => void
}): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [jamFilter, setJamFilter] = useState('')
  const [jams, setJams] = useState<LoreJam[]>([])
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)
  const [riffs, setRiffs] = useState<LoreRiffSummary[]>([])
  const riffGroups = useMemo(() => groupRiffsByDate(riffs), [riffs])
  // Whether the warehouse has more riffs beyond the currently-loaded page(s)
  // for the current jam/filters — some of Elling's real jams have 20,000+
  // riffs, so listRiffs is paginated (RIFF_PAGE_SIZE per page) rather than
  // ever fetching/rendering all of them at once. See handleLoadMore.
  const [hasMoreRiffs, setHasMoreRiffs] = useState(false)
  const [loadingMoreRiffs, setLoadingMoreRiffs] = useState(false)
  // The offset to request for the *next* page — tracks raw SQL rows
  // consumed server-side (see RiffPage.nextOffset's doc comment), not
  // riffs.length, which can diverge once the onlyFullyCached filter drops
  // some rows from a page.
  const nextOffsetRef = useRef(0)
  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  const [bpmFilter, setBpmFilter] = useState('')
  const [userNameFilter, setUserNameFilter] = useState('')
  const [onlyFullyCached, setOnlyFullyCached] = useState(false)
  // Which LORE username "you" are, for ownerFraction (drives the ownership
  // brightness coloring below) and the "only mine" filter — editable and
  // persisted per-machine (see loadStoredLoreUsername), not hardcoded, since
  // other people testing this app aren't Elling.
  const [loreUsername, setLoreUsername] = useState(loadStoredLoreUsername)
  const [onlyContainsMe, setOnlyContainsMe] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(LORE_USERNAME_STORAGE_KEY, loreUsername)
    } catch {
      // localStorage unavailable (e.g. private mode) — the setting just
      // won't survive a restart, not worth surfacing as an error.
    }
  }, [loreUsername])
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
  // The batch/multi-selection (shift-click range, cmd/ctrl-click toggle) —
  // separate from selectedRiffCID, which remains the "anchor" riff that
  // drives preview/detail-line/PolarGlyph exactly as before. A plain click
  // always collapses this back down to just that one riff.
  const [selectedRiffCIDs, setSelectedRiffCIDs] = useState<Set<string>>(new Set())
  if (selectedJamCID !== resetForJamCID) {
    setResetForJamCID(selectedJamCID)
    setSelectedRiffCID(null)
    setSelectedRiffCIDs(new Set())
  }

  const [resolvedRiff, setResolvedRiff] = useState<LoreResolvedRiff | null>(null)
  const [importedRiffCIDs, setImportedRiffCIDs] = useState<Set<string>>(new Set())
  // Which riff (if any) currently has a download-missing-stems fetch in
  // flight — a single riffCID rather than a Set, since only one download can
  // be triggered at a time from this panel (the button/import action that
  // starts one is disabled while it's running).
  const [downloadingRiffCID, setDownloadingRiffCID] = useState<string | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewTokenRef = useRef(0)
  const playing = usePlaying()
  const dispatch = useDispatch()

  // Stable across renders (useCallback, empty deps) so it's safe to pass to
  // registerActivePreview/reference from effect cleanups without triggering
  // re-subscriptions.
  const stopPreview = useCallback(() => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  /** Builds a Rifff from a resolved riff and dispatches it, exactly as the
   * single-riff import button already did — extracted so the new batch
   * import path (multiple riffs, each resolved on demand) can share the
   * same logic instead of duplicating it. Returns the newly-created groupId,
   * or null (no-op) if the riff has no locally-cached stems at all. */
  function importResolvedRiff(riffCID: string, resolved: LoreResolvedRiff): string | null {
    const cachedStems = resolved.stems.filter((s) => s.path !== null)
    if (cachedStems.length === 0) return null

    const groupId = crypto.randomUUID()
    const rifff = {
      groupId,
      name: `LORE riff ${riffCID.slice(0, 8)}`,
      bpm: resolved.bpm,
      barLength: resolved.barLength,
      // Not a real folder — sourced from the LORE warehouse, not a drag-and-drop
      // import. Inspector.tsx's existing "re-import from folder" link displays
      // this field as-is; an empty string would render as a bare "/", so use a
      // human-readable descriptor instead. Clicking that link on a LORE-imported
      // rifff still works exactly like it does for any other rifff (opens a
      // folder picker and re-imports from wherever the user points it) — this
      // is display-only, not read back programmatically anywhere.
      folderPath: 'lore library',
      stems: cachedStems.map((s) => ({
        slot: s.slot,
        author: s.creatorUserName,
        name: s.presetName,
        type: instrumentMaskToSoundType(s.instrumentMask) ?? 'fx',
        path: s.path!,
        durationSec: s.durationSec, // this stem's own bpm/bar-length, not the riff's — see resolveRiff
        barLength: s.barLength
      }))
    }

    dispatch({ type: 'ADD_TO_SHELF', rifff })
    for (const stem of cachedStems) {
      if (Math.abs(stem.gain - 1.0) > 1e-6) {
        dispatch({ type: 'SET_VOLUME', stemKey: stemKey(groupId, stem.slot), volume: stem.gain })
      }
    }
    setImportedRiffCIDs((prev) => new Set(prev).add(riffCID))

    // Same "fill in unclassified stems by ear" heuristic drag-and-drop import
    // already uses — the Instrument bitmask covers drum/note/bass/mic
    // confidently, but a stem with no matching bit (mapped to 'fx' above)
    // gets a second chance here, same as today's importer gives every stem.
    classifyStems(rifff, dispatch).catch((err) => {
      console.error('LoreLibraryBrowser: failed to classify stem types:', err)
    })
    return groupId
  }

  /** Patches just this one riff's cachedStemCount in the already-loaded
   * `riffs` list (the grid's own data) after a download — cheaper and more
   * immediate than re-running loreListRiffs, and the only field
   * riffCircleColor's "fully cached" check actually reads. */
  function patchRiffCacheCount(riffCID: string, resolved: LoreResolvedRiff): void {
    const cachedStemCount = resolved.stems.filter((s) => s.path !== null).length
    setRiffs((prev) => prev.map((r) => (r.riffCID === riffCID ? { ...r, cachedStemCount } : r)))
  }

  /** Fetches every not-yet-cached stem for `riffCID` directly from its
   * public storage URL (see stemDownloadUrl's doc comment — no Endlesss
   * login involved) and returns the freshly re-resolved riff, updating both
   * resolvedRiff and the grid's own cachedStemCount as a side effect. Shared
   * by the explicit "download missing stems" button and both import paths'
   * auto-fetch fallback below. Returns the ORIGINAL riff unchanged if the
   * download fails (network error, etc.) rather than null, so a caller
   * chaining into an import still has something to import. */
  async function ensureStemsDownloaded(
    riffCID: string,
    resolved: LoreResolvedRiff
  ): Promise<LoreResolvedRiff> {
    if (!resolved.stems.some((s) => s.path === null)) return resolved
    setDownloadingRiffCID(riffCID)
    try {
      const refreshed = await window.rifffApi.loreDownloadMissingStems(riffCID)
      if (!refreshed) return resolved
      if (riffCID === selectedRiffCID) setResolvedRiff(refreshed)
      patchRiffCacheCount(riffCID, refreshed)
      return refreshed
    } catch (err) {
      console.error(`LoreLibraryBrowser: loreDownloadMissingStems(${riffCID}) failed:`, err)
      return resolved
    } finally {
      setDownloadingRiffCID(null)
    }
  }

  async function handleImport(): Promise<void> {
    if (!resolvedRiff || !selectedRiffCID) return
    const toImport = await ensureStemsDownloaded(selectedRiffCID, resolvedRiff)
    const groupId = importResolvedRiff(selectedRiffCID, toImport)
    if (groupId) onImported([groupId])
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
    const groupIds: string[] = []
    for (const riffCID of selectedRiffCIDs) {
      try {
        const resolved =
          riffCID === selectedRiffCID && resolvedRiff
            ? resolvedRiff
            : await window.rifffApi.loreResolveRiff(riffCID)
        if (resolved) {
          const toImport = await ensureStemsDownloaded(riffCID, resolved)
          const groupId = importResolvedRiff(riffCID, toImport)
          if (groupId) groupIds.push(groupId)
        }
      } catch (err) {
        console.error(
          `LoreLibraryBrowser: failed to import riff ${riffCID} during batch import:`,
          err
        )
      }
    }
    if (groupIds.length > 0) onImported(groupIds)
  }

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

  useEffect(() => {
    let cancelled = false
    void window.rifffApi
      .loreWarehouseAvailable()
      .then((v) => {
        if (!cancelled) setAvailable(v)
      })
      .catch((err) => {
        // A rejected invoke (e.g. the main process hasn't registered this
        // channel yet, which happens if it was running before this IPC
        // handler was added — electron-vite's dev server hot-reloads the
        // renderer but doesn't restart main for new ipcMain.handle calls)
        // previously left `available` stuck at its initial `null` forever,
        // rendering neither the "unavailable" message nor the browser
        // itself — just a blank panel with no explanation. Treat any
        // failure the same as "unavailable" so there's always a visible
        // outcome.
        console.error('LoreLibraryBrowser: loreWarehouseAvailable() failed:', err)
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!available) return
    let cancelled = false
    window.rifffApi
      .loreListJams(jamFilter)
      .then((result) => {
        if (!cancelled) setJams(result)
      })
      .catch((err) => {
        console.error('LoreLibraryBrowser: loreListJams() failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [available, jamFilter])

  // Shared by the initial-page effect below and handleLoadMore — both need
  // the exact same filters, just a different offset.
  function buildRiffFilters(offset: number): {
    dateFrom?: number
    dateTo?: number
    bpm?: number
    userName?: string
    onlyFullyCached?: boolean
    targetUser?: string
    onlyContainsUser?: boolean
    offset?: number
  } {
    const filters: ReturnType<typeof buildRiffFilters> = {}
    if (dateFromFilter !== '') {
      filters.dateFrom = Math.floor(new Date(`${dateFromFilter}T00:00:00`).getTime() / 1000)
    }
    if (dateToFilter !== '') {
      filters.dateTo = Math.floor(new Date(`${dateToFilter}T23:59:59`).getTime() / 1000)
    }
    if (bpmFilter.trim() !== '' && !Number.isNaN(Number(bpmFilter))) filters.bpm = Number(bpmFilter)
    if (userNameFilter.trim() !== '') filters.userName = userNameFilter.trim()
    if (onlyFullyCached) filters.onlyFullyCached = true
    // Always sent (not just while the "only mine" filter is checked) — this
    // also drives ownerFraction's brightness coloring on every riff shown,
    // not just the filtered subset.
    if (loreUsername.trim() !== '') filters.targetUser = loreUsername.trim()
    if (onlyContainsMe) filters.onlyContainsUser = true
    if (offset > 0) filters.offset = offset
    return filters
  }

  useEffect(() => {
    // No "deselect jam" affordance exists — selecting always moves to a new
    // non-null jamCID, so there's nothing to clear here; riffs simply starts
    // at its initial [] and is only ever populated once a jam is picked. The
    // grid itself is also only rendered when selectedJamCID !== null (see
    // below), so even a theoretical stale value would never be visible.
    if (!selectedJamCID) return
    let cancelled = false
    window.rifffApi
      .loreListRiffs(selectedJamCID, buildRiffFilters(0))
      .then((result) => {
        if (cancelled) return
        setRiffs(result.riffs)
        setHasMoreRiffs(result.hasMore)
        nextOffsetRef.current = result.nextOffset
      })
      .catch((err) => {
        console.error('LoreLibraryBrowser: loreListRiffs() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildRiffFilters closes over these same deps; listing both would be redundant and buildRiffFilters itself isn't stable across renders
  }, [
    selectedJamCID,
    dateFromFilter,
    dateToFilter,
    bpmFilter,
    userNameFilter,
    onlyFullyCached,
    loreUsername,
    onlyContainsMe
  ])

  function handleLoadMore(): void {
    if (!selectedJamCID || loadingMoreRiffs) return
    setLoadingMoreRiffs(true)
    window.rifffApi
      .loreListRiffs(selectedJamCID, buildRiffFilters(nextOffsetRef.current))
      .then((result) => {
        setRiffs((prev) => [...prev, ...result.riffs])
        setHasMoreRiffs(result.hasMore)
        nextOffsetRef.current = result.nextOffset
      })
      .catch((err) => {
        console.error('LoreLibraryBrowser: loreListRiffs() (load more) failed:', err)
      })
      .finally(() => setLoadingMoreRiffs(false))
  }

  useEffect(() => {
    stopPreview()
    // No "deselect riff" affordance exists — selecting always moves to a new
    // non-null riffCID, so there's nothing to clear here; resolvedRiff stays
    // stale-but-unrendered the same way riffs does above (the detail line is
    // only rendered when resolvedRiff is truthy).
    if (!selectedRiffCID) return
    let cancelled = false
    window.rifffApi
      .loreResolveRiff(selectedRiffCID)
      .then(async (resolved) => {
        if (cancelled || !resolved) return
        setResolvedRiff(resolved)

        // Auto-preview on selection, full mix only — same reasoning as
        // BeatPicker's own preview: pause the main arrangement first so the
        // two don't play over each other.
        if (playing) dispatch({ type: 'PAUSE' })
        const cachedStems = resolved.stems.filter((s) => s.path !== null)
        const sources = await startPreviewLoop(
          getAudioContext(),
          cachedStems.map((s) => ({ path: s.path!, gain: s.gain, durationSec: s.durationSec })),
          () => cancelled
        )
        previewSourcesRef.current.push(...sources)
        if (sources.length > 0) previewTokenRef.current = registerActivePreview(stopPreview)
      })
      .catch((err) => {
        console.error('LoreLibraryBrowser: loreResolveRiff() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playing/dispatch intentionally excluded: this only re-runs on riff selection, matching BeatPicker's own pattern of reading transport state at the moment a preview starts rather than tracking it as a dependency
  }, [selectedRiffCID])

  useEffect(() => {
    return () => stopPreview()
  }, [stopPreview])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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
          <span className="ra-eyebrow">lore library</span>
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

        {available === false && (
          <div style={{ marginTop: 20, fontSize: 11, color: 'var(--ra-text-2)' }}>
            library not available — is the drive mounted?
          </div>
        )}

        {available && (
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flex: 1, minHeight: 0 }}>
            <div
              style={{
                width: 220,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6
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
                  padding: '0 6px'
                }}
              />
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {jams.map((jam) => (
                  <button
                    key={jam.jamCID}
                    onClick={() => setSelectedJamCID(jam.jamCID)}
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
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {selectedJamCID === null && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  select a jam to browse its riffs
                </div>
              )}
              {selectedJamCID !== null && (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                      value={bpmFilter}
                      onChange={(e) => setBpmFilter(e.target.value)}
                      placeholder="bpm"
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
                      value={loreUsername}
                      onChange={(e) => setLoreUsername(e.target.value)}
                      placeholder="your username"
                      title="your LORE username — drives the ownership coloring below and the 'only mine' filter, saved on this machine"
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
                      {riffs.length} riffs{hasMoreRiffs ? '+' : ''}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 10,
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {group.riffs.map((riff) => (
                            <div
                              key={riff.riffCID}
                              style={{ position: 'relative', width: 18, height: 18 }}
                            >
                              <button
                                onClick={(e) => handleRiffClick(e, riff.riffCID)}
                                title={`${riff.bpm} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: '50%',
                                  // Dashed border flags "not fully cached" independently of
                                  // the ownership brightness fill (riffCircleColor) — see its
                                  // own doc comment for why these used to be conflated.
                                  // Selection rings take priority over the dashed cue since
                                  // they're the stronger, more immediate signal.
                                  border:
                                    selectedRiffCID === riff.riffCID
                                      ? '2px solid var(--ra-playhead)'
                                      : selectedRiffCIDs.has(riff.riffCID)
                                        ? '2px solid var(--ra-stretch-on)'
                                        : riff.cachedStemCount < riff.stemCount
                                          ? '1px dashed var(--ra-text-3)'
                                          : '1px solid var(--ra-border)',
                                  padding: 0,
                                  background: riffCircleColor(riff),
                                  cursor: 'pointer'
                                }}
                              />
                              {importedRiffCIDs.has(riff.riffCID) && (
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
                          ))}
                        </div>
                      </div>
                    ))}
                    {hasMoreRiffs && (
                      <button
                        onClick={handleLoadMore}
                        disabled={loadingMoreRiffs}
                        style={{
                          alignSelf: 'flex-start',
                          height: 18,
                          borderRadius: 0,
                          padding: '0 8px',
                          fontSize: 9,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text-2)',
                          cursor: loadingMoreRiffs ? 'default' : 'pointer'
                        }}
                      >
                        {loadingMoreRiffs ? 'loading…' : 'load more'}
                      </button>
                    )}
                  </div>

                  {resolvedRiff && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                      <PolarGlyph
                        stems={resolvedRiff.stems
                          .filter((s) => s.path !== null)
                          .map((s) => ({
                            slot: s.slot,
                            author: s.creatorUserName,
                            name: s.presetName,
                            type: instrumentMaskToSoundType(s.instrumentMask) ?? 'fx',
                            path: s.path!,
                            durationSec: s.durationSec,
                            barLength: s.barLength
                          }))}
                        identityColor={typeColorVar('fx')}
                        size={40}
                      />
                      <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                        {resolvedRiff.bpm} BPM · {resolvedRiff.stems.length} stems (
                        {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                        <div style={{ marginTop: 2, color: 'var(--ra-text-3)' }}>
                          {resolvedRiff.stems.map((s) => s.creatorUserName || '?').join(', ')}
                        </div>
                      </div>
                      {resolvedRiff.stems.some((s) => s.path === null) && (
                        <button
                          onClick={() => {
                            if (selectedRiffCID)
                              void ensureStemsDownloaded(selectedRiffCID, resolvedRiff)
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
                              downloadingRiffCID !== null ? 'var(--ra-text-4)' : 'var(--ra-text-2)'
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
                          height: 24,
                          borderRadius: 0,
                          padding: '0 12px',
                          fontSize: 10,
                          border: '1px solid var(--ra-border-strong)',
                          background:
                            selectedRiffCID !== null && importedRiffCIDs.has(selectedRiffCID)
                              ? 'var(--ra-stretch-on-bg)'
                              : 'var(--ra-bg-row-active)',
                          color:
                            selectedRiffCID !== null && importedRiffCIDs.has(selectedRiffCID)
                              ? 'var(--ra-stretch-on)'
                              : 'var(--ra-text)'
                        }}
                      >
                        {selectedRiffCIDs.size > 1
                          ? `import ${selectedRiffCIDs.size} riffs`
                          : selectedRiffCID !== null && importedRiffCIDs.has(selectedRiffCID)
                            ? 'imported ✓ — import again'
                            : 'import'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
