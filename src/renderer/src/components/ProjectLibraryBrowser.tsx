// src/renderer/src/components/ProjectLibraryBrowser.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { stemKey } from '@shared/types'
import { deserializeProject } from '../state/serialize'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'

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
  currentLibraryName,
  onBeforeReplaceProject
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
  /** App.tsx's Frame's shared discard-guard, adapted to this component's
   * needs -- called before replacing the live project (a row click, or a
   * backup restore) to give the user a chance to save/discard/cancel first.
   * Resolves 'proceed' immediately when there's nothing unsaved to lose.
   * Frame's own implementation performs the actual save internally when
   * the user picks "save" (this component has no access to handleSave),
   * so the only thing this needs to branch on is whether to continue. */
  onBeforeReplaceProject: () => Promise<'proceed' | 'cancel'>
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
  // Which row's backup history is currently expanded (at most one) --
  // fetched lazily on open rather than for every row up front, since most
  // sketches will never be opened this way. See rotateBackupBeforeOverwrite
  // (projectLibrary.ts) for what populates this: every explicit save (the
  // Save button, Cmd+S, or the quit-time save prompt) backs up whatever was
  // on disk just before overwriting it, so an unwanted overwrite is always
  // recoverable here.
  const [historyOpenName, setHistoryOpenName] = useState<string | null>(null)
  const [backups, setBackups] = useState<{ path: string; mtimeMs: number }[]>([])
  // Same two-step arm/confirm pattern as deleteArmedName above, keyed by
  // backup path (not sketch name) since several backups can be listed at
  // once under one expanded row.
  const [restoreArmedPath, setRestoreArmedPath] = useState<string | null>(null)
  // Audio-only preview of a backup, keyed by its path -- see
  // startPreviewLoop's own doc comment (audio/previewLoop.ts): a plain Web
  // Audio decode-and-loop mechanism, the SAME one the rifff library preview
  // uses, deliberately NOT the native engine. A backup's project JSON is
  // parsed straight from disk and never dispatched into the live reducer,
  // so previewing one can't disturb whatever's actually open in the
  // arranger -- the native engine's own "current project" is never touched.
  const [previewingPath, setPreviewingPath] = useState<string | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewTokenRef = useRef(0)
  // Bumped on every stop/new-attempt -- lets an in-flight decode (the
  // rifffApi.readSketchBackup + decodeAudioData round trip inside
  // startPreviewLoop both take real time) notice it's been superseded by a
  // later click and bail out instead of clobbering whatever's now playing.
  const previewGenerationRef = useRef(0)

  const stopBackupPreview = useCallback(() => {
    previewGenerationRef.current++
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
    setPreviewingPath(null)
  }, [])

  // Unmount cleanup only (empty deps) -- getAudioContext() returns a
  // module-level singleton that outlives this component, so a source
  // that's still playing when this modal closes would otherwise keep
  // looping in the background forever with no way to reach it again.
  useEffect(() => stopBackupPreview, [stopBackupPreview])

  async function handlePreviewClick(name: string, backupPath: string): Promise<void> {
    if (previewingPath === backupPath) {
      stopBackupPreview()
      return
    }
    stopBackupPreview()
    const generation = previewGenerationRef.current
    const json = await window.rifffApi.readSketchBackup(name, backupPath)
    if (previewGenerationRef.current !== generation) return
    if (!json) {
      window.alert("Couldn't preview that version.")
      return
    }
    let state: ReturnType<typeof deserializeProject>
    try {
      state = deserializeProject(JSON.parse(json))
    } catch (err) {
      console.error('ProjectLibraryBrowser: failed to parse backup for preview:', err)
      window.alert("Couldn't preview that version.")
      return
    }
    // Only placed (arranged) stems -- an unplaced shelf-only rifff was
    // never actually part of "what this version sounded like."
    const stems = Object.values(state.rifffs)
      .filter((rifff) => rifff.startBar !== undefined)
      .flatMap((rifff) =>
        rifff.stems.map((stem) => ({
          path: stem.path,
          gain: state.vol[stemKey(rifff.groupId, stem.slot)] ?? 1,
          durationSec: stem.durationSec
        }))
      )
    if (stems.length === 0) {
      window.alert('Nothing to preview -- no stems were placed on the timeline in that version.')
      return
    }
    if (previewGenerationRef.current !== generation) return
    setPreviewingPath(backupPath)
    const sources = await startPreviewLoop(
      getAudioContext(),
      stems,
      () => previewGenerationRef.current !== generation
    )
    if (previewGenerationRef.current !== generation) {
      stopPreviewSources(sources)
      return
    }
    if (sources.length === 0) {
      setPreviewingPath(null)
      return
    }
    previewSourcesRef.current = sources
    previewTokenRef.current = registerActivePreview(stopBackupPreview)
  }

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

  async function handleToggleHistory(name: string): Promise<void> {
    stopBackupPreview()
    if (historyOpenName === name) {
      setHistoryOpenName(null)
      return
    }
    setRestoreArmedPath(null)
    setHistoryOpenName(name)
    setBackups(await window.rifffApi.listSketchBackups(name))
  }

  // Restoring loads the now-restored content the same way clicking the
  // sketch's own row does (onSelect + onClose) -- "restore this version"
  // means "open it," matching that existing mental model rather than
  // introducing a second, silent way for a sketch's live content to change.
  async function handleRestoreClick(name: string, backupPath: string): Promise<void> {
    if (restoreArmedPath !== backupPath) {
      setRestoreArmedPath(backupPath)
      return
    }
    // Runs BEFORE restoreSketchBackup, not just before the subsequent
    // onSelect -- restoring already changes the file on disk (safely, via
    // its own pre-restore backup), so checking only after the fact would
    // leave the live editor out of sync with a disk change the user just
    // tried to cancel.
    if ((await onBeforeReplaceProject()) === 'cancel') {
      setRestoreArmedPath(null)
      return
    }
    setRestoreArmedPath(null)
    stopBackupPreview()
    const result = await window.rifffApi.restoreSketchBackup(name, backupPath)
    if (!result.ok) {
      console.error('ProjectLibraryBrowser: restoreSketchBackup failed:', result.reason)
      window.alert(`Couldn't restore that version: ${result.reason}`)
      return
    }
    setHistoryOpenName(null)
    onSelect(name)
    onClose()
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
          setRestoreArmedPath(null)
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
            <div key={sketch.name}>
              <div
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
                    void (async () => {
                      if ((await onBeforeReplaceProject()) === 'cancel') return
                      onSelect(sketch.name)
                      onClose()
                    })()
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
                    void handleToggleHistory(sketch.name)
                  }}
                  title="earlier autosaved versions"
                  aria-label={`earlier versions of ${sketch.name}`}
                  style={{
                    ...buttonStyle(),
                    color: historyOpenName === sketch.name ? 'var(--ra-text)' : 'var(--ra-text-2)'
                  }}
                >
                  history
                </button>
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
              {historyOpenName === sketch.name && (
                <div
                  style={{
                    margin: '0 0 4px 22px',
                    paddingLeft: 8,
                    borderLeft: '1px solid var(--ra-border-soft)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                  }}
                >
                  {backups.length === 0 && (
                    <span style={{ color: 'var(--ra-text-4)', fontSize: 9, padding: '2px 0' }}>
                      no earlier versions yet
                    </span>
                  )}
                  {backups.map((backup) => (
                    <div
                      key={backup.path}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span style={{ flex: 1, color: 'var(--ra-text-2)', fontSize: 9 }}>
                        {formatMtime(backup.mtimeMs)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handlePreviewClick(sketch.name, backup.path)
                        }}
                        title={
                          previewingPath === backup.path ? 'stop preview' : 'preview (audio only)'
                        }
                        aria-label={
                          previewingPath === backup.path
                            ? `stop preview of ${sketch.name} at ${formatMtime(backup.mtimeMs)}`
                            : `preview ${sketch.name} at ${formatMtime(backup.mtimeMs)}`
                        }
                        style={{
                          ...buttonStyle(),
                          color:
                            previewingPath === backup.path ? 'var(--ra-text)' : 'var(--ra-text-2)'
                        }}
                      >
                        {previewingPath === backup.path ? 'stop' : 'preview'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRestoreClick(sketch.name, backup.path)
                        }}
                        title={
                          restoreArmedPath === backup.path
                            ? 'click again to restore this version'
                            : 'restore this version'
                        }
                        aria-label={
                          restoreArmedPath === backup.path
                            ? `confirm restore ${sketch.name} to ${formatMtime(backup.mtimeMs)}`
                            : `restore ${sketch.name} to ${formatMtime(backup.mtimeMs)}`
                        }
                        style={buttonStyle()}
                      >
                        {restoreArmedPath === backup.path ? 'restore?' : 'restore'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
