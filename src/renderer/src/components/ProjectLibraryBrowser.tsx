// src/renderer/src/components/ProjectLibraryBrowser.tsx
import { useEffect, useState } from 'react'

interface LibrarySketchSummary {
  name: string
  mtimeMs: number
}

// See PluginCatalogBrowser.tsx's own buttonStyle doc comment -- buttons in
// this app have no default chrome, so every button needs an explicit
// dark-theme style or it falls back to near-invisible default control chrome.
function buttonStyle(disabled?: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '3px 8px',
    background: 'var(--ra-bg-row-active)',
    border: `1px solid ${disabled ? 'var(--ra-border-soft)' : 'var(--ra-border)'}`,
    borderRadius: 2,
    color: disabled ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
    cursor: disabled ? 'default' : 'pointer'
  }
}

function formatMtime(mtimeMs: number): string {
  return new Date(mtimeMs).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

export function ProjectLibraryBrowser({
  onSelect,
  onClose
}: {
  onSelect: (name: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [sketches, setSketches] = useState<LibrarySketchSummary[] | null>(null)
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null)
  const [changingLocation, setChangingLocation] = useState(false)

  useEffect(() => {
    window.rifffApi
      .listLibrarySketches()
      .then(setSketches)
      .catch((err) => {
        console.error('ProjectLibraryBrowser: listLibrarySketches() failed:', err)
        setSketches([])
      })
    window.rifffApi
      .getLibraryRoot()
      .then(setLibraryRoot)
      .catch((err) => {
        console.error('ProjectLibraryBrowser: getLibraryRoot() failed:', err)
      })
  }, [])

  async function handleChangeLocation(): Promise<void> {
    setChangingLocation(true)
    try {
      const newRoot = await window.rifffApi.pickFolder()
      if (!newRoot) return
      // Clear the old list only once we know we're actually switching roots
      // (not on cancel) -- otherwise a cancelled picker would strand the
      // modal on "loading..." forever, since nothing would ever repopulate
      // `sketches`.
      setSketches(null)
      await window.rifffApi.setLibraryRoot(newRoot)
      setLibraryRoot(newRoot)
      setSketches(await window.rifffApi.listLibrarySketches())
    } catch (err) {
      console.error('ProjectLibraryBrowser: handleChangeLocation() failed:', err)
      setSketches([])
    } finally {
      setChangingLocation(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 4,
          padding: 10,
          width: 420,
          minHeight: 0,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          fontSize: 11
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8
          }}
        >
          <span style={{ color: 'var(--ra-text-2)' }}>project library</span>
          <button onClick={onClose} aria-label="Close project library" style={buttonStyle()}>
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {sketches === null && (
            <div style={{ color: 'var(--ra-text-2)', padding: '8px 0' }}>loading…</div>
          )}
          {sketches !== null && sketches.length === 0 && (
            <div style={{ color: 'var(--ra-text-2)', padding: '8px 0' }}>
              no sketches saved to the library yet
            </div>
          )}
          {sketches?.map((sketch) => (
            <div
              key={sketch.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0'
              }}
            >
              <span style={{ flex: 1, color: 'var(--ra-text)' }}>{sketch.name}</span>
              <span style={{ color: 'var(--ra-text-4)', fontSize: 9 }}>
                {formatMtime(sketch.mtimeMs)}
              </span>
              <button
                onClick={() => {
                  onSelect(sketch.name)
                  onClose()
                }}
                aria-label={`open ${sketch.name}`}
                style={buttonStyle()}
              >
                open
              </button>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--ra-border-soft)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span
            style={{
              color: 'var(--ra-text-4)',
              fontSize: 9,
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {libraryRoot ?? ''}
          </span>
          <button
            onClick={handleChangeLocation}
            disabled={changingLocation}
            style={buttonStyle(changingLocation)}
          >
            change location…
          </button>
        </div>
      </div>
    </div>
  )
}
