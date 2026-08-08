# Rifff Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user right-click a rifff circle in either library browser to instantly toggle a persisted "favorite" flag, shown as the circle filling solid purple.

**Architecture:** A new `src/main/riffFavourites.ts` persists a flat `riffCIDs: string[]` list to `riffFavourites.json` in `app.getPath('userData')`, mirroring `pluginCatalog.ts`'s existing favourite-list pattern exactly. Two IPC channels + preload bridge methods expose it to the renderer. `StoreContext.tsx` loads the list once into a `Set<string>` on mount (mirroring plugin-catalog loading) and exposes it plus a toggle action via two new contexts, consumed by both `EndlesssLibraryBrowser.tsx`'s `RiffCircle` component and `LoreLibraryBrowser.tsx`'s inline circle.

**Tech Stack:** TypeScript, Electron IPC, React Context, Vitest.

---

### Task 1: `riffFavourites.ts` — persistence + tests

**Files:**
- Create: `src/main/riffFavourites.ts`
- Test: `src/main/riffFavourites.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/riffFavourites.test.ts`:

```ts
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

describe('riffFavourites', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-favourites-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('listFavouriteRiffCIDs returns an empty list when no file exists yet', async () => {
    const { listFavouriteRiffCIDs } = await import('./riffFavourites')
    expect(listFavouriteRiffCIDs()).toEqual([])
  })

  it('toggleFavouriteRiff adds a riffCID not already favourited, removes one that is', async () => {
    const { toggleFavouriteRiff, listFavouriteRiffCIDs } = await import('./riffFavourites')
    expect(toggleFavouriteRiff('riff_1')).toEqual(['riff_1'])
    expect(listFavouriteRiffCIDs()).toEqual(['riff_1'])
    expect(toggleFavouriteRiff('riff_1')).toEqual([])
    expect(listFavouriteRiffCIDs()).toEqual([])
  })

  it('toggleFavouriteRiff persists multiple favourites independently', async () => {
    const { toggleFavouriteRiff, listFavouriteRiffCIDs } = await import('./riffFavourites')
    toggleFavouriteRiff('riff_1')
    toggleFavouriteRiff('riff_2')
    expect(listFavouriteRiffCIDs().slice().sort()).toEqual(['riff_1', 'riff_2'])
    toggleFavouriteRiff('riff_1')
    expect(listFavouriteRiffCIDs()).toEqual(['riff_2'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/riffFavourites.test.ts`
Expected: FAIL — `./riffFavourites` has no exports (module doesn't exist yet)

- [ ] **Step 3: Implement `riffFavourites.ts`**

Create `src/main/riffFavourites.ts`:

```ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface FavouritesFile {
  riffCIDs: string[]
}

const FAVOURITES_FILENAME = 'riffFavourites.json'

function favouritesPath(): string {
  return join(app.getPath('userData'), FAVOURITES_FILENAME)
}

/** Reads back the riff favourites file -- an empty list (never a thrown
 * error) both when no favourite has ever been set and when reading one
 * fails, matching pluginCatalog.ts's loadCatalog's own convention. */
function loadFavourites(): FavouritesFile {
  const path = favouritesPath()
  if (!existsSync(path)) return { riffCIDs: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as FavouritesFile
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadFavourites: failed to read ${path}: ${message}`)
    return { riffCIDs: [] }
  }
}

function writeFavourites(favourites: FavouritesFile): void {
  try {
    writeFileSync(favouritesPath(), JSON.stringify(favourites, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`writeFavourites: failed to write ${favouritesPath()}: ${message}`)
  }
}

export function listFavouriteRiffCIDs(): string[] {
  return loadFavourites().riffCIDs
}

/** Toggles a single riff's favourite status and persists immediately.
 * Not validated against any known-riffs list -- a riff can be favourited
 * from either library browser (LORE or direct-Endlesss) and later become
 * temporarily unavailable there without losing its favourite status,
 * matching pluginCatalog.ts's own toggleFavourite reasoning (a plugin can
 * be favourited then vanish on a later rescan without losing favourite
 * status). Returns the updated list so callers (the IPC handler) can hand
 * it straight back to the renderer without a second read. */
export function toggleFavouriteRiff(riffCID: string): string[] {
  const favourites = loadFavourites()
  const index = favourites.riffCIDs.indexOf(riffCID)
  if (index === -1) {
    favourites.riffCIDs.push(riffCID)
  } else {
    favourites.riffCIDs.splice(index, 1)
  }
  writeFavourites(favourites)
  return favourites.riffCIDs
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/riffFavourites.test.ts`
Expected: PASS, all 3 tests

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/riffFavourites.ts src/main/riffFavourites.test.ts
git commit -m "Add riffFavourites.ts: local persistence for rifff favorites"
```

---

### Task 2: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

No dedicated test file — IPC wiring isn't unit-tested elsewhere in this codebase either (verified via typecheck), matching how `toggle-plugin-favourite` and every `endlesss-*` channel were added.

- [ ] **Step 1: Add the import to `src/main/index.ts`**

Find the existing import:

```ts
import { loadCatalog, toggleFavourite } from './pluginCatalog'
```

Add immediately after it:

```ts
import { listFavouriteRiffCIDs, toggleFavouriteRiff } from './riffFavourites'
```

- [ ] **Step 2: Register the two new IPC handlers**

Find the existing `toggle-plugin-favourite` handler:

```ts
  ipcMain.handle('toggle-plugin-favourite', (_event, id: string) => {
    toggleFavourite(id)
    return loadCatalog()
  })
```

Add immediately after it:

```ts
  ipcMain.handle('list-riff-favourites', () => listFavouriteRiffCIDs())

  ipcMain.handle('toggle-riff-favourite', (_event, riffCID: string) =>
    toggleFavouriteRiff(riffCID)
  )
```

- [ ] **Step 3: Add preload bridge methods**

In `src/preload/index.ts`, find the existing `togglePluginFavourite` method:

```ts
  togglePluginFavourite: (id: string): Promise<PluginCatalog> =>
    ipcRenderer.invoke('toggle-plugin-favourite', id),
```

Add immediately after it:

```ts
  listRiffFavourites: (): Promise<string[]> => ipcRenderer.invoke('list-riff-favourites'),
  toggleRiffFavourite: (riffCID: string): Promise<string[]> =>
    ipcRenderer.invoke('toggle-riff-favourite', riffCID),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire up IPC + preload bridge for rifff favorites"
```

---

### Task 3: `StoreContext.tsx` — context, state, actions, hooks

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

No dedicated test — this codebase's React/context code is verified via typecheck + lint + manual walkthrough, matching `PluginCatalogCtx`'s own precedent (also untested directly).

- [ ] **Step 1: Add the two new contexts**

Find:

```ts
const PluginCatalogActionsCtx = createContext<{
  triggerScan: () => void
  toggleFavourite: (id: string) => void
}>({ triggerScan: () => {}, toggleFavourite: () => {} })
```

Add immediately after it:

```ts
const RiffFavouritesCtx = createContext<Set<string>>(new Set())
const RiffFavouritesActionsCtx = createContext<{
  toggleRiffFavourite: (riffCID: string) => void
}>({ toggleRiffFavourite: () => {} })
```

- [ ] **Step 2: Add state + load effect**

Find:

```ts
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalog>({
    plugins: [],
    favouriteIds: []
  })
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    void window.rifffApi.getPluginCatalog().then(setPluginCatalog)
  }, [])
```

Add immediately after that `useEffect`:

```ts
  const [riffFavourites, setRiffFavourites] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.rifffApi.listRiffFavourites().then((ids) => setRiffFavourites(new Set(ids)))
  }, [])
```

- [ ] **Step 3: Add the toggle action + actions memo**

Find:

```ts
  const toggleFavourite = useCallback((id: string) => {
    void window.rifffApi.togglePluginFavourite(id).then(setPluginCatalog)
  }, [])

  const pluginCatalogActions = useMemo(
    () => ({ triggerScan, toggleFavourite }),
    [triggerScan, toggleFavourite]
  )
```

Add immediately after it:

```ts
  const toggleRiffFavourite = useCallback((riffCID: string) => {
    void window.rifffApi.toggleRiffFavourite(riffCID).then((ids) => setRiffFavourites(new Set(ids)))
  }, [])

  const riffFavouritesActions = useMemo(
    () => ({ toggleRiffFavourite }),
    [toggleRiffFavourite]
  )
```

- [ ] **Step 4: Wrap the provider tree**

Find:

```tsx
                        <PluginCatalogCtx.Provider value={pluginCatalog}>
                          <PluginScanStateCtx.Provider value={{ scanning, progress: scanProgress }}>
                            <PluginCatalogActionsCtx.Provider value={pluginCatalogActions}>
                              {children}
                            </PluginCatalogActionsCtx.Provider>
                          </PluginScanStateCtx.Provider>
                        </PluginCatalogCtx.Provider>
```

Replace with:

```tsx
                        <PluginCatalogCtx.Provider value={pluginCatalog}>
                          <PluginScanStateCtx.Provider value={{ scanning, progress: scanProgress }}>
                            <PluginCatalogActionsCtx.Provider value={pluginCatalogActions}>
                              <RiffFavouritesCtx.Provider value={riffFavourites}>
                                <RiffFavouritesActionsCtx.Provider value={riffFavouritesActions}>
                                  {children}
                                </RiffFavouritesActionsCtx.Provider>
                              </RiffFavouritesCtx.Provider>
                            </PluginCatalogActionsCtx.Provider>
                          </PluginScanStateCtx.Provider>
                        </PluginCatalogCtx.Provider>
```

- [ ] **Step 5: Add the exported hooks**

Find:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePluginCatalogActions(): {
  triggerScan: () => void
  toggleFavourite: (id: string) => void
} {
  return useContext(PluginCatalogActionsCtx)
}
```

Add immediately after it:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useRiffFavourites(): Set<string> {
  return useContext(RiffFavouritesCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useRiffFavouritesActions(): { toggleRiffFavourite: (riffCID: string) => void } {
  return useContext(RiffFavouritesActionsCtx)
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "StoreContext: load + expose rifff favorites"
```

---

### Task 4: `EndlesssLibraryBrowser.tsx` — right-click + purple fill

**Files:**
- Modify: `src/renderer/src/components/EndlesssLibraryBrowser.tsx`

No dedicated test — React component, verified via typecheck + lint + manual walkthrough per this codebase's established convention.

- [ ] **Step 1: Extend the StoreContext import**

Find:

```ts
import { usePlaying, useDispatch, useAppState } from '../state/StoreContext'
```

Replace with:

```ts
import {
  usePlaying,
  useDispatch,
  useAppState,
  useRiffFavourites,
  useRiffFavouritesActions
} from '../state/StoreContext'
```

- [ ] **Step 2: Add `favorited`/`onContextMenu` to `RiffCircle`'s props and fill logic**

Find:

```tsx
function RiffCircle({
  title,
  selected,
  multiSelected,
  playing,
  fullyCached,
  imported,
  ownerFraction,
  onClick
}: {
  title: string
  selected: boolean
  /** In the batch (shift/cmd-click) selection but NOT the anchor -- gets
   * its own, weaker ring than `selected`'s. See handleRiffClick. */
  multiSelected: boolean
  playing: boolean
  fullyCached: boolean
  imported: boolean
  /** 0-1, drives brightness the same way LORE's own riff circles do -- see
   * riffCircleColor. Endlesss-direct listings don't always have this at
   * list time (only the shared-feed path does, since its listing response
   * embeds full stem docs; the private-jam path fills it in progressively
   * as riffs get resolved/prefetched -- see jamOwnerFractions). */
  ownerFraction: number
  onClick: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div style={{ position: 'relative', width: 18, height: 18 }}>
      <button
        onClick={onClick}
        title={title}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          // Same cue hierarchy as LoreLibraryBrowser's own riff circles:
          // anchor selection ring, then batch-selection ring, then "not
          // everything's downloaded yet" (dashed), else a plain solid
          // border -- see downloadMissingStemsFor, already wired to fetch
          // whatever's missing the moment a riff is selected, so showing
          // the circle before it's fully cached is safe.
          border: selected
            ? '2px solid var(--ra-playhead)'
            : multiSelected
              ? '2px solid var(--ra-stretch-on)'
              : fullyCached
                ? '1px solid var(--ra-border)'
                : '1px dashed var(--ra-text-3)',
          padding: 0,
          background: riffCircleColor(ownerFraction),
          cursor: 'pointer',
          animation: playing ? 'ra-rec-pulse 1.4s ease-in-out infinite' : undefined
        }}
      />
```

Replace with:

```tsx
function RiffCircle({
  title,
  selected,
  multiSelected,
  playing,
  fullyCached,
  imported,
  ownerFraction,
  favorited,
  onClick,
  onContextMenu
}: {
  title: string
  selected: boolean
  /** In the batch (shift/cmd-click) selection but NOT the anchor -- gets
   * its own, weaker ring than `selected`'s. See handleRiffClick. */
  multiSelected: boolean
  playing: boolean
  fullyCached: boolean
  imported: boolean
  /** 0-1, drives brightness the same way LORE's own riff circles do -- see
   * riffCircleColor. Endlesss-direct listings don't always have this at
   * list time (only the shared-feed path does, since its listing response
   * embeds full stem docs; the private-jam path fills it in progressively
   * as riffs get resolved/prefetched -- see jamOwnerFractions). */
  ownerFraction: number
  /** Right-click toggled, persisted independently of source (see
   * riffFavourites.ts) -- overrides the ownerFraction grayscale fill with
   * solid purple when true. */
  favorited: boolean
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div style={{ position: 'relative', width: 18, height: 18 }}>
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={title}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          // Same cue hierarchy as LoreLibraryBrowser's own riff circles:
          // anchor selection ring, then batch-selection ring, then "not
          // everything's downloaded yet" (dashed), else a plain solid
          // border -- see downloadMissingStemsFor, already wired to fetch
          // whatever's missing the moment a riff is selected, so showing
          // the circle before it's fully cached is safe.
          border: selected
            ? '2px solid var(--ra-playhead)'
            : multiSelected
              ? '2px solid var(--ra-stretch-on)'
              : fullyCached
                ? '1px solid var(--ra-border)'
                : '1px dashed var(--ra-text-3)',
          padding: 0,
          background: favorited ? 'var(--ra-recording-live)' : riffCircleColor(ownerFraction),
          cursor: 'pointer',
          animation: playing ? 'ra-rec-pulse 1.4s ease-in-out infinite' : undefined
        }}
      />
```

- [ ] **Step 3: Read favourites state in the component body**

Find the start of the component body:

```ts
export function EndlesssLibraryBrowser({
  onClose,
  onImported,
  onSwitchToLore
}: {
  onClose: () => void
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  /** Called when the user clicks the "lore library" tab -- App.tsx owns
   * which browser component is actually mounted (see the App.tsx wiring
   * task). */
  onSwitchToLore: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<EndlesssTab>('shared-feed')
```

Replace with:

```ts
export function EndlesssLibraryBrowser({
  onClose,
  onImported,
  onSwitchToLore
}: {
  onClose: () => void
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  /** Called when the user clicks the "lore library" tab -- App.tsx owns
   * which browser component is actually mounted (see the App.tsx wiring
   * task). */
  onSwitchToLore: () => void
}): React.JSX.Element {
  const riffFavourites = useRiffFavourites()
  const { toggleRiffFavourite } = useRiffFavouritesActions()
  const [tab, setTab] = useState<EndlesssTab>('shared-feed')
```

- [ ] **Step 4: Wire the shared-feed tab's `RiffCircle` call site**

Find:

```tsx
                      <RiffCircle
                        key={riff.riffCID}
                        title={`${riff.userName || 'shared rifff'} · ${formatBpm(riff.bpm)} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                        selected={selectedRiffCID === riff.riffCID}
                        multiSelected={
                          selectedRiffCID !== riff.riffCID && selectedRiffCIDs.has(riff.riffCID)
                        }
                        playing={
                          selectedRiffCID === riff.riffCID && playingRiffCID === riff.riffCID
                        }
                        fullyCached={riff.cachedStemCount >= riff.stemCount}
                        imported={importedRiffGroupIds.has(riff.riffCID)}
                        ownerFraction={riff.ownerFraction}
                        onClick={(e) => handleRiffClick(e, riff.riffCID, feedRiffs)}
                      />
```

Replace with:

```tsx
                      <RiffCircle
                        key={riff.riffCID}
                        title={`${riff.userName || 'shared rifff'} · ${formatBpm(riff.bpm)} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                        selected={selectedRiffCID === riff.riffCID}
                        multiSelected={
                          selectedRiffCID !== riff.riffCID && selectedRiffCIDs.has(riff.riffCID)
                        }
                        playing={
                          selectedRiffCID === riff.riffCID && playingRiffCID === riff.riffCID
                        }
                        fullyCached={riff.cachedStemCount >= riff.stemCount}
                        imported={importedRiffGroupIds.has(riff.riffCID)}
                        ownerFraction={riff.ownerFraction}
                        favorited={riffFavourites.has(riff.riffCID)}
                        onClick={(e) => handleRiffClick(e, riff.riffCID, feedRiffs)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          toggleRiffFavourite(riff.riffCID)
                        }}
                      />
```

- [ ] **Step 5: Wire the private-jams tab's `RiffCircle` call site**

Find:

```tsx
                            <RiffCircle
                              key={riff.riffCID}
                              title={`${new Date(riff.creationTime * 1000).toLocaleDateString()} · ${riff.stemCount} stems`}
                              selected={selectedRiffCID === riff.riffCID}
                              multiSelected={
                                selectedRiffCID !== riff.riffCID &&
                                selectedRiffCIDs.has(riff.riffCID)
                              }
                              playing={
                                selectedRiffCID === riff.riffCID && playingRiffCID === riff.riffCID
                              }
                              fullyCached={riff.cachedStemCount >= riff.stemCount}
                              imported={importedRiffGroupIds.has(riff.riffCID)}
                              ownerFraction={
                                jamOwnerFractions.get(riff.riffCID) ?? riff.ownerFraction
                              }
                              onClick={(e) => handleRiffClick(e, riff.riffCID, jamRiffs)}
                            />
```

Replace with:

```tsx
                            <RiffCircle
                              key={riff.riffCID}
                              title={`${new Date(riff.creationTime * 1000).toLocaleDateString()} · ${riff.stemCount} stems`}
                              selected={selectedRiffCID === riff.riffCID}
                              multiSelected={
                                selectedRiffCID !== riff.riffCID &&
                                selectedRiffCIDs.has(riff.riffCID)
                              }
                              playing={
                                selectedRiffCID === riff.riffCID && playingRiffCID === riff.riffCID
                              }
                              fullyCached={riff.cachedStemCount >= riff.stemCount}
                              imported={importedRiffGroupIds.has(riff.riffCID)}
                              ownerFraction={
                                jamOwnerFractions.get(riff.riffCID) ?? riff.ownerFraction
                              }
                              favorited={riffFavourites.has(riff.riffCID)}
                              onClick={(e) => handleRiffClick(e, riff.riffCID, jamRiffs)}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                toggleRiffFavourite(riff.riffCID)
                              }}
                            />
```

**Note for the implementer:** the private-jams `<RiffCircle>` call site's exact surrounding whitespace/indentation may have drifted slightly from concurrent work earlier this session -- read the actual current file around `<RiffCircle` (search for it, there are exactly two occurrences) before applying this edit, and match against what's actually there rather than assuming the indentation above is byte-exact.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/EndlesssLibraryBrowser.tsx
git commit -m "EndlesssLibraryBrowser: right-click a rifff circle to favorite it"
```

---

### Task 5: `LoreLibraryBrowser.tsx` — right-click + purple fill

**Files:**
- Modify: `src/renderer/src/components/LoreLibraryBrowser.tsx`

No dedicated test — same convention as Task 4.

- [ ] **Step 1: Extend the StoreContext import**

Find:

```ts
import { usePlaying, useDispatch, useAppState } from '../state/StoreContext'
```

Replace with:

```ts
import {
  usePlaying,
  useDispatch,
  useAppState,
  useRiffFavourites,
  useRiffFavouritesActions
} from '../state/StoreContext'
```

- [ ] **Step 2: Read favourites state in the component body**

Read the actual current top of this component's body (search for `export function LoreLibraryBrowser`) and add these two lines immediately inside the function body, before the first existing `useState` call:

```ts
  const riffFavourites = useRiffFavourites()
  const { toggleRiffFavourite } = useRiffFavouritesActions()
```

- [ ] **Step 3: Wire the inline circle button**

Find:

```tsx
                                  <button
                                    onClick={(e) => handleRiffClick(e, riff.riffCID)}
                                    title={`${formatBpm(riff.bpm)} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                                    style={{
                                      width: 18,
                                      height: 18,
                                      borderRadius: '50%',
                                      // Dashed border flags "not fully cached" independently of
                                      // the ownership brightness fill (riffCircleColor) — see its
                                      // own doc comment for why these used to be conflated.
                                      // Selection rings take priority over the dashed cue since
                                      // they're the stronger, more immediate signal.
                                      border:
                                        selectedRiffCID === riff.riffCID
                                          ? '2px solid var(--ra-playhead)'
                                          : selectedRiffCIDs.has(riff.riffCID)
                                            ? '2px solid var(--ra-stretch-on)'
                                            : riff.cachedStemCount < riff.stemCount
                                              ? '1px dashed var(--ra-text-3)'
                                              : '1px solid var(--ra-border)',
                                      padding: 0,
                                      background: riffCircleColor(riff.ownerFraction),
                                      cursor: 'pointer'
                                    }}
                                  />
```

Replace with:

```tsx
                                  <button
                                    onClick={(e) => handleRiffClick(e, riff.riffCID)}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      toggleRiffFavourite(riff.riffCID)
                                    }}
                                    title={`${formatBpm(riff.bpm)} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                                    style={{
                                      width: 18,
                                      height: 18,
                                      borderRadius: '50%',
                                      // Dashed border flags "not fully cached" independently of
                                      // the ownership brightness fill (riffCircleColor) — see its
                                      // own doc comment for why these used to be conflated.
                                      // Selection rings take priority over the dashed cue since
                                      // they're the stronger, more immediate signal.
                                      border:
                                        selectedRiffCID === riff.riffCID
                                          ? '2px solid var(--ra-playhead)'
                                          : selectedRiffCIDs.has(riff.riffCID)
                                            ? '2px solid var(--ra-stretch-on)'
                                            : riff.cachedStemCount < riff.stemCount
                                              ? '1px dashed var(--ra-text-3)'
                                              : '1px solid var(--ra-border)',
                                      padding: 0,
                                      background: riffFavourites.has(riff.riffCID)
                                        ? 'var(--ra-recording-live)'
                                        : riffCircleColor(riff.ownerFraction),
                                      cursor: 'pointer'
                                    }}
                                  />
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "LoreLibraryBrowser: right-click a rifff circle to favorite it"
```

---

### Task 6: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including Task 1's 3 new tests

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors or warnings (run `npx eslint --fix <file>` for any auto-fixable formatting issues)

- [ ] **Step 4: Restart the dev app**

This plan only touches renderer + main-process IPC-registration code (no native engine changes), but `src/main/index.ts` changed -- do a full `npm run dev` restart (main-process code doesn't hot-reload as reliably as the renderer), matching this session's own established troubleshooting pattern.

- [ ] **Step 5: Manual walkthrough (cannot be done by an implementer solo -- flag explicitly if it can't be completed)**

- Open the LORE library browser. Right-click a rifff circle. Confirm it immediately fills solid purple, with no menu appearing.
- Right-click the same circle again. Confirm it reverts to its normal grayscale fill.
- Right-click a circle to favorite it, then switch to the direct-Endlesss browser (shared feed tab). If that same rifff (same riffCID) appears there, confirm it also shows favorited -- proves the shared `Set<string>` context works across both browsers.
- Right-click a circle in the Endlesss browser's private-jams tab. Confirm it favorites/unfavorites the same way.
- Favorite a rifff, then fully quit (Cmd+Q) and relaunch the app. Reopen a library browser and confirm the favorite persisted (proves `riffFavourites.json` round-trips correctly).
- Confirm the existing selection ring (click to select a rifff) still renders correctly on top of a favorited (purple-filled) circle -- border and background are independent layers, so this should need no special handling, but confirm visually.

- [ ] **Step 6: Final commit (if the walkthrough surfaced any fixes)**

```bash
git add -A
git commit -m "Rifff favorites: fixes from manual walkthrough"
```

(Skip this step entirely if the walkthrough found nothing to fix.)
