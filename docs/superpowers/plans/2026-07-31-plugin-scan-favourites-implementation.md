# Plugin Scan + Favourites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the master plugin chain's hardcoded 5-plugin allowlist with a real, subprocess-isolated VST3 directory scan, plus a favourites system so the master chain panel's dropdowns stay short once the catalog holds dozens of entries.

**Architecture:** Electron's main process lists `.vst3` candidates in `/Library/Audio/Plug-Ins/VST3` (safe, no plugin code runs), then spawns one fresh, timeout-guarded subprocess per candidate (`ssstitch-engine --scan-one-json <path>`) to probe it in isolation — a hang or crash in one plugin can never affect the live playback engine or the rest of the scan. Results persist to `app.getPath('userData')/pluginCatalog.json`, replacing the hardcoded allowlist tables entirely.

**Tech Stack:** JUCE 8.0.4 / C++20 (native-engine), Electron/React/TypeScript (renderer + main), Vitest, `juce::UnitTestRunner`.

---

**Full spec:** `docs/superpowers/specs/2026-07-31-plugin-scan-favourites-design.md` — read it before starting; this plan implements it task by task.

**Native build+test command:**
```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```

**Renderer/shared/main verification commands:**
```bash
npm run typecheck
npm run lint
npx vitest run
```

**Important note on Task 6 (migration):** `deserializeProject` in `src/renderer/src/state/serialize.ts` is a pure, synchronous function with no access to external async data — confirmed by reading it in full. The old-slug-to-catalog-id migration needs the plugin catalog (loaded asynchronously over IPC) to resolve a stale slug to a real catalog id, so it CANNOT live inside `deserializeProject` the way DAW mode's `migrateTrackOrder` did. Task 6 runs the migration as a `StoreContext.tsx` effect instead — see that task's own text for the exact design. Do not force this into `serialize.ts`.

**Important note on dead code:** `native-engine/Source/PluginScanner.h`/`.cpp`/`PluginScannerTests.cpp` are already dead — confirmed via `grep` that `isPluginCandidate`/`scanForPlugins` are never called anywhere (`Main.cpp` includes the header but calls neither function; `runScanOne`'s own `scanOneFileInto` is a separate, Main.cpp-local static function). Task 9 deletes these three files outright rather than trying to build on them.

---

### Task 1: Native `--scan-one-json` CLI mode

**Files:**
- Modify: `native-engine/Source/Main.cpp`

Reuses the existing `scanOneFileInto` helper (already defined in `Main.cpp`, used by the existing human-readable `--scan-one` mode) but prints a single JSON line to stdout instead of `juce::Logger::writeToLog` lines, so the main process can parse it reliably. Also reports each found plugin's `PluginDescription::createIdentifierString()` and a coarse architecture classification (`arm64`/`x86_64`/`universal`) read from the bundle's Mach-O binary via `juce::File` + a lightweight `lipo`-equivalent check — JUCE doesn't expose architecture detection directly, so this shells out to the system `file` command (matching how this exact fact was confirmed manually earlier in this session: `file "/Library/Audio/Plug-Ins/VST3/....vst3/Contents/MacOS/..."`).

- [ ] **Step 1: Add an architecture-detection helper to `Main.cpp`**, placed near `scanOneFileInto` (after its closing brace):

```cpp
// Shells out to the system `file` command against a VST3 bundle's inner
// Mach-O binary, since JUCE has no built-in architecture-detection API.
// Confirmed manually against real installed plugins during this feature's
// own design: some VST3s on this machine are x86_64-only (fail to load
// natively on this arm64 host — expected, not a bug) while others are
// arm64-native or universal.
static juce::String detectArchitecture(const juce::String& bundlePath)
{
    juce::File bundle(bundlePath);
    auto macOSDir = bundle.getChildFile("Contents").getChildFile("MacOS");
    auto binaries = macOSDir.findChildFiles(juce::File::findFiles, false);
    if (binaries.isEmpty())
        return "unknown";

    juce::ChildProcess fileProc;
    if (!fileProc.start("file \"" + binaries[0].getFullPathName() + "\""))
        return "unknown";
    const auto output = fileProc.readAllProcessOutput();
    fileProc.waitForProcessToFinish(5000);

    const bool hasArm64 = output.containsIgnoreCase("arm64");
    const bool hasX86 = output.containsIgnoreCase("x86_64");
    if (hasArm64 && hasX86) return "universal";
    if (hasArm64) return "arm64";
    if (hasX86) return "x86_64";
    return "unknown";
}
```

- [ ] **Step 2: Add `runScanOneJson`**, placed right after the existing `runScanOne` function:

```cpp
// Same probe as runScanOne, but machine-readable: a single JSON line on
// stdout, used by the plugin-scan feature's per-candidate subprocess (see
// docs/superpowers/specs/2026-07-31-plugin-scan-favourites-design.md).
// Deliberately a SEPARATE function from runScanOne (not a --json flag on
// it) so the existing diagnostic-only human-readable mode is untouched.
static int runScanOneJson(const juce::String& path)
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::Array<juce::PluginDescription> found;
    scanOneFileInto(formatManager, path, found);

    juce::var result;
    if (found.isEmpty())
    {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("success", false);
        obj->setProperty("error", "no plugin type found at this path");
        result = juce::var(obj.get());
    }
    else
    {
        const auto arch = detectArchitecture(path);
        juce::Array<juce::var> plugins;
        for (const auto& desc : found)
        {
            juce::DynamicObject::Ptr p = new juce::DynamicObject();
            p->setProperty("name", desc.name);
            p->setProperty("manufacturer", desc.manufacturerName);
            p->setProperty("identifierString", desc.createIdentifierString());
            p->setProperty("arch", arch);
            plugins.add(juce::var(p.get()));
        }
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("success", true);
        obj->setProperty("plugins", plugins);
        result = juce::var(obj.get());
    }

    // Plain stdout, not juce::Logger (which JUCE routes to stderr on macOS,
    // confirmed during Phase 1 of this project) -- the parent process reads
    // this from the child's stdout specifically, keeping it separate from
    // any stderr diagnostic noise the plugin's own loading code might emit.
    std::cout << juce::JSON::toString(result, true) << std::endl;
    return 0;
}
```

Add `#include <iostream>` near the top of `Main.cpp` if not already present (check first).

- [ ] **Step 3: Wire the new flag into `main()`'s dispatch**, right after the existing `--scan-one` branch:

```cpp
    if (argc > 2 && juce::String(argv[1]) == "--scan-one-json")
        return runScanOneJson(juce::String(argv[2]));
```

- [ ] **Step 4: Build and smoke-test manually against a real installed plugin**

```bash
cd native-engine && cmake --build build
./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --scan-one-json "/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3"
```
Expected: a single JSON line, `{"success": true, "plugins": [{"name": "Solid Bus Comp", "manufacturer": "...", "identifierString": "...", "arch": "arm64"}]}` (or `universal` — check the real output).

Also test the known x86_64-only case:
```bash
./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --scan-one-json "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3"
```
Expected: `{"success": false, "error": "no plugin type found at this path"}` (matches this session's own earlier finding that Pro-Q 3 is x86_64/i386-only and JUCE's scanner finds no loadable type for it on this arm64 host).

And a nonexistent path:
```bash
./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --scan-one-json "/no/such/plugin.vst3"
```
Expected: `{"success": false, "error": "no plugin type found at this path"}`.

- [ ] **Step 5: Run the full native test suite** (regression check — this task adds no automated tests of its own, since real plugin scanning depends on what's actually installed, matching this file's own existing "not testable, exercised manually" convention for `runScanOne`/`runScanReport`)

```bash
./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```
Expected: all existing suites pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/Main.cpp
git commit -m "Add --scan-one-json CLI mode for the plugin scan feature"
```

---

### Task 2: Main-process candidate listing + per-candidate subprocess spawn/timeout/kill

**Files:**
- Create: `src/main/pluginScan.ts`
- Create: `src/main/pluginScan.test.ts`

- [ ] **Step 1: Write failing tests** for the candidate-listing and single-probe logic

```ts
// src/main/pluginScan.test.ts
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isVst3Candidate, scanOneCandidate } from './pluginScan'

const realBinaryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native-engine/build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine'
)

describe('isVst3Candidate', () => {
  it('accepts .vst3, case-insensitively', () => {
    expect(isVst3Candidate('Foo.vst3')).toBe(true)
    expect(isVst3Candidate('Foo.VST3')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isVst3Candidate('readme.txt')).toBe(false)
    expect(isVst3Candidate('Foo.component')).toBe(false)
    expect(isVst3Candidate('.DS_Store')).toBe(false)
  })
})

describe('scanOneCandidate', () => {
  it('resolves with the found plugin(s) for a real installed VST3', async () => {
    const result = await scanOneCandidate(
      '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3',
      { binaryPathOverride: realBinaryPath, timeoutMs: 10000 }
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.plugins[0].name).toBe('Solid Bus Comp')
      expect(result.plugins[0].arch).toMatch(/arm64|universal/)
    }
  })

  it('resolves with success:false for a path with no loadable plugin type', async () => {
    const result = await scanOneCandidate('/no/such/plugin.vst3', {
      binaryPathOverride: realBinaryPath,
      timeoutMs: 10000
    })
    expect(result.success).toBe(false)
  })

  it('kills a hung probe after the timeout and resolves with success:false', async () => {
    // A fake "binary" that just sleeps -- proves the timeout+kill path works
    // without needing a real plugin that actually hangs (none of this
    // machine's installed plugins are known to hang, only some AU bundles
    // are per PHASE0_FINDINGS.md, and this app only scans VST3 anyway).
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-scan-test-'))
    const fakeBinary = join(dir, 'hang.sh')
    writeFileSync(fakeBinary, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
    try {
      const result = await scanOneCandidate('/fake/path.vst3', {
        binaryPathOverride: fakeBinary,
        timeoutMs: 300
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timed out/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/main/pluginScan.test.ts
```
Expected: FAIL (`./pluginScan` doesn't exist yet).

- [ ] **Step 3: Write `src/main/pluginScan.ts`**

```ts
// src/main/pluginScan.ts
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface ScannedPlugin {
  name: string
  manufacturer: string
  identifierString: string
  arch: 'arm64' | 'x86_64' | 'universal' | 'unknown'
}

export type ScanOneResult = { success: true; plugins: ScannedPlugin[] } | { success: false; error: string }

export function isVst3Candidate(filename: string): boolean {
  return filename.toLowerCase().endsWith('.vst3')
}

const VST3_DIRECTORY = '/Library/Audio/Plug-Ins/VST3'

/** Lists candidate .vst3 bundle paths under the fixed VST3 plugin directory.
 * Pure directory listing -- no plugin code runs, so this carries none of the
 * hang/crash risk documented in native-engine/PHASE0_FINDINGS.md; that risk
 * only exists once a plugin's own code actually gets loaded, which is
 * scanOneCandidate's job below, always in its own isolated subprocess. */
export function listVst3Candidates(): string[] {
  let entries: string[]
  try {
    entries = readdirSync(VST3_DIRECTORY)
  } catch {
    return [] // no VST3 directory on this machine -- not an error, just nothing to scan
  }
  return entries.filter(isVst3Candidate).map((name) => join(VST3_DIRECTORY, name))
}

function defaultBinaryPath(): string {
  return join(
    app.getAppPath(),
    'native-engine/build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine'
  )
}

export interface ScanOneOptions {
  binaryPathOverride?: string
  timeoutMs?: number
}

/** Probes a single candidate plugin path in a fresh, isolated, short-lived
 * subprocess (native-engine's own --scan-one-json mode) with a hard
 * timeout. A hang, crash, or non-zero exit is reported as success:false and
 * never throws -- this function is called once per candidate across a
 * whole-directory scan, and one bad plugin must never take down the rest of
 * the scan. Matches native-engine/PHASE0_FINDINGS.md's own explicit
 * recommendation: "scan each plugin candidate in an isolated subprocess
 * with a timeout." */
export function scanOneCandidate(path: string, options: ScanOneOptions = {}): Promise<ScanOneResult> {
  const binaryPath = options.binaryPathOverride ?? defaultBinaryPath()
  const timeoutMs = options.timeoutMs ?? 10000

  return new Promise((resolve) => {
    const proc = spawn(binaryPath, ['--scan-one-json', path])
    let settled = false
    let stdout = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      resolve({ success: false, error: `scan timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ success: false, error: err.message })
    })

    proc.once('exit', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(stdout.trim()) as ScanOneResult
        resolve(parsed)
      } catch {
        resolve({ success: false, error: 'scan subprocess produced no valid output' })
      }
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/pluginScan.test.ts
```
Expected: PASS (requires `native-engine` to be built with Task 1's changes first).

- [ ] **Step 5: Full verification**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/main/pluginScan.ts src/main/pluginScan.test.ts
git commit -m "Add candidate listing + isolated per-plugin scan subprocess"
```

---

### Task 3: `pluginCatalog.json` persistence + favourites

**Files:**
- Create: `src/main/pluginCatalog.ts`
- Create: `src/main/pluginCatalog.test.ts`

Mirrors `src/main/projectFile.ts`'s `writeAutosave`/`loadAutosave`/`clearAutosave` pattern exactly: `app.getPath('userData')`-relative file, try/catch-log-never-throw.

- [ ] **Step 1: Write failing tests**

```ts
// src/main/pluginCatalog.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('pluginCatalog', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'ssstitch-catalog-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('loadCatalog returns an empty catalog when no file exists yet', async () => {
    const { loadCatalog } = await import('./pluginCatalog')
    expect(loadCatalog()).toEqual({ plugins: [], favouriteIds: [] })
  })

  it('writeCatalog then loadCatalog round-trips', async () => {
    const { writeCatalog, loadCatalog } = await import('./pluginCatalog')
    const catalog = {
      plugins: [
        { id: 'x', name: 'Solid Bus Comp', manufacturer: 'NI', path: '/a.vst3', arch: 'arm64' as const }
      ],
      favouriteIds: ['x']
    }
    writeCatalog(catalog)
    expect(loadCatalog()).toEqual(catalog)
  })

  it('toggleFavourite adds an id not already favourited, removes one that is', async () => {
    const { writeCatalog, toggleFavourite, loadCatalog } = await import('./pluginCatalog')
    writeCatalog({
      plugins: [{ id: 'x', name: 'A', manufacturer: 'M', path: '/a.vst3', arch: 'arm64' }],
      favouriteIds: []
    })
    toggleFavourite('x')
    expect(loadCatalog().favouriteIds).toEqual(['x'])
    toggleFavourite('x')
    expect(loadCatalog().favouriteIds).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/main/pluginCatalog.test.ts
```
Expected: FAIL (`./pluginCatalog` doesn't exist yet).

- [ ] **Step 3: Write `src/main/pluginCatalog.ts`**

```ts
// src/main/pluginCatalog.ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface CatalogEntry {
  id: string // native engine's PluginDescription::createIdentifierString()
  name: string
  manufacturer: string
  path: string
  arch: 'arm64' | 'x86_64' | 'universal' | 'unknown'
}

export interface PluginCatalog {
  plugins: CatalogEntry[]
  favouriteIds: string[]
}

const CATALOG_FILENAME = 'pluginCatalog.json'

function catalogPath(): string {
  return join(app.getPath('userData'), CATALOG_FILENAME)
}

/** Reads back the plugin catalog -- an empty catalog (never a thrown error)
 * both when no scan has ever run and when reading one fails, matching
 * projectFile.ts's loadAutosave's own "nothing to offer, return the empty
 * case" convention. */
export function loadCatalog(): PluginCatalog {
  const path = catalogPath()
  if (!existsSync(path)) return { plugins: [], favouriteIds: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PluginCatalog
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadCatalog: failed to read ${path}: ${message}`)
    return { plugins: [], favouriteIds: [] }
  }
}

export function writeCatalog(catalog: PluginCatalog): void {
  try {
    writeFileSync(catalogPath(), JSON.stringify(catalog, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`writeCatalog: failed to write ${catalogPath()}: ${message}`)
  }
}

/** Toggles a single plugin id's favourite status and persists immediately.
 * A no-op (still persists cleanly) if the id isn't in the current catalog's
 * plugins list at all -- favouriting is deliberately not validated against
 * the plugins list, since a plugin can be favourited, then temporarily
 * disappear from a later rescan (external drive unmounted, etc.) without
 * losing its favourite status -- see the design spec's error-handling
 * section on this exact scenario. */
export function toggleFavourite(id: string): void {
  const catalog = loadCatalog()
  const index = catalog.favouriteIds.indexOf(id)
  if (index === -1) {
    catalog.favouriteIds.push(id)
  } else {
    catalog.favouriteIds.splice(index, 1)
  }
  writeCatalog(catalog)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/pluginCatalog.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full verification**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/main/pluginCatalog.ts src/main/pluginCatalog.test.ts
git commit -m "Add pluginCatalog.json persistence + favourites toggle"
```

---

### Task 4: Wire the scan orchestration + IPC (main process + preload)

**Files:**
- Create: `src/main/runFullScan.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

`runFullScan.ts` is the piece that actually drives a whole-directory scan: lists candidates (Task 2), probes each one sequentially (Task 2), reports progress, builds a fresh `PluginCatalog` (Task 3's shape), and writes it — merging in the OLD favourites for any plugin id still present, per the spec's "additive, never destructive" rule (a plugin not found in this scan keeps its favourite status; a scan never wipes favourites).

- [ ] **Step 1: Write `src/main/runFullScan.ts`**

```ts
// src/main/runFullScan.ts
import { listVst3Candidates, scanOneCandidate } from './pluginScan'
import { loadCatalog, writeCatalog, type CatalogEntry, type PluginCatalog } from './pluginCatalog'

export interface ScanProgress {
  done: number
  total: number
}

/** Runs a full VST3 directory scan, one candidate at a time (sequential --
 * see the design spec's rationale: simplest and safest for v1, avoids any
 * concurrency interaction with the per-candidate timeout/kill logic).
 * `onProgress` fires after each candidate finishes (success or not), so the
 * caller can push scan-progress over IPC without this module knowing
 * anything about IPC itself. Existing favourites are preserved for any
 * plugin id still found in this scan -- a scan is additive, never
 * destructive (see design spec's error-handling section). */
export async function runFullScan(onProgress: (progress: ScanProgress) => void): Promise<PluginCatalog> {
  const candidates = listVst3Candidates()
  const previous = loadCatalog()
  const plugins: CatalogEntry[] = []

  for (let i = 0; i < candidates.length; i++) {
    const result = await scanOneCandidate(candidates[i])
    if (result.success) {
      for (const p of result.plugins) {
        plugins.push({
          id: p.identifierString,
          name: p.name,
          manufacturer: p.manufacturer,
          path: candidates[i],
          arch: p.arch
        })
      }
    }
    onProgress({ done: i + 1, total: candidates.length })
  }

  const foundIds = new Set(plugins.map((p) => p.id))
  const favouriteIds = previous.favouriteIds.filter(
    (id) => foundIds.has(id) || !previous.plugins.some((p) => p.id === id)
  )
  // The filter above keeps a favourite id if EITHER it was found again this
  // scan, OR it wasn't even in the previous catalog's plugins list at all
  // (defensive -- shouldn't normally happen, but never silently drops a
  // favourite for a reason unrelated to "genuinely not found this scan").
  // A favourite that WAS in the previous catalog but ISN'T in this scan's
  // results is intentionally kept too, per the design spec -- recompute
  // that inclusion explicitly:
  for (const id of previous.favouriteIds) {
    if (!foundIds.has(id) && !favouriteIds.includes(id)) favouriteIds.push(id)
  }

  const catalog: PluginCatalog = { plugins, favouriteIds }
  writeCatalog(catalog)
  return catalog
}
```

**Note for the implementer:** the favourite-preservation logic above is written slightly defensively/redundantly to make the intent explicit (favourites are NEVER dropped by a scan, full stop) — simplify it if you find a cleaner way to express "keep every previous favourite id, regardless of whether this scan found it," but verify the simplification with the test in Step 2 below before committing to it.

- [ ] **Step 2: Add a Vitest test for the favourite-preservation behavior**

Create `src/main/runFullScan.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

vi.mock('./pluginScan', () => ({
  listVst3Candidates: () => ['/a.vst3'],
  scanOneCandidate: async () => ({
    success: true,
    plugins: [{ name: 'A', manufacturer: 'M', identifierString: 'id-a', arch: 'arm64' }]
  })
}))

describe('runFullScan', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'ssstitch-fullscan-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('preserves a favourite for a plugin not found in this scan', async () => {
    const { writeCatalog } = await import('./pluginCatalog')
    writeCatalog({
      plugins: [{ id: 'id-gone', name: 'Gone', manufacturer: 'M', path: '/gone.vst3', arch: 'arm64' }],
      favouriteIds: ['id-gone']
    })

    const { runFullScan } = await import('./runFullScan')
    const catalog = await runFullScan(() => {})

    expect(catalog.plugins.map((p) => p.id)).toEqual(['id-a'])
    expect(catalog.favouriteIds).toContain('id-gone')
  })

  it('reports progress once per candidate', async () => {
    const { runFullScan } = await import('./runFullScan')
    const progressCalls: unknown[] = []
    await runFullScan((p) => progressCalls.push(p))
    expect(progressCalls).toEqual([{ done: 1, total: 1 }])
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npx vitest run src/main/runFullScan.test.ts
```
Expected: PASS.

- [ ] **Step 4: Add IPC handlers to `src/main/index.ts`**

Add near the other `ipcMain.handle` registrations (after the `engine-close-master-plugin-editor` handler):

```ts
  ipcMain.handle('scan-plugins', async (event) => {
    const catalog = await runFullScan((progress) => {
      event.sender.send('scan-progress', progress)
    })
    return catalog
  })

  ipcMain.handle('get-plugin-catalog', () => loadCatalog())

  ipcMain.handle('toggle-plugin-favourite', (_event, id: string) => {
    toggleFavourite(id)
    return loadCatalog()
  })
```

Add the imports at the top of `src/main/index.ts`:

```ts
import { runFullScan } from './runFullScan'
import { loadCatalog, toggleFavourite } from './pluginCatalog'
```

- [ ] **Step 5: Add preload bridge methods to `src/preload/index.ts`**

```ts
  scanPlugins: (): Promise<PluginCatalog> => ipcRenderer.invoke('scan-plugins'),
  getPluginCatalog: (): Promise<PluginCatalog> => ipcRenderer.invoke('get-plugin-catalog'),
  togglePluginFavourite: (id: string): Promise<PluginCatalog> =>
    ipcRenderer.invoke('toggle-plugin-favourite', id),
  onScanProgress: (callback: (progress: { done: number; total: number }) => void): (() => void) => {
    const listener = (_event: unknown, progress: { done: number; total: number }): void => callback(progress)
    ipcRenderer.on('scan-progress', listener)
    return () => ipcRenderer.removeListener('scan-progress', listener)
  },
```

Add the import at the top of `src/preload/index.ts`:

```ts
import type { PluginCatalog } from '../main/pluginCatalog'
```

- [ ] **Step 6: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/main/runFullScan.ts src/main/runFullScan.test.ts src/main/index.ts src/preload/index.ts
git commit -m "Wire plugin scan orchestration + IPC (scan-plugins, catalog, favourites)"
```

---

### Task 5: Renderer `PluginCatalogCtx` in `StoreContext.tsx`

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

Mirrors the existing `MasterChainStatusCtx`/`MasterChainErrorCtx` pattern exactly (`createContext` + `useState` + provider wiring + exported hooks).

- [ ] **Step 1: Add the context + types**, near `MasterChainStatusCtx`/`MasterChainErrorCtx`:

```ts
import type { PluginCatalog } from '../../../main/pluginCatalog'

const PluginCatalogCtx = createContext<PluginCatalog>({ plugins: [], favouriteIds: [] })
const PluginScanStateCtx = createContext<{ scanning: boolean; progress: { done: number; total: number } | null }>({
  scanning: false,
  progress: null
})
```

- [ ] **Step 2: Add state + a startup load + the scan trigger inside `StoreProvider`**

```ts
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalog>({ plugins: [], favouriteIds: [] })
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    void window.rifffApi.getPluginCatalog().then(setPluginCatalog)
  }, [])

  useEffect(() => {
    return window.rifffApi.onScanProgress((progress) => setScanProgress(progress))
  }, [])
```

- [ ] **Step 3: Wrap the returned JSX in the two new providers**, alongside the existing `MasterChainStatusCtx`/`MasterChainErrorCtx` wrapping:

```tsx
              <MasterChainStatusCtx.Provider value={masterChainStatus}>
                <MasterChainErrorCtx.Provider value={masterChainError}>
                  <PluginCatalogCtx.Provider value={pluginCatalog}>
                    <PluginScanStateCtx.Provider value={{ scanning, progress: scanProgress }}>
                      {children}
                    </PluginScanStateCtx.Provider>
                  </PluginCatalogCtx.Provider>
                </MasterChainErrorCtx.Provider>
              </MasterChainStatusCtx.Provider>
```

- [ ] **Step 4: Add exported hooks**, near `useMasterChainStatus`/`useMasterChainError`:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePluginCatalog(): PluginCatalog {
  return useContext(PluginCatalogCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePluginScanState(): { scanning: boolean; progress: { done: number; total: number } | null } {
  return useContext(PluginScanStateCtx)
}
```

- [ ] **Step 5: Add a `triggerScan`/`toggleFavourite` pair of helper functions**, exported alongside the hooks, that `MasterChainPanel`/`PluginCatalogBrowser` (Tasks 7/8) will call — these need access to `setPluginCatalog`/`setScanning`, so they can't be plain module-level functions; instead expose them through a small third context:

```ts
const PluginCatalogActionsCtx = createContext<{
  triggerScan: () => void
  toggleFavourite: (id: string) => void
}>({ triggerScan: () => {}, toggleFavourite: () => {} })
```

Inside `StoreProvider`, define and provide the actions:

```ts
  const triggerScan = useCallback(() => {
    setScanning(true)
    setScanProgress(null)
    void window.rifffApi.scanPlugins().then((catalog) => {
      setPluginCatalog(catalog)
      setScanning(false)
      setScanProgress(null)
    })
  }, [])

  const toggleFavourite = useCallback((id: string) => {
    void window.rifffApi.togglePluginFavourite(id).then(setPluginCatalog)
  }, [])

  const pluginCatalogActions = useMemo(() => ({ triggerScan, toggleFavourite }), [triggerScan, toggleFavourite])
```

Wrap the JSX one level further with `<PluginCatalogActionsCtx.Provider value={pluginCatalogActions}>`, and add:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePluginCatalogActions(): { triggerScan: () => void; toggleFavourite: (id: string) => void } {
  return useContext(PluginCatalogActionsCtx)
}
```

- [ ] **Step 6: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "Add PluginCatalogCtx + scan trigger/favourite-toggle actions to StoreContext"
```

---

### Task 6: Old-slug-to-catalog-id migration

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

As flagged at the top of this plan: this CANNOT live in `serialize.ts`'s pure `deserializeProject`, since it needs the async-loaded plugin catalog. It runs as a `StoreContext.tsx` effect instead, reusing the existing `SET_MASTER_CHAIN_PLUGIN` action (no new reducer case needed) — once BOTH the catalog has loaded AND `state.masterChain` contains a stale slug, dispatch a fix-up.

- [ ] **Step 1: Add the migration table + effect**, near the other `masterChain`-related code in `StoreContext.tsx`:

```ts
// The 5 plugins the old hardcoded allowlist (src/shared/masterChainAllowlist.ts,
// deleted in Task 9) used to reference by these exact slugs. A pre-existing
// project save's masterChain array may still contain one of these slugs --
// this table resolves it to the real file path so it can be matched against
// a freshly-scanned catalog entry and swapped for that entry's real id
// (JUCE's PluginDescription::createIdentifierString(), not a slug). See
// docs/superpowers/specs/2026-07-31-plugin-scan-favourites-design.md's
// "Migration for existing saves" section.
const OLD_ALLOWLIST_SLUG_TO_PATH: Record<string, string> = {
  'solid-bus-comp': '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3',
  'pro-q-3': '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3',
  soothe2: '/Library/Audio/Plug-Ins/VST3/soothe2.vst3',
  'sausage-fattener': '/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3',
  'sunset-sound-reverb': '/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3'
}
```

Inside `StoreProvider`, add an effect that runs whenever the catalog or `state.masterChain` changes:

```ts
  useEffect(() => {
    if (pluginCatalog.plugins.length === 0) return // catalog not loaded yet, or never scanned
    state.masterChain.forEach((pluginId, slot) => {
      if (pluginId === null) return
      const oldPath = OLD_ALLOWLIST_SLUG_TO_PATH[pluginId]
      if (oldPath === undefined) return // not a stale slug, nothing to migrate
      const match = pluginCatalog.plugins.find((p) => p.path === oldPath)
      if (match === undefined) return // scan hasn't found it (not installed, or scan not run yet) -- leave as-is
      dispatch({ type: 'SET_MASTER_CHAIN_PLUGIN', slot: slot as 0 | 1 | 2 | 3, pluginId: match.id })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs on catalog/masterChain changes only; dispatch is stable
  }, [pluginCatalog, state.masterChain])
```

- [ ] **Step 2: Add a renderer test** in `src/renderer/src/state/store.test.ts` confirming `SET_MASTER_CHAIN_PLUGIN` (already tested for its own basic behavior) correctly overwrites a stale slug value — this is really just re-confirming the existing reducer case handles being called with an old slug already in that slot, so no new reducer code is needed:

```ts
  describe('SET_MASTER_CHAIN_PLUGIN (migration overwrite case)', () => {
    it('overwrites an old allowlist slug with a real catalog id', () => {
      let state = reducer(initialState, {
        type: 'SET_MASTER_CHAIN_PLUGIN',
        slot: 0,
        pluginId: 'solid-bus-comp'
      })
      state = reducer(state, {
        type: 'SET_MASTER_CHAIN_PLUGIN',
        slot: 0,
        pluginId: 'VST3-1234-real-identifier-string'
      })
      expect(state.masterChain[0]).toBe('VST3-1234-real-identifier-string')
    })
  })
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/state/store.test.ts
```

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx src/renderer/src/state/store.test.ts
git commit -m "Migrate old allowlist slugs to real catalog ids once scan results are available"
```

---

### Task 7: `MasterChainPanel.tsx` rework — scan button + favourites dropdown

**Files:**
- Modify: `src/renderer/src/components/MasterChainPanel.tsx`

Replaces the direct `MASTER_CHAIN_ALLOWLIST` import with `usePluginCatalog()`/`usePluginScanState()`/`usePluginCatalogActions()`, filtering each slot's dropdown to favourites only, and adds the scan button + progress display.

- [ ] **Step 1: Replace the import and add the new hooks**

```tsx
import {
  useAppState,
  useDispatch,
  useMasterChainStatus,
  useMasterChainError,
  usePluginCatalog,
  usePluginScanState,
  usePluginCatalogActions
} from '../state/StoreContext'
```
(Remove `import { MASTER_CHAIN_ALLOWLIST } from '@shared/masterChainAllowlist'` — that module is deleted in Task 9.)

Inside `MasterChainPanel`:

```ts
  const catalog = usePluginCatalog()
  const { scanning, progress } = usePluginScanState()
  const { triggerScan } = usePluginCatalogActions()
  const favourites = catalog.plugins.filter((p) => catalog.favouriteIds.includes(p.id))
```

- [ ] **Step 2: Add the scan button + progress display**, right after the header row (`master chain` / close button):

```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <button onClick={triggerScan} disabled={scanning} style={{ fontSize: 10, padding: '2px 6px' }}>
            {scanning ? `scanning... ${progress ? `${progress.done}/${progress.total}` : ''}` : 'scan for plugins'}
          </button>
        </div>
```

- [ ] **Step 3: Replace `MASTER_CHAIN_ALLOWLIST.map(...)` with `favourites.map(...)`** in each slot's `<select>`:

```tsx
              <option value="">none</option>
              {favourites.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
```

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 5: Manual verification (not automatable)** — start the dev server, confirm the scan button appears and (once Task 9 lands) the panel no longer imports the deleted allowlist module.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/MasterChainPanel.tsx
git commit -m "Rework MasterChainPanel to use the scanned catalog + favourites"
```

---

### Task 8: `PluginCatalogBrowser` component — full catalog, arch shown, star toggle

**Files:**
- Create: `src/renderer/src/components/PluginCatalogBrowser.tsx`
- Modify: `src/renderer/src/components/MasterChainPanel.tsx`

- [ ] **Step 1: Write `PluginCatalogBrowser.tsx`**

```tsx
// src/renderer/src/components/PluginCatalogBrowser.tsx
import { usePluginCatalog, usePluginCatalogActions } from '../state/StoreContext'

export function PluginCatalogBrowser({
  onSelect,
  onClose
}: {
  onSelect: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const catalog = usePluginCatalog()
  const { toggleFavourite } = usePluginCatalogActions()

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 4,
          padding: 8,
          width: 360,
          maxHeight: 420,
          overflowY: 'auto',
          fontSize: 11
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--ra-text-2)' }}>all scanned plugins</span>
          <button onClick={onClose} aria-label="Close plugin catalog browser">
            ×
          </button>
        </div>
        {catalog.plugins.length === 0 && (
          <div style={{ color: 'var(--ra-text-2)', padding: '8px 0' }}>
            no plugins scanned yet -- try "scan for plugins" first
          </div>
        )}
        {catalog.plugins.map((entry) => {
          const loadable = entry.arch === 'arm64' || entry.arch === 'universal'
          const isFavourite = catalog.favouriteIds.includes(entry.id)
          return (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 0',
                opacity: loadable ? 1 : 0.5
              }}
            >
              <button
                onClick={() => toggleFavourite(entry.id)}
                aria-label={`${isFavourite ? 'unfavourite' : 'favourite'} ${entry.name}`}
                style={{ fontSize: 10, padding: '1px 4px' }}
              >
                {isFavourite ? '★' : '☆'}
              </button>
              <span style={{ flex: 1 }}>{entry.name}</span>
              <span style={{ color: 'var(--ra-text-2)', fontSize: 9 }}>{entry.arch}</span>
              <button
                onClick={() => {
                  onSelect(entry.id)
                  onClose()
                }}
                disabled={!loadable}
                aria-label={`use ${entry.name}`}
                style={{ fontSize: 10, padding: '1px 6px' }}
              >
                use
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire a "browse all..." option into each slot's dropdown in `MasterChainPanel.tsx`**

Add local state for which slot (if any) has the browser open, right after the existing hooks:

```ts
  const [browsingSlot, setBrowsingSlot] = useState<number | null>(null)
```
(Add `useState` to the existing React import if not already present.)

Change the slot's `<select>` to include a browse option and handle it:

```tsx
              <option value="">none</option>
              {favourites.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
              <option value="__browse__">browse all...</option>
```

```tsx
              onChange={(e) => {
                if (e.target.value === '__browse__') {
                  setBrowsingSlot(slot)
                  return
                }
                dispatch({
                  type: 'SET_MASTER_CHAIN_PLUGIN',
                  slot: slot as 0 | 1 | 2 | 3,
                  pluginId: e.target.value === '' ? null : e.target.value
                })
              }}
```

At the end of the component's returned JSX (as a sibling, after the slot rows, before the closing panel `</div>`):

```tsx
      {browsingSlot !== null && (
        <PluginCatalogBrowser
          onSelect={(id) =>
            dispatch({ type: 'SET_MASTER_CHAIN_PLUGIN', slot: browsingSlot as 0 | 1 | 2 | 3, pluginId: id })
          }
          onClose={() => setBrowsingSlot(null)}
        />
      )}
```

Add the import:
```ts
import { PluginCatalogBrowser } from './PluginCatalogBrowser'
```

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/PluginCatalogBrowser.tsx src/renderer/src/components/MasterChainPanel.tsx
git commit -m "Add PluginCatalogBrowser for browsing/favouriting the full scanned catalog"
```

---

### Task 9: Delete the old hardcoded allowlist + dead `PluginScanner` files, point `MasterChain` at the new catalog

**Files:**
- Delete: `src/shared/masterChainAllowlist.ts`
- Delete: `src/shared/masterChainAllowlist.test.ts`
- Delete: `native-engine/Source/MasterChainAllowlist.h`
- Delete: `native-engine/Source/PluginScanner.h`
- Delete: `native-engine/Source/PluginScanner.cpp`
- Delete: `native-engine/Source/PluginScannerTests.cpp`
- Modify: `native-engine/CMakeLists.txt`
- Modify: `native-engine/Source/MasterChain.cpp`
- Modify: `src/shared/buildEngineProject.ts` (check for any reference — likely none, `masterChain` already flows through as plain id strings)

- [ ] **Step 1: Confirm no other callers of the files being deleted**

```bash
grep -rn "PluginScanner\|masterChainAllowlist\|MasterChainAllowlist" native-engine/Source src/ --include="*.ts" --include="*.tsx" --include="*.cpp" --include="*.h" --include="*.txt"
```
Expected: only the files themselves and (for `MasterChainAllowlist.h`) `native-engine/Source/MasterChain.cpp`'s `#include` and `instantiateFromAllowlist`, which Step 3 below rewrites. If anything else references them, stop and reconcile before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm src/shared/masterChainAllowlist.ts src/shared/masterChainAllowlist.test.ts
git rm native-engine/Source/MasterChainAllowlist.h
git rm native-engine/Source/PluginScanner.h native-engine/Source/PluginScanner.cpp native-engine/Source/PluginScannerTests.cpp
```

Remove `Source/PluginScanner.cpp` and `Source/PluginScannerTests.cpp` from `target_sources(...)` in `native-engine/CMakeLists.txt` (leave `MasterChain.cpp`/`MasterChainTests.cpp` — those stay).

Remove `#include "PluginScanner.h"` from `native-engine/Source/Main.cpp` (confirmed unused earlier in this plan).

- [ ] **Step 3: Rewrite `MasterChain.cpp`'s `instantiateFromAllowlist` to read the real, scanned catalog instead of the deleted hardcoded table**

The native engine still needs to resolve a plugin **id** (now a `PluginDescription::createIdentifierString()` value, not a slug) back to a real file path to load it — but the native engine has no direct access to `pluginCatalog.json` (that's a renderer/main-process concept). Simplest correct fix, consistent with how `EngineProject` already carries everything the engine needs: **the renderer already knows each slot's plugin's file path** (it read the catalog to populate the dropdown) — thread the path through the wire protocol instead of just the id.

Change `EngineProject::masterChain`'s wire shape from `std::array<juce::String, 4>` (bare ids) to an array of `{id, path}` pairs. Update `native-engine/Source/EngineProject.h`:

```cpp
        struct MasterChainSlot
        {
            juce::String pluginId; // "" = empty slot
            juce::String path; // only meaningful when pluginId is non-empty
        };
        std::array<MasterChainSlot, kNumMasterChainSlots> masterChain {};
```
(Replaces the old `std::array<juce::String, kNumMasterChainSlots> masterChain {};` field.)

Update `native-engine/Source/EngineProject.cpp`'s parsing (the block added in the master-plugin-chain plan) to read `{pluginId, path}` objects instead of plain strings:

```cpp
        auto masterChainVar = parsed.getProperty("masterChain", juce::var());
        if (auto* masterChainArray = masterChainVar.getArray())
        {
            for (int i = 0; i < kNumMasterChainSlots; ++i)
            {
                if (i >= masterChainArray->size()) continue;
                const auto& slotVar = (*masterChainArray)[i];
                project.masterChain[(size_t) i].pluginId = slotVar.getProperty("pluginId", "").toString();
                project.masterChain[(size_t) i].path = slotVar.getProperty("path", "").toString();
            }
        }
```

Update `native-engine/Source/MasterChain.cpp`'s `instantiateFromAllowlist` (rename to `instantiateFromPath`, since there's no allowlist anymore) to take a path directly instead of looking one up:

```cpp
    static std::unique_ptr<juce::AudioProcessor> instantiateFromPath(
        const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut)
    {
        if (path.isEmpty())
        {
            errorOut = {};
            return nullptr; // "no plugin" is a valid, silent/passthrough state -- not an error
        }

        juce::AudioPluginFormatManager formatManager;
        formatManager.addDefaultFormats();

        juce::Array<juce::PluginDescription> found;
        for (auto* format : formatManager.getFormats())
        {
            if (!format->fileMightContainThisPluginType(path))
                continue;
            juce::KnownPluginList knownPlugins;
            juce::OwnedArray<juce::PluginDescription> typesFound;
            knownPlugins.scanAndAddFile(path, false, typesFound, *format);
            for (auto* desc : typesFound)
                found.add(*desc);
        }
        if (found.isEmpty())
        {
            errorOut = "plugin not found at expected path: " + path;
            return nullptr;
        }

        auto instance = formatManager.createPluginInstance(found.getReference(0), sampleRate, blockSize, errorOut);
        if (instance == nullptr)
            return nullptr;
        instance->prepareToPlay(sampleRate, blockSize);
        return instance;
    }
```

Update `MasterChain::defaultInstantiate`'s signature and every call site (`loadPluginSync`, `requestLoad`) to pass a **path** instead of a **pluginId** — check `MasterChain.h`'s `Instantiator` typedef and update its first parameter's name/doc comment from `pluginId` to `path` for clarity (the type stays `const juce::String&`, only the meaning changes). Remove `#include "MasterChainAllowlist.h"` from `MasterChain.cpp`.

Update `IpcServer.cpp`'s `load-master-plugin` handler to read `path` from the payload instead of `pluginId` alone, and pass it through to `masterChain.requestLoad`:

```cpp
            const auto path = payload.getProperty("path", "").toString();
            ...
            masterChain.requestLoad(slot, path, transport.currentSampleRate(), transport.currentBlockSize(), ...)
```
(Keep `pluginId` in the reply payload for `master-plugin-loaded` — the renderer still needs it to know which slot/id succeeded, only the *load* itself now needs a path too.)

Update `RenderExport.cpp`'s per-slot sync-load loop to pass `project.masterChain[slot].path` instead of the old bare id.

- [ ] **Step 4: Update the renderer side to send `{pluginId, path}` instead of a bare id**

`src/shared/buildEngineProject.ts`: change `EngineProject.masterChain`'s type to `[{ pluginId: string; path: string }, ...]` (4 entries), and its construction to look up each slot's catalog entry. Since `buildEngineProject` doesn't currently have access to the plugin catalog, and it's a pure function taking `AppState` — thread the catalog in as a new parameter:

```ts
export async function buildEngineProject(
  state: AppState,
  resolveStretched: StretchResolver,
  pluginCatalog: { plugins: { id: string; path: string }[] }
): Promise<EngineProject> {
  ...
  const masterChain = state.masterChain.map((id) => {
    if (id === null) return { pluginId: '', path: '' }
    const entry = pluginCatalog.plugins.find((p) => p.id === id)
    return { pluginId: id, path: entry?.path ?? '' } // empty path = engine treats as empty/unresolvable
  }) as EngineProject['masterChain']
  return { ..., masterChain }
}
```

Update every call site of `buildEngineProject` (`StoreContext.tsx`'s load-project effect, `src/main/nativeExport.ts`) to pass the current plugin catalog. `nativeExport.ts` runs in the main process, which already owns `loadCatalog()` (Task 3) — call it directly there. `StoreContext.tsx` already holds `pluginCatalog` in state from Task 5 — pass it through.

Update `src/main/index.ts`'s `engine-load-master-plugin` handler to accept and forward a `path` alongside `pluginId`:

```ts
  ipcMain.handle('engine-load-master-plugin', (_event, slot: number, pluginId: string | null, path: string | null) => {
    playbackEngine?.client.send('load-master-plugin', { slot, pluginId, path })
  })
```

Update `src/preload/index.ts`'s `engineLoadMasterPlugin` signature to match, and `StoreContext.tsx`'s per-slot-diffing effect (from the master-plugin-chain build) to resolve the path from `pluginCatalog` before calling it:

```ts
        void window.rifffApi.engineLoadMasterPlugin(
          slot,
          pluginId,
          pluginId === null ? null : (pluginCatalog.plugins.find((p) => p.id === pluginId)?.path ?? null)
        )
```

- [ ] **Step 5: Update every existing test that constructs an `EngineProject`/`AppState.masterChain` fixture or calls `buildEngineProject`**

Search and update:
```bash
grep -rln "buildEngineProject(\|masterChain:" src/ native-engine/Source --include="*.test.ts" --include="*Tests.cpp"
```
This includes (at minimum, confirm the full list via the grep above): `src/shared/buildEngineProject.test.ts` (add the new third `pluginCatalog` argument to every call, and update the `masterChain` assertion shape from `['', 'pro-q-3', '', 'soothe2']` to the new `{pluginId, path}[]` shape), `src/renderer/src/state/store.test.ts`'s `SET_MASTER_CHAIN_PLUGIN` tests (unaffected — `AppState.masterChain` itself is still bare ids, unchanged), `native-engine/Source/EngineProjectTests.cpp`'s two masterChain-parsing tests (update the JSON fixture from `"masterChain": ["pro-q-3", "", "soothe2", ""]` to an array of `{pluginId, path}` objects and update the assertions to check `.pluginId`/`.path`).

- [ ] **Step 6: Build and run everything**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
cd .. && npm run typecheck && npm run lint && npx vitest run
```
Expected: all green. This is the largest, most interconnected task in the plan — if something doesn't compile or a test fails, work through it methodically file by file rather than guessing; the changes in Steps 3-5 all depend on each other's exact shapes matching.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Replace hardcoded allowlist with scanned catalog throughout the load path"
```

---

### Task 10: Final verification + manual walkthrough

No further code changes planned — verification and report only, unless Task 9's build step surfaced something that still needs fixing (fix it here if so, and note it in the report).

**This task's manual walkthrough is the real pass/fail signal for whether subprocess isolation actually behaves as designed against real installed plugins** — matching how the master-plugin-chain plan's own GUI-app-conversion and editor-window tasks were the highest-risk, most-honest-reporting-required tasks in that plan. A clean build and passing unit tests do NOT prove the scan is safe against ~50-100 real, unpredictable installed plugins — only running it for real does.

- [ ] **Step 1: Full native build+test**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```

- [ ] **Step 2: Full renderer/shared/main verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 3: Production build**

```bash
npx electron-vite build
```

- [ ] **Step 4: Dev-server restart + manual walkthrough** (required, not automatable)

```bash
pkill -9 -f "Claudecode/ssstitch"
nohup npm run dev > /tmp/ssstitch-dev.log 2>&1 & disown
```

Walk through, and report honestly on each:
- Run a real scan against this machine's actual `/Library/Audio/Plug-Ins/VST3` directory via the panel's "scan for plugins" button. Confirm progress reporting looks sane (doesn't read as hung) and it completes.
- Confirm the 5 previously-hardcoded plugins are found and show up as pre-favourited (their old slug correctly matched to a path in `OLD_ALLOWLIST_SLUG_TO_PATH`, matched against the fresh scan, migrated to favourites).
- Confirm FabFilter Pro-Q 3 (known x86_64-only) shows in the "browse all" catalog as visibly disabled/greyed, not selectable.
- Star/unstar a plugin in the catalog browser, confirm it updates the favourites dropdown immediately, and confirm it survives an app restart (quit and relaunch, check the favourite is still starred).
- Open a project saved before this feature shipped (one whose `masterChain` still references an old slug like `"solid-bus-comp"`, if one exists from earlier this session's testing) and confirm it resolves correctly to a real catalog entry rather than showing empty/broken.
- Load a plugin into a slot via the new catalog-backed flow and confirm live playback still works (the actual audio path, not just the picker UI) — this exercises Task 9's path-threading changes for real.

- [ ] **Step 5: Report**

Summarize what passed, what didn't. Be explicit and honest about the scan's real-world behavior against this machine's actual plugin collection (timing, any candidate that failed/timed out and what it was, whether anything came close to looking like a repeat of the HIToolbox/dispatch_assert_queue crash class already fixed once this session) rather than glossing over it. No commit for this task unless Step 1's build needed a fix.
