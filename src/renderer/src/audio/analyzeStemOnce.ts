// src/renderer/src/audio/analyzeStemOnce.ts
import { isCurrentStemFeatureVersion, type StemFeatures } from '@shared/stemFeatures'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { decodeStemFile } from './decodeStemFile'
import { adoptWaveformAnalysis, hasWaveformEntry, waveformFromBuffer } from './peakCache'
import { adoptStemFeaturesFromBuffer, peekStemFeaturesEntry } from './stemFeaturesCache'
import { adoptStemEmbeddingFromBuffer, hasStemEmbeddingEntry } from './stemEmbeddingCache'

export type StemAnalysisOutcome = 'done' | 'skipped' | 'failed'

export interface AnalyzeStemOnceResult {
  peaks: StemAnalysisOutcome
  features: StemAnalysisOutcome
  embedding: StemAnalysisOutcome
}

const ALL_SKIPPED: AnalyzeStemOnceResult = {
  peaks: 'skipped',
  features: 'skipped',
  embedding: 'skipped'
}

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
 * path, is persisted with the same set-* IPC call, and is installed as that
 * module's in-memory entry BEFORE the decode starts -- so an interactive
 * getPeaks/getStemFeatures/getOrExtractStemEmbedding for the same path,
 * mid-analysis, shares this work instead of decoding again.
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
  if (!wantPeaks && !wantFeatures && !wantEmbedding) return ALL_SKIPPED

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

  const [peaks, features, embedding] = await Promise.allSettled([
    peaksPromise,
    featuresPromise,
    embeddingPromise
  ])

  const logFailure = (what: string, reason: unknown): void => {
    console.error(`analyzeStemOnce: ${what} failed for stem`, path, reason)
  }
  if (peaks.status === 'rejected') logFailure('peaks', peaks.reason)
  if (features.status === 'rejected') logFailure('features', features.reason)

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
          : 'failed'
  }
}
