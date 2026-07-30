import { useEffect, useState } from 'react'
import type { LoreJam } from '@shared/loreLibrary'

export function LoreLibraryBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [jamFilter, setJamFilter] = useState('')
  const [jams, setJams] = useState<LoreJam[]>([])
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)

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

            <div style={{ flex: 1, minWidth: 0 }}>
              {selectedJamCID === null && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  select a jam to browse its riffs
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
