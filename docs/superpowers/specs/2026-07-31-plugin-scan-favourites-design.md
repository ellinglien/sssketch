# Plugin Scan + Favourites — Design

**Goal:** Replace the master plugin chain's hardcoded 5-plugin allowlist with a real, safely-scanned catalog of installed VST3 plugins, plus a favourites system so the master chain panel's dropdowns stay short and relevant even once the catalog holds dozens of entries.

**History this builds on:** The master plugin chain spec (`docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md`) explicitly deferred "a real, unattended directory scan for plugin discovery" as out of scope. `native-engine/PHASE0_FINDINGS.md` documents a genuine, already-encountered bug in JUCE's AU scanner (an infinite loop of assertion failures against certain installed system component bundles, which produced 5GB of log output before being killed) and explicitly recommends: "don't scan directories unattended in-process... scan each plugin candidate in an isolated subprocess with a timeout and quarantine list." This design implements exactly that recommendation.

**Not in scope for this pass** (explicitly deferred, not forgotten):
- AU scanning — VST3 only, matching the master chain's existing format scope and avoiding the documented AU scanner bug entirely.
- Parallel/concurrent scanning — sequential, one candidate subprocess at a time.
- Automatic scanning on app launch — manually triggered only, via a button in the master chain panel.
- Reordering favourites (a plain unordered set is enough for v1).
- Scanning any location other than `/Library/Audio/Plug-Ins/VST3` (the same fixed path the old allowlist and `PluginScanner.cpp`'s phase-0 spike both assumed).

---

## Architecture

### Candidate discovery (safe, no plugin code executed)

Electron's main process lists `.vst3` bundles directly under `/Library/Audio/Plug-Ins/VST3` (reusing `native-engine/Source/PluginScanner.cpp`'s existing `isPluginCandidate` filter logic, ported to a small `src/main/` helper — a plain directory listing, no JUCE/plugin code involved, so this step alone carries none of the documented hang/crash risk).

### Isolated per-candidate probe

For each candidate path, the main process spawns a **fresh, short-lived subprocess**: `ssstitch-engine --scan-one-json <path>` — a new CLI mode on the native engine binary, built on the same `scanOneFileInto` code path already proven working in this session (`--scan-one`, used manually to confirm Neutron 4 and Pro-Q 3's scan behavior during this feature's own brainstorming). Unlike `--scan-one`'s human-readable log output, `--scan-one-json` prints a single JSON line to stdout:

```json
{"success": true, "plugins": [{"name": "Solid Bus Comp", "manufacturer": "Native Instruments", "identifierString": "VST3-...", "arch": "arm64"}]}
```
or, on failure:
```json
{"success": false, "error": "plugin not found" }
```

The main process enforces a per-candidate timeout (e.g. 10s) via the same `spawn` + `setTimeout` + `kill('SIGKILL')` pattern `engineProcess.ts`'s own readiness timeout already uses. A candidate that times out, crashes, or produces no valid plugin type is simply skipped — the scan continues with the next candidate regardless. **The live playback engine process is never involved in scanning at all** — each probe is a brand-new, disposable process, so a hang or crash in one plugin's init code can never affect anything currently playing.

Scanning runs **sequentially**, one candidate at a time — simplest and safest for v1, with progress reported back to the renderer (`"14 of 62 scanned"`) via a `scan-progress` IPC push so a multi-minute scan of ~50-100 installed plugins doesn't read as hung.

### Architecture ruled out

- **In-process scan on the live playback engine** (reusing `PluginScanner.cpp`'s existing `scanForPlugins` directly): rejected — this is exactly the "unattended in-process scan" `PHASE0_FINDINGS.md` already warned against; a single bad plugin could hang or crash the same process serving live audio.
- **One longer-lived scanner subprocess looping through all candidates itself**: rejected — better isolation than the live engine, but worse than one-subprocess-per-candidate: if any single plugin in the batch hangs, the whole batch subprocess is stuck, and a watchdog can only kill everything rather than just that one candidate.

---

## Data model

### Catalog file (`app.getPath('userData')/pluginCatalog.json`)

```ts
interface CatalogEntry {
  id: string // JUCE's PluginDescription::createIdentifierString() — stable, format-specific, exists for exactly this purpose (JUCE's own doc comment notes shell plugins can need matchesIdentifierString() rather than plain string equality for exact re-matching, but a single-plugin-per-bundle VST3 — everything this scan targets — doesn't hit that edge case)
  displayName: string
  manufacturer: string
  path: string
  arch: 'arm64' | 'x86_64' | 'universal'
}

interface PluginCatalog {
  plugins: CatalogEntry[]
  favouriteIds: string[]
}
```

Written by the main process after a scan completes; read at app startup and exposed to the renderer over IPC (mirroring how `autosave.rifffproj` already lives outside any single project file, in `userData`, since installed plugins — like autosave — are a machine-level fact, not a per-project one). This file entirely replaces `src/shared/masterChainAllowlist.ts` / `native-engine/Source/MasterChainAllowlist.h`'s hardcoded tables, which are deleted.

### Migration for existing saves

The 5 old hand-curated ids (`solid-bus-comp`, `pro-q-3`, `soothe2`, `sausage-fattener`, `sunset-sound-reverb`) are plain slugs, not `createIdentifierString()` values, so they won't match anything in a freshly-scanned catalog. A small hardcoded migration table (old slug → the exact file path it used to point at, taken straight from the deleted allowlist) resolves an existing `AppState.masterChain` entry that's still one of these 5 slugs: look up its path in the migration table, then find the catalog entry with a matching `path` and swap the slug for that entry's real `id`. If the scan hasn't found that plugin (uninstalled, moved, or scan never run), the slot just shows as unresolved/empty rather than erroring — same "additive, never destructive" spirit as the rest of this design. This follows the exact precedent `serialize.ts`'s existing `LegacyPersistedProject` migration already set for DAW mode's old save format.

When a scan is first run (or re-run) and finds a plugin at one of the 5 old hardcoded paths, that catalog entry is automatically added to `favouriteIds` — so upgrading from the hardcoded-allowlist version of this feature to the scanned-catalog version doesn't silently empty out the panel's dropdown for anyone who already had it working.

### Renderer state

```ts
// New, app-level (not part of AppState/serializeProject — this is a machine
// fact like the plugin catalog itself, not arrangement data):
interface PluginCatalogState {
  plugins: CatalogEntry[]
  favouriteIds: string[]
  scanning: boolean
  scanProgress: { done: number; total: number } | null
}
```
Lives in its own small context (mirroring `MasterChainStatusCtx`/`MasterChainErrorCtx`'s existing pattern in `StoreContext.tsx`), populated at startup from the catalog file and updated live during a scan via `scan-progress`/`scan-complete` IPC pushes.

`AppState.masterChain` itself is unchanged (`[string | null, string | null, string | null, string | null]`) — it now stores catalog `id`s instead of allowlist slugs, but the shape and every reducer/IPC path built for it in the master chain feature needs no changes.

---

## UI

**"scan for plugins" button** in `MasterChainPanel`, next to the existing 4 slot rows. While scanning, it's disabled and shows progress (`"scanning... 14/62"`). On completion, the catalog/favourites state refreshes and the button re-enables.

**Slot dropdowns** default to showing only favourited plugins (short list, matches today's experience). Each dropdown also has a "browse all..." option that opens a small catalog browser (a new `PluginCatalogBrowser` panel) listing every scanned plugin — arch shown next to each entry, non-`arm64`/non-`universal` entries visibly greyed out and disabled (can't be selected — matches `PHASE0_FINDINGS.md`'s finding #3: loading an x86_64-only plugin natively fails cleanly, so the UI should make that expectation visible up front rather than let the user hit a load error). Each row in the browser has a star toggle to add/remove it from favourites, which updates `pluginCatalog.json` immediately.

---

## Error handling

- **A candidate that times out, crashes, or fails to scan:** skipped silently in the scan's own progress accounting (counted as "done," not surfaced as a per-plugin error to the user — matches this being routine/expected for at least the known x86_64-only and any genuinely broken installs, not something to alarm over on every scan).
- **Scan finds zero plugins** (e.g. no VST3 directory, or empty): catalog is written as empty; favourites list stays whatever it was (a scan is additive — it never deletes existing favourites for plugins it didn't find this time, since a plugin could be temporarily unavailable for reasons unrelated to it being uninstalled, e.g. an external drive not mounted).
- **A previously-favourited plugin is no longer in the catalog after a rescan:** stays in `favouriteIds` (so it reappears automatically if it's found again later) but is hidden from the "favourites" dropdown view specifically, since there's no catalog entry to render — visible again, disambiguated, in the "browse all" view is out of scope for v1 (a missing favourite just quietly won't show up; no special UI needed to explain why).
- **The scan subprocess itself fails to spawn at all** (e.g. binary missing): reported once as a scan-level error (not per-candidate), same "log + report, never crash the app" convention this codebase already uses for the main playback engine's own failed-to-start path.

---

## Testing

- **Native:** unit tests for the new `--scan-one-json` output shape (fixture: a fake/no-op format manager plus the existing `scanOneFileInto` helper, matching `PluginScannerTests.cpp`'s existing "not testable against a real installed plugin, so exercise the pure logic" convention) — specifically the JSON success/failure shape, not real plugin scanning (which depends on what's actually installed, same caveat `PluginScanner.cpp`'s own doc comment already states about `scanForPlugins`).
- **Main process (Vitest):** the per-candidate subprocess spawn/timeout/kill logic, matching `engineProcess.test.ts`'s existing convention of exercising the real spawn path against the real compiled binary via `binaryPathOverride`, plus a case using a fake command that hangs past the timeout to prove the kill-and-continue behavior.
- **Renderer (Vitest):** the old-slug-to-catalog-id migration logic, and the favourites-toggle reducer/state logic.
- **Manual, end-to-end (required — not automatable):** run a real scan against this machine's actual `/Library/Audio/Plug-Ins/VST3` directory, confirm progress reporting looks sane, confirm the 5 previously-hardcoded plugins are found and pre-favourited, confirm an x86_64-only plugin (Pro-Q 3) shows as disabled/greyed in the browser rather than selectable, confirm starring/unstarring a plugin persists across an app restart, confirm an old project save (referencing e.g. `"solid-bus-comp"`) still resolves correctly to the scanned catalog entry after this change ships.
