// src/renderer/src/components/DiscoverArtistPicker.tsx
//
// Discover artist mode's search (spec §1). A popover in DiscoverRadioMenu's
// shape: positioned at (x, y), clamped to the window, dismissed by Escape or
// a click outside (ignoreRef excepted). Monochrome -- this is chrome.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  analysedLabel,
  normalizeArtistPick,
  suggestArtists,
  suggestionLabel,
  type ArtistIndex,
  type ArtistSuggestion
} from '@shared/discoverArtist'

const JAMMED_WITH_POLL_MS = 2000

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
  const [position, setPosition] = useState({ left: x, top: y })
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<ArtistIndex | null>(null)
  const [analysed, setAnalysed] = useState<{ analysed: number; total: number } | null>(null)

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

  // Same dismissal as DiscoverRadioMenu.
  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => window.addEventListener('click', handleDismiss, true), 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, ignoreRef])

  // Counts come back at once; jammed-with lands later (main's background
  // walk, ~15 s cold), so poll only while it is pending and we are open.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    function load(): void {
      void window.rifffApi.discoverArtistIndex(ownUsername).then((next) => {
        if (cancelled) return
        setIndex(next)
        if (next.jammedWithPending) timer = window.setTimeout(load, JAMMED_WITH_POLL_MS)
      })
    }
    load()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [ownUsername])

  useEffect(() => {
    let cancelled = false
    if (artist === null) return
    void window.rifffApi.discoverArtistAnalysed(artist).then((a) => {
      if (!cancelled) setAnalysed(a)
    })
    return () => {
      cancelled = true
    }
  }, [artist])

  const suggestions = useMemo(
    () => (index ? suggestArtists(index, query, ownUsername) : []),
    [index, query, ownUsername]
  )

  function pick(s: ArtistSuggestion): void {
    onPick(s.kind === 'me' ? null : normalizeArtistPick(s.user, ownUsername))
    onClose()
  }

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="choose an artist"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200, // DiscoverRadioMenu.tsx:267's own value
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
        value={query}
        placeholder="search users"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggestions.length > 0) pick(suggestions[0])
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
      {query.trim() === '' && index?.jammedWith === null && (
        <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>
          finding who you&apos;ve jammed with…
        </span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' }}>
        {index === null && <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>loading…</span>}
        {suggestions.map((s) => (
          <button
            key={s.kind === 'me' ? ':me' : s.user}
            onClick={() => pick(s)}
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              textAlign: 'left',
              padding: '3px 6px',
              background: 'transparent',
              border: 'none',
              color: 'var(--ra-text-2)',
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
            {analysed ? analysedLabel(analysed.analysed, analysed.total) : 'analysed: …'}
          </span>
          {footerExtra}
        </div>
      )}
    </div>
  )
}
