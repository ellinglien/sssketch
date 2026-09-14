import { useEffect, useRef, useState } from 'react'
import { soloStemsMute } from './store'
import { useAppSelector, useDispatch, useFlushEngineSyncNow, usePlaying } from './StoreContext'
import { markManualSeek } from './manualSeek'
import { sqrtGain } from '@shared/mixGain'

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
  const vol = useAppSelector((s) => s.vol)
  const playing = usePlaying()
  const flushEngineSyncNow = useFlushEngineSyncNow()

  // Snapshot of the REAL mute/vol state as it stood the moment this hook
  // first mounted (useState's lazy initializer runs exactly once) --
  // restored verbatim on unmount below so any SOLO_STEMS preview-auditioning
  // (mute) or preview-volume boost (vol, see startPreview below) done by a
  // caller never leaks into the real arrangement's mute/volume state once
  // its own UI (the cluster browser, the role-confirmation step, ...)
  // closes/advances.
  const [muteSnapshot] = useState(() => mute)
  // 2026-09-14: previewing a stem here is meant to answer "what does this
  // sound like," not "how loud is it mixed into the real rifff/arrangement"
  // -- a stem quietly mixed on import (see LibraryBrowser.tsx's own gain
  // import, which carries over Endlesss's real per-slot gain verbatim) would
  // otherwise preview as apparently silent even though playback is working
  // correctly. See startPreview's own soloedVol computation below.
  const [volSnapshot] = useState(() => vol)

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

  // Guards against a SECOND startPreview call superseding a first one that's
  // still mid-flight, rather than the reverse -- real bug reported
  // 2026-09-14 on a large (41-clip) cluster: flushEngineSyncNow's own round
  // trip (full buildEngineProject + rubberband resolve + engineLoadProject)
  // scales with project size and can take long enough for a second click
  // (a different thumbnail, or the same row's play button again) to fire
  // BEFORE the first call's await resolves. Nothing previously stopped both
  // calls from running concurrently and both eventually calling
  // engineSetPosition/dispatch(PLAY) -- whichever happened to resolve LAST
  // won, not whichever was clicked last, so a slow first click (e.g. "play
  // whole cluster" from its earliest bar) could resolve after a fast second
  // click (scrub to a specific point) and silently snap playback back to
  // the first click's target. Symptoms reported: scrubbing "stubbornly"
  // jumping back to a clip's own start, a new preview "sometimes doesn't
  // start right away," and it being unclear what's actually playing (all
  // three are this same race touching previewingKeys/pos/playing together).
  // Each call captures its own generation number before its first await and
  // bails out after if a newer call has since started, exactly like
  // cancelledRef above but for "superseded" rather than "unmounted."
  const callGenerationRef = useRef(0)

  // Playback started by a caller's own preview must never keep running
  // once that caller is gone -- whether closed explicitly (a close
  // button/Escape) or unmounted as a side effect of its own flow moving on
  // (the wizard advancing past AutoArrangeRoleStep to its build step).
  // PAUSE (not STOP) so it stops right where it is rather than rewinding
  // to bar 0, matching ClusterStemsBrowser.tsx's original handleClose.
  //
  // The `cancelledRef.current = false` in the setup body (not just the
  // useRef(false) initializer) is load-bearing, not redundant -- this app
  // runs under <StrictMode> (main.tsx), which in development mounts every
  // component with an extra synchronous setup -> cleanup -> setup cycle
  // (same class of gotcha as App.tsx's startupResolvedRef). Without this
  // line, that first fake "cleanup" flips cancelledRef.current to true and
  // NOTHING ever flipped it back -- the following fake "setup" re-run
  // re-registers this same cleanup closure but never touches the ref, so
  // every real startPreview() call for the rest of this component's life
  // hit `if (cancelledRef.current) return` right after its await and
  // silently no-opped: SOLO_STEMS/SELECT/SET_POS had already dispatched
  // (so a row still visibly highlighted as "previewing") and the engine
  // had already received the correctly-soloed project, but the actual
  // PLAY/seek call after the guard never ran -- audible as "the preview
  // button doesn't actually play anything." Real (non-StrictMode) unmounts
  // are single-shot, so this reset is a harmless no-op for them; it only
  // matters for undoing StrictMode's synthetic extra cycle.
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      dispatch({ type: 'RESTORE_MUTE', mute: muteSnapshot })
      dispatch({ type: 'RESTORE_VOL', vol: volSnapshot })
      dispatch({ type: 'PAUSE' })
    }
  }, [dispatch, muteSnapshot, volSnapshot])

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
    // Claimed BEFORE the first await -- see callGenerationRef's own doc
    // comment above. Any call that started earlier and is still awaiting
    // flushEngineSyncNow when THIS call resolves is now stale and must not
    // apply its own (older) target.
    const myGeneration = ++callGenerationRef.current
    setPreviewingKeys(keys)
    const soloedMute = soloStemsMute(rifffs, mute, [...keys])
    // Boosts every previewed stem to the same "as if it were the only/an
    // equal source" level (sqrtGain, @shared/mixGain.ts -- the exact same
    // headroom math ADD_TO_SHELF uses to seed a fresh rifff's stems and
    // BeatPicker.tsx uses for its own preview) rather than reusing whatever
    // the real arrangement currently has it mixed at -- a single previewed
    // stem plays at full volume; several previewed together (play all
    // included) each get scaled down just enough that summing them won't
    // clip, without any one of them staying inaudibly quiet because that's
    // how it happens to be mixed right now. Only the PREVIEWED keys are
    // touched; every other entry carries over unchanged (irrelevant anyway,
    // since soloedMute already silences everything else).
    const previewGain = sqrtGain(keys.size)
    const soloedVol = { ...vol }
    for (const key of keys) soloedVol[key] = previewGain
    dispatch({ type: 'SOLO_STEMS', stemKeys: [...keys] })
    dispatch({ type: 'RESTORE_VOL', vol: soloedVol })
    if (groupIdToSelect) dispatch({ type: 'SELECT', groupId: groupIdToSelect })
    dispatch({ type: 'SET_POS', pos: targetBar })
    await flushEngineSyncNow({ mute: soloedMute, vol: soloedVol })
    if (cancelledRef.current) return
    if (callGenerationRef.current !== myGeneration) return
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(targetBar)
    } else {
      dispatch({ type: 'PLAY' })
    }
  }

  return { previewingKeys, startPreview }
}
