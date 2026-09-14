// src/renderer/src/components/DiscoverPanel.tsx
import { useEffect, useState } from 'react'
import { PolarGlyph } from './PolarGlyph'
import { stemColorVar } from '../theme/typeColor'
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { rankCandidates, pickReroll } from '@shared/discoverRanking'
import { useAppSelector } from '../state/StoreContext'
import type { ProjectRef, SoundType, Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

/** Resolves one Discover candidate down to a real, locally-downloaded
 * `Stem` -- reused verbatim by both this component's own slot-preview
 * rendering (Step 1 below) and Task 11's "plunk in arranger" placement,
 * since both need exactly the same download-then-resolve step, just for
 * different reasons (a radial-waveform preview vs. a real placed clip).
 * Downloads the candidate's own riff's missing stems on demand (same
 * `riffLibraryDownloadMissingStems` call `LibraryBrowser.tsx`'s own
 * `ensureStemsDownloaded` already makes) -- a candidate isn't guaranteed
 * to be cached locally just because it's in the library-wide index (Task
 * 1's own query reads DB metadata only, never touches the filesystem).
 * Returns null (never throws) for a riff that fails to resolve/download
 * (network hiccup, since-deleted riff) -- callers treat that the same as
 * "no candidate yet" rather than surfacing an error for what's ultimately
 * a soft, retryable failure (reroll picks something else regardless). */
async function resolveCandidateStem(candidate: DiscoverCandidate): Promise<{
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
} | null> {
  try {
    const resolved = await window.rifffApi.riffLibraryResolveRiff(candidate.riffCID)
    if (!resolved) return null
    const withStems = resolved.stems.some((s) => s.path === null)
      ? ((await window.rifffApi.riffLibraryDownloadMissingStems(candidate.riffCID)) ?? resolved)
      : resolved
    const stem = withStems.stems.find((s) => s.stemCID === candidate.stemCID)
    if (!stem || stem.path === null) return null
    return {
      author: stem.creatorUserName,
      name: stem.presetName,
      type:
        instrumentMaskToSoundType(stem.instrumentMask) ??
        guessSoundTypeFromPresetName(stem.presetName) ??
        'fx',
      path: stem.path,
      durationSec: stem.durationSec,
      barLength: stem.barLength
    }
  } catch (err) {
    console.error('resolveCandidateStem: failed to resolve candidate', candidate.riffCID, err)
    return null
  }
}

export interface DiscoverSlot {
  id: string
  role: ArrangeRole
  locked: boolean
  candidate: DiscoverCandidate | null
}

let nextSlotId = 0
function freshSlotId(): string {
  nextSlotId += 1
  return `slot-${nextSlotId}`
}

export function DiscoverPanel({
  currentSketch,
  slots,
  setSlots,
  chaos,
  setChaos,
  currentUsername
}: {
  currentSketch: ProjectRef
  /** Lifted up into LibraryBrowser.tsx (the parent, which does NOT unmount
   * on a `libraryMode` tab switch) rather than owned here -- this component
   * itself DOES unmount/remount on every 'discover' <-> 'browse' switch
   * (LibraryBrowser renders it conditionally, as a sibling of the 'browse'
   * block), so state owned internally here would be wiped on every switch.
   * Controlled from above so the in-progress loop survives switching tabs
   * within one open LibraryBrowser session, per
   * docs/superpowers/specs/2026-09-14-library-wide-discover-design.md
   * §8.1. */
  slots: DiscoverSlot[]
  setSlots: React.Dispatch<React.SetStateAction<DiscoverSlot[]>>
  chaos: number
  setChaos: React.Dispatch<React.SetStateAction<number>>
  /** The real, live "who am I" for this codebase -- LibraryBrowser.tsx's
   * own `riffLibraryUsername` state (seeded from localStorage via
   * loadStoredRiffLibraryUsername, editable through its own "your
   * username" field, already the value its 'browse' tab's own
   * `filters.targetUser` uses). `@shared/riffLibraryTypes`'s
   * `RIFF_LIBRARY_USERNAME` is only that loader's compile-time fallback
   * ('elling') for a machine that's never set a username -- NOT itself
   * the live value -- so it's deliberately not used here; passing the
   * real per-machine value down keeps "only own stems" rerolls scoped to
   * whoever is actually using this install. */
  currentUsername: string
}): React.JSX.Element {
  // Unused for now -- accepted here because this component's real
  // consumer (LibraryBrowser.tsx) already passes it and Task 11 ("plunk
  // in arranger") will need it once placement lands. This `void` is only
  // to satisfy this project's tsconfig noUnusedParameters /
  // @typescript-eslint/no-unused-vars until that wiring exists.
  void currentSketch

  const bpm = useAppSelector((s) => s.bpm)
  const [onlyOwnStems, setOnlyOwnStems] = useState(true)

  function addSlot(role: ArrangeRole): void {
    setSlots((prev) => [...prev, { id: freshSlotId(), role, locked: false, candidate: null }])
  }

  function removeSlot(id: string): void {
    setSlots((prev) => prev.filter((s) => s.id !== id))
  }

  function toggleLock(id: string): void {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, locked: !s.locked } : s)))
  }

  async function rerollSlot(id: string): Promise<void> {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    const candidates = await window.rifffApi.getDiscoverCandidates(
      slot.role,
      onlyOwnStems,
      currentUsername
    )
    const ranked = rankCandidates(candidates, { targetBpm: bpm })
    const picked = pickReroll(ranked, chaos)
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, candidate: picked } : s)))
  }

  async function rerollAll(): Promise<void> {
    // Sequential, not Promise.all -- each slot's own reroll is a real IPC
    // round trip; running them one at a time keeps this simple and avoids
    // hammering the main process with N simultaneous full-library scans at
    // once for a loop with many slots. Locked slots are skipped entirely.
    for (const slot of slots) {
      if (!slot.locked) await rerollSlot(slot.id)
    }
  }

  return (
    <div style={{ padding: 10, overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>tight</span>
        <input
          type="range"
          min={0}
          max={100}
          value={chaos}
          onChange={(e) => setChaos(Number(e.target.value))}
        />
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>loose</span>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--ra-border)' }} />
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
            checked={onlyOwnStems}
            onChange={(e) => setOnlyOwnStems(e.target.checked)}
          />
          only my stems
        </label>
        <button
          onClick={() => void rerollAll()}
          style={{
            marginLeft: 'auto',
            fontFamily: 'inherit',
            fontSize: 9,
            padding: '4px 10px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          ⚄ reroll all
        </button>
      </div>

      {slots.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--ra-text-2)', padding: 12 }}>
          add a slot below to start building a loop
        </div>
      )}

      {slots.map((slot) => (
        <DiscoverSlotRow
          key={slot.id}
          slot={slot}
          onToggleLock={() => toggleLock(slot.id)}
          onRemove={() => removeSlot(slot.id)}
          onReroll={() => void rerollSlot(slot.id)}
        />
      ))}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
        {ARRANGE_ROLE_OPTIONS.map((role) => (
          <button
            key={role}
            onClick={() => addSlot(role)}
            style={{
              fontFamily: 'inherit',
              fontSize: 9,
              padding: '4px 8px',
              background: 'transparent',
              border: '1px dashed var(--ra-border-strong)',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            + {role}
          </button>
        ))}
      </div>
    </div>
  )
}

function DiscoverSlotRow({
  slot,
  onToggleLock,
  onRemove,
  onReroll
}: {
  slot: DiscoverSlot
  onToggleLock: () => void
  onRemove: () => void
  onReroll: () => void
}): React.JSX.Element {
  // Resolves the slot's own candidate down to a real, locally-downloaded
  // Stem (resolveCandidateStem, defined above) -- PolarGlyph needs a real
  // on-disk path to decode (getBandEnergy/getPitchContour both read the
  // file directly), and a DiscoverCandidate carries no local path of its
  // own until resolved. Re-resolves whenever `slot.candidate` itself
  // changes identity (a fresh reroll) -- `cancelled` guards against a
  // stale, slower-resolving previous candidate's download completing
  // AFTER a newer reroll has already replaced it, same stale-response
  // guard convention as this session's own useStemFeatureScan.ts. An
  // empty slot, or one whose candidate hasn't resolved yet (still
  // downloading, or resolution failed), renders a plain placeholder ring
  // instead of calling PolarGlyph with nothing to analyze.
  //
  // `resolved` is paired with the candidate it was resolved FOR (rather
  // than reset to null synchronously at the top of the effect below,
  // which react-hooks/set-state-in-effect flags as a cascading-render
  // risk) -- `resolvedStem` below derives the "not ready yet" placeholder
  // state by comparing `resolved.candidate` against the CURRENT
  // `slot.candidate` identity, so a fresh reroll reads as unresolved
  // immediately (same visible behavior as an explicit reset) without ever
  // calling setState synchronously in the effect body.
  const [resolved, setResolved] = useState<{ candidate: DiscoverCandidate; stem: Stem } | null>(
    null
  )

  useEffect(() => {
    let cancelled = false
    if (!slot.candidate) return
    const candidate = slot.candidate
    void resolveCandidateStem(candidate).then((stem) => {
      if (cancelled || !stem) return
      setResolved({ candidate, stem: { slot: 1, ...stem } })
    })
    return () => {
      cancelled = true
    }
  }, [slot.candidate])

  const resolvedStem = resolved?.candidate === slot.candidate ? resolved.stem : null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--ra-border-soft)'
      }}
    >
      <button
        onClick={onToggleLock}
        title={slot.locked ? 'locked -- survives reroll all' : 'unlocked'}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 6px',
          background: slot.locked ? 'var(--ra-stretch-on-bg)' : 'transparent',
          border: `1px solid ${slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        {slot.locked ? 'locked' : 'unlocked'}
      </button>
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 64 }}>{slot.role}</span>
      {resolvedStem ? (
        <PolarGlyph stems={[resolvedStem]} identityColor={stemColorVar(resolvedStem)} size={40} />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            border: '1px dashed var(--ra-border)',
            borderRadius: '50%'
          }}
        />
      )}
      <span style={{ fontSize: 9, color: 'var(--ra-text)' }}>
        {slot.candidate?.presetName ?? 'no candidate yet'}
      </span>
      <button
        onClick={onReroll}
        style={{
          marginLeft: 'auto',
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        ⚄ reroll
      </button>
      <button
        onClick={onRemove}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        remove
      </button>
    </div>
  )
}
