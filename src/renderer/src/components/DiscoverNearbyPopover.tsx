// src/renderer/src/components/DiscoverNearbyPopover.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Waveform } from './Waveform'
import type { ArrangeRole } from '@shared/stemRole'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
import type { AdjacentDiscoverCandidate } from '../../../main/discoverAdjacency'

// Fixed size for every candidate's own waveform thumbnail -- deliberately
// NOT DiscoverSlotRow's own proportional bar-length tiling (that's for
// comparing relative loop lengths within the arrangement; this is a short
// browsing list, where a fixed box keeps entries from visibly jumping
// around as they resolve at different times). Direct request, 2026-09-16.
const THUMB_WIDTH = 96
const THUMB_HEIGHT = 32

// No client-side cap constant here -- getAdjacentDiscoverCandidates
// (discoverAdjacency.ts) already returns at most 4 per direction; re-capping
// here would be dead defensiveness against a contract this popover already
// controls both ends of.

/** One candidate stem, shown as a fixed-size thumbnail. `candidate.path`
 * is already resolved and its download already ensured by the time this
 * popover ever sees it (getAdjacentDiscoverCandidates' own doc comment,
 * discoverAdjacency.ts) -- no second, redundant per-candidate riff
 * resolve needed here (an earlier version of this component did its own
 * full riffLibraryResolveRiff round trip just to learn a path the
 * backend already knew; removed 2026-09-16, direct request: "can we take
 * a good look at the things we just added... and see if we can improve
 * the speed"). `Waveform` itself still decodes the audio asynchronously
 * (peaks/brightness) and renders nothing until that finishes -- a real
 * but now much shorter wait (a local file already on disk, not a network
 * round trip), not worth a second loading indicator layered on top of
 * `Waveform`'s own. */
function CandidateRow({
  candidate,
  onClick
}: {
  candidate: AdjacentDiscoverCandidate
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={candidate.presetName || candidate.stemCID}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        width: THUMB_WIDTH,
        padding: 0,
        background: 'transparent',
        border: '1px solid var(--ra-border)',
        cursor: 'pointer',
        flexShrink: 0
      }}
    >
      <div
        style={{
          position: 'relative',
          width: THUMB_WIDTH - 2,
          height: THUMB_HEIGHT,
          overflow: 'hidden',
          background: 'var(--ra-bg-row-sub)'
        }}
      >
        <Waveform path={candidate.path} color="var(--ra-text-3)" opacity={1} />
      </div>
      <span
        style={{
          fontSize: 8,
          color: 'var(--ra-text-3)',
          padding: '0 3px 3px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {candidate.presetName || '(untitled)'}
      </span>
    </button>
  )
}

function Section({
  label,
  candidates,
  loading,
  onStep,
  onPick
}: {
  label: string
  candidates: AdjacentDiscoverCandidate[]
  loading: boolean
  onStep: () => void
  onPick: (candidate: AdjacentDiscoverCandidate) => void
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{label}</span>
        <button
          onClick={onStep}
          disabled={candidates.length === 0}
          title={`skip to the next ${label} match`}
          style={{
            width: 16,
            height: 16,
            padding: 0,
            fontSize: 9,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: candidates.length === 0 ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: candidates.length === 0 ? 'default' : 'pointer'
          }}
        >
          {label === 'earlier' ? '<' : '>'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, minHeight: THUMB_HEIGHT + 14 }}>
        {candidates.map((c) => (
          <CandidateRow key={c.stemCID} candidate={c} onClick={() => onPick(c)} />
        ))}
        {!loading && candidates.length === 0 && (
          <span style={{ fontSize: 9, color: 'var(--ra-text-4)', alignSelf: 'center' }}>
            no nearby match found
          </span>
        )}
      </div>
    </div>
  )
}

// Hand-drawn SVG glyph -- no icon library, same convention as
// DiscoverPanel.tsx's own DiceIcon/StarIcon/LockGlyph etc. Direct
// request, 2026-09-16: replace the "back to start" text button.
function RewindIcon(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <rect x="2" y="3" width="1.6" height="10" />
      <path d="M13.5 3 L13.5 13 L5.5 8 Z" />
    </svg>
  )
}

export function DiscoverNearbyPopover({
  x,
  y,
  startCandidate,
  role,
  onPick,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  /** The slot's own candidate at the moment this popover was opened --
   * "back to start" returns to exactly this, without needing a fresh IPC
   * round trip to reconstruct it. */
  startCandidate: DiscoverCandidate
  role: ArrangeRole
  /** DiscoverSlotRow's own onSwapFromNearby -- fires on every pick, INCLUDING
   * a step-button pick or "back to start." This popover recenters its own
   * browsing around whatever was just picked; it does NOT close itself. */
  onPick: (candidate: DiscoverCandidate) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  // Tracks the full candidate, not just its riffCID -- the header below
  // shows this candidate's own presetName/creatorUserName for orientation
  // ("what am I centered on right now"), which a bare riffCID string
  // wouldn't give us without a second IPC round trip. Starts as
  // `startCandidate`, becomes whatever was last picked.
  const [centerCandidate, setCenterCandidate] = useState(startCandidate)
  // Paired with the (riffCID, role) key it was fetched FOR -- same
  // identity-comparison convention as CandidateRow's own `resolved` above
  // (and DiscoverSlotRow's own resolved/resolvedForCurrent in
  // DiscoverPanel.tsx), so recentering onto a newly-picked candidate reads
  // as "loading" immediately (a key mismatch) without a synchronous
  // setLoading(true) at the top of the effect below, which
  // react-hooks/set-state-in-effect flags as a cascading-render risk.
  const [result, setResult] = useState<{
    key: string
    candidates: { newer: AdjacentDiscoverCandidate[]; older: AdjacentDiscoverCandidate[] }
  } | null>(null)
  const resultKey = `${centerCandidate.riffCID}:${role}`

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getAdjacentDiscoverCandidates(centerCandidate.riffCID, role)
      .then((candidates) => {
        if (!cancelled) setResult({ key: resultKey, candidates })
      })
      .catch((err) => {
        console.error('DiscoverNearbyPopover: getAdjacentDiscoverCandidates failed:', err)
        if (!cancelled) setResult({ key: resultKey, candidates: { newer: [], older: [] } })
      })
    return () => {
      cancelled = true
    }
  }, [centerCandidate.riffCID, role, resultKey])

  const resultForCurrent = result?.key === resultKey ? result : null
  const candidates = resultForCurrent?.candidates ?? { newer: [], older: [] }
  const loading = resultForCurrent === null

  function handlePick(candidate: DiscoverCandidate): void {
    onPick(candidate)
    setCenterCandidate(candidate)
  }

  // --- Positioning + dismissal, mirroring ContextMenu.tsx's own pattern ---
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y, result])

  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, ignoreRef])

  const atStart = centerCandidate.riffCID === startCandidate.riffCID

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Orientation: which riff is currently the center of this popover's
            own browsing, not the whole loading/count state -- direct spec
            requirement ("A small header shows the current center riff...").
            Fixed max-width + ellipsis so a long preset name can't push the
            "back to start" button off the popover's own edge. */}
        <span
          style={{
            fontSize: 9,
            color: 'var(--ra-text-3)',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={`${centerCandidate.presetName || '(untitled)'} — ${centerCandidate.creatorUserName}`}
        >
          near {centerCandidate.presetName || '(untitled)'}
        </span>
        <button
          onClick={() => handlePick(startCandidate)}
          disabled={atStart}
          aria-label="back to start"
          data-tooltip="back to the riff this slot started with"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            fontSize: 9,
            padding: '3px 6px',
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: atStart ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: atStart ? 'default' : 'pointer'
          }}
        >
          <RewindIcon />
        </button>
      </div>
      {/* older = recorded chronologically BEFORE the center -- the
          "earlier" section, see this plan's own terminology note. */}
      <Section
        label="earlier"
        candidates={candidates.older}
        loading={loading}
        onStep={() => candidates.older[0] && handlePick(candidates.older[0])}
        onPick={handlePick}
      />
      {/* newer = recorded chronologically AFTER the center -- "later". */}
      <Section
        label="later"
        candidates={candidates.newer}
        loading={loading}
        onStep={() => candidates.newer[0] && handlePick(candidates.newer[0])}
        onPick={handlePick}
      />
    </div>
  )
}
