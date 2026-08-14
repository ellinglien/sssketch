# Plugin State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hosted plugin's tweaked parameters (knob positions, presets) survive an explicit Save/reload, and a mixdown export reflects whatever is currently live in the plugin — not always its default state, which is what both silently do today.

**Architecture:** A new `pluginStates` map (`{ "master:0": {pluginId, stateBase64}, "channel:<id>:0": {...}, ... }`) travels alongside — but outside — `AppState`/the reducer. It's captured from the native engine only at two moments: explicit Save (merged into the outgoing `.sssketchproj` JSON, then discarded from memory) and mixdown export (fetched fresh from the live engine right before building the export-only `EngineProject`, so an export taken without saving first still reflects current knob positions). On restore (project open), the just-parsed JSON's `pluginStates` is threaded through the existing per-slot `load-master-plugin`/`load-channel-plugin` IPC calls that already fire whenever `state.masterChain`/`state.channelPlugins` differ from their previous values — the exact same trigger a project's initial `LOAD_STATE` dispatch already uses to load plugin *identity*. The native engine captures/applies state via JUCE's own `getStateInformation()`/`setStateInformation()`, base64-encoded over the existing JSON-over-socket IPC wire format.

**Tech Stack:** TypeScript (Electron main + React renderer), C++/JUCE (native-engine subprocess), existing local-socket JSON IPC between them.

---

## Read before starting

- `docs/superpowers/specs/2026-08-14-plugin-state-persistence-design.md` — the approved design this plan implements.
- Root `CLAUDE.md`'s "Wire format twins" section — `EngineProject`/`buildEngineProject.ts` is explicitly flagged as the highest-blast-radius boundary in this codebase. Go file by file, methodically.
- Root `CLAUDE.md`'s native-engine rebuild instructions — after every native-engine change in this plan, rebuild (`cmake --build build` from `native-engine/`) and **fully quit and relaunch** the Electron app before manually testing. A renderer reload is not enough.

## Working directly on master, no worktree

This plan touches the single highest-risk boundary in the codebase (native engine wire format + real-time audio thread adjacency), but this session has used `master` directly for every prior task, including comparably risky native changes (RegionMute's native playback path, LiveDrag's `ProjectSnapshot` hardening) — all successfully landed with the existing two-stage subagent review process providing the safety net. There is no other in-flight work on a separate branch that isolation would protect against. Continuing that established convention: **work directly on `master`, no worktree.**

---

### Task 1: `src/shared/pluginStates.ts` — pure types + capture/restore helpers

**Files:**
- Create: `src/shared/pluginStates.ts`
- Create: `src/shared/pluginStates.test.ts`

This is the one new piece of pure, testable logic this feature needs — every other task either wires existing patterns together or touches native code with its own (JUCE `--test`) testing convention. Two pure functions: `buildPluginStatesMap` (used at Save time, turns a raw engine capture into the keyed map using the pluginIds `AppState` already knows) and `stateForSlot` (used at restore time, looks up a slot's blob only if its captured `pluginId` still matches what's actually being loaded there right now).

- [ ] **Step 1: Write the failing tests**

Create `src/shared/pluginStates.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildPluginStatesMap, stateForSlot, type RawPluginStatesCapture } from './pluginStates'

describe('buildPluginStatesMap', () => {
  it('includes a master slot only when both a pluginId and a non-empty captured state exist', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['AQIDBA==', '', '', ''],
      channelChains: []
    }
    const masterChain: (string | null)[] = ['reverb-plugin', null, null, null]
    const map = buildPluginStatesMap(raw, masterChain, {})
    expect(map).toEqual({
      'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' }
    })
  })

  it('omits a slot when the engine captured a state but AppState has no pluginId there (race/stale)', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['AQIDBA==', '', '', ''],
      channelChains: []
    }
    const masterChain: (string | null)[] = [null, null, null, null]
    const map = buildPluginStatesMap(raw, masterChain, {})
    expect(map).toEqual({})
  })

  it('omits a slot when AppState has a pluginId but the engine captured no state (empty slot, or capture legitimately empty)', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['', '', '', ''],
      channelChains: []
    }
    const masterChain: (string | null)[] = ['reverb-plugin', null, null, null]
    const map = buildPluginStatesMap(raw, masterChain, {})
    expect(map).toEqual({})
  })

  it('includes channel chain slots, keyed by channel:<channelId>:<slot>', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['', '', '', ''],
      channelChains: [{ channelId: 'kick', slots: ['Q0FUUw==', ''] }]
    }
    const channelPlugins: Record<string, [string | null, string | null]> = {
      kick: ['comp-plugin', null]
    }
    const map = buildPluginStatesMap(raw, [null, null, null, null], channelPlugins)
    expect(map).toEqual({
      'channel:kick:0': { pluginId: 'comp-plugin', stateBase64: 'Q0FUUw==' }
    })
  })

  it('ignores a channel chain entry for a channelId AppState no longer knows about', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['', '', '', ''],
      channelChains: [{ channelId: 'stale-channel', slots: ['AQ==', ''] }]
    }
    const map = buildPluginStatesMap(raw, [null, null, null, null], {})
    expect(map).toEqual({})
  })
})

describe('stateForSlot', () => {
  it('returns the blob when the captured pluginId matches what is being loaded', () => {
    const pluginStates = { 'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } }
    expect(stateForSlot(pluginStates, 'master:0', 'reverb-plugin')).toBe('AQIDBA==')
  })

  it('returns undefined when the pluginId does not match (a different plugin is being loaded into this slot)', () => {
    const pluginStates = { 'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } }
    expect(stateForSlot(pluginStates, 'master:0', 'other-plugin')).toBeUndefined()
  })

  it('returns undefined when there is no entry for this slot at all', () => {
    expect(stateForSlot({}, 'master:0', 'reverb-plugin')).toBeUndefined()
  })

  it('returns undefined when pluginId being loaded is null (an unload/empty-slot request)', () => {
    const pluginStates = { 'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } }
    expect(stateForSlot(pluginStates, 'master:0', null)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/shared/pluginStates.test.ts`
Expected: FAIL with "Cannot find module './pluginStates'"

- [ ] **Step 3: Implement `src/shared/pluginStates.ts`**

```typescript
/** A single captured plugin's own parameter state, base64-encoded from
 * JUCE's getStateInformation() -- see native-engine/Source/PluginChain.cpp's
 * captureStateBase64. pluginId travels alongside the blob (not just implied
 * by whatever the slot's own masterChain/channelPlugins entry says right
 * now) specifically so stateForSlot below can refuse to apply a blob to a
 * DIFFERENT plugin that now happens to occupy the same slot number. */
export interface PluginStateEntry {
  pluginId: string
  stateBase64: string
}

/** Keyed by the same slot-addressing convention used everywhere else this
 * feature touches: `master:<slotIndex 0-3>` and `channel:<channelId>:<slotIndex 0-1>`.
 * Lives in the persisted .sssketchproj JSON but deliberately NOT in
 * AppState/the reducer -- see docs/superpowers/specs/
 * 2026-08-14-plugin-state-persistence-design.md's own explanation of why. */
export type PluginStatesMap = Record<string, PluginStateEntry>

/** What the engine's own get-plugin-states IPC reply looks like, before
 * this module cross-references it against AppState's own masterChain/
 * channelPlugins to attach real pluginIds -- see buildEngineProject.ts's
 * near-identical EngineProject.masterChain/channelChains shape, which this
 * intentionally mirrors. Every slot always has an entry (possibly ""); the
 * engine has no opinion on which pluginId occupies a slot, so it never
 * includes one in its own reply. */
export interface RawPluginStatesCapture {
  masterChain: string[] // length 4, "" = no plugin loaded or capture produced nothing
  channelChains: { channelId: string; slots: string[] }[] // slots length 2
}

/** Cross-references a raw engine capture (which only knows slot INDICES,
 * not pluginIds -- see RawPluginStatesCapture's own doc comment) against
 * AppState's own masterChain/channelPlugins (which DO know pluginIds) to
 * build the final map that gets embedded in the saved project JSON. A slot
 * is included only when BOTH a real pluginId (AppState's own knowledge)
 * AND a non-empty captured state (the engine's own knowledge) are present
 * -- either one being absent means there's nothing meaningful to persist
 * for that slot. */
export function buildPluginStatesMap(
  raw: RawPluginStatesCapture,
  masterChain: (string | null)[],
  channelPlugins: Record<string, [string | null, string | null]>
): PluginStatesMap {
  const map: PluginStatesMap = {}

  raw.masterChain.forEach((stateBase64, slot) => {
    const pluginId = masterChain[slot]
    if (pluginId && stateBase64) {
      map[`master:${slot}`] = { pluginId, stateBase64 }
    }
  })

  for (const chain of raw.channelChains) {
    const slots = channelPlugins[chain.channelId]
    if (slots === undefined) continue // AppState no longer knows this channel -- nothing to attach a pluginId to
    chain.slots.forEach((stateBase64, slot) => {
      const pluginId = slots[slot]
      if (pluginId && stateBase64) {
        map[`channel:${chain.channelId}:${slot}`] = { pluginId, stateBase64 }
      }
    })
  }

  return map
}

/** Restore-time lookup: returns the captured state blob for `slotKey` ONLY
 * if `pluginId` (the plugin actually being loaded into this slot right now)
 * matches what was captured there -- otherwise undefined, silently, not an
 * error (see the design doc's own restore-flow section: a mismatch is the
 * expected case for a newly-added plugin, a hand-edited project file, or a
 * user manually picking a different plugin into a slot that used to hold
 * something else). */
export function stateForSlot(
  pluginStates: PluginStatesMap,
  slotKey: string,
  pluginId: string | null
): string | undefined {
  if (!pluginId) return undefined
  const entry = pluginStates[slotKey]
  if (!entry || entry.pluginId !== pluginId) return undefined
  return entry.stateBase64
}
```

- [ ] **Step 4: Run the tests again to confirm they pass**

Run: `npx vitest run src/shared/pluginStates.test.ts`
Expected: PASS, all 9 tests

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/pluginStates.ts src/shared/pluginStates.test.ts
git commit -m "$(cat <<'EOF'
Add pluginStates.ts: pure capture/restore helpers for plugin state persistence

buildPluginStatesMap cross-references a raw engine capture (slot indices
only) against AppState's own masterChain/channelPlugins (pluginIds only) to
build the map that gets embedded in a saved project. stateForSlot is the
symmetric restore-time lookup, refusing to apply a blob to a slot unless
the plugin actually being loaded there still matches what was captured.
Neither function touches AppState/the reducer directly -- this map lives
outside both, per the approved design doc.
EOF
)"
```

---

### Task 2: `EngineProject.h`/`.cpp` — wire-format `stateBase64` field

**Files:**
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Modify: `native-engine/Source/EngineProjectTests.cpp`

Adds an optional `stateBase64` string alongside `MasterChainSlot`'s existing `pluginId`/`path`, on both the master chain (fixed 4 slots) and each channel chain's 2 slots. Empty string (the default) means "nothing to restore" — identical convention to `pluginId`'s own empty-means-unset.

- [ ] **Step 1: Read `EngineProjectTests.cpp` in full first**

Run: `cat native-engine/Source/EngineProjectTests.cpp`

Find the existing test(s) that construct/parse a `masterChain`/`channelChains` JSON payload — you'll add a new one alongside them, matching the file's existing `beginTest`/`expect`/JSON-literal style exactly.

- [ ] **Step 2: Add `stateBase64` to `EngineProject.h`'s `MasterChainSlot`**

In `native-engine/Source/EngineProject.h`, replace:

```cpp
        struct MasterChainSlot
        {
            juce::String pluginId;
            juce::String path;
        };
```

with:

```cpp
        struct MasterChainSlot
        {
            juce::String pluginId;
            juce::String path;
            // "" (default) = nothing to restore for this slot -- either no
            // captured state exists, or (for a fresh load with no matching
            // captured pluginId) restoration deliberately doesn't apply.
            // Only ever read by RenderExport.cpp's offline plugin-load loop
            // -- the live engine's own load-master-plugin/load-channel-plugin
            // IPC handlers (IpcServer.cpp) restore state via a completely
            // separate path (their own payload's own stateBase64 field, not
            // this one), since live plugin loading never goes through
            // EngineProject/setProject() at all. See docs/superpowers/specs/
            // 2026-08-14-plugin-state-persistence-design.md.
            juce::String stateBase64;
        };
```

(This same struct is reused for both `masterChain` and every `EngineChannelChain::slots` entry — no separate change needed for the channel chain shape.)

- [ ] **Step 3: Parse `stateBase64` in `EngineProject.cpp`**

In `native-engine/Source/EngineProject.cpp`, find the master chain parsing block:

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

Add one line right after the `path` assignment:

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
                project.masterChain[(size_t) i].stateBase64 = slotVar.getProperty("stateBase64", "").toString();
            }
        }
```

Then find the channel chains parsing block:

```cpp
                auto slotsVar = entryVar.getProperty("slots", juce::var());
                if (auto* slotsArray = slotsVar.getArray())
                {
                    for (int i = 0; i < kNumChannelChainSlots; ++i)
                    {
                        if (i >= slotsArray->size()) continue;
                        const auto& slotVar = (*slotsArray)[i];
                        chain.slots[(size_t) i].pluginId = slotVar.getProperty("pluginId", "").toString();
                        chain.slots[(size_t) i].path = slotVar.getProperty("path", "").toString();
                    }
                }
```

Add the matching line:

```cpp
                auto slotsVar = entryVar.getProperty("slots", juce::var());
                if (auto* slotsArray = slotsVar.getArray())
                {
                    for (int i = 0; i < kNumChannelChainSlots; ++i)
                    {
                        if (i >= slotsArray->size()) continue;
                        const auto& slotVar = (*slotsArray)[i];
                        chain.slots[(size_t) i].pluginId = slotVar.getProperty("pluginId", "").toString();
                        chain.slots[(size_t) i].path = slotVar.getProperty("path", "").toString();
                        chain.slots[(size_t) i].stateBase64 = slotVar.getProperty("stateBase64", "").toString();
                    }
                }
```

- [ ] **Step 4: Add a test to `EngineProjectTests.cpp`**

Add a new `beginTest` block (adapt the exact insertion point/braces to match the file's existing `runTest()` structure once you've read it in Step 1 — this is the test body to insert):

```cpp
                beginTest("masterChain slot parses stateBase64, defaulting to empty when absent");
                {
                    EngineProject project;
                    juce::String error;
                    const bool ok = parseEngineProject(
                        R"({"masterChain":[{"pluginId":"reverb","path":"/plugins/reverb.vst3","stateBase64":"AQIDBA=="},{"pluginId":"","path":""},{"pluginId":"","path":""},{"pluginId":"","path":""}]})",
                        project, error);
                    expect(ok);
                    expectEquals(project.masterChain[0].stateBase64, juce::String("AQIDBA=="));
                    expectEquals(project.masterChain[1].stateBase64, juce::String());
                }

                beginTest("channelChains slot parses stateBase64 the same way");
                {
                    EngineProject project;
                    juce::String error;
                    const bool ok = parseEngineProject(
                        R"({"channelChains":[{"channelId":"kick","slots":[{"pluginId":"comp","path":"/plugins/comp.vst3","stateBase64":"Q0FUUw=="},{"pluginId":"","path":""}]}]})",
                        project, error);
                    expect(ok);
                    expect(project.channelChains.size() == 1);
                    expectEquals(project.channelChains[0].slots[0].stateBase64, juce::String("Q0FUUw=="));
                }
```

- [ ] **Step 5: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including the two new tests above (grep the output for "masterChain slot parses stateBase64" and "channelChains slot parses stateBase64").

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp
git commit -m "$(cat <<'EOF'
EngineProject: add stateBase64 to MasterChainSlot wire format

Optional field alongside the existing pluginId/path, empty by default
(same "unset" convention). Only ever consumed by RenderExport.cpp's
offline plugin-load path -- live plugin loading has its own separate
restore path via load-master-plugin/load-channel-plugin's own payload,
not this struct. First half of the wire-format pair with
buildEngineProject.ts (next task).
EOF
)"
```

---

### Task 3: `buildEngineProject.ts` — thread `pluginStates` through to the wire format

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `src/shared/buildEngineProject.test.ts`

Second half of Task 2's wire-format pair. `buildEngineProject` gains an optional 4th parameter, `pluginStates: PluginStatesMap = {}` (defaulting to empty, so every EXISTING call site — the live sync path, which never needs this — compiles unchanged with zero behavior difference). Only `nativeExport.ts` (Task 9) will ever pass a non-empty map.

- [ ] **Step 1: Read `buildEngineProject.test.ts` in full first**

Run: `cat src/shared/buildEngineProject.test.ts`

Find the existing test(s) covering `masterChain`/`channelChains` construction — match their fixture style exactly for the new test below.

- [ ] **Step 2: Write the failing test**

Add to `src/shared/buildEngineProject.test.ts` (adapt the exact fixture-building helpers to match whatever the file's existing tests already use for a minimal `AppState`/`pluginCatalog` — read the file first per Step 1 to get these right):

```typescript
it('threads pluginStates into masterChain/channelChains, matched by slot address and pluginId', async () => {
  const state = {
    ...minimalState(), // however the existing tests in this file build a minimal AppState -- reuse that exact helper
    masterChain: ['reverb-plugin', null, null, null] as AppState['masterChain'],
    channelPlugins: { kick: ['comp-plugin', null] as [string | null, string | null] }
  }
  const pluginCatalog = {
    plugins: [
      { id: 'reverb-plugin', path: '/plugins/reverb.vst3' },
      { id: 'comp-plugin', path: '/plugins/comp.vst3' }
    ]
  }
  const pluginStates = {
    'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' },
    'channel:kick:0': { pluginId: 'comp-plugin', stateBase64: 'Q0FUUw==' }
  }

  const project = await buildEngineProject(
    state,
    async (path) => ({ path, durationSec: 1 }),
    pluginCatalog,
    pluginStates
  )

  expect(project.masterChain[0].stateBase64).toBe('AQIDBA==')
  const kickChain = project.channelChains.find((c) => c.channelId === 'kick')
  expect(kickChain?.slots[0].stateBase64).toBe('Q0FUUw==')
})

it('leaves stateBase64 empty when pluginStates is omitted (existing callers unaffected)', async () => {
  const state = {
    ...minimalState(),
    masterChain: ['reverb-plugin', null, null, null] as AppState['masterChain']
  }
  const pluginCatalog = { plugins: [{ id: 'reverb-plugin', path: '/plugins/reverb.vst3' }] }

  const project = await buildEngineProject(state, async (path) => ({ path, durationSec: 1 }), pluginCatalog)

  expect(project.masterChain[0].stateBase64).toBe('')
})

it('leaves stateBase64 empty when a captured entry exists but its pluginId no longer matches the slot', async () => {
  const state = {
    ...minimalState(),
    masterChain: ['a-different-plugin', null, null, null] as AppState['masterChain']
  }
  const pluginCatalog = { plugins: [{ id: 'a-different-plugin', path: '/plugins/other.vst3' }] }
  const pluginStates = {
    'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } // stale -- a different plugin now occupies slot 0
  }

  const project = await buildEngineProject(
    state,
    async (path) => ({ path, durationSec: 1 }),
    pluginCatalog,
    pluginStates
  )

  expect(project.masterChain[0].stateBase64).toBe('')
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: FAIL — `buildEngineProject` called with 4 arguments doesn't yet accept a 4th, and `project.masterChain[0].stateBase64` is `undefined`.

- [ ] **Step 4: Implement**

In `src/shared/buildEngineProject.ts`:

Add the import at the top:

```typescript
import type { PluginStatesMap } from './pluginStates'
import { stateForSlot } from './pluginStates'
```

Update `EngineMasterChainSlot`:

```typescript
export interface EngineMasterChainSlot {
  pluginId: string
  path: string
  stateBase64: string
}
```

Update the function signature:

```typescript
export async function buildEngineProject(
  state: AppState,
  resolveStretched: StretchResolver,
  pluginCatalog: PluginCatalogForEngineProject,
  pluginStates: PluginStatesMap = {}
): Promise<EngineProject> {
```

Replace the `masterChain`/`channelChains` construction:

```typescript
  const masterChain = state.masterChain.map((id, slot) => {
    if (id === null) return { pluginId: '', path: '', stateBase64: '' }
    const entry = pluginCatalog.plugins.find((p) => p.id === id)
    return {
      pluginId: id,
      path: entry?.path ?? '', // empty path = engine treats as empty/unresolvable
      stateBase64: stateForSlot(pluginStates, `master:${slot}`, id) ?? ''
    }
  }) as EngineProject['masterChain']

  const channelChains: EngineChannelChain[] = Object.entries(state.channelPlugins)
    .filter(([, slots]) => slots.some((id) => id !== null))
    .map(([channelId, slots]) => ({
      channelId,
      slots: slots.map((id, slot) => {
        if (id === null) return { pluginId: '', path: '', stateBase64: '' }
        const entry = pluginCatalog.plugins.find((p) => p.id === id)
        return {
          pluginId: id,
          path: entry?.path ?? '',
          stateBase64: stateForSlot(pluginStates, `channel:${channelId}:${slot}`, id) ?? ''
        }
      }) as [EngineMasterChainSlot, EngineMasterChainSlot]
    }))
```

- [ ] **Step 5: Run the tests again to confirm they pass**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: PASS, all tests including the 3 new ones

- [ ] **Step 6: Typecheck + lint + full test suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: no errors, no regressions (the new default-empty 4th param means every other existing call site of `buildEngineProject` still compiles unchanged)

- [ ] **Step 7: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "$(cat <<'EOF'
buildEngineProject: thread pluginStates through to the wire format

New optional 4th param, defaulting to {} so every existing call site
(the live playback sync path) is unaffected. Only nativeExport.ts (a
later task) will ever pass a real map. Uses pluginStates.ts's own
stateForSlot to make sure a stale/mismatched captured entry never gets
attached to the wrong plugin.
EOF
)"
```

---

### Task 4: `PluginChain.h`/`.cpp` — capture/apply state, threaded through load

**Files:**
- Modify: `native-engine/Source/PluginChain.h`
- Modify: `native-engine/Source/PluginChain.cpp`
- Modify: `native-engine/Source/PluginChainTests.cpp`

Adds `captureStateBase64(slotIndex)` (read-only, message-thread) and a static `applyStateBase64(instance, stateBase64)` helper, then threads an optional `stateBase64` parameter through both `requestLoad` (live) and `loadPluginSync` (offline export) — applied to the freshly-instantiated processor **before** it becomes visible to the audio thread, which is what makes this safe without any new locking (see the doc comments below for exactly why).

- [ ] **Step 1: Read `ChannelChainRegistry.cpp` in full first**

Run: `cat native-engine/Source/ChannelChainRegistry.cpp`

You'll need its `requestLoad` forwarding method's exact current signature for Task 6.

- [ ] **Step 2: Add the two new methods to `PluginChain.h`**

In `native-engine/Source/PluginChain.h`, add right after `loadPluginSync`'s own declaration:

```cpp
        /** Message-thread API: captures slotIndex's currently active
         * plugin's own parameter state via getStateInformation(),
         * base64-encoded. Empty string if the slot has no plugin loaded
         * (including a bridged slot -- bridge-hosted plugin state capture
         * is out of scope for this feature, see the design doc's non-goals).
         *
         * Reads `active` without additional synchronization -- the SAME
         * accepted-risk pattern openEditorWindow already uses just below
         * (a plain pointer read racing the audio thread's own
         * applyPendingSwaps() write is not new risk this method
         * introduces; worst case is observing a briefly-stale but still
         * valid pointer, never a torn read, on every real target
         * platform). getStateInformation() itself is safe to call from the
         * message thread while this SAME instance concurrently processes
         * audio on another thread -- this is JUCE/VST3/AU's own
         * established host-plugin threading contract (real DAWs capture
         * plugin state for autosave during playback routinely); unlike
         * requestLoad's own macOS-UI-toolkit-during-INSTANTIATION hazard
         * (see requestLoad's own doc comment in the .cpp), this is not a
         * case this codebase has found to be unsafe in practice. */
        juce::String captureStateBase64(int slotIndex) const;

        /** Any-thread API, but ONLY ever safe to call at a point where
         * `instance` is not yet visible to the audio thread -- i.e. from
         * loadPluginSync's own synchronous, single-threaded export context
         * before it assigns slot.active, or from requestLoad's
         * message-thread callAsync lambda before the loaded instance is
         * published via slot.pending/pendingReady. Never call this on an
         * already-live slot.active. No-op if stateBase64 is empty or fails
         * to decode. */
        static void applyStateBase64(juce::AudioProcessor& instance, const juce::String& stateBase64);
```

Update `requestLoad`'s declaration:

```cpp
        void requestLoad(
            int slotIndex,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded,
            const juce::String& stateBase64 = {});
```

Update `loadPluginSync`'s declaration:

```cpp
        bool loadPluginSync(
            int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut,
            const juce::String& stateBase64 = {});
```

- [ ] **Step 3: Implement in `PluginChain.cpp`**

Add the two new methods (place them right after `loadPluginSync`'s own implementation):

```cpp
    juce::String PluginChain::captureStateBase64(int slotIndex) const
    {
        const auto& slot = slots[(size_t) slotIndex];
        if (slot.active == nullptr)
            return {};
        juce::MemoryBlock block;
        slot.active->getStateInformation(block);
        return block.toBase64Encoding();
    }

    void PluginChain::applyStateBase64(juce::AudioProcessor& instance, const juce::String& stateBase64)
    {
        if (stateBase64.isEmpty())
            return;
        juce::MemoryBlock block;
        if (block.fromBase64Encoding(stateBase64))
            instance.setStateInformation(block.getData(), (int) block.getSize());
    }
```

Update `loadPluginSync`'s signature and body — apply the state right after a successful instantiation, before it's assigned to `slot.active` (trivially safe here: this whole function is synchronous, single-threaded, export-only):

```cpp
    bool PluginChain::loadPluginSync(
        int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut,
        const juce::String& stateBase64)
    {
        auto instance = instantiator(path, sampleRate, blockSize, errorOut);
        if (!errorOut.isEmpty())
            return false;
        if (instance != nullptr)
            applyStateBase64(*instance, stateBase64);
        auto& slot = slots[(size_t) slotIndex];
        slot.active = std::move(instance); // nullptr (empty pluginId) is a valid "no plugin" state
        if (slot.active != nullptr)
            slot.active->setPlayHead(&playHead);
        slot.processChannels = slot.active != nullptr
            ? std::max({ 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() })
            : 2;
        return true;
    }
```

Update `requestLoad`'s signature and the LOCAL (non-bridge) instantiation branch — apply state right after `instantiator(...)` succeeds, still inside the message-thread `callAsync` lambda, strictly before the `PendingLoad` is published:

```cpp
    void PluginChain::requestLoad(
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded,
        const juce::String& stateBase64)
    {
        if (bridgeClient != nullptr && !path.isEmpty() && detectPluginArchitecture(path) == "x86_64")
        {
            // Bridge-hosted plugin state capture/restore is out of scope
            // for this feature (see the design doc's own non-goals) --
            // stateBase64 is silently ignored on this branch, same as an
            // empty one would be.
            static std::atomic<int> bridgeSlotCounter { 0 };
            const auto newBridgeSlotId = "bridge-slot-" + juce::String(bridgeSlotCounter.fetch_add(1));
            bridgeClient->loadPlugin(newBridgeSlotId, path, sampleRate, blockSize,
                [this, slotIndex, newBridgeSlotId, onLoaded](bool success, const juce::String& error)
                {
                    if (success)
                    {
                        auto& slot = slots[(size_t) slotIndex];
                        auto* newPending = new PendingLoad { nullptr, newBridgeSlotId };
                        delete slot.pending.exchange(newPending);
                        slot.pendingReady.store(true);
                    }
                    if (onLoaded)
                        onLoaded(success, error);
                });
            return;
        }

        juce::MessageManager::callAsync([this, slotIndex, path, sampleRate, blockSize, onLoaded, stateBase64]()
        {
            auto& slot = slots[(size_t) slotIndex];
            juce::String error;
            auto instance = instantiator(path, sampleRate, blockSize, error);
            const bool success = error.isEmpty();

            if (success)
            {
                // Applied here, strictly before the instance is published
                // via slot.pending/pendingReady below -- the audio thread's
                // own applyPendingSwaps() is the ONLY place slot.active
                // (and therefore audio-thread visibility) ever gets set, so
                // an instance that hasn't reached that exchange yet is
                // provably not being concurrently processed. See this
                // method's own .h doc comment.
                if (instance != nullptr)
                    applyStateBase64(*instance, stateBase64);
                auto* newPending = new PendingLoad { instance.release(), {} };
                delete slot.pending.exchange(newPending);
                slot.pendingReady.store(true);
            }

            if (onLoaded)
                onLoaded(success, error);
        });
    }
```

- [ ] **Step 4: Add a test to `PluginChainTests.cpp`**

Add a new test-plugin class (mirroring the file's existing `GainTestPlugin`/`NanTestPlugin` style) and a test exercising the full capture → apply round trip, inserted alongside the file's existing test plugin classes and `beginTest` blocks (read the file's exact current structure via your Step 1 read of `PluginChainTests.cpp` earlier in this plan-writing pass, or re-read it now — match the file's own conventions exactly):

```cpp
        /** Records whatever bytes setStateInformation was last called with,
         * and returns a fixed, known blob from getStateInformation -- lets
         * tests verify the full capture/apply round trip without needing a
         * real plugin binary. */
        class StateCapturingTestPlugin : public juce::AudioProcessor
        {
        public:
            const juce::String getName() const override { return "StateCapturingTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
            double getTailLengthSeconds() const override { return 0.0; }
            bool acceptsMidi() const override { return false; }
            bool producesMidi() const override { return false; }
            juce::AudioProcessorEditor* createEditor() override { return nullptr; }
            bool hasEditor() const override { return false; }
            int getNumPrograms() override { return 1; }
            int getCurrentProgram() override { return 0; }
            void setCurrentProgram(int) override {}
            const juce::String getProgramName(int) override { return {}; }
            void changeProgramName(int, const juce::String&) override {}
            void getStateInformation(juce::MemoryBlock& block) override
            {
                block.append(fixedState, sizeof(fixedState));
            }
            void setStateInformation(const void* data, int size) override
            {
                lastAppliedState.assign((const char*) data, (const char*) data + size);
            }

            static constexpr char fixedState[4] = { 1, 2, 3, 4 };
            std::vector<char> lastAppliedState;
        };

        PluginChain::Instantiator stateCaptureInstantiator(StateCapturingTestPlugin*& outPlugin)
        {
            return [&outPlugin](
                       const juce::String& pluginId, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (pluginId.isEmpty())
                    return nullptr;
                auto plugin = std::make_unique<StateCapturingTestPlugin>();
                outPlugin = plugin.get();
                return plugin;
            };
        }
```

And inside `PluginChainTests::runTest()`, add:

```cpp
                beginTest("captureStateBase64 round-trips through applyStateBase64 via loadPluginSync");
                {
                    StateCapturingTestPlugin* raw = nullptr;
                    PluginChain chain(4, stateCaptureInstantiator(raw));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "any-id", 44100.0, 512, err));
                    expect(raw != nullptr);

                    const auto captured = chain.captureStateBase64(0);
                    expect(captured.isNotEmpty());

                    // A second slot, loaded WITH the captured state passed straight through.
                    StateCapturingTestPlugin* raw2 = nullptr;
                    PluginChain chain2(4, stateCaptureInstantiator(raw2));
                    juce::String err2;
                    expect(chain2.loadPluginSync(0, "any-id", 44100.0, 512, err2, captured));
                    expect(raw2 != nullptr);
                    expect(raw2->lastAppliedState.size() == 4);
                    expectEquals((int) raw2->lastAppliedState[0], 1);
                    expectEquals((int) raw2->lastAppliedState[3], 4);
                }

                beginTest("captureStateBase64 returns empty for an empty slot");
                {
                    PluginChain chain(4, fakeInstantiator({}));
                    expect(chain.captureStateBase64(0).isEmpty());
                }
```

- [ ] **Step 5: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including the new "captureStateBase64..." tests.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/PluginChain.h native-engine/Source/PluginChain.cpp native-engine/Source/PluginChainTests.cpp
git commit -m "$(cat <<'EOF'
PluginChain: add captureStateBase64/applyStateBase64, thread through load paths

captureStateBase64 reads a live slot's own getStateInformation(), base64-
encoded -- safe from the message thread even during concurrent audio
processing, matching JUCE/VST3/AU's own established host-plugin threading
contract. applyStateBase64 is only ever called at a point where the
target instance isn't yet visible to the audio thread (loadPluginSync's
synchronous export-only body, or requestLoad's message-thread callAsync
lambda before the pending-swap publish) -- no new locking needed, this
insertion point is already off-audio-thread by construction. Both
requestLoad and loadPluginSync gain a defaulted stateBase64 parameter so
every existing call site compiles unchanged.
EOF
)"
```

---

### Task 5: `RenderExport.cpp` — apply captured state during offline export

**Files:**
- Modify: `native-engine/Source/RenderExport.cpp`

The export path already reads `project.masterChain[slot].path` and `project.channelChains[...].slots[slot].path` to call `loadPluginSync`. Now it also reads each slot's `stateBase64` and passes it straight through — the plumbing built in Tasks 2 and 4 does the rest.

- [ ] **Step 1: Update the master chain loop**

In `native-engine/Source/RenderExport.cpp`, replace:

```cpp
        for (int slot = 0; slot < kNumMasterChainSlots; ++slot)
        {
            const auto& path = project.masterChain[(size_t) slot].path;
            juce::String slotError;
            if (!masterChain.loadPluginSync(slot, path, sampleRate, blockSize, slotError))
            {
                errorOut = "master chain slot " + juce::String(slot) + " failed to load: " + slotError;
                return false;
            }
        }
```

with:

```cpp
        for (int slot = 0; slot < kNumMasterChainSlots; ++slot)
        {
            const auto& masterSlot = project.masterChain[(size_t) slot];
            juce::String slotError;
            if (!masterChain.loadPluginSync(
                    slot, masterSlot.path, sampleRate, blockSize, slotError, masterSlot.stateBase64))
            {
                errorOut = "master chain slot " + juce::String(slot) + " failed to load: " + slotError;
                return false;
            }
        }
```

- [ ] **Step 2: Update the channel chains loop**

Replace:

```cpp
            for (int slot = 0; slot < kNumChannelChainSlots; ++slot)
            {
                const auto& path = chainEntry.slots[(size_t) slot].path;
                juce::String slotError;
                if (!chain->loadPluginSync(slot, path, sampleRate, blockSize, slotError))
                {
                    errorOut = "channel \"" + chainEntry.channelId + "\" slot " + juce::String(slot)
                        + " failed to load: " + slotError;
                    return false;
                }
            }
```

with:

```cpp
            for (int slot = 0; slot < kNumChannelChainSlots; ++slot)
            {
                const auto& channelSlot = chainEntry.slots[(size_t) slot];
                juce::String slotError;
                if (!chain->loadPluginSync(
                        slot, channelSlot.path, sampleRate, blockSize, slotError, channelSlot.stateBase64))
                {
                    errorOut = "channel \"" + chainEntry.channelId + "\" slot " + juce::String(slot)
                        + " failed to load: " + slotError;
                    return false;
                }
            }
```

- [ ] **Step 3: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures (no new automated coverage here — this is a 2-line-per-loop plumbing change already covered end-to-end by Task 4's PluginChain-level test and this plan's own final manual walkthrough).

- [ ] **Step 4: Commit**

```bash
git add native-engine/Source/RenderExport.cpp
git commit -m "$(cat <<'EOF'
RenderExport: apply captured plugin state during offline export

Threads each slot's stateBase64 (now present in EngineProject, see Task 2)
through to loadPluginSync's own new stateBase64 param (Task 4). This is
the piece that actually fixes the "mixdown sounds pre-FX" bug -- export's
throwaway PluginChain now restores real captured parameters instead of
always starting every plugin at its own default state.
EOF
)"
```

---

### Task 6: `IpcServer.cpp` — restore on live load, new `get-plugin-states` capture handler

**Files:**
- Modify: `native-engine/Source/IpcServer.cpp`
- Modify: `native-engine/Source/ChannelChainRegistry.h`
- Modify: `native-engine/Source/ChannelChainRegistry.cpp`

Two independent changes: (1) `load-master-plugin`/`load-channel-plugin` read an optional `stateBase64` from their payload and pass it through to `requestLoad`. (2) A brand-new `get-plugin-states` request/response message captures current state from every loaded slot (master + every channel chain) and replies with the shape `RawPluginStatesCapture` (Task 1) expects.

`ChannelChainRegistry` needs one new method first: a way to enumerate currently-known channel IDs (nothing in the class exposes this today — `chainFor` requires already knowing the ID).

- [ ] **Step 1: Add `knownChannelIds()` to `ChannelChainRegistry`**

In `native-engine/Source/ChannelChainRegistry.h`, add right after `chainFor`'s declaration:

```cpp
        /** Message-thread API: every channel ID currently known (i.e.
         * present in the last-published map from updateChannelSet), in no
         * particular order. Used by the get-plugin-states IPC handler to
         * enumerate what to capture -- nothing else in this class exposes
         * enumeration today, only single-channel lookup via chainFor. */
        std::vector<juce::String> knownChannelIds() const;
```

In `native-engine/Source/ChannelChainRegistry.cpp`, add the implementation (place it near `chainFor`'s own implementation — read the file to find that exact spot):

```cpp
    std::vector<juce::String> ChannelChainRegistry::knownChannelIds() const
    {
        std::vector<juce::String> ids;
        auto* map = std::atomic_load_explicit(&published, std::memory_order_acquire);
        if (map == nullptr)
            return ids;
        ids.reserve(map->size());
        for (const auto& [channelId, chain] : *map)
            ids.push_back(channelId);
        return ids;
    }
```

(Match this against whatever `published`'s actual load pattern looks like elsewhere in the file you just read in Task 4's Step 1 — `chainFor`'s own body uses the identical atomic-load-then-lookup pattern; mirror it exactly rather than inventing a new one.)

- [ ] **Step 2: `load-master-plugin` reads and forwards `stateBase64`**

In `native-engine/Source/IpcServer.cpp`, replace the entire `load-master-plugin` handler:

```cpp
        else if (type == "load-master-plugin")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            if (slot < 0 || slot >= kNumMasterChainSlots)
                return;

            masterChain.requestLoad(slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                    obj->setProperty("type", "master-plugin-loaded");
                    obj->setProperty("payload", juce::var(payloadObj.get()));
                    sendJson(juce::var(obj.get()));
                });
        }
```

with:

```cpp
        else if (type == "load-master-plugin")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            const auto stateBase64 = payload.getProperty("stateBase64", "").toString();
            if (slot < 0 || slot >= kNumMasterChainSlots)
                return;

            masterChain.requestLoad(slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                    obj->setProperty("type", "master-plugin-loaded");
                    obj->setProperty("payload", juce::var(payloadObj.get()));
                    sendJson(juce::var(obj.get()));
                },
                stateBase64);
        }
```

(Only two changes: the new `stateBase64` read, and `, stateBase64)` replacing the previous call's bare `);` at the very end — the callback body itself is untouched.)

- [ ] **Step 3: `load-channel-plugin` reads and forwards `stateBase64`**

Same pattern, for the channel handler. Replace the entire `load-channel-plugin` handler:

```cpp
        else if (type == "load-channel-plugin")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            if (slot < 0 || slot >= kNumChannelChainSlots)
                return;

            channelChains.requestLoad(channelId, slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, channelId, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("channelId", channelId);
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                    obj->setProperty("type", "channel-plugin-loaded");
                    obj->setProperty("payload", juce::var(payloadObj.get()));
                    sendJson(juce::var(obj.get()));
                });
        }
```

with:

```cpp
        else if (type == "load-channel-plugin")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            const auto stateBase64 = payload.getProperty("stateBase64", "").toString();
            if (slot < 0 || slot >= kNumChannelChainSlots)
                return;

            channelChains.requestLoad(channelId, slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, channelId, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("channelId", channelId);
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                    obj->setProperty("type", "channel-plugin-loaded");
                    obj->setProperty("payload", juce::var(payloadObj.get()));
                    sendJson(juce::var(obj.get()));
                },
                stateBase64);
        }
```

`ChannelChainRegistry::requestLoad` needs the same trailing param threaded straight through to the `PluginChain::requestLoad` call it makes internally. In `native-engine/Source/ChannelChainRegistry.h`, replace `requestLoad`'s declaration:

```cpp
        void requestLoad(
            const juce::String& channelId,
            int slotIndex,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);
```

with:

```cpp
        void requestLoad(
            const juce::String& channelId,
            int slotIndex,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded,
            const juce::String& stateBase64 = {});
```

In `native-engine/Source/ChannelChainRegistry.cpp`, replace its implementation:

```cpp
    void ChannelChainRegistry::requestLoad(
        const juce::String& channelId,
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        auto* chain = chainFor(channelId);
        if (chain == nullptr)
        {
            if (onLoaded)
                onLoaded(false, "unknown channel: " + channelId);
            return;
        }
        chain->requestLoad(slotIndex, path, sampleRate, blockSize, std::move(onLoaded));
    }
```

with:

```cpp
    void ChannelChainRegistry::requestLoad(
        const juce::String& channelId,
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded,
        const juce::String& stateBase64)
    {
        auto* chain = chainFor(channelId);
        if (chain == nullptr)
        {
            if (onLoaded)
                onLoaded(false, "unknown channel: " + channelId);
            return;
        }
        chain->requestLoad(slotIndex, path, sampleRate, blockSize, std::move(onLoaded), stateBase64);
    }
```

- [ ] **Step 4: Add the new `get-plugin-states` handler**

Add a new `else if` branch in `IpcConnection::messageReceived`, right after the existing `close-channel-plugin-editor` branch and before `render-export` (i.e. grouped with the other plugin-chain-related handlers):

```cpp
        else if (type == "get-plugin-states")
        {
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();

            juce::Array<juce::var> masterStatesVar;
            for (int slot = 0; slot < kNumMasterChainSlots; ++slot)
                masterStatesVar.add(masterChain.captureStateBase64(slot));
            payloadObj->setProperty("masterChain", masterStatesVar);

            juce::Array<juce::var> channelChainsVar;
            for (const auto& channelId : channelChains.knownChannelIds())
            {
                auto* chain = channelChains.chainFor(channelId);
                if (chain == nullptr)
                    continue; // raced with a concurrent updateChannelSet -- skip, matches this feature's own "best-effort capture" scope
                juce::DynamicObject::Ptr entryObj = new juce::DynamicObject();
                entryObj->setProperty("channelId", channelId);
                juce::Array<juce::var> slotsVar;
                for (int slot = 0; slot < kNumChannelChainSlots; ++slot)
                    slotsVar.add(chain->captureStateBase64(slot));
                entryObj->setProperty("slots", slotsVar);
                channelChainsVar.add(juce::var(entryObj.get()));
            }
            payloadObj->setProperty("channelChains", channelChainsVar);

            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "plugin-states");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
```

- [ ] **Step 5: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures (no new automated coverage for IpcServer.cpp's own message handling, matching this project's own established convention that IPC wiring is typecheck/manual-walkthrough-verified, not unit-tested — see CLAUDE.md's Testing conventions). This step just confirms the build still compiles and the existing suite still passes after the signature changes.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/IpcServer.cpp native-engine/Source/ChannelChainRegistry.h native-engine/Source/ChannelChainRegistry.cpp
git commit -m "$(cat <<'EOF'
IpcServer: restore plugin state on live load, add get-plugin-states capture

load-master-plugin/load-channel-plugin now read an optional stateBase64
from their payload and forward it to PluginChain::requestLoad (Task 4).
New get-plugin-states request/response message captures current state
from every loaded master + channel-chain slot, replying in the shape
src/shared/pluginStates.ts's RawPluginStatesCapture expects.
ChannelChainRegistry gains knownChannelIds() to enumerate what to
capture -- nothing exposed enumeration before, only single-channel
chainFor lookup.
EOF
)"
```

---

### Task 7: Main process — `get-plugin-states` IPC round trip + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

Thin proxy, matching the exact `engine-get-buffer-size` pattern already in `index.ts` — main forwards the request to whichever engine connection the caller specifies (this needs to work against BOTH the persistent live engine, for Save, and an export-only spawned engine, for export — see Task 9 for why export needs its own variant that queries the LIVE engine specifically).

- [ ] **Step 1: Add the main-process IPC handler**

In `src/main/index.ts`, add the import:

```typescript
import type { RawPluginStatesCapture } from '@shared/pluginStates'
```

Add right after the existing `engine-get-buffer-size` handler:

```typescript
  ipcMain.handle('engine-get-plugin-states', async (): Promise<RawPluginStatesCapture | null> => {
    if (!playbackEngine) return null
    try {
      const result = (await playbackEngine.client.sendAndAwaitType(
        'get-plugin-states',
        undefined,
        'plugin-states'
      )) as RawPluginStatesCapture
      return result
    } catch (err) {
      console.error('engine-get-plugin-states: failed:', err)
      return null
    }
  })
```

- [ ] **Step 2: Add the preload bridge method**

In `src/preload/index.ts`, add the import:

```typescript
import type { RawPluginStatesCapture } from '@shared/pluginStates'
```

Add right after wherever `engineGetBufferSize` (or its equivalent name — find the exact existing method wrapping `'engine-get-buffer-size'`) is defined:

```typescript
  engineGetPluginStates: (): Promise<RawPluginStatesCapture | null> =>
    ipcRenderer.invoke('engine-get-plugin-states'),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Add engine-get-plugin-states IPC round trip + preload bridge

Thin proxy to the engine's new get-plugin-states message (previous task),
matching the existing engine-get-buffer-size pattern exactly. Returns
null (not a throw) if the engine subprocess isn't running or the round
trip fails -- callers (handleSave, nativeExport) decide how to treat that.
EOF
)"
```

---

### Task 8: `App.tsx` `handleSave()` — capture state at save time

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/state/serialize.ts`

`serializeProject` gains an optional second parameter so its caller can embed a `pluginStates` map into the outgoing JSON without that map ever touching `AppState`/the reducer. `handleSave()` fetches the map (via Task 7's new preload method + `pluginStates.ts`'s `buildPluginStatesMap`) before calling `serializeProject`, and — matching the design's explicit failure-handling choice — treats a failed/timed-out engine round trip exactly like any other save failure: it does not write the file.

- [ ] **Step 1: Extend `serializeProject`**

In `src/renderer/src/state/serialize.ts`, add the import:

```typescript
import type { PluginStatesMap } from '@shared/pluginStates'
```

Replace `serializeProject`:

```typescript
export function serializeProject(state: AppState, pluginStates: PluginStatesMap = {}): string {
  // Rest destructure is how we drop the transient UI-mode fields;
  // ignoreRestSiblings isn't enabled project-wide, so the extracted-but-unused
  // bindings need an explicit disable.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    volumeDragMode,
    mode,
    inspectorCollapsed,
    metronomeEnabled,
    armedChannelId,
    recordingArmReminderChannelId,
    availableInputDevices,
    selectedInputDevice,
    regionSelection,
    tidiedView,
    gatedRecordingEnabled,
    gatedRecordingChannelId,
    gatedRecordingTargetGroupId,
    pendingLockInConfirm,
    ...rest
  } = state
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // pluginStates lives outside AppState entirely (see pluginStates.ts's own
  // doc comment) -- merged in here, at the very last moment before
  // stringifying, rather than ever being carried on `state` itself.
  // Omitted from the output entirely when empty, so an old project with no
  // plugins ever loaded doesn't grow a permanent `"pluginStates": {}` line.
  const withPluginStates =
    Object.keys(pluginStates).length > 0 ? { ...rest, pluginStates } : rest
  return JSON.stringify(withPluginStates, null, 2)
}
```

- [ ] **Step 2: Update `handleSave()` in `App.tsx`**

Find the import section near the top of `App.tsx` and add:

```typescript
import { buildPluginStatesMap } from '@shared/pluginStates'
```

Replace `handleSave`:

```typescript
  async function handleSave(): Promise<boolean> {
    try {
      const rawPluginStates = await window.rifffApi.engineGetPluginStates()
      if (rawPluginStates === null) {
        throw new Error('failed to read current plugin state from the engine')
      }
      const pluginStates = buildPluginStatesMap(rawPluginStates, state.masterChain, state.channelPlugins)
      const json = serializeProject(state, pluginStates)
      if (currentSketch === null) {
        const name = await window.rifffApi.generateDefaultProjectName()
        await window.rifffApi.saveProjectToLibrary(name, json)
        setCurrentSketch({ kind: 'library', name })
      } else if (currentSketch.kind === 'library') {
        await window.rifffApi.saveProjectToLibrary(currentSketch.name, json)
      } else {
        await window.rifffApi.saveProjectInPlace(currentSketch.path, json)
      }
      lastSavedJsonRef.current = json
      setSaveVersion((v) => v + 1)
      return true
    } catch (err) {
      console.error('Frame: failed to save project:', err)
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
```

(The rest of the function — everything after this point — is unchanged; only the body up through the `try` block's plugin-state-and-json lines changed.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all pass (no test in this repo currently calls `serializeProject` with just one argument in a way the new default breaks — the default value keeps every existing call site source-compatible; confirm this by grepping: `grep -rn "serializeProject(" src/` and eyeballing each call site still compiles under the new optional-second-arg signature).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/serialize.ts src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
handleSave: capture and embed current plugin state on every explicit save

serializeProject gains an optional pluginStates param, merged into the
outgoing JSON only when non-empty (so an old project with no plugins
loaded doesn't grow a permanent empty pluginStates field). handleSave
fetches current state from the engine first via the new
engine-get-plugin-states round trip -- per the approved design's explicit
choice, a failed/timed-out round trip is treated exactly like any other
save failure: the file is not written, and Save reports failure to
whichever caller invoked it (Save button, Cmd+S, quit-time save,
discard-guard).
EOF
)"
```

---

### Task 9: `nativeExport.ts` — fetch live plugin state before building the export project

**Files:**
- Modify: `src/main/nativeExport.ts`
- Modify: `src/main/index.ts`

This is the task that actually fixes the reported bug. Export spawns its own throwaway engine (unrelated to the persistent live one), so it needs its OWN fetch of current plugin state from the LIVE engine before building the `EngineProject` it hands to that throwaway engine — otherwise a plugin tweaked live but never explicitly saved would still export at default settings. `nativeExport()` gains a parameter for the raw capture (fetched by its caller in `index.ts`, which already has `playbackEngine` in scope — `nativeExport.ts` itself has no access to that module-level handle).

- [ ] **Step 1: Read the top of `nativeExport.ts` and the full `nativeExport` function once more**

You already read this function in full during this plan's own research phase — re-confirm its exact current signature and the exact `buildEngineProject` call site before editing (line numbers may have shifted slightly since then).

- [ ] **Step 2: Update `nativeExport`'s signature and its `buildEngineProject` call**

In `src/main/nativeExport.ts`, add the import:

```typescript
import { buildPluginStatesMap, type RawPluginStatesCapture } from '@shared/pluginStates'
```

Replace the function signature and its `buildEngineProject` call:

```typescript
export async function nativeExport(
  state: AppState,
  rawPluginStates: RawPluginStatesCapture | null
): Promise<Uint8Array> {
  const pluginStates =
    rawPluginStates !== null
      ? buildPluginStatesMap(rawPluginStates, state.masterChain, state.channelPlugins)
      : {}
  const project = await buildEngineProject(state, resolveStretchedForExport, loadCatalog(), pluginStates)
  const durationBars = loopLengthBarsFor(state)
```

(Everything after this point in the function — spawning the export engine, `load-project`, `render-export`, teardown — is unchanged. `rawPluginStates: null` is the explicit "couldn't fetch, export at default plugin state rather than failing the whole export" fallback — see Step 4 below for why this is the right failure mode here, distinct from Save's own "fail loud" choice.)

- [ ] **Step 3: Update `index.ts`'s `export-mix-native` handler to fetch live state first**

In `src/main/index.ts`, replace:

```typescript
  ipcMain.handle('export-mix-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return nativeExport(state)
  })
```

with:

```typescript
  ipcMain.handle('export-mix-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    // Best-effort: export at whatever plugin state is currently live in the
    // PERSISTENT engine (not the fresh, export-only one this function is
    // about to spawn) -- an export taken right after tweaking a plugin,
    // without an intervening explicit Save, should still reflect that
    // tweak. Unlike handleSave's own "fail loud, don't write the file"
    // choice, a failed fetch here degrades to exporting at default plugin
    // state rather than failing the whole export -- Save is the one place
    // this codebase treats plugin state as something the user is relying
    // on being durably correct; a mixdown is regenerable at any time by
    // exporting again once the engine round trip works.
    let rawPluginStates: RawPluginStatesCapture | null = null
    if (playbackEngine) {
      try {
        rawPluginStates = (await playbackEngine.client.sendAndAwaitType(
          'get-plugin-states',
          undefined,
          'plugin-states'
        )) as RawPluginStatesCapture
      } catch (err) {
        console.error('export-mix-native: failed to fetch live plugin states, exporting at default state:', err)
      }
    }
    return nativeExport(state, rawPluginStates)
  })
```

`RawPluginStatesCapture` is already imported into `index.ts` from Task 7's own Step 1 — no new import needed here.

- [ ] **Step 4: Confirm no other callers of `nativeExport` exist that need updating**

Run: `grep -rn "nativeExport(" src/main/`
Expected: exactly the one call site you just edited in `index.ts`, plus `nativeExport`'s own definition in `nativeExport.ts`. If any other call site exists (unlikely, but confirm), update it to pass `null` explicitly if it has no reasonable way to fetch live state.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/main/nativeExport.ts src/main/index.ts
git commit -m "$(cat <<'EOF'
nativeExport: fetch live plugin state before building the export project

This is the fix for the reported "mixdown sounds pre-FX" bug: export was
always spawning a fresh, separate engine that loaded master/channel-chain
plugins at their own default state, since plugin parameter state was
never available to it any other way. export-mix-native's handler now
fetches current state from the PERSISTENT live engine (get-plugin-states,
Task 6/7) before calling nativeExport, so an export taken right after
tweaking a plugin -- with no intervening explicit Save -- still reflects
that tweak. Degrades to default-state export (not a failed export) if the
live engine round trip fails, unlike Save's own fail-loud choice.
EOF
)"
```

---

### Task 10: Restore on project open — `deserializeProject` + `App.tsx`'s three open call sites

**Files:**
- Modify: `src/renderer/src/state/serialize.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/state/StoreContext.tsx`

`deserializeProject` returns `{ state, pluginStates }` instead of just `AppState`. `StoreContext.tsx` gains a small, self-contained mechanism for App.tsx to hand it a just-loaded project's `pluginStates` right before dispatching `LOAD_STATE` — a `pluginStatesRef` living inside `StoreProvider` itself (not the reducer), consumed by the two existing plugin-load diffing effects.

- [ ] **Step 1: Update `deserializeProject`'s return shape**

In `src/renderer/src/state/serialize.ts`, add the import (if not already added in Task 8):

```typescript
import type { PluginStatesMap } from '@shared/pluginStates'
```

Replace `deserializeProject`:

```typescript
export function deserializeProject(
  data: (PersistedProject | LegacyPersistedProject) & { pluginStates?: PluginStatesMap }
): { state: AppState; pluginStates: PluginStatesMap } {
  const { pluginStates, ...projectData } = data
  const migrated = 'channelOrder' in projectData ? {} : migrateTrackOrder(projectData.trackOrder)
  const state = { ...initialState, ...projectData, ...migrated }
  if (state.snapIdx > 4) state.snapIdx = 4
  state.rifffs = snapBarLengthNoise(state.rifffs)
  return {
    state: isSketchEligible(state) ? state : { ...state, mode: 'normal' },
    pluginStates: pluginStates ?? {}
  }
}
```

- [ ] **Step 2: Add `pluginStatesRef` + a restore-state helper inside `StoreProvider`**

In `src/renderer/src/state/StoreContext.tsx`, add near the top of the file (alongside the other `Ctx` declarations):

```typescript
const RestoreStateCtx = createContext<(state: AppState, pluginStates: PluginStatesMap) => void>(() => {})
```

Add the import:

```typescript
import type { PluginStatesMap } from '@shared/pluginStates'
```

Inside `StoreProvider` (find where `dispatch` itself is defined, via `useCallback` — you read this at line 269 during this plan-writing pass), add right after it:

```typescript
  // Owns pluginStates BETWEEN "a project was just parsed off disk" and "the
  // masterChain/channelPluginsRef diffing effects below fire their
  // engineLoadMasterPlugin/engineLoadChannelPlugin calls for it" -- see
  // pluginStates.ts's own doc comment for why this deliberately lives
  // OUTSIDE the reducer/AppState. A plain ref, not React state: nothing
  // ever needs to re-render off this value changing, only read it exactly
  // once per LOAD_STATE inside the two diffing effects below.
  const pluginStatesRef = useRef<PluginStatesMap>({})
  const restoreState = useCallback(
    (state: AppState, pluginStates: PluginStatesMap): void => {
      pluginStatesRef.current = pluginStates
      dispatch({ type: 'LOAD_STATE', state })
    },
    [dispatch]
  )
```

Find the `<DispatchCtx.Provider value={dispatch}>` opening tag (line ~739) and add a sibling provider right inside it:

```typescript
      <DispatchCtx.Provider value={dispatch}>
        <RestoreStateCtx.Provider value={restoreState}>
```

...and its matching closing tag right before `</DispatchCtx.Provider>` (line ~767) — read the exact current nesting of providers there first so the new one closes in the right place without breaking the existing tree.

Add the accessor hook next to `useDispatch`'s own definition (line ~802):

```typescript
export function useRestoreState(): (state: AppState, pluginStates: PluginStatesMap) => void {
  return useContext(RestoreStateCtx)
}
```

- [ ] **Step 3: Consume `pluginStatesRef` in the two diffing effects**

Still in `StoreContext.tsx`, update the master chain diffing effect (the one you read at lines 554-573):

```typescript
  const masterChainRef = useRef(state.masterChain)
  useEffect(() => {
    const prev = masterChainRef.current
    masterChainRef.current = state.masterChain
    state.masterChain.forEach((pluginId, slot) => {
      if (pluginId !== prev[slot]) {
        setMasterChainStatus((s) => {
          const next = [...s] as typeof s
          next[slot] = pluginId === null ? 'idle' : 'loading'
          return next
        })
        const path =
          pluginId === null
            ? null
            : (pluginCatalog.plugins.find((p) => p.id === pluginId)?.path ?? null)
        const stateBase64 = stateForSlot(pluginStatesRef.current, `master:${slot}`, pluginId) ?? null
        void window.rifffApi.engineLoadMasterPlugin(slot, pluginId, path, stateBase64)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.masterChain])
```

And the channel chain diffing effect (lines 578-603):

```typescript
  const channelPluginsRef = useRef(state.channelPlugins)
  useEffect(() => {
    const prev = channelPluginsRef.current
    channelPluginsRef.current = state.channelPlugins
    for (const channelId of Object.keys(state.channelPlugins)) {
      const slots = state.channelPlugins[channelId]
      const prevSlots = prev[channelId]
      slots.forEach((pluginId, slot) => {
        if (pluginId !== (prevSlots?.[slot] ?? null)) {
          setChannelChainStatus((s) => {
            const existing =
              s[channelId] ?? (['idle', 'idle'] as [MasterChainSlotStatus, MasterChainSlotStatus])
            const next = [...existing] as [MasterChainSlotStatus, MasterChainSlotStatus]
            next[slot] = pluginId === null ? 'idle' : 'loading'
            return { ...s, [channelId]: next }
          })
          const path =
            pluginId === null
              ? null
              : (pluginCatalog.plugins.find((p) => p.id === pluginId)?.path ?? null)
          const stateBase64 =
            stateForSlot(pluginStatesRef.current, `channel:${channelId}:${slot}`, pluginId) ?? null
          void window.rifffApi.engineLoadChannelPlugin(channelId, slot, pluginId, path, stateBase64)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.channelPlugins])
```

Add the import for `stateForSlot`:

```typescript
import { stateForSlot } from '@shared/pluginStates'
```

- [ ] **Step 4: Update `engineLoadMasterPlugin`/`engineLoadChannelPlugin`'s bridge signatures**

In `src/preload/index.ts`, find `engineLoadMasterPlugin`/`engineLoadChannelPlugin` (read their exact current signatures first — you saw them referenced at lines 213-228 during this plan's research) and add a `stateBase64: string | null` parameter to each, forwarded to the underlying `ipcRenderer.invoke` call:

```typescript
  engineLoadMasterPlugin: (
    slot: 0 | 1 | 2 | 3,
    pluginId: string | null,
    path: string | null,
    stateBase64: string | null
  ): Promise<void> => ipcRenderer.invoke('engine-load-master-plugin', slot, pluginId, path, stateBase64),
```

```typescript
  engineLoadChannelPlugin: (
    channelId: string,
    slot: 0 | 1,
    pluginId: string | null,
    path: string | null,
    stateBase64: string | null
  ): Promise<void> =>
    ipcRenderer.invoke('engine-load-channel-plugin', channelId, slot, pluginId, path, stateBase64),
```

(Adapt the exact parameter types to whatever the file's real current signatures use — read them first rather than trusting this paraphrase verbatim.)

- [ ] **Step 5: Thread `stateBase64` through `index.ts`'s IPC handlers**

In `src/main/index.ts`, update:

```typescript
  ipcMain.handle(
    'engine-load-master-plugin',
    (_event, slot: number, pluginId: string | null, path: string | null, stateBase64: string | null) => {
      playbackEngine?.client.send('load-master-plugin', { slot, pluginId, path, stateBase64 })
    }
  )
```

```typescript
  ipcMain.handle(
    'engine-load-channel-plugin',
    (
      _event,
      channelId: string,
      slot: number,
      pluginId: string | null,
      path: string | null,
      stateBase64: string | null
    ) => {
      playbackEngine?.client.send('load-channel-plugin', { channelId, slot, pluginId, path, stateBase64 })
    }
  )
```

(Match these against the exact current handler bodies at lines 808/810 and 823/825 you read during this plan's research — the shape shown above should already be correct, but confirm the surrounding handler registration syntax matches this file's real current style before committing.)

- [ ] **Step 6: Update App.tsx's three `deserializeProject` call sites**

Add the import:

```typescript
import { useRestoreState } from './state/StoreContext'
```

Inside the `Frame` component (wherever `const dispatch = useDispatch()` is already called), add:

```typescript
  const restoreState = useRestoreState()
```

**Call site 1 — `handleRecoverAutosave`.** Replace:

```typescript
    const loaded = deserializeProject(JSON.parse(recoverableAutosave.json))
    // Same pre-warm-before-LOAD_STATE reasoning as the library browser's
    // onSelect/onOpenFromDisk handlers below -- avoids the timeline/sketch
    // strip rendering with blank waveforms that pop in one at a time as
    // each mounted component's own decode finishes.
    setBusy('loading…')
    await warmStemCaches(loaded)
    dispatch({ type: 'LOAD_STATE', state: loaded })
    lastSavedJsonRef.current = serializeProject(loaded)
    setBusy(null)
```

with:

```typescript
    const { state: loaded, pluginStates } = deserializeProject(JSON.parse(recoverableAutosave.json))
    // Same pre-warm-before-LOAD_STATE reasoning as the library browser's
    // onSelect/onOpenFromDisk handlers below -- avoids the timeline/sketch
    // strip rendering with blank waveforms that pop in one at a time as
    // each mounted component's own decode finishes.
    setBusy('loading…')
    await warmStemCaches(loaded)
    restoreState(loaded, pluginStates)
    lastSavedJsonRef.current = serializeProject(loaded, pluginStates)
    setBusy(null)
```

**Call site 2 — library browser `onSelect`.** Replace:

```typescript
                  const result = await window.rifffApi.openLibrarySketch(name)
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'library', name })
```

with:

```typescript
                  const result = await window.rifffApi.openLibrarySketch(name)
                  if (!result) return
                  const { state: loaded, pluginStates } = deserializeProject(JSON.parse(result.json))
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  restoreState(loaded, pluginStates)
                  lastSavedJsonRef.current = serializeProject(loaded, pluginStates)
                  setCurrentSketch({ kind: 'library', name })
```

**Call site 3 — `onOpenFromDisk`.** Replace:

```typescript
                  const result = await window.rifffApi.openProject()
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  // Same pre-warm-before-LOAD_STATE reasoning as the onSelect
                  // handler right above -- see its own comment history.
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'external', path: result.path })
```

with:

```typescript
                  const result = await window.rifffApi.openProject()
                  if (!result) return
                  const { state: loaded, pluginStates } = deserializeProject(JSON.parse(result.json))
                  // Same pre-warm-before-LOAD_STATE reasoning as the onSelect
                  // handler right above -- see its own comment history.
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  restoreState(loaded, pluginStates)
                  lastSavedJsonRef.current = serializeProject(loaded, pluginStates)
                  setCurrentSketch({ kind: 'external', path: result.path })
```

(All three call sites' surrounding code — `try`/`catch`/`finally`, `setBusy(null)` in the `finally` block, etc. — is unchanged; only the lines shown above change. `dispatch` itself may become unused in `Frame` if these three sites were its only callers — check with `grep -n "dispatch(" ` scoped to the `Frame` component after this edit; if `dispatch` has no remaining call sites, TypeScript's `noUnusedLocals` will catch it at the typecheck step below, and the fix is to also remove the now-unused `const dispatch = useDispatch()` line — but do NOT do this speculatively, only if the compiler actually flags it, since `dispatch` is very likely still used elsewhere in this large component for ordinary user-edit actions.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors — this touches many call sites; if the compiler surfaces a `deserializeProject` call you missed (its return type changed from `AppState` to `{state, pluginStates}`), fix it the same way.

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: all pass. If any existing test calls `deserializeProject` directly and destructures its return value as a plain `AppState`, update that test to destructure `{ state }` instead.

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/state/serialize.ts src/renderer/src/App.tsx src/renderer/src/state/StoreContext.tsx src/preload/index.ts src/main/index.ts
git commit -m "$(cat <<'EOF'
Restore plugin state on project open

deserializeProject now returns {state, pluginStates} instead of a bare
AppState. StoreContext.tsx gains a small pluginStatesRef (deliberately
NOT reducer state) + a restoreState() helper that App.tsx's three project-
open call sites (recover-autosave, library open, open-from-disk) call
instead of dispatching LOAD_STATE directly. The two existing
masterChain/channelPluginsRef diffing effects -- already the sole
mechanism that fires engineLoadMasterPlugin/engineLoadChannelPlugin for
every configured slot on any LOAD_STATE -- now also look up a matching
captured state blob via stateForSlot and thread it through, restoring
real parameter state alongside plugin identity on every project open.
EOF
)"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full native rebuild + test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including every new test added across Tasks 2 and 4.

- [ ] **Step 2: Full TypeScript typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: all pass, with a higher total count than before this plan (5 new tests in `pluginStates.test.ts`... actually 9 — recount from Task 1 — plus 3 new tests in `buildEngineProject.test.ts`).

- [ ] **Step 5: Manual walkthrough — flag explicitly, don't claim it was done**

This plan's riskiest, least-automatable claims all live at the real-plugin-hosting boundary, which this codebase's own convention (root `CLAUDE.md`'s Testing conventions) treats as manual-walkthrough-only, not fakeable with a mock processor. Before this ships, a human needs to, with a REAL VST3/AU plugin loaded (not the test doubles from Tasks 2/4):

1. **Rebuild and fully quit-and-relaunch** the Electron app (per root `CLAUDE.md` — a renderer reload alone will NOT pick up any of this plan's native-engine changes).
2. Load a plugin with an audibly-adjustable parameter (e.g. a filter cutoff, a gain/EQ) onto a master chain slot. Tweak the knob to something clearly different from its default. **Without saving**, export a mixdown — confirm the exported audio reflects the tweak, not the plugin's default state (this is the direct fix for the originally reported bug).
3. Now explicitly Save (Cmd+S or the Save button). Quit the app (fully, Cmd+Q) and relaunch it. Reopen the same project. Confirm the plugin's knob position visibly/audibly matches what was saved, not its default.
4. Repeat step 3 for a plugin loaded on a CHANNEL chain slot, not just master — the restore path is symmetric but exercises a different code branch (`channel:<id>:<slot>` vs `master:<slot>`) worth confirming independently.
5. Simulate a save-time engine failure (e.g. force-quit the native engine subprocess via Activity Monitor right as a Save is triggered, if reproducible) and confirm Save reports failure (the alert dialog) rather than silently succeeding with a project file that's missing its plugin state.
6. Confirm a project saved BEFORE this plan shipped (no `pluginStates` field in its JSON at all) still opens correctly, with every plugin loading at its own default state exactly as it always did — the restore path's `pluginStates ?? {}` fallback (Task 10, Step 1) should make this a complete no-op for old saves, but confirm this by hand with a real pre-existing `.sssketchproj` file.

Say so explicitly in any completion report — this needs real plugin binaries and manual listening/comparison, and cannot be completed by an implementer subagent solo.

- [ ] **Step 6: Commit (only if Steps 1-4 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```
