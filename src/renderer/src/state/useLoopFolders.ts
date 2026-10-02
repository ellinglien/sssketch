// src/renderer/src/state/useLoopFolders.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LinkLoopFolderRefusal, LoopEntry, LoopFolderListing } from '@shared/loopFolderTypes'

export interface LoopFolders {
  folders: LoopFolderListing[]
  scanning: boolean
  /** Why the last link was refused, shown under the buttons; cleared by the next try. */
  linkRefusal: LinkLoopFolderRefusal | null
  /** Picks a folder and links it. Resolves the linked root, or null. */
  link: () => Promise<string | null>
  unlink: (rootPath: string) => Promise<void>
  rescan: () => Promise<void>
  /** Swaps one loop's entry in place (tempo corrected, length reported). */
  replaceLoop: (entry: LoopEntry) => void
}

function byName(a: LoopFolderListing, b: LoopFolderListing): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** Linked loop folders for IMPORT. Shows the cached listing at once, then
 * rescans every folder when IMPORT opens (spec, "Staying current"). The
 * project tempo is read when a scan starts, not tracked: a tempo change
 * mid-session is not a reason to rescan. */
export function useLoopFolders(projectBpm: number, rescanOnOpen: boolean): LoopFolders {
  const [folders, setFolders] = useState<LoopFolderListing[]>([])
  // Link and rescan can overlap (a link during the open-rescan), so the
  // spinner counts scans in flight rather than sharing one boolean.
  const [scansInFlight, setScansInFlight] = useState(0)
  const scanning = scansInFlight > 0
  const [linkRefusal, setLinkRefusal] = useState<LinkLoopFolderRefusal | null>(null)
  const projectBpmRef = useRef(projectBpm)
  useEffect(() => {
    projectBpmRef.current = projectBpm
  }, [projectBpm])

  const rescan = useCallback(async (): Promise<void> => {
    setScansInFlight((n) => n + 1)
    try {
      setFolders(await window.rifffApi.loopFoldersRescan(projectBpmRef.current))
    } catch (err) {
      console.error('useLoopFolders: rescan failed:', err)
    } finally {
      setScansInFlight((n) => n - 1)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .loopFoldersList()
      .then((cached) => {
        if (cancelled) return
        setFolders(cached)
        if (rescanOnOpen && cached.length > 0) void rescan()
      })
      .catch((err) => console.error('useLoopFolders: list failed:', err))
    return () => {
      cancelled = true
    }
  }, [rescan, rescanOnOpen])

  const link = useCallback(async (): Promise<string | null> => {
    setLinkRefusal(null)
    const picked = await window.rifffApi.pickFolder()
    if (!picked) return null
    setScansInFlight((n) => n + 1)
    try {
      const result = await window.rifffApi.loopFoldersLink(picked, projectBpmRef.current)
      if (!result.ok) {
        setLinkRefusal(result.reason)
        return null
      }
      setFolders((prev) =>
        [...prev.filter((f) => f.rootPath !== result.folder.rootPath), result.folder].sort(byName)
      )
      return result.folder.rootPath
    } catch (err) {
      console.error('useLoopFolders: link failed:', err)
      return null
    } finally {
      setScansInFlight((n) => n - 1)
    }
  }, [])

  const unlink = useCallback(async (rootPath: string): Promise<void> => {
    try {
      await window.rifffApi.loopFoldersUnlink(rootPath)
      setFolders((prev) => prev.filter((f) => f.rootPath !== rootPath))
    } catch (err) {
      console.error('useLoopFolders: unlink failed:', err)
    }
  }, [])

  const replaceLoop = useCallback((entry: LoopEntry): void => {
    setFolders((prev) =>
      prev.map((f) =>
        f.rootPath !== entry.rootPath
          ? f
          : { ...f, loops: f.loops.map((l) => (l.loopId === entry.loopId ? entry : l)) }
      )
    )
  }, [])

  return { folders, scanning, linkRefusal, link, unlink, rescan, replaceLoop }
}
