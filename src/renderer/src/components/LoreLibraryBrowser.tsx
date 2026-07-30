import { useEffect, useState } from 'react'
import type { LoreJam, LoreRiffSummary } from '@shared/loreLibrary'

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
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
