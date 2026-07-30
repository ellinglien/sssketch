import { useEffect, useRef, useState } from 'react'
import type { LoreJam, LoreRiffSummary, LoreResolvedRiff } from '@shared/loreLibrary'
import { instrumentMaskToSoundType } from '@shared/loreLibrary'
import { getAudioContext } from '../audio/peakCache'
import { sqrtGain } from '@shared/mixGain'
import { usePlaying, useDispatch } from '../state/StoreContext'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { classifyStems } from '../audio/classifyStems'
import { stemKey } from '@shared/types'

/** Continuous brightness ramp from dark gray (0% ownership) to white (100%)
 * — a riff missing any cached stems overrides this entirely and renders flat
 * black, since it can't be previewed or imported yet regardless of who made
 * it. One brightness axis, no separate accent hue, matching the app's
 * existing "color spent only on things that carry information" design
 * language (see tokens.css). */
function riffCircleColor(riff: LoreRiffSummary): string {
  if (riff.cachedStemCount < riff.stemCount) return '#000000'
  const lo = 60 // dark gray floor, not pure black, so 0% still reads as "a riff", not "empty"
  const hi = 237 // matches --ra-text's near-white value
  const v = Math.round(lo + riff.ownerFraction * (hi - lo))
  return `rgb(${v}, ${v}, ${v})`
}

export function LoreLibraryBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [jamFilter, setJamFilter] = useState('')
  const [jams, setJams] = useState<LoreJam[]>([])
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)
  const [riffs, setRiffs] = useState<LoreRiffSummary[]>([])
  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  const [bpmFilter, setBpmFilter] = useState('')
  const [userNameFilter, setUserNameFilter] = useState('')
  const [onlyFullyCached, setOnlyFullyCached] = useState(false)
  // Tracks the last jamCID a riff selection was reset for — compared during
  // render (not in an effect) so switching jams clears the stale riff
  // selection in the same render pass, matching the "adjust state while
  // rendering" pattern TransportBar.tsx's own tempo-resync already uses,
  // rather than the extra render cycle a useEffect-based reset would cause.
  const [resetForJamCID, setResetForJamCID] = useState<string | null>(null)
  if (selectedJamCID !== resetForJamCID) {
    setResetForJamCID(selectedJamCID)
    setSelectedRiffCID(null)
  }

  const [resolvedRiff, setResolvedRiff] = useState<LoreResolvedRiff | null>(null)
  const [importedRiffCIDs, setImportedRiffCIDs] = useState<Set<string>>(new Set())
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playing = usePlaying()
  const dispatch = useDispatch()

  function stopPreview(): void {
    for (const source of previewSourcesRef.current) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    previewSourcesRef.current = []
  }

  function handleImport(): void {
    if (!resolvedRiff || !selectedRiffCID) return
    const cachedStems = resolvedRiff.stems.filter((s) => s.path !== null)
    if (cachedStems.length === 0) return

    const groupId = crypto.randomUUID()
    const rifff = {
      groupId,
      name: `LORE riff ${selectedRiffCID.slice(0, 8)}`,
      bpm: resolvedRiff.bpm,
      barLength: resolvedRiff.barLength,
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
    setImportedRiffCIDs((prev) => new Set(prev).add(selectedRiffCID))

    // Same "fill in unclassified stems by ear" heuristic drag-and-drop import
    // already uses — the Instrument bitmask covers drum/note/bass/mic
    // confidently, but a stem with no matching bit (mapped to 'fx' above)
    // gets a second chance here, same as today's importer gives every stem.
    classifyStems(rifff, dispatch).catch((err) => {
      console.error('LoreLibraryBrowser: failed to classify stem types:', err)
    })
  }

  useEffect(() => {
    let cancelled = false
    void window.rifffApi.loreWarehouseAvailable().then((v) => {
      if (!cancelled) setAvailable(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!available) return
    let cancelled = false
    void window.rifffApi.loreListJams(jamFilter).then((result) => {
      if (!cancelled) setJams(result)
    })
    return () => {
      cancelled = true
    }
  }, [available, jamFilter])

  useEffect(() => {
    // No "deselect jam" affordance exists — selecting always moves to a new
    // non-null jamCID, so there's nothing to clear here; riffs simply starts
    // at its initial [] and is only ever populated once a jam is picked. The
    // grid itself is also only rendered when selectedJamCID !== null (see
    // below), so even a theoretical stale value would never be visible.
    if (!selectedJamCID) return
    let cancelled = false
    const filters: {
      bpm?: number
      userName?: string
      onlyFullyCached?: boolean
    } = {}
    if (bpmFilter.trim() !== '' && !Number.isNaN(Number(bpmFilter))) filters.bpm = Number(bpmFilter)
    if (userNameFilter.trim() !== '') filters.userName = userNameFilter.trim()
    if (onlyFullyCached) filters.onlyFullyCached = true

    void window.rifffApi.loreListRiffs(selectedJamCID, filters).then((result) => {
      if (!cancelled) setRiffs(result)
    })
    return () => {
      cancelled = true
    }
  }, [selectedJamCID, bpmFilter, userNameFilter, onlyFullyCached])

  useEffect(() => {
    stopPreview()
    // No "deselect riff" affordance exists — selecting always moves to a new
    // non-null riffCID, so there's nothing to clear here; resolvedRiff stays
    // stale-but-unrendered the same way riffs does above (the detail line is
    // only rendered when resolvedRiff is truthy).
    if (!selectedRiffCID) return
    let cancelled = false
    void window.rifffApi.loreResolveRiff(selectedRiffCID).then(async (resolved) => {
      if (cancelled || !resolved) return
      setResolvedRiff(resolved)

      // Auto-preview on selection, full mix only — same reasoning as
      // BeatPicker's own preview: pause the main arrangement first so the
      // two don't play over each other.
      if (playing) dispatch({ type: 'PAUSE' })
      const cachedStems = resolved.stems.filter((s) => s.path !== null)
      const ctx = getAudioContext()
      const gain = sqrtGain(cachedStems.length)
      for (const stem of cachedStems) {
        try {
          const bytes = await window.rifffApi.readAudioFile(stem.path!)
          const arrayBuffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          )
          const decoded = await ctx.decodeAudioData(arrayBuffer as ArrayBuffer)
          if (cancelled) return
          const source = ctx.createBufferSource()
          source.buffer = decoded
          source.loop = true
          const gainNode = ctx.createGain()
          gainNode.gain.value = gain * stem.gain
          source.connect(gainNode)
          gainNode.connect(ctx.destination)
          source.start(0)
          previewSourcesRef.current.push(source)
        } catch (err) {
          console.error(`LoreLibraryBrowser: failed to decode preview audio for ${stem.path}:`, err)
        }
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playing/dispatch intentionally excluded: this only re-runs on riff selection, matching BeatPicker's own pattern of reading transport state at the moment a preview starts rather than tracking it as a dependency
  }, [selectedRiffCID])

  useEffect(() => {
    return () => stopPreview()
  }, [])

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
                    <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                      {riffs.length} riffs
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 5,
                      overflowY: 'auto',
                      flex: 1,
                      alignContent: 'flex-start'
                    }}
                  >
                    {riffs.map((riff) => (
                      <button
                        key={riff.riffCID}
                        onClick={() => setSelectedRiffCID(riff.riffCID)}
                        title={`${riff.bpm} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          border:
                            selectedRiffCID === riff.riffCID
                              ? '2px solid var(--ra-playhead)'
                              : '1px solid var(--ra-border)',
                          padding: 0,
                          background: riffCircleColor(riff),
                          cursor: 'pointer'
                        }}
                      />
                    ))}
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
                      <button
                        onClick={handleImport}
                        disabled={resolvedRiff.stems.every((s) => s.path === null)}
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
                        {selectedRiffCID !== null && importedRiffCIDs.has(selectedRiffCID)
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
