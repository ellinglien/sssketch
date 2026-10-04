// src/renderer/src/components/DiscoverArtistPicker.tsx
//
// Discover artist mode's search (spec §1). A popover in RadioStartPrompt's
// shape: positioned at (x, y), clamped to the window, dismissed by Escape or
// a click outside (ignoreRef excepted). Monochrome -- this is chrome.
//
// A combobox: the field keeps focus, ArrowUp/ArrowDown move the highlighted
// row, Enter picks the highlighted row. Escape closes ONLY this popover
// (capture phase, propagation stopped -- LibraryBrowser closes the whole
// library on a window-level Escape), and Escape or a pick hands focus back
// to the artist field (ignoreRef).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  analysedLabel,
  normalizeArtistPick,
  suggestArtists,
  suggestionLabel,
  type ArtistIndex,
  type ArtistSuggestion
} from '@shared/discoverArtist'

const JAMMED_WITH_POLL_MS = 2000
/** After a failed load: 2 s, doubling, at most 30 s. */
const RETRY_FIRST_MS = 2000
const RETRY_MAX_MS = 30_000

export function DiscoverArtistPicker({
  x,
  y,
  artist,
  ownUsername,
  onPick,
  onClose,
  ignoreRef,
  footerExtra
}: {
  x: number
  y: number
  artist: string | null
  ownUsername: string
  onPick: (artist: string | null) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
  /** Task 8's analyse-overnight button, rendered beside the analysed share. */
  footerExtra?: React.ReactNode
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [position, setPosition] = useState({ left: x, top: y })
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [index, setIndex] = useState<ArtistIndex | null>(null)
  const [indexFailed, setIndexFailed] = useState(false)
  const [analysed, setAnalysed] = useState<{
    artist: string
    value: { analysed: number; total: number } | 'failed'
  } | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    })
  }, [x, y])

  // Same dismissal as RadioStartPrompt. Escape in the CAPTURE phase with
  // propagation stopped, so the library modal behind never sees it.
  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      ignoreRef.current?.focus()
      onClose()
    }
    const id = setTimeout(() => window.addEventListener('click', handleDismiss, true), 0)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose, ignoreRef])

  // Counts come back at once; jammed-with lands later (main's background
  // walk), so poll while it is pending and we are open. A failed load says
  // so and retries with a back-off -- never an unhandled rejection.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let retryMs = RETRY_FIRST_MS
    function load(): void {
      window.rifffApi
        .discoverArtistIndex(ownUsername)
        .then((next) => {
          if (cancelled) return
          retryMs = RETRY_FIRST_MS
          setIndex(next)
          setIndexFailed(false)
          if (next.jammedWithPending) timer = window.setTimeout(load, JAMMED_WITH_POLL_MS)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          console.error('DiscoverArtistPicker: discoverArtistIndex failed:', err)
          setIndexFailed(true)
          timer = window.setTimeout(load, retryMs)
          retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
        })
    }
    load()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [ownUsername])

  useEffect(() => {
    if (artist === null) return
    let cancelled = false
    window.rifffApi
      .discoverArtistAnalysed(artist)
      .then((value) => {
        if (!cancelled) setAnalysed({ artist, value })
      })
      .catch((err: unknown) => {
        console.error('DiscoverArtistPicker: discoverArtistAnalysed failed:', err)
        if (!cancelled) setAnalysed({ artist, value: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [artist])

  const suggestions = useMemo(
    () => (index ? suggestArtists(index, query, ownUsername) : []),
    [index, query, ownUsername]
  )
  // -1 only while the list is empty; otherwise always a real row, so a list
  // that fills after an empty one still has a highlight for Enter.
  const active =
    suggestions.length === 0 ? -1 : Math.max(0, Math.min(highlight, suggestions.length - 1))

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (active < 0) return
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listId])

  function pick(s: ArtistSuggestion): void {
    onPick(s.kind === 'me' ? null : normalizeArtistPick(s.user, ownUsername))
    ignoreRef.current?.focus()
    onClose()
  }

  function optionId(i: number): string {
    return `${listId}-option-${i}`
  }

  const analysedNow = analysed !== null && analysed.artist === artist ? analysed.value : null

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="choose an artist"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200, // RadioStartPrompt's own value
        width: 260,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: 'var(--ra-bg-frame)',
        border: '1px solid var(--ra-border-strong)'
      }}
    >
      <input
        autoFocus
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        value={query}
        placeholder="search users"
        onChange={(e) => {
          setQuery(e.target.value)
          setHighlight(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (active >= 0) setHighlight(Math.min(active + 1, suggestions.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (active >= 0) setHighlight(Math.max(active - 1, 0))
          } else if (e.key === 'Enter' && active >= 0) {
            pick(suggestions[active])
          }
        }}
        style={{
          fontFamily: 'inherit',
          fontSize: 10,
          padding: '4px 6px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text)'
        }}
      />
      {query.trim() === '' && index?.jammedWith === null && index.jammedWithPending && (
        <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>
          finding who you&apos;ve jammed with…
        </span>
      )}
      {/* Status lines sit OUTSIDE the listbox: it holds options only. */}
      {index === null && (
        <span role="status" style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>
          {indexFailed ? 'couldn’t load · retrying' : 'loading…'}
        </span>
      )}
      {index !== null && indexFailed && (
        <span role="status" style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>
          couldn’t refresh · retrying
        </span>
      )}
      {index !== null && query.trim() !== '' && suggestions.length === 0 && (
        <span role="status" style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>
          no matches
        </span>
      )}
      <div
        id={listId}
        role="listbox"
        aria-label="artists"
        style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' }}
      >
        {suggestions.map((s, i) => (
          <button
            key={s.kind === 'me' ? ':me' : s.user}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => pick(s)}
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              textAlign: 'left',
              padding: '3px 6px',
              background: i === active ? 'var(--ra-bg-row-active)' : 'transparent',
              border: 'none',
              color: i === active ? 'var(--ra-text)' : 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            {suggestionLabel(s, ownUsername)}
          </button>
        ))}
      </div>
      {artist !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9 }}>
          <span style={{ color: 'var(--ra-text-3)' }}>
            {analysedNow === null
              ? 'analysed: …'
              : analysedNow === 'failed'
                ? 'analysed: couldn’t load'
                : analysedLabel(analysedNow.analysed, analysedNow.total)}
          </span>
          {footerExtra}
        </div>
      )}
    </div>
  )
}
