# Library-Wide Discover — ML Embeddings (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real learned-embedding classifier (YAMNet, run via `onnxruntime-web` in a Web Worker) that augments Plan B1's hand-crafted-feature/centroid classifier — an embedding-based suggestion is preferred whenever a stem's embedding has already been extracted, with Plan B1's classifier as the fallback for a stem that hasn't been extracted yet.

**Architecture:** A new `StemEmbeddingCache` table (mirroring Plan A's `StemFeatureCache` exactly) persists each stem's 1024-dim YAMNet embedding, keyed by `StemCID`. Extraction (decode → resample to 16kHz mono → run through YAMNet in a dedicated Worker → mean-pool the per-frame embeddings) happens ambiently, extending `BackgroundFeatureScan.tsx` — never synchronously blocking a screen's own "analyzing stems…" step, since neural-net inference is meaningfully slower than the existing hand-crafted feature extraction it sits alongside. A new `src/shared/embeddingMatch.ts` does cosine-similarity nearest-neighbor search over every other confirmed stem's embedding on the same axis (not a single running centroid — a rich learned embedding space benefits from real k-NN, unlike the low-dimensional hand-crafted feature space Plan B1's centroids work over), applying the same "never force a guess" discipline Plan B1's `suggestCategory` was just fixed to enforce (a real bug this session, 2026-09-14 — see Task 12's own doc comment for why this plan bakes the same guard in from the start).

**Tech Stack:** `onnxruntime-web` 1.29.0 (WASM execution provider), a community `tf2onnx` conversion of Google's official YAMNet (Apache-2.0, `andrelgomes/yamnet-onnx` on Hugging Face — there is no single official Google-published ONNX export; the design spec's own "official TensorFlow.js export" framing doesn't quite hold for ONNX specifically, see Task 1), a dedicated Web Worker, Vite's `public/` static-asset convention for the WASM runtime files.

---

## Important context every task should understand

**Why this plan exists now, not later.** The design spec's own §7 text frames Phase 2 as something Elling chose to build in the same implementation as Phase 1 rather than gating it behind "does Phase 1 actually need it" — but Phase 1 (Plan B1) ended up shipping first as its own plan, and its real-world testing this same session (2026-09-14) surfaced exactly the accuracy problem Phase 2 exists to fix: the hand-crafted-feature/centroid classifier is cold-starting slowly (a real bug where a single trained category force-matched every query, now fixed) and several stems' base heuristics are weak on their own (`audioIn`→`vocal`, now flagged `uncertain` instead of asserted). Elling's own words moving into this plan: YAMNet "will help this along a lot." This plan's own scope is unchanged from what §7 already specified — a better signal source, not a redesign of Phase 1's architecture, which stays exactly as-is and keeps serving as the fallback layer.

**The real model file.** The design spec says "official TensorFlow.js export" — that's true of TF-Hub's own YAMNet distribution, but there is no single official Google-published *ONNX* export. Verified directly (2026-09-14, via Hugging Face): `andrelgomes/yamnet-onnx` is a `tf2onnx` conversion of Google's official YAMNet (AudioSet, 521 classes), Apache-2.0 licensed, MobileNetV1 backbone, ~3.7M params, 16kHz native input. Its `yamnet.onnx` file (direct download: `https://huggingface.co/andrelgomes/yamnet-onnx/resolve/main/yamnet.onnx`) has:
- Input `waveform` (f32), shape `[-1]` — a flat, dynamic-length, mono, 16kHz raw waveform. The mel-spectrogram frontend is INSIDE the model — no separate feature extraction needed client-side, just resampled PCM.
- Output `output_0` (f32), shape `[-1, 521]` — per-frame AudioSet class scores. Not used by this plan.
- Output `output_1` (f32), shape `[-1, 1024]` — per-frame embeddings. **This is what this plan uses.** One row per ~0.96s audio frame; mean-pooled across frames (axis 0) into a single 1024-dim vector per stem.
- Output `output_2` (f32), shape `[-1, 64]` — per-frame log-mel spectrogram. Not used by this plan.

**Why embeddings use k-NN, not centroids.** Plan B1's `categoryCentroids.ts` keeps one running mean vector per category because its 19-dim hand-crafted feature space is low enough dimensionality that a single centroid is a reasonable summary. A 1024-dim learned embedding space is richer — collapsing it to one mean per category would throw away most of what makes it useful. This plan instead keeps every individual confirmed stem's embedding and does real nearest-neighbor search at suggestion time.

**Applying this session's own just-fixed lesson from the start.** Plan B1 shipped a real bug this session: `suggestCategory` returned a category unconditionally when only ONE category had enough trained samples, since there was nothing to compare it against (fixed by requiring at least 2 trained categories before suggesting anything — see `src/shared/categoryCentroids.ts`'s own `MIN_TRAINED_CATEGORIES_FOR_SUGGESTION`). The exact same degenerate case applies to k-NN over embeddings: if only one category has any confirmed embeddings at all, the nearest neighbor to any query is trivially that one category, regardless of actual similarity. Task 12's own `suggestCategoryFromEmbedding` bakes in the identical guard (at least 2 distinct categories present, each with enough samples) from its very first version, rather than needing the same bug fixed twice.

**Why extraction never blocks a screen's own scan.** Plan A's `useStemFeatureScan`/`getStemFeatures` pair deliberately made every screen's "analyzing stems…" step resolve fast (a cache hit needs no decode). YAMNet inference is real neural-net work — meaningfully slower than the hand-crafted feature extraction it sits alongside, even after model load. Forcing every screen to wait for embeddings before showing results would reintroduce exactly the visible-wait problem Plan A's own persistent-cache work eliminated. So this plan's read path (`useCachedStemEmbeddings`, Task 10) is a **read-only, cache-only, non-blocking** hook — it never triggers extraction itself, only reads whatever's already cached and updates opportunistically as rows arrive. Extraction is *only* ever triggered by the ambient background scan (Task 11), exactly mirroring how `BackgroundFeatureScan.tsx` already proactively warms `getStemFeatures` for placed stems without any screen waiting on it.

**Task ordering / dependencies.** Tasks 1-5 set up the model file, dependency, and both new persistence layers (embedding cache table/store/IPC, WASM runtime asset bundling) — infrastructure with nothing to plug in yet. Tasks 6-9 build the actual extraction pipeline (Worker, client wrapper, resampling, the extraction function itself) and can only be tested end-to-end once Tasks 1-5 exist. Task 10-11 wire extraction into the app (the non-blocking read hook, the ambient background scan). Tasks 12-13 build the pure nearest-neighbor matching logic and its main-process query. Tasks 14-15 wire embedding-preferred/centroid-fallback suggestions into both Tidy Up and Auto-Arrange's role step. Task 16 is final verification.

---

### Task 1: Vendor the YAMNet ONNX model + add onnxruntime-web

**Files:**
- Create: `scripts/vendor-yamnet.sh`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `electron-builder.yml`

**Before you start:** re-read `scripts/vendor-rubberband.sh`'s own header comment (already read this session) — this task follows the exact same "gitignored, vendored via script, not committed to a now-public repo" convention, adapted for a single cross-platform model file instead of a per-arch binary+dylibs bundle.

- [ ] **Step 1: Write the vendor script**

```bash
#!/usr/bin/env bash
# scripts/vendor-yamnet.sh
#
# Downloads the YAMNet ONNX model into resources/yamnet/, so electron-builder
# can ship it as an extraResource (see electron-builder.yml) the same way
# scripts/vendor-rubberband.sh already vendors the rubberband binary.
#
# There is no single official Google-published ONNX export of YAMNet (the
# official distribution is TF-Hub/TFJS format) -- this fetches a real,
# verified tf2onnx conversion of Google's official YAMNet (AudioSet, 521
# classes), Apache-2.0 licensed, from andrelgomes/yamnet-onnx on Hugging
# Face (verified directly 2026-09-14: MobileNetV1 backbone, ~3.7M params,
# 16kHz native input, waveform in -> [521 class scores, 1024-dim
# embeddings, 64-dim log-mel] out per frame -- this app only uses the
# 1024-dim embedding output).
#
# Not run as part of `npm run dev`/`npm test` -- only in CI's release
# workflow and by hand for local packaged-build testing, same as
# vendor-rubberband.sh. Gitignored (resources/yamnet/), not committed --
# same "not committing binaries to a now-public repo" reasoning as
# rubberband, this time for a ~14MB model file rather than a licensing
# concern.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/resources/yamnet"
MODEL_URL="https://huggingface.co/andrelgomes/yamnet-onnx/resolve/main/yamnet.onnx"

mkdir -p "$OUT_DIR"
echo "vendor-yamnet: downloading $MODEL_URL"
curl -fL --progress-bar "$MODEL_URL" -o "$OUT_DIR/yamnet.onnx"
echo "vendor-yamnet: wrote $OUT_DIR/yamnet.onnx ($(du -h "$OUT_DIR/yamnet.onnx" | cut -f1))"
```

- [ ] **Step 2: Make it executable and run it**

Run: `chmod +x scripts/vendor-yamnet.sh && ./scripts/vendor-yamnet.sh`
Expected: downloads to `resources/yamnet/yamnet.onnx`, prints the final file size (should be in the tens-of-MB range — if it's suspiciously small, e.g. under 1MB, the download likely failed silently or hit an HTML error page instead of the model; check with `file resources/yamnet/yamnet.onnx` — it should report a real binary, not ASCII/HTML text).

- [ ] **Step 3: Gitignore the vendored model**

Add to `.gitignore` (near the existing `resources/rubberband/` line):
```
resources/yamnet/
```

- [ ] **Step 4: Add the onnxruntime-web dependency**

Run: `npm install onnxruntime-web@^1.29.0`
Expected: adds `onnxruntime-web` to `package.json`'s `dependencies`, updates `package-lock.json`.

- [ ] **Step 5: Add the extraResources entry**

In `electron-builder.yml`, add to the existing `extraResources` list (after the `resources/rubberband` entry):
```yaml
  # Produced by scripts/vendor-yamnet.sh (run in CI before packaging, same
  # as rubberband above) -- the YAMNet ONNX model used for stem-similarity
  # embeddings (src/main/yamnetModel.ts). Gitignored, not committed --
  # ~14MB, fetched at vendor time rather than bloating a now-public repo.
  - from: resources/yamnet
    to: yamnet
```

- [ ] **Step 6: Commit**

```bash
git add scripts/vendor-yamnet.sh .gitignore package.json package-lock.json electron-builder.yml
git commit -m "$(cat <<'EOF'
Add onnxruntime-web dependency and YAMNet model vendoring script

First task of Plan B2 (ML embeddings, Phase 2 of Library-Wide
Discover's auto-classification accuracy work) -- vendors the real
model file (a verified tf2onnx conversion of Google's official
YAMNet, Apache-2.0, from andrelgomes/yamnet-onnx on Hugging Face --
there is no single official Google-published ONNX export) the same
gitignored-and-vendored-via-script way rubberband's binary already is,
and adds the onnxruntime-web runtime dependency that will load it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 2: Main-process model-bytes IPC + preload

**Files:**
- Create: `src/main/yamnetModel.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Before you start:** re-read `src/main/demoRifff.ts`'s own `demoRifffDir()` (already read this session) — this task mirrors its exact dev-vs-packaged path resolution.

- [ ] **Step 1: Write the model-path resolver**

Create `src/main/yamnetModel.ts`:
```ts
// src/main/yamnetModel.ts
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { app } from 'electron'

/** Mirrors demoRifff.ts's own demoRifffDir() dev-vs-packaged branch exactly:
 * packaged mode reads the extraResources copy (see electron-builder.yml),
 * dev mode reads straight out of the repo's own resources/ (vendored by
 * scripts/vendor-yamnet.sh -- gitignored, run once locally before `npm run
 * dev` for embedding work to function; every other feature in this app
 * works fine without it, this only affects Plan B2's own embedding path). */
function yamnetModelPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'yamnet', 'yamnet.onnx')
  }
  return join(app.getAppPath(), 'resources', 'yamnet', 'yamnet.onnx')
}

/** Reads the vendored YAMNet ONNX model's raw bytes -- returned to the
 * renderer over IPC (get-yamnet-model) for onnxruntime-web's
 * InferenceSession.create() to consume directly (it accepts a Uint8Array,
 * not just a URL). Returns null (not a throw) when the model hasn't been
 * vendored yet (e.g. a fresh dev checkout that hasn't run
 * scripts/vendor-yamnet.sh) -- the renderer-side embedding path treats a
 * null model the same as "extraction unavailable," which the design's own
 * layered-fallback shape already handles gracefully (falls back to Plan
 * B1's centroid classifier). */
export function readYamnetModelBytes(): Uint8Array | null {
  const path = yamnetModelPath()
  if (!existsSync(path)) return null
  return readFileSync(path)
}
```

- [ ] **Step 2: Add the IPC handler**

In `src/main/index.ts`, add near the other `get-stem-feature-cache`-style handlers (find `import { getStemFeatureCache, setStemFeatureCache } from './stemFeatureCacheStore'` and add alongside it):
```ts
import { readYamnetModelBytes } from './yamnetModel'
```

Add the handler itself, near `get-stem-feature-cache`:
```ts
  ipcMain.handle('get-yamnet-model', (): Uint8Array | null => readYamnetModelBytes())
```

- [ ] **Step 3: Expose it in preload**

In `src/preload/index.ts`, add near `getStemFeatureCache`:
```ts
  getYamnetModel: (): Promise<Uint8Array | null> => ipcRenderer.invoke('get-yamnet-model'),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/yamnetModel.ts src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Add get-yamnet-model IPC: reads the vendored model's raw bytes

Mirrors demoRifff.ts's own dev-vs-packaged path resolution exactly.
Returns null (not a throw) when the model hasn't been vendored yet --
every other feature in this app works fine without it; this only
affects Plan B2's own embedding extraction, which treats a null model
as "extraction unavailable" and falls back to Plan B1's classifier.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 3: `StemEmbeddingCache` table + main-process store

**Files:**
- Modify: `src/main/riffLibrarySchema.ts`
- Create: `src/main/stemEmbeddingCacheStore.ts`
- Test: `src/main/stemEmbeddingCacheStore.test.ts`

**Before you start:** re-read `src/main/stemFeatureCacheStore.ts` and its own test file fresh (already read `stemFeatureCacheStore.ts` this session) — this task's store is a structural clone, swapping `StemFeatures`/`FeaturesJSON` for a plain `number[]` embedding/`EmbeddingJSON`.

- [ ] **Step 1: Add the table**

In `src/main/riffLibrarySchema.ts`, add after the existing `StemFeatureCache` table definition:
```sql
CREATE TABLE IF NOT EXISTS StemEmbeddingCache (
  StemCID TEXT PRIMARY KEY,
  EmbeddingJSON TEXT NOT NULL,
  ExtractedAt INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

Create `src/main/stemEmbeddingCacheStore.test.ts`:
```ts
// src/main/stemEmbeddingCacheStore.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { RIFF_LIBRARY_SCHEMA_SQL } from './riffLibrarySchema'
import { getStemEmbeddingCache, setStemEmbeddingCache } from './stemEmbeddingCacheStore'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(RIFF_LIBRARY_SCHEMA_SQL)
  return db
}

function seedStem(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO Stems (StemCID, RiffCID, Slot, SoundType, PresetName, FileKey)
     VALUES (?, 'riff1', 1, 'fx', 'test', ?)`
  ).run(stemCID, stemCID)
}

describe('stemEmbeddingCacheStore', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('returns null for a stem that has never been extracted', () => {
    seedStem(db, 'abc123')
    expect(getStemEmbeddingCache(db, '/lib/abc123')).toBeNull()
  })

  it('returns null for a path that is not a real library stem', () => {
    expect(getStemEmbeddingCache(db, '/lib/not-a-real-stem')).toBeNull()
  })

  it('round-trips a stored embedding', () => {
    seedStem(db, 'abc123')
    const embedding = new Array(1024).fill(0).map((_, i) => i / 1024)
    setStemEmbeddingCache(db, '/lib/abc123', embedding, 1000)
    expect(getStemEmbeddingCache(db, '/lib/abc123')).toEqual(embedding)
  })

  it('overwrites a prior embedding for the same stem on re-extraction', () => {
    seedStem(db, 'abc123')
    setStemEmbeddingCache(db, '/lib/abc123', new Array(1024).fill(0), 1000)
    setStemEmbeddingCache(db, '/lib/abc123', new Array(1024).fill(1), 2000)
    expect(getStemEmbeddingCache(db, '/lib/abc123')).toEqual(new Array(1024).fill(1))
  })

  it('is a silent no-op when setting for a path that is not a real library stem', () => {
    expect(() => setStemEmbeddingCache(db, '/lib/not-real', [1, 2, 3], 1000)).not.toThrow()
    expect(getStemEmbeddingCache(db, '/lib/not-real')).toBeNull()
  })

  it('checks extraCandidateDbs after the primary db to resolve the StemCID', () => {
    const externalDb = makeDb()
    seedStem(externalDb, 'ext123')
    // The embedding cache row itself always lives in the PRIMARY db, never
    // the external one -- same as stemFeatureCacheStore.ts's own contract.
    setStemEmbeddingCache(db, '/lib/ext123', [1, 2, 3], 1000, [externalDb])
    expect(getStemEmbeddingCache(db, '/lib/ext123', [externalDb])).toEqual([1, 2, 3])
    expect(
      externalDb.prepare('SELECT 1 FROM StemEmbeddingCache WHERE StemCID = ?').get('ext123')
    ).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/stemEmbeddingCacheStore.test.ts`
Expected: FAIL — `stemEmbeddingCacheStore.ts` doesn't exist yet, and `RIFF_LIBRARY_SCHEMA_SQL` may not currently be an exported name (check `riffLibrarySchema.ts`'s actual export name before writing this test's import — if the schema SQL is exported under a different identifier, e.g. just the module's default/only export, use that exact name instead. Same for the `Stems` table's own real column list — this test's `seedStem` helper's INSERT must match the REAL `Stems` table schema exactly; re-read it fresh in `riffLibrarySchema.ts` and correct the columns/values above if they differ from what's shown here).

- [ ] **Step 3: Write the store**

Create `src/main/stemEmbeddingCacheStore.ts`:
```ts
// src/main/stemEmbeddingCacheStore.ts
import type Database from 'better-sqlite3'
import { stemCIDForPath } from './stemCategoriesStore'

/** Reads a stem's persisted YAMNet embedding by its on-disk path -- exact
 * structural mirror of stemFeatureCacheStore.ts's own getStemFeatureCache,
 * swapping StemFeatures for a plain 1024-dim number[]. Returns null both
 * for "never extracted yet" and "not a real library stem at all" -- a
 * caller treats both identically: no embedding available, fall back to
 * Plan B1's classifier (see roleEmbeddingRefinement.ts). A row whose
 * EmbeddingJSON fails to parse (shouldn't happen -- only ever written by
 * setStemEmbeddingCache below -- but defensive against a corrupted DB
 * file) is treated the same as a miss rather than throwing. */
export function getStemEmbeddingCache(
  db: Database.Database,
  path: string,
  extraCandidateDbs: Database.Database[] = []
): number[] | null {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return null
  const row = db
    .prepare(`SELECT EmbeddingJSON FROM StemEmbeddingCache WHERE StemCID = ?`)
    .get(stemCID) as { EmbeddingJSON: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.EmbeddingJSON) as number[]
  } catch {
    return null
  }
}

/** Persists a freshly extracted embedding for a stem, keyed by the StemCID
 * its path resolves to. A no-op (not an error) for a path that doesn't
 * resolve to a real Stems row -- same silent-skip behavior as
 * stemFeatureCacheStore.ts's own setStemFeatureCache, for the same reason
 * (a locally-dropped file/one-shot/in-app recording has nothing to persist
 * against). extraCandidateDbs, same as getStemEmbeddingCache above, are
 * checked only to validate the StemCID -- the row is always written into
 * `db` itself. */
export function setStemEmbeddingCache(
  db: Database.Database,
  path: string,
  embedding: number[],
  extractedAt: number,
  extraCandidateDbs: Database.Database[] = []
): void {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt)
     VALUES (@stemCID, @embeddingJson, @extractedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       EmbeddingJSON = excluded.EmbeddingJSON,
       ExtractedAt = excluded.ExtractedAt`
  ).run({ stemCID, embeddingJson: JSON.stringify(embedding), extractedAt })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/stemEmbeddingCacheStore.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: no errors, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/main/riffLibrarySchema.ts src/main/stemEmbeddingCacheStore.ts src/main/stemEmbeddingCacheStore.test.ts
git commit -m "$(cat <<'EOF'
Add StemEmbeddingCache table and its main-process store

Structural mirror of Plan A's StemFeatureCache/stemFeatureCacheStore.ts
-- same StemCID-keyed, JSON-blob-column, ExtractedAt convention, same
extraCandidateDbs support for an external LORE archive. Stores a
stem's YAMNet embedding (a plain 1024-dim number[], not a typed
interface -- there's no equivalent to StemFeatures' own named fields
here, it's an opaque learned vector).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 4: IPC handlers + preload for the embedding cache

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Before you start:** re-read the `get-stem-feature-cache`/`set-stem-feature-cache` handlers in `src/main/index.ts` fresh (already read this session, lines ~746-764) — this task's handlers are a direct structural mirror.

- [ ] **Step 1: Add the IPC handlers**

In `src/main/index.ts`, add the import:
```ts
import { getStemEmbeddingCache, setStemEmbeddingCache } from './stemEmbeddingCacheStore'
```

Add the handlers, right after `set-stem-feature-cache`'s own handler:
```ts
  ipcMain.handle('get-stem-embedding-cache', (_event, path: string): number[] | null =>
    getStemEmbeddingCache(openOwnRiffLibraryDb(), path, candidateDbsForRiff())
  )

  ipcMain.handle(
    'set-stem-embedding-cache',
    (_event, path: string, embedding: number[]) => {
      // Floored, same reasoning as set-stem-feature-cache right above --
      // StemEmbeddingCache has exactly one writer and its own upsert has no
      // WHERE-guarded comparison against a prior write's timestamp.
      setStemEmbeddingCache(
        openOwnRiffLibraryDb(),
        path,
        embedding,
        Math.floor(Date.now() / 1000),
        candidateDbsForRiff()
      )
    }
  )
```

- [ ] **Step 2: Expose in preload**

In `src/preload/index.ts`, add near `getStemFeatureCache`/`setStemFeatureCache`:
```ts
  getStemEmbeddingCache: (path: string): Promise<number[] | null> =>
    ipcRenderer.invoke('get-stem-embedding-cache', path),
  setStemEmbeddingCache: (path: string, embedding: number[]): Promise<void> =>
    ipcRenderer.invoke('set-stem-embedding-cache', path, embedding),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Wire get/set-stem-embedding-cache IPC handlers

Direct structural mirror of get/set-stem-feature-cache.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 5: Bundle onnxruntime-web's WASM runtime for the renderer

**Files:**
- Create: `src/renderer/public/` (Vite's static-asset convention — files here are copied verbatim to the build output root and served at `/`)
- Create: `scripts/vendor-onnxruntime-wasm.sh`
- Modify: `.gitignore`
- Modify: `package.json` (a `postinstall`-adjacent note, see Step 3)

**Before you start:** `src/renderer/public/` does not exist yet in this repo (checked 2026-09-14) — this is a new convention, not an existing one to follow. onnxruntime-web ships its WASM binaries under `node_modules/onnxruntime-web/dist/`; the exact file list varies by version and build (simd/threaded variants) — Step 1 has you inspect the real installed files rather than trusting a hardcoded list, since guessing wrong here silently breaks model loading with no build-time error.

- [ ] **Step 1: Inspect the real installed WASM files**

Run: `ls -la node_modules/onnxruntime-web/dist/*.wasm node_modules/onnxruntime-web/dist/*.mjs 2>/dev/null`
Expected: a handful of `.wasm` files (e.g. `ort-wasm-simd-threaded.wasm` and similar) and possibly `.mjs` companion files. Note the exact filenames you see — Step 2's script copies whatever's actually there rather than a hardcoded list, precisely because this varies by version.

- [ ] **Step 2: Write the vendor script**

Create `scripts/vendor-onnxruntime-wasm.sh`:
```bash
#!/usr/bin/env bash
# scripts/vendor-onnxruntime-wasm.sh
#
# Copies onnxruntime-web's own WASM runtime files (node_modules/
# onnxruntime-web/dist/*.{wasm,mjs}) into src/renderer/public/onnxruntime/,
# Vite's static-asset convention (files under a renderer's own public/ are
# copied verbatim to the build output root and served at /) -- these are
# NOT bundled by Vite's normal JS/CSS pipeline (they're loaded at runtime by
# onnxruntime-web itself via fetch/instantiateStreaming, not imported), so
# they need to exist as plain static files instead.
#
# Run once after `npm install` (or whenever onnxruntime-web is upgraded) --
# not part of `npm run dev` itself, since these files rarely change and
# don't need to be regenerated on every dev-server boot. Gitignored (see
# .gitignore) since they're a direct, un-transformed copy of a node_modules
# package's own files -- regenerating from the installed dependency is
# simpler and less error-prone than keeping a second committed copy in sync.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/node_modules/onnxruntime-web/dist"
OUT_DIR="$REPO_ROOT/src/renderer/public/onnxruntime"

if [ ! -d "$SRC_DIR" ]; then
  echo "vendor-onnxruntime-wasm: $SRC_DIR not found -- run 'npm install' first" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
shopt -s nullglob
files=("$SRC_DIR"/*.wasm "$SRC_DIR"/*.mjs)
if [ ${#files[@]} -eq 0 ]; then
  echo "vendor-onnxruntime-wasm: no .wasm/.mjs files found in $SRC_DIR -- onnxruntime-web's own dist/ layout may have changed; inspect it manually" >&2
  exit 1
fi
cp "${files[@]}" "$OUT_DIR/"
echo "vendor-onnxruntime-wasm: copied ${#files[@]} file(s) to $OUT_DIR"
ls -la "$OUT_DIR"
```

- [ ] **Step 3: Run it and note the result in package.json**

Run: `chmod +x scripts/vendor-onnxruntime-wasm.sh && ./scripts/vendor-onnxruntime-wasm.sh`
Expected: copies the files, lists them.

Add a comment-adjacent `scripts` entry to `package.json` (alongside the existing `scripts` block) so this isn't a step someone has to remember by convention alone:
```json
    "vendor:onnxruntime-wasm": "bash scripts/vendor-onnxruntime-wasm.sh",
```

- [ ] **Step 4: Gitignore the copied files**

Add to `.gitignore`:
```
src/renderer/public/onnxruntime/
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this task doesn't touch any TypeScript yet — this just confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add scripts/vendor-onnxruntime-wasm.sh package.json .gitignore
git commit -m "$(cat <<'EOF'
Add vendor-onnxruntime-wasm script for the renderer's WASM runtime

onnxruntime-web's own WASM files aren't part of Vite's normal JS/CSS
bundling -- they're loaded at runtime via fetch, so they need to exist
as plain static files under src/renderer/public/onnxruntime/ (Vite's
static-asset convention). Copied from node_modules/onnxruntime-web/
dist/ rather than committed, same reasoning as the model file itself
(regenerating from the installed dependency vs. keeping a second copy
in sync). yamnetClient.ts (a later task) points onnxruntime-web's own
env.wasm.wasmPaths at this directory.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 6: The YAMNet Web Worker

**Files:**
- Create: `src/renderer/src/audio/yamnetWorker.ts`

**Before you start:** re-read `src/renderer/src/audio/stemFeaturesCache.ts` fresh (already read this session) for this codebase's own doc-comment conventions around audio analysis modules. This worker is intentionally dumb — it only does inference, never decode or resampling (those stay on the main/renderer thread, reusing existing machinery, per this plan's own "no new decode path" framing) — and never touches IPC directly (the client wrapper, Task 7, owns fetching the model bytes and hands them to the worker).

- [ ] **Step 1: Write the worker**

Create `src/renderer/src/audio/yamnetWorker.ts`:
```ts
// src/renderer/src/audio/yamnetWorker.ts
//
// Runs YAMNet inference off the main thread -- model loading and each
// inference call happen here, never in the renderer's own thread, so a
// first-time scan of a large library doesn't block the UI (design spec §7).
// Deliberately does NOT decode audio or resample itself: the caller
// (yamnetClient.ts) hands this worker already-decoded, already-16kHz-mono
// PCM, reusing the exact same Web-Audio-decode path stemFeaturesCache.ts's
// own getStemFeatures already uses rather than adding a second decode path
// (see this plan's own "Important context").
//
// Message protocol (both directions are plain structured-clone objects,
// not classes):
//   In:  { type: 'init', modelBytes: Uint8Array }
//        { type: 'infer', requestId: number, pcm: Float32Array }
//   Out: { type: 'ready' }
//        { type: 'result', requestId: number, embedding: number[] }
//        { type: 'error', requestId: number | null, message: string }

import * as ort from 'onnxruntime-web'

ort.env.wasm.wasmPaths = '/onnxruntime/'

let session: ort.InferenceSession | null = null

interface InitMessage {
  type: 'init'
  modelBytes: Uint8Array
}

interface InferMessage {
  type: 'infer'
  requestId: number
  pcm: Float32Array
}

type InMessage = InitMessage | InferMessage

/** YAMNet's own per-frame embedding output (output_1, shape [numFrames,
 * 1024]) mean-pooled across frames into one fixed-length vector per stem --
 * see this plan's own "Important context" for the verified output shape.
 * Frame count varies with clip length; the embedding dimension (1024) is
 * fixed regardless. */
function meanPoolEmbedding(data: Float32Array, numFrames: number, embeddingDim: number): number[] {
  const pooled = new Array<number>(embeddingDim).fill(0)
  if (numFrames === 0) return pooled
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * embeddingDim
    for (let d = 0; d < embeddingDim; d++) pooled[d] += data[offset + d]
  }
  for (let d = 0; d < embeddingDim; d++) pooled[d] /= numFrames
  return pooled
}

async function handleInit(modelBytes: Uint8Array): Promise<void> {
  session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['wasm']
  })
  postMessage({ type: 'ready' })
}

async function handleInfer(requestId: number, pcm: Float32Array): Promise<void> {
  if (!session) throw new Error('yamnetWorker: infer requested before init completed')
  const input = new ort.Tensor('float32', pcm, [pcm.length])
  const outputs = await session.run({ waveform: input })
  const embeddingOutput = outputs.output_1
  const embeddingDim = 1024
  const numFrames = embeddingOutput.dims[0]
  const embedding = meanPoolEmbedding(
    embeddingOutput.data as Float32Array,
    numFrames,
    embeddingDim
  )
  postMessage({ type: 'result', requestId, embedding })
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const msg = event.data
  if (msg.type === 'init') {
    handleInit(msg.modelBytes).catch((err: unknown) => {
      postMessage({
        type: 'error',
        requestId: null,
        message: err instanceof Error ? err.message : String(err)
      })
    })
  } else if (msg.type === 'infer') {
    handleInfer(msg.requestId, msg.pcm).catch((err: unknown) => {
      postMessage({
        type: 'error',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err)
      })
    })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If TypeScript complains about `self.onmessage`/`postMessage` not matching a Worker global context (rather than the main-thread `Window` context), check `tsconfig.web.json`'s own `lib`/`types` settings — this file needs to compile against `WebWorker` lib types, not just `DOM`. If it's not already configured for worker files, this may need a small `tsconfig.web.json` adjustment (e.g. a `webworker` lib addition, possibly scoped via a separate `tsconfig` for `*.worker.ts`/files under a `workers/` naming convention) — investigate the exact fix needed rather than guessing; report back if this requires a build-config decision beyond this file itself.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/yamnetWorker.ts
git commit -m "$(cat <<'EOF'
Add yamnetWorker.ts: runs YAMNet inference off the main thread

Deliberately does not decode or resample audio itself -- the caller
hands it already-16kHz-mono PCM, reusing the existing Web-Audio-decode
path rather than adding a second one. Mean-pools YAMNet's own per-
frame embedding output (output_1, [numFrames, 1024]) into one 1024-dim
vector per stem.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 7: The renderer-side worker client

**Files:**
- Create: `src/renderer/src/audio/yamnetClient.ts`

**Before you start:** re-read `src/renderer/src/audio/yamnetWorker.ts` (just written) for its exact message protocol. This client is the ONLY thing that talks to the worker — every other module in this plan calls through it, never constructing a `Worker` directly.

- [ ] **Step 1: Write the client**

Create `src/renderer/src/audio/yamnetClient.ts`:
```ts
// src/renderer/src/audio/yamnetClient.ts
//
// Lazily creates and owns the single yamnetWorker.ts instance for this
// renderer process, and wraps its message protocol in a promise-based
// request/response API. Model bytes are fetched via IPC (get-yamnet-model,
// main-process yamnetModel.ts) exactly once, the first time inference is
// actually requested -- not eagerly at module load, so a session that never
// touches an embedding-consuming screen never pays the model-load cost at
// all.

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null
let nextRequestId = 0
const pending = new Map<number, { resolve: (embedding: number[]) => void; reject: (err: Error) => void }>()

interface ReadyMessage {
  type: 'ready'
}
interface ResultMessage {
  type: 'result'
  requestId: number
  embedding: number[]
}
interface ErrorMessage {
  type: 'error'
  requestId: number | null
  message: string
}
type OutMessage = ReadyMessage | ResultMessage | ErrorMessage

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./yamnetWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<OutMessage>) => {
    const msg = event.data
    if (msg.type === 'result') {
      pending.get(msg.requestId)?.resolve(msg.embedding)
      pending.delete(msg.requestId)
    } else if (msg.type === 'error') {
      if (msg.requestId !== null) {
        pending.get(msg.requestId)?.reject(new Error(msg.message))
        pending.delete(msg.requestId)
      }
    }
  }
  return worker
}

/** Resolves once the model has loaded in the worker and is ready to run
 * inference -- idempotent, safe to call repeatedly (returns the same
 * in-flight/settled promise). Returns null (never throws) when the model
 * bytes aren't available at all (readYamnetModelBytes returned null, e.g.
 * a dev checkout that hasn't run scripts/vendor-yamnet.sh) -- a caller
 * treats this the same as "extraction unavailable right now" and falls
 * back to Plan B1's classifier, exactly like a stem that simply hasn't
 * been extracted yet. */
function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    const modelBytes = await window.rifffApi.getYamnetModel()
    if (!modelBytes) throw new Error('yamnetClient: model bytes unavailable')
    getWorker().postMessage({ type: 'init', modelBytes }, [modelBytes.buffer])
    await new Promise<void>((resolve, reject) => {
      const w = getWorker()
      const onMessage = (event: MessageEvent<OutMessage>): void => {
        if (event.data.type === 'ready') {
          w.removeEventListener('message', onMessage)
          resolve()
        } else if (event.data.type === 'error' && event.data.requestId === null) {
          w.removeEventListener('message', onMessage)
          reject(new Error(event.data.message))
        }
      }
      w.addEventListener('message', onMessage)
    })
  })()
  return readyPromise
}

/** Runs YAMNet inference on one stem's already-decoded, already-16kHz-mono
 * PCM and returns its mean-pooled 1024-dim embedding. Returns null (never
 * throws) on ANY failure -- model unavailable, worker error, malformed
 * input -- since every caller in this plan treats "no embedding" as a
 * normal, expected fallback case (Plan B1's classifier), not an error
 * condition worth surfacing. */
export async function extractEmbedding(pcm: Float32Array): Promise<number[] | null> {
  try {
    await ensureReady()
  } catch (err) {
    console.error('yamnetClient: model failed to load', err)
    return null
  }
  return new Promise<number[] | null>((resolve) => {
    const requestId = nextRequestId++
    pending.set(requestId, {
      resolve: (embedding) => resolve(embedding),
      reject: (err) => {
        console.error('yamnetClient: inference failed', err)
        resolve(null)
      }
    })
    const pcmCopy = pcm.slice()
    getWorker().postMessage({ type: 'infer', requestId, pcm: pcmCopy }, [pcmCopy.buffer])
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If Vite's `new URL('./yamnetWorker.ts', import.meta.url)` worker-construction pattern isn't recognized correctly by the TypeScript config (a known pattern for Vite-bundled workers, but verify it actually resolves in THIS project's `tsconfig.web.json`/electron-vite setup rather than assuming), investigate and report back rather than working around it with an `any` cast.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/yamnetClient.ts
git commit -m "$(cat <<'EOF'
Add yamnetClient.ts: promise-based wrapper around the YAMNet worker

Lazily creates the worker and loads the model on first real use, not
at module load. extractEmbedding() never throws -- every caller in
this plan treats a null result (model unavailable, worker error,
malformed input) as the normal "fall back to Plan B1's classifier"
case, not something to surface as an error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 8: Resample to 16kHz mono

**Files:**
- Create: `src/renderer/src/audio/resampleTo16kMono.ts`

**Before you start:** no resampling utility exists anywhere in this codebase yet (checked 2026-09-14) — every existing analysis (mfcc.ts, bandEnergy.ts) works directly at whatever sample rate `AudioBuffer.sampleRate` naturally is. YAMNet strictly requires 16kHz mono input (verified against the model's own input spec, this plan's own "Important context"), so this is genuinely new.

- [ ] **Step 1: Write the resampler**

Create `src/renderer/src/audio/resampleTo16kMono.ts`:
```ts
// src/renderer/src/audio/resampleTo16kMono.ts

/** YAMNet's own required input sample rate (verified against the vendored
 * model's input spec -- see this plan's own "Important context"). */
export const YAMNET_SAMPLE_RATE = 16000

/** Resamples an already-decoded AudioBuffer to 16kHz mono, via
 * OfflineAudioContext -- the standard browser-native way to resample
 * (render the buffer through a context created at the TARGET sample rate).
 * Only YAMNet extraction needs this; every other analysis in this codebase
 * works directly at the source sample rate, so this is deliberately its own
 * small module rather than folded into peakCache.ts/stemFeaturesCache.ts's
 * own decode path. Downmixes to mono by averaging all channels (simple,
 * standard approach -- YAMNet's own training data is mono, so there's no
 * "correct" stereo-to-mono weighting to preserve). */
export async function resampleTo16kMono(audioBuffer: AudioBuffer): Promise<Float32Array> {
  const durationSec = audioBuffer.duration
  const targetLength = Math.ceil(durationSec * YAMNET_SAMPLE_RATE)
  const offlineCtx = new OfflineAudioContext(1, targetLength, YAMNET_SAMPLE_RATE)

  // Downmix every source channel into one mono buffer BEFORE feeding it to
  // the OfflineAudioContext -- simplest way to guarantee mono output
  // regardless of how many channels the source has, without relying on the
  // destination's own implicit channel-count behavior (which downmixes by
  // a different, non-simple-average formula for stereo->mono).
  const monoSamples = new Float32Array(audioBuffer.length)
  const numChannels = audioBuffer.numberOfChannels
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < channelData.length; i++) monoSamples[i] += channelData[i] / numChannels
  }

  const monoBuffer = offlineCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate)
  monoBuffer.copyToChannel(monoSamples, 0)

  const source = offlineCtx.createBufferSource()
  source.buffer = monoBuffer
  source.connect(offlineCtx.destination)
  source.start()

  const rendered = await offlineCtx.startRendering()
  return rendered.getChannelData(0)
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/resampleTo16kMono.ts
git commit -m "$(cat <<'EOF'
Add resampleTo16kMono.ts: YAMNet's required input format

New utility -- no resampling exists anywhere else in this codebase,
every other analysis works directly at the source sample rate.
Downmixes to mono by simple per-sample averaging across channels
before rendering through an OfflineAudioContext created at YAMNet's
required 16kHz.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 9: The extraction pipeline (persistent cache + full decode/resample/infer/persist path)

**Files:**
- Create: `src/renderer/src/audio/stemEmbeddingCache.ts`

**Before you start:** re-read `src/renderer/src/audio/stemFeaturesCache.ts`'s own `getStemFeatures` fresh (already read this session) — this task's write path mirrors its decode-and-persist shape closely, swapping the hand-crafted feature computation for resample+YAMNet-inference. Unlike `getStemFeatures`, though, this module's own exported function is used ONLY by the background scan (Task 11) — see this plan's own "Important context" for why no screen ever calls this directly to avoid reintroducing a visible wait.

- [ ] **Step 1: Write the extraction module**

Create `src/renderer/src/audio/stemEmbeddingCache.ts`:
```ts
// src/renderer/src/audio/stemEmbeddingCache.ts
import { getAudioContext } from './peakCache'
import { resampleTo16kMono } from './resampleTo16kMono'
import { extractEmbedding } from './yamnetClient'

const cache = new Map<string, Promise<number[] | null>>()

/** Extracts (or returns the already-in-flight/cached extraction for) one
 * stem's YAMNet embedding -- persistent-cache-first (a stem the background
 * scan or a prior session already extracted needs no decode/inference at
 * all), same two-tier shape as stemFeaturesCache.ts's own getStemFeatures.
 *
 * ONLY ever called from BackgroundFeatureScan.tsx's own ambient extraction
 * pass (Task 11) -- deliberately NOT a general-purpose "get embedding, warm
 * the cache if needed" function any screen calls directly, unlike
 * getStemFeatures. See this plan's own "Important context: why extraction
 * never blocks a screen's own scan" -- neural-net inference is meaningfully
 * slower than the hand-crafted feature extraction it sits alongside, so
 * forcing a screen's own "analyzing stems…" step to wait on it would
 * reintroduce exactly the visible-wait problem Plan A's persistent-cache
 * work eliminated. Screens read whatever's already cached via
 * useCachedStemEmbeddings (Task 10), which never triggers extraction.
 *
 * Returns null (never throws) for a stem that fails to extract for ANY
 * reason (decode failure, resample failure, model unavailable, inference
 * failure) -- logged, not propagated, matching getStemFeatures' own
 * Promise.allSettled-friendly caller conventions elsewhere in this
 * codebase, though this function itself never rejects at all (simpler for
 * a background-only caller that just wants to know "did it work"). */
export function getOrExtractStemEmbedding(path: string): Promise<number[] | null> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async (): Promise<number[] | null> => {
    try {
      const persisted = await window.rifffApi.getStemEmbeddingCache(path)
      if (persisted) return persisted

      const bytes = await window.rifffApi.readAudioFile(path)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      const pcm = await resampleTo16kMono(audioBuffer)
      const embedding = await extractEmbedding(pcm)
      if (!embedding) return null

      // Fire-and-forget, matching getStemFeatures' own setStemFeatureCache
      // call -- a real library stem's path persists for next time; a
      // non-library path is silently skipped main-process-side.
      void window.rifffApi.setStemEmbeddingCache(path, embedding)
      return embedding
    } catch (err) {
      console.error('getOrExtractStemEmbedding: extraction failed for stem', path, err)
      cache.delete(path)
      return null
    }
  })()

  cache.set(path, promise)
  return promise
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/stemEmbeddingCache.ts
git commit -m "$(cat <<'EOF'
Add stemEmbeddingCache.ts: the full extraction pipeline

Persistent-cache-first, same two-tier shape as stemFeaturesCache.ts's
own getStemFeatures. Deliberately NOT called by any screen directly --
only BackgroundFeatureScan.tsx's own ambient pass (a later task) calls
this, so extraction never blocks a screen's own "analyzing stems…"
step. Never throws; a stem that fails to extract for any reason
resolves null, logged not propagated.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 10: The non-blocking read hook

**Files:**
- Create: `src/renderer/src/audio/useCachedStemEmbeddings.ts`

**Before you start:** this hook is intentionally NOT a copy of `useStemFeatureScan.ts` — it has no `loading` flag and never calls the extraction pipeline (Task 9's `getOrExtractStemEmbedding`), only the pure cache-read IPC (`getStemEmbeddingCache`, already wired in Task 4). Re-read this plan's own "Important context" section on why before writing this.

- [ ] **Step 1: Write the hook**

Create `src/renderer/src/audio/useCachedStemEmbeddings.ts`:
```ts
// src/renderer/src/audio/useCachedStemEmbeddings.ts
import { useEffect, useState } from 'react'
import type { StemFeatureScanItem } from './useStemFeatureScan'

/** Read-only, cache-only, NON-blocking companion to useStemFeatureScan --
 * deliberately does NOT trigger extraction itself (unlike getStemFeatures,
 * which extracts on a cache miss), only reads whatever embeddings are
 * already persisted and updates opportunistically as each read resolves.
 * No `loading` flag: a caller's own scan/render flow never waits on this,
 * it just re-renders with more embeddings filled in as they arrive. See
 * this plan's own "Important context" for why -- neural-net extraction is
 * real work, not a cheap cache-hit-or-decode like the hand-crafted
 * features, so nothing should block on it.
 *
 * Reuses StemFeatureScanItem's own {key, path}[] shape (useStemFeatureScan.ts)
 * rather than inventing a parallel type -- every call site already builds
 * this exact shape for the feature scan, so it's passed straight through
 * to this hook too. */
export function useCachedStemEmbeddings(items: StemFeatureScanItem[]): Map<string, number[]> {
  const [embeddingByKey, setEmbeddingByKey] = useState<Map<string, number[]>>(new Map())

  useEffect(() => {
    let cancelled = false
    setEmbeddingByKey(new Map())
    for (const item of items) {
      void window.rifffApi.getStemEmbeddingCache(item.path).then((embedding) => {
        if (cancelled || !embedding) return
        setEmbeddingByKey((prev) => {
          const next = new Map(prev)
          next.set(item.key, embedding)
          return next
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [items])

  return embeddingByKey
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/useCachedStemEmbeddings.ts
git commit -m "$(cat <<'EOF'
Add useCachedStemEmbeddings: read-only, non-blocking embedding lookup

No loading flag, never triggers extraction -- only reads whatever's
already persisted and updates opportunistically as reads resolve.
Companion to useStemFeatureScan, not a replacement for it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 11: Extend the ambient background scan

**Files:**
- Modify: `src/renderer/src/audio/BackgroundFeatureScan.tsx`

**Before you start:** re-read this file fresh (already read this session, in full) — its batching/throttling structure (`BATCH_SIZE`, `BATCH_DELAY_MS`, the `attemptedRef` dedup-by-path set) is reused as-is; this task adds a SECOND kind of extraction to the same batch loop, not a second parallel scan loop (per this whole session's own "avoid duplicate scanning mechanisms" theme, honored throughout Plan A/B1).

- [ ] **Step 1: Add the embedding extraction call alongside the feature one**

Find the `runBatch` function's per-stem loop:
```ts
      for (const fs of batch) {
        attemptedRef.current.add(fs.stem.path)
        void getStemFeatures(fs.stem.path).catch((err: unknown) => {
          console.error('BackgroundFeatureScan: extraction failed for stem', fs.stem.path, err)
        })
      }
```

Replace with:
```ts
      for (const fs of batch) {
        attemptedRef.current.add(fs.stem.path)
        void getStemFeatures(fs.stem.path).catch((err: unknown) => {
          console.error('BackgroundFeatureScan: feature extraction failed for stem', fs.stem.path, err)
        })
        // Embedding extraction (Plan B2) rides the exact same batch/
        // throttle loop as the hand-crafted feature extraction above,
        // rather than a second parallel scan -- getOrExtractStemEmbedding
        // never throws (see its own doc comment), so no .catch needed here.
        void getOrExtractStemEmbedding(fs.stem.path)
      }
```

Add the import:
```ts
import { getOrExtractStemEmbedding } from './stemEmbeddingCache'
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/BackgroundFeatureScan.tsx
git commit -m "$(cat <<'EOF'
Extend BackgroundFeatureScan to also extract embeddings ambiently

Rides the exact same batch/throttle loop as the existing hand-crafted
feature extraction, rather than a second parallel scan -- both are
proactively warmed for every placed stem, independent of whether any
screen is open.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 12: Pure nearest-neighbor matching logic

**Files:**
- Create: `src/shared/embeddingMatch.ts`
- Test: `src/shared/embeddingMatch.test.ts`

**Before you start:** re-read `src/shared/categoryCentroids.ts`'s own `suggestCategory` fresh, INCLUDING its `MIN_TRAINED_CATEGORIES_FOR_SUGGESTION` guard added this same session (2026-09-14, a real bug fix) — this task's `suggestCategoryFromEmbedding` bakes in the identical "at least 2 distinct categories present" discipline from its first version, per this plan's own "Important context." Uses cosine similarity (not euclidean distance, unlike the centroid classifier) -- the conventional choice for comparing learned embeddings, where direction matters more than raw magnitude.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/embeddingMatch.test.ts`:
```ts
// src/shared/embeddingMatch.test.ts
import { describe, expect, it } from 'vitest'
import { suggestCategoryFromEmbedding, type ConfirmedEmbedding } from './embeddingMatch'

function vec(...values: number[]): number[] {
  return values
}

describe('suggestCategoryFromEmbedding', () => {
  it('returns null when fewer than 2 categories have enough confirmed samples', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) }
    ]
    expect(suggestCategoryFromEmbedding(confirmed, vec(1, 0, 0))).toBeNull()
  })

  it('returns null when a query is far from any trained category, even with only one candidate', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) }
    ]
    // Same regression scenario as categoryCentroids.ts's own 2026-09-14 fix
    // -- a single trained category must never force a match.
    expect(suggestCategoryFromEmbedding(confirmed, vec(0, 0, 1))).toBeNull()
  })

  it('picks the nearest (highest cosine similarity) category once at least 2 are trained', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) }
    ]
    expect(suggestCategoryFromEmbedding(confirmed, vec(0.9, 0.1, 0))).toBe('drums')
    expect(suggestCategoryFromEmbedding(confirmed, vec(0.1, 0.9, 0))).toBe('vocal')
  })

  it('declines to guess when the nearest and second-nearest DIFFERENT-category neighbors are too close to call', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) }
    ]
    // Exactly equidistant (45 degrees from both) -- must not force a pick.
    expect(suggestCategoryFromEmbedding(confirmed, vec(1, 1, 0))).toBeNull()
  })

  it('ignores a category with fewer than MIN_SAMPLES_PER_CATEGORY confirmed embeddings', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      // Only 2 vocal samples -- below the minimum, so 'vocal' isn't a real
      // candidate yet even though it exists in the confirmed list.
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) }
    ]
    expect(suggestCategoryFromEmbedding(confirmed, vec(0, 1, 0))).toBeNull()
  })

  it('returns null for an empty confirmed list', () => {
    expect(suggestCategoryFromEmbedding([], vec(1, 0, 0))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/embeddingMatch.test.ts`
Expected: FAIL — `embeddingMatch.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/shared/embeddingMatch.ts`:
```ts
// src/shared/embeddingMatch.ts

/** One confirmed stem's category (whichever axis the caller queried for --
 * this module is axis-agnostic, unlike categoryCentroids.ts's own
 * CategoryAxis-typed store, since the caller already filters to one axis
 * before calling, see roleEmbeddingRefinement.ts) alongside its own
 * persisted embedding. */
export interface ConfirmedEmbedding {
  category: string
  embedding: number[]
}

// Mirrors categoryCentroids.ts's own MIN_SAMPLES_PER_CATEGORY exactly --
// same reasoning, same value: a category needs at least this many confirmed
// samples before it's trusted enough to suggest from.
const MIN_SAMPLES_PER_CATEGORY = 3

// Mirrors categoryCentroids.ts's own MIN_TRAINED_CATEGORIES_FOR_SUGGESTION,
// added there 2026-09-14 after a real bug: a single trained category force-
// matched every query, since there was nothing to compare it against. Baked
// in here from the start rather than needing the same fix twice -- see this
// plan's own "Important context."
const MIN_CATEGORIES_FOR_SUGGESTION = 2

// The nearest DIFFERENT-category neighbor's cosine similarity must exceed
// the second-nearest DIFFERENT-category neighbor's by at least this much to
// count as a confident suggestion -- same "decline rather than force a
// close call" discipline as categoryCentroids.ts's own CONFIDENCE_RATIO,
// expressed as a similarity gap instead of a distance ratio (cosine
// similarity's own [-1, 1] range doesn't have a natural ratio
// interpretation the way a Euclidean distance ratio does).
const SIMILARITY_MARGIN = 0.05

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA < 1e-10 || normB < 1e-10) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Nearest-neighbor classification for one new stem's embedding, over every
 * OTHER individually confirmed stem's own embedding on the same axis (not a
 * single running centroid per category, unlike categoryCentroids.ts's own
 * suggestCategory -- see this plan's own "Important context" for why a rich
 * learned embedding space benefits from real k-NN). Returns null (not a
 * forced guess) when fewer than MIN_CATEGORIES_FOR_SUGGESTION categories
 * have at least MIN_SAMPLES_PER_CATEGORY confirmed samples, or when the
 * nearest and second-nearest DIFFERENT-category matches are too close to
 * call confidently.
 */
export function suggestCategoryFromEmbedding(
  confirmed: ConfirmedEmbedding[],
  queryEmbedding: number[]
): string | null {
  const countsByCategory = new Map<string, number>()
  for (const c of confirmed) {
    countsByCategory.set(c.category, (countsByCategory.get(c.category) ?? 0) + 1)
  }
  const eligibleCategories = new Set(
    [...countsByCategory.entries()]
      .filter(([, count]) => count >= MIN_SAMPLES_PER_CATEGORY)
      .map(([category]) => category)
  )
  if (eligibleCategories.size < MIN_CATEGORIES_FOR_SUGGESTION) return null

  const eligible = confirmed.filter((c) => eligibleCategories.has(c.category))
  const withSimilarity = eligible
    .map((c) => ({ category: c.category, similarity: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)

  const nearest = withSimilarity[0]
  const nearestOtherCategory = withSimilarity.find((w) => w.category !== nearest.category)
  if (nearestOtherCategory && nearest.similarity - nearestOtherCategory.similarity < SIMILARITY_MARGIN) {
    return null
  }
  return nearest.category
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/embeddingMatch.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/shared/embeddingMatch.ts src/shared/embeddingMatch.test.ts
git commit -m "$(cat <<'EOF'
Add embeddingMatch.ts: pure k-NN suggestion logic over embeddings

Real nearest-neighbor search over every individually confirmed stem's
own embedding, not a single running centroid per category (unlike
categoryCentroids.ts) -- a rich 1024-dim learned embedding space
benefits from real k-NN, unlike the 19-dim hand-crafted feature space
centroids work over. Bakes in the identical "at least 2 trained
categories" guard categoryCentroids.ts's own suggestCategory needed a
real bug fix for this same session (2026-09-14) to get right, applied
here from the very first version instead of needing the same fix
twice.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 13: Main-process confirmed-embeddings query + IPC

**Files:**
- Create: `src/main/embeddingMatch.ts`
- Test: `src/main/embeddingMatch.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Before you start:** re-read `src/main/stemCategoriesStore.ts`'s `StemBusCategoryEntry`/`StemRoleCategoryEntry` interfaces and the `StemCategories` table's real column list fresh (already read this session) — this task's query is a straight SQL JOIN against `StemEmbeddingCache` (Task 3), unlike `categoryCentroidTraining.ts`'s own per-entry lookup loop (that function is triggered per-write, this one is a bulk "give me everything trained so far" read, closer in spirit to `loadCategoryCentroidStore()`'s own "load the whole store" shape).

- [ ] **Step 1: Write the failing test**

Create `src/main/embeddingMatch.test.ts`:
```ts
// src/main/embeddingMatch.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { RIFF_LIBRARY_SCHEMA_SQL } from './riffLibrarySchema'
import { getConfirmedEmbeddings } from './embeddingMatch'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(RIFF_LIBRARY_SCHEMA_SQL)
  return db
}

function seedStem(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO Stems (StemCID, RiffCID, Slot, SoundType, PresetName, FileKey)
     VALUES (?, 'riff1', 1, 'fx', 'test', ?)`
  ).run(stemCID, stemCID)
}

function seedCategory(
  db: Database.Database,
  stemCID: string,
  fields: { busId?: string; arrangeRole?: string; drumSubRole?: string }
): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, BusId, ArrangeRole, DrumSubRole, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @busId, @arrangeRole, @drumSubRole, 'test', NULL, 1000)`
  ).run({
    stemCID,
    busId: fields.busId ?? null,
    arrangeRole: fields.arrangeRole ?? null,
    drumSubRole: fields.drumSubRole ?? null
  })
}

function seedEmbedding(db: Database.Database, stemCID: string, embedding: number[]): void {
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, JSON.stringify(embedding))
}

describe('getConfirmedEmbeddings', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
  })

  it('returns an empty array when nothing is confirmed', () => {
    expect(getConfirmedEmbeddings(db, 'bus')).toEqual([])
  })

  it('only includes stems with BOTH a confirmed category on the axis AND a cached embedding', () => {
    seedStem(db, 'a')
    seedCategory(db, 'a', { busId: 'drums' })
    // No embedding for 'a' yet -- excluded.
    seedStem(db, 'b')
    seedCategory(db, 'b', { busId: 'bass' })
    seedEmbedding(db, 'b', [1, 2, 3])
    seedStem(db, 'c')
    // Embedding but no confirmed bus -- excluded.
    seedEmbedding(db, 'c', [4, 5, 6])

    expect(getConfirmedEmbeddings(db, 'bus')).toEqual([{ category: 'bass', embedding: [1, 2, 3] }])
  })

  it('reads the ArrangeRole column for the arrangeRole axis, DrumSubRole for the drumSubRole axis', () => {
    seedStem(db, 'a')
    seedCategory(db, 'a', { arrangeRole: 'vocal', drumSubRole: undefined })
    seedEmbedding(db, 'a', [1, 0, 0])
    seedStem(db, 'b')
    seedCategory(db, 'b', { arrangeRole: 'drums', drumSubRole: 'kick' })
    seedEmbedding(db, 'b', [0, 1, 0])

    expect(getConfirmedEmbeddings(db, 'arrangeRole')).toEqual(
      expect.arrayContaining([
        { category: 'vocal', embedding: [1, 0, 0] },
        { category: 'drums', embedding: [0, 1, 0] }
      ])
    )
    expect(getConfirmedEmbeddings(db, 'drumSubRole')).toEqual([
      { category: 'kick', embedding: [0, 1, 0] }
    ])
  })

  it('checks extraCandidateDbs for stems that live in an external LORE archive', () => {
    const externalDb = makeDb()
    seedStem(externalDb, 'ext1')
    seedCategory(externalDb, 'ext1', { busId: 'lead' })
    seedEmbedding(externalDb, 'ext1', [7, 8, 9])

    expect(getConfirmedEmbeddings(db, 'bus')).toEqual([])
    expect(getConfirmedEmbeddings(db, 'bus', [externalDb])).toEqual([
      { category: 'lead', embedding: [7, 8, 9] }
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/embeddingMatch.test.ts`
Expected: FAIL — `src/main/embeddingMatch.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/main/embeddingMatch.ts`:
```ts
// src/main/embeddingMatch.ts
import type Database from 'better-sqlite3'
import type { ConfirmedEmbedding } from '@shared/embeddingMatch'
import type { CategoryAxis } from '@shared/categoryCentroids'

// Reuses categoryCentroids.ts's own CategoryAxis rather than a second,
// structurally-identical local type -- one axis union for the whole
// classifier system, so a future new axis can't be added to one and
// forgotten in the other.
const COLUMN_FOR_AXIS: Record<CategoryAxis, string> = {
  bus: 'BusId',
  arrangeRole: 'ArrangeRole',
  drumSubRole: 'DrumSubRole'
}

/** Every confirmed stem on the given axis that ALSO has a cached embedding
 * -- a bulk read (real SQL JOIN, not the per-entry lookup loop
 * categoryCentroidTraining.ts's own training functions use, since this is
 * "give me everything trained so far," closer in spirit to
 * loadCategoryCentroidStore()'s own "load the whole store" shape) feeding
 * embeddingMatch.ts's (src/shared/) own suggestCategoryFromEmbedding.
 * `db` is checked first, then each of `extraCandidateDbs` in order -- same
 * convention as every other StemCategories/StemFeatureCache reader in this
 * codebase (stemCategoriesStore.ts's own stemCIDForPath). */
export function getConfirmedEmbeddings(
  db: Database.Database,
  axis: CategoryAxis,
  extraCandidateDbs: Database.Database[] = []
): ConfirmedEmbedding[] {
  const column = COLUMN_FOR_AXIS[axis]
  const results: ConfirmedEmbedding[] = []
  for (const candidateDb of [db, ...extraCandidateDbs]) {
    const rows = candidateDb
      .prepare(
        `SELECT c.${column} AS category, e.EmbeddingJSON AS embeddingJson
         FROM StemCategories c
         JOIN StemEmbeddingCache e ON e.StemCID = c.StemCID
         WHERE c.${column} IS NOT NULL`
      )
      .all() as { category: string; embeddingJson: string }[]
    for (const row of rows) {
      try {
        results.push({ category: row.category, embedding: JSON.parse(row.embeddingJson) as number[] })
      } catch {
        // Corrupted row -- skip rather than throw, same defensive handling
        // as stemEmbeddingCacheStore.ts's own getStemEmbeddingCache.
      }
    }
  }
  return results
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/embeddingMatch.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Wire the IPC handler**

In `src/main/index.ts`, add the import:
```ts
import { getConfirmedEmbeddings } from './embeddingMatch'
```

Add the handler, near `get-category-centroids`:
```ts
  ipcMain.handle(
    'get-confirmed-embeddings',
    (_event, axis: CategoryAxis): ConfirmedEmbedding[] =>
      getConfirmedEmbeddings(openOwnRiffLibraryDb(), axis, candidateDbsForRiff())
  )
```

Add the `ConfirmedEmbedding`/`CategoryAxis` type imports alongside the other `@shared` imports in `index.ts` (note `CategoryAxis` may already be imported there from Plan B1's own work — check before adding a duplicate import):
```ts
import type { ConfirmedEmbedding } from '@shared/embeddingMatch'
import type { CategoryAxis } from '@shared/categoryCentroids'
```

- [ ] **Step 6: Expose in preload**

In `src/preload/index.ts`, add near `getCategoryCentroids`:
```ts
  getConfirmedEmbeddings: (axis: CategoryAxis): Promise<ConfirmedEmbedding[]> =>
    ipcRenderer.invoke('get-confirmed-embeddings', axis),
```

(Import `ConfirmedEmbedding` from `@shared/embeddingMatch` and `CategoryAxis` from `@shared/categoryCentroids` alongside preload's other shared-type imports — `CategoryAxis` may already be imported there from Plan B1's own `getCategoryCentroids`.)

- [ ] **Step 7: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/main/embeddingMatch.ts src/main/embeddingMatch.test.ts src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Add getConfirmedEmbeddings + get-confirmed-embeddings IPC

Bulk SQL JOIN of StemCategories against StemEmbeddingCache, one axis
at a time -- "give me everything trained so far" for
embeddingMatch.ts's (src/shared/) own nearest-neighbor search,
fetched once per mount by the screens that consume it (a later task),
same frozen-snapshot pattern as getCategoryCentroids.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 14: Compose embedding-preferred, centroid-fallback role refinement

**Files:**
- Create: `src/shared/roleEmbeddingRefinement.ts`
- Test: `src/shared/roleEmbeddingRefinement.test.ts`

**Before you start:** re-read `src/shared/roleCentroidRefinement.ts` fresh (already read/edited this session) — this task's function WRAPS it rather than duplicating its logic: try the embedding match first, fall back to the existing centroid refinement unchanged when the embedding has nothing confident to say (no embedding extracted yet, or embeddingMatch itself declines to guess).

- [ ] **Step 1: Write the failing tests**

Create `src/shared/roleEmbeddingRefinement.test.ts`:
```ts
// src/shared/roleEmbeddingRefinement.test.ts
import { describe, expect, it } from 'vitest'
import { refineRoleWithEmbeddingOrCentroidSuggestion } from './roleEmbeddingRefinement'
import { resolveStemRole } from './stemRole'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from './categoryCentroids'
import type { ConfirmedEmbedding } from './embeddingMatch'
import type { Stem } from './types'

function fakeStem(overrides: Partial<Stem> = {}): Stem {
  return {
    slot: 1,
    author: 'someone',
    name: 'untitled',
    type: 'fx',
    path: '/lib/some-stem',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('refineRoleWithEmbeddingOrCentroidSuggestion', () => {
  it('leaves a role with a confirmed busId completely untouched', () => {
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', 'drums')
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      [1, 0, 0],
      emptyCategoryCentroidStore(),
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: [] }
    )
    expect(refined).toEqual(role)
  })

  it('prefers a confident embedding match over the centroid classifier', () => {
    let centroidStore = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(centroidStore, 'arrangeRole', 'bass', new Array(19).fill(0))
    }
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(centroidStore, 'arrangeRole', 'lead', new Array(19).fill(50))
    }
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      new Array(19).fill(0), // would match 'bass' via the centroid classifier
      centroidStore,
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: [] },
      [1, 0, 0] // but this embedding confidently matches 'vocal'
    )
    expect(refined.arrangeRole).toBe('vocal')
  })

  it('falls back to the centroid classifier when there is no embedding yet', () => {
    let centroidStore = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(centroidStore, 'arrangeRole', 'bass', new Array(19).fill(0))
    }
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(centroidStore, 'arrangeRole', 'lead', new Array(19).fill(50))
    }
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      new Array(19).fill(0),
      centroidStore,
      { arrangeRoles: [], drumSubRoles: [] },
      null // no embedding extracted yet for this stem
    )
    expect(refined.arrangeRole).toBe('bass')
  })

  it('falls back to the centroid classifier when the embedding match declines to guess', () => {
    let centroidStore = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(centroidStore, 'arrangeRole', 'bass', new Array(19).fill(0))
    }
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(centroidStore, 'arrangeRole', 'lead', new Array(19).fill(50))
    }
    // Only one embedding-trained category -- suggestCategoryFromEmbedding
    // declines (same guard as categoryCentroids.ts's own fix).
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      new Array(19).fill(0),
      centroidStore,
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: [] },
      [1, 0, 0]
    )
    expect(refined.arrangeRole).toBe('bass')
  })

  it('also suggests a drumSubRole from embeddings when the embedding-suggested arrangeRole is drums', () => {
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] }
    ]
    const confirmedDrumSubRoles: ConfirmedEmbedding[] = [
      { category: 'kick', embedding: [0, 1, 0] },
      { category: 'kick', embedding: [0, 1, 0] },
      { category: 'kick', embedding: [0, 1, 0] },
      { category: 'snare', embedding: [0, 0, 1] },
      { category: 'snare', embedding: [0, 0, 1] },
      { category: 'snare', embedding: [0, 0, 1] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      null,
      emptyCategoryCentroidStore(),
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: confirmedDrumSubRoles },
      [0, 1, 0]
    )
    expect(refined.arrangeRole).toBe('drums')
    expect(refined.drumSubRole).toBe('kick')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/roleEmbeddingRefinement.test.ts`
Expected: FAIL — `roleEmbeddingRefinement.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/shared/roleEmbeddingRefinement.ts`:
```ts
// src/shared/roleEmbeddingRefinement.ts
import type { StemRoleInfo, ArrangeRole, DrumSubRole } from './stemRole'
import { refineRoleWithCentroidSuggestion } from './roleCentroidRefinement'
import { suggestCategoryFromEmbedding, type ConfirmedEmbedding } from './embeddingMatch'
import type { CategoryCentroidStore } from './categoryCentroids'

/** Every axis's own confirmed-embeddings list this function needs -- fetched
 * once per mount (get-confirmed-embeddings IPC, one call per axis) by a
 * caller, same frozen-snapshot pattern as centroidStore. */
export interface ConfirmedEmbeddingsByAxis {
  arrangeRoles: ConfirmedEmbedding[]
  drumSubRoles: ConfirmedEmbedding[]
}

/** Composes embeddingMatch.ts's own suggestCategoryFromEmbedding with the
 * already-shipped roleCentroidRefinement.ts's refineRoleWithCentroidSuggestion
 * -- embedding-based match preferred whenever this stem's embedding has
 * already been extracted AND embeddingMatch has something confident to say,
 * Plan B1's centroid classifier as the fallback otherwise (no embedding yet,
 * or embeddingMatch itself declines to guess). Same "only overrides when
 * busId is null" and "never forces a guess when uncertain" shape as the
 * function it wraps -- this is a stronger signal source slotted into the
 * SAME priority chain, not a redesign of it (design spec §7's own framing).
 *
 * `embedding` is null for a stem that hasn't been extracted yet (the normal
 * case for a while after a fresh library sync, since extraction is ambient
 * and throttled -- see BackgroundFeatureScan.tsx) -- falls straight through
 * to the centroid path with no special-casing needed here. */
export function refineRoleWithEmbeddingOrCentroidSuggestion(
  role: StemRoleInfo,
  rawFeatureVector: number[] | null,
  centroidStore: CategoryCentroidStore,
  confirmedEmbeddings: ConfirmedEmbeddingsByAxis,
  embedding: number[] | null = null
): StemRoleInfo {
  if (role.busId !== null) return role

  if (embedding) {
    const suggestedArrangeRole = suggestCategoryFromEmbedding(
      confirmedEmbeddings.arrangeRoles,
      embedding
    ) as ArrangeRole | null
    if (suggestedArrangeRole) {
      const drumSubRole =
        suggestedArrangeRole === 'drums'
          ? ((suggestCategoryFromEmbedding(confirmedEmbeddings.drumSubRoles, embedding) as
              | DrumSubRole
              | null) ?? undefined)
          : undefined
      return { ...role, arrangeRole: suggestedArrangeRole, drumSubRole, uncertain: false }
    }
  }

  return refineRoleWithCentroidSuggestion(role, rawFeatureVector, centroidStore)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/roleEmbeddingRefinement.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/shared/roleEmbeddingRefinement.ts src/shared/roleEmbeddingRefinement.test.ts
git commit -m "$(cat <<'EOF'
Add roleEmbeddingRefinement.ts: embedding-preferred, centroid-fallback

Composes embeddingMatch.ts's suggestCategoryFromEmbedding with the
already-shipped refineRoleWithCentroidSuggestion (Plan B1) rather than
duplicating its logic -- embedding match preferred whenever a stem's
embedding has been extracted and embeddingMatch has something
confident to say, the existing centroid classifier as the fallback
otherwise. Same "only overrides when busId is null, never forces a
guess" shape as the function it wraps.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 15: Wire embedding-preferred suggestions into Tidy Up and Auto-Arrange

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeRoleStep.tsx`
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`

**Before you start:** re-read BOTH files fresh (each has been touched multiple times this same session — AutoArrangeRoleStep.tsx most recently for its own centroid-refinement wiring, ClusterStemsBrowser.tsx for the 8-category picker and modal width) — confirm the exact current shape of each before editing rather than trusting this plan's own quoted snippets verbatim, since line numbers and surrounding code may have shifted again since this plan was written.

- [ ] **Step 1: Wire into AutoArrangeRoleStep.tsx**

Add the new imports alongside the existing `@shared/categoryCentroids`/`@shared/roleCentroidRefinement` ones:
```ts
import { useCachedStemEmbeddings } from '../audio/useCachedStemEmbeddings'
import { refineRoleWithEmbeddingOrCentroidSuggestion } from '@shared/roleEmbeddingRefinement'
import type { ConfirmedEmbedding } from '@shared/embeddingMatch'
```

Add state + a mount-once fetch for BOTH axes' confirmed embeddings, right alongside the existing `centroidStore` state/effect:
```ts
  const [confirmedArrangeRoleEmbeddings, setConfirmedArrangeRoleEmbeddings] = useState<
    ConfirmedEmbedding[]
  >([])
  const [confirmedDrumSubRoleEmbeddings, setConfirmedDrumSubRoleEmbeddings] = useState<
    ConfirmedEmbedding[]
  >([])
  useEffect(() => {
    void window.rifffApi.getConfirmedEmbeddings('arrangeRole').then(setConfirmedArrangeRoleEmbeddings)
    void window.rifffApi.getConfirmedEmbeddings('drumSubRole').then(setConfirmedDrumSubRoleEmbeddings)
  }, [])
```

Add the non-blocking cached-embedding read, alongside the existing `useStemFeatureScan(scanItems)` call:
```ts
  const embeddingByKey = useCachedStemEmbeddings(scanItems)
```

In the role-resolution `useEffect`, replace the `refineRoleWithCentroidSuggestion` call:
```ts
      return refineRoleWithCentroidSuggestion(base, raw, centroidStore)
```
with:
```ts
      return refineRoleWithEmbeddingOrCentroidSuggestion(
        base,
        raw,
        centroidStore,
        { arrangeRoles: confirmedArrangeRoleEmbeddings, drumSubRoles: confirmedDrumSubRoleEmbeddings },
        embeddingByKey.get(key) ?? null
      )
```

Add `embeddingByKey`, `confirmedArrangeRoleEmbeddings`, `confirmedDrumSubRoleEmbeddings` to that effect's own dependency array (alongside the existing `centroidStore`/`featuresByKey` entries).

- [ ] **Step 2: Wire into ClusterStemsBrowser.tsx's own bus-axis suggestion**

Add the imports:
```ts
import { useCachedStemEmbeddings } from '../audio/useCachedStemEmbeddings'
import { suggestCategoryFromEmbedding, type ConfirmedEmbedding } from '@shared/embeddingMatch'
```

Add state + mount-once fetch, alongside the existing `centroidStoreSnapshot` state/effect:
```ts
  const [confirmedBusEmbeddings, setConfirmedBusEmbeddings] = useState<ConfirmedEmbedding[]>([])
  useEffect(() => {
    void window.rifffApi.getConfirmedEmbeddings('bus').then(setConfirmedBusEmbeddings)
  }, [])
```

Add the non-blocking cached-embedding read, alongside the existing `useStemFeatureScan(scanItems)` call:
```ts
  const embeddingByKey = useCachedStemEmbeddings(scanItems)
```

In `partitioned`'s own suggestion computation, find:
```ts
      const suggestedBus = raw
        ? (suggestCategory(centroidStoreSnapshot, 'bus', raw) as BusId | null)
        : null
```
Replace with:
```ts
      const embedding = embeddingByKey.get(stem.key)
      const embeddingSuggestedBus = embedding
        ? (suggestCategoryFromEmbedding(confirmedBusEmbeddings, embedding) as BusId | null)
        : null
      const suggestedBus =
        embeddingSuggestedBus ?? (raw ? (suggestCategory(centroidStoreSnapshot, 'bus', raw) as BusId | null) : null)
```

Add `embeddingByKey`, `confirmedBusEmbeddings` to `partitioned`'s own `useMemo` dependency array (alongside the existing `computed`/`busOf`/`centroidStoreSnapshot` entries).

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AutoArrangeRoleStep.tsx src/renderer/src/components/ClusterStemsBrowser.tsx
git commit -m "$(cat <<'EOF'
Wire embedding-preferred suggestions into Tidy Up and Auto-Arrange

Both screens now fetch their relevant axis' confirmed embeddings once
per mount (same frozen-snapshot pattern as centroidStoreSnapshot) and
read whatever's already cached for their own stems via
useCachedStemEmbeddings (never blocking on extraction). An embedding
match, when confident, now ranks above the centroid classifier in
both Auto-Arrange's role-confirmation step and Tidy Up's own bus
auto-slot suggestions -- Plan B1's classifier stays the fallback for
any stem whose embedding hasn't been extracted yet.

Needs Elling's own manual walkthrough: with a library that has some
extracted embeddings (give BackgroundFeatureScan a few minutes on a
placed project), confirm both screens' suggestions look at least as
good as before, and ideally noticeably better once embeddings have
had time to accumulate real confirmed samples on each axis.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 16: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass, including every new file from Tasks 3, 12, 13, 14.

- [ ] **Step 4: Grep for any stray direct Worker construction**

Run: `grep -rn "new Worker(" src/renderer/src/ | grep -v yamnetClient.ts`
Expected: no matches — `yamnetClient.ts` should be the ONLY place that constructs the worker; every other module goes through its exported functions.

- [ ] **Step 5: Confirm the vendored model and WASM runtime are actually present for a real walkthrough**

Run: `ls -la resources/yamnet/yamnet.onnx src/renderer/public/onnxruntime/`
Expected: both exist (Tasks 1 and 5's own vendor scripts, run once already earlier in this plan's execution). If either is missing (e.g. this plan was executed across multiple sessions and a fresh checkout lost the gitignored files), re-run `./scripts/vendor-yamnet.sh` and `npm run vendor:onnxruntime-wasm` before Step 6.

- [ ] **Step 6: Write the manual-walkthrough summary for Elling**

Post a summary (not a file — just the session's own final message) listing exactly what needs a real, interactive walkthrough before this is considered done:

1. **First-time model load**: open `npm run dev`, open either Tidy Up or Auto-Arrange's role step on a project with a few stems, and check the browser devtools console for any `yamnetClient`/`yamnetWorker` errors (model load failure, WASM path issues). This is the single riskiest part of this whole plan to get exactly right without live testing — real errors here (a 404 on the WASM files, a CORS/CSP issue loading them under Electron's `file://`/custom-scheme renderer, an `InferenceSession.create` failure) are plausible and need to surface here, not silently.
2. **Extraction actually happening**: leave a project with several placed stems open for a minute or two (giving `BackgroundFeatureScan`'s own throttled batches time to run), then check `resources/yamnet/` isn't involved but rather confirm real rows exist: `sqlite3 ~/Music/sssketch/library/cache/common/warehouse.db3 "SELECT COUNT(*) FROM StemEmbeddingCache;"` should grow over time.
3. **Suggestion quality once embeddings accumulate**: this needs real usage over time (confirming roles in Tidy Up/Auto-Arrange trains BOTH the centroid store and now embeddings' own confirmed-samples pool) — after enough real confirmations exist on at least 2 categories per axis, check whether embedding-based suggestions in Confirm Stem Roles/Tidy Up look meaningfully better than what Plan B1's classifier alone was producing.
4. **Packaged-build path resolution**: this plan's `yamnetModel.ts`/WASM-path handling follows established dev-vs-packaged patterns (`demoRifff.ts`, rubberband) closely, but a real packaged build (`npm run build:mac` or similar) is the only way to confirm `process.resourcesPath`-relative paths and the WASM runtime's own static-asset paths actually resolve correctly once bundled — flag this explicitly as unverified until a real packaged build is tested.
5. **Cold start**: on a fresh/mostly-untrained library (fewer than 2 categories with 3+ embedding samples on a given axis), confirm nothing errors and suggestions fall back to Plan B1's classifier (or further, to PresetName/SoundType) exactly as before this plan.

- [ ] **Step 7: No commit for this task** (verification only — nothing to commit unless Step 1-4 surfaces something to fix, in which case fix it and commit as its own small fix).
