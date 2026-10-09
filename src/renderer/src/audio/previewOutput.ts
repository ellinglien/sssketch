// Where every Web Audio preview plays out: one shared gain per AudioContext, set by the import
// view's "preview level" dial (@shared/previewLevel), in front of the speakers. Previews connect
// here instead of straight to ctx.destination, so the dial turns down import riffs, shelf tiles,
// loop folders, the project browser and the re-one picker together. The arrangement plays through
// the engine and is never touched.
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_PREVIEW_LEVEL,
  normalizePreviewLevel,
  previewLevelGain
} from '@shared/previewLevel'

let level = DEFAULT_PREVIEW_LEVEL
const outputs = new Map<BaseAudioContext, GainNode>()
const listeners = new Set<() => void>()
let loadRequested = false

/** Short, so a dial turn follows the hand without zipper noise. */
const LEVEL_SMOOTHING_SEC = 0.015

/** The node a preview connects to in place of ctx.destination. */
export function previewOutput(ctx: BaseAudioContext): AudioNode {
  let node = outputs.get(ctx)
  if (!node) {
    node = ctx.createGain()
    node.gain.value = previewLevelGain(level)
    node.connect(ctx.destination)
    outputs.set(ctx, node)
  }
  return node
}

/** Moves the level now, live: the dial's every step. Not saved; see commitPreviewLevel. */
export function setPreviewLevel(next: number): void {
  const clean = normalizePreviewLevel(next)
  if (clean === level) return
  level = clean
  for (const [ctx, node] of outputs) {
    node.gain.setTargetAtTime(previewLevelGain(level), ctx.currentTime, LEVEL_SMOOTHING_SEC)
  }
  for (const listener of listeners) listener()
}

/** The end of a dial gesture: the level, remembered for next launch. */
export function commitPreviewLevel(next: number): void {
  setPreviewLevel(next)
  void window.rifffApi.setPreviewLevel(level).catch((err: unknown) => {
    console.error('previewOutput: failed to save the preview level:', err)
  })
}

/** Reads the saved level once, at startup, so the first preview already plays at it. */
export function loadSavedPreviewLevel(): void {
  if (loadRequested) return
  loadRequested = true
  window.rifffApi
    .getPreviewLevel()
    .then(setPreviewLevel)
    .catch((err: unknown) => {
      console.error('previewOutput: failed to read the preview level:', err)
    })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePreviewLevel(): number {
  return useSyncExternalStore(subscribe, () => level)
}
