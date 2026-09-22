// src/renderer/src/audio/analysisWriteQueue.ts
import type { StemAnalysisWrite } from '@shared/stemAnalysisWrite'
import { countWork } from '../perf/workCounters'

/** Flush once this many stems have queued writes... */
export const FLUSH_STEM_COUNT = 10
/** ...or this long after the first queued write, whichever comes first. */
export const FLUSH_DELAY_MS = 1000

let pending = new Map<string, StemAnalysisWrite>()
let timer: ReturnType<typeof setTimeout> | null = null
let listenersInstalled = false

function installFlushListeners(): void {
  if (listenersInstalled || typeof document === 'undefined') return
  listenersInstalled = true
  // Don't leave writes sitting in memory when the window goes away or is
  // hidden -- the IPC message is sent immediately, so main still gets it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushStemAnalysisWrites()
  })
  window.addEventListener('pagehide', () => void flushStemAnalysisWrites())
  window.addEventListener('beforeunload', () => void flushStemAnalysisWrites())
}

/**
 * Background efficiency B7: the ambient scans' persistence
 * (analyzeStemOnce.ts's peaks/features/embedding/zero-shot writes) goes
 * through this queue instead of one IPC per output per stem. Fields for the
 * same path merge into one entry; the queue flushes as ONE
 * set-stem-analysis-results IPC (one main-side transaction) every
 * FLUSH_STEM_COUNT stems or FLUSH_DELAY_MS, and on hide/unload.
 *
 * Only the persisted copy is deferred: each module's in-memory cache is
 * primed at once, so readers in this session never wait on a flush.
 * Interactive callers keep their own immediate single-write IPCs.
 */
export function queueStemAnalysisWrite(
  path: string,
  fields: Omit<StemAnalysisWrite, 'path'>
): void {
  pending.set(path, { ...pending.get(path), ...fields, path })
  installFlushListeners()
  if (pending.size >= FLUSH_STEM_COUNT) {
    void flushStemAnalysisWrites()
    return
  }
  if (timer === null) {
    timer = setTimeout(() => {
      timer = null
      void flushStemAnalysisWrites()
    }, FLUSH_DELAY_MS)
  }
}

/** Sends everything queued now. Never rejects -- a failed write is logged,
 * the same best-effort contract as the fire-and-forget single writes. */
export async function flushStemAnalysisWrites(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (pending.size === 0) return
  const batch = [...pending.values()]
  pending = new Map()
  countWork('ipc:set-stem-analysis-results')
  countWork('analysis-write:stems', batch.length)
  try {
    await window.rifffApi.setStemAnalysisResults(batch)
  } catch (err) {
    console.error('flushStemAnalysisWrites: batched write failed:', err)
  }
}

/** Stems with writes waiting (tests / diagnostics). */
export function pendingStemAnalysisWriteCount(): number {
  return pending.size
}
