import { useCallback, useEffect, useRef } from 'react'
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { buildEngineProject } from '@shared/buildEngineProject'
import type { Stem } from '@shared/types'
import { initialState, type AppState } from './store'
import {
  useAppSelector,
  useDispatch,
  useEngineOwnership,
  useFlushEngineSyncNow,
  usePluginCatalog
} from './StoreContext'

/**
 * Auditioning a stem that is in NO rifff and has no stemKey -- a library
 * stem, which useStemPreviewPlayback cannot reach because it solos by
 * stemKey against state.rifffs.
 *
 * THE INVARIANT THIS SHARES WITH useStemPreviewPlayback, and the reason
 * both are acceptable (spec, "There are two audition paths"): **each
 * audition hands the engine a project containing exactly the stems being
 * auditioned and nothing else, and starting one stops the previous one
 * entirely.** For the sketch that is store.ts's stemPreviewOverrides -- no
 * curves, no reverb, no mute regions, no risers -- so a stem is judged as
 * the file and not as the arrangement. Here it is free: a throwaway project
 * built from these stems alone has no toolkit to blank. **Neither path may
 * regress to letting a previous audition ring on underneath a new one** --
 * that was a real reported bug ("tidy up often plays multiple stems at
 * once").
 *
 * Deliberately NOT an extraction of DiscoverPanel's own syncPreviewToEngine.
 * That function carries a slot-id mapping, a barLengthOverride computed
 * across every resolved slot, an rAF burst-coalescer and a mute/solo model,
 * every one of which exists for a bug this hook cannot have (there are no
 * slots and nothing toggles mid-audition). Rewiring DiscoverPanel to share
 * this would be a large change to correctness-critical async ordering for no
 * behaviour gain. This is a narrow sibling, on purpose, and it keeps the
 * three guards that actually matter: an unmount flag, a generation counter,
 * and the engine-ownership token.
 *
 * Its owner id is 'tidy-up-library-preview', a THROWAWAY-project owner like
 * 'discover-preview' -- StoreContext.tsx's position handler must not wrap
 * this preview's position against the real timeline's own loopLengthBars.
 */
export function useThrowawayStemPreview(): {
  previewStems: (stems: { stem: Omit<Stem, 'slot'>; gain: number }[]) => Promise<void>
} {
  const dispatch = useDispatch()
  const bpm = useAppSelector((s) => s.bpm)
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  const pluginCatalog = usePluginCatalog()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const {
    claim: claimEngine,
    stillOwn: stillOwnEngine,
    release: releaseEngine
  } = useEngineOwnership()

  const unmountedRef = useRef(false)
  const generationRef = useRef(0)
  const loadedRef = useRef(false)

  // The `= false` in the SETUP body, not just in useRef, is load-bearing:
  // this app runs under <StrictMode>, whose synthetic setup -> cleanup ->
  // setup cycle would otherwise leave this true forever. Same gotcha
  // useStemPreviewPlayback.ts and DiscoverPanel.tsx both document at length.
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      const token = releaseEngine()
      if (!loadedRef.current) return
      loadedRef.current = false
      // Stop, then hand the real project back -- without the PAUSE the
      // engine's transport keeps running under whatever project lands next
      // (DiscoverPanel's restorePreviewIfLoaded documents the same report).
      dispatch({ type: 'PAUSE' })
      void flushEngineSyncNow(undefined, () => !stillOwnEngine(token))
    }
  }, [dispatch, flushEngineSyncNow, releaseEngine, stillOwnEngine])

  const previewStems = useCallback(
    async (stems: { stem: Omit<Stem, 'slot'>; gain: number }[]): Promise<void> => {
      // Assembled BEFORE the claim, deliberately: claiming and then
      // returning early would leave ownership held with nothing loaded,
      // which silences the real project's own automatic sync for good.
      // maxMembers is stems.length -- this rifff is a throwaway preview,
      // never persisted, with no Riffs.StemCID_1..8 schema to fit into
      // (see assembleDiscoverRifff's own doc comment for the real bug that
      // sharing its 8-stem default caused in Discover).
      const assembly = assembleDiscoverRifff('tidy up', stems, bpm, stems.length)
      if (assembly === null) return
      const { rifff, vol } = assembly

      const myGeneration = ++generationRef.current
      const engineToken = claimEngine('tidy-up-library-preview')

      // A throwaway single-rifff AppState -- only bpm/masterChain/
      // channelPlugins come from the real project; state.rifffs is ENTIRELY
      // replaced by this one rifff, never merged. `startBar: 0` is what
      // buildEngineProject's own `placed` filter needs to include it at
      // all, and it makes this preview's loopLengthBars exactly the rifff's
      // own barLength, so the transport loops just this one loop.
      const previewState: AppState = {
        ...initialState,
        bpm,
        masterChain,
        channelPlugins,
        rifffs: { [rifff.groupId]: { ...rifff, startBar: 0 } },
        vol,
        stretch: { [rifff.groupId]: true }
      }
      try {
        const project = await buildEngineProject(
          previewState,
          resolveStretchedForPlayback,
          pluginCatalog
        )
        if (unmountedRef.current || generationRef.current !== myGeneration) return
        if (!stillOwnEngine(engineToken)) return
        await window.rifffApi.engineLoadProject(project)
        if (unmountedRef.current || generationRef.current !== myGeneration) return
        if (!stillOwnEngine(engineToken)) return
        loadedRef.current = true
        void window.rifffApi.engineSetPosition(0)
        dispatch({ type: 'PLAY' })
      } catch (err) {
        console.error('useThrowawayStemPreview: failed to load preview:', err)
        if (!loadedRef.current && stillOwnEngine(engineToken)) releaseEngine()
      }
    },
    [
      bpm,
      channelPlugins,
      claimEngine,
      dispatch,
      masterChain,
      pluginCatalog,
      releaseEngine,
      stillOwnEngine
    ]
  )

  return { previewStems }
}
