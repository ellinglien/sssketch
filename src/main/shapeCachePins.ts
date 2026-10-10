// EEEDIT preview cache files a running render reads or wrote (shapeMaterialize.ts). Neither the
// cache's own eviction nor the cleanup (reonedUsage.ts's surveyShapes and cleanShapes) deletes a
// pinned file. Kept apart from shapeMaterialize so the cleanup needn't load the renderer's
// dependencies (electron).
import { resolve } from 'node:path'

const pinned = new Map<string, number>()

/** Pins `paths` until the returned release is called (once; later calls do nothing). */
export function pinShapeCachePaths(paths: Iterable<string>): () => void {
  const held = [...new Set([...paths].map((p) => resolve(p)))]
  for (const path of held) pinned.set(path, (pinned.get(path) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    for (const path of held) {
      const count = (pinned.get(path) ?? 1) - 1
      if (count <= 0) pinned.delete(path)
      else pinned.set(path, count)
    }
  }
}

export function isShapeCachePathPinned(path: string): boolean {
  return pinned.has(resolve(path))
}
