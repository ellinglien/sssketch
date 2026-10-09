import { useCallback, useEffect, useRef } from 'react'
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { buildEngineProject } from '@shared/buildEngineProject'
import type { Stem } from '@shared/types'
import { initialState, type AppState } from './store'
import { appSoundDefaultsNow } from './appSoundDefaults'
import { mergeSoundSettings } from '@shared/radioSound'
import {
  useAppSelector,
  useDispatch,
  useEngineOwnership,
  useFlushEngineSyncNow,
  usePluginCatalog
} from './StoreContext'

export type CrossPreviewMode = 'center' | `riff:${string}` | `source:${string}`

export interface CrossPreviewMember {
  stem: Omit<Stem, 'slot'>
  gain: number
}

/** Marks the native load as restore-relevant before issuing it. This order
 * is the cancellation barrier: Stop/Back/unmount can then restore the real
 * arrangement even while engineLoadProject's acknowledgement is pending. */
export async function issueCrossPreviewLoad(
  load: () => Promise<void>,
  markLoadIssued: () => void,
  isCancelled: () => boolean
): Promise<boolean> {
  markLoadIssued()
  await load()
  return !isCancelled()
}

/** A narrow throwaway-project controller for Cross. One ownership token
 * covers source audition and the child mix, so switching modes can never
 * leave an older source playing underneath a newer one. */
export function useCrossPreview(): {
  preview: (
    mode: CrossPreviewMode,
    members: CrossPreviewMember[],
    targetBpm: number,
    loopBars: number
  ) => Promise<void>
  stop: () => void
} {
  const dispatch = useDispatch()
  const masterChain = useAppSelector((state) => state.masterChain)
  const channelPlugins = useAppSelector((state) => state.channelPlugins)
  const sound = useAppSelector((state) => state.sound)
  const pluginCatalog = usePluginCatalog()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const {
    claim: claimEngine,
    stillOwn: stillOwnEngine,
    release: releaseEngine
  } = useEngineOwnership()

  const unmountedRef = useRef(false)
  const generationRef = useRef(0)
  const tokenRef = useRef<number | null>(null)
  // True from immediately BEFORE a load is issued until the real project is
  // restored. It deliberately means "may have reached native", not merely
  // "load acknowledgement returned".
  const needsRestoreRef = useRef(false)
  const modeRef = useRef<CrossPreviewMode | null>(null)

  const stop = useCallback(() => {
    generationRef.current += 1
    const token = tokenRef.current
    tokenRef.current = null
    modeRef.current = null
    const needsRestore = needsRestoreRef.current
    needsRestoreRef.current = false
    if (token === null || !stillOwnEngine(token)) return
    const released = releaseEngine()
    if (!needsRestore) return
    dispatch({ type: 'PAUSE' })
    void flushEngineSyncNow(undefined, () => !stillOwnEngine(released))
  }, [dispatch, flushEngineSyncNow, releaseEngine, stillOwnEngine])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      stop()
    }
  }, [stop])

  const preview = useCallback(
    async (
      mode: CrossPreviewMode,
      members: CrossPreviewMember[],
      targetBpm: number,
      loopBars: number
    ): Promise<void> => {
      if (members.length === 0) {
        stop()
        return
      }
      const assembly = assembleDiscoverRifff(
        'cross preview',
        members,
        targetBpm,
        members.length,
        loopBars
      )
      if (!assembly) return

      const changingMode = !needsRestoreRef.current || modeRef.current !== mode
      const generation = ++generationRef.current
      const token = claimEngine('cross-preview')
      tokenRef.current = token
      const { rifff, vol } = assembly
      const previewState: AppState = {
        ...initialState,
        bpm: targetBpm,
        masterChain,
        channelPlugins,
        sound: mergeSoundSettings(sound ?? appSoundDefaultsNow(), {
          panning: { on: false },
          pump: { on: false }
        }),
        rifffs: { [rifff.groupId]: { ...rifff, startBar: 0 } },
        vol,
        stretch: { [rifff.groupId]: true }
      }

      try {
        const project = await buildEngineProject(
          previewState,
          resolveStretchedForPlayback,
          pluginCatalog,
          undefined,
          { pumpRelease: false }
        )
        if (unmountedRef.current || generationRef.current !== generation) return
        if (!stillOwnEngine(token)) return
        const loadIsCurrent = await issueCrossPreviewLoad(
          () => window.rifffApi.engineLoadProject(project),
          () => {
            needsRestoreRef.current = true
          },
          () =>
            unmountedRef.current || generationRef.current !== generation || !stillOwnEngine(token)
        )
        if (!loadIsCurrent) return
        modeRef.current = mode
        if (changingMode) void window.rifffApi.engineSetPosition(0)
        dispatch({ type: 'PLAY' })
      } catch (err) {
        console.error('useCrossPreview: failed to load preview:', err)
        if (stillOwnEngine(token)) {
          if (needsRestoreRef.current) stop()
          else releaseEngine()
        }
      }
    },
    [
      channelPlugins,
      claimEngine,
      dispatch,
      masterChain,
      pluginCatalog,
      releaseEngine,
      sound,
      stillOwnEngine,
      stop
    ]
  )

  return { preview, stop }
}
