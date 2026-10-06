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
//
// Combine artists (spec 2026-10-06-combine-artists-design §1): several can be
// chosen. A click or Enter is still "only this artist" and closes; the `+`/`−`
// on each row, Shift+click and Shift+Enter add or remove one and keep the
// picker open; Backspace on an empty query removes the last chip. With two or
// more chosen, chips sit above the field and the footer lists each named
// artist's analysed share and the turns this session.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  analysedLabel,
  normalizeArtistPick,
  suggestArtists,
  suggestionLabel,
  type ArtistIndex,
  type ArtistSuggestion
} from '@shared/discoverArtist'
import {
  applyArtistPick,
  canAddMember,
  selectionOthers,
  type ArtistMember,
  type ArtistSelection
} from '@shared/artistSelection'

type AnalysedValue = { analysed: number; total: number } | 'failed'

const JAMMED_WITH_POLL_MS = 2000
/** After a failed load: 2 s, doubling, at most 30 s. */
const RETRY_FIRST_MS = 2000
const RETRY_MAX_MS = 30_000

export function DiscoverArtistPicker({
  x,
  y,
  selection,
  ownUsername,
  onChange,
  onClose,
  ignoreRef,
  footerExtra,
  turns
}: {
  x: number
  y: number
  /** The chosen artists (`[null]` = me). */
  selection: ArtistSelection
  ownUsername: string
  onChange: (next: ArtistSelection) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
  /** Task 8's analyse-overnight button, rendered beside the analysed share. */
  footerExtra?: React.ReactNode
  /** The share this session (`turns: a 6 · b 5`), shown under the footer; null with one artist. */
  turns?: string | null
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [position, setPosition] = useState({ left: x, top: y })
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [index, setIndex] = useState<ArtistIndex | null>(null)
  const [indexFailed, setIndexFailed] = useState(false)
  const [analysed, setAnalysed] = useState<{ key: string; values: AnalysedValue[] } | null>(null)
  const combined = selection.length > 1
  /** The named artists whose analysed share the footer shows, in selection order. */
  const analysedNames = selectionOthers(selection)
  const analysedKey = JSON.stringify(analysedNames)

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

  // Each named artist's analysed share, one after another (one artist: today's one call).
  useEffect(() => {
    const names = JSON.parse(analysedKey) as string[]
    if (names.length === 0) return
    let cancelled = false
    void (async () => {
      const values: AnalysedValue[] = []
      for (const name of names) {
        try {
          values.push(await window.rifffApi.discoverArtistAnalysed(name))
        } catch (err: unknown) {
          console.error('DiscoverArtistPicker: discoverArtistAnalysed failed:', err)
          values.push('failed')
        }
        if (cancelled) return
      }
      setAnalysed({ key: analysedKey, values })
    })()
    return () => {
      cancelled = true
    }
  }, [analysedKey])

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

  function memberOf(s: ArtistSuggestion): ArtistMember {
    return s.kind === 'me' ? null : normalizeArtistPick(s.user, ownUsername)
  }
  /** Click / Enter: only this artist, and close -- today's pick. */
  function pickOnly(s: ArtistSuggestion): void {
    onChange(applyArtistPick(selection, memberOf(s), 'only', ownUsername))
    ignoreRef.current?.focus()
    onClose()
  }
  /** `+`/`−`, Shift+click, Shift+Enter: add or remove, and stay open. */
  function toggle(s: ArtistSuggestion): void {
    onChange(applyArtistPick(selection, memberOf(s), 'toggle', ownUsername))
    setQuery('')
  }
  function memberLabel(member: ArtistMember): string {
    return member ?? (ownUsername.trim() || 'me')
  }

  function optionId(i: number): string {
    return `${listId}-option-${i}`
  }

  const analysedNow = analysed !== null && analysed.key === analysedKey ? analysed.values : null
  /** One artist: today's line. A combination: each named artist's share, `a 3% · b <1%`. */
  const analysedText = combined
    ? `analysed: ${analysedNames
        .map((name, i) => {
          const v = analysedNow?.[i]
          const share =
            v === undefined
              ? '…'
              : v === 'failed'
                ? 'couldn’t load'
                : analysedLabel(v.analysed, v.total).replace(/^analysed: /, '')
          return `${name} ${share}`
        })
        .join(' · ')}`
    : analysedNow === null
      ? 'analysed: …'
      : analysedNow[0] === 'failed'
        ? 'analysed: couldn’t load'
        : analysedLabel(analysedNow[0].analysed, analysedNow[0].total)

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
      {combined && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {selection.map((member) => {
            const name = memberLabel(member)
            return (
              <button
                key={member ?? ':me'}
                type="button"
                aria-label={`remove ${name}`}
                onClick={() => onChange(applyArtistPick(selection, member, 'toggle', ownUsername))}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 9,
                  padding: '2px 6px',
                  background: 'transparent',
                  border: '1px solid var(--ra-border-strong)',
                  color: 'var(--ra-text)',
                  cursor: 'pointer'
                }}
              >
                {name} ×
              </button>
            )
          })}
        </div>
      )}
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
            if (e.shiftKey) {
              e.preventDefault()
              toggle(suggestions[active])
            } else pickOnly(suggestions[active])
          } else if (e.key === 'Backspace' && query === '' && selection.length > 1) {
            e.preventDefault()
            onChange(
              applyArtistPick(selection, selection[selection.length - 1], 'toggle', ownUsername)
            )
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
        aria-multiselectable="true"
        style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' }}
      >
        {suggestions.map((s, i) => {
          const member = memberOf(s)
          const chosen = selection.includes(member)
          const canToggle = canAddMember(selection, member, ownUsername)
          const name = memberLabel(member)
          return (
            <div
              key={s.kind === 'me' ? ':me' : s.user}
              role="none"
              style={{ display: 'grid', gridTemplateColumns: '1fr 18px', gap: 4 }}
            >
              <button
                id={optionId(i)}
                role="option"
                aria-selected={chosen}
                tabIndex={-1}
                onMouseEnter={() => setHighlight(i)}
                onClick={(e) => (e.shiftKey ? toggle(s) : pickOnly(s))}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 10,
                  textAlign: 'left',
                  padding: '3px 6px',
                  background: i === active ? 'var(--ra-bg-row-active)' : 'transparent',
                  border: 'none',
                  color: chosen || i === active ? 'var(--ra-text)' : 'var(--ra-text-2)',
                  cursor: 'pointer'
                }}
              >
                {suggestionLabel(s, ownUsername)}
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${chosen ? 'remove' : 'add'} ${name}`}
                disabled={!canToggle}
                data-tooltip={
                  canToggle
                    ? undefined
                    : member === null
                      ? 'set your endlesss username to combine me'
                      : 'six at most'
                }
                onClick={() => toggle(s)}
                style={{
                  alignSelf: 'center',
                  width: 18,
                  height: 18,
                  padding: 0,
                  fontFamily: 'inherit',
                  fontSize: 10,
                  lineHeight: 1,
                  background: 'transparent',
                  border: '1px solid var(--ra-border)',
                  color: canToggle ? 'var(--ra-text-2)' : 'var(--ra-text-4)',
                  cursor: canToggle ? 'pointer' : 'default'
                }}
              >
                {chosen ? '−' : '+'}
              </button>
            </div>
          )
        })}
      </div>
      {analysedNames.length > 0 && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 9 }}
        >
          <span style={{ color: 'var(--ra-text-3)' }}>{analysedText}</span>
          {footerExtra}
        </div>
      )}
      {turns != null && <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{turns}</span>}
    </div>
  )
}
