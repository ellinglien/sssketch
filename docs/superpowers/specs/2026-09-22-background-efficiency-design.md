# Background efficiency: do each piece of work once

Date: 2026-09-22
Status: approved in chat ("yes pls"); phase A to build first

## Goal

Cut redundant background work (decodes, per-stem IPC, repeated SQL/JSON) without lowering any
analysis quality. Timely: the Phase 3 feature-version bump is about to trigger a full-library
rescan (~50k stems), and every redundancy below multiplies across it.

## Phase A (build now)

### A1. Measure first — dev-only work counters
- A tiny counter module in each process (renderer + main): `countWork(kind)` for
  `decode`, `ipc:<channel>` (renderer→main invokes made by the analysis/scan paths),
  `sql:<label>` (main queries on the hot scan/roll paths), `analysis` (worker jobs).
- In dev (`!app.isPackaged` / `import.meta.env.DEV`) each process logs a one-line summary every
  60 s of counts since the last line (e.g. `[work] decode 42 · ipc:get-stem-feature-cache 120 ·
  analysis 42`). Zero cost in packaged builds (no-ops).
- Used to prove A2/A3 before/after; stays in for future work.

### A2. One decode per stem ("analyse once")
Today the ambient scans decode the same file separately for: waveform peaks + zero-crossing
brightness (peakCache.ts), features (stemFeaturesCache.ts → worker), and the YAMNet embedding
(stemEmbeddingCache.ts: decode + resample to 16 kHz). New orchestrator
`analyzeStemOnce(path, needs)` (renderer, src/renderer/src/audio/):
- decodes ONCE (shared AudioContext), then produces only what `needs` asks for:
  peaks/brightness, features (worker; also primes pitchCache), embedding (resample the SAME
  decoded buffer to 16 kHz mono and hand to the YAMNet worker).
- writes each result to its existing persisted cache (same IPC set-* calls, same keys) and
  primes each module's in-memory cache, so every existing reader (Waveform, getStemFeatures,
  getOrExtractStemEmbedding, pitch) finds it without decoding.
- Output identical to today's per-module paths (same functions produce each value; tests
  compare).
- The ambient scans (BackgroundFeatureScan, DiscoverLibraryScan) call it instead of the
  separate getters. Interactive callers keep working unchanged.

### A3. Main tells the scan what's missing
New IPC `get-stem-analysis-needs(targets)` (or a variant of the existing scan-targets call)
answering, per stem, `{ features: missing|stale, peaks: missing, embedding: missing }` using
batched SQL on ownDb (StemFeatureCache incl. featureVersion, StemPeaksCache,
StemEmbeddingCache) — chunked IN-lists / anti-joins, yielding, never one query per stem.
DiscoverLibraryScan fetches needs in batches ahead of processing and skips stems needing
nothing — no per-stem "do you have it?" round trips. Once a library is fully analysed, a
session's scan does ~no work.

## Phase B (later, separate specs)
- B1 in-memory trait value table reused by rolls (from the quantile build's parse).
- B2 per-kind stem lists precomputed from the instrument-row index.
- B3 change-detection (row count / max rowid) instead of TTL for riff/instrument caches.
- B4 overnight classifier idles when done; own pending cursor instead of ORDER BY RANDOM.
- B5 merge YAMNet zero-shot retroactive pass into the classify pipeline.
- B6 incremental scan-target list; B7 batched cache writes.

## Quality guardrails
- Every value is produced by the same functions as today — only duplicate decodes/lookups
  are removed. Tests assert equality with the old per-module outputs on synthetic audio.
- Scans keep the backgroundScanGate (pause while typing / modal open) and throttling.
