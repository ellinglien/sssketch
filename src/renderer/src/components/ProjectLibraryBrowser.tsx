// src/renderer/src/components/ProjectLibraryBrowser.tsx
import { useEffect, useState } from 'react'

interface LibrarySketchSummary {
  name: string
  mtimeMs: number
  favourite: boolean
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
  onOpenFromDisk,
  onClose,
  currentLibraryName
}: {
  onSelect: (name: string) => void
  /** The "open" toolbar button now opens straight to this browser (the
   * library is the primary way to find a project) -- this is the escape
   * hatch for the less common case of opening a project that was never
   * saved to the library at all (e.g. shared from elsewhere on disk).
   * Expected to close this modal itself once it's done (mirrors onSelect
   * above, which also closes via its own onClose() call rather than this
   * component closing on the caller's behalf). */
  onOpenFromDisk: () => void
  onClose: () => void
  /** The library name of whatever's currently open in the arranger, if
   * anything -- used to disable that row's delete button. Deleting the
   * sketch you're actively working in out from under yourself would leave
   * the app referencing files that no longer exist. */
  currentLibraryName: string | null
}): React.JSX.Element {
  const [sketches, setSketches] = useState<LibrarySketchSummary[] | null>(null)
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null)
  const [changingLocation, setChangingLocation] = useState(false)
  // Two-step delete: first click on a row's delete button arms it (armed
  // name stored here, only one row at a time), second click on that SAME
  // button actually deletes. Clicking anywhere else in the modal disarms
  // it -- see the panel's own onClick below -- so an armed button can't
  // linger and get triggered by an unrelated later click.
  const [deleteArmedName, setDeleteArmedName] = useState<string | null>(null)

  async function handleToggleFavourite(name: string): Promise<void> {
    await window.rifffApi.toggleSketchFavourite(name)
    // Re-fetches rather than flipping the flag in local state -- the list
    // also needs to RE-SORT (favourites always at the top, see
    // listLibrarySketches), not just re-render the one row's star, and the
    // main process is already the source of truth for that ordering.
    setSketches(await window.rifffApi.listLibrarySketches())
  }

  async function handleDeleteClick(name: string): Promise<void> {
    if (deleteArmedName !== name) {
      setDeleteArmedName(name)
      return
    }
    setDeleteArmedName(null)
    const result = await window.rifffApi.deleteSketch(name)
    if (!result.ok) {
      console.error('ProjectLibraryBrowser: deleteSketch failed:', result.reason)
      window.alert(`Couldn't delete "${name}": ${result.reason}`)
      return
    }
    setSketches(await window.rifffApi.listLibrarySketches())
  }

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
        onClick={(e) => {
          e.stopPropagation()
          setDeleteArmedName(null)
        }}
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onOpenFromDisk} style={buttonStyle()}>
              open from disk…
            </button>
            <button onClick={onClose} aria-label="Close project library" style={buttonStyle()}>
              ×
            </button>
          </div>
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
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleToggleFavourite(sketch.name)
                }}
                aria-label={`${sketch.favourite ? 'unfavourite' : 'favourite'} ${sketch.name}`}
                title={sketch.favourite ? 'unfavourite' : 'favourite'}
                style={{
                  ...buttonStyle(),
                  padding: '2px 6px',
                  color: sketch.favourite ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
                }}
              >
                {sketch.favourite ? '★' : '☆'}
              </button>
              <span
                onClick={() => {
                  onSelect(sketch.name)
                  onClose()
                }}
                role="button"
                aria-label={`open ${sketch.name}`}
                style={{ flex: 1, color: 'var(--ra-text)', cursor: 'pointer' }}
              >
                {sketch.name}
              </span>
              <span style={{ color: 'var(--ra-text-4)', fontSize: 9 }}>
                {formatMtime(sketch.mtimeMs)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDeleteClick(sketch.name)
                }}
                disabled={sketch.name === currentLibraryName}
                title={
                  sketch.name === currentLibraryName
                    ? "can't delete the sketch you're currently working in"
                    : deleteArmedName === sketch.name
                      ? 'click again to delete (moves to trash)'
                      : 'delete (moves to trash)'
                }
                aria-label={
                  deleteArmedName === sketch.name
                    ? `confirm delete ${sketch.name}`
                    : `delete ${sketch.name}`
                }
                style={buttonStyle(sketch.name === currentLibraryName)}
              >
                {deleteArmedName === sketch.name ? 'delete?' : '×'}
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
