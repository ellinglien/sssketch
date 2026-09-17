# Stem Classification: Free Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve stem sound-type/arrange-role classification accuracy (which Discover's role matching depends on) using signals that already exist for free — Endlesss's own performer-set metadata and an already-vendored pretrained model's unused second output — instead of asking Elling to manually annotate more stems in Tidy Up.

**Architecture:** Three independent, additive signals feed the existing classification pipeline without changing its read-side precedence (`resolveStemArrangeRole.ts`: StemCategories → StemAutoCategory → blunt fallback, untouched):
1. A tiny, safe addition to the existing PresetName lookup table.
2. A new backfill that writes Instrument-mask-derived `drums`/`bass` labels into `StemCategories` (tagged with a new `Source: 'instrumentMask'`, mirroring the existing `Source: 'backfill'` precedent) — this both directly resolves those specific stems AND feeds both existing trained classifiers (the DSP-feature centroid classifier and the YAMNet-embedding k-NN classifier) far more training data than today's 56/11 human-confirmed examples.
3. A new read of YAMNet's already-computed-but-discarded `output_0` (521/527-class AudioSet scores) alongside the `output_1` embedding already extracted per stem, mapped through a small, real, hand-verified class→ArrangeRole table, written as a new `StemAutoCategory` `Source: 'yamnet-zeroshot'` — a genuinely training-data-independent signal, strongest exactly where Elling's own human-confirmed data is weakest (vocal: 2 examples).

**Tech Stack:** TypeScript (main + renderer + shared), better-sqlite3, onnxruntime-web (existing YAMNet ONNX model, already vendored).

---

## Real data this plan is grounded in

Gathered directly from Elling's own live library (`~/Music/sssketch/library/cache/common/warehouse.db3`, 52,493 stems) during this session's conversation — re-verify if anything looks stale, but this was accurate as of 2026-09-17:

- `StemCategories` (real human confirmations via Tidy Up/Auto Arrange): 203 rows total, badly imbalanced — drums 56, lead 30, bass 11, backing 8, aux 7, textureFx 4, vocal 2.
- `StemAutoCategory` (existing embedding/centroid classifiers, trained only from those 203 rows): 34,872 `'embedding'`-source rows, 760 `'centroid'`-source rows.
- Instrument bitmask (`src/shared/riffLibraryTypes.ts`'s `instrumentMaskToSoundType`: bit1=drums, bit2=notes/melodic, bit3=bass, bit4=audioIn) is set on 49,440/52,493 stems (94%). Real single-bit counts: drums 13,705, notes 8,342, bass 5,673, audioIn 28,681; only 3,053 stems have no bit set at all.
- **The single biggest classification gap found:** `resolveStemArrangeRole.ts`'s fallback chain is `instrumentMaskToSoundType(mask) ?? guessSoundTypeFromPresetName(name)` — PresetName is *only* consulted when mask returns null. All 8,342 "notes"-masked stems therefore go straight to `SoundType 'notes' → ArrangeRole 'lead'` (the blunt `SOUND_TYPE_TO_ARRANGE_ROLE` mapping) with **zero further refinement**, regardless of preset name. A direct query confirmed 6,251 of those 8,342 have neither a `StemCategories` nor a `StemAutoCategory` row — they are all silently defaulted to `'lead'` today even when they're actually backing/aux/fill/textureFx. This plan does not fix that precedence gap directly (see Out of Scope) — it improves the trained classifiers' own data so they classify more of that backlog correctly *before* it ever reaches the blunt fallback.
- The PresetName table (`src/shared/presetNames.ts`, ~236 real entries) matches only 46.5% of the 45,354 stems with a PresetName set. Cross-tabulating the biggest "unmatched" names against Instrument mask showed most are a red herring (already 100%-consistently mask-classified — e.g. `Mainline`/`Trap`/`Classic House`/`Acoustic Jazz` are all 100% Instrument-mask-bit-2/drums; `Audio In` is 100% mask-bit-16/audioIn). The genuinely PresetName-only-reachable group (mask fully unset, ~3,053 stems) is dominated by generic effect-processor names (`Lowpass`, `Delay`, `Keymasher`, `Reverb`...) that reflect the last-applied FX chain, not the underlying instrument — unsafe to hand-map by name alone. Scope for this plan is intentionally narrow here: one safe, small addition (Task 1), not a bulk table expansion.
- `resources/yamnet/yamnet.onnx` (already vendored, Apache-2.0, `scripts/vendor-yamnet.sh`) exports three outputs per frame: `output_0` (class scores), `output_1` (1024-dim embedding — the only one read today, in `src/renderer/src/audio/yamnetWorker.ts`), `output_2` (64-dim log-mel). `output_0` costs nothing extra to read — the forward pass already runs per stem for the embedding.

## Out of scope for this plan

- Fixing the "notes bucket defaults to lead" precedence gap directly (letting PresetName/embeddings override a non-null mask result) — a real, separate architectural decision Elling hasn't been asked about yet. This plan's tasks are an emergent partial mitigation (better-trained classifiers catch more of that backlog *before* the blunt fallback runs), not a fix.
- Bulk-expanding the PresetName lookup table beyond the one safe addition in Task 1.
- External datasets (MUSDB18 etc.) — discussed and explicitly deferred.
- Any change to the real Tidy Up/Auto Arrange human-confirmation UI or flow.
- Retraining or replacing YAMNet itself — this plan only reads a second output tensor the model already computes.

---

### Task 1: Add "Audio In" to the PresetName lookup table

**Files:**
- Modify: `src/shared/presetNames.ts`
- Test: `src/shared/presetNames.test.ts`

- [ ] **Step 1: Read the current file to confirm exact current state**

Read `src/shared/presetNames.ts` fresh (its line numbers may have drifted since this plan was written) and confirm `AUDIO_IN_PRESET_NAMES` still reads exactly `const AUDIO_IN_PRESET_NAMES = ['Microphone']`. If it doesn't match, STOP and escalate rather than guessing — the corpus is a deliberately hand-curated, real, screenshot-verified list (see the file's own top doc comment), not something to bulk-edit blind.

- [ ] **Step 2: Write the failing test**

Check `src/shared/presetNames.test.ts` first for its existing test structure/imports (likely already tests `guessSoundTypeFromPresetName`/`guessArrangeRoleFromPresetName` for `'Microphone'`). Add:

```ts
it('recognizes "Audio In", the literal preset name Endlesss gives most live-recorded stems', () => {
  expect(guessSoundTypeFromPresetName('Audio In')).toBe('audioIn')
})

it('is case-insensitive for "Audio In"', () => {
  expect(guessSoundTypeFromPresetName('audio in')).toBe('audioIn')
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/shared/presetNames.test.ts`
Expected: FAIL — `guessSoundTypeFromPresetName('Audio In')` currently returns `null`.

- [ ] **Step 4: Add the one entry**

In `src/shared/presetNames.ts`, change:

```ts
const AUDIO_IN_PRESET_NAMES = ['Microphone']
```

to:

```ts
// 'Audio In' added 2026-09-17: the single most common PresetName in
// Elling's own real library (12,686 of 45,354 named stems, ~28%) --
// verified 100% consistent with Endlesss's own Instrument bitmask bit 4
// (audioIn) wherever it co-occurs, so this is a correct, safe addition,
// not a guess. Mostly redundant with instrumentMaskToSoundType's own
// audioIn-bit check (mask is checked first in every real fallback chain
// -- see resolveStemArrangeRole.ts) -- this specifically helps the
// smaller remainder: stems whose mask is inconsistent/unset but whose
// PresetName is still this literal string, plus any future import path
// that only ever has PresetName to go on (drag-and-drop imports, see
// this file's own top doc comment).
const AUDIO_IN_PRESET_NAMES = ['Microphone', 'Audio In']
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/shared/presetNames.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/shared/presetNames.ts src/shared/presetNames.test.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/presetNames.ts src/shared/presetNames.test.ts
git commit -m "$(cat <<'EOF'
presetNames: recognize "Audio In", the single most common preset name in real libraries

Verified 100% consistent with Endlesss's own Instrument mask bit 4
(audioIn) against Elling's real 52,493-stem library -- a correct,
data-verified addition, not a guess. 12,686 of 45,354 named stems
(28%) carry this exact literal name.
EOF
)"
```

---

### Task 2: Backfill Instrument-mask-derived drums/bass labels into StemCategories

**Files:**
- Create: `src/main/instrumentMaskCentroidBackfill.ts`
- Test: `src/main/instrumentMaskCentroidBackfill.test.ts`
- Modify: `src/main/index.ts` (wire the new backfill into startup, next to the existing one)

**Context to read first (don't trust this plan's inline code below without re-confirming against the real current file — these are the real signatures as of this plan being written, but re-verify):**
- `src/main/stemCategoriesBackfill.ts` — the direct precedent this task mirrors: reads real data, builds `StemRoleCategoryEntry[]`, calls `upsertStemCategoryRole(db, entries, source, sourceProject, updatedAt, extraCandidateDbs)`, then `trainCentroidsFromRoleEntries(db, entries, extraCandidateDbs)` right after. Same idempotent "safe to call on every app startup" shape this task follows.
- `src/main/stemCategoriesStore.ts`'s `upsertStemCategoryRole` — `entries: StemRoleCategoryEntry[]` where each entry is `{ path: string; arrangeRole: ArrangeRole; drumSubRole?: DrumSubRole }`. Its own `ON CONFLICT ... WHERE excluded.UpdatedAt >= StemCategories.UpdatedAt` guard means it can never regress a newer existing row — safe to call even if eligibility filtering below has any edge-case overlap.
- `src/main/categoryCentroidTraining.ts`'s `trainCentroidsFromRoleEntries(db, entries, extraCandidateDbs)` — same `StemRoleCategoryEntry[]` shape, silently skips any entry whose `StemFeatureCache` isn't populated yet (not an error).
- `src/main/riffLibraryStore.ts`'s `resolveStemPath(jamCID, stemCID): string` — pure string computation, correct even for a stem not yet downloaded locally (no filesystem access).
- `src/main/riffLibraryStore.ts`'s `candidateDbsForRiff()` — already imported and used in `index.ts` right next to the existing backfill call; pass its result through the same way.
- `src/main/riffLibrarySchema.ts`'s `openOwnRiffLibraryDb()`.

- [ ] **Step 1: Write the failing test**

Read `src/main/stemCategoriesBackfill.test.ts` first for the exact `vi.mock('electron', ...)`/`freshDb()` pattern already established for this kind of test, then create `src/main/instrumentMaskCentroidBackfill.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { backfillInstrumentMaskCategories } from './instrumentMaskCentroidBackfill'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY,
      OwnerJamCID TEXT NOT NULL,
      Instrument INTEGER
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
  `)
  return db
}

describe('backfillInstrumentMaskCategories', () => {
  it('writes a drums ArrangeRole for a stem with a clean drums-bit-only mask', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db.prepare(`SELECT ArrangeRole, Source FROM StemCategories WHERE StemCID = ?`).get(
      'stem-drums'
    ) as { ArrangeRole: string; Source: string } | undefined
    expect(row?.ArrangeRole).toBe('drums')
    expect(row?.Source).toBe('instrumentMask')
  })

  it('writes a bass ArrangeRole for a stem with a clean bass-bit-only mask', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-bass', 'jam-1', 8)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db.prepare(`SELECT ArrangeRole FROM StemCategories WHERE StemCID = ?`).get(
      'stem-bass'
    ) as { ArrangeRole: string } | undefined
    expect(row?.ArrangeRole).toBe('bass')
  })

  it('skips a stem whose mask has more than one bit set (ambiguous, not a clean signal)', () => {
    const db = freshDb()
    // drums bit (2) + audioIn bit (16) both set -- ambiguous, must not guess
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-mixed', 'jam-1', 18)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db.prepare(`SELECT * FROM StemCategories WHERE StemCID = ?`).get('stem-mixed')
    expect(row).toBeUndefined()
  })

  it('skips a stem whose mask is a bit this backfill does not touch (notes/audioIn)', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-notes', 'jam-1', 4)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db.prepare(`SELECT * FROM StemCategories WHERE StemCID = ?`).get('stem-notes')
    expect(row).toBeUndefined()
  })

  it('never overwrites an existing StemCategories row, even a low-confidence one', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()
    db.prepare(
      `INSERT INTO StemCategories (StemCID, ArrangeRole, Source, UpdatedAt)
       VALUES ('stem-drums', 'lead', 'tidyup', 1000)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db.prepare(`SELECT ArrangeRole, Source FROM StemCategories WHERE StemCID = ?`).get(
      'stem-drums'
    ) as { ArrangeRole: string; Source: string }
    expect(row.ArrangeRole).toBe('lead')
    expect(row.Source).toBe('tidyup')
  })

  it('is idempotent -- calling it twice in a row does not error or duplicate', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()

    backfillInstrumentMaskCategories(db)
    backfillInstrumentMaskCategories(db)

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM StemCategories`).get() as { n: number }
    ).n
    expect(count).toBe(1)
  })

  it('returns a summary of how many stems it categorized', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-bass', 'jam-1', 8)`
    ).run()

    const summary = backfillInstrumentMaskCategories(db)

    expect(summary.categorizedStems).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/instrumentMaskCentroidBackfill.test.ts`
Expected: FAIL — `./instrumentMaskCentroidBackfill` doesn't exist yet.

- [ ] **Step 3: Read the real current signatures before implementing**

Read `src/main/stemCategoriesStore.ts` (for `upsertStemCategoryRole`'s exact current signature and the `StemRoleCategoryEntry` type export), `src/main/categoryCentroidTraining.ts` (for `trainCentroidsFromRoleEntries`'s exact current signature), and `src/main/riffLibraryStore.ts` (for `resolveStemPath`/`candidateDbsForRiff`'s exact current signatures and import paths). If any has changed shape since this plan was written, adapt the implementation below to match the real current signature rather than the plan's — this is exactly the kind of live, evolving file this codebase's own convention says to re-verify, not trust blindly.

- [ ] **Step 4: Implement**

Create `src/main/instrumentMaskCentroidBackfill.ts`:

```ts
// src/main/instrumentMaskCentroidBackfill.ts
import type Database from 'better-sqlite3'
import { upsertStemCategoryRole, type StemRoleCategoryEntry } from './stemCategoriesStore'
import { trainCentroidsFromRoleEntries } from './categoryCentroidTraining'
import { resolveStemPath, candidateDbsForRiff } from './riffLibraryStore'

export interface InstrumentMaskBackfillSummary {
  categorizedStems: number
}

const DRUMS_BIT = 1 << 1
const BASS_BIT = 1 << 3

interface EligibleStemRow {
  StemCID: string
  OwnerJamCID: string
  Instrument: number
}

/** Backfills Endlesss's own performer-set Instrument bitmask into
 * StemCategories for the two categories that bit reliably, unambiguously
 * identifies -- drums and bass -- as a new, distinct Source ('instrumentMask')
 * so it stays inspectable/reversible and never gets confused with a real
 * human Tidy Up confirmation. Deliberately requires a CLEAN, single-bit
 * mask (exactly the drums bit or exactly the bass bit, nothing else set) --
 * a stem with multiple bits, or with the notes/audioIn bits this backfill
 * doesn't cover, is left alone rather than guessed at.
 *
 * This directly resolves these specific stems no differently than
 * resolveStemArrangeRole.ts's own existing blunt instrumentMaskToSoundType
 * fallback already would (mask is checked first there too) -- the real
 * value is in FEEDING TWO DOWNSTREAM CLASSIFIERS this same StemCategories
 * write already reaches: trainCentroidsFromRoleEntries (below, the DSP-
 * feature centroid classifier) and getConfirmedEmbeddings (embeddingMatch.ts,
 * a live JOIN against StemCategories -- no separate training call needed,
 * it just reads whatever's there) -- vastly more drums/bass reference
 * points than today's 56/11 human-confirmed examples, which should improve
 * classification accuracy for OTHER, harder categories too (a better-
 * calibrated global feature/embedding space, and more confident
 * "definitely not drums/bass" rule-outs).
 *
 * Idempotent and safe to call on every app startup, same convention as
 * backfillStemCategoriesFromProjectLibrary (stemCategoriesBackfill.ts) --
 * upsertStemCategoryRole's own ON CONFLICT guard (never regress a newer
 * existing row) means a stem already covered by ANY source (a real human
 * confirmation, or this same backfill from a previous run) is left
 * untouched; this function's own SQL also excludes anything already in
 * StemCategories up front, so re-running costs one cheap SELECT once the
 * backlog is fully covered. */
export function backfillInstrumentMaskCategories(
  db: Database.Database
): InstrumentMaskBackfillSummary {
  const rows = db
    .prepare(
      `SELECT StemCID, OwnerJamCID, Instrument FROM Stems
       WHERE (Instrument = ? OR Instrument = ?)
       AND NOT EXISTS (SELECT 1 FROM StemCategories c WHERE c.StemCID = Stems.StemCID)`
    )
    .all(DRUMS_BIT, BASS_BIT) as EligibleStemRow[]

  if (rows.length === 0) return { categorizedStems: 0 }

  const entries: StemRoleCategoryEntry[] = rows.map((row) => ({
    path: resolveStemPath(row.OwnerJamCID, row.StemCID),
    arrangeRole: row.Instrument === DRUMS_BIT ? 'drums' : 'bass'
  }))

  const extraCandidateDbs = candidateDbsForRiff()
  const updatedAt = Date.now() / 1000
  upsertStemCategoryRole(db, entries, 'instrumentMask', null, updatedAt, extraCandidateDbs)
  trainCentroidsFromRoleEntries(db, entries, extraCandidateDbs)

  return { categorizedStems: entries.length }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/instrumentMaskCentroidBackfill.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 6: Wire into app startup**

Read `src/main/index.ts` around its existing `backfillStemCategoriesFromProjectLibrary(openOwnRiffLibraryDb())` call (search for that exact string — line numbers may have drifted) and add the new backfill immediately after it, same pattern:

```ts
import { backfillInstrumentMaskCategories } from './instrumentMaskCentroidBackfill'
```

```ts
backfillStemCategoriesFromProjectLibrary(openOwnRiffLibraryDb())
backfillInstrumentMaskCategories(openOwnRiffLibraryDb())
```

- [ ] **Step 7: Typecheck, lint, full test suite**

Run: `npm run typecheck && npx eslint --cache src/main/instrumentMaskCentroidBackfill.ts src/main/instrumentMaskCentroidBackfill.test.ts src/main/index.ts && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/instrumentMaskCentroidBackfill.ts src/main/instrumentMaskCentroidBackfill.test.ts src/main/index.ts
git commit -m "$(cat <<'EOF'
Backfill Instrument-mask-derived drums/bass labels into StemCategories

Endlesss's own performer-set Instrument bitmask reliably, unambiguously
identifies drums (13,705 stems) and bass (5,673 stems) in Elling's real
library -- vastly more than the 56/11 human-confirmed examples the
existing centroid/embedding classifiers train from today. Written as a
new, distinct Source ('instrumentMask') so it stays inspectable and
never overwrites a real human Tidy Up confirmation (upsertStemCategoryRole's
own ON CONFLICT guard, plus an explicit NOT EXISTS pre-filter). Only a
clean, single-bit mask qualifies -- a stem with multiple bits, or bits
this backfill doesn't cover, is left alone.
EOF
)"
```

---

### Task 3: Extract YAMNet's class-score output alongside the existing embedding

**Files:**
- Modify: `src/renderer/src/audio/yamnetWorker.ts`
- Test: `src/renderer/src/audio/yamnetWorker.test.ts` (create if it doesn't already exist)

**Context:** `yamnetWorker.ts`'s `handleInfer` currently reads only `outputs.output_1` (the 1024-dim embedding, mean-pooled across frames by `meanPoolEmbedding`). The vendored model (`resources/yamnet/yamnet.onnx`, confirmed via `scripts/vendor-yamnet.sh`'s own doc comment and by extracting strings from the real local file) also exposes `output_0` (per-frame AudioSet class scores) from the exact same forward pass — reading it costs no extra inference call.

- [ ] **Step 1: Check for an existing test file and its conventions**

Read `src/renderer/src/audio/yamnetWorker.test.ts` if it exists; if not, check a sibling pure-function test in the same directory (e.g. `resampleTo16kMono.test.ts` or `peakCache.test.ts`) for this codebase's own convention for testing small audio-math helpers — these are plain synchronous functions over typed arrays, no worker/model/IPC involved, so they test like any other pure function.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { meanPoolEmbedding, topClassIndexFromScores } from './yamnetWorker'

describe('topClassIndexFromScores', () => {
  it('returns the index with the highest mean score across frames', () => {
    // 2 frames, 4 classes. Frame 0: class 2 highest. Frame 1: class 2 still highest overall once averaged.
    const data = new Float32Array([
      0.1, 0.2, 0.9, 0.05, // frame 0
      0.2, 0.1, 0.8, 0.1 // frame 1
    ])
    expect(topClassIndexFromScores(data, 2, 4)).toBe(2)
  })

  it('returns null for zero frames (a clip too short to produce any analysis window)', () => {
    expect(topClassIndexFromScores(new Float32Array([]), 0, 4)).toBeNull()
  })

  it('handles a single frame', () => {
    const data = new Float32Array([0.9, 0.05, 0.03, 0.02])
    expect(topClassIndexFromScores(data, 1, 4)).toBe(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/audio/yamnetWorker.test.ts`
Expected: FAIL — `topClassIndexFromScores` isn't exported (or doesn't exist) yet.

- [ ] **Step 4: Implement**

In `src/renderer/src/audio/yamnetWorker.ts`, export `meanPoolEmbedding` (currently unexported — add `export` to its existing declaration, purely for this test file to import it too if useful) and add the new function right after it:

```ts
/** Mean-pools YAMNet's own per-frame class-score output (output_0, shape
 * [numFrames, numClasses]) across frames -- same pooling convention as
 * meanPoolEmbedding above, just argmax'd at the end instead of returned as
 * a vector, since a single "what did this clip sound like overall" class
 * guess is all Task 4's own lookup table needs. Returns null for zero
 * frames (a clip too short to produce even one analysis window -- same
 * degenerate case meanPoolEmbedding's own caller, stemEmbeddingCache.ts,
 * already treats as "extraction failed" for the embedding). */
export function topClassIndexFromScores(
  data: Float32Array,
  numFrames: number,
  numClasses: number
): number | null {
  if (numFrames === 0) return null
  const pooled = new Array<number>(numClasses).fill(0)
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * numClasses
    for (let c = 0; c < numClasses; c++) pooled[c] += data[offset + c]
  }
  let bestIndex = 0
  let bestScore = -Infinity
  for (let c = 0; c < numClasses; c++) {
    if (pooled[c] > bestScore) {
      bestScore = pooled[c]
      bestIndex = c
    }
  }
  return bestIndex
}
```

Then, in `handleInfer`, right after the existing `embedding` computation and before `postMessage`, read the second output and compute the top class:

```ts
const scoresOutput = outputs.output_0
const topClassIndex = scoresOutput
  ? topClassIndexFromScores(
      scoresOutput.data as Float32Array,
      scoresOutput.dims[0],
      scoresOutput.dims[1]
    )
  : null
postMessage({ type: 'result', requestId, embedding, topClassIndex })
```

Do NOT throw if `output_0` is missing (unlike the existing `output_1` guard, which throws) — a genuinely missing `output_0` shouldn't break embedding extraction, which is the more important, already-load-bearing feature; `topClassIndex: null` is a normal, handled case downstream (Task 5).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/audio/yamnetWorker.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/audio/yamnetWorker.ts src/renderer/src/audio/yamnetWorker.test.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/audio/yamnetWorker.ts src/renderer/src/audio/yamnetWorker.test.ts
git commit -m "$(cat <<'EOF'
yamnetWorker: extract output_0 (class scores) alongside the existing embedding

The vendored YAMNet model already computes 521/527-class AudioSet
scores per frame on every inference call -- only output_1 (the
embedding) was ever read. Reading output_0 from the same forward pass
costs no extra inference; the result rides along on the existing
'result' message as topClassIndex (null when the clip is too short to
produce any frame). Sets up Task 4/5's zero-shot classification --
this task only extracts the number, doesn't act on it yet.
EOF
)"
```

---

### Task 4: AudioSet class → ArrangeRole lookup and a new StemAutoCategory write path

**Files:**
- Create: `src/shared/audiosetClasses.ts`
- Test: `src/shared/audiosetClasses.test.ts`
- Modify: `src/main/stemAutoCategoryStore.ts` (add `'yamnet-zeroshot'` to `StemAutoCategorySource`)
- Modify: `src/main/index.ts` (new IPC handler)
- Modify: `src/preload/index.ts` (expose it on `rifffApi`)

**Real, verified AudioSet class indices** (fetched and cross-checked this session against the canonical `class_labels_indices.csv`, the standard reference bundled with essentially every published AudioSet/YAMNet-family model): index 27 = "Singing", 28 = "Choir", 142 = "Bass guitar", 162 = "Drum kit", 163 = "Drum machine", 164 = "Drum", 165 = "Snare drum", 166 = "Rimshot", 167 = "Drum roll", 168 = "Bass drum", 171 = "Cymbal", 172 = "Hi-hat", 254 = "Vocal music", 255 = "A capella". Deliberately excludes broader/ambiguous classes that would be unsafe to force-map (e.g. index 0 "Speech" — very often spoken commentary, not a sung vocal take, matching this codebase's own existing "audioIn→vocal is a blunt, often-wrong guess" finding; "Music"/"Musical instrument"/"Synthesizer"/"Electronic music" — too broad to imply any one ArrangeRole).

**IMPORTANT — verify before trusting these indices:** the standard AudioSet ontology this list comes from has 527 classes (528 rows including the CSV header), but `scripts/vendor-yamnet.sh`'s own doc comment describes this specific vendored conversion as having "521 class scores." A 6-class discrepancy could mean this specific tf2onnx conversion trimmed or reordered the ontology. Step 1 below verifies this for real before the lookup table is trusted for anything — do not skip it.

- [ ] **Step 1: Verify the real output_0 class count and ordering against this specific vendored model**

This can't be done from a pure unit test (needs a real model forward pass). Options, in order of preference:
1. If any existing integration/smoke test already runs real YAMNet inference against a real audio fixture (check `src/renderer/src/audio/*.test.ts` for one — may not exist, this model is mostly untested end-to-end per its own doc comments), extend it to log `outputs.output_0.dims` once and confirm `dims[1] === 527` (matching the fetched CSV) or `521` (matching the vendor script's own comment).
2. Otherwise, write a small one-off manual verification script (not committed) that loads `resources/yamnet/yamnet.onnx` via `onnxruntime-node` (add as a temporary devDependency if needed, or use `onnxruntime-web`'s node-compatible wasm backend) and runs one inference against a short silence or noise buffer, logging `output_0`'s shape.
3. If neither is feasible in this environment, at minimum confirm the count via the model's own embedded ONNX graph metadata (`onnx.checker`/`onnx.helper` via a quick Python script with the `onnx` pip package, or a Node ONNX-parsing library) — this doesn't require running inference, just reading the graph's declared output shape for `output_0`.

If the real count is 527 (matches the fetched canonical CSV exactly), proceed with Step 2's indices unchanged. If it's a different count (e.g. 521), **STOP and escalate** — do not assume an offset or a trimmed-from-the-end/start guess; a systematically wrong mapping here silently corrupts real training data (`StemAutoCategory` rows other code reads as ground truth), which is a worse outcome than not shipping this task at all. Report back with the real observed count and dims so the index list can be re-derived correctly (re-fetch `https://raw.githubusercontent.com/qiuqiangkong/audioset_tagging_cnn/master/metadata/class_labels_indices.csv` — or find this specific model's own published label list from its Hugging Face page, `andrelgomes/yamnet-onnx` — and cross-check row count/ordering against whatever the real model reports).

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { arrangeRoleForAudiosetClass } from './audiosetClasses'

describe('arrangeRoleForAudiosetClass', () => {
  it('maps "Drum kit" (index 162) to drums', () => {
    expect(arrangeRoleForAudiosetClass(162)).toBe('drums')
  })

  it('maps "Bass guitar" (index 142) to bass', () => {
    expect(arrangeRoleForAudiosetClass(142)).toBe('bass')
  })

  it('maps "Singing" (index 27) to vocal', () => {
    expect(arrangeRoleForAudiosetClass(27)).toBe('vocal')
  })

  it('returns null for an unmapped/ambiguous class (e.g. "Music", index 137)', () => {
    expect(arrangeRoleForAudiosetClass(137)).toBeNull()
  })

  it('returns null for an out-of-range index', () => {
    expect(arrangeRoleForAudiosetClass(9999)).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/shared/audiosetClasses.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Implement the lookup table**

Create `src/shared/audiosetClasses.ts`:

```ts
// src/shared/audiosetClasses.ts
import type { ArrangeRole } from './stemRole'

/** A small, deliberately narrow subset of AudioSet's ~527-class ontology
 * (the standard ontology YAMNet-family models are trained against -- see
 * yamnetWorker.ts's own output_0 doc comment) mapped to sssketch's own
 * ArrangeRole taxonomy. Only classes confidently, unambiguously implying
 * ONE ArrangeRole are included -- "Music"/"Musical instrument"/
 * "Synthesizer"/"Electronic music" and similar broad classes are
 * deliberately left OUT rather than force-mapped to a guess, same
 * "decline rather than force a close call" discipline as
 * categoryCentroids.ts's own CONFIDENCE_RATIO and embeddingMatch.ts's own
 * SIMILARITY_MARGIN.
 *
 * "Speech" (index 0) is deliberately NOT mapped to vocal -- this
 * codebase's own SOUND_TYPE_TO_ARRANGE_ROLE audioIn->vocal mapping is
 * already documented (stemRole.ts) as an overconfident guess for exactly
 * this reason: live-recorded audio is very often spoken commentary, not a
 * sung take. "Singing"/"Choir"/"Vocal music"/"A capella" are much more
 * specific to an actual musical vocal performance.
 *
 * Indices verified against the canonical AudioSet class_labels_indices.csv
 * (the standard reference bundled with essentially every published
 * AudioSet/YAMNet-family model) AND cross-checked against this specific
 * vendored model's own real output_0 dimension count -- see this plan's
 * own Task 4 Step 1 for how that verification was done; do not add a new
 * entry here without the same real-model verification, index numbers are
 * not something to guess from memory. */
const AUDIOSET_CLASS_TO_ARRANGE_ROLE: Partial<Record<number, ArrangeRole>> = {
  27: 'vocal', // Singing
  28: 'vocal', // Choir
  142: 'bass', // Bass guitar
  162: 'drums', // Drum kit
  163: 'drums', // Drum machine
  164: 'drums', // Drum
  165: 'drums', // Snare drum
  166: 'drums', // Rimshot
  167: 'drums', // Drum roll
  168: 'drums', // Bass drum
  171: 'drums', // Cymbal
  172: 'drums', // Hi-hat
  254: 'vocal', // Vocal music
  255: 'vocal' // A capella
}

export function arrangeRoleForAudiosetClass(classIndex: number): ArrangeRole | null {
  return AUDIOSET_CLASS_TO_ARRANGE_ROLE[classIndex] ?? null
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/shared/audiosetClasses.test.ts`
Expected: PASS

- [ ] **Step 6: Add the new StemAutoCategory source**

Read `src/main/stemAutoCategoryStore.ts` fresh, confirm `export type StemAutoCategorySource = 'embedding' | 'centroid'` still matches, then change to:

```ts
export type StemAutoCategorySource = 'embedding' | 'centroid' | 'yamnet-zeroshot'
```

- [ ] **Step 7: Add the new IPC handler**

Read `src/main/index.ts` around its existing `set-stem-embedding-cache` handler (search for that exact string) for the precise current pattern, then add a new handler right after it:

```ts
import { arrangeRoleForAudiosetClass } from '@shared/audiosetClasses'
import { stemCIDForPath } from './stemCategoriesStore'
import { upsertStemAutoCategory } from './stemAutoCategoryStore'
```

```ts
// Direct counterpart to how the classifier passes in stemAutoClassify.ts
// gate their own writes (BASE_ELIGIBILITY_WHERE): never overwrite an
// existing StemCategories confirmation OR an existing StemAutoCategory
// guess from a DIFFERENT source -- first classifier to claim a stem wins,
// same "no source ever re-evaluates/overrides another source's guess"
// convention already established there.
ipcMain.handle(
  'set-yamnet-zeroshot-category',
  (_event, path: string, audiosetClassIndex: number) => {
    const arrangeRole = arrangeRoleForAudiosetClass(audiosetClassIndex)
    if (!arrangeRole) return
    const db = openOwnRiffLibraryDb()
    const extraCandidateDbs = candidateDbsForRiff()
    const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
    if (!stemCID) return
    const alreadyConfirmed = db
      .prepare(
        `SELECT 1 FROM StemCategories WHERE StemCID = ? AND ArrangeRole IS NOT NULL
         UNION SELECT 1 FROM StemAutoCategory WHERE StemCID = ?`
      )
      .get(stemCID, stemCID)
    if (alreadyConfirmed) return
    upsertStemAutoCategory(db, stemCID, arrangeRole, 'yamnet-zeroshot', Math.floor(Date.now() / 1000))
  }
)
```

Re-verify the exact real signature of `stemCIDForPath` (in `src/main/stemCategoriesStore.ts`) before using it here — it's referenced elsewhere in this plan as `stemCIDForPath(db, path, extraCandidateDbs)`, confirm that still matches.

- [ ] **Step 8: Expose it on rifffApi**

In `src/preload/index.ts`, read around the existing `setStemEmbeddingCache` entry for the exact current pattern, then add right after it:

```ts
setYamnetZeroShotCategory: (path: string, audiosetClassIndex: number): Promise<void> =>
  ipcRenderer.invoke('set-yamnet-zeroshot-category', path, audiosetClassIndex),
```

- [ ] **Step 9: Typecheck, lint, full test suite**

Run: `npm run typecheck && npx eslint --cache src/shared/audiosetClasses.ts src/shared/audiosetClasses.test.ts src/main/stemAutoCategoryStore.ts src/main/index.ts src/preload/index.ts && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/shared/audiosetClasses.ts src/shared/audiosetClasses.test.ts src/main/stemAutoCategoryStore.ts src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Map YAMNet's own class predictions to ArrangeRole, write as a new StemAutoCategory source

A small, deliberately narrow AudioSet-class -> ArrangeRole table
(drums/bass/vocal only -- the classes AudioSet's ontology can
confidently, unambiguously identify) plus a new IPC write path,
gated behind the same "never overwrite an existing confirmation or
guess" eligibility every other classifier pass already uses. This is
a genuinely training-data-independent signal -- pretrained on
AudioSet, not on Elling's own Tidy Up confirmations -- strongest
exactly where his human-confirmed data is weakest (vocal: 2 examples).
EOF
)"
```

---

### Task 5: Wire the zero-shot write into the existing embedding-extraction call site

**Files:**
- Modify: `src/renderer/src/audio/yamnetClient.ts`
- Modify: `src/renderer/src/audio/stemEmbeddingCache.ts`
- Test: `src/renderer/src/audio/stemEmbeddingCache.test.ts` (check if it already exists first)

**Context:** `stemEmbeddingCache.ts`'s `getOrExtractStemEmbedding` is the one real call site that runs YAMNet inference per stem (during the background extraction scan) and persists the result. This is the natural, already-existing integration point for the zero-shot write too — no new scheduling pass needed, it rides along on the same per-stem extraction that already happens once.

- [ ] **Step 1: Read both files fresh**

Re-read `src/renderer/src/audio/yamnetClient.ts` and `src/renderer/src/audio/stemEmbeddingCache.ts` in full before editing — this plan's own code below reflects their real shape as of when this plan was written, but re-confirm before changing anything, especially the exact `ResultMessage`/`pending` map shapes in `yamnetClient.ts`.

- [ ] **Step 2: Check for an existing test file**

Check whether `src/renderer/src/audio/stemEmbeddingCache.test.ts` already exists. If it does, read it fully for its existing mocking convention (likely mocks `window.rifffApi` and `extractEmbedding`/`getAudioContext`/`resampleTo16kMono`) and extend it rather than inventing a new pattern. If it doesn't exist, this step's test below is the first one for this file — mock the same way `stemCategoriesBackfill.test.ts` mocks `electron` (narrow, only what's actually called).

- [ ] **Step 3: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockExtractEmbeddingAndTopClass = vi.fn()
vi.mock('./yamnetClient', () => ({
  extractEmbeddingAndTopClass: (...args: unknown[]) => mockExtractEmbeddingAndTopClass(...args)
}))

const mockGetAudioContext = vi.fn()
vi.mock('./peakCache', () => ({ getAudioContext: () => mockGetAudioContext() }))

vi.mock('./resampleTo16kMono', () => ({ resampleTo16kMono: vi.fn().mockResolvedValue(new Float32Array()) }))

describe('getOrExtractStemEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.rifffApi = {
      getStemEmbeddingCache: vi.fn().mockResolvedValue(null),
      setStemEmbeddingCache: vi.fn().mockResolvedValue(undefined),
      setYamnetZeroShotCategory: vi.fn().mockResolvedValue(undefined),
      readAudioFile: vi.fn().mockResolvedValue(new Uint8Array())
    } as unknown as typeof window.rifffApi
    mockGetAudioContext.mockReturnValue({
      decodeAudioData: vi.fn().mockResolvedValue({})
    })
  })

  it('persists the zero-shot category alongside the embedding when a top class is present', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: 162 })

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    await getOrExtractStemEmbedding('/some/path.wav')

    expect(window.rifffApi.setYamnetZeroShotCategory).toHaveBeenCalledWith('/some/path.wav', 162)
  })

  it('does not call setYamnetZeroShotCategory when topClassIndex is null', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: null })

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    await getOrExtractStemEmbedding('/some/other/path.wav')

    expect(window.rifffApi.setYamnetZeroShotCategory).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/audio/stemEmbeddingCache.test.ts`
Expected: FAIL — `extractEmbeddingAndTopClass` doesn't exist yet, `stemEmbeddingCache.ts` still calls the old `extractEmbedding`/doesn't call `setYamnetZeroShotCategory`.

- [ ] **Step 5: Implement — extend yamnetClient.ts**

In `src/renderer/src/audio/yamnetClient.ts`, change the message/pending shapes and rename the exported function:

```ts
interface ResultMessage {
  type: 'result'
  requestId: number
  embedding: number[]
  topClassIndex: number | null
}
```

```ts
const pending = new Map<
  number,
  {
    resolve: (result: { embedding: number[]; topClassIndex: number | null }) => void
    reject: (err: Error) => void
  }
>()
```

In `getWorker()`'s `onmessage` handler:

```ts
if (msg.type === 'result') {
  pending.get(msg.requestId)?.resolve({ embedding: msg.embedding, topClassIndex: msg.topClassIndex })
  pending.delete(msg.requestId)
}
```

Rename `extractEmbedding` to `extractEmbeddingAndTopClass`, returning the pair instead of just the embedding:

```ts
/** Runs YAMNet inference on one stem's already-decoded, already-16kHz-mono
 * PCM and returns its mean-pooled 1024-dim embedding alongside the
 * top-scoring AudioSet class index (see yamnetWorker.ts's own
 * topClassIndexFromScores). Returns null (never throws) on ANY failure,
 * same "no embedding" contract as before -- every caller already treats
 * that as a normal, expected fallback case, not an error. */
export async function extractEmbeddingAndTopClass(
  pcm: Float32Array
): Promise<{ embedding: number[]; topClassIndex: number | null } | null> {
  try {
    await ensureReady()
  } catch (err) {
    console.error('yamnetClient: model failed to load', err)
    return null
  }
  return new Promise((resolve) => {
    const requestId = nextRequestId++
    pending.set(requestId, {
      resolve: (result) => resolve(result),
      reject: (err) => {
        console.error('yamnetClient: inference failed', err)
        resolve(null)
      }
    })
    const pcmCopy = pcm.slice()
    try {
      getWorker().postMessage({ type: 'infer', requestId, pcm: pcmCopy }, [pcmCopy.buffer])
    } catch (err) {
      console.error('yamnetClient: failed to post infer message', err)
      pending.delete(requestId)
      resolve(null)
    }
  })
}
```

- [ ] **Step 6: Implement — wire into stemEmbeddingCache.ts**

In `src/renderer/src/audio/stemEmbeddingCache.ts`, change the import and the extraction call:

```ts
import { extractEmbeddingAndTopClass } from './yamnetClient'
```

Inside `getOrExtractStemEmbedding`'s async body, replace the `extractEmbedding`/`setStemEmbeddingCache` section:

```ts
const pcm = await resampleTo16kMono(audioBuffer)
const result = await extractEmbeddingAndTopClass(pcm)
if (!result || result.embedding.every((v) => v === 0)) return null

void window.rifffApi.setStemEmbeddingCache(path, result.embedding)
if (result.topClassIndex !== null) {
  void window.rifffApi.setYamnetZeroShotCategory(path, result.topClassIndex)
}
return result.embedding
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/audio/stemEmbeddingCache.test.ts`
Expected: PASS

- [ ] **Step 8: Grep for any other call site of the renamed function**

Run: `grep -rn "extractEmbedding\b" src/renderer/src`
Expected: only the new `extractEmbeddingAndTopClass` name and its one caller (`stemEmbeddingCache.ts`) remain — if anything else still references the old `extractEmbedding` name, update it too.

- [ ] **Step 9: Typecheck, lint, full test suite**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/audio/yamnetClient.ts src/renderer/src/audio/stemEmbeddingCache.ts src/renderer/src/audio/stemEmbeddingCache.test.ts && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/audio/yamnetClient.ts src/renderer/src/audio/stemEmbeddingCache.ts src/renderer/src/audio/stemEmbeddingCache.test.ts
git commit -m "$(cat <<'EOF'
Wire YAMNet's zero-shot class prediction into the existing embedding-extraction call site

getOrExtractStemEmbedding already runs YAMNet inference once per stem
during the background extraction scan -- the zero-shot category write
rides along on that same call (extractEmbeddingAndTopClass, renamed
from extractEmbedding) rather than needing a new scheduling pass.
EOF
)"
```

---

### Task 6: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck, lint, and test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no warnings, all tests pass.

- [ ] **Step 2: Report the manual-walkthrough checklist to Elling**

This environment cannot run the real app, click through Discover, or run a real overnight classify scan against the live 52,493-stem library — say so explicitly, and hand back this checklist for Elling's own hands-on confirmation:

- [ ] Quit and fully relaunch the app (Task 2's backfill runs at startup) — confirm it doesn't hang or visibly slow startup on the real ~52k-stem library.
- [ ] After relaunch, spot-check a few real drum/bass stems in Tidy Up or Discover that were previously unclassified — do they now show a confident role without ever having been manually confirmed?
- [ ] Let the existing overnight classify scan run for a while (per `docs/superpowers/specs/2026-09-15-discover-overnight-classify-scan...`-family features) — confirm no new errors appear in the console related to `set-yamnet-zeroshot-category` or the new backfill.
- [ ] Check a handful of real vocal stems in Discover/Tidy Up afterward — does classification feel noticeably better than before, given vocal was the weakest human-confirmed category (2 examples) and is exactly where the YAMNet zero-shot signal is strongest?
- [ ] Confirm nothing regressed for a stem that already had a real, correct human Tidy Up confirmation (Task 2's own "never overwrite" guarantee, worth a real spot-check not just a unit test).

- [ ] **Step 3: No commit for this task** — it's verification-only, nothing to add.
