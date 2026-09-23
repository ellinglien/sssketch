import { useEffect, useMemo, useState } from 'react'
import type { ArrangeRole } from '@shared/stemRole'

const EMPTY: Readonly<Record<string, ArrangeRole>> = {}

/**
 * What somebody already said these stems are, out of the global
 * StemCategories table.
 *
 * Fetched once per distinct path set and then left alone. A path nobody has
 * confirmed is simply absent -- never an empty string, never a guess (see
 * getStemCategoryRolesForPaths, main/stemCategoriesStore.ts).
 *
 * The setState is deferred through a microtask, not called directly in the
 * effect body: this repo ERRORS on a synchronous setState in an effect
 * (react-hooks/set-state-in-effect). Same established workaround as
 * LibraryBrowser.tsx and DiscoverPanel.tsx already use.
 */
export function useConfirmedStemRoles(paths: string[]): Readonly<Record<string, ArrangeRole>> {
  // Keyed on the SET of paths, sorted and joined: the caller rebuilds its
  // array every render, so an array identity would refetch on every keystroke
  // anywhere in the app.
  const key = useMemo(() => [...new Set(paths)].sort().join('\n'), [paths])
  const [byPath, setByPath] = useState<Readonly<Record<string, ArrangeRole>>>(EMPTY)

  useEffect(() => {
    let cancelled = false
    const wanted = key === '' ? [] : key.split('\n')
    if (wanted.length === 0) {
      void Promise.resolve().then(() => {
        if (!cancelled) setByPath(EMPTY)
      })
      return () => {
        cancelled = true
      }
    }
    void window.rifffApi
      .getStemCategoryRoles(wanted)
      .then((rows) => {
        if (cancelled) return
        const next: Record<string, ArrangeRole> = {}
        for (const [path, row] of Object.entries(rows)) next[path] = row.arrangeRole
        setByPath(next)
      })
      .catch((err: unknown) => {
        // A failed read means the map falls back to the climax role and the
        // stem's name, which is exactly what it did before this existed.
        console.error('useConfirmedStemRoles: failed to read confirmed roles:', err)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return byPath
}
