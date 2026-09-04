import { useEffect, useRef, useState } from 'react'
import { soloStemsMute } from './store'
import { useAppSelector, useDispatch, useFlushEngineSyncNow, usePlaying } from './StoreContext'
import { markManualSeek } from './manualSeek'

/** Solo-and-seek stem preview playback -- extracted out of
 * ClusterStemsBrowser.tsx (Tidy Up), which AutoArrangeRoleStep.tsx's own
 * per-stem preview was built to mirror as closely as possible. Originally
 * duplicated whole between the two (previewingKeys, muteSnapshot, the
 * unmount-cleanup restore, and startPreview's own async ordering), which
 * is a real risk specifically BECAUSE that ordering embeds a fix for a
 * previously-shipped bug (see startPreview's own doc comment below) -- a
 * future fix applied to one copy and not the other would silently
 * regress the other caller. Follows usePlacedFlatStems.ts's own precedent
 * of a small `state/`-local hook wrapping StoreContext selectors/dispatch
 * rather than threading this through props.
 *
 * Deliberately does NOT own targetBar computation or any UI (waveform
 * thumbnails vs. plain play buttons, click-fraction seeking vs. a fixed
 * clip-start seek) -- those genuinely differ per caller and stay there. */
export function useStemPreviewPlayback(): {
  /** Which exact stem keys are the current preview target -- the single
   * source of truth for "what's actually audible right now," for a
   * caller's own row/thumbnail to key its play-state UI off of. */
  previewingKeys: Set<string>
  /** Solos exactly `keys`, jumps the transport to `targetBar` (seeking the
   * live engine if already playing, or starting playback fresh at that bar
   * otherwise), and marks `keys` as the current preview target. */
  startPreview: (
    keys: Set<string>,
    groupIdToSelect: string | undefined,
    targetBar: number
  ) => Promise<void>
} {
  const dispatch = useDispatch()
  const rifffs = useAppSelector((s) => s.rifffs)
  const mute = useAppSelector((s) => s.mute)
  const playing = usePlaying()
  const flushEngineSyncNow = useFlushEngineSyncNow()

  // Snapshot of the REAL mute state as it stood the moment this hook first
  // mounted (useState's lazy initializer runs exactly once) -- restored
  // verbatim on unmount below so any SOLO_STEMS preview-auditioning done
  // by a caller never leaks into the real arrangement's mute state once
  // its own UI (the cluster browser, the role-confirmation step, ...)
  // closes/advances.
  const [muteSnapshot] = useState(() => mute)

  const [previewingKeys, setPreviewingKeys] = useState<Set<string>>(() => new Set())

  // Guards startPreview's post-await continuation against a caller that
  // unmounted WHILE flushEngineSyncNow was still in flight. flushEngineSyncNow
  // bypasses the coalesced sync and pushes the soloed mute straight to the
  // engine; if the component unmounts mid-await, the unmount-cleanup effect
  // below fires first (RESTORE_MUTE + PAUSE), but the pending
  // flushEngineSyncNow call was already promised to resolve and, without
  // this guard, would go on to push the stale soloed mute back to the
  // engine and then seek/PLAY using a `playing` value closed over from
  // BEFORE the await -- audio briefly resuming with the wrong mute state
  // after the user already left. Always theoretically possible in
  // ClusterStemsBrowser.tsx, but AutoArrangeRoleStep.tsx's wizard makes it
  // a realistic timing window: press preview, immediately press continue,
  // which synchronously swaps the wizard's own step state.
  const cancelledRef = useRef(false)

  // Playback started by a caller's own preview must never keep running
  // once that caller is gone -- whether closed explicitly (a close
  // button/Escape) or unmounted as a side effect of its own flow moving on
  // (the wizard advancing past AutoArrangeRoleStep to its build step).
  // PAUSE (not STOP) so it stops right where it is rather than rewinding
  // to bar 0, matching ClusterStemsBrowser.tsx's original handleClose.
  useEffect(() => {
    return () => {
      cancelledRef.current = true
      dispatch({ type: 'RESTORE_MUTE', mute: muteSnapshot })
      dispatch({ type: 'PAUSE' })
    }
  }, [dispatch, muteSnapshot])

  // Centralizing the seek here -- rather than resuming from wherever the
  // transport already happened to be -- is what makes "what's playing"
  // deterministic: press a button, hear THAT thing, from its own start,
  // every time.
  //
  // Awaits flushEngineSyncNow BEFORE seeking/playing, passing the solo's
  // own mute map as an override rather than dispatching SOLO_STEMS and
  // hoping stateRef catches up in time -- without this, a clip left muted
  // in the arranger (a whole channel muted, or just that one clip) stayed
  // muted here too: the play/seek IPC call was reaching the engine before
  // the coalesced rAF sync elsewhere had a chance to send the corrected
  // mute state, so the engine was still running the arranger's own mute
  // state at the moment playback started. Reported 2026-08-22 as "I
  // cannot hear the audio [[[in Tidy Up]]]... I think that channel is
  // muted on the arrangement" -- mute set anywhere in the arranger must
  // never bleed into a preview started from here.
  async function startPreview(
    keys: Set<string>,
    groupIdToSelect: string | undefined,
    targetBar: number
  ): Promise<void> {
    setPreviewingKeys(keys)
    const soloedMute = soloStemsMute(rifffs, mute, [...keys])
    dispatch({ type: 'SOLO_STEMS', stemKeys: [...keys] })
    if (groupIdToSelect) dispatch({ type: 'SELECT', groupId: groupIdToSelect })
    dispatch({ type: 'SET_POS', pos: targetBar })
    await flushEngineSyncNow({ mute: soloedMute })
    if (cancelledRef.current) return
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(targetBar)
    } else {
      dispatch({ type: 'PLAY' })
    }
  }

  return { previewingKeys, startPreview }
}
