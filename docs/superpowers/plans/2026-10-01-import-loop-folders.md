# Import: link loop folders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IMPORT can link folders of loops that live anywhere on disk. Each linked folder appears beside the jams, its subfolders are groups, and each playable file is a stem that can be previewed, multi-selected, tempo-corrected and imported to the shelf as a one-stem loop rifff.

**Architecture:**
- **Pure rules, test-first, in `src/shared/`.**
  - `loopFolderTempo.ts`: the tempo cascade.
  - `loopFolderTree.ts`: the file filter, the format-folder flattening and the group tree.
  - `loopFolderView.ts`: row labels, multi-select and tempo input.
  - `loopFolderTypes.ts`: the wire types.
- **Main process.**
  - `loopFolders.ts`: two own-library tables, `LoopFolders` and `LoopFiles`, with link, unlink, list and tempo override.
  - `loopFolderScan.ts`: an incremental, async, time-budgeted rescan.
  - `loopFolderImport.ts`: import through `importOneShot.ts`'s existing `importLoop`. Non-WAV files go through the native engine's `bake-stem` decoder.
- **IPC.** Seven `loop-folders-*` channels, plus the existing `pick-folder` picker.
- **Renderer.** A `useLoopFolders` hook, plus `LoopFolderSidebar`, `LoopFolderPane` and `LoopTempoCell`, each in its own file. `LibraryBrowser.tsx` only mounts them.
- **Engine.** No changes. It already decodes every format listed.

**Tech Stack:** TypeScript, React 19, Electron 39, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-import-loop-folders-design.md`

**Phase 2 (separate spec, later):** a Discover switch to include linked loops as candidates. Phase 1's data model should not make that harder. See "Phase 2 readiness" below.

---

## Ground rules for whoever executes this

- **Read first:**
  - `CLAUDE.md`
  - `src/renderer/src/styles/tokens.css`. Rules: monochrome chrome, no `border-radius`, lowercase copy, no emoji or exclamation marks, buttons of at most two words, tooltips of 2–3 words.
  - **The guess mark is not a colour.** It is a `~` prefix plus `var(--ra-text-3)`.
- **Staging:** stage explicit paths, never `git add -A`. Other agents may be working in this tree. `native-engine/.cache/` is untracked and not yours.
- **Line numbers:** `LibraryBrowser.tsx` is about 2,500 lines, and line numbers drift. Anchor on the quoted code, and use grep.
- **Order matters.** Tasks 1–7 are additive: new files, plus new exports and handlers. `LibraryBrowser.tsx` is only touched from Task 8. Typecheck stays green after every commit.
- **Main-process SQLite rules.** These are hard-won, and each one caused a real crash or stall.
  - **Never `.iterate()` across an `await`.** Use `.all()`, which closes the statement synchronously, and only `await` between closed statements.
  - **Batch writes.** All of one rescan's writes go in one `db.transaction(...)`.
  - **Yield on a clock, not a count.** Use an 8 ms budget (`LOOP_SCAN_SLICE_BUDGET_MS`), the same as `listLibraryScanTargets` in `src/main/discoverLibraryStems.ts` (commit `5b0a91b`). Count-based yields gave a 102 ms max slice on Elling's USB volume.
  - **USB/ExFAT is slow:** `existsSync` is about 220 µs a call, and a cold `readdirSync` is 626 ms, one uninterruptible syscall. So the folder walk uses `fs/promises` `readdir` and `stat`: the slow part runs on libuv's pool, not the main thread. **No sync `readdir` or `stat` in the scan.** The only sync I/O left is the 4 KB WAV header read, inside the budgeted loop.
  - **better-sqlite3 cannot bind a boolean.** Store `0`/`1`.
- **CI exclusion.** Every new test file that opens a better-sqlite3 database must be added to the `process.env.CI` exclude list in `vitest.config.ts`, in the same task. See that file's comment: a dead worker fails the release with no named test. Files:
  - `loopFolders.test.ts` (Task 4)
  - `loopFolderScan.test.ts` (Task 5)
  - `loopFolderImport.test.ts` (Task 6)
- **Linking never writes into the linked folder.** No sidecars, no caches, no `.baked.wav`. This is why `bakeOffset.ts` is not reused: its `bakedPathFor` writes next to the source. Importing copies into the library, exactly as `+ sample` does today.
- **After every task:**
  - `npm run typecheck` passes.
  - `npx vitest run` passes. Known flakes, which pass alone: `pluginScan.test.ts > … a real installed VST3`, `playbackEngineLifecycle.test.ts`, `stemAutoClassify.test.ts`.
  - `npx eslint <changed files>` shows 0 errors and 0 warnings.
  - `npm run lint` shows the repo baseline: exactly 4 pre-existing prettier warnings, none in your files.
- **No agent can see or hear the app.** Tasks 8–10 end with checks that must be handed to Elling, not claimed.

## Phase 2 readiness (what this plan deliberately does)

- **A stable id for every loop.** `LoopId = 'loop-' + sha1(normalized absolute path)`. Normalized means `path.resolve` plus Unicode NFC. It is unique in `LoopFiles`, carried on every `LoopEntry`, and survives rescans and unlink/relink.
- **The fields Discover would read are real columns:** `DurationSec`, `Bpm`, `Bars`, `TempoSource`, `Irregular` and `OverrideBpm`. They are not packed into JSON.
- **No classification or analysis now.**
- **Where it plugs in later.** The background analysis caches are keyed by `StemCID`:
  - `StemPeaksCache`, `StemFeatureCache`, `StemAutoCategory` and `StemEmbeddingCache`, all through `stemCIDForPath` in `stemCategoriesStore.ts`;
  - `stemCIDForPath` today resolves a path's basename against `Stems`.

  **Choice: fit the keying rather than sit beside it.** Phase 2 extends `stemCIDForPath` with one fallback, `SELECT LoopId FROM LoopFiles WHERE Path = ?`. Then a loop's `LoopId` is its `StemCID` everywhere, and every existing cache, writer and Discover reader works unchanged. The `loop-` prefix keeps it from ever colliding with an Endlesss stem id. A parallel set of loop-keyed cache tables would duplicate every writer and reader for no gain.

## Spec points this plan had to resolve

1. **Non-WAV formats.** `+ sample`'s path (`copyIntoLibrary`) is WAV-only, and main has no duration reader for anything else. The plan handles the other formats in two places:
   - **Listing.** A non-WAV row gets its length from the renderer's own decode. The waveform decodes it anyway, and the length is sent back over `loop-folders-report-duration`.
   - **Import.** Non-WAV files go through the engine's `bake-stem` decode, into the library.
   - **AIFF caveat.** Chromium may not decode AIFF. Such a row can show `? bars`, with no waveform or preview, but it still imports. This is walkthrough step 10.
2. **"Irregular … imported exactly as `+ sample` imports a file today".** `+ sample` (`importDiscoverLoopSeed`) imports every file as a loop at its log-nearest bar count. So an irregular loop is imported by `importLoop` at its nearest bar count, the same as a regular one, and only the mark differs. It is not imported as a one-shot.
3. **Steps 2 and 3 of the cascade.** The folder or siblings tempo is the *prior* for step 3, not the answer, as the spec's step 3 says. A guessed tempo is therefore the tempo the chosen bar count implies, so it always loops whole and is never irregular. Only a filename tempo or a correction can be irregular. `source` records which prior was used.
4. **"Nothing is copied."** That holds while linked. Importing copies into the library, as `+ sample` always has, so a project survives the drive being unplugged.
5. **Unlink** keeps a corrected tempo hidden (`Present = 0`), so relinking the same folder restores it. That matches the spec's "an override for a file that comes back is kept".
6. **Nested links** are refused both ways. `LoopFiles` is keyed by path, so one file under two roots would flip between them.

---

## File map

| file | change |
|---|---|
| `src/shared/loopFolderTempo.ts` | **create**: the tempo cascade (Task 1) |
| `src/shared/loopFolderTempo.test.ts` | **create** (Task 1) |
| `src/shared/loopFolderTree.ts` | **create**: playable filter, format-folder flattening, group tree (Task 2) |
| `src/shared/loopFolderTree.test.ts` | **create** (Task 2) |
| `src/shared/loopFolderTypes.ts` | **create**: wire types and the override range (Task 3) |
| `src/shared/loopFolderView.ts` | **create**: labels, selection (Task 3); `parseTempoInput` (Task 10) |
| `src/shared/loopFolderView.test.ts` | **create** (Task 3); extended (Task 10) |
| `src/main/loopFolders.ts` | **create**: DDL, ids, link/unlink/list/override (Task 4) |
| `src/main/loopFolders.test.ts` | **create** (Task 4) |
| `src/main/riffLibrarySchema.ts` | interpolate `LOOP_FOLDERS_DDL` (Task 4) |
| `src/main/riffLibrarySchema.test.ts` | two more tables in the expected list (Task 4) |
| `vitest.config.ts` | CI exclusions (Tasks 4, 5, 6) |
| `src/main/loopFolderScan.ts` | **create**: walk, rescan, record duration (Task 5) |
| `src/main/loopFolderScan.test.ts` | **create** (Task 5) |
| `src/main/importOneShot.ts` | extract `loopRifff`, add `importLoopViaDecoder` (Task 6) |
| `src/main/importOneShot.test.ts` | tests for `importLoopViaDecoder` (Task 6) |
| `src/main/loopFolderImport.ts` | **create**: `importLinkedLoops`, `withEngineDecoder` (Task 6) |
| `src/main/loopFolderImport.test.ts` | **create** (Task 6) |
| `src/main/index.ts` | seven `loop-folders-*` handlers (Task 7) |
| `src/preload/index.ts` | seven bridge entries (Task 7) |
| `src/renderer/src/state/useLoopFolders.ts` | **create** (Task 8) |
| `src/renderer/src/components/LoopFolderSidebar.tsx` | **create** (Task 8) |
| `src/renderer/src/components/LoopFolderPane.tsx` | **create**, skeleton (Task 8); full pane (Task 9); tempo cell wired (Task 10) |
| `src/renderer/src/components/LoopTempoCell.tsx` | **create** (Task 10) |
| `src/renderer/src/components/LibraryBrowser.tsx` | mount sidebar and pane (Task 8); pass pane props (Task 9) |

## IPC surface (Task 7)

All seven channels open the own library database with `openOwnRiffLibraryDb()`. The folder picker is the existing `pick-folder` (`window.rifffApi.pickFolder()`), reused rather than duplicated.

| channel | preload name | arguments | returns |
|---|---|---|---|
| `loop-folders-list` | `loopFoldersList` | none | `Promise<LoopFolderListing[]>` (cached, no disk walk) |
| `loop-folders-link` | `loopFoldersLink` | `rootPath: string, projectBpm: number` | `Promise<LinkLoopFolderResult>` (links, then scans that folder) |
| `loop-folders-unlink` | `loopFoldersUnlink` | `rootPath: string` | `Promise<void>` |
| `loop-folders-rescan` | `loopFoldersRescan` | `projectBpm: number` | `Promise<LoopFolderListing[]>` (rescans every linked folder) |
| `loop-folders-set-tempo` | `loopFoldersSetTempo` | `loopId: string, bpm: number \| null` | `Promise<LoopEntry \| null>` (`null` bpm clears the correction) |
| `loop-folders-report-duration` | `loopFoldersReportDuration` | `loopId: string, durationSec: number, projectBpm: number` | `Promise<LoopEntry \| null>` |
| `loop-folders-import` | `loopFoldersImport` | `loopIds: string[], projectBpm: number` | `Promise<Rifff[]>` |

---

### Task 1: The tempo cascade (pure, test-first)

**Files:**
- Create: `src/shared/loopFolderTempo.ts`
- Test: `src/shared/loopFolderTempo.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/loopFolderTempo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  barsAtTempo,
  pickBarsNearTempo,
  mostCommonFilenameTempo,
  loopTempo,
  IRREGULAR_TOLERANCE
} from './loopFolderTempo'

/** How long `bars` bars last at `bpm`, in seconds. */
const secs = (bars: number, bpm: number): number => (bars * 240) / bpm

describe('barsAtTempo', () => {
  it('finds the whole power-of-two bar count a length spans at a tempo', () => {
    expect(barsAtTempo(secs(4, 160), 160)).toEqual({ bars: 4, irregular: false })
    expect(barsAtTempo(secs(2, 165), 165)).toEqual({ bars: 2, irregular: false })
    expect(barsAtTempo(secs(1, 90), 90)).toEqual({ bars: 1, irregular: false })
    expect(barsAtTempo(secs(32, 174), 174)).toEqual({ bars: 32, irregular: false })
  })

  it('accepts a length up to 3% off a whole bar count', () => {
    expect(barsAtTempo(secs(4, 160) * 1.029, 160)).toEqual({ bars: 4, irregular: false })
    expect(barsAtTempo(secs(4, 160) * 0.971, 160)).toEqual({ bars: 4, irregular: false })
  })

  it('marks a length that fits no bar count within 3% as irregular, keeping the nearest', () => {
    // 7.0s at 160 is 4.67 bars: nearest is 4, and it is 17% long.
    expect(barsAtTempo(7, 160)).toEqual({ bars: 4, irregular: true })
    // 3 bars sits between 2 and 4; log-nearest is 4 (|ln 0.75| < |ln 1.5|).
    expect(barsAtTempo(secs(3, 120), 120)).toEqual({ bars: 4, irregular: true })
  })

  it('uses a 3% tolerance', () => {
    expect(IRREGULAR_TOLERANCE).toBe(0.03)
  })
})

describe('pickBarsNearTempo', () => {
  it('picks the bar count whose implied tempo is nearest the prior', () => {
    // 4.0s: 1 bar implies 60, 2 bars 120, 4 bars 240.
    expect(pickBarsNearTempo(4, 120)).toBe(2)
    expect(pickBarsNearTempo(4, 70)).toBe(1)
    expect(pickBarsNearTempo(4, 200)).toBe(4)
  })

  it('compares in log space, not raw bpm', () => {
    // Prior 85 on 4.0s: raw distance favours 60 (25 away, against 35),
    // but in log space 120 is nearer (|ln(120/85)| 0.345 < |ln(60/85)| 0.348).
    expect(pickBarsNearTempo(4, 85)).toBe(2)
  })

  it('breaks an exact tie toward the candidate inside 70-180 bpm', () => {
    // 4.0s with a prior of 60*sqrt(2): 60 and 120 are equally far in log space.
    // 120 is inside the range, 60 is not.
    expect(pickBarsNearTempo(4, 60 * Math.SQRT2)).toBe(2)
    // 1.6s with a prior of 150*sqrt(2): 150 and 300 are equally far.
    // 150 is inside, so the tie goes DOWN this time: the range decides, not the size.
    expect(pickBarsNearTempo(1.6, 150 * Math.SQRT2)).toBe(1)
  })
})

describe('mostCommonFilenameTempo', () => {
  it('returns the tempo most names carry', () => {
    expect(
      mostCommonFilenameTempo([
        'Creek Break 160.wav',
        'cw_amen08_165.wav',
        'Crot Break 165.wav',
        'Halftime Dnb Drums 1.wav'
      ])
    ).toBe(165)
  })

  it('breaks a tie toward the lower tempo', () => {
    expect(mostCommonFilenameTempo(['Creek Break 160.wav', 'cw_amen08_165.wav'])).toBe(160)
  })

  it('is null when no name carries a tempo', () => {
    expect(mostCommonFilenameTempo(['Halftime Dnb Drums 1.wav', 'cw_amen_classic.wav'])).toBeNull()
    expect(mostCommonFilenameTempo([])).toBeNull()
  })
})

describe('loopTempo', () => {
  const base = { folderName: 'Amen Breaks Volume 3', siblingFileNames: [], projectBpm: 120 }

  it('step 1: the filename tempo, certain', () => {
    expect(loopTempo({ ...base, fileName: 'Creek Break 160.wav', durationSec: secs(2, 160) })).toEqual(
      { bpm: 160, bars: 2, source: 'filename', irregular: false }
    )
    expect(loopTempo({ ...base, fileName: 'cw_amen08_165.wav', durationSec: secs(2, 165) })).toEqual(
      { bpm: 165, bars: 2, source: 'filename', irregular: false }
    )
  })

  it('step 1 wins over the folder name and the siblings', () => {
    const result = loopTempo({
      fileName: 'Creek Break 160.wav',
      folderName: 'DnB Breaks 170',
      siblingFileNames: ['Crot Break 165.wav', 'Hype Break 165.wav'],
      durationSec: secs(2, 160),
      projectBpm: 120
    })
    expect(result.source).toBe('filename')
    expect(result.bpm).toBe(160)
  })

  it('step 1 with a length that fits no bar count keeps the tempo and is irregular', () => {
    expect(loopTempo({ ...base, fileName: 'Creek Break 160.wav', durationSec: 7 })).toEqual({
      bpm: 160,
      bars: 4,
      source: 'filename',
      irregular: true
    })
  })

  it('step 2: with no tempo in the name, the folder name is the prior', () => {
    // Two bars of halftime at 85 is four bars at 170, the folder's tempo.
    const result = loopTempo({
      fileName: 'Halftime Dnb Drums 1.wav',
      folderName: 'DnB Breaks 170',
      siblingFileNames: ['Creek Break 160.wav'],
      durationSec: secs(2, 85),
      projectBpm: 120
    })
    expect(result.source).toBe('folder')
    expect(result.bars).toBe(4)
    expect(result.bpm).toBeCloseTo(170, 6)
    expect(result.irregular).toBe(false)
  })

  it('step 2: otherwise the siblings’ most common tempo is the prior', () => {
    const result = loopTempo({
      fileName: 'Halftime Dnb Drums 1.wav',
      folderName: 'Amen Breaks Volume 3',
      siblingFileNames: [
        'Creek Break 160.wav',
        'Crot Break 165.wav',
        'Hype Break 165.wav',
        'Halftime Dnb Drums 1.wav'
      ],
      durationSec: secs(4, 165),
      projectBpm: 120
    })
    expect(result.source).toBe('siblings')
    expect(result.bars).toBe(4)
    expect(result.bpm).toBeCloseTo(165, 6)
  })

  it('step 3: nothing named anywhere, so the length decides, near the project tempo', () => {
    const noNames = {
      fileName: 'cw_amen_classic.wav',
      folderName: 'Amen Breaks Volume 2',
      siblingFileNames: ['cw_amen_apache.wav', 'cw_amen_classic.wav'],
      durationSec: 4
    }
    expect(loopTempo({ ...noNames, projectBpm: 120 })).toEqual({
      bpm: 120,
      bars: 2,
      source: 'length',
      irregular: false
    })
    expect(loopTempo({ ...noNames, projectBpm: 70 })).toEqual({
      bpm: 60,
      bars: 1,
      source: 'length',
      irregular: false
    })
  })

  it('step 3 uses the 70-180 tie-break', () => {
    const result = loopTempo({
      fileName: 'cw_amen_classic.wav',
      folderName: 'Amen Breaks Volume 2',
      siblingFileNames: [],
      durationSec: 4,
      projectBpm: 60 * Math.SQRT2
    })
    expect(result).toEqual({ bpm: 120, bars: 2, source: 'length', irregular: false })
  })

  it('a guessed tempo comes from the length, so it always loops whole and is never irregular', () => {
    // 5.1s near a folder tempo of 170: 4 bars implies 188.2.
    const result = loopTempo({
      fileName: 'Halftime Dnb Drums 1.wav',
      folderName: 'DnB Breaks 170',
      siblingFileNames: [],
      durationSec: 5.1,
      projectBpm: 120
    })
    expect(result.bars).toBe(4)
    expect(result.bpm).toBeCloseTo(188.235, 2)
    expect(result.irregular).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/loopFolderTempo.test.ts`
Expected: FAIL, `Cannot find module './loopFolderTempo'` / `Failed to resolve import`.

- [ ] **Step 3: Implement**

Create `src/shared/loopFolderTempo.ts`:

```ts
// src/shared/loopFolderTempo.ts
import { guessBpmFromFilename } from './guessBpmFromFilename'
import { LOOP_BAR_CANDIDATES, bpmForLoopBars } from './loopBarGuess'

/** Where a linked loop's tempo came from. Only 'filename' is certain; the
 * other three are guesses, and the browser shows them as such (a `~` and
 * dimmer text -- never a colour). See docs/superpowers/specs/
 * 2026-10-01-import-loop-folders-design.md, "Tempo: the guess". */
export type LoopTempoSource = 'filename' | 'folder' | 'siblings' | 'length'

export interface LoopTempoInput {
  /** The loop's filename, with or without its extension. */
  fileName: string
  /** The folder it is browsed in, after format folders (WAV/, REX2/ ...) are
   * flattened away -- the folder a person sees, not the one on disk. */
  folderName: string
  /** Every loop's filename in that same folder. May include this loop. */
  siblingFileNames: string[]
  durationSec: number
  /** The open project's tempo: the prior of last resort. */
  projectBpm: number
}

export interface LoopTempo {
  bpm: number
  bars: number
  source: LoopTempoSource
  irregular: boolean
}

/** A length further than this from every whole power-of-two bar count, at
 * the loop's tempo, is irregular: still importable, and marked. */
export const IRREGULAR_TOLERANCE = 0.03

/** The tie-break range: when two bar counts imply tempos equally near the
 * prior, the one whose tempo lies in here wins. */
export const PLAUSIBLE_LOOP_BPM_MIN = 70
export const PLAUSIBLE_LOOP_BPM_MAX = 180

/** Absorbs floating-point noise in an exact log-space tie, such as a prior
 * of 60*sqrt(2) sitting exactly between 60 and 120. */
const TIE_EPSILON = 1e-9

function isPlausibleLoopBpm(bpm: number): boolean {
  return bpm >= PLAUSIBLE_LOOP_BPM_MIN && bpm <= PLAUSIBLE_LOOP_BPM_MAX
}

/** With the tempo known: the whole power-of-two bar count nearest (in log
 * space) to the bars the length really spans, and whether it misses every
 * candidate by more than IRREGULAR_TOLERANCE. */
export function barsAtTempo(durationSec: number, bpm: number): { bars: number; irregular: boolean } {
  const rawBars = (durationSec * bpm) / 240
  let bars = LOOP_BAR_CANDIDATES[0]
  let bestScore = Infinity
  for (const candidate of LOOP_BAR_CANDIDATES) {
    const score = Math.abs(Math.log(rawBars / candidate))
    if (score < bestScore) {
      bestScore = score
      bars = candidate
    }
  }
  return { bars, irregular: Math.abs(rawBars / bars - 1) > IRREGULAR_TOLERANCE }
}

/** With only a prior: the bar count whose implied tempo is log-nearest the
 * prior. This is loopBarGuess.ts's guessLoopBars plus one rule: an exact
 * tie goes to the candidate whose tempo is inside 70-180. guessLoopBars
 * itself is left alone -- the Shelf's import prompt depends on it as is. */
export function pickBarsNearTempo(durationSec: number, priorBpm: number): number {
  let bars = LOOP_BAR_CANDIDATES[0]
  let bestScore = Infinity
  for (const candidate of LOOP_BAR_CANDIDATES) {
    const implied = bpmForLoopBars(durationSec, candidate)
    const score = Math.abs(Math.log(implied / priorBpm))
    const tied = Math.abs(score - bestScore) <= TIE_EPSILON
    const better = tied
      ? isPlausibleLoopBpm(implied) && !isPlausibleLoopBpm(bpmForLoopBars(durationSec, bars))
      : score < bestScore
    if (better) {
      bestScore = score
      bars = candidate
    }
  }
  return bars
}

/** The tempo the most names carry, through the same filename parser. A tie
 * goes to the lower tempo, so the answer never depends on listing order. */
export function mostCommonFilenameTempo(fileNames: string[]): number | null {
  const counts = new Map<number, number>()
  for (const name of fileNames) {
    const bpm = guessBpmFromFilename(name)
    if (bpm !== null) counts.set(bpm, (counts.get(bpm) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [bpm, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && bpm < best)) {
      best = bpm
      bestCount = count
    }
  }
  return best
}

/** The cascade, in the spec's order:
 *
 * 1. The filename (certain). The bar count is then the nearest whole
 *    power of two the length spans at that tempo, irregular past 3%.
 * 2. The folder name's tempo, else the siblings' most common tempo -- a
 *    PRIOR, not the answer.
 * 3. The length: the bar count whose implied tempo is nearest that prior
 *    (or the project tempo when step 2 found nothing), and the tempo is the
 *    one that bar count implies. A guessed tempo therefore always loops
 *    whole, so it is never irregular. `source` records where the prior
 *    came from. */
export function loopTempo(input: LoopTempoInput): LoopTempo {
  const fromName = guessBpmFromFilename(input.fileName)
  if (fromName !== null) {
    const { bars, irregular } = barsAtTempo(input.durationSec, fromName)
    return { bpm: fromName, bars, source: 'filename', irregular }
  }

  const fromFolder = guessBpmFromFilename(input.folderName)
  const fromSiblings = fromFolder === null ? mostCommonFilenameTempo(input.siblingFileNames) : null
  const prior = fromFolder ?? fromSiblings ?? input.projectBpm
  const source: LoopTempoSource =
    fromFolder !== null ? 'folder' : fromSiblings !== null ? 'siblings' : 'length'

  const bars = pickBarsNearTempo(input.durationSec, prior)
  return { bpm: bpmForLoopBars(input.durationSec, bars), bars, source, irregular: false }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/loopFolderTempo.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/shared/loopFolderTempo.ts src/shared/loopFolderTempo.test.ts`
Expected: typecheck clean, all tests pass, eslint 0 errors 0 warnings.

```bash
git add src/shared/loopFolderTempo.ts src/shared/loopFolderTempo.test.ts
git commit -m "a linked loop's tempo: filename, then folder, then siblings, then length

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

---

### Task 2: The file filter, format-folder flattening and the group tree (pure, test-first)

**Files:**
- Create: `src/shared/loopFolderTree.ts`
- Test: `src/shared/loopFolderTree.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/loopFolderTree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  isPlayableLoopFile,
  isFormatOnlyFolder,
  loopGroupPath,
  loopDisplayName,
  buildLoopGroupTree,
  flattenLoopTreeOrder,
  countLoopsInGroup,
  defaultExpandedGroupKeys
} from './loopFolderTree'

describe('isPlayableLoopFile', () => {
  it('accepts the six playable formats, in any case', () => {
    for (const name of [
      'Creek Break 160.wav',
      'cw_amen08_165.WAV',
      'a.aif',
      'a.aiff',
      'a.flac',
      'a.mp3',
      'a.ogg',
      'Crot Break 165.Wav'
    ]) {
      expect(isPlayableLoopFile(name)).toBe(true)
    }
  })

  it('hides everything else, REX2 included', () => {
    for (const name of ['Creek Break 160.rx2', 'info.txt', 'cover.jpg', 'loop.rex', 'wav', 'noext']) {
      expect(isPlayableLoopFile(name)).toBe(false)
    }
  })

  it('hides dot files: .DS_Store, and the ._ companions ExFAT volumes are full of', () => {
    expect(isPlayableLoopFile('.DS_Store')).toBe(false)
    expect(isPlayableLoopFile('._Creek Break 160.wav')).toBe(false)
    expect(isPlayableLoopFile('.hidden.wav')).toBe(false)
  })
})

describe('isFormatOnlyFolder', () => {
  it('knows the format folder names, in any case', () => {
    for (const name of ['WAV', 'wav', 'AIFF', 'MP3', 'FLAC', 'OGG', 'REX', 'REX2', 'rex2', 'Audio', 'AUDIO']) {
      expect(isFormatOnlyFolder(name)).toBe(true)
    }
  })

  it('leaves real folder names alone', () => {
    for (const name of ['Amen Breaks Volume 1', 'Wavs', 'Audio Loops', 'Amen Breaks Compilation']) {
      expect(isFormatOnlyFolder(name)).toBe(false)
    }
  })
})

describe('loopGroupPath', () => {
  it('flattens format folders into their parent', () => {
    expect(loopGroupPath(['Amen Breaks Volume 1', 'WAV'])).toEqual(['Amen Breaks Volume 1'])
    expect(loopGroupPath(['Amen Breaks Volume 1', 'REX2'])).toEqual(['Amen Breaks Volume 1'])
    expect(loopGroupPath(['WAV'])).toEqual([])
    expect(loopGroupPath([])).toEqual([])
  })

  it('keeps real folders on either side of a format folder', () => {
    expect(loopGroupPath(['Volume 2', 'Audio', 'Kicks'])).toEqual(['Volume 2', 'Kicks'])
  })
})

describe('loopDisplayName', () => {
  it('is the filename without its extension', () => {
    expect(loopDisplayName('Creek Break 160.wav')).toBe('Creek Break 160')
    expect(loopDisplayName('cw_amen08_165.WAV')).toBe('cw_amen08_165')
    expect(loopDisplayName('break.v2.aiff')).toBe('break.v2')
  })
})

const loop = (name: string, groupPath: string[]): { name: string; groupPath: string[] } => ({
  name,
  groupPath
})

describe('buildLoopGroupTree', () => {
  it('nests loops by group path, with groups and loops in natural order', () => {
    const tree = buildLoopGroupTree([
      loop('cw_amen08_165', ['Volume 1']),
      loop('Creek Break 160', ['Volume 1']),
      loop('Halftime Dnb Drums 1', ['Volume 10']),
      loop('Crot Break 165', ['Volume 2']),
      loop('root loop', [])
    ])
    expect(tree.depth).toBe(0)
    expect(tree.loops.map((l) => l.name)).toEqual(['root loop'])
    expect(tree.children.map((g) => g.name)).toEqual(['Volume 1', 'Volume 2', 'Volume 10'])
    expect(tree.children[0].loops.map((l) => l.name)).toEqual(['Creek Break 160', 'cw_amen08_165'])
    expect(tree.children[0].key).toBe('["Volume 1"]')
    expect(tree.children[0].depth).toBe(1)
  })

  it('nests deeper groups under their parents', () => {
    const tree = buildLoopGroupTree([loop('kick', ['Volume 2', 'Kicks']), loop('snare', ['Volume 2'])])
    const volume2 = tree.children[0]
    expect(volume2.loops.map((l) => l.name)).toEqual(['snare'])
    expect(volume2.children[0]).toMatchObject({ name: 'Kicks', key: '["Volume 2","Kicks"]', depth: 2 })
  })

  it('an empty folder is an empty root', () => {
    expect(buildLoopGroupTree([])).toEqual({ key: '[]', name: '', depth: 0, loops: [], children: [] })
  })
})

describe('flattenLoopTreeOrder, countLoopsInGroup, defaultExpandedGroupKeys', () => {
  const tree = buildLoopGroupTree([
    loop('a', ['G1']),
    loop('b', ['G1']),
    loop('c', ['G1', 'Sub']),
    loop('d', ['G2']),
    loop('r', [])
  ])
  const names = (loops: { name: string }[]): string[] => loops.map((l) => l.name)

  it('lists a group’s own loops before its subgroups, root loops first', () => {
    expect(names(flattenLoopTreeOrder(tree, () => true))).toEqual(['r', 'a', 'b', 'c', 'd'])
  })

  it('leaves out a collapsed group and everything under it', () => {
    expect(names(flattenLoopTreeOrder(tree, (key) => key !== '["G1"]'))).toEqual(['r', 'd'])
    expect(names(flattenLoopTreeOrder(tree, (key) => key !== '["G1","Sub"]'))).toEqual([
      'r',
      'a',
      'b',
      'd'
    ])
  })

  it('counts every loop under a group', () => {
    expect(countLoopsInGroup(tree.children[0])).toBe(3)
    expect(countLoopsInGroup(tree)).toBe(5)
  })

  it('opens everything when there is at most one top-level group, nothing otherwise', () => {
    expect(defaultExpandedGroupKeys(tree)).toEqual([])
    const single = buildLoopGroupTree([loop('a', ['G1']), loop('c', ['G1', 'Sub'])])
    expect(defaultExpandedGroupKeys(single)).toEqual(['["G1"]', '["G1","Sub"]'])
    expect(defaultExpandedGroupKeys(buildLoopGroupTree([loop('r', [])]))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/loopFolderTree.test.ts`
Expected: FAIL, module `./loopFolderTree` not found.

- [ ] **Step 3: Implement**

Create `src/shared/loopFolderTree.ts`:

```ts
// src/shared/loopFolderTree.ts

/** The formats IMPORT lists from a linked folder. REX2 and other closed
 * formats are out of scope (spec), so a pack's REX2/ copies simply never
 * show. Every one of these is decoded by the native engine's JUCE readers. */
export const PLAYABLE_LOOP_EXTENSIONS: readonly string[] = [
  '.wav',
  '.aif',
  '.aiff',
  '.flac',
  '.mp3',
  '.ogg'
]

/** Folders that only say what format sits inside them. A pack that ships
 * WAV/ and REX2/ side by side is one set of loops, not two groups. */
const FORMAT_ONLY_FOLDER_NAMES = new Set(['wav', 'aiff', 'mp3', 'flac', 'ogg', 'rex', 'rex2', 'audio'])

/** Dot entries: .DS_Store, and the ._ AppleDouble companions macOS writes
 * beside every file on an ExFAT volume -- each one a fake ".wav". */
export function isHiddenEntry(name: string): boolean {
  return name.startsWith('.')
}

export function isPlayableLoopFile(fileName: string): boolean {
  if (isHiddenEntry(fileName)) return false
  const dot = fileName.lastIndexOf('.')
  return dot > 0 && PLAYABLE_LOOP_EXTENSIONS.includes(fileName.slice(dot).toLowerCase())
}

export function isFormatOnlyFolder(name: string): boolean {
  return FORMAT_ONLY_FOLDER_NAMES.has(name.toLowerCase())
}

/** A file's folder segments below the linked root, with format folders
 * flattened into their parent. */
export function loopGroupPath(relativeDirSegments: string[]): string[] {
  return relativeDirSegments.filter((segment) => !isFormatOnlyFolder(segment))
}

export function loopDisplayName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export interface LoopGroupNode<T> {
  /** JSON of the group path; '[]' for the root. Stable across rescans. */
  key: string
  name: string
  /** 0 for the root (the linked folder itself), 1 for its groups, ... */
  depth: number
  loops: T[]
  children: LoopGroupNode<T>[]
}

function naturalOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function sortTree<T extends { name: string }>(node: LoopGroupNode<T>): void {
  node.loops.sort((a, b) => naturalOrder(a.name, b.name))
  node.children.sort((a, b) => naturalOrder(a.name, b.name))
  for (const child of node.children) sortTree(child)
}

/** Groups exist only where loops are, so a REX2-only folder, or one holding
 * nothing playable, never appears. */
export function buildLoopGroupTree<T extends { name: string; groupPath: string[] }>(
  loops: T[]
): LoopGroupNode<T> {
  const root: LoopGroupNode<T> = { key: '[]', name: '', depth: 0, loops: [], children: [] }
  for (const loop of loops) {
    let node = root
    for (let i = 0; i < loop.groupPath.length; i++) {
      const key = JSON.stringify(loop.groupPath.slice(0, i + 1))
      let child = node.children.find((c) => c.key === key)
      if (!child) {
        child = { key, name: loop.groupPath[i], depth: i + 1, loops: [], children: [] }
        node.children.push(child)
      }
      node = child
    }
    node.loops.push(loop)
  }
  sortTree(root)
  return root
}

/** The loops in on-screen order, which is the order shift-click ranges
 * over. The root is always open; a collapsed group hides its whole subtree. */
export function flattenLoopTreeOrder<T>(
  node: LoopGroupNode<T>,
  isExpanded: (key: string) => boolean
): T[] {
  if (node.depth > 0 && !isExpanded(node.key)) return []
  return [...node.loops, ...node.children.flatMap((child) => flattenLoopTreeOrder(child, isExpanded))]
}

export function countLoopsInGroup<T>(node: LoopGroupNode<T>): number {
  return node.loops.length + node.children.reduce((n, child) => n + countLoopsInGroup(child), 0)
}

/** Groups start collapsed, so opening a big pack does not decode a
 * waveform for every loop at once. The exception is a folder with a single
 * top-level group, where collapsing would only add a click. */
export function defaultExpandedGroupKeys<T>(root: LoopGroupNode<T>): string[] {
  if (root.children.length !== 1) return []
  const keys: string[] = []
  const walk = (node: LoopGroupNode<T>): void => {
    for (const child of node.children) {
      keys.push(child.key)
      walk(child)
    }
  }
  walk(root)
  return keys
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/loopFolderTree.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/shared/loopFolderTree.ts src/shared/loopFolderTree.test.ts`
Expected: clean, 0 errors 0 warnings.

```bash
git add src/shared/loopFolderTree.ts src/shared/loopFolderTree.test.ts
git commit -m "which files in a loop folder are loops, and how its folders group them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

---

### Task 3: Wire types, row labels and multi-select (pure, test-first)

**Files:**
- Create: `src/shared/loopFolderTypes.ts`
- Create: `src/shared/loopFolderView.ts`
- Test: `src/shared/loopFolderView.test.ts`

- [ ] **Step 1: Create the wire types**

These are types and two constants only, so they need no tests of their own. Create `src/shared/loopFolderTypes.ts`:

```ts
// src/shared/loopFolderTypes.ts
import type { LoopTempoSource } from './loopFolderTempo'

/** Where the tempo a row shows came from: the guess cascade, or the user. */
export type LoopTempoShownSource = LoopTempoSource | 'user'

/** One linked loop, as main sends it to the renderer. */
export interface LoopEntry {
  /** 'loop-' + sha1 of the normalized absolute path (main's loopIdForPath).
   * Stable across rescans and relinks. Phase 2's Discover keys on this --
   * see the plan's "Phase 2 readiness". */
  loopId: string
  rootPath: string
  /** Absolute path of the file where it lives. Never copied while linked. */
  path: string
  /** The filename without its extension. */
  name: string
  /** Folder segments below the root, format folders flattened. */
  groupPath: string[]
  /** null until measured: WAVs are measured during the scan, other formats
   * when the renderer first decodes them (loop-folders-report-duration). */
  durationSec: number | null
  bpm: number | null
  bars: number | null
  source: LoopTempoShownSource | null
  irregular: boolean
}

export interface LoopFolderListing {
  rootPath: string
  /** The folder's own name, the sidebar title. */
  name: string
  /** false when the last scan could not find the folder (an unplugged
   * drive). Its loops are kept, not removed, until it is back. */
  available: boolean
  lastScannedAt: number | null
  loops: LoopEntry[]
}

export type LinkLoopFolderRefusal =
  | 'not a folder'
  | 'already linked'
  | 'inside a linked folder'
  | 'contains a linked folder'

export type LinkLoopFolderResult =
  | { ok: true; folder: LoopFolderListing }
  | { ok: false; reason: LinkLoopFolderRefusal }

/** The range a corrected tempo may take. The renderer's input and main's
 * setLoopTempoOverride both check it. */
export const MIN_LOOP_TEMPO_OVERRIDE = 40
export const MAX_LOOP_TEMPO_OVERRIDE = 300
```

- [ ] **Step 2: Write the failing tests**

Create `src/shared/loopFolderView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  loopTempoLabel,
  loopBarsLabel,
  nextLoopSelection,
  EMPTY_LOOP_SELECTION,
  type LoopSelection
} from './loopFolderView'

describe('loopTempoLabel', () => {
  it('shows a certain tempo plainly', () => {
    expect(loopTempoLabel({ bpm: 160, source: 'filename' })).toEqual({ text: '160', guessed: false })
    expect(loopTempoLabel({ bpm: 87.5, source: 'user' })).toEqual({ text: '87.5', guessed: false })
  })

  it('marks a guess with ~ and rounds it', () => {
    expect(loopTempoLabel({ bpm: 164.83, source: 'siblings' })).toEqual({ text: '~165', guessed: true })
    expect(loopTempoLabel({ bpm: 170, source: 'folder' })).toEqual({ text: '~170', guessed: true })
    expect(loopTempoLabel({ bpm: 106.667, source: 'length' })).toEqual({ text: '~107', guessed: true })
  })

  it('shows ? when there is no tempo yet', () => {
    expect(loopTempoLabel({ bpm: null, source: null })).toEqual({ text: '?', guessed: true })
  })
})

describe('loopBarsLabel', () => {
  it('names the bar count', () => {
    expect(loopBarsLabel({ bars: 1 })).toBe('1 bar')
    expect(loopBarsLabel({ bars: 4 })).toBe('4 bars')
    expect(loopBarsLabel({ bars: null })).toBe('? bars')
  })
})

describe('nextLoopSelection', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  const plain = { shift: false, toggle: false }
  const shift = { shift: true, toggle: false }
  const toggle = { shift: false, toggle: true }
  const ids = (s: LoopSelection): string[] => [...s.selected].sort()

  it('a plain click selects just that loop and makes it the anchor', () => {
    const s = nextLoopSelection(EMPTY_LOOP_SELECTION, 'c', order, plain)
    expect(s.anchor).toBe('c')
    expect(ids(s)).toEqual(['c'])
  })

  it('shift-click selects the range from the anchor, in either direction, and keeps the anchor', () => {
    const anchored = nextLoopSelection(EMPTY_LOOP_SELECTION, 'b', order, plain)
    const forward = nextLoopSelection(anchored, 'd', order, shift)
    expect(forward.anchor).toBe('b')
    expect(ids(forward)).toEqual(['b', 'c', 'd'])
    const back = nextLoopSelection(forward, 'a', order, shift)
    expect(back.anchor).toBe('b')
    expect(ids(back)).toEqual(['a', 'b'])
  })

  it('shift-click with no anchor, or an anchor no longer on screen, acts as a plain click', () => {
    expect(ids(nextLoopSelection(EMPTY_LOOP_SELECTION, 'c', order, shift))).toEqual(['c'])
    const hidden: LoopSelection = { anchor: 'z', selected: new Set(['z']) }
    const s = nextLoopSelection(hidden, 'c', order, shift)
    expect(s.anchor).toBe('c')
    expect(ids(s)).toEqual(['c'])
  })

  it('cmd-click toggles one loop and moves the anchor to it', () => {
    const one = nextLoopSelection(EMPTY_LOOP_SELECTION, 'a', order, plain)
    const two = nextLoopSelection(one, 'd', order, toggle)
    expect(two.anchor).toBe('d')
    expect(ids(two)).toEqual(['a', 'd'])
    const back = nextLoopSelection(two, 'a', order, toggle)
    expect(back.anchor).toBe('a')
    expect(ids(back)).toEqual(['d'])
  })

  it('never mutates what it is given', () => {
    const one = nextLoopSelection(EMPTY_LOOP_SELECTION, 'a', order, plain)
    nextLoopSelection(one, 'd', order, toggle)
    expect(ids(one)).toEqual(['a'])
    expect(EMPTY_LOOP_SELECTION.selected.size).toBe(0)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/shared/loopFolderView.test.ts`
Expected: FAIL, module `./loopFolderView` not found.

- [ ] **Step 4: Implement**

Create `src/shared/loopFolderView.ts`:

```ts
// src/shared/loopFolderView.ts
import { formatBpm } from './format'
import type { LoopEntry } from './loopFolderTypes'

/** A row's tempo text. A guess is marked by a `~` and, in the component,
 * dimmer text (var(--ra-text-3)) -- never a colour (spec, "Visuals"). */
export function loopTempoLabel(loop: Pick<LoopEntry, 'bpm' | 'source'>): {
  text: string
  guessed: boolean
} {
  if (loop.bpm === null) return { text: '?', guessed: true }
  if (loop.source === 'filename' || loop.source === 'user') {
    return { text: formatBpm(loop.bpm), guessed: false }
  }
  return { text: `~${Math.round(loop.bpm)}`, guessed: true }
}

export function loopBarsLabel(loop: Pick<LoopEntry, 'bars'>): string {
  if (loop.bars === null) return '? bars'
  return loop.bars === 1 ? '1 bar' : `${loop.bars} bars`
}

/** The anchor drives preview, as selectedRiffCID does for rifffs. */
export interface LoopSelection {
  anchor: string | null
  selected: ReadonlySet<string>
}

export const EMPTY_LOOP_SELECTION: LoopSelection = { anchor: null, selected: new Set() }

/** The same file-browser convention as LibraryBrowser's handleRiffClick:
 * a plain click selects one and anchors it; shift extends a range from a
 * fixed anchor over the on-screen order; cmd/ctrl toggles one and moves
 * the anchor to it. */
export function nextLoopSelection(
  prev: LoopSelection,
  clickedId: string,
  orderedIds: string[],
  mods: { shift: boolean; toggle: boolean }
): LoopSelection {
  if (mods.shift && prev.anchor !== null) {
    const anchorIndex = orderedIds.indexOf(prev.anchor)
    const clickedIndex = orderedIds.indexOf(clickedId)
    if (anchorIndex === -1 || clickedIndex === -1) {
      return { anchor: clickedId, selected: new Set([clickedId]) }
    }
    const [start, end] =
      anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
    return { anchor: prev.anchor, selected: new Set(orderedIds.slice(start, end + 1)) }
  }
  if (mods.toggle) {
    const next = new Set(prev.selected)
    if (next.has(clickedId)) next.delete(clickedId)
    else next.add(clickedId)
    return { anchor: clickedId, selected: next }
  }
  return { anchor: clickedId, selected: new Set([clickedId]) }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/shared/loopFolderView.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/shared/loopFolderTypes.ts src/shared/loopFolderView.ts src/shared/loopFolderView.test.ts`
Expected: clean, 0 errors 0 warnings.

```bash
git add src/shared/loopFolderTypes.ts src/shared/loopFolderView.ts src/shared/loopFolderView.test.ts
git commit -m "how a loop row reads, and how loops are picked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

---

### Task 4: The two tables, link, unlink, list and tempo override (main)

**Files:**
- Create: `src/main/loopFolders.ts`
- Test: `src/main/loopFolders.test.ts`
- Modify: `src/main/riffLibrarySchema.ts`, `src/main/riffLibrarySchema.test.ts`, `vitest.config.ts`

The tables live in their own module, and their DDL is interpolated into `SCHEMA_SQL`. That is the `RIFF_STEMS_EXTRA_DDL` precedent: tests build a database from the same constant, so the fixture cannot drift. Every function takes the `db` as a parameter, and only `index.ts` (Task 7) calls `openOwnRiffLibraryDb()`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/loopFolders.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOOP_FOLDERS_DDL,
  linkLoopFolder,
  listLoopFolders,
  loopIdForPath,
  setLoopTempoOverride,
  unlinkLoopFolder
} from './loopFolders'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-loop-folders-test-'))
  db = new Database(join(dir, 'loops.db3'))
  db.exec(LOOP_FOLDERS_DDL)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeFolder(...segments: string[]): string {
  const path = join(dir, ...segments)
  mkdirSync(path, { recursive: true })
  return path
}

interface LoopFields {
  name?: string
  groupPath?: string[]
  durationSec?: number | null
  bpm?: number | null
  bars?: number | null
  source?: string | null
  irregular?: boolean
  overrideBpm?: number | null
  present?: boolean
}

/** Seeds one LoopFiles row directly, standing in for a scan (Task 5). */
function insertLoop(root: string, path: string, fields: LoopFields = {}): string {
  const loopId = loopIdForPath(path)
  db.prepare(
    `INSERT INTO LoopFiles (Path, LoopId, RootPath, GroupPath, Name, SizeBytes, MtimeMs,
       DurationSec, Bpm, Bars, TempoSource, Irregular, OverrideBpm, Present)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    path,
    loopId,
    root,
    JSON.stringify(fields.groupPath ?? []),
    fields.name ?? 'loop',
    fields.durationSec ?? null,
    fields.bpm ?? null,
    fields.bars ?? null,
    fields.source ?? null,
    fields.irregular ? 1 : 0,
    fields.overrideBpm ?? null,
    fields.present === false ? 0 : 1
  )
  return loopId
}

describe('loopIdForPath', () => {
  it('is prefixed, stable, and the same for two spellings of one path', () => {
    const id = loopIdForPath('/a/b/x.wav')
    expect(id).toMatch(/^loop-[0-9a-f]{40}$/)
    expect(loopIdForPath('/a/b/../b/x.wav')).toBe(id)
    // NFD (e + combining acute) and NFC (é) are one file to macOS.
    expect(loopIdForPath('/a/Café.wav')).toBe(loopIdForPath('/a/Café.wav'))
    expect(loopIdForPath('/a/b/y.wav')).not.toBe(id)
  })
})

describe('linkLoopFolder', () => {
  it('links a folder, titled with its own name', () => {
    const root = makeFolder('Amen Breaks Compilation')
    expect(linkLoopFolder(db, root, 1000)).toEqual({
      ok: true,
      folder: {
        rootPath: root,
        name: 'Amen Breaks Compilation',
        available: true,
        lastScannedAt: null,
        loops: []
      }
    })
    expect(listLoopFolders(db).map((f) => f.rootPath)).toEqual([root])
  })

  it('refuses what it cannot or should not link', () => {
    const root = makeFolder('Amen Breaks Compilation')
    const file = join(dir, 'not-a-folder.wav')
    writeFileSync(file, 'x')
    expect(linkLoopFolder(db, file)).toEqual({ ok: false, reason: 'not a folder' })
    expect(linkLoopFolder(db, join(dir, 'missing'))).toEqual({ ok: false, reason: 'not a folder' })

    linkLoopFolder(db, root)
    expect(linkLoopFolder(db, root)).toEqual({ ok: false, reason: 'already linked' })
    expect(linkLoopFolder(db, `${root}/`)).toEqual({ ok: false, reason: 'already linked' })
    const inner = makeFolder('Amen Breaks Compilation', 'Amen Breaks Volume 1')
    expect(linkLoopFolder(db, inner)).toEqual({ ok: false, reason: 'inside a linked folder' })
    expect(linkLoopFolder(db, dir)).toEqual({ ok: false, reason: 'contains a linked folder' })
  })
})

describe('listLoopFolders', () => {
  it('lists each folder with its present loops, groups parsed, guesses as stored', () => {
    const root = makeFolder('Amen Breaks Compilation')
    linkLoopFolder(db, root)
    const creek = join(root, 'Amen Breaks Volume 3', 'WAV', 'Creek Break 160.wav')
    const creekId = insertLoop(root, creek, {
      name: 'Creek Break 160',
      groupPath: ['Amen Breaks Volume 3'],
      durationSec: 3,
      bpm: 160,
      bars: 2,
      source: 'filename'
    })
    insertLoop(root, join(root, 'gone.wav'), { name: 'gone', present: false })

    const [folder] = listLoopFolders(db)
    expect(folder.loops).toEqual([
      {
        loopId: creekId,
        rootPath: root,
        path: creek,
        name: 'Creek Break 160',
        groupPath: ['Amen Breaks Volume 3'],
        durationSec: 3,
        bpm: 160,
        bars: 2,
        source: 'filename',
        irregular: false
      }
    ])
  })

  it('shows a corrected tempo as the user’s, with bars worked out from it', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    insertLoop(root, join(root, 'Creek Break 160.wav'), {
      durationSec: 3,
      bpm: 160,
      bars: 2,
      source: 'filename',
      overrideBpm: 80
    })
    expect(listLoopFolders(db)[0].loops[0]).toMatchObject({
      bpm: 80,
      bars: 1,
      source: 'user',
      irregular: false
    })
  })

  it('orders folders by name, ignoring case', () => {
    linkLoopFolder(db, makeFolder('beta loops'))
    linkLoopFolder(db, makeFolder('Alpha Loops'))
    expect(listLoopFolders(db).map((f) => f.name)).toEqual(['Alpha Loops', 'beta loops'])
  })
})

describe('setLoopTempoOverride', () => {
  it('sets a corrected tempo, and clearing it brings the guess back', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    const id = insertLoop(root, join(root, 'Creek Break 160.wav'), {
      durationSec: 3,
      bpm: 160,
      bars: 2,
      source: 'filename'
    })
    expect(setLoopTempoOverride(db, id, 80)).toMatchObject({ bpm: 80, bars: 1, source: 'user' })
    expect(setLoopTempoOverride(db, id, null)).toMatchObject({
      bpm: 160,
      bars: 2,
      source: 'filename'
    })
  })

  it('refuses a tempo out of range, and an id it does not know', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    const id = insertLoop(root, join(root, 'a.wav'), { durationSec: 3, bpm: 160, bars: 2, source: 'filename' })
    expect(setLoopTempoOverride(db, id, 10)).toBeNull()
    expect(setLoopTempoOverride(db, id, Number.NaN)).toBeNull()
    expect(listLoopFolders(db)[0].loops[0].source).toBe('filename')
    expect(setLoopTempoOverride(db, 'loop-nope', 120)).toBeNull()
  })
})

describe('unlinkLoopFolder', () => {
  it('forgets the folder and its loops, but keeps a corrected tempo for a relink', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    insertLoop(root, join(root, 'plain.wav'), { name: 'plain' })
    insertLoop(root, join(root, 'fixed.wav'), { name: 'fixed', overrideBpm: 80 })

    unlinkLoopFolder(db, root)

    expect(listLoopFolders(db)).toEqual([])
    expect(db.prepare('SELECT Name, Present, OverrideBpm FROM LoopFiles').all()).toEqual([
      { Name: 'fixed', Present: 0, OverrideBpm: 80 }
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/loopFolders.test.ts`
Expected: FAIL, module `./loopFolders` not found.

- [ ] **Step 3: Implement**

Create `src/main/loopFolders.ts`:

```ts
// src/main/loopFolders.ts
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type Database from 'better-sqlite3'
import { barsAtTempo, type LoopTempoSource } from '@shared/loopFolderTempo'
import {
  MAX_LOOP_TEMPO_OVERRIDE,
  MIN_LOOP_TEMPO_OVERRIDE,
  type LinkLoopFolderResult,
  type LoopEntry,
  type LoopFolderListing
} from '@shared/loopFolderTypes'

/** Linked loop folders (docs/superpowers/specs/2026-10-01-import-loop-
 * folders-design.md). sssketch-exclusive, own db only, created by
 * riffLibrarySchema.ts's SCHEMA_SQL like RiffStemsExtra.
 *
 * LoopFiles is keyed by Path, so a rescan is a cheap match on path + size
 * + mtime. LoopId is the stable identity: unique, derived from the
 * normalized path, and the key Phase 2's Discover would use (as the loop's
 * StemCID, via one fallback in stemCIDForPath). Duration, tempo and bars
 * are real columns for the same reason.
 *
 * GroupPath is a JSON array of folder names below the root, format
 * folders already flattened. OverrideBpm is the user's correction. A scan
 * never writes it, and a row holding one is hidden (Present = 0) rather
 * than deleted when its file goes missing, so the correction is still
 * there when the file comes back. */
export const LOOP_FOLDERS_DDL = `
CREATE TABLE IF NOT EXISTS LoopFolders (
  RootPath TEXT PRIMARY KEY,
  Name TEXT NOT NULL,
  Available INTEGER NOT NULL DEFAULT 1,
  LinkedAt INTEGER NOT NULL,
  LastScannedAt INTEGER
);
CREATE TABLE IF NOT EXISTS LoopFiles (
  Path TEXT PRIMARY KEY,
  LoopId TEXT NOT NULL UNIQUE,
  RootPath TEXT NOT NULL,
  GroupPath TEXT NOT NULL,
  Name TEXT NOT NULL,
  SizeBytes INTEGER NOT NULL,
  MtimeMs INTEGER NOT NULL,
  DurationSec REAL,
  Bpm REAL,
  Bars INTEGER,
  TempoSource TEXT,
  Irregular INTEGER NOT NULL DEFAULT 0,
  OverrideBpm REAL,
  Present INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_loopfiles_root ON LoopFiles(RootPath);
`

export interface LoopFileRow {
  Path: string
  LoopId: string
  RootPath: string
  GroupPath: string
  Name: string
  SizeBytes: number
  MtimeMs: number
  DurationSec: number | null
  Bpm: number | null
  Bars: number | null
  TempoSource: string | null
  Irregular: number
  OverrideBpm: number | null
  Present: number
}

/** resolve() for "..", trailing slashes and relative input; NFC because
 * macOS treats NFD and NFC spellings of a name as the same file. */
export function normalizeLoopPath(path: string): string {
  return resolve(path).normalize('NFC')
}

export function loopIdForPath(path: string): string {
  return `loop-${createHash('sha1').update(normalizeLoopPath(path)).digest('hex')}`
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** What the renderer sees: the stored guess, unless the user corrected
 * it -- then their tempo, with bars and irregularity worked out from it. */
export function loopEntryFromRow(row: LoopFileRow): LoopEntry {
  const base = {
    loopId: row.LoopId,
    rootPath: row.RootPath,
    path: row.Path,
    name: row.Name,
    groupPath: JSON.parse(row.GroupPath) as string[],
    durationSec: row.DurationSec
  }
  if (row.OverrideBpm !== null) {
    const fit = row.DurationSec !== null ? barsAtTempo(row.DurationSec, row.OverrideBpm) : null
    return {
      ...base,
      bpm: row.OverrideBpm,
      bars: fit?.bars ?? null,
      source: 'user',
      irregular: fit?.irregular ?? false
    }
  }
  return {
    ...base,
    bpm: row.Bpm,
    bars: row.Bars,
    source: row.TempoSource as LoopTempoSource | null,
    irregular: row.Irregular === 1
  }
}

interface LoopFolderRow {
  RootPath: string
  Name: string
  Available: number
  LastScannedAt: number | null
}

/** Two .all() reads, no disk access: this is what IMPORT shows the moment
 * it opens, before the rescan (loopFolderScan.ts) catches up. */
export function listLoopFolders(db: Database.Database): LoopFolderListing[] {
  const folders = db
    .prepare(
      `SELECT RootPath, Name, Available, LastScannedAt FROM LoopFolders
       ORDER BY Name COLLATE NOCASE, RootPath`
    )
    .all() as LoopFolderRow[]
  const rows = db.prepare(`SELECT * FROM LoopFiles WHERE Present = 1`).all() as LoopFileRow[]
  const byRoot = new Map<string, LoopEntry[]>()
  for (const row of rows) {
    const list = byRoot.get(row.RootPath) ?? []
    list.push(loopEntryFromRow(row))
    byRoot.set(row.RootPath, list)
  }
  return folders.map((f) => ({
    rootPath: f.RootPath,
    name: f.Name,
    available: f.Available === 1,
    lastScannedAt: f.LastScannedAt,
    loops: byRoot.get(f.RootPath) ?? []
  }))
}

/** Records the link only. The caller scans it next (index.ts's
 * loop-folders-link). Nested links are refused both ways: LoopFiles is
 * keyed by Path, so one file under two roots would flip between them on
 * every rescan. */
export function linkLoopFolder(
  db: Database.Database,
  rawPath: string,
  now: number = Date.now()
): LinkLoopFolderResult {
  const rootPath = normalizeLoopPath(rawPath)
  let isDirectory = false
  try {
    isDirectory = statSync(rootPath).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) return { ok: false, reason: 'not a folder' }

  const roots = db.prepare(`SELECT RootPath FROM LoopFolders`).all() as { RootPath: string }[]
  for (const { RootPath: other } of roots) {
    if (other === rootPath) return { ok: false, reason: 'already linked' }
    if (isInside(other, rootPath)) return { ok: false, reason: 'inside a linked folder' }
    if (isInside(rootPath, other)) return { ok: false, reason: 'contains a linked folder' }
  }

  const name = basename(rootPath)
  db.prepare(
    `INSERT INTO LoopFolders (RootPath, Name, Available, LinkedAt, LastScannedAt)
     VALUES (?, ?, 1, ?, NULL)`
  ).run(rootPath, name, now)
  return { ok: true, folder: { rootPath, name, available: true, lastScannedAt: null, loops: [] } }
}

/** Never touches the files. Rows holding a correction are hidden rather
 * than deleted, so relinking the same folder gets the corrections back. */
export function unlinkLoopFolder(db: Database.Database, rawPath: string): void {
  const rootPath = normalizeLoopPath(rawPath)
  db.transaction(() => {
    db.prepare(`DELETE FROM LoopFolders WHERE RootPath = ?`).run(rootPath)
    db.prepare(`DELETE FROM LoopFiles WHERE RootPath = ? AND OverrideBpm IS NULL`).run(rootPath)
    db.prepare(`UPDATE LoopFiles SET Present = 0 WHERE RootPath = ?`).run(rootPath)
  })()
}

/** null clears the correction, bringing the guess back. Returns the
 * updated entry, or null for a tempo out of range or an unknown id. */
export function setLoopTempoOverride(
  db: Database.Database,
  loopId: string,
  bpm: number | null
): LoopEntry | null {
  if (
    bpm !== null &&
    !(Number.isFinite(bpm) && bpm >= MIN_LOOP_TEMPO_OVERRIDE && bpm <= MAX_LOOP_TEMPO_OVERRIDE)
  ) {
    return null
  }
  const { changes } = db
    .prepare(`UPDATE LoopFiles SET OverrideBpm = ? WHERE LoopId = ?`)
    .run(bpm, loopId)
  if (changes === 0) return null
  const row = db.prepare(`SELECT * FROM LoopFiles WHERE LoopId = ?`).get(loopId) as
    | LoopFileRow
    | undefined
  return row ? loopEntryFromRow(row) : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/loopFolders.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the tables in the own library database**

In `src/main/riffLibrarySchema.ts`, add an import below the existing `import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'`:

```ts
import { LOOP_FOLDERS_DDL } from './loopFolders'
```

Find the last line of `SCHEMA_SQL`:

```ts
${RIFF_STEMS_EXTRA_DDL}
`
```

Replace it with:

```ts
${RIFF_STEMS_EXTRA_DDL}

-- Linked loop folders (2026-10-01). Interpolated, like RiffStemsExtra above,
-- so loopFolders.test.ts builds its database from the same constant. New
-- tables only, so the migration is exactly CREATE TABLE IF NOT EXISTS.
${LOOP_FOLDERS_DDL}
`
```

In `src/main/riffLibrarySchema.test.ts`, find the expected table list in `'openOwnRiffLibraryDb creates the db file and every expected table'`. Insert two entries between `'Jams',` and `'RadioHeartImport',`. Uppercase sorts before lowercase in SQLite's binary collation, so they go there:

```ts
      'Jams',
      'LoopFiles',
      'LoopFolders',
      'RadioHeartImport',
```

In `vitest.config.ts`, add to the CI `exclude` array, after `'src/main/instrumentMaskCentroidBackfill.test.ts',`:

```ts
          'src/main/loopFolders.test.ts',
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run src/main/loopFolders.test.ts src/main/riffLibrarySchema.test.ts && npm run typecheck && npx vitest run && npx eslint src/main/loopFolders.ts src/main/loopFolders.test.ts src/main/riffLibrarySchema.ts src/main/riffLibrarySchema.test.ts vitest.config.ts`
Expected: all pass, 0 errors 0 warnings.

```bash
git add src/main/loopFolders.ts src/main/loopFolders.test.ts src/main/riffLibrarySchema.ts src/main/riffLibrarySchema.test.ts vitest.config.ts
git commit -m "the own library remembers linked loop folders and every loop in them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

---

### Task 5: The incremental rescan (main)

**Files:**
- Create: `src/main/loopFolderScan.ts`
- Test: `src/main/loopFolderScan.test.ts`
- Modify: `vitest.config.ts`

**Shape:**
1. Async walk and `stat` (`fs/promises`).
2. One `.all()` of what is cached.
3. Header reads, only for new or changed files, in 8 ms slices.
4. The pure tempo cascade over every file, because a sibling change can change a guess. It is also budgeted.
5. One transaction.

Duration is measured here for WAV only. That is the existing `readWavHeaderBytes` + `readWavDurationSeconds` pair, so main has no reader for anything else. Other formats get their length from the renderer's decode (`recordLoopDuration`), and from the engine at import (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `src/main/loopFolderScan.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeWavPCM16 } from '@shared/encodeWav'
import type { LoopEntry } from '@shared/loopFolderTypes'
import { LOOP_FOLDERS_DDL, linkLoopFolder, listLoopFolders, setLoopTempoOverride } from './loopFolders'
import {
  DEFAULT_LOOP_SCAN_DEPS,
  measureWavDurationSec,
  recordLoopDuration,
  rescanLoopFolder,
  type LoopScanDeps
} from './loopFolderScan'

const RATE = 8000
const secs = (bars: number, bpm: number): number => (bars * 240) / bpm

function writeWav(path: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const channel = new Float32Array(Math.round(seconds * RATE)).fill(0.25)
  writeFileSync(path, encodeWavPCM16([channel], RATE))
}

function writeJunk(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'not audio')
}

let dir: string
let db: Database.Database
let root: string
let cwPath: string
let creekPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-loop-scan-test-'))
  db = new Database(join(dir, 'loops.db3'))
  db.exec(LOOP_FOLDERS_DDL)
  // A miniature of ~/Downloads/Amen Breaks Compilation, real names.
  root = join(dir, 'Amen Breaks Compilation')
  cwPath = join(root, 'Amen Breaks Volume 1', 'WAV', 'cw_amen01_175.wav')
  creekPath = join(root, 'Amen Breaks Volume 3', 'WAV', 'Creek Break 160.wav')
  writeWav(cwPath, secs(2, 175))
  writeWav(creekPath, secs(2, 160))
  writeWav(join(root, 'Amen Breaks Volume 3', 'WAV', 'Crot Break 165.wav'), secs(2, 165))
  writeWav(join(root, 'Amen Breaks Volume 3', 'WAV', 'Hype Break 165.wav'), secs(2, 165))
  writeWav(join(root, 'Amen Breaks Volume 3', 'WAV', 'Halftime Dnb Drums 1.wav'), secs(4, 165))
  writeWav(join(root, 'Amen Breaks Volume 2', 'WAV', 'cw_amen_classic.wav'), 4.5)
  // Everything below must stay hidden.
  writeJunk(join(root, 'Amen Breaks Volume 1', 'REX2', 'cw_amen01_175.rx2'))
  writeJunk(join(root, 'Amen Breaks Volume 3', 'info.txt'))
  writeJunk(join(root, '.DS_Store'))
  writeJunk(join(root, 'Amen Breaks Volume 1', 'WAV', '._cw_amen01_175.wav'))
  writeWav(join(root, '.hidden', 'secret 120.wav'), 1)
  linkLoopFolder(db, root)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function loopsByName(): Map<string, LoopEntry> {
  return new Map(listLoopFolders(db)[0].loops.map((l) => [l.name, l]))
}

describe('rescanLoopFolder', () => {
  it('lists only playable files, with the format folders flattened away', async () => {
    await rescanLoopFolder(db, root, 120)
    const loops = loopsByName()
    expect([...loops.keys()].sort()).toEqual([
      'Creek Break 160',
      'Crot Break 165',
      'Halftime Dnb Drums 1',
      'Hype Break 165',
      'cw_amen01_175',
      'cw_amen_classic'
    ])
    expect(loops.get('cw_amen01_175')!.groupPath).toEqual(['Amen Breaks Volume 1'])
    expect(loops.get('Creek Break 160')!.groupPath).toEqual(['Amen Breaks Volume 3'])
    expect(listLoopFolders(db)[0].lastScannedAt).not.toBeNull()
  })

  it('works out each loop’s length, tempo and bars', async () => {
    await rescanLoopFolder(db, root, 120)
    const loops = loopsByName()
    expect(loops.get('Creek Break 160')).toMatchObject({
      bpm: 160,
      bars: 2,
      source: 'filename',
      irregular: false
    })
    expect(loops.get('Creek Break 160')!.durationSec).toBeCloseTo(3, 3)
    expect(loops.get('cw_amen01_175')).toMatchObject({ bpm: 175, bars: 2, source: 'filename' })
    // No tempo in its name or folder: its siblings say 165.
    const halftime = loops.get('Halftime Dnb Drums 1')!
    expect(halftime).toMatchObject({ bars: 4, source: 'siblings', irregular: false })
    expect(halftime.bpm).toBeCloseTo(165, 0)
    // Nothing named anywhere in Volume 2: the length decides, near 120.
    const classic = loops.get('cw_amen_classic')!
    expect(classic).toMatchObject({ bars: 2, source: 'length', irregular: false })
    expect(classic.bpm).toBeCloseTo(106.67, 1)
  })

  it('measures nothing on a second rescan, and only the changed file after an edit', async () => {
    let measured = 0
    const counting: LoopScanDeps = {
      ...DEFAULT_LOOP_SCAN_DEPS,
      measureDurationSec: (path) => {
        measured += 1
        return measureWavDurationSec(path)
      }
    }
    expect((await rescanLoopFolder(db, root, 120, counting)).measured).toBe(6)
    expect((await rescanLoopFolder(db, root, 120, counting)).measured).toBe(0)
    writeWav(cwPath, secs(1, 175))
    expect((await rescanLoopFolder(db, root, 120, counting)).measured).toBe(1)
    expect(measured).toBe(7)
    expect(loopsByName().get('cw_amen01_175')!.bars).toBe(1)
  })

  it('drops a removed file, and keeps a corrected tempo for when it comes back', async () => {
    await rescanLoopFolder(db, root, 120)
    const id = loopsByName().get('cw_amen01_175')!.loopId
    setLoopTempoOverride(db, id, 87.5)

    rmSync(cwPath)
    expect((await rescanLoopFolder(db, root, 120)).removed).toBe(1)
    expect(loopsByName().has('cw_amen01_175')).toBe(false)

    rmSync(creekPath)
    await rescanLoopFolder(db, root, 120)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM LoopFiles WHERE Name = ?`).get('Creek Break 160')).toEqual({
      n: 0
    })

    writeWav(cwPath, secs(2, 175))
    await rescanLoopFolder(db, root, 120)
    expect(loopsByName().get('cw_amen01_175')).toMatchObject({
      loopId: id,
      bpm: 87.5,
      bars: 1,
      source: 'user'
    })
  })

  it('marks a folder that is not there as unavailable, keeping its loops until it is back', async () => {
    await rescanLoopFolder(db, root, 120)
    const away = `${root} (unplugged)`
    renameSync(root, away)

    const missing = await rescanLoopFolder(db, root, 120)
    expect(missing.available).toBe(false)
    const [folder] = listLoopFolders(db)
    expect(folder.available).toBe(false)
    expect(folder.loops).toHaveLength(6)

    renameSync(away, root)
    expect((await rescanLoopFolder(db, root, 120)).available).toBe(true)
    expect(listLoopFolders(db)[0].available).toBe(true)
  })

  it('yields on an elapsed-time budget, not a file count', async () => {
    const hits = join(dir, 'Hits')
    for (let i = 0; i < 20; i++) writeWav(join(hits, `hit ${String(i).padStart(2, '0')}.wav`), 0.05)
    linkLoopFolder(db, hits)

    const run = async (msPerMeasure: number): Promise<number> => {
      db.prepare(`DELETE FROM LoopFiles WHERE RootPath = ?`).run(hits)
      let clock = 0
      let yields = 0
      await rescanLoopFolder(db, hits, 120, {
        measureDurationSec: (path) => {
          clock += msPerMeasure
          return measureWavDurationSec(path)
        },
        now: () => clock,
        yieldToEventLoop: async () => {
          yields += 1
        }
      })
      return yields
    }

    // 3ms a header -- a slow volume -- spends the 8ms budget every third file.
    expect(await run(3)).toBe(6)
    // Fast reads never spend it, however many files there are.
    expect(await run(0)).toBe(0)
  })

  it('shares one scan between two callers asking at once', async () => {
    const first = rescanLoopFolder(db, root, 120)
    const second = rescanLoopFolder(db, root, 120)
    expect(second).toBe(first)
    await first
  })
})

describe('recordLoopDuration', () => {
  it('fills in a length the header reader could not measure, once', async () => {
    writeJunk(join(root, 'Pads', 'Pad 120.flac'))
    await rescanLoopFolder(db, root, 120)
    const pad = loopsByName().get('Pad 120')!
    expect(pad).toMatchObject({ durationSec: null, bpm: 120, bars: null, source: 'filename' })

    expect(recordLoopDuration(db, pad.loopId, 8, 120)).toMatchObject({
      durationSec: 8,
      bpm: 120,
      bars: 4,
      source: 'filename',
      irregular: false
    })
    // A second report does not overwrite the first.
    expect(recordLoopDuration(db, pad.loopId, 2, 120)).toMatchObject({ durationSec: 8, bars: 4 })
    expect(recordLoopDuration(db, pad.loopId, 0, 120)).toBeNull()
    expect(recordLoopDuration(db, 'loop-nope', 8, 120)).toBeNull()

    // The file has not changed, so a rescan keeps the reported length.
    await rescanLoopFolder(db, root, 120)
    expect(loopsByName().get('Pad 120')!.durationSec).toBe(8)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/loopFolderScan.test.ts`
Expected: FAIL, module `./loopFolderScan` not found.

- [ ] **Step 3: Implement**

Create `src/main/loopFolderScan.ts`:

```ts
// src/main/loopFolderScan.ts
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import { readWavDurationSeconds } from '@shared/wavDuration'
import { guessBpmFromFilename } from '@shared/guessBpmFromFilename'
import { loopTempo, type LoopTempoSource } from '@shared/loopFolderTempo'
import {
  isHiddenEntry,
  isPlayableLoopFile,
  loopDisplayName,
  loopGroupPath
} from '@shared/loopFolderTree'
import type { LoopEntry } from '@shared/loopFolderTypes'
import { readWavHeaderBytes } from './importRifff'
import { loopEntryFromRow, loopIdForPath, normalizeLoopPath, type LoopFileRow } from './loopFolders'

/** The same 8ms slice listLibraryScanTargets uses (discoverLibraryStems.ts,
 * commit 5b0a91b): a clock bounds the slice on any hardware, a file count
 * only on the developer's. On Elling's USB/ExFAT volume a header read is
 * far slower than here. */
export const LOOP_SCAN_SLICE_BUDGET_MS = 8

export interface LoopScanDeps {
  /** The file's length in seconds, or null when this process cannot tell. */
  measureDurationSec: (path: string) => number | null
  now: () => number
  yieldToEventLoop: () => Promise<void>
}

/** WAV only: main has no reader for any other format (importOneShot.ts
 * says the same). One stat plus a 4 KB read, via the existing helpers. */
export function measureWavDurationSec(path: string): number | null {
  if (!path.toLowerCase().endsWith('.wav')) return null
  try {
    const durationSec = readWavDurationSeconds(readWavHeaderBytes(path))
    return durationSec > 0 ? durationSec : null
  } catch {
    return null
  }
}

export const DEFAULT_LOOP_SCAN_DEPS: LoopScanDeps = {
  measureDurationSec: measureWavDurationSec,
  now: () => Date.now(),
  yieldToEventLoop: () => new Promise((resolve) => setImmediate(resolve))
}

export interface FoundLoopFile {
  path: string
  name: string
  groupPath: string[]
}

/** Every playable file under `rootPath`. Async readdir throughout -- a
 * cold readdirSync on his USB volume is one uninterruptible 626ms, which
 * no yield can split. Dot entries are skipped and never descended into.
 * Symlinks are neither files nor directories to a Dirent, so they are
 * skipped too, which also rules out a symlink cycle. An unreadable
 * subfolder is skipped, not fatal. */
export async function walkLoopFolder(rootPath: string): Promise<FoundLoopFile[]> {
  const found: FoundLoopFile[] = []
  const pending: string[][] = [[]]
  while (pending.length > 0) {
    const segments = pending.pop()!
    const dir = join(rootPath, ...segments)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (isHiddenEntry(entry.name)) continue
      if (entry.isDirectory()) {
        pending.push([...segments, entry.name])
      } else if (entry.isFile() && isPlayableLoopFile(entry.name)) {
        found.push({
          path: join(dir, entry.name),
          name: loopDisplayName(entry.name),
          groupPath: loopGroupPath(segments)
        })
      }
    }
  }
  return found
}

export interface LoopTempoFields {
  bpm: number | null
  bars: number | null
  source: LoopTempoSource | null
  irregular: boolean
}

/** The folder a person sees a loop in: its last group, or the linked
 * folder itself for a loop at the top. */
export function loopFolderName(groupPath: string[], rootPath: string): string {
  return groupPath.length > 0 ? groupPath[groupPath.length - 1] : basename(rootPath)
}

/** The cascade when the length is known. Before it is (a non-WAV file the
 * renderer has not decoded yet), only a filename tempo can be said. */
export function tempoForLoop(
  name: string,
  folderName: string,
  siblingNames: string[],
  durationSec: number | null,
  projectBpm: number
): LoopTempoFields {
  if (durationSec !== null) {
    return loopTempo({ fileName: name, folderName, siblingFileNames: siblingNames, durationSec, projectBpm })
  }
  const fromName = guessBpmFromFilename(name)
  return fromName !== null
    ? { bpm: fromName, bars: null, source: 'filename', irregular: false }
    : { bpm: null, bars: null, source: null, irregular: false }
}

export interface LoopScanSummary {
  rootPath: string
  available: boolean
  /** Loops present after the scan. */
  total: number
  /** Files whose length was read this time: new or changed only. */
  measured: number
  /** Loops that were present before and are gone now. */
  removed: number
}

const inFlight = new Map<string, Promise<LoopScanSummary>>()

/** Rescans one linked folder. Two callers asking at once (IMPORT opening
 * while `rescan` is clicked) share one scan. Deliberately not `async`, so
 * the second caller gets the very same promise. */
export function rescanLoopFolder(
  db: Database.Database,
  rawRootPath: string,
  projectBpm: number,
  deps: LoopScanDeps = DEFAULT_LOOP_SCAN_DEPS
): Promise<LoopScanSummary> {
  const rootPath = normalizeLoopPath(rawRootPath)
  const running = inFlight.get(rootPath)
  if (running) return running
  const scan = doRescan(db, rootPath, projectBpm, deps).finally(() => inFlight.delete(rootPath))
  inFlight.set(rootPath, scan)
  return scan
}

interface StatedFile {
  file: FoundLoopFile
  size: number
  mtimeMs: number
}

async function doRescan(
  db: Database.Database,
  rootPath: string,
  projectBpm: number,
  deps: LoopScanDeps
): Promise<LoopScanSummary> {
  const rootStat = await stat(rootPath).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    // An unplugged drive. Its rows are left exactly as they were: greyed,
    // not removed, until it is back.
    db.prepare(`UPDATE LoopFolders SET Available = 0 WHERE RootPath = ?`).run(rootPath)
    return { rootPath, available: false, total: 0, measured: 0, removed: 0 }
  }

  const files = await walkLoopFolder(rootPath)
  const stated: StatedFile[] = []
  for (const file of files) {
    const fileStat = await stat(file.path).catch(() => null)
    if (fileStat) stated.push({ file, size: fileStat.size, mtimeMs: Math.trunc(fileStat.mtimeMs) })
  }

  // .all(), then the statement is closed before any await below.
  const knownRows = db.prepare(`SELECT * FROM LoopFiles WHERE RootPath = ?`).all(rootPath) as LoopFileRow[]
  const known = new Map(knownRows.map((row) => [row.Path, row]))

  let sliceStart = deps.now()
  const maybeYield = async (): Promise<void> => {
    if (deps.now() - sliceStart >= LOOP_SCAN_SLICE_BUDGET_MS) {
      await deps.yieldToEventLoop()
      sliceStart = deps.now()
    }
  }

  let measured = 0
  const durations = new Map<string, number | null>()
  for (const { file, size, mtimeMs } of stated) {
    const prev = known.get(file.path)
    if (prev && prev.SizeBytes === size && prev.MtimeMs === mtimeMs) {
      durations.set(file.path, prev.DurationSec)
    } else {
      durations.set(file.path, deps.measureDurationSec(file.path))
      measured += 1
    }
    await maybeYield()
  }

  // Every guess is recomputed, not just the changed files' -- a sibling
  // added or removed can change the siblings' most common tempo. Pure and
  // cheap, but budgeted all the same.
  const byGroup = new Map<string, StatedFile[]>()
  for (const s of stated) {
    const key = JSON.stringify(s.file.groupPath)
    const members = byGroup.get(key) ?? []
    members.push(s)
    byGroup.set(key, members)
  }
  const rows: Record<string, string | number | null>[] = []
  for (const [groupKey, members] of byGroup) {
    const siblingNames = members.map((m) => m.file.name)
    const folderName = loopFolderName(members[0].file.groupPath, rootPath)
    for (const { file, size, mtimeMs } of members) {
      const durationSec = durations.get(file.path) ?? null
      const tempo = tempoForLoop(file.name, folderName, siblingNames, durationSec, projectBpm)
      rows.push({
        path: file.path,
        loopId: loopIdForPath(file.path),
        rootPath,
        groupPath: groupKey,
        name: file.name,
        size,
        mtimeMs,
        durationSec,
        bpm: tempo.bpm,
        bars: tempo.bars,
        source: tempo.source,
        irregular: tempo.irregular ? 1 : 0
      })
      await maybeYield()
    }
  }

  const seen = new Set(rows.map((row) => row.path as string))
  const gone = knownRows.filter((row) => !seen.has(row.Path))
  const upsert = db.prepare(
    `INSERT INTO LoopFiles (Path, LoopId, RootPath, GroupPath, Name, SizeBytes, MtimeMs,
       DurationSec, Bpm, Bars, TempoSource, Irregular, Present)
     VALUES (@path, @loopId, @rootPath, @groupPath, @name, @size, @mtimeMs,
       @durationSec, @bpm, @bars, @source, @irregular, 1)
     ON CONFLICT(Path) DO UPDATE SET
       LoopId = excluded.LoopId, RootPath = excluded.RootPath, GroupPath = excluded.GroupPath,
       Name = excluded.Name, SizeBytes = excluded.SizeBytes, MtimeMs = excluded.MtimeMs,
       DurationSec = excluded.DurationSec, Bpm = excluded.Bpm, Bars = excluded.Bars,
       TempoSource = excluded.TempoSource, Irregular = excluded.Irregular, Present = 1`
  )
  const deleteRow = db.prepare(`DELETE FROM LoopFiles WHERE Path = ?`)
  const hideRow = db.prepare(`UPDATE LoopFiles SET Present = 0 WHERE Path = ?`)
  const isLinked = db.prepare(`SELECT 1 FROM LoopFolders WHERE RootPath = ?`)
  const markScanned = db.prepare(
    `UPDATE LoopFolders SET Available = 1, LastScannedAt = ? WHERE RootPath = ?`
  )
  const scannedAt = deps.now()

  // One transaction for every write. Re-checks the link inside it: an
  // unlink that landed during the awaits above wins, and nothing is
  // written back for a folder that is no longer linked.
  db.transaction(() => {
    if (!isLinked.get(rootPath)) return
    for (const row of rows) upsert.run(row)
    for (const row of gone) (row.OverrideBpm === null ? deleteRow : hideRow).run(row.Path)
    markScanned.run(scannedAt, rootPath)
  })()

  return {
    rootPath,
    available: true,
    total: rows.length,
    measured,
    removed: gone.filter((row) => row.Present === 1).length
  }
}

/** Every linked folder, one after another. */
export async function rescanAllLoopFolders(
  db: Database.Database,
  projectBpm: number,
  deps: LoopScanDeps = DEFAULT_LOOP_SCAN_DEPS
): Promise<LoopScanSummary[]> {
  const roots = db
    .prepare(`SELECT RootPath FROM LoopFolders ORDER BY Name COLLATE NOCASE`)
    .all() as { RootPath: string }[]
  const summaries: LoopScanSummary[] = []
  for (const { RootPath } of roots) {
    summaries.push(await rescanLoopFolder(db, RootPath, projectBpm, deps))
  }
  return summaries
}

/** The renderer measured a file main could not (a non-WAV it decoded for
 * the waveform). Taken only while the row has no length yet: a header read
 * or an earlier report wins. A rescan keeps it while the file's size and
 * mtime are unchanged. */
export function recordLoopDuration(
  db: Database.Database,
  loopId: string,
  durationSec: number,
  projectBpm: number
): LoopEntry | null {
  if (!(Number.isFinite(durationSec) && durationSec > 0)) return null
  const row = db
    .prepare(`SELECT * FROM LoopFiles WHERE LoopId = ? AND Present = 1`)
    .get(loopId) as LoopFileRow | undefined
  if (!row) return null
  if (row.DurationSec !== null) return loopEntryFromRow(row)

  const siblings = db
    .prepare(`SELECT Name FROM LoopFiles WHERE RootPath = ? AND GroupPath = ? AND Present = 1`)
    .all(row.RootPath, row.GroupPath) as { Name: string }[]
  const folderName = loopFolderName(JSON.parse(row.GroupPath) as string[], row.RootPath)
  const tempo = tempoForLoop(
    row.Name,
    folderName,
    siblings.map((s) => s.Name),
    durationSec,
    projectBpm
  )
  const irregular = tempo.irregular ? 1 : 0
  db.prepare(
    `UPDATE LoopFiles SET DurationSec = ?, Bpm = ?, Bars = ?, TempoSource = ?, Irregular = ?
     WHERE LoopId = ?`
  ).run(durationSec, tempo.bpm, tempo.bars, tempo.source, irregular, loopId)
  return loopEntryFromRow({
    ...row,
    DurationSec: durationSec,
    Bpm: tempo.bpm,
    Bars: tempo.bars,
    TempoSource: tempo.source,
    Irregular: irregular
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/loopFolderScan.test.ts`
Expected: PASS. If the yield test gives 7 rather than 6, `sliceStart` is being reset somewhere other than after a yield. Fix the code, not the number.

- [ ] **Step 5: CI exclusion**

In `vitest.config.ts`, add after the `'src/main/loopFolders.test.ts',` line from Task 4:

```ts
          'src/main/loopFolderScan.test.ts',
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/main/loopFolderScan.ts src/main/loopFolderScan.test.ts vitest.config.ts`
Expected: clean, 0 errors 0 warnings.

```bash
git add src/main/loopFolderScan.ts src/main/loopFolderScan.test.ts vitest.config.ts
git commit -m "a linked folder rescans by size and mtime, in slices, and survives an unplugged drive

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

---

### Task 6: Import through the `+ sample` path (main)

**Files:**
- Modify: `src/main/importOneShot.ts`, `src/main/importOneShot.test.ts`
- Create: `src/main/loopFolderImport.ts`
- Test: `src/main/loopFolderImport.test.ts`
- Modify: `vitest.config.ts`

**How each format is imported:**
- **A WAV loop** goes through `importLoop(path, bars)` unchanged. That is the existing loop import: copy into the library, measure, back-solve the tempo from the bar count.
- **A non-WAV loop** cannot, because `copyIntoLibrary` is WAV-only. It is decoded once by the native engine's `bake-stem` command, with `rotationSec: 0` so it is a plain decode. The output is a WAV inside a new library folder, and the result is built by the same `loopRifff` builder that `importLoop` now uses.
- **One engine process per import batch**, and only when the batch has a non-WAV loop. That mirrors `bakeNativeJobs`.

- [ ] **Step 1: Write the failing tests for `importLoopViaDecoder`**

In `src/main/importOneShot.test.ts`:
- add `importLoopViaDecoder` to the import list from `'./importOneShot'`;
- change `import { join } from 'node:path'` to `import { dirname, join } from 'node:path'`.

Then append:

```ts
describe('importLoopViaDecoder', () => {
  it('decodes into its own library folder and builds the same loop rifff importLoop does', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-decoded-loop-test-'))
    try {
      const source = join(dir, 'Pad 120.flac')
      writeFileSync(source, 'not really flac')
      const rifff = await importLoopViaDecoder(
        source,
        'Pad 120',
        () => 4,
        async (_sourcePath, outputPath) => {
          writeFileSync(outputPath, encodeWavPCM16([new Float32Array(8 * 8000)], 8000))
          return 8
        }
      )
      expect(rifff).not.toBeNull()
      expect(rifff!.name).toBe('Pad 120')
      expect(rifff!.bpm).toBeCloseTo(120, 6)
      expect(rifff!.barLength).toBe(4)
      expect(rifff!.folderPath).toBe(source)
      expect(rifff!.stems[0]).toMatchObject({ slot: 1, type: 'fx', barLength: 4, durationSec: 8 })
      expect(rifff!.stems[0].oneShot).toBeUndefined()
      expect(rifff!.stems[0].path.endsWith('Pad 120.wav')).toBe(true)
      expect(existsSync(rifff!.stems[0].path)).toBe(true)
      rmSync(dirname(rifff!.stems[0].path), { recursive: true, force: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves nothing behind when the decode fails', async () => {
    let outputPath = ''
    const rifff = await importLoopViaDecoder('/no/such/Pad 120.flac', 'Pad 120', () => 1, async (_s, out) => {
      outputPath = out
      return null
    })
    expect(rifff).toBeNull()
    expect(outputPath).not.toBe('')
    expect(existsSync(dirname(outputPath))).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/importOneShot.test.ts`
Expected: FAIL, `importLoopViaDecoder` is not exported.

- [ ] **Step 3: Extract the builder and add `importLoopViaDecoder`**

In `src/main/importOneShot.ts`, replace the body of `importLoop`, from `export function importLoop(path: string, barCount: number): Rifff | null {` to its closing `}`, with:

```ts
export function importLoop(path: string, barCount: number): Rifff | null {
  const copied = copyIntoLibrary(path, 'importLoop')
  if (!copied) return null
  const { groupId, destPath, durationSec } = copied
  return loopRifff(groupId, basename(path, '.wav'), path, destPath, durationSec, barCount)
}

/** The one-stem loop rifff importLoop has always built -- shared with
 * importLoopViaDecoder below so a decoded loop is built the same way. */
function loopRifff(
  groupId: string,
  displayName: string,
  sourcePath: string,
  destPath: string,
  durationSec: number,
  barCount: number
): Rifff {
  return {
    groupId,
    name: displayName,
    bpm: bpmForLoopBars(durationSec, barCount),
    barLength: barCount,
    folderPath: sourcePath,
    stems: [
      {
        slot: 1,
        author: '',
        name: displayName,
        type: 'fx',
        path: destPath,
        durationSec,
        barLength: barCount
      }
    ]
  }
}

/** Decodes `sourcePath` (any format the native engine reads) to a WAV at
 * `outputPath`, resolving that WAV's duration, or null on failure. */
export type DecodeToWav = (sourcePath: string, outputPath: string) => Promise<number | null>

/**
 * importLoop for a file copyIntoLibrary cannot take: a linked loop that is
 * AIFF, FLAC, MP3 or OGG (docs/superpowers/specs/2026-10-01-import-loop-
 * folders-design.md). The decode writes straight into a new library
 * folder, so the source is only ever read. The bar count is asked for
 * once the real duration is known, since a non-WAV may not have had one
 * before. Cleans up its folder on any failure, like copyIntoLibrary.
 */
export async function importLoopViaDecoder(
  path: string,
  displayName: string,
  barCountFor: (durationSec: number) => number,
  decode: DecodeToWav
): Promise<Rifff | null> {
  const groupId = randomUUID()
  const destDir = join(libraryRoot(), groupId)
  const destPath = join(destDir, `${displayName}.wav`)
  try {
    mkdirSync(destDir, { recursive: true })
    const durationSec = await decode(path, destPath)
    if (durationSec === null || durationSec <= 0) {
      rmSync(destDir, { recursive: true, force: true })
      return null
    }
    return loopRifff(groupId, displayName, path, destPath, durationSec, barCountFor(durationSec))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`importLoopViaDecoder: failed to import ${path}: ${message}`)
    rmSync(destDir, { recursive: true, force: true })
    return null
  }
}
```

The existing imports at the top of the file already cover `randomUUID`, `join`, `mkdirSync`, `rmSync`, `libraryRoot` and `bpmForLoopBars`. Keep `importLoop`'s existing doc comment above it.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/main/importOneShot.test.ts`
Expected: PASS, including every pre-existing `importLoop` test. The refactor is behaviour-preserving.

- [ ] **Step 5: Write the failing tests for `importLinkedLoops`**

Create `src/main/loopFolderImport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeWavPCM16 } from '@shared/encodeWav'
import type { Rifff } from '@shared/types'
import { LOOP_FOLDERS_DDL, linkLoopFolder, listLoopFolders, setLoopTempoOverride } from './loopFolders'
import { rescanLoopFolder } from './loopFolderScan'
import { importLinkedLoops, type RunWithDecoder } from './loopFolderImport'
import type { DecodeToWav } from './importOneShot'

const RATE = 8000
const secs = (bars: number, bpm: number): number => (bars * 240) / bpm

function writeWav(path: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encodeWavPCM16([new Float32Array(Math.round(seconds * RATE)).fill(0.25)], RATE))
}

function writeJunk(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'not audio')
}

let dir: string
let db: Database.Database
let root: string
let creekPath: string
let imported: Rifff[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-loop-import-test-'))
  db = new Database(join(dir, 'loops.db3'))
  db.exec(LOOP_FOLDERS_DDL)
  root = join(dir, 'Amen Breaks Compilation')
  creekPath = join(root, 'Amen Breaks Volume 3', 'WAV', 'Creek Break 160.wav')
  writeWav(creekPath, secs(2, 160))
  writeWav(join(root, 'Amen Breaks Volume 1', 'WAV', 'cw_amen01_175.wav'), secs(2, 175))
  writeJunk(join(root, 'Pads', 'Pad 120.flac'))
  writeJunk(join(root, 'Pads', 'Pad 2 120.ogg'))
  linkLoopFolder(db, root)
  await rescanLoopFolder(db, root, 120)
  imported = []
})

afterEach(() => {
  // Imports land in the real library root, as importOneShot.test.ts's do.
  for (const rifff of imported) rmSync(dirname(rifff.stems[0].path), { recursive: true, force: true })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function idOf(name: string): string {
  return listLoopFolders(db)[0].loops.find((l) => l.name === name)!.loopId
}

/** Fails the test if a decoder is ever asked for. */
const noDecoder: RunWithDecoder = async () => {
  throw new Error('a decoder was spawned for an all-WAV import')
}

/** Writes a real WAV of `seconds` for every decode (null: every decode
 * fails), and counts decoder sessions. */
function fakeDecoder(seconds: number | null): { run: RunWithDecoder; sessions: () => number } {
  let sessions = 0
  const decode: DecodeToWav = async (_sourcePath, outputPath) => {
    if (seconds === null) return null
    writeFileSync(outputPath, encodeWavPCM16([new Float32Array(Math.round(seconds * RATE))], RATE))
    return seconds
  }
  return {
    run: async (fn) => {
      sessions += 1
      return fn(decode)
    },
    sessions: () => sessions
  }
}

describe('importLinkedLoops', () => {
  it('imports a WAV loop as a one-stem rifff that tiles at its bar count, copied into the library', async () => {
    const rifffs = await importLinkedLoops(db, [idOf('Creek Break 160')], 120, noDecoder)
    imported.push(...rifffs)
    expect(rifffs).toHaveLength(1)
    const [rifff] = rifffs
    expect(rifff.name).toBe('Creek Break 160')
    expect(rifff.barLength).toBe(2)
    expect(rifff.bpm).toBeCloseTo(160, 3)
    expect(rifff.folderPath).toBe(creekPath)
    expect(rifff.stems[0]).toMatchObject({ slot: 1, type: 'fx', barLength: 2, name: 'Creek Break 160' })
    expect(rifff.stems[0].oneShot).toBeUndefined()
    expect(rifff.stems[0].path).not.toBe(creekPath)
    expect(existsSync(rifff.stems[0].path)).toBe(true)
    expect(rifff.stems[0].durationSec).toBeCloseTo(3, 3)
  })

  it('imports at a corrected tempo', async () => {
    const id = idOf('cw_amen01_175')
    setLoopTempoOverride(db, id, 87.5)
    const [rifff] = await importLinkedLoops(db, [id], 120, noDecoder)
    imported.push(rifff)
    expect(rifff.barLength).toBe(1)
    expect(rifff.bpm).toBeCloseTo(87.5, 1)
  })

  it('keeps the selection order and skips an id it does not know', async () => {
    const rifffs = await importLinkedLoops(
      db,
      [idOf('cw_amen01_175'), 'loop-nope', idOf('Creek Break 160')],
      120,
      noDecoder
    )
    imported.push(...rifffs)
    expect(rifffs.map((r) => r.name)).toEqual(['cw_amen01_175', 'Creek Break 160'])
  })

  it('decodes non-WAV loops, all in one decoder session', async () => {
    const decoder = fakeDecoder(8)
    const rifffs = await importLinkedLoops(db, [idOf('Pad 120'), idOf('Pad 2 120')], 120, decoder.run)
    imported.push(...rifffs)
    expect(decoder.sessions()).toBe(1)
    expect(rifffs.map((r) => r.name)).toEqual(['Pad 120', 'Pad 2 120'])
    for (const rifff of rifffs) {
      expect(rifff.barLength).toBe(4)
      expect(rifff.bpm).toBeCloseTo(120, 6)
      expect(rifff.stems[0].path.endsWith('.wav')).toBe(true)
      expect(existsSync(rifff.stems[0].path)).toBe(true)
    }
  })

  it('imports nothing for a loop whose decode fails', async () => {
    const rifffs = await importLinkedLoops(db, [idOf('Pad 120')], 120, fakeDecoder(null).run)
    expect(rifffs).toEqual([])
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/main/loopFolderImport.test.ts`
Expected: FAIL, module `./loopFolderImport` not found.

- [ ] **Step 7: Implement**

Create `src/main/loopFolderImport.ts`:

```ts
// src/main/loopFolderImport.ts
import type Database from 'better-sqlite3'
import { barsAtTempo } from '@shared/loopFolderTempo'
import type { Rifff } from '@shared/types'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { importLoop, importLoopViaDecoder, type DecodeToWav } from './importOneShot'
import { loopEntryFromRow, type LoopFileRow } from './loopFolders'
import { loopFolderName, tempoForLoop } from './loopFolderScan'

/** Runs `fn` with a decoder, and tears the decoder down afterwards. */
export type RunWithDecoder = <T>(fn: (decode: DecodeToWav) => Promise<T>) => Promise<T>

/** One engine process for the whole batch, the same spawn-connect-act-
 * teardown shape as bakeOffset.ts's bakeNativeJobs. bake-stem with
 * rotationSec 0 is a plain decode to 16-bit WAV
 * (native-engine/Source/BakeStem.cpp). Not bakeOffset itself: its
 * bakedPathFor writes next to the SOURCE, and a linked folder is never
 * written to. */
export const withEngineDecoder: RunWithDecoder = async (fn) => {
  const handle = await spawnEngine()
  const client = new EngineClient()
  try {
    await client.connect(handle.port)
    return await fn(async (sourcePath, outputPath) => {
      try {
        const result = (await client.sendAndAwaitType(
          'bake-stem',
          { path: sourcePath, rotationSec: 0, outputPath },
          'bake-stem-result'
        )) as { success: boolean; durationSec?: number; error?: string }
        if (!result.success || result.durationSec === undefined) {
          console.error(`loopFolderImport: decode failed for "${sourcePath}": ${result.error}`)
          return null
        }
        return result.durationSec
      } catch (err) {
        console.error(`loopFolderImport: decode failed for "${sourcePath}":`, err)
        return null
      }
    })
  } finally {
    client.disconnect()
    handle.stop()
  }
}

/** SQLite's bind limit is far above any selection, but chunk anyway, as
 * riffStemsExtra.ts does, so nobody has to think about it again. */
const BIND_CHUNK = 900

function rowsForIds(db: Database.Database, loopIds: string[]): LoopFileRow[] {
  const rows: LoopFileRow[] = []
  for (let i = 0; i < loopIds.length; i += BIND_CHUNK) {
    const chunk = loopIds.slice(i, i + BIND_CHUNK)
    const placeholders = chunk.map(() => '?').join(', ')
    rows.push(
      ...(db
        .prepare(`SELECT * FROM LoopFiles WHERE Present = 1 AND LoopId IN (${placeholders})`)
        .all(...chunk) as LoopFileRow[])
    )
  }
  return rows
}

/** A decoded loop's bar count, once its real length is known: the user's
 * tempo if they corrected it, otherwise the cascade with its folder and
 * siblings, exactly as the scan would have worked it out. */
function barsForDecodedLoop(
  db: Database.Database,
  row: LoopFileRow,
  durationSec: number,
  projectBpm: number
): number {
  if (row.OverrideBpm !== null) return barsAtTempo(durationSec, row.OverrideBpm).bars
  const siblings = db
    .prepare(`SELECT Name FROM LoopFiles WHERE RootPath = ? AND GroupPath = ? AND Present = 1`)
    .all(row.RootPath, row.GroupPath) as { Name: string }[]
  const folderName = loopFolderName(JSON.parse(row.GroupPath) as string[], row.RootPath)
  const tempo = tempoForLoop(row.Name, folderName, siblings.map((s) => s.Name), durationSec, projectBpm)
  return tempo.bars ?? 1
}

function renamed(rifff: Rifff, name: string): Rifff {
  return { ...rifff, name, stems: rifff.stems.map((stem) => ({ ...stem, name })) }
}

/**
 * IMPORT's "import to project" for linked loops: one one-stem loop rifff
 * per loop, built the way `+ sample`'s loop import builds one today
 * (importOneShot.ts's importLoop). An irregular loop imports the same way,
 * at its nearest bar count -- which is also what importDiscoverLoopSeed
 * does with a length it cannot fit. Returned in selection order. A loop
 * that cannot be imported is skipped, never fatal to the rest.
 */
export async function importLinkedLoops(
  db: Database.Database,
  loopIds: string[],
  projectBpm: number,
  runWithDecoder: RunWithDecoder = withEngineDecoder
): Promise<Rifff[]> {
  if (loopIds.length === 0) return []
  const byId = new Map(rowsForIds(db, loopIds).map((row) => [row.LoopId, row]))
  const ordered = loopIds
    .map((id) => byId.get(id))
    .filter((row): row is LoopFileRow => row !== undefined)

  const results = new Map<string, Rifff>()
  const toDecode: LoopFileRow[] = []
  for (const row of ordered) {
    if (!row.Path.toLowerCase().endsWith('.wav')) {
      toDecode.push(row)
      continue
    }
    const { bars } = loopEntryFromRow(row)
    if (bars === null) continue // no readable header, so importLoop would refuse it too
    const rifff = importLoop(row.Path, bars)
    if (rifff) results.set(row.LoopId, renamed(rifff, row.Name))
  }

  if (toDecode.length > 0) {
    try {
      await runWithDecoder(async (decode) => {
        for (const row of toDecode) {
          const rifff = await importLoopViaDecoder(
            row.Path,
            row.Name,
            (durationSec) => barsForDecodedLoop(db, row, durationSec, projectBpm),
            decode
          )
          if (rifff) results.set(row.LoopId, rifff)
        }
      })
    } catch (err) {
      console.error('loopFolderImport: could not start the decoder:', err)
    }
  }

  return ordered
    .map((row) => results.get(row.LoopId))
    .filter((rifff): rifff is Rifff => rifff !== undefined)
}
```

- [ ] **Step 8: Run them to verify they pass, and add the CI exclusion**

Run: `npx vitest run src/main/loopFolderImport.test.ts src/main/importOneShot.test.ts`
Expected: PASS.

In `vitest.config.ts`, add after `'src/main/loopFolderScan.test.ts',`:

```ts
          'src/main/loopFolderImport.test.ts',
```

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/main/importOneShot.ts src/main/importOneShot.test.ts src/main/loopFolderImport.ts src/main/loopFolderImport.test.ts vitest.config.ts`
Expected: clean, 0 errors 0 warnings.

```bash
git add src/main/importOneShot.ts src/main/importOneShot.test.ts src/main/loopFolderImport.ts src/main/loopFolderImport.test.ts vitest.config.ts
git commit -m "linked loops import the way + sample does, any format through the engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

---

### Task 7: IPC channels and preload entries

**Files:**
- Modify: `src/main/index.ts`, `src/preload/index.ts`

Shapes are in the "IPC surface" table above.

- [ ] **Step 1: Main handlers**

In `src/main/index.ts`, add to the imports (beside the `./importOneShot` import block):

```ts
import { linkLoopFolder, listLoopFolders, setLoopTempoOverride, unlinkLoopFolder } from './loopFolders'
import { recordLoopDuration, rescanAllLoopFolders, rescanLoopFolder } from './loopFolderScan'
import { importLinkedLoops } from './loopFolderImport'
import type { LinkLoopFolderResult } from '@shared/loopFolderTypes'
```

Find this handler:

```ts
  ipcMain.handle('import-loop', (_event, path: string, barCount: number) => {
    return importLoop(path, barCount)
  })
```

Insert directly after it:

```ts
  // Linked loop folders (docs/superpowers/specs/2026-10-01-import-loop-
  // folders-design.md). The picker is the existing pick-folder. Everything
  // here is the own library db; the folders themselves are only read.
  ipcMain.handle('loop-folders-list', () => listLoopFolders(openOwnRiffLibraryDb()))

  ipcMain.handle(
    'loop-folders-link',
    async (_event, rootPath: string, projectBpm: number): Promise<LinkLoopFolderResult> => {
      const db = openOwnRiffLibraryDb()
      const linked = linkLoopFolder(db, rootPath)
      if (!linked.ok) return linked
      await rescanLoopFolder(db, linked.folder.rootPath, projectBpm)
      const folder = listLoopFolders(db).find((f) => f.rootPath === linked.folder.rootPath)
      return folder ? { ok: true, folder } : linked
    }
  )

  ipcMain.handle('loop-folders-unlink', (_event, rootPath: string) =>
    unlinkLoopFolder(openOwnRiffLibraryDb(), rootPath)
  )

  ipcMain.handle('loop-folders-rescan', async (_event, projectBpm: number) => {
    const db = openOwnRiffLibraryDb()
    await rescanAllLoopFolders(db, projectBpm)
    return listLoopFolders(db)
  })

  ipcMain.handle('loop-folders-set-tempo', (_event, loopId: string, bpm: number | null) =>
    setLoopTempoOverride(openOwnRiffLibraryDb(), loopId, bpm)
  )

  ipcMain.handle(
    'loop-folders-report-duration',
    (_event, loopId: string, durationSec: number, projectBpm: number) =>
      recordLoopDuration(openOwnRiffLibraryDb(), loopId, durationSec, projectBpm)
  )

  ipcMain.handle('loop-folders-import', (_event, loopIds: string[], projectBpm: number) =>
    importLinkedLoops(openOwnRiffLibraryDb(), loopIds, projectBpm)
  )
```

`openOwnRiffLibraryDb` is already imported in `index.ts`. Confirm with `grep -n "openOwnRiffLibraryDb" src/main/index.ts | head -3`.

- [ ] **Step 2: Preload bridge**

In `src/preload/index.ts`, add to the type imports at the top:

```ts
import type { LinkLoopFolderResult, LoopEntry, LoopFolderListing } from '@shared/loopFolderTypes'
```

Find:

```ts
  pickRifffImportPaths: (): Promise<string[]> => ipcRenderer.invoke('pick-rifff-import-paths'),
```

Insert directly after it:

```ts
  // Linked loop folders -- see the loop-folders-* handlers in main/index.ts.
  // Pick with pickFolder above, then link the path.
  loopFoldersList: (): Promise<LoopFolderListing[]> => ipcRenderer.invoke('loop-folders-list'),
  loopFoldersLink: (rootPath: string, projectBpm: number): Promise<LinkLoopFolderResult> =>
    ipcRenderer.invoke('loop-folders-link', rootPath, projectBpm),
  loopFoldersUnlink: (rootPath: string): Promise<void> =>
    ipcRenderer.invoke('loop-folders-unlink', rootPath),
  loopFoldersRescan: (projectBpm: number): Promise<LoopFolderListing[]> =>
    ipcRenderer.invoke('loop-folders-rescan', projectBpm),
  loopFoldersSetTempo: (loopId: string, bpm: number | null): Promise<LoopEntry | null> =>
    ipcRenderer.invoke('loop-folders-set-tempo', loopId, bpm),
  loopFoldersReportDuration: (
    loopId: string,
    durationSec: number,
    projectBpm: number
  ): Promise<LoopEntry | null> =>
    ipcRenderer.invoke('loop-folders-report-duration', loopId, durationSec, projectBpm),
  loopFoldersImport: (loopIds: string[], projectBpm: number): Promise<Rifff[]> =>
    ipcRenderer.invoke('loop-folders-import', loopIds, projectBpm),
```

`Rifff` is already imported in that file. `RifffApi` is `typeof api`, so `window.rifffApi` picks these up with no change to `index.d.ts`.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/main/index.ts src/preload/index.ts`
Expected: clean, 0 errors 0 warnings.

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "loop folders over ipc: list, link, unlink, rescan, tempo, length, import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

---

### Task 8: Folders beside the jams: link, unlink, rescan and the unavailable state

**Files:**
- Create: `src/renderer/src/state/useLoopFolders.ts`
- Create: `src/renderer/src/components/LoopFolderSidebar.tsx`
- Create: `src/renderer/src/components/LoopFolderPane.tsx` (header and unavailable state only; Task 9 fills it)
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

**Placement:**
- **Sidebar.** Linked folders sit in the jam sidebar, in a `loops` section between the filter inputs and the jam list. The section holds `+ folder` and `rescan`. That is "a top-level entry beside the jams".
- **Selecting.** Selecting a folder clears the jam selection and shows the folder in the right-hand pane. Selecting a jam hides it again.
- **Rescan on open.** The rescan runs when IMPORT opens, and only in browse mode.

- [ ] **Step 1: The hook**

Create `src/renderer/src/state/useLoopFolders.ts`:

```ts
// src/renderer/src/state/useLoopFolders.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LinkLoopFolderRefusal,
  LoopEntry,
  LoopFolderListing
} from '@shared/loopFolderTypes'

export interface LoopFolders {
  folders: LoopFolderListing[]
  scanning: boolean
  /** Why the last link was refused, shown under the buttons; cleared by the next try. */
  linkRefusal: LinkLoopFolderRefusal | null
  /** Picks a folder and links it. Resolves the linked root, or null. */
  link: () => Promise<string | null>
  unlink: (rootPath: string) => Promise<void>
  rescan: () => Promise<void>
  /** Swaps one loop's entry in place (tempo corrected, length reported). */
  replaceLoop: (entry: LoopEntry) => void
}

function byName(a: LoopFolderListing, b: LoopFolderListing): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** Linked loop folders for IMPORT. Shows the cached listing at once, then
 * rescans every folder when IMPORT opens (spec, "Staying current"). The
 * project tempo is read when a scan starts, not tracked: a tempo change
 * mid-session is not a reason to rescan. */
export function useLoopFolders(projectBpm: number, rescanOnOpen: boolean): LoopFolders {
  const [folders, setFolders] = useState<LoopFolderListing[]>([])
  const [scanning, setScanning] = useState(false)
  const [linkRefusal, setLinkRefusal] = useState<LinkLoopFolderRefusal | null>(null)
  const projectBpmRef = useRef(projectBpm)
  useEffect(() => {
    projectBpmRef.current = projectBpm
  }, [projectBpm])

  const rescan = useCallback(async (): Promise<void> => {
    setScanning(true)
    try {
      setFolders(await window.rifffApi.loopFoldersRescan(projectBpmRef.current))
    } catch (err) {
      console.error('useLoopFolders: rescan failed:', err)
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .loopFoldersList()
      .then((cached) => {
        if (cancelled) return
        setFolders(cached)
        if (rescanOnOpen && cached.length > 0) void rescan()
      })
      .catch((err) => console.error('useLoopFolders: list failed:', err))
    return () => {
      cancelled = true
    }
  }, [rescan, rescanOnOpen])

  const link = useCallback(async (): Promise<string | null> => {
    setLinkRefusal(null)
    const picked = await window.rifffApi.pickFolder()
    if (!picked) return null
    setScanning(true)
    try {
      const result = await window.rifffApi.loopFoldersLink(picked, projectBpmRef.current)
      if (!result.ok) {
        setLinkRefusal(result.reason)
        return null
      }
      setFolders((prev) =>
        [...prev.filter((f) => f.rootPath !== result.folder.rootPath), result.folder].sort(byName)
      )
      return result.folder.rootPath
    } catch (err) {
      console.error('useLoopFolders: link failed:', err)
      return null
    } finally {
      setScanning(false)
    }
  }, [])

  const unlink = useCallback(async (rootPath: string): Promise<void> => {
    await window.rifffApi.loopFoldersUnlink(rootPath)
    setFolders((prev) => prev.filter((f) => f.rootPath !== rootPath))
  }, [])

  const replaceLoop = useCallback((entry: LoopEntry): void => {
    setFolders((prev) =>
      prev.map((f) =>
        f.rootPath !== entry.rootPath
          ? f
          : { ...f, loops: f.loops.map((l) => (l.loopId === entry.loopId ? entry : l)) }
      )
    )
  }, [])

  return { folders, scanning, linkRefusal, link, unlink, rescan, replaceLoop }
}
```

- [ ] **Step 2: The sidebar section**

Create `src/renderer/src/components/LoopFolderSidebar.tsx`:

```tsx
// src/renderer/src/components/LoopFolderSidebar.tsx
import { useState } from 'react'
import type { LinkLoopFolderRefusal, LoopFolderListing } from '@shared/loopFolderTypes'
import { ContextMenu } from './ContextMenu'
import { LoadingLoader } from './LoadingLoader'

const SMALL_BUTTON: React.CSSProperties = {
  height: 20,
  padding: '0 6px',
  fontSize: 10,
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)',
  border: '1px solid var(--ra-border)',
  borderRadius: 0,
  cursor: 'pointer'
}

/** The linked loop folders, at the top of IMPORT's jam sidebar. A folder
 * whose drive is unplugged stays listed, greyed, until it is back. Unlink
 * is on right-click, as "remove from sync" is for a jam. */
export function LoopFolderSidebar({
  folders,
  scanning,
  linkRefusal,
  selectedRootPath,
  onSelect,
  onLink,
  onRescan,
  onUnlink
}: {
  folders: LoopFolderListing[]
  scanning: boolean
  linkRefusal: LinkLoopFolderRefusal | null
  selectedRootPath: string | null
  onSelect: (rootPath: string) => void
  onLink: () => Promise<void>
  onRescan: () => Promise<void>
  onUnlink: (rootPath: string) => Promise<void>
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; rootPath: string } | null>(null)

  return (
    <div style={{ borderBottom: '1px solid var(--ra-border)', padding: '6px 0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px 4px' }}>
        <span className="ra-eyebrow" style={{ flex: 1 }}>
          loops
        </span>
        {scanning && <LoadingLoader size={10} />}
        <button onClick={() => void onLink()} data-tooltip="link a folder" style={SMALL_BUTTON}>
          + folder
        </button>
        {folders.length > 0 && (
          <button
            onClick={() => void onRescan()}
            disabled={scanning}
            data-tooltip="check for changes"
            style={{ ...SMALL_BUTTON, color: scanning ? 'var(--ra-text-4)' : 'var(--ra-text-2)' }}
          >
            rescan
          </button>
        )}
      </div>
      {linkRefusal && (
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', padding: '0 6px 4px' }}>
          {linkRefusal}
        </div>
      )}
      {folders.map((folder) => {
        const selected = folder.rootPath === selectedRootPath
        return (
          <button
            key={folder.rootPath}
            onClick={() => onSelect(folder.rootPath)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, rootPath: folder.rootPath })
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              textAlign: 'left',
              padding: '5px 6px',
              fontSize: 11,
              border: 'none',
              borderRadius: 0,
              background: selected ? 'var(--ra-bg-row-active)' : 'transparent',
              color: !folder.available
                ? 'var(--ra-text-4)'
                : selected
                  ? 'var(--ra-text)'
                  : 'var(--ra-text-2)'
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
              {folder.name}
            </span>
            {folder.available && (
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', flexShrink: 0 }}>
                {folder.loops.length}
              </span>
            )}
          </button>
        )
      })}
      {/* Inside the modal's own stacking context, like LibraryBrowser's jam
          menu -- rendered as a sibling of the modal it would sit behind it. */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[{ label: 'unlink folder', onClick: () => void onUnlink(menu.rootPath) }]}
        />
      )}
    </div>
  )
}
```

Check how existing tooltips are attached: `grep -n "data-tooltip" src/renderer/src/components/LibraryBrowser.tsx | head -3`. The close button uses `data-tooltip`, so this matches.

- [ ] **Step 3: The pane, header and unavailable state**

Create `src/renderer/src/components/LoopFolderPane.tsx`:

```tsx
// src/renderer/src/components/LoopFolderPane.tsx
import type { LoopFolderListing } from '@shared/loopFolderTypes'

/** The right-hand pane for a linked loop folder. */
export function LoopFolderPane({ folder }: { folder: LoopFolderListing }): React.JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ margin: '10px 12px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--ra-text)' }}>{folder.name}</span>
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
            {folder.available ? `${folder.loops.length} loops` : 'unavailable'}
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--ra-text-3)', marginTop: 2 }}>{folder.rootPath}</div>
      </div>
      {!folder.available && (
        <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
          folder not found — plug its drive back in, then rescan
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Mount both in `LibraryBrowser.tsx`**

**4a. Imports.** Add next to the other component imports, below `import { ContextMenu } from './ContextMenu'`:

```tsx
import { LoopFolderSidebar } from './LoopFolderSidebar'
import { LoopFolderPane } from './LoopFolderPane'
import { useLoopFolders } from '../state/useLoopFolders'
```

**4b. State.** Find:

```tsx
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)
```

Insert after it:

```tsx
  // A linked loop folder shown in the right-hand pane. Only shown while no
  // jam is selected, so picking a jam (or "go to rifff ID") hides it with
  // no extra bookkeeping.
  const [selectedLoopRoot, setSelectedLoopRoot] = useState<string | null>(null)
```

**4c. The hook and the derived selection.** Find:

```tsx
  const appState = useAppState()
```

Insert after it:

```tsx
  // Rescanned when IMPORT opens (spec, "Staying current") -- the browse
  // half only; opening on discover never touches the loop folders.
  const loopFolders = useLoopFolders(appState.bpm, initialMode === 'browse')
  const selectedLoopFolder =
    selectedJamCID === null && selectedLoopRoot !== null
      ? (loopFolders.folders.find((f) => f.rootPath === selectedLoopRoot) ?? null)
      : null
```

**4d. The sidebar section.** Find:

```tsx
                  {sidebarJams.map((jam) => {
```

Insert directly before it:

```tsx
                  <LoopFolderSidebar
                    folders={loopFolders.folders}
                    scanning={loopFolders.scanning}
                    linkRefusal={loopFolders.linkRefusal}
                    selectedRootPath={selectedLoopFolder?.rootPath ?? null}
                    onSelect={(rootPath) => {
                      setSelectedJamCID(null)
                      setSelectedLoopRoot(rootPath)
                    }}
                    onLink={async () => {
                      const rootPath = await loopFolders.link()
                      if (rootPath) {
                        setSelectedJamCID(null)
                        setSelectedLoopRoot(rootPath)
                      }
                    }}
                    onRescan={loopFolders.rescan}
                    onUnlink={async (rootPath) => {
                      await loopFolders.unlink(rootPath)
                      if (selectedLoopRoot === rootPath) setSelectedLoopRoot(null)
                    }}
                  />
```

**4e. The pane.** Find:

```tsx
                  {selectedJamCID === null && (
                    <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
                      select a jam to browse its rifffs
                    </div>
                  )}
```

Replace it with:

```tsx
                  {selectedJamCID === null && selectedLoopFolder === null && (
                    <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
                      select a jam to browse its rifffs
                    </div>
                  )}
                  {selectedLoopFolder !== null && (
                    <LoopFolderPane key={selectedLoopFolder.rootPath} folder={selectedLoopFolder} />
                  )}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/renderer/src/state/useLoopFolders.ts src/renderer/src/components/LoopFolderSidebar.tsx src/renderer/src/components/LoopFolderPane.tsx src/renderer/src/components/LibraryBrowser.tsx`
Expected: clean, 0 errors 0 warnings.

```bash
git add src/renderer/src/state/useLoopFolders.ts src/renderer/src/components/LoopFolderSidebar.tsx src/renderer/src/components/LoopFolderPane.tsx src/renderer/src/components/LibraryBrowser.tsx
git commit -m "import lists linked loop folders beside the jams: + folder, rescan, unlink

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

- [ ] **Step 6: Manual check (hand to Elling, do not claim)**

With `npm run dev`, open IMPORT:
1. `+ folder` opens a folder picker. Pick `~/Downloads/Amen Breaks Compilation`. It appears under `loops` with a count of 80, and its pane shows the name, `80 loops` and the path.
2. Link it again. `already linked` shows under the buttons. Link `Amen Breaks Volume 1` inside it: `inside a linked folder`.
3. Right-click the folder, then `unlink folder`. It disappears. Nothing in `~/Downloads` changed.
4. Close and reopen IMPORT. The folder is listed straight away, and the spinner shows briefly while it rescans.

---

### Task 9: The loop tree: rows, waveforms, preview, multi-select and import

**Files:**
- Modify (whole file replaced): `src/renderer/src/components/LoopFolderPane.tsx`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

**What the pane does:**
- **Preview** follows the selection's anchor, through `startPreviewLoop` and `registerActivePreview`, the path every IMPORT stem uses. Starting any other preview anywhere stops this one.
- **Waveforms** come from `<Waveform>` (`peakCache`). They are only mounted for rows in open groups, so a pack does not decode all at once.
- **Unmeasured rows.** A visible row with no length yet (non-WAV) is decoded once through `decodeStemFile`, which shares the waveform's decode. Its length is then reported to main.
- **Rows are `div`s, not `button`s,** because Task 10 puts an input inside each.

- [ ] **Step 1: Replace `LoopFolderPane.tsx`**

Replace the whole of `src/renderer/src/components/LoopFolderPane.tsx` with:

```tsx
// src/renderer/src/components/LoopFolderPane.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoopEntry, LoopFolderListing } from '@shared/loopFolderTypes'
import type { Rifff } from '@shared/types'
import {
  buildLoopGroupTree,
  countLoopsInGroup,
  defaultExpandedGroupKeys,
  flattenLoopTreeOrder,
  type LoopGroupNode
} from '@shared/loopFolderTree'
import {
  EMPTY_LOOP_SELECTION,
  loopBarsLabel,
  loopTempoLabel,
  nextLoopSelection,
  type LoopSelection
} from '@shared/loopFolderView'
import { getAudioContext } from '../audio/peakCache'
import { decodeStemFile } from '../audio/decodeStemFile'
import {
  registerActivePreview,
  startPreviewLoop,
  stopPreviewSources,
  unregisterActivePreview
} from '../audio/previewLoop'
import { useDispatch, usePlaying } from '../state/StoreContext'
import { useBusy } from '../state/BusyContext'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'

const INDENT_PX = 12

/** One loop. A div, not a button: the tempo cell inside it becomes an
 * input, and an input inside a button is invalid. Waveform colour is the
 * 'fx' type colour -- a loop imports as type 'fx', so this is the colour
 * it will have on the shelf; no new colour. */
function LoopRow({
  loop,
  depth,
  selected,
  anchor,
  onClick
}: {
  loop: LoopEntry
  depth: number
  selected: boolean
  anchor: boolean
  onClick: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const tempo = loopTempoLabel(loop)
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: `0 12px 0 ${12 + depth * INDENT_PX}px`,
        cursor: 'pointer',
        fontSize: 11,
        background: selected ? 'var(--ra-bg-row-active)' : 'transparent',
        color: anchor ? 'var(--ra-text)' : 'var(--ra-text-2)'
      }}
    >
      <div style={{ position: 'relative', width: 120, height: 22, flexShrink: 0 }}>
        <Waveform path={loop.path} color={typeColorVar('fx')} />
      </div>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {loop.name}
      </span>
      <span
        style={{
          width: 44,
          textAlign: 'right',
          color: tempo.guessed ? 'var(--ra-text-3)' : 'inherit'
        }}
      >
        {tempo.text}
      </span>
      <span style={{ width: 52, textAlign: 'right', color: 'var(--ra-text-3)' }}>
        {loopBarsLabel(loop)}
      </span>
      <span style={{ width: 52, fontSize: 9, color: 'var(--ra-text-3)' }}>
        {loop.irregular ? 'irregular' : ''}
      </span>
    </div>
  )
}

/** The right-hand pane for a linked loop folder: its groups as a tree,
 * each loop a row, the import button at the foot. */
export function LoopFolderPane({
  folder,
  projectBpm,
  onImported,
  onLoopUpdated
}: {
  folder: LoopFolderListing
  projectBpm: number
  /** LibraryBrowser's own onImported -- the downbeat picker opens for the
   * batch exactly as it does after importing rifffs. */
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  onLoopUpdated: (entry: LoopEntry) => void
}): React.JSX.Element {
  const dispatch = useDispatch()
  const playing = usePlaying()
  const setBusy = useBusy()

  const tree = useMemo(() => buildLoopGroupTree(folder.loops), [folder.loops])
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedGroupKeys(tree))
  )
  const visibleLoops = useMemo(
    () => flattenLoopTreeOrder(tree, (key) => expanded.has(key)),
    [tree, expanded]
  )
  const visibleIds = useMemo(() => visibleLoops.map((l) => l.loopId), [visibleLoops])
  const loopsById = useMemo(
    () => new Map(folder.loops.map((l) => [l.loopId, l])),
    [folder.loops]
  )
  const [selection, setSelection] = useState<LoopSelection>(EMPTY_LOOP_SELECTION)

  function toggleGroup(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ---- preview: the anchor loops, the same way a selected rifff does ----
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewTokenRef = useRef(0)
  const stopPreview = useCallback((): void => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])
  useEffect(() => () => stopPreview(), [stopPreview])

  useEffect(() => {
    stopPreview()
    const anchor = selection.anchor !== null ? loopsById.get(selection.anchor) : undefined
    if (!anchor || !folder.available) return
    let cancelled = false
    if (playing) dispatch({ type: 'PAUSE' })
    void startPreviewLoop(getAudioContext(), [{ path: anchor.path, gain: 1 }], () => cancelled).then(
      (sources) => {
        if (cancelled || sources.length === 0) return
        previewSourcesRef.current.push(...sources)
        previewTokenRef.current = registerActivePreview(stopPreview)
      }
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs on a new anchor only. loopsById changes whenever a row's length or tempo is filled in, and that must not restart a playing preview; transport state is read at the moment a preview starts, as LibraryBrowser's rifff preview does.
  }, [selection.anchor])

  // ---- lengths main could not read (non-WAV): measured from our decode ----
  const reportedRef = useRef<Set<string>>(new Set())
  const unmeasured = useMemo(
    () => visibleLoops.filter((l) => l.durationSec === null),
    [visibleLoops]
  )
  useEffect(() => {
    if (!folder.available) return
    let cancelled = false
    void (async () => {
      for (const loop of unmeasured) {
        if (cancelled) return
        if (reportedRef.current.has(loop.loopId)) continue
        reportedRef.current.add(loop.loopId)
        try {
          // Shares the Waveform's own in-flight decode of the same path.
          const buffer = await decodeStemFile(loop.path)
          const updated = await window.rifffApi.loopFoldersReportDuration(
            loop.loopId,
            buffer.duration,
            projectBpm
          )
          // Applied even if this run was superseded: main has stored it.
          if (updated) onLoopUpdated(updated)
        } catch (err) {
          // The renderer cannot decode every format the engine can. The
          // row keeps "? bars", and import still works through the engine.
          console.warn(`LoopFolderPane: could not measure ${loop.path}:`, err)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [unmeasured, folder.available, projectBpm, onLoopUpdated])

  // ---- import ----
  const allOrderedIds = useMemo(
    () => flattenLoopTreeOrder(tree, () => true).map((l) => l.loopId),
    [tree]
  )
  async function handleImport(): Promise<void> {
    const ids = allOrderedIds.filter((id) => selection.selected.has(id))
    if (ids.length === 0) return
    setBusy(ids.length > 1 ? 'importing loops…' : 'importing loop…')
    try {
      const rifffs = await window.rifffApi.loopFoldersImport(ids, projectBpm)
      for (const rifff of rifffs) dispatch({ type: 'ADD_TO_SHELF', rifff })
      if (rifffs.length > 0) onImported(rifffs.map((r) => r.groupId), rifffs)
    } catch (err) {
      console.error('LoopFolderPane: import failed:', err)
    } finally {
      setBusy(null)
    }
  }

  function renderGroup(node: LoopGroupNode<LoopEntry>): React.JSX.Element {
    const open = node.depth === 0 || expanded.has(node.key)
    return (
      <div key={node.key}>
        {node.depth > 0 && (
          <button
            onClick={() => toggleGroup(node.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              textAlign: 'left',
              height: 24,
              padding: `0 12px 0 ${12 + (node.depth - 1) * INDENT_PX}px`,
              border: 'none',
              borderRadius: 0,
              background: 'transparent',
              color: 'var(--ra-text-2)',
              fontSize: 10
            }}
          >
            <span style={{ width: 10 }}>{open ? '−' : '+'}</span>
            <span className="ra-eyebrow" style={{ flex: 1 }}>
              {node.name}
            </span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{countLoopsInGroup(node)}</span>
          </button>
        )}
        {open &&
          node.loops.map((loop) => (
            <LoopRow
              key={loop.loopId}
              loop={loop}
              depth={node.depth}
              selected={selection.selected.has(loop.loopId)}
              anchor={selection.anchor === loop.loopId}
              onClick={(e) =>
                setSelection((prev) =>
                  nextLoopSelection(prev, loop.loopId, visibleIds, {
                    shift: e.shiftKey,
                    toggle: e.metaKey || e.ctrlKey
                  })
                )
              }
            />
          ))}
        {open && node.children.map(renderGroup)}
      </div>
    )
  }

  const selectedCount = selection.selected.size
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ margin: '10px 12px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--ra-text)' }}>{folder.name}</span>
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
            {folder.available ? `${folder.loops.length} loops` : 'unavailable'}
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--ra-text-3)', marginTop: 2 }}>{folder.rootPath}</div>
      </div>

      {!folder.available ? (
        <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
          folder not found — plug its drive back in, then rescan
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {folder.loops.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
                no playable loops in this folder
              </div>
            ) : (
              renderGroup(tree)
            )}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              margin: '10px 12px',
              borderTop: '1px solid var(--ra-border)',
              paddingTop: 10
            }}
          >
            <button
              onClick={() => void handleImport()}
              disabled={selectedCount === 0}
              style={{
                height: 34,
                borderRadius: 0,
                padding: '0 20px',
                fontSize: 13,
                border: '2px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: selectedCount === 0 ? 'var(--ra-text-4)' : 'var(--ra-text)'
              }}
            >
              {selectedCount > 1 ? `import ${selectedCount} loops to project` : 'import to project'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

The import button reuses the rifff browser's existing copy and style (`import to project` / `import N … to project`) rather than inventing a second import affordance.

- [ ] **Step 2: Pass the pane's props from `LibraryBrowser.tsx`**

Find, from Task 8:

```tsx
                    <LoopFolderPane key={selectedLoopFolder.rootPath} folder={selectedLoopFolder} />
```

Replace it with:

```tsx
                    <LoopFolderPane
                      key={selectedLoopFolder.rootPath}
                      folder={selectedLoopFolder}
                      projectBpm={appState.bpm}
                      onImported={onImported}
                      onLoopUpdated={loopFolders.replaceLoop}
                    />
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/renderer/src/components/LoopFolderPane.tsx src/renderer/src/components/LibraryBrowser.tsx`
Expected: clean, 0 errors 0 warnings.

`stopPreview` deliberately sets no state, so calling it at the top of the preview effect does not trip `react-hooks/set-state-in-effect`. If that rule flags anything else, restructure so state is only set in promise callbacks or event handlers. Do not add a disable comment.

```bash
git add src/renderer/src/components/LoopFolderPane.tsx src/renderer/src/components/LibraryBrowser.tsx
git commit -m "a linked folder's loops: groups, waveforms, preview, multi-select, import to project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

- [ ] **Step 4: Manual check (hand to Elling, do not claim)**

Run `npm run dev` with `Amen Breaks Compilation` linked.
1. **Groups.** Three groups show, all collapsed: `Amen Breaks Volume 1` (20), `Amen Breaks Volume 2` (40) and `Amen Breaks Volume 3` (20). There is no `WAV` or `REX2` level, and no `info.txt`.
2. **Volume 3 tempos.** Open it. `Creek Break 160` shows `160` in full text, `2 bars` and a waveform.
3. **Volume 2 tempos.** No name there carries a tempo, so every row shows a dim `~` tempo from its length.
4. **Preview.** Click a loop: it loops, and the arrangement pauses if it was playing. Click another: the first stops.
5. **Multi-select.** Shift-click selects a range. Cmd-click adds or removes one. Collapsing a group keeps its selected loops selected.
6. **Import.** `import 3 loops to project` puts three one-stem rifffs on the shelf and opens the downbeat picker, as a rifff import does. They play in time at the project tempo.
7. **Unavailable.** Unplug (or rename) the folder's location and click `rescan`. It greys in the sidebar, and its pane says `folder not found — plug its drive back in, then rescan`. Put it back and rescan: it returns.

---

### Task 10: Tempo correction

**Files:**
- Modify: `src/shared/loopFolderView.ts`, `src/shared/loopFolderView.test.ts`
- Create: `src/renderer/src/components/LoopTempoCell.tsx`
- Modify: `src/renderer/src/components/LoopFolderPane.tsx`

**Interaction:**
- Click a row's tempo to edit it.
- **Enter** saves. **Enter on an empty box** clears the correction and brings the guess back.
- **Escape** or clicking away cancels.

Blur cancels rather than saves, so Enter plus the unmount blur can never save twice.

- [ ] **Step 1: Write the failing tests**

In `src/shared/loopFolderView.test.ts`, add `parseTempoInput` to the import list from `'./loopFolderView'`, then append:

```ts
describe('parseTempoInput', () => {
  it('reads a tempo, trimming space', () => {
    expect(parseTempoInput('165')).toBe(165)
    expect(parseTempoInput('87.5')).toBe(87.5)
    expect(parseTempoInput(' 170 ')).toBe(170)
  })

  it('reads an empty box as "clear the correction"', () => {
    expect(parseTempoInput('')).toBeNull()
    expect(parseTempoInput('   ')).toBeNull()
  })

  it('accepts 40 to 300 inclusive, and nothing else', () => {
    expect(parseTempoInput('40')).toBe(40)
    expect(parseTempoInput('300')).toBe(300)
    expect(parseTempoInput('39')).toBe('invalid')
    expect(parseTempoInput('301')).toBe('invalid')
    expect(parseTempoInput('abc')).toBe('invalid')
    expect(parseTempoInput('Infinity')).toBe('invalid')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/loopFolderView.test.ts`
Expected: FAIL, `parseTempoInput` is not exported.

- [ ] **Step 3: Implement `parseTempoInput`**

In `src/shared/loopFolderView.ts`, change the types import to:

```ts
import {
  MAX_LOOP_TEMPO_OVERRIDE,
  MIN_LOOP_TEMPO_OVERRIDE,
  type LoopEntry
} from './loopFolderTypes'
```

and append:

```ts
/** The tempo box: a number in range sets a correction, an empty box
 * clears it (null), anything else is refused. Same range main enforces. */
export function parseTempoInput(text: string): number | null | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const bpm = Number(trimmed)
  return Number.isFinite(bpm) && bpm >= MIN_LOOP_TEMPO_OVERRIDE && bpm <= MAX_LOOP_TEMPO_OVERRIDE
    ? bpm
    : 'invalid'
}
```

Run: `npx vitest run src/shared/loopFolderView.test.ts`
Expected: PASS.

- [ ] **Step 4: The cell**

Create `src/renderer/src/components/LoopTempoCell.tsx`:

```tsx
// src/renderer/src/components/LoopTempoCell.tsx
import { useState } from 'react'
import type { LoopEntry } from '@shared/loopFolderTypes'
import { loopTempoLabel, parseTempoInput } from '@shared/loopFolderView'

/** A loop row's tempo, editable in place. A guess reads `~165` in dimmer
 * text; a corrected tempo reads plainly, like a filename tempo. */
export function LoopTempoCell({
  loop,
  onSetTempo
}: {
  loop: LoopEntry
  onSetTempo: (bpm: number | null) => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const tempo = loopTempoLabel(loop)

  async function commit(): Promise<void> {
    const parsed = parseTempoInput(draft)
    setEditing(false)
    if (parsed !== 'invalid') await onSetTempo(parsed)
  }

  if (!editing) {
    return (
      <span
        data-tooltip="set tempo"
        onClick={(e) => {
          e.stopPropagation()
          setDraft(loop.source === 'user' && loop.bpm !== null ? String(loop.bpm) : '')
          setEditing(true)
        }}
        style={{
          width: 44,
          textAlign: 'right',
          cursor: 'text',
          color: tempo.guessed ? 'var(--ra-text-3)' : 'inherit'
        }}
      >
        {tempo.text}
      </span>
    )
  }

  return (
    <input
      autoFocus
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={tempo.text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      onBlur={() => setEditing(false)}
      style={{
        width: 44,
        height: 20,
        fontSize: 11,
        textAlign: 'right',
        background: 'var(--ra-bg-row-active)',
        color: 'var(--ra-text)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        padding: '0 4px',
        boxSizing: 'border-box'
      }}
    />
  )
}
```

The box opens empty, with the current tempo as its placeholder, unless the tempo is already the user's own. So Enter on an untouched box over a guess saves nothing; it clears a correction that does not exist.

- [ ] **Step 5: Wire it into the row**

In `src/renderer/src/components/LoopFolderPane.tsx`, make five edits.

**5a.** Add the import below `import { Waveform } from './Waveform'`:

```tsx
import { LoopTempoCell } from './LoopTempoCell'
```

**5b.** In `LoopRow`'s props, change:

```tsx
  anchor,
  onClick
}: {
  loop: LoopEntry
  depth: number
  selected: boolean
  anchor: boolean
  onClick: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const tempo = loopTempoLabel(loop)
  return (
```

to:

```tsx
  anchor,
  onClick,
  onSetTempo
}: {
  loop: LoopEntry
  depth: number
  selected: boolean
  anchor: boolean
  onClick: (e: React.MouseEvent) => void
  onSetTempo: (bpm: number | null) => Promise<void>
}): React.JSX.Element {
  return (
```

**5c.** In `LoopRow`'s JSX, replace:

```tsx
      <span
        style={{
          width: 44,
          textAlign: 'right',
          color: tempo.guessed ? 'var(--ra-text-3)' : 'inherit'
        }}
      >
        {tempo.text}
      </span>
```

with:

```tsx
      <LoopTempoCell loop={loop} onSetTempo={onSetTempo} />
```

**5d.** `loopTempoLabel` is now unused in this file. Remove it from the `@shared/loopFolderView` import list.

**5e.** In `LoopFolderPane`, add above `function renderGroup`:

```tsx
  async function setTempo(loopId: string, bpm: number | null): Promise<void> {
    try {
      const updated = await window.rifffApi.loopFoldersSetTempo(loopId, bpm)
      if (updated) onLoopUpdated(updated)
    } catch (err) {
      console.error('LoopFolderPane: set tempo failed:', err)
    }
  }
```

Then in `renderGroup`'s `<LoopRow … />`, add the prop after `onClick={…}`:

```tsx
              onSetTempo={(bpm) => setTempo(loop.loopId, bpm)}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npx vitest run && npx eslint src/shared/loopFolderView.ts src/shared/loopFolderView.test.ts src/renderer/src/components/LoopTempoCell.tsx src/renderer/src/components/LoopFolderPane.tsx`
Expected: clean, 0 errors 0 warnings.

```bash
git add src/shared/loopFolderView.ts src/shared/loopFolderView.test.ts src/renderer/src/components/LoopTempoCell.tsx src/renderer/src/components/LoopFolderPane.tsx
git commit -m "a loop's tempo can be corrected in place, and the correction outlives rescans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DHmMJ6xW2CRNJywYmZPCAx"
```

- [ ] **Step 7: Manual check (hand to Elling, do not claim)**

1. In Volume 2, click a row's `~` tempo, type `160` and press Enter. It reads `160` in full text, and its bars update. If the length is not a whole power of two of bars at 160, it reads `irregular`.
2. Click `rescan`. The correction stays.
3. Click the corrected tempo again. The box opens holding `160`. Delete it and press Enter on the empty box. The `~` guess comes back.
4. Escape, or clicking away, changes nothing.
5. Clicking the tempo does not select or preview the row.

---

### Task 11: Full verification and the walkthrough

- [ ] **Step 1: Run everything**

Run: `npx vitest run && CI=1 npx vitest run && npm run typecheck && npm run lint`
Expected:
- both vitest runs pass;
- the `CI=1` run lists none of `loopFolders.test.ts`, `loopFolderScan.test.ts` or `loopFolderImport.test.ts`;
- typecheck is clean;
- lint shows exactly the 4 pre-existing warnings, none in a file this plan touched.

- [ ] **Step 2: Check the tree**

Run: `git status --short`
Expected: nothing from this plan uncommitted. `native-engine/.cache/` is pre-existing and not ours.

- [ ] **Step 3: Report to Elling**

Say what shipped, give him the walkthrough below, and state that no agent saw or heard any of it.

**Walkthrough with `~/Downloads/Amen Breaks Compilation`**

The pack is three volumes with `WAV/` and `REX2/` in each: 80 WAVs and 80 REX2 files in total, plus 4 `.DS_Store` files and one `info.txt`.
- Volume 1 has 20 `cw_amenNN_TTT.wav`, tempo in every name.
- Volume 2 has 40 `cw_amen_<word>.wav`, with no tempo anywhere.
- Volume 3 has 20 `<Name> Break TTT.wav`.

1. **Link.** Run `npm run dev`, open IMPORT, `+ folder`, and pick the pack.
   - Under `loops`: `Amen Breaks Compilation`, 80.
   - Three collapsed groups. No `WAV`, `REX2`, `info.txt` or dot files anywhere.
2. **Certain tempos.** Volume 3: `Creek Break 160` reads `160` in full text and `2 bars` (it is 3.0 s). Volume 1: `cw_amen01_175` reads `175`, `2 bars`.
3. **Guessed tempos.** Volume 2: every tempo is a dim `~` guess from the length near the project tempo. This is the volume that shows whether the guess is good enough, since nothing there names a tempo. Note any that are clearly wrong.
4. **Preview.** It loops seamlessly, and starting another preview, or selecting a rifff, stops it.
5. **Import.** Shift-select five loops and import. Five one-stem rifffs land on the shelf, and the downbeat picker opens. Place two and play: they hold tempo with the project.
6. **Correction.** Correct a Volume 2 tempo, rescan, then close and reopen IMPORT. It is still corrected. Clear it, and the guess returns.
7. **Files untouched.** `ls -la ~/Downloads/"Amen Breaks Compilation"/*/WAV | head` shows no new files and no changed dates.
8. **Removed file.** Move one WAV out of the pack, then rescan. It is gone from the list. Move it back and rescan: it returns, and keeps any correction it had.
9. **Unplugged drive.** Copy the pack to a USB stick, link it there, and eject the stick. Reopen IMPORT: that folder is greyed, with `folder not found — plug its drive back in, then rescan`. Plug it in and rescan: it returns. Also watch whether the rest of the app stays responsive during a rescan of the stick.
10. **Non-WAV.** Link a folder with an `.mp3`, a `.flac` and an `.aif` loop.
    - **mp3 and flac:** waveform, length and bars appear a moment after the group opens.
    - **aif:** Chromium may not decode AIFF. If so, it shows `? bars`, no waveform and no preview. **Import should still work**, through the engine.
    - Report what the `.aif` did.
11. **Refusals.** Linking the pack again says `already linked`, and linking one of its volumes says `inside a linked folder`.
12. **Unlink.** Right-click the folder, then `unlink folder`. It is gone, and the files are untouched.
