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
  usePlaying,
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

/** Runs a preview swap/restore only after the native halt fade has reached
 * actual silence. Project snapshots otherwise change underneath audible
 * samples, which produces a click even though Transport itself fades Stop. */
export async function continueCrossPreviewAfterSilence(
  halt: () => Promise<void>,
  continuation: () => Promise<void> | void,
  isCancelled: () => boolean
): Promise<boolean> {
  await halt()
  if (isCancelled()) return false
  await continuation()
  return !isCancelled()
}

/** Keeps a native halt alive across preview generations. A newer preview may
 * supersede the request that started the fade, but it must still wait for that
 * fade and explicitly resume native playback after loading its own project. */
export class PreviewHaltBarrier {
  private pending: Promise<void> | null = null
  private resumeRequired = false

  reachSilence(halt: () => Promise<void>, resumeAfter = true): Promise<void> {
    if (resumeAfter) this.resumeRequired = true
    if (this.pending) return this.pending
    const pending = halt()
    this.pending = pending
    void pending.then(
      () => {
        if (this.pending === pending) this.pending = null
      },
      () => {
        if (this.pending === pending) this.pending = null
      }
    )
    return pending
  }

  pendingSilence(): Promise<void> | null {
    return this.pending
  }

  consumeResume(): boolean {
    const required = this.resumeRequired
    this.resumeRequired = false
    return required
  }

  consumeResumeIf(requestIsCurrent: boolean): boolean {
    return requestIsCurrent ? this.consumeResume() : false
  }

  cancelResume(): void {
    this.resumeRequired = false
  }
}

/** A narrow throwaway-project controller for Cross. One ownership token
 * covers source audition and the child mix, so switching modes can never
 * leave an older source playing underneath a newer one. */
/** EEEDIT ('shape-preview') waits for the engine to publish each preview (its
 * renders are temporary files) and swaps a playing preview under the swap dip, so
 * a live render replacement doesn't click. Cross keeps the plain load. */
export function useCrossPreview(owner: 'cross-preview' | 'shape-preview' = 'cross-preview'): {
  preview: (
    mode: CrossPreviewMode,
    members: CrossPreviewMember[],
    targetBpm: number,
    loopBars: number,
    fromPos?: number,
    smoothSwap?: boolean
  ) => Promise<boolean>
  stop: () => Promise<void>
  owns: () => boolean
} {
  const dispatch = useDispatch()
  const masterChain = useAppSelector((state) => state.masterChain)
  const channelPlugins = useAppSelector((state) => state.channelPlugins)
  const sound = useAppSelector((state) => state.sound)
  const pluginCatalog = usePluginCatalog()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const playing = usePlaying()
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
  const haltBarrierRef = useRef(new PreviewHaltBarrier())

  const stop = useCallback((): Promise<void> => {
    const generation = ++generationRef.current
    const token = tokenRef.current
    tokenRef.current = null
    modeRef.current = null
    const needsRestore = needsRestoreRef.current
    needsRestoreRef.current = false
    haltBarrierRef.current.cancelResume()
    if (token === null || !stillOwnEngine(token)) return Promise.resolve()
    const released = releaseEngine()
    if (!needsRestore) return Promise.resolve()
    dispatch({ type: 'PAUSE' })
    return continueCrossPreviewAfterSilence(
      () => haltBarrierRef.current.reachSilence(() => window.rifffApi.engineStop(), false),
      () => flushEngineSyncNow(undefined, () => !stillOwnEngine(released)),
      () => generationRef.current !== generation || !stillOwnEngine(released)
    )
      .then(() => undefined)
      .catch((err) => {
        // A fresh Play deliberately cancels an in-flight halt. Its new owner
        // also bumps one of the guards above, so that expected case needs no
        // stale restore; log only genuinely current failures.
        if (generationRef.current === generation && stillOwnEngine(released))
          console.error('useCrossPreview: failed to reach silence before restore:', err)
      })
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
      loopBars: number,
      fromPos = 0,
      smoothSwap = false
    ): Promise<boolean> => {
      if (members.length === 0) {
        await stop()
        return false
      }
      const assembly = assembleDiscoverRifff(
        'cross preview',
        members,
        targetBpm,
        members.length,
        loopBars
      )
      if (!assembly) return false

      const changingMode = !needsRestoreRef.current || modeRef.current !== mode
      const shouldSmoothSwap = smoothSwap && !changingMode
      const generation = ++generationRef.current
      const token = claimEngine(owner)
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
        if (unmountedRef.current || generationRef.current !== generation) return false
        if (!stillOwnEngine(token)) return false
        if (shouldSmoothSwap) {
          // Do not tie this halt to this request's generation: a newer
          // preview that overtakes the fade still has to wait for silence.
          const halt = haltBarrierRef.current.reachSilence(() => window.rifffApi.engineStop())
          const reachedSilence = await continueCrossPreviewAfterSilence(
            () => halt,
            () => undefined,
            () =>
              unmountedRef.current || generationRef.current !== generation || !stillOwnEngine(token)
          )
          if (!reachedSilence) return false
        } else {
          // A smooth handoff from an older generation may already have
          // stopped the native transport. Waiting here prevents loading a
          // newer preview underneath that still-running fade.
          const pendingHalt = haltBarrierRef.current.pendingSilence()
          if (pendingHalt) {
            await pendingHalt
            if (
              unmountedRef.current ||
              generationRef.current !== generation ||
              !stillOwnEngine(token)
            )
              return false
          }
        }
        const loadIsCurrent = await issueCrossPreviewLoad(
          () =>
            owner === 'shape-preview'
              ? window.rifffApi.engineLoadProjectAcked(project, { fadeSwap: true })
              : window.rifffApi.engineLoadProject(project),
          () => {
            needsRestoreRef.current = true
          },
          () =>
            unmountedRef.current || generationRef.current !== generation || !stillOwnEngine(token)
        )
        if (!loadIsCurrent) return false
        modeRef.current = mode
        if (haltBarrierRef.current.consumeResume()) {
          // Redux intentionally remains in its playing state throughout a
          // solo handoff. This may also be a newer request that superseded
          // the request which initiated the halt, so native playback must be
          // resumed directly even when Redux already says it is playing.
          dispatch({ type: 'PLAY', nativeStart: { fromPos, fadeIn: true } })
          return true
        }
        dispatch(
          !playing || changingMode
            ? { type: 'PLAY', nativeStart: { fromPos, fadeIn: true } }
            : { type: 'PLAY' }
        )
        return true
      } catch (err) {
        console.error('useCrossPreview: failed to load preview:', err)
        if (stillOwnEngine(token)) {
          if (needsRestoreRef.current) stop()
          else releaseEngine()
        }
        return false
      }
    },
    [
      channelPlugins,
      claimEngine,
      dispatch,
      masterChain,
      owner,
      playing,
      pluginCatalog,
      releaseEngine,
      sound,
      stillOwnEngine,
      stop
    ]
  )

  const owns = useCallback(() => {
    const token = tokenRef.current
    return token !== null && stillOwnEngine(token)
  }, [stillOwnEngine])

  return { preview, stop, owns }
}
