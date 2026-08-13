# Reaper Export + Stems Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a REAPER (`.rpp`) project export alongside the existing Ableton (`.als`) export,
group the existing stems export by bus (like Ableton already does), and fold all three export
types into one "export project…" menu item with an Ableton/Reaper/Stems format picker. Per
`docs/superpowers/specs/2026-08-13-reaper-export-design.md`.

**Architecture:** A pure text-building layer (`src/main/reaper/`) mirrors `src/main/ableton/`'s
existing shape — a small generic node-builder for RPP's nested-bracket text format, plus a pure
function mapping `AppState` to finished `.rpp` text. Two genuinely shared, format-agnostic pieces
(stem materialization into `Samples/Imported/`, and bus-name summarization) are extracted out of
their current Ableton-only homes into `src/shared/`/`src/main/` so both the Ableton and Reaper
paths use them. Orchestration (`src/main/exportReaper.ts`) mirrors `src/main/exportAbleton.ts`'s
three entry points exactly. IPC/preload/UI wiring extends the existing Ableton export pattern to
a 3-way format picker.

**Tech Stack:** Plain Node `fs`/`path`/`crypto` (no new dependencies — RPP's plain-text format
needs no XML parser), existing Electron IPC/dialog conventions, existing `packIntoTracks` interval
partitioning.

---

## Before you start

Read these real, already-committed files in full before touching anything — every task below
was written against their actual current content, not a guess:

- `src/main/ableton/buildAlsXml.ts` — the direct template for `buildRppProject.ts`'s mapping
  logic (tempo/tile/mute-region/fade math this plan reimplements as a "wire format twin", per
  this project's own `CLAUDE.md` convention: hand-synced, not code-shared).
- `src/main/ableton/alsXmlHelpers.ts` — the direct template for `rppNode.ts`'s role.
- `src/main/exportAbleton.ts` — the direct template for `exportReaper.ts`.
- `src/main/nativeExport.ts` — gets a bus-grouping change and two new entry points.
- `src/main/projectLibrary.ts` — gets two new path helpers.
- `docs/superpowers/specs/2026-08-13-reaper-export-design.md` — the approved design this plan
  implements; read it for the full rationale behind every mapping decision below.

---

### Task 1: Extract `busGroupName`/`summarizeSoundTypes`/`humanizeSoundType` into shared module

**Files:**
- Create: `src/shared/busNaming.ts`
- Create: `src/shared/busNaming.test.ts`
- Modify: `src/main/ableton/buildAlsXml.ts:576-609` (delete the three local function definitions,
  import them instead)

These three functions currently live private inside `buildAlsXml.ts`. `buildRppProject.ts` (Task
5) needs the exact same bus-name summarization, and the stems export (Task 7) needs `busId`-based
folder naming — a second and third real consumer, which is what justifies pulling this out now
rather than speculatively. `busGroupName`'s parameter type is loosened from `buildAlsXml.ts`'s own
`StemClipsResult[]` to a minimal structural shape (`{ soundType: SoundType }[]`) so both
`buildAlsXml.ts`'s `StemClipsResult` and the new `buildRppProject.ts`'s own result type satisfy it
without either file knowing about the other's types.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/shared/busNaming.test.ts
import { describe, it, expect } from 'vitest'
import { humanizeSoundType, summarizeSoundTypes, busGroupName } from './busNaming'

describe('humanizeSoundType', () => {
  it('inserts a space before each internal capital and lowercases the whole string', () => {
    expect(humanizeSoundType('extInst')).toBe('ext inst')
    expect(humanizeSoundType('audioIn')).toBe('audio in')
    expect(humanizeSoundType('drums')).toBe('drums')
  })
})

describe('summarizeSoundTypes', () => {
  it('lists types most-common-first', () => {
    expect(summarizeSoundTypes(['drums', 'drums', 'notes'])).toBe('drums, notes')
  })

  it('caps at the top 3 types', () => {
    const types = ['drums', 'notes', 'bass', 'fx', 'sampler'] as const
    const summary = summarizeSoundTypes([...types])
    expect(summary.split(', ')).toHaveLength(3)
  })

  it('returns an empty string for no types', () => {
    expect(summarizeSoundTypes([])).toBe('')
  })
})

describe('busGroupName', () => {
  it('appends a sound-type summary when it differs from the bare bus id', () => {
    expect(busGroupName('aux', [{ soundType: 'fx' }, { soundType: 'fx' }])).toBe('AUX — FX')
  })

  it('omits the summary when it would just repeat the bus id verbatim', () => {
    expect(busGroupName('drums', [{ soundType: 'drums' }, { soundType: 'drums' }])).toBe('DRUMS')
  })

  it('upper-cases the result', () => {
    expect(busGroupName('bass', [{ soundType: 'bass' }])).toBe('BASS')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/busNaming.test.ts`
Expected: FAIL — `Cannot find module './busNaming'`

- [ ] **Step 3: Implement**

```typescript
// src/shared/busNaming.ts
import type { BusId, SoundType } from './types'

/** 'extInst' -> 'ext inst', 'audioIn' -> 'audio in' -- this app's own design
 * system calls for lowercase UI copy everywhere (see CLAUDE.md); SoundType's
 * own values are camelCase identifiers, not display text, so track/folder
 * names built from them need this conversion rather than using them raw. */
export function humanizeSoundType(type: SoundType): string {
  return type.replace(/([A-Z])/g, ' $1').toLowerCase()
}

/** The most common sound type(s) among a set of stems, as a short
 * human-readable summary -- e.g. "drums, notes" -- used to make bus names
 * actually say something about what's IN them, instead of just the bare bus
 * id repeated everywhere. Capped at the top 3 types so a highly mixed bus
 * doesn't produce an unreadably long name. */
export function summarizeSoundTypes(types: SoundType[]): string {
  const counts = new Map<SoundType, number>()
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return sorted
    .slice(0, 3)
    .map(([type]) => humanizeSoundType(type))
    .join(', ')
}

/** A bus's own display name -- the bare bus id, plus a sound-type summary
 * UNLESS that summary would just repeat the bus id back verbatim (e.g. a
 * 'drums' bus made up entirely of 'drums'-typed stems gains nothing from
 * "drums — drums"). Upper-cased -- purely decorative export-side flavor
 * (Ableton group-track names, Reaper track/folder names), not this app's
 * own UI copy, so it doesn't conflict with sssketch's own
 * lowercase-everywhere design system convention. `entries` only needs a
 * `soundType` field -- both buildAlsXml.ts's StemClipsResult and
 * buildRppProject.ts's own per-stem result type satisfy this structurally,
 * without either file importing the other's types. */
export function busGroupName(busId: BusId, entries: { soundType: SoundType }[]): string {
  const summary = summarizeSoundTypes(entries.map((e) => e.soundType))
  const name = summary === busId ? busId : `${busId} — ${summary}`
  return name.toUpperCase()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/busNaming.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Update `buildAlsXml.ts` to import instead of defining locally**

In `src/main/ableton/buildAlsXml.ts`, delete lines 572-609 (the `humanizeSoundType`,
`summarizeSoundTypes`, and `busGroupName` function definitions — `uniqueSharedTrackName` at
line 611 stays, it's Ableton-specific: per-physical-track disambiguation, not reused by Reaper).
Add to the top-of-file imports (near the existing `import { packIntoTracks } from
'@shared/packIntoTracks'` line):

```typescript
import { busGroupName } from '@shared/busNaming'
```

- [ ] **Step 6: Run the full Ableton export test suite to confirm no regression**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts`
Expected: PASS (unchanged pass count — behavior is identical, only the functions' location moved)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/busNaming.ts src/shared/busNaming.test.ts src/main/ableton/buildAlsXml.ts
git commit -m "Extract bus-name summarization into shared module"
```

---

### Task 2: Extract stem materialization into a shared module

**Files:**
- Create: `src/main/exportAudioMaterialization.ts`
- Modify: `src/main/exportAbleton.ts` (remove `materializeStem` and the bulk of
  `buildAndWriteAlsProject`'s body, replace with a call into the new shared function)

`materializeStem` (single stem: cache-or-decode-then-clone) and the surrounding per-export loop
(compute unique filenames, decide whether the native engine needs spawning at all, materialize
every stem, then read back each successfully-materialized stem's real sample rate) are entirely
format-agnostic — both the Ableton and Reaper export need the exact same `Samples/Imported/`
folder full of audio, decoded/cached the same way. This is a pure refactor: behavior must not
change. There is no pre-existing test file for `exportAbleton.ts` (confirmed: `src/main/
exportAbleton.test.ts` does not exist in this codebase — its real-engine-dependent paths have
never had direct unit coverage, consistent with this codebase's own documented convention for
Electron-process-dependent code). This task does not add new tests either; it relies on
typecheck plus the final full-suite/manual-walkthrough verification (Task 10) to catch any
regression, and is scoped as a careful, behavior-preserving move, not a rewrite.

- [ ] **Step 1: Read the current file in full**

Read `src/main/exportAbleton.ts` completely before editing — you need its exact current imports
and the exact current body of `materializeStem` and `buildAndWriteAlsProject` to move correctly.

- [ ] **Step 2: Create the shared module**

```typescript
// src/main/exportAudioMaterialization.ts
import { copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import { stemKey } from '@shared/types'
import { findWavChunks } from '@shared/wavChunks'
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'
import {
  isWavPath,
  cachedStemPath,
  cloneOrCopy,
  samplesCacheDir
} from './projectLibrary'
import { readWavHeaderBytes } from './importRifff'

// Anything outside this set is unsafe (or at least unwelcome) in a filename
// across macOS/Windows/Linux -- matches nativeExport.ts's own
// sanitizeFileNamePart exactly (duplicated rather than imported: it's not
// exported from that module, and it's a five-line pure function -- not worth
// coupling these two independent export features over).
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/** Materializes one stem's audio at `destPath`, via the shared cache (see
 * projectLibrary.ts's cachedStemPath/cloneOrCopy): if this stem's own
 * cache entry already exists (same source path+size+mtime, or same LORE
 * StemCID), it's cloned straight out -- no re-read of the source, no
 * re-decode. Otherwise it's materialized into the cache first (a WAV
 * source is a plain copy; anything else -- a LORE-cached stem, whose
 * actual on-disk bytes are Endlesss's own storage codec, confirmed FLAC --
 * is decoded via the native engine's bake-stem command, which needs
 * `client` to be connected), then cloned out the same way. Returns false
 * (caller should drop this stem from the export) on any failure, including
 * "needed to decode but no engine connection was available". */
export async function materializeStem(
  path: string,
  destPath: string,
  client: EngineClient | null
): Promise<boolean> {
  const cachePath = cachedStemPath(path)
  if (!existsSync(cachePath)) {
    try {
      if (isWavPath(path)) {
        copyFileSync(path, cachePath)
      } else {
        if (!client) return false
        const result = (await client.sendAndAwaitType(
          'bake-stem',
          { path, rotationSec: 0, outputPath: cachePath },
          'bake-stem-result'
        )) as { success: boolean; error?: string }
        if (!result.success) {
          console.error(`materializeStem: native decode failed for ${path}: ${result.error}`)
          // The native side may have left a partial/empty file at
          // outputPath despite reporting failure -- don't let that poison
          // the cache for every future export of this stem (see CLAUDE.md's
          // "cache by path, evict on rejection" convention).
          if (existsSync(cachePath)) rmSync(cachePath)
          return false
        }
      }
    } catch (err) {
      // Same reasoning as above: a copy/decode that threw partway through
      // may still have left a partial file behind. Evict before rethrowing
      // so this failure doesn't silently poison the cache forever.
      if (existsSync(cachePath)) rmSync(cachePath)
      throw err
    }
  }
  cloneOrCopy(cachePath, destPath)
  return true
}

export interface MaterializedStems {
  /** stemKey -> filename (relative to `<outputDir>/Samples/Imported/`) for
   * every stem that materialized successfully. A stem whose copy/decode
   * failed is simply absent -- callers skip it rather than failing the
   * whole export. */
  stemFileNames: Map<string, string>
  /** stemKey -> the ACTUAL materialized file's own sample rate (read back
   * from its real destination file, not the original source) -- only
   * populated for stems present in stemFileNames. */
  stemSampleRates: Map<string, number>
}

/**
 * Materializes every placed stem's source audio into
 * `<outputDir>/Samples/Imported/` (via the shared cache -- see
 * materializeStem above), shared by both the Ableton and Reaper export
 * paths. Does NOT clear `Samples/Imported/` before repopulating -- a
 * caller that owns its outputDir outright and wants stale, removed-from-
 * the-arrangement stems cleaned up first is responsible for clearing it
 * itself before calling this (see exportAbletonToLibrary/
 * exportReaperToLibrary). Throws if no rifff is placed at all (nothing to
 * export).
 */
export async function materializeStemsForExport(
  state: AppState,
  outputDir: string
): Promise<MaterializedStems> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  if (placed.length === 0) {
    throw new Error('Nothing to export -- no rifffs are placed on the timeline.')
  }

  const samplesDir = join(outputDir, 'Samples', 'Imported')
  mkdirSync(samplesDir, { recursive: true })
  mkdirSync(samplesCacheDir(), { recursive: true })

  const stemFileNames = new Map<string, string>()
  const usedNames = new Map<string, number>()
  function uniqueFileName(rifffName: string, stemName: string): string {
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}`
    const count = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, count)
    return count === 1 ? `${base}.wav` : `${base}-${count}.wav`
  }

  const stemEntries: { key: string; path: string; destPath: string }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const fileName = uniqueFileName(rifff.name, stem.name)
      const entry = {
        key: stemKey(rifff.groupId, stem.slot),
        path: stem.path,
        destPath: join(samplesDir, fileName)
      }
      stemEntries.push(entry)
      stemFileNames.set(entry.key, fileName)
    }
  }

  const needsEngine = stemEntries.some(
    ({ path }) => !isWavPath(path) && !existsSync(cachedStemPath(path))
  )
  let client: EngineClient | null = null
  let engineHandle: EngineHandle | null = null
  if (needsEngine) {
    engineHandle = await spawnEngine()
    client = new EngineClient()
    try {
      await client.connect(engineHandle.port)
    } catch (err) {
      engineHandle.stop()
      throw err
    }
  }
  try {
    for (const { key, path, destPath } of stemEntries) {
      try {
        const ok = await materializeStem(path, destPath, client)
        if (!ok) stemFileNames.delete(key)
      } catch (err) {
        stemFileNames.delete(key)
        console.error(`materializeStemsForExport: failed to materialize stem from ${path}:`, err)
      }
    }
  } finally {
    client?.disconnect()
    engineHandle?.stop()
  }

  const stemSampleRates = new Map<string, number>()
  for (const [key, fileName] of stemFileNames) {
    try {
      const destPath = join(samplesDir, fileName)
      const { sampleRate } = findWavChunks(readWavHeaderBytes(destPath))
      if (sampleRate > 0) stemSampleRates.set(key, sampleRate)
    } catch (err) {
      console.error(`materializeStemsForExport: failed to read sample rate for ${fileName}:`, err)
    }
  }

  return { stemFileNames, stemSampleRates }
}
```

- [ ] **Step 3: Update `exportAbleton.ts` to use the shared module**

Replace the entire `materializeStem` function and the whole `sanitizeFileNamePart` function at
the top of `src/main/exportAbleton.ts` (both now live in the new module) with:

```typescript
import { materializeStemsForExport } from './exportAudioMaterialization'
```

Remove now-unused imports from `exportAbleton.ts`'s top (only remove ones that were used
exclusively by the code you just deleted — check each: `copyFileSync`, `mkdirSync`, `rmSync` from
`node:fs` are likely still needed elsewhere in the file for other functions; `spawnEngine`/
`EngineHandle`/`EngineClient`/`isWavPath`/`cachedStemPath`/`cloneOrCopy`/`samplesCacheDir`/
`readWavHeaderBytes`/`findWavChunks`/`stemKey` may become unused — let TypeScript's unused-import
lint tell you, don't guess).

Replace `buildAndWriteAlsProject`'s body (everything between the placed-rifffs check and the
final `buildAlsXml`/gzip/write) with a single call:

```typescript
export async function buildAndWriteAlsProject(
  state: AppState,
  outputDir: string,
  projectName: string
): Promise<void> {
  const { stemFileNames, stemSampleRates } = await materializeStemsForExport(state, outputDir)

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames, stemSampleRates)
  const gzipped = gzipSync(Buffer.from(alsXml, 'utf-8'))
  writeFileSync(join(outputDir, `${projectName}.als`), gzipped)
}
```

Keep this function's own doc comment (the one already above `buildAndWriteAlsProject` explaining
the "doesn't clear Samples/Imported" contract) — it's still accurate, just update it if it
references the now-moved `materializeStem` by name (say "see exportAudioMaterialization.ts's
materializeStemsForExport" instead).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS — this will surface any now-unused imports left behind in Step 3; remove them.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/main/exportAudioMaterialization.ts src/main/exportAbleton.ts
git commit -m "Extract stem materialization into a shared module for Ableton+Reaper export"
```

---

### Task 3: `projectLibrary.ts` — add `sketchReaperDir`/`sketchStemsDir`

**Files:**
- Modify: `src/main/projectLibrary.ts:65-67` (add two new functions right after
  `sketchAbletonDir`)
- Modify: `src/main/projectLibrary.test.ts:46-57` (extend the existing "sketch path helpers"
  test)

- [ ] **Step 1: Write the failing test**

In `src/main/projectLibrary.test.ts`, replace the existing `'derives every per-sketch path...'`
test (lines 47-56) with:

```typescript
    it('derives every per-sketch path from the library root and sketch name', async () => {
      const {
        sketchDir,
        sketchProjectPath,
        sketchMetaPath,
        sketchAbletonDir,
        sketchReaperDir,
        sketchStemsDir,
        samplesCacheDir
      } = await import('./projectLibrary')
      const root = join(musicDir, 'sssketch')
      expect(sketchDir('my-sketch')).toBe(join(root, 'my-sketch'))
      expect(sketchProjectPath('my-sketch')).toBe(join(root, 'my-sketch', 'my-sketch.sssketchproj'))
      expect(sketchMetaPath('my-sketch')).toBe(join(root, 'my-sketch', '.sssketch-meta.json'))
      expect(sketchAbletonDir('my-sketch')).toBe(join(root, 'my-sketch', 'Ableton'))
      expect(sketchReaperDir('my-sketch')).toBe(join(root, 'my-sketch', 'Reaper'))
      expect(sketchStemsDir('my-sketch')).toBe(join(root, 'my-sketch', 'Stems'))
      expect(samplesCacheDir()).toBe(join(root, '.samples-cache'))
    })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/projectLibrary.test.ts`
Expected: FAIL — `sketchReaperDir is not a function` (or similar — the import destructure will
be `undefined`)

- [ ] **Step 3: Implement**

In `src/main/projectLibrary.ts`, right after the existing `sketchAbletonDir` function (line 67),
add:

```typescript
export function sketchReaperDir(name: string): string {
  return join(sketchDir(name), 'Reaper')
}

export function sketchStemsDir(name: string): string {
  return join(sketchDir(name), 'Stems')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/projectLibrary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/projectLibrary.ts src/main/projectLibrary.test.ts
git commit -m "Add sketchReaperDir/sketchStemsDir path helpers"
```

---

### Task 4: `rppNode.ts` — generic RPP text node builder/serializer/parser

**Files:**
- Create: `src/main/reaper/rppNode.ts`
- Create: `src/main/reaper/rppNode.test.ts`

REAPER's `.rpp` format is plain, nested, whitespace-indented text: a "field" line
(`TAG param1 param2 ...`, no children, no brackets) or a "block"
(`<TAG param1 ...` / one child per line, indented / `>`). This module is the RPP equivalent of
`alsXmlHelpers.ts`'s role for Ableton's XML tree — used by `buildRppProject.ts` (Task 5) to build
the document, and by this task's own tests (and Task 5's) to parse the serialized output back
into a tree for structural assertions instead of fragile string-matching.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/reaper/rppNode.test.ts
import { describe, it, expect } from 'vitest'
import {
  rppField,
  rppBlock,
  quote,
  serializeRpp,
  parseRpp,
  findChild,
  findAllChildren
} from './rppNode'

describe('serializeRpp', () => {
  it('serializes a field with no children as a single unbracketed line', () => {
    const node = rppField('TEMPO', 120, 4, 4)
    expect(serializeRpp(node)).toBe('TEMPO 120 4 4')
  })

  it('serializes a block with nested children, indented, wrapped in angle brackets', () => {
    const node = rppBlock('TRACK', [], [
      rppField('NAME', quote('drums')),
      rppBlock('ITEM', [], [rppField('POSITION', 0)])
    ])
    expect(serializeRpp(node)).toBe('<TRACK\n  NAME "drums"\n  <ITEM\n    POSITION 0\n  >\n>')
  })

  it('serializes an empty block as an open/close pair with no lines in between', () => {
    const node = rppBlock('SendsPre', [], [])
    expect(serializeRpp(node)).toBe('<SendsPre\n>')
  })
})

describe('quote', () => {
  it('wraps a plain string in double quotes', () => {
    expect(quote('my rifff - kick')).toBe('"my rifff - kick"')
  })

  it('replaces an embedded double-quote with a single quote rather than breaking the line', () => {
    expect(quote('weird "name"')).toBe('"weird \'name\'"')
  })
})

describe('parseRpp / findChild / findAllChildren round trip', () => {
  it('parses a serialized block back into an equivalent tree', () => {
    const original = rppBlock('TRACK', ['{GUID}'], [
      rppField('NAME', quote('drums')),
      rppField('PEAKCOL', 12345),
      rppBlock('ITEM', [], [rppField('POSITION', 1.5), rppField('LENGTH', 2)]),
      rppBlock('ITEM', [], [rppField('POSITION', 4)])
    ])
    const parsed = parseRpp(serializeRpp(original))

    expect(parsed.tag).toBe('TRACK')
    expect(parsed.params).toEqual(['{GUID}'])
    expect(findChild(parsed, 'NAME')?.params).toEqual(['"drums"'])
    expect(findChild(parsed, 'PEAKCOL')?.params).toEqual(['12345'])
    expect(findAllChildren(parsed, 'ITEM')).toHaveLength(2)
    const firstItem = findAllChildren(parsed, 'ITEM')[0]
    expect(findChild(firstItem, 'POSITION')?.params).toEqual(['1.5'])
    expect(findChild(firstItem, 'LENGTH')?.params).toEqual(['2'])
  })

  it('preserves a quoted value containing a space as a single param, not split on the space', () => {
    const original = rppField('FILE', quote('a file with spaces.wav'))
    const parsed = parseRpp(serializeRpp(original))
    expect(parsed.params).toEqual(['"a file with spaces.wav"'])
  })

  it('findChild returns undefined when no child has that tag', () => {
    const parsed = parseRpp(serializeRpp(rppBlock('TRACK', [], [rppField('NAME', quote('x'))])))
    expect(findChild(parsed, 'NOPE')).toBeUndefined()
  })

  it('findChild returns undefined for a field node (no children at all)', () => {
    const parsed = parseRpp(serializeRpp(rppField('POSITION', 0)))
    expect(findChild(parsed, 'ANYTHING')).toBeUndefined()
    expect(findAllChildren(parsed, 'ANYTHING')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/reaper/rppNode.test.ts`
Expected: FAIL — `Cannot find module './rppNode'`

- [ ] **Step 3: Implement**

```typescript
// src/main/reaper/rppNode.ts

/**
 * A node in REAPER's own `.rpp` project-state text format: a "field" line
 * (`TAG param1 param2 ...`, `children` undefined) or a "block"
 * (`<TAG param1 ...` / one indented line per child / `>`, `children` a
 * possibly-empty array). This module's role for RPP text is the same one
 * alsXmlHelpers.ts plays for Ableton's XML tree.
 */
export interface RppNode {
  tag: string
  /** Field values already formatted exactly as they should appear in the
   * output line (numbers as plain strings via String(), a string value
   * pre-wrapped via quote()) -- this module doesn't know which fields are
   * "supposed" to be numbers vs strings, so formatting is the caller's job
   * (mirrors alsXmlHelpers.ts's setAttr taking an already-string value). */
  params: string[]
  /** undefined for a plain field line (leaf, no brackets). Present
   * (possibly `[]`) for a block. */
  children?: RppNode[]
}

export function rppField(tag: string, ...params: (string | number)[]): RppNode {
  return { tag, params: params.map(String) }
}

export function rppBlock(tag: string, params: (string | number)[], children: RppNode[]): RppNode {
  return { tag, params: params.map(String), children }
}

/** REAPER's own string-quoting convention: double quotes around the value.
 * A literal embedded double-quote is replaced with a single quote rather
 * than implementing REAPER's full alternate-quoting scheme (backtick/
 * single-quote fallback for values containing every quote character) --
 * sssketch's real content (rifff/stem names, file paths) essentially never
 * contains a literal double-quote, and a stray single-quote substitution
 * is a harmless cosmetic difference, not a corrupt file. */
export function quote(value: string): string {
  return `"${value.replace(/"/g, "'")}"`
}

export function serializeRpp(root: RppNode): string {
  const lines: string[] = []
  function write(node: RppNode, depth: number): void {
    const indent = '  '.repeat(depth)
    const header = [node.tag, ...node.params].join(' ')
    if (node.children === undefined) {
      lines.push(`${indent}${header}`)
      return
    }
    lines.push(`${indent}<${header}`)
    for (const child of node.children) write(child, depth + 1)
    lines.push(`${indent}>`)
  }
  write(root, 0)
  return lines.join('\n')
}

/** Splits one line into its tag and params, treating a double-quoted span
 * (however it contains spaces) as a single param -- e.g. `NAME "a b c"`
 * splits into `['NAME', '"a b c"']`, not four separate tokens. */
function splitLine(line: string): { tag: string; params: string[] } {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
      continue
    }
    if (ch === ' ' && !inQuotes) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  const [tag, ...params] = tokens
  return { tag, params }
}

/** Parses serializeRpp's own output back into a tree. Test-only in
 * practice (buildRppProject.ts itself only ever serializes, never
 * re-parses its own output), but exported since it's a genuinely reusable,
 * self-contained capability, not a test-internal helper. */
export function parseRpp(text: string): RppNode {
  const lines = text.split('\n')
  let i = 0
  function parseNode(): RppNode {
    const raw = lines[i].trim()
    i++
    if (raw.startsWith('<')) {
      const { tag, params } = splitLine(raw.slice(1))
      const children: RppNode[] = []
      while (lines[i].trim() !== '>') {
        children.push(parseNode())
      }
      i++ // consume the closing '>'
      return { tag, params, children }
    }
    const { tag, params } = splitLine(raw)
    return { tag, params }
  }
  return parseNode()
}

/** First direct child tagged `tag`, or undefined -- also correctly
 * undefined for a field node (no `children` array to search at all). */
export function findChild(node: RppNode, tag: string): RppNode | undefined {
  return node.children?.find((c) => c.tag === tag)
}

/** Every direct child tagged `tag`, in document order. */
export function findAllChildren(node: RppNode, tag: string): RppNode[] {
  return node.children?.filter((c) => c.tag === tag) ?? []
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/reaper/rppNode.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/reaper/rppNode.ts src/main/reaper/rppNode.test.ts
git commit -m "Add RPP text node builder/serializer/parser"
```

---

### Task 5: `buildRppProject.ts` — the pure track/item/tempo builder

**Files:**
- Create: `src/main/reaper/buildRppProject.ts`
- Create: `src/main/reaper/buildRppProject.test.ts`

This is the core mapping logic from the design doc's "Format mapping" section — a pure function:
given the app's `AppState` and a map of which stems actually have materialized audio (and under
what filename), it returns the finished `.rpp` text. No template file (unlike Ableton) — every
block is built directly via `rppNode.ts`'s builders, each following the real-example-sourced
shapes documented in the design doc.

**Read first:** `docs/superpowers/specs/2026-08-13-reaper-export-design.md`'s "Format mapping"
section, and `src/main/ableton/buildAlsXml.ts`'s `computeLoopWindow`/`buildStemClips`/
`nativeBpmFor`/`subtractMutedRanges` (the beats-based twin of the seconds-based logic this task
writes).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/reaper/buildRppProject.test.ts
import { describe, it, expect } from 'vitest'
import { buildRppProject } from './buildRppProject'
import { parseRpp, findChild, findAllChildren } from './rppNode'
import type { AppState } from '../../renderer/src/state/store'
import type { Rifff } from '@shared/types'

function emptyAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    bpm: 120,
    snapIdx: 0,
    vol: {},
    mute: {},
    off: {},
    stretch: {},
    fadeIn: {},
    fadeOut: {},
    playedBars: {},
    leftCrop: {},
    muteRegions: {},
    busOf: {},
    dragVol: {},
    dragFadeIn: {},
    dragFadeOut: {},
    dragPlayedBars: {},
    dragLeftCropBars: {},
    sel: null,
    channelOrder: [],
    channelOf: {},
    recordingChannelIds: {},
    rifffs: {},
    masterChain: [null, null, null, null],
    channelPlugins: {},
    mode: 'normal',
    ...overrides
  } as AppState
}

// 4 bars at 140bpm -- native bpm derives back out to exactly 140.
function drumsRifff(): Rifff {
  return {
    groupId: 'rifff-1',
    name: 'my-rifff',
    bpm: 140,
    barLength: 4,
    folderPath: '/fake/folder',
    startBar: 8,
    stems: [
      {
        slot: 0,
        author: 'someone',
        name: 'kick',
        type: 'drums',
        path: '/source/kick.wav',
        durationSec: (60 / 140) * 4 * 4,
        barLength: 4
      }
    ]
  }
}

function realOneShotRifff(): Rifff {
  return {
    groupId: 'os-1',
    name: 'vox-hit',
    bpm: 120,
    barLength: 1,
    folderPath: '/fake/folder',
    startBar: 4,
    stems: [
      {
        slot: 0,
        author: 'someone',
        name: 'vox',
        type: 'sampler',
        path: '/source/vox.wav',
        durationSec: 2.7317,
        barLength: 1,
        oneShot: true
      }
    ]
  }
}

function tracksOf(rppText: string) {
  const root = parseRpp(rppText)
  return { root, tracks: findAllChildren(root, 'TRACK') }
}

function firstItemOf(track: ReturnType<typeof findAllChildren>[number]) {
  return findAllChildren(track, 'ITEM')[0]
}

describe('buildRppProject', () => {
  it('sets the project-level TEMPO from state.bpm, fixed 4/4', () => {
    const rppText = buildRppProject(emptyAppState({ bpm: 135.5 }), new Map())
    const { root } = tracksOf(rppText)
    expect(findChild(root, 'TEMPO')?.params).toEqual(['135.5', '4', '4'])
  })

  it('places one TRACK with one ITEM for a single placed rifff/stem', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'my-rifff-kick.wav']]))
    const { tracks } = tracksOf(rppText)

    expect(tracks).toHaveLength(1)
    expect(findAllChildren(tracks[0], 'ITEM')).toHaveLength(1)
  })

  it('positions the item at (startBar + leftCropBars) * secPerBarProject, LENGTH = (playedBars - leftCropBars) * secPerBarProject', () => {
    // state.bpm=120 -> secPerBarProject = (60/120)*4 = 2. startBar=8, no crop, playedBars
    // falls back to rifff.barLength=4.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'my-rifff-kick.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    expect(Number(findChild(item, 'POSITION')?.params[0])).toBeCloseTo(16, 9) // 8*2
    expect(Number(findChild(item, 'LENGTH')?.params[0])).toBeCloseTo(8, 9) // 4*2
  })

  it('sets PLAYRATE to projectBpm/nativeBpm for a tiled (non-one-shot) stem, preserving pitch', () => {
    // native bpm derives to exactly 140 (see drumsRifff's own doc comment).
    const state = emptyAppState({
      bpm: 210,
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'my-rifff-kick.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])
    const playrate = findChild(item, 'PLAYRATE')!

    expect(Number(playrate.params[0])).toBeCloseTo(1.5, 9) // 210/140
    expect(playrate.params[1]).toBe('1') // preserve pitch
  })

  it('sets LOOP=1 for a tiled stem and LOOP=0 for a one-shot', () => {
    const tiledState = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const tiledItem = firstItemOf(
      tracksOf(buildRppProject(tiledState, new Map([['rifff-1:0', 'a.wav']]))).tracks[0]
    )
    expect(findChild(tiledItem, 'LOOP')?.params).toEqual(['1'])

    const oneShotState = emptyAppState({
      rifffs: { 'os-1': realOneShotRifff() },
      busOf: { 'os-1:0': 'drums' }
    })
    const oneShotItem = firstItemOf(
      tracksOf(buildRppProject(oneShotState, new Map([['os-1:0', 'b.wav']]))).tracks[0]
    )
    expect(findChild(oneShotItem, 'LOOP')?.params).toEqual(['0'])
  })

  it('wraps a leftCropBars larger than stem.barLength into the correct SOFFS tile phase, at NATIVE tempo', () => {
    const rifff = drumsRifff() // barLength: 4, native bpm 140
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      busOf: { 'rifff-1:0': 'drums' },
      leftCrop: { 'rifff-1': 6 }, // > barLength(4), wraps to phase 2
      playedBars: { 'rifff-1': 10 }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    // secPerBarNative(140) = (60/140)*4 = 1.7142857142857142; wrapped(6%4=2)*that.
    expect(Number(findChild(item, 'SOFFS')?.params[0])).toBeCloseTo(2 * ((60 / 140) * 4), 9)
    // POSITION uses the RAW (unwrapped) leftCropBars, at PROJECT tempo -- (8+6)*2.
    expect(Number(findChild(item, 'POSITION')?.params[0])).toBeCloseTo(28, 9)
    expect(Number(findChild(item, 'LENGTH')?.params[0])).toBeCloseTo(8, 9) // (10-6)*2
  })

  it('maps a one-shot stem via trimStartSec/trimEndSec at PROJECT tempo, SOFFS=trimStartSec, PLAYRATE=1', () => {
    const rifff = realOneShotRifff()
    rifff.stems[0] = { ...rifff.stems[0], trimStartSec: 0.5, trimEndSec: 1.5 }
    const state = emptyAppState({
      bpm: 120,
      rifffs: { 'os-1': rifff },
      busOf: { 'os-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['os-1:0', 'vox-hit-vox.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    expect(Number(findChild(item, 'POSITION')?.params[0])).toBeCloseTo(8, 9) // startBar(4)*2
    expect(Number(findChild(item, 'LENGTH')?.params[0])).toBeCloseTo(1, 9) // 1.5-0.5
    expect(Number(findChild(item, 'SOFFS')?.params[0])).toBeCloseTo(0.5, 9)
    expect(findChild(item, 'PLAYRATE')?.params[0]).toBe('1')
  })

  it('sets item MUTE=1 for a fully-muted stem, WITHOUT zeroing its volume', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      mute: { 'rifff-1:0': true },
      vol: { 'rifff-1:0': 0.8 }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    expect(findChild(item, 'MUTE')?.params).toEqual(['1'])
    expect(findChild(item, 'VOLPAN')?.params[2]).toBe('0.8')
  })

  it('splits a stem into multiple ITEMs around a partial mute region, with fade only on first/last', () => {
    // Mute region covers a real middle span of the clip -- 3 audible
    // segments should NOT be produced here since only one gap is cut (2
    // segments), but the fade-on-ends-only rule is what this test targets.
    const rifff = drumsRifff() // startBar 8, barLength 4 -> playedBars falls back to 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      busOf: { 'rifff-1:0': 'drums' },
      muteRegions: { 'rifff-1:0': [{ startBar: 9, endBar: 9.5 }] },
      fadeIn: { 'rifff-1': 1 },
      fadeOut: { 'rifff-1': 1 }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const items = findAllChildren(tracksOf(rppText).tracks[0], 'ITEM')

    expect(items).toHaveLength(2)
    expect(findChild(items[0], 'FADEIN')?.params[0]).toBe('1') // has a fade
    expect(findChild(items[0], 'FADEOUT')?.params[0]).toBe('0') // no fade -- not the last segment
    expect(findChild(items[1], 'FADEIN')?.params[0]).toBe('0') // no fade -- not the first segment
    expect(findChild(items[1], 'FADEOUT')?.params[0]).toBe('1') // has a fade
  })

  it('skips a stem missing from stemFileNames instead of producing a broken item', () => {
    const rifff = drumsRifff()
    rifff.stems.push({ ...rifff.stems[0], slot: 1, name: 'missing-file' })
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      busOf: { 'rifff-1:0': 'drums', 'rifff-1:1': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']])) // slot 1 missing
    const { tracks } = tracksOf(rppText)
    expect(findAllChildren(tracks[0], 'ITEM')).toHaveLength(1)
  })

  it('colors each track via 0x01000000 | BGR-packed bus hex, and groups+labels the first per-bus track by busGroupName', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const track = tracksOf(rppText).tracks[0]

    // drums bus hex is #e8929b -- r=0xe8, g=0x92, b=0x9b.
    const expectedColor = 0x01000000 | (0x9b << 16) | (0x92 << 8) | 0xe8
    expect(findChild(track, 'PEAKCOL')?.params).toEqual([String(expectedColor)])
    expect(findChild(track, 'NAME')?.params[0]).toBe('"DRUMS"')
  })

  it('keeps tracks for the same bus adjacent when packIntoTracks opens more than one', () => {
    // Two non-overlapping same-bus stems that DO overlap in time (forcing
    // packIntoTracks to open two physical tracks for this one bus).
    const rifffA: Rifff = { ...drumsRifff(), groupId: 'a', startBar: 0 }
    const rifffB: Rifff = { ...drumsRifff(), groupId: 'b', startBar: 0 } // same time span, overlaps
    const state = emptyAppState({
      rifffs: { a: rifffA, b: rifffB },
      busOf: { 'a:0': 'drums', 'b:0': 'drums' }
    })
    const rppText = buildRppProject(
      state,
      new Map([
        ['a:0', 'a.wav'],
        ['b:0', 'b.wav']
      ])
    )
    const { tracks } = tracksOf(rppText)
    expect(tracks).toHaveLength(2)
    tracks.forEach((t) => expect(findChild(t, 'NAME')?.params[0]).toMatch(/drums/i))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/reaper/buildRppProject.test.ts`
Expected: FAIL — `Cannot find module './buildRppProject'`

- [ ] **Step 3: Implement**

```typescript
// src/main/reaper/buildRppProject.ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AppState } from '../../renderer/src/state/store'
import type { BusId, Rifff, SoundType, Stem } from '@shared/types'
import { stemKey } from '@shared/types'
import { packIntoTracks } from '@shared/packIntoTracks'
import { busGroupName } from '@shared/busNaming'
import { rppField, rppBlock, quote, serializeRpp, type RppNode } from './rppNode'

const PROJECT_BEATS_PER_BAR = 4

function secPerBarFor(bpm: number): number {
  return bpm > 0 ? (60 / bpm) * PROJECT_BEATS_PER_BAR : 0
}

// Same derivation as buildAlsXml.ts's own nativeBpmFor -- see that file's
// doc comment for the full reasoning (why durationSec/barLength, why this
// is meaningless for a one-shot). Reimplemented here, not imported: a
// "wire format twin" (see CLAUDE.md), hand-synced with the Ableton
// export's own copy, not code-shared -- the two targets' unit conventions
// (beats vs seconds) are different enough that sharing the caller-facing
// logic would leak one format's assumptions into the other.
function nativeBpmFor(stem: Stem): number {
  const secPerBar = stem.durationSec / stem.barLength
  return 240 / secPerBar
}

function resolvePlayedBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
}

interface AudibleSegment {
  segStartSec: number
  segEndSec: number
}

// Same algorithm as buildAlsXml.ts's subtractMutedRanges, operating in
// project-tempo SECONDS instead of beats -- REAPER's own POSITION/LENGTH
// are seconds natively, so there's no beats round-trip needed here.
function subtractMutedRangesSec(
  clipStartSec: number,
  clipEndSec: number,
  mutedRanges: { startBar: number; endBar: number }[],
  secPerBarProject: number
): AudibleSegment[] {
  const sorted = mutedRanges
    .map((r) => ({
      startSec: r.startBar * secPerBarProject,
      endSec: r.endBar * secPerBarProject
    }))
    .sort((a, b) => a.startSec - b.startSec)
  const segments: AudibleSegment[] = []
  let cursor = clipStartSec
  for (const range of sorted) {
    const rangeStart = Math.max(range.startSec, clipStartSec)
    const rangeEnd = Math.min(range.endSec, clipEndSec)
    if (rangeEnd <= cursor) continue
    if (rangeStart > cursor) segments.push({ segStartSec: cursor, segEndSec: rangeStart })
    cursor = Math.max(cursor, rangeEnd)
  }
  if (cursor < clipEndSec) segments.push({ segStartSec: cursor, segEndSec: clipEndSec })
  return segments
}

function newGuid(): string {
  return `{${randomUUID().toUpperCase()}}`
}

// Sampled from the same real, hand-recolored-in-Ableton reference project
// buildAlsXml.ts's own ABLETON_BUS_COLORS is built from (see that file's
// doc comment). Kept as its own copy, not imported from either
// buildAlsXml.ts or the renderer's typeColor.ts -- this is REAPER-native
// RGB hex, a genuinely different encoding from Ableton's palette-index
// enum, and main-process code importing a renderer theme file would cross
// this codebase's own process boundary for no real benefit (see CLAUDE.md's
// "wire format twins are hand-synced, not code-shared" convention).
const REAPER_BUS_COLORS: Record<BusId, string> = {
  drums: '#e8929b',
  bass: '#4a56ad',
  lead: '#c7a4d2',
  backing: '#7fc98a',
  aux: '#8a97a3'
}

// REAPER's native track/item color: the high bit (0x01000000) marks "use
// this custom color, not the default", OR'd with a BGR-packed (not RGB)
// int -- confirmed against REAPER's own SWS extension source
// (Color/Color.cpp's SWS_ColorToNative, which swaps R/B to produce
// Windows-COLORREF-style native colors on every platform). Flagged for
// manual confirmation once a real export can be opened in REAPER -- see
// the design doc's "Manual verification" section.
function colorInt(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0x01000000 | (b << 16) | (g << 8) | r
}

/** FADEIN/FADEOUT field: `<applies?> <lengthSec> 0 1 0 0` when there's a
 * real fade to write, else the template-equivalent all-zero default
 * `0 0 0 1 0 0` -- trailing fields (curve/skew-adjacent) copied verbatim
 * from a real REAPER-produced example, not independently derived (see the
 * design doc). Clamped to at most half the segment's own duration,
 * mirroring buildAlsXml.ts's own applyFade -- a fade can't outlast the
 * audible span it's fading. */
function fadeField(
  tag: 'FADEIN' | 'FADEOUT',
  applies: boolean,
  fadeBars: number,
  segmentDurationSec: number,
  secPerBarProject: number
): RppNode {
  if (!applies || fadeBars <= 0) return rppField(tag, 0, 0, 0, 1, 0, 0)
  const maxFadeSec = segmentDurationSec / 2
  const lengthSec = Math.min(fadeBars * secPerBarProject, maxFadeSec)
  return rppField(tag, 1, lengthSec, 0, 1, 0, 0)
}

interface StemItemsResult {
  items: RppNode[]
  trackLabel: string
  soundType: SoundType
  startSec: number
  endSec: number
}

/**
 * Builds the ITEM nodes for one stem -- one per audible segment (see
 * subtractMutedRangesSec) -- mirroring buildAlsXml.ts's own
 * buildStemClips, but in REAPER's seconds-native, playrate-based model
 * instead of Ableton's beats/warp-marker one. Does not build a TRACK --
 * callers combine multiple stems' items onto a shared track via
 * packIntoTracks, same as the Ableton export.
 */
function buildStemItems(
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions'],
  muted: boolean,
  volume: number,
  fadeInBars: number,
  fadeOutBars: number
): StemItemsResult {
  const secPerBarProject = secPerBarFor(projectBpm)
  const trackLabel = `${rifff.name} - ${stem.name}`

  let clipStartSec: number
  let clipLengthSec: number
  let soffsSec: number
  let playrate: number
  let loop: boolean

  if (stem.oneShot) {
    const trimStart = stem.trimStartSec ?? 0
    const trimEnd = stem.trimEndSec ?? stem.durationSec
    clipStartSec = (rifff.startBar ?? 0) * secPerBarProject
    clipLengthSec = trimEnd - trimStart
    soffsSec = trimStart
    playrate = 1
    loop = false
  } else {
    const nativeBpm = nativeBpmFor(stem)
    const secPerBarNative = secPerBarFor(nativeBpm)
    const wrappedLeftCropBars =
      ((leftCropBars % stem.barLength) + stem.barLength) % stem.barLength
    clipStartSec = ((rifff.startBar ?? 0) + leftCropBars) * secPerBarProject
    clipLengthSec = (playedBars - leftCropBars) * secPerBarProject
    soffsSec = wrappedLeftCropBars * secPerBarNative
    playrate = projectBpm / nativeBpm
    loop = true
  }

  const clipEndSec = clipStartSec + clipLengthSec
  const muteRegionsForStem = muteRegions[stemKey(rifff.groupId, stem.slot)] ?? []
  const audibleSegments = subtractMutedRangesSec(
    clipStartSec,
    clipEndSec,
    muteRegionsForStem,
    secPerBarProject
  )

  const relativePath = join('Samples', 'Imported', fileName)
  // One full tile cycle, in native seconds, is exactly the stem's own
  // durationSec -- the same exact (not approximate) relationship
  // nativeBpmFor's own doc comment in buildAlsXml.ts relies on.
  const tileLengthSec = stem.durationSec

  const items = audibleSegments.map((segment, segmentIndex) => {
    const segmentDurationSec = segment.segEndSec - segment.segStartSec
    const elapsedFromClipStart = segment.segStartSec - clipStartSec
    // A segment resuming after a muted gap needs its own source offset
    // advanced by however much time elapsed since the clip's true start,
    // wrapped into one tile cycle for a looped stem -- or the audio would
    // jump back to the tile's very start on every resume (mirrors
    // buildAlsXml.ts's own tilePhaseAtElapsedBeats, in seconds).
    const segSoffsSec = loop
      ? (((soffsSec + elapsedFromClipStart) % tileLengthSec) + tileLengthSec) % tileLengthSec
      : soffsSec + elapsedFromClipStart

    return rppBlock('ITEM', [], [
      rppField('POSITION', segment.segStartSec),
      rppField('LENGTH', segmentDurationSec),
      rppField('LOOP', loop ? 1 : 0),
      fadeField('FADEIN', segmentIndex === 0, fadeInBars, segmentDurationSec, secPerBarProject),
      fadeField(
        'FADEOUT',
        segmentIndex === audibleSegments.length - 1,
        fadeOutBars,
        segmentDurationSec,
        secPerBarProject
      ),
      rppField('MUTE', muted ? 1 : 0),
      rppField('IGUID', newGuid()),
      rppField('NAME', quote(trackLabel)),
      rppField('VOLPAN', 1, 0, volume, -1),
      rppField('SOFFS', segSoffsSec),
      rppField('PLAYRATE', playrate, 1, 0, -1, 0, -1),
      rppField('GUID', newGuid()),
      rppBlock('SOURCE', ['WAVE'], [rppField('FILE', quote(relativePath))])
    ])
  })

  return { items, trackLabel, soundType: stem.type, startSec: clipStartSec, endSec: clipEndSec }
}

const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']
const DEFAULT_BUS: BusId = 'aux'

/**
 * Builds the finished `.rpp` project text for the current arrangement.
 * Pure: no filesystem access at all (unlike buildAlsXml.ts, there's no
 * template file to read -- every block is built directly). `stemFileNames`
 * (keyed by stemKey(groupId, slot)) tells this function which stems
 * actually have materialized audio to reference and under what filename --
 * a stem missing from the map is skipped entirely. See
 * docs/superpowers/specs/2026-08-13-reaper-export-design.md for the full
 * mapping rationale.
 */
export function buildRppProject(state: AppState, stemFileNames: Map<string, string>): string {
  const byBus = new Map<BusId, StemItemsResult[]>()
  for (const busId of BUS_IDS) byBus.set(busId, [])

  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  for (const rifff of placed) {
    const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
    const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      const fileName = stemFileNames.get(key)
      if (!fileName) continue

      const busId = state.busOf[key] ?? DEFAULT_BUS
      const result = buildStemItems(
        rifff,
        stem,
        fileName,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        state.mute[key] ?? false,
        state.vol[key] ?? 1,
        state.fadeIn[rifff.groupId] ?? 0,
        state.fadeOut[rifff.groupId] ?? 0
      )
      if (result.items.length === 0) continue

      byBus.get(busId)!.push(result)
    }
  }

  const trackBlocks: RppNode[] = []
  for (const busId of BUS_IDS) {
    const entries = byBus.get(busId)!
    if (entries.length === 0) continue

    const color = colorInt(REAPER_BUS_COLORS[busId])
    const packed = packIntoTracks(
      entries,
      (e) => e.startSec,
      (e) => e.endSec
    )

    packed.forEach((trackEntries, trackIndex) => {
      const allItems = trackEntries.flatMap((e) => e.items)
      const name =
        trackIndex === 0
          ? busGroupName(busId, entries)
          : trackEntries.length === 1
            ? trackEntries[0].trackLabel
            : `${busId} (shared)`
      trackBlocks.push(
        rppBlock('TRACK', [newGuid()], [
          rppField('NAME', quote(name)),
          rppField('PEAKCOL', color),
          rppField('MUTESOLO', 0, 0, 0),
          ...allItems
        ])
      )
    })
  }

  const root = rppBlock(
    'REAPER_PROJECT',
    ['0.1', quote('sssketch'), Math.floor(Date.now() / 1000)],
    [rppField('TEMPO', state.bpm, 4, 4), ...trackBlocks]
  )

  return serializeRpp(root)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/reaper/buildRppProject.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/reaper/buildRppProject.ts src/main/reaper/buildRppProject.test.ts
git commit -m "Add buildRppProject.ts: pure AppState -> .rpp text mapping"
```

---

### Task 6: `exportReaper.ts` — orchestration (three entry points)

**Files:**
- Create: `src/main/exportReaper.ts`

Mirrors `src/main/exportAbleton.ts`'s three entry points exactly (`exportReaperToLibrary`,
`exportReaperNextToSource`, `exportReaper`), using the now-shared `materializeStemsForExport`
(Task 2) and `buildRppProject` (Task 5). No dedicated test file — matches `exportAbleton.ts`'s
own established (untested-by-unit-test, real-engine-dependent) posture; verified via typecheck
and the final manual walkthrough (Task 10).

- [ ] **Step 1: Implement**

```typescript
// src/main/exportReaper.ts
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { dialog, shell, BrowserWindow } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { buildRppProject } from './reaper/buildRppProject'
import { materializeStemsForExport } from './exportAudioMaterialization'
import { sketchReaperDir } from './projectLibrary'

/**
 * Materializes every placed stem's source audio into
 * `<outputDir>/Samples/Imported/` (via materializeStemsForExport -- same
 * shared cache and Samples folder layout the Ableton export uses), builds
 * the .rpp text, and writes `<outputDir>/<projectName>.rpp`. No gzip (RPP
 * is REAPER's own plain-text format, unlike Ableton's gzipped XML) and no
 * checked-in template (see buildRppProject.ts's own doc comment). Mirrors
 * exportAbleton.ts's buildAndWriteAlsProject exactly otherwise, including
 * NOT clearing Samples/Imported/ first -- a caller that owns its outputDir
 * outright is responsible for that (see exportReaperToLibrary/
 * exportReaperNextToSource below).
 */
export async function buildAndWriteRppProject(
  state: AppState,
  outputDir: string,
  projectName: string
): Promise<void> {
  const { stemFileNames } = await materializeStemsForExport(state, outputDir)
  const rppText = buildRppProject(state, stemFileNames)
  writeFileSync(join(outputDir, `${projectName}.rpp`), rppText, 'utf-8')
}

/**
 * Routine, no-dialog Reaper export for a library-resident sketch: writes
 * into that sketch's own `Reaper/` folder in place, then opens it in
 * Finder. Mirrors exportAbletonToLibrary exactly, minus the
 * shouldWarnBeforeOverwrite/lastExportAlsMtimeMs tracking -- that
 * modified-outside-sssketch warning is specific to Ableton's own
 * established workflow (mixing directly in Ableton after export); no
 * equivalent has been requested for Reaper, so this simply overwrites.
 */
export async function exportReaperToLibrary(state: AppState, libraryName: string): Promise<void> {
  const reaperDir = sketchReaperDir(libraryName)
  mkdirSync(reaperDir, { recursive: true })
  rmSync(join(reaperDir, 'Samples', 'Imported'), { recursive: true, force: true })
  await buildAndWriteRppProject(state, reaperDir, libraryName)
  await shell.openPath(reaperDir)
}

/**
 * Same no-dialog, always-named-after-the-project export as
 * exportReaperToLibrary above, for a sketch that's real and has a known
 * file location but isn't a library sketch -- an external .sssketchproj
 * path. Mirrors exportAbletonNextToSource exactly.
 */
export async function exportReaperNextToSource(
  state: AppState,
  sourcePath: string
): Promise<void> {
  const projectName = basename(sourcePath, '.sssketchproj')
  const reaperDir = join(dirname(sourcePath), 'Reaper')
  mkdirSync(reaperDir, { recursive: true })
  rmSync(join(reaperDir, 'Samples', 'Imported'), { recursive: true, force: true })
  await buildAndWriteRppProject(state, reaperDir, projectName)
  await shell.openPath(reaperDir)
}

/**
 * Opens a save dialog (choosing the .rpp file's own name/location), then
 * builds the whole self-contained project folder around it -- the
 * "export a copy elsewhere" escape hatch for an unsaved project. Mirrors
 * exportAbleton exactly.
 */
export async function exportReaper(
  win: BrowserWindow,
  state: AppState,
  defaultName?: string
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Reaper Project', extensions: ['rpp'] }],
    defaultPath: `${defaultName ?? 'sssketch-export'}.rpp`
  })
  if (result.canceled || !result.filePath) return null

  const outputDir = dirname(result.filePath)
  const projectName = basename(result.filePath, '.rpp')
  await buildAndWriteRppProject(state, outputDir, projectName)
  await shell.openPath(outputDir)
  return result.filePath
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/main/exportReaper.ts
git commit -m "Add exportReaper.ts orchestration (dialog/library/next-to-source)"
```

---

### Task 7: `nativeExport.ts` — bus-grouped stems export + library-aware entry points

**Files:**
- Modify: `src/main/nativeExport.ts` (`renderStemsToDir`, plus two new functions)
- Modify: `src/main/nativeExport.test.ts`
- Modify: `src/main/projectLibrary.ts` (no changes needed beyond Task 3 — `sketchStemsDir`
  already added)

`renderStemsToDir` currently writes every stem flat into `destDir`. This task changes it to
write into `<destDir>/<busId>/<rifffName>-<stemName>.wav` subfolders, and adds
`exportStemsToLibrary`/`exportStemsNextToSource` mirroring the Ableton/Reaper library-aware
no-dialog entry points. `nativeExportStemsToDisk` (the dialog-based escape hatch) is unchanged
except that its chosen folder now contains bus subfolders instead of a flat file list, since it
calls the same (now bus-grouping) `renderStemsToDir`.

- [ ] **Step 1: Read the current file in full**

Read `src/main/nativeExport.ts` and `src/main/nativeExport.test.ts` completely before editing.

- [ ] **Step 2: Write the failing test**

In `src/main/nativeExport.test.ts`, add a new test inside the existing `describe('renderStemsToDir', ...)` block (after the existing two tests, before its closing `})`):

```typescript
  it('groups output into <destDir>/<busId>/ subfolders, using state.busOf', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'my rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'kick',
            type: 'fx',
            path: stemPath,
            durationSec: 0.1,
            barLength: 1
          }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'drums' }
      }

      const fileNames = await renderStemsToDir(state, destDir)

      expect(fileNames).toEqual(['my rifff-kick.wav'])
      expect(existsSync(join(destDir, 'drums', 'my rifff-kick.wav'))).toBe(true)
      expect(existsSync(join(destDir, 'my rifff-kick.wav'))).toBe(false) // not flat anymore
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)

  it('falls back to the aux bus subfolder for a stem with no busOf assignment', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const destDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-dest-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'untidied',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          { slot: 1, author: 'e', name: 'a', type: 'fx', path: stemPath, durationSec: 0.1, barLength: 1 }
        ]
      }
      const state: AppState = { ...initialState, bpm: 60, rifffs: { r1: rifff }, busOf: {} }

      await renderStemsToDir(state, destDir)

      expect(existsSync(join(destDir, 'aux', 'untidied-a.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(destDir, { recursive: true, force: true })
    }
  }, 30000)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/nativeExport.test.ts -t "renderStemsToDir"`
Expected: FAIL — the two new tests fail (files land flat in `destDir`, not under a `drums`/`aux`
subfolder); the two pre-existing `renderStemsToDir` tests still pass.

- [ ] **Step 4: Implement — bus-grouped `renderStemsToDir`**

In `src/main/nativeExport.ts`, replace the `renderStemsToDir` function's body with a version that
resolves each target's bus subfolder before writing:

```typescript
const DEFAULT_STEMS_BUS: BusId = 'aux'

export async function renderStemsToDir(state: AppState, destDir: string): Promise<string[]> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  const targets: { key: string; rifffName: string; stemName: string; busId: BusId }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      targets.push({
        key,
        rifffName: rifff.name,
        stemName: stem.name,
        busId: state.busOf[key] ?? DEFAULT_STEMS_BUS
      })
    }
  }

  const usedNames = new Map<string, number>()
  function uniqueFileName(rifffName: string, stemName: string): string {
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}`
    const count = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, count)
    return count === 1 ? `${base}.wav` : `${base}-${count}.wav`
  }

  const durationBars = loopLengthBarsFor(state)
  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  const fileNames: string[] = []
  const pluginCatalog = loadCatalog()

  try {
    await client.connect(engineHandle.port)

    const allKeys = targets.map((t) => t.key)
    for (const target of targets) {
      const targetState = soloState(state, new Set([target.key]), allKeys)

      const project = await buildEngineProject(
        targetState,
        resolveStretchedForExport,
        pluginCatalog
      )
      const fileName = uniqueFileName(target.rifffName, target.stemName)
      const busDir = join(destDir, target.busId)
      mkdirSync(busDir, { recursive: true })
      const outputPath = join(busDir, fileName)

      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath, durationBars },
        'render-export-result',
        RENDER_EXPORT_TIMEOUT_MS
      )) as { success: boolean; error?: string }

      if (!result.success) {
        throw new Error(
          `native export failed for stem "${target.stemName}": ${result.error ?? 'unknown error'}`
        )
      }

      fileNames.push(fileName)
    }

    return fileNames
  } finally {
    client.disconnect()
    engineHandle.stop()
  }
}
```

Add `mkdirSync` to this file's existing `node:fs` import, and add `BusId` to its existing
`@shared/types` (or wherever `stemKey` is currently imported from) import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/nativeExport.test.ts -t "renderStemsToDir"`
Expected: PASS (4 tests: 2 pre-existing + 2 new)

- [ ] **Step 6: Write the failing tests for the new library-aware entry points**

Add a new `describe` block to `src/main/nativeExport.test.ts`:

```typescript
describe('exportStemsToLibrary / exportStemsNextToSource', () => {
  it('exportStemsToLibrary writes bus-grouped stems into sketchStemsDir(name)', async () => {
    // Reuses this test file's own electron mock (getPath -> tmpdir()) --
    // sketchStemsDir resolves under that same tmpdir() via projectLibrary.ts.
    const { sketchStemsDir } = await import('./projectLibrary')
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'lib rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          { slot: 1, author: 'e', name: 'a', type: 'fx', path: stemPath, durationSec: 0.1, barLength: 1 }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'bass' }
      }

      await exportStemsToLibrary(state, 'my-sketch')

      expect(existsSync(join(sketchStemsDir('my-sketch'), 'bass', 'lib rifff-a.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
    }
  }, 30000)

  it('exportStemsNextToSource writes bus-grouped stems into <sourceDir>/Stems/', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-src-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'sssketch-stems-project-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.3, 4410)
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'ext rifff',
        bpm: 60,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          { slot: 1, author: 'e', name: 'a', type: 'fx', path: stemPath, durationSec: 0.1, barLength: 1 }
        ]
      }
      const state: AppState = {
        ...initialState,
        bpm: 60,
        rifffs: { r1: rifff },
        busOf: { 'r1:1': 'lead' }
      }
      const sourcePath = join(projectDir, 'my-proj.sssketchproj')

      await exportStemsNextToSource(state, sourcePath)

      expect(existsSync(join(projectDir, 'Stems', 'lead', 'ext rifff-a.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)
})
```

Add `exportStemsToLibrary`/`exportStemsNextToSource` to this test file's existing import from
`./nativeExport`.

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/main/nativeExport.test.ts -t "exportStemsToLibrary"`
Expected: FAIL — `exportStemsToLibrary is not a function`

- [ ] **Step 8: Implement the two new entry points**

In `src/main/nativeExport.ts`, add after `nativeExportStemsToDisk`:

```typescript
/**
 * Routine, no-dialog stems export for a library-resident sketch: writes
 * bus-grouped stems straight into that sketch's own `Stems/` folder,
 * clearing it first (fully owned by this sketch, safe to clear -- same
 * reasoning as exportAbletonToLibrary/exportReaperToLibrary's own
 * Samples/Imported clearing), then opens it in Finder.
 */
export async function exportStemsToLibrary(state: AppState, libraryName: string): Promise<void> {
  const stemsDir = sketchStemsDir(libraryName)
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  await renderStemsToDir(state, stemsDir)
  await shell.openPath(stemsDir)
}

/**
 * Same no-dialog, always-in-a-Stems-subfolder export as
 * exportStemsToLibrary above, for a sketch with a known external file
 * location but not in the library.
 */
export async function exportStemsNextToSource(state: AppState, sourcePath: string): Promise<void> {
  const stemsDir = join(dirname(sourcePath), 'Stems')
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  await renderStemsToDir(state, stemsDir)
  await shell.openPath(stemsDir)
}
```

Add `sketchStemsDir` to this file's existing `./projectLibrary` import, `rmSync`/`mkdirSync`/
`dirname` to its existing `node:fs`/`node:path` imports if not already present (check first —
`mkdirSync` was already added in Step 4 above).

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/main/nativeExport.test.ts`
Expected: PASS (full file — confirm no regression in the pre-existing `loopLengthBarsFor`/
`soloState`/`nativeExport` describe blocks either)

- [ ] **Step 10: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS

- [ ] **Step 11: Commit**

```bash
git add src/main/nativeExport.ts src/main/nativeExport.test.ts
git commit -m "Group stems export by bus, add library-aware entry points"
```

---

### Task 8: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/index.ts` (add 5 new `ipcMain.handle` calls, update 1 existing handler's
  implementation)
- Modify: `src/preload/index.ts` (add 5 new methods to the `api` object — `RifffApi` is
  `typeof api`, so no separate type file needs editing)

- [ ] **Step 1: Add imports to `index.ts`**

Add to the existing import from `./exportAbleton` (or as a new import line, matching this file's
existing per-module import style):

```typescript
import { exportReaper, exportReaperToLibrary, exportReaperNextToSource } from './exportReaper'
```

Add `exportStemsToLibrary`, `exportStemsNextToSource` to this file's existing import from
`./nativeExport` (which already imports `nativeExportStemsToDisk`).

- [ ] **Step 2: Add the new IPC handlers**

In `src/main/index.ts`, right after the existing `export-als-next-to-source` handler (see
`src/main/index.ts:408-414`), add:

```typescript
  ipcMain.handle('export-rpp', async (event, stateJson: string, defaultName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return exportReaper(win, state, defaultName)
  })

  ipcMain.handle('export-rpp-to-library', async (_event, stateJson: string, libraryName: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return exportReaperToLibrary(state, libraryName)
  })

  ipcMain.handle(
    'export-rpp-next-to-source',
    async (_event, stateJson: string, sourcePath: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportReaperNextToSource(state, sourcePath)
    }
  )

  ipcMain.handle('export-stems-to-library', async (_event, stateJson: string, libraryName: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return exportStemsToLibrary(state, libraryName)
  })

  ipcMain.handle(
    'export-stems-next-to-source',
    async (_event, stateJson: string, sourcePath: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportStemsNextToSource(state, sourcePath)
    }
  )
```

- [ ] **Step 3: Add the new preload bridge methods**

In `src/preload/index.ts`, right after the existing `exportAlsNextToSource` method (see
`src/preload/index.ts:111-112`), add to the `api` object:

```typescript
  exportRpp: (stateJson: string, defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('export-rpp', stateJson, defaultName),
  exportRppToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-rpp-to-library', stateJson, libraryName),
  exportRppNextToSource: (stateJson: string, sourcePath: string): Promise<void> =>
    ipcRenderer.invoke('export-rpp-next-to-source', stateJson, sourcePath),
  exportStemsToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-stems-to-library', stateJson, libraryName),
  exportStemsNextToSource: (stateJson: string, sourcePath: string): Promise<void> =>
    ipcRenderer.invoke('export-stems-next-to-source', stateJson, sourcePath),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Add IPC handlers + preload bridge for Reaper export and bus-grouped stems export"
```

---

### Task 9: UI — export format picker (Ableton / Reaper / Stems)

**Files:**
- Create: `src/renderer/src/components/ExportFormatPicker.tsx`
- Modify: `src/renderer/src/App.tsx` (`ProjectMenu` component — see `src/renderer/src/
  App.tsx:416-690`)

Replaces the export dropdown's single `export ableton` item with `export project…`, which opens
a small format picker. The existing `TidyUpNudgeModal` gate now covers all three formats.

- [ ] **Step 1: Read the current `ProjectMenu` component in full**

Read `src/renderer/src/App.tsx:416-690` (the whole `ProjectMenu` function) before editing — you
need its exact current state, handlers, and JSX to modify correctly without disturbing anything
unrelated (the `save`/`open`/`new` buttons and their own menus are untouched by this task).

- [ ] **Step 2: Create `ExportFormatPicker.tsx`**

```typescript
// src/renderer/src/components/ExportFormatPicker.tsx

/** Small format-choice modal for the "export project…" menu item -- shown
 * before dispatching to whichever format's own dialog/library/
 * next-to-source entry-point logic (see App.tsx's ProjectMenu component).
 * Styled to match TidyUpNudgeModal.tsx's own dimmed-backdrop-plus-panel
 * convention. */
export function ExportFormatPicker({
  onChoose,
  onCancel
}: {
  onChoose: (format: 'ableton' | 'reaper' | 'stems') => void
  onCancel: () => void
}): React.JSX.Element {
  const buttonStyle = {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    height: 26,
    borderRadius: 0,
    padding: '0 10px',
    marginBottom: 6,
    fontSize: 11,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text-2)',
    cursor: 'pointer'
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(260px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">export as</span>
        <div style={{ marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('ableton')}>
            ableton project
          </button>
          <button style={buttonStyle} onClick={() => onChoose('reaper')}>
            reaper project
          </button>
          <button style={{ ...buttonStyle, marginBottom: 0 }} onClick={() => onChoose('stems')}>
            stems (grouped by bus)
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Generalize `ProjectMenu`'s export handlers**

In `src/renderer/src/App.tsx`, add the import:

```typescript
import { ExportFormatPicker } from './components/ExportFormatPicker'
```

Add a module-scope type declaration right after the imports (outside and above the `ProjectMenu`
function entirely — needed both inside `ProjectMenu`'s functions below and by its `useState<...>`
call, so it can't live inside the function body):

```typescript
type ExportFormat = 'ableton' | 'reaper' | 'stems'
```

Replace the existing `runExportAbleton` and `handleExportAbleton` functions (see
`src/renderer/src/App.tsx:542-587`) with:

```typescript
  async function runExportProject(format: ExportFormat): Promise<void> {
    setExporting(true)
    try {
      if (currentSketch !== null && currentSketch.kind === 'library') {
        if (format === 'ableton') {
          const warn = await window.rifffApi.shouldWarnBeforeAbletonOverwrite(currentSketch.name)
          if (
            warn &&
            !window.confirm(
              "This sketch's Ableton export has been modified since the last export from sssketch (likely from mixing directly in Ableton). Exporting again will overwrite it. Continue?"
            )
          ) {
            return
          }
          await window.rifffApi.exportAlsToLibrary(JSON.stringify(state), currentSketch.name)
        } else if (format === 'reaper') {
          await window.rifffApi.exportRppToLibrary(JSON.stringify(state), currentSketch.name)
        } else {
          await window.rifffApi.exportStemsToLibrary(JSON.stringify(state), currentSketch.name)
        }
      } else if (currentSketch !== null && currentSketch.kind === 'external') {
        if (format === 'ableton') {
          await window.rifffApi.exportAlsNextToSource(JSON.stringify(state), currentSketch.path)
        } else if (format === 'reaper') {
          await window.rifffApi.exportRppNextToSource(JSON.stringify(state), currentSketch.path)
        } else {
          await window.rifffApi.exportStemsNextToSource(JSON.stringify(state), currentSketch.path)
        }
      } else {
        // currentSketch === null: nothing saved yet, no real location to
        // export next to -- Ableton/Reaper fall back to a save dialog
        // (same as before); stems export already has its own dialog-based
        // folder picker as its fallback (nativeExportStemsToDisk).
        if (format === 'ableton') {
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          await window.rifffApi.exportAls(JSON.stringify(state), defaultName)
        } else if (format === 'reaper') {
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          await window.rifffApi.exportRpp(JSON.stringify(state), defaultName)
        } else {
          await window.rifffApi.exportStemsNative(JSON.stringify(state))
        }
      }
    } catch (err) {
      console.error(`ProjectMenu: failed to export (${format}):`, err)
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  function handleExportProject(format: ExportFormat): void {
    if (Object.keys(state.busOf).length === 0) {
      setPendingExportFormat(format)
      setTidyUpNudgeOpen(true)
      return
    }
    void runExportProject(format)
  }
```

Add a new piece of state right next to the existing `tidyUpNudgeOpen` state (see
`src/renderer/src/App.tsx:446`):

```typescript
  const [pendingExportFormat, setPendingExportFormat] = useState<ExportFormat | null>(null)
```

- [ ] **Step 4: Replace the export menu's single item + wire the picker + update the nudge modal**

Replace the export `ContextMenu`'s `items` array (see `src/renderer/src/App.tsx:661-665`):

```typescript
          items={[
            { label: 'export mix', onClick: handleExportMix },
            { label: 'export project…', onClick: () => setExportFormatPickerOpen(true) }
          ]}
```

Add a new state variable alongside `pendingExportFormat`:

```typescript
  const [exportFormatPickerOpen, setExportFormatPickerOpen] = useState(false)
```

Add the picker's own render, right before the existing `{tidyUpNudgeOpen && (...)}` block (see
`src/renderer/src/App.tsx:676`):

```typescript
      {exportFormatPickerOpen && (
        <ExportFormatPicker
          onChoose={(format) => {
            setExportFormatPickerOpen(false)
            handleExportProject(format)
          }}
          onCancel={() => setExportFormatPickerOpen(false)}
        />
      )}
```

Update the existing `TidyUpNudgeModal`'s `onExportAnyway` (see `src/renderer/src/App.tsx:682-685`)
to use the now-generalized `runExportProject` with the pending format, instead of the deleted
`runExportAbleton`:

```typescript
      {tidyUpNudgeOpen && (
        <TidyUpNudgeModal
          onTidyUp={() => {
            setTidyUpNudgeOpen(false)
            onOpenClusterStems()
          }}
          onExportAnyway={() => {
            setTidyUpNudgeOpen(false)
            if (pendingExportFormat) void runExportProject(pendingExportFormat)
          }}
        />
      )}
```

(`onTidyUp`'s body is unchanged — leave it exactly as it was.)

Delete the now-unused `export ableton`-only `{ label: 'export ableton', onClick:
handleExportAbleton }` entry if any trace of it remains after the Step 4 replacement above (it
shouldn't, since the whole `items` array was replaced) — double check.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 7: Manual verification (no automated UI tests exist for this component — see
  CLAUDE.md's own testing conventions)**

Run `npm run dev`, place at least one rifff on the timeline, tidy up (assign a bus), open the
export dropdown, click "export project…", confirm the picker shows three options, and confirm
each of the three (ableton/reaper/stems) actually triggers a real export without throwing — check
the resulting folder for each. Then start a FRESH, un-tidied project and confirm clicking any of
the three still shows the "tidy up first" nudge, and that "export anyway" from the nudge
correctly exports in whichever format was originally clicked (not always Ableton).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ExportFormatPicker.tsx src/renderer/src/App.tsx
git commit -m "Add export format picker (Ableton/Reaper/Stems), generalize export dispatch"
```

---

### Task 10: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS (every new test from Tasks 1, 3, 4, 5, 7 passing; no regressions anywhere else)

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: PASS (both node and web configs)

- [ ] **Step 3: Full lint**

Run: `npm run lint`
Expected: 0 errors (pre-existing unrelated warnings, if any, are fine — don't introduce new ones)

- [ ] **Step 4: Manual walkthrough in the running app**

Run `npm run dev`. Using a real project with at least 2 rifffs on different buses (or the demo
rifff plus a second import):

1. Tidy up, then export as Reaper. Confirm a `.rpp` file and a `Samples/Imported/` folder with
   real `.wav` files land where expected (library-resident: `<sketch>/Reaper/`; unsaved project:
   wherever the save dialog was pointed).
2. Export as stems. Confirm the destination folder contains per-bus subfolders (e.g. `drums/`,
   `bass/`), each with real, audibly-correct `.wav` files (open at least one and listen — not
   just check it exists).
3. Re-export as Ableton (the pre-existing path) and confirm it still works unchanged — this
   task's refactor (Task 2) must not have broken it.

- [ ] **Step 5: Real-Reaper manual verification (cannot be automated — required, not optional)**

This is the one part of this feature no amount of automated testing can confirm, since this
environment has no way to run actual REAPER. **Elling needs to open a real exported `.rpp` in
actual REAPER** and confirm/correct the following researched-but-unverified-in-practice details
(see the design doc's own "Manual verification" section and this plan's Task 5 code comments for
exactly which lines are affected if something needs fixing):

- Do the track/item colors (`PEAKCOL`) actually render as the intended bus colors, or does the
  BGR-packing assumption need flipping to RGB?
- Does a tiled (`LOOP 1`) item's source actually repeat/tile as expected, at the intended pitch
  and speed (`PLAYRATE`)?
- Does the whole-stem `MUTE` flag show as muted in REAPER's own UI, and does volume look right
  via `VOLPAN`?
- Do fades (`FADEIN`/`FADEOUT`) show up and behave as expected, including on a stem split by a
  partial mute region?

If REAPER rejects the file outright (fails to open/parse it), that's a more serious structural
problem than a wrong field value — report the exact REAPER error message back for a follow-up
fix, don't attempt to guess-and-check further changes to the RPP structure without it.

- [ ] **Step 6: Report back**

Summarize: test/typecheck/lint results, what the manual in-app walkthrough confirmed, and
explicitly flag that Step 5 (real REAPER verification) is Elling's own remaining action item, not
something this task can close out on its own.
