// src/renderer/src/audio/analyzeStemOnce.ts
import { isCurrentStemFeatureVersion, type StemFeatures } from '@shared/stemFeatures'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { countWork } from '../perf/workCounters'
import { decodeStemFile } from './decodeStemFile'
import { isStemNotDownloadedError } from '@shared/stemNotDownloaded'
import { adoptWaveformAnalysis, hasWaveformEntry, waveformFromBuffer } from './peakCache'
import { adoptStemFeaturesFromBuffer, peekStemFeaturesEntry } from './stemFeaturesCache'
import { channelsAfterFirst, measureStemLevelOffThread } from './stemAnalysisClient'
import { queueStemAnalysisWrite } from './analysisWriteQueue'
import { stemLevelFields } from '@shared/stemAnalysis'
import {
  adoptStemEmbeddingFromBuffer,
  adoptZeroShotFromBuffer,
  hasStemEmbeddingEntry,
  hasZeroShotEntry
} from './stemEmbeddingCache'

export type StemAnalysisOutcome = 'done' | 'skipped' | 'failed'

export interface AnalyzeStemOnceResult {
  peaks: StemAnalysisOutcome
  features: StemAnalysisOutcome
  embedding: StemAnalysisOutcome
  zeroShot: StemAnalysisOutcome
  /** Present only when `needs.level` asked for the level pass. */
  level?: StemAnalysisOutcome
}

const ALL_SKIPPED: AnalyzeStemOnceResult = {
  peaks: 'skipped',
  features: 'skipped',
  embedding: 'skipped',
  zeroShot: 'skipped'
}

/** Level passes in flight, by path: a second scan asking for the same stem shares it. */
const levelInFlight = new Map<string, Promise<void>>()

/**
 * "Analyse once" (docs/superpowers/specs/2026-09-22-background-efficiency-
 * design.md, A2): ONE read + ONE decode of a stem, then only the outputs
 * `needs` asks for -- waveform peaks/brightness (peakCache.ts), features
 * (stemFeaturesCache.ts, worker analysis, also primes pitchCache), and the
 * YAMNet embedding (stemEmbeddingCache.ts, resampled from the SAME decoded
 * buffer). Used by the ambient scans; before this, each of those modules
 * read and decoded the file separately.
 *
 * Every value comes from the same function each module uses on its own
 * path, is persisted to the same rows (batched per several stems through
 * analysisWriteQueue.ts -- background efficiency B7 -- instead of one IPC
 * per output), and is installed as that
 * module's in-memory entry BEFORE the decode starts -- so an interactive
 * getPeaks/getStemFeatures/getOrExtractStemEmbedding for the same path,
 * mid-analysis, shares this work instead of decoding again.
 *
 * `needs.zeroShot` (background efficiency B5): the YAMNet zero-shot step
 * for a stem whose embedding is already cached but predates that step --
 * inference on the same decoded buffer (stemEmbeddingCache.ts's
 * adoptZeroShotFromBuffer). A fresh embedding runs it as part of its own
 * extraction.
 *
 * `needs.level` (spec 2026-10-05-radio-intensity-arc-design 7.2-7.3): the
 * level pass alone (@shared/stemLevel, every channel, in the worker) for a
 * stem whose feature row is current but unmeasured -- on the SAME decode,
 * queued as a `level` write that main merges into the row in place. A fresh
 * feature extraction measures the level itself, so the two never both run.
 * `level` is in the result only when `needs.level` asked for it.
 *
 * An output is skipped when its module already has an in-memory entry that
 * serves it (in flight, or settled -- for features, settled at the current
 * version). Outputs fail independently: each module evicts only its own
 * failed entry (a later call retries it) and the others still persist.
 * Never rejects.
 */
export async function analyzeStemOnce(
  path: string,
  needs: StemAnalysisNeeds
): Promise<AnalyzeStemOnceResult> {
  // Features: an existing entry might be an old-version row (the reason
  // `needs.features` is true) -- replace it only once it's known stale, and
  // only if it's still the entry afterwards (same once-only rule as
  // stemFeaturesCache.ts's refreshStale). Only awaits when an entry exists.
  let wantFeatures = false
  let featuresExpected: Promise<StemFeatures> | undefined
  if (needs.features) {
    const existing = peekStemFeaturesEntry(path)
    if (!existing) {
      wantFeatures = true
    } else {
      let stale: boolean
      try {
        stale = !isCurrentStemFeatureVersion(await existing)
      } catch {
        stale = true
      }
      const now = peekStemFeaturesEntry(path)
      if (now === undefined || (now === existing && stale)) {
        wantFeatures = true
        featuresExpected = now
      }
    }
  }
  // Everything below runs synchronously up to the installs, so no other
  // caller can slip in between these checks and the adopt* calls.
  const wantPeaks = needs.peaks && !hasWaveformEntry(path)
  const wantEmbedding = needs.embedding && !hasStemEmbeddingEntry(path)
  const wantZeroShot = needs.zeroShot && !wantEmbedding && !hasZeroShotEntry(path)
  // the level backfill (spec 2026-10-05-radio-intensity-arc-design 7.3): a current row without
  // the level pass. A fresh feature extraction measures it itself.
  const wantLevel = needs.level === true && !wantFeatures && !levelInFlight.has(path)
  if (!wantPeaks && !wantFeatures && !wantEmbedding && !wantZeroShot && !wantLevel) {
    return needs.level === true ? { ...ALL_SKIPPED, level: 'skipped' } : ALL_SKIPPED
  }

  const decoded = decodeStemFile(path)
  // Rejections are handled by each consumer below; this only stops an
  // unconsumed branch from reporting an unhandled rejection.
  decoded.catch(() => {})

  // Peaks/brightness come from the same buffer whenever features need the
  // brightness too (cheap bucket scans -- same values the persisted row
  // holds). When the waveform entry is missing it's primed either way, but
  // only persisted if the persisted row is actually missing.
  const waveform = wantPeaks || wantFeatures ? decoded.then(waveformFromBuffer) : null
  waveform?.catch(() => {})
  const peaksPromise =
    waveform && !hasWaveformEntry(path)
      ? adoptWaveformAnalysis(path, waveform, { persist: needs.peaks })
      : null

  const featuresPromise =
    wantFeatures && waveform
      ? adoptStemFeaturesFromBuffer(
          path,
          featuresExpected,
          decoded,
          waveform.then((w) => w.brightness)
        )
      : null

  const embeddingPromise = wantEmbedding ? adoptStemEmbeddingFromBuffer(path, decoded) : null
  const zeroShotPromise = wantZeroShot ? adoptZeroShotFromBuffer(path, decoded) : null
  // the SAME decode, every channel, merged into the row by main (never a second decode)
  const levelPromise = wantLevel
    ? decoded
        .then((buffer) =>
          measureStemLevelOffThread(
            [buffer.getChannelData(0), ...channelsAfterFirst(buffer)],
            buffer.sampleRate
          )
        )
        .then((level) => queueStemAnalysisWrite(path, { level: stemLevelFields(level) }))
    : null
  if (levelPromise !== null) {
    levelInFlight.set(path, levelPromise)
    void levelPromise.then(
      () => levelInFlight.delete(path),
      () => levelInFlight.delete(path)
    )
  }

  const [peaks, features, embedding, zeroShot, level] = await Promise.allSettled([
    peaksPromise,
    featuresPromise,
    embeddingPromise,
    zeroShotPromise,
    levelPromise
  ])

  // One short line per stem, never one stack trace per output: a decode
  // failure fails every output at once, and used to be logged three times
  // over (peaks, features, embedding) -- for each of 2,361 0-byte
  // placeholders in a real archive (2026-10-01). The decode has settled by
  // now (every consumer above awaited it).
  const [decode] = await Promise.allSettled([decoded])
  if (decode.status === 'rejected') {
    if (isStemNotDownloadedError(decode.reason)) {
      console.warn(`analyzeStemOnce: skipped ${path}: not downloaded yet (0 bytes)`)
    } else {
      console.error(`analyzeStemOnce: could not decode ${path}: ${describe(decode.reason)}`)
    }
  } else {
    if (peaks.status === 'rejected') {
      console.error(`analyzeStemOnce: peaks failed for ${path}: ${describe(peaks.reason)}`)
    }
    if (features.status === 'rejected') {
      console.error(`analyzeStemOnce: features failed for ${path}: ${describe(features.reason)}`)
    }
    if (level.status === 'rejected') {
      console.error(`analyzeStemOnce: level failed for ${path}: ${describe(level.reason)}`)
    }
  }

  return {
    peaks:
      !needs.peaks || peaksPromise === null
        ? 'skipped'
        : peaks.status === 'fulfilled'
          ? 'done'
          : 'failed',
    features:
      featuresPromise === null ? 'skipped' : features.status === 'fulfilled' ? 'done' : 'failed',
    // adoptStemEmbeddingFromBuffer never rejects -- null means no embedding.
    embedding:
      embeddingPromise === null
        ? 'skipped'
        : embedding.status === 'fulfilled' && embedding.value !== null
          ? 'done'
          : 'failed',
    // adoptZeroShotFromBuffer never rejects either -- false means it failed.
    zeroShot:
      zeroShotPromise === null
        ? 'skipped'
        : zeroShot.status === 'fulfilled' && zeroShot.value
          ? 'done'
          : 'failed',
    ...(needs.level === true && {
      level: levelPromise === null ? 'skipped' : level.status === 'fulfilled' ? 'done' : 'failed'
    })
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
}

/** Main's batched "what's still missing" answer for these paths (index-
 * aligned) -- get-stem-analysis-needs (src/main/stemAnalysisNeeds.ts). One
 * IPC call for the whole list; main chunks and yields. */
export function fetchStemAnalysisNeeds(paths: string[]): Promise<StemAnalysisNeeds[]> {
  countWork('ipc:get-stem-analysis-needs')
  return window.rifffApi.getStemAnalysisNeeds(paths)
}
