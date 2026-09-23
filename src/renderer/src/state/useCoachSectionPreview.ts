/**
 * "then preview (loops just that section)" (spec).
 *
 * The same throwaway-project trick DiscoverPanel.tsx's syncPreviewToEngine
 * uses, at a fraction of the size because nothing here rerolls, resolves or
 * changes underneath the send: build a one-rifff AppState from the section's
 * kept stems, hand it to the engine under a claim, play from bar 0.
 *
 * Why the loop is exactly the section: the only clip starts at bar 0, and
 * loopLengthBars(state) (selectors.ts) is the furthest placed end -- which,
 * with playedBars set to the section's length, IS the section's length. So
 * the native transport wraps at the end of the section without anything
 * here having to watch the position.
 *
 * Ownership follows the established rules (see @shared/engineOwnership):
 * claim synchronously before the first await, re-check stillOwn after every
 * await before applying anything, and release on stop or unmount so
 * StoreContext's coalesced sync puts the real project back.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildEngineProject } from '@shared/buildEngineProject'
import { sectionKeptStems, type CoachSectionDraft } from '@shared/coachSections'
import type { LockedClimax } from '@shared/coachClimax'
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { initialState, type AppState } from './store'
import { useAppSelector, useDispatch, useEngineOwnership, usePluginCatalog } from './StoreContext'

export interface CoachSectionPreview {
  /** A section preview is currently loaded in the engine. */
  previewing: boolean
  /** The project is being built/sent -- what makes sssketchy climb. */
  building: boolean
  previewSection: (climax: LockedClimax, draft: CoachSectionDraft) => Promise<void>
  stopPreview: () => void
}

export function useCoachSectionPreview(): CoachSectionPreview {
  const dispatch = useDispatch()
  const bpm = useAppSelector((s) => s.bpm)
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  const pluginCatalog = usePluginCatalog()
  const {
    claim: claimEngine,
    stillOwn: stillOwnEngine,
    release: releaseEngine
  } = useEngineOwnership()

  const [previewing, setPreviewing] = useState(false)
  const [building, setBuilding] = useState(false)
  // Set in the cleanup below, read after every await -- the component can
  // unmount (the step advances, the flow is dismissed) while a build is
  // still in flight, and a late send must not reach the engine.
  const unmountedRef = useRef(false)
  const previewingRef = useRef(false)

  const stopPreview = useCallback((): void => {
    if (!previewingRef.current) return
    previewingRef.current = false
    setPreviewing(false)
    dispatch({ type: 'PAUSE' })
    // Releasing is enough to hand the engine back: StoreContext's coalesced
    // sync goes dirty and re-checks every frame, so the real project loads
    // itself once nobody owns the engine.
    releaseEngine()
  }, [dispatch, releaseEngine])

  useEffect(() => {
    // Assigned in the setup body, not only in the ref initialiser: this app
    // runs under StrictMode, which mounts every component with an extra
    // setup -> cleanup -> setup cycle in development (same gotcha
    // useStemPreviewPlayback.ts documents).
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      if (previewingRef.current) {
        previewingRef.current = false
        dispatch({ type: 'PAUSE' })
        releaseEngine()
      }
    }
  }, [dispatch, releaseEngine])

  const previewSection = useCallback(
    async (climax: LockedClimax, draft: CoachSectionDraft): Promise<void> => {
      const kept = sectionKeptStems(climax, draft.droppedPaths)
      if (kept.length === 0) return

      // Claimed synchronously, before the first await, so there is no window
      // in which the coalesced real-project sync could observe a free
      // engine and overwrite this.
      const token = claimEngine('coach-section-preview')
      setBuilding(true)
      try {
        // maxMembers uncapped: this is a throwaway preview project with no
        // StemCID_1..8 schema to fit into, and a locked climax can carry
        // more than eight stems (same real bug DiscoverPanel's own preview
        // call documents). barLengthOverride is the climax's own length, so
        // shorter members tile rather than shortening the loop.
        const assembly = assembleDiscoverRifff(
          `${draft.name} preview`,
          kept.map((stem) => ({
            stem: {
              author: stem.author,
              name: stem.name,
              type: stem.type,
              path: stem.path,
              durationSec: stem.durationSec,
              barLength: stem.barLength
            },
            gain: stem.gain
          })),
          bpm,
          kept.length,
          climax.barLength
        )
        if (assembly === null) return

        const { rifff, vol } = assembly
        const previewState: AppState = {
          ...initialState,
          bpm,
          masterChain,
          channelPlugins,
          rifffs: { [rifff.groupId]: { ...rifff, startBar: 0 } },
          vol,
          stretch: { [rifff.groupId]: true },
          // What makes the engine's own loop exactly this section long.
          playedBars: { [rifff.groupId]: draft.bars }
        }

        const project = await buildEngineProject(
          previewState,
          resolveStretchedForPlayback,
          pluginCatalog
        )
        if (unmountedRef.current || !stillOwnEngine(token)) return

        await window.rifffApi.engineLoadProject(project)
        if (unmountedRef.current || !stillOwnEngine(token)) return

        previewingRef.current = true
        setPreviewing(true)
        await window.rifffApi.engineSetPosition(0)
        dispatch({ type: 'PLAY' })
      } catch (err) {
        console.error('useCoachSectionPreview: preview failed:', err)
        // Nothing reached the engine, so this claim must not dangle --
        // otherwise the real project's own sync stays gated off forever.
        if (!previewingRef.current) releaseEngine()
      } finally {
        if (!unmountedRef.current) setBuilding(false)
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

  return { previewing, building, previewSection, stopPreview }
}
