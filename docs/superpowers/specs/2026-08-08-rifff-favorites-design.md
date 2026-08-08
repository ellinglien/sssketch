# Rifff Favorites — Design

## Goal

Let the user mark a rifff as a favorite by right-clicking its circle in either library browser (LORE's own, and the direct-Endlesss browser's shared-feed + private-jam tabs), with an instant visual indicator. Filtering by favorite is an explicitly deferred follow-on, not part of this pass.

## Background

Two library browsers exist in sssketch, each rendering rifff circles independently:

- `LoreLibraryBrowser.tsx` — riffs from LORE's local warehouse.db3, circles rendered inline as `<button>`s using `riffCircleColor(ownerFraction)` for fill.
- `EndlesssLibraryBrowser.tsx` — riffs from the direct-Endlesss API (shared feed + private jams), with a shared `RiffCircle` component used by both tabs.

Neither has a favoriting concept today. The closest existing precedent is plugin favourites (`src/main/pluginCatalog.ts`): a parallel `favouriteIds: string[]` array (not a field on the catalog entry), persisted as a flat JSON file in `app.getPath('userData')`, toggled via a dedicated IPC handler that returns the whole updated list. `RifffBlockRow.tsx` also already has a "purple dot" precedent (the gated-recording-target indicator), using the `--ra-recording-live: #8f7dd4` token — the only purple-ish color already defined in `tokens.css`.

## Data model & persistence

New `src/main/riffFavourites.ts`, mirroring `pluginCatalog.ts`'s shape exactly:

```ts
interface FavouritesFile {
  riffCIDs: string[]
}

function favouritesPath(): string {
  return join(app.getPath('userData'), 'riffFavourites.json')
}

function loadFavourites(): FavouritesFile // existsSync-then-try/catch-then-default {riffCIDs: []}, same as loadCatalog()
function writeFavourites(file: FavouritesFile): void // writeFileSync, whole-file rewrite

export function listFavouriteRiffCIDs(): string[]
export function toggleFavouriteRiff(riffCID: string): string[] // returns the updated list
```

Keyed by `riffCID` (a string that's stable and identical regardless of source — LORE and direct-Endlesss both key riffs the same way), so one favorite applies everywhere the same riff appears. Not stored as a field on `LoreRiffSummary`/`LoreResolvedRiff`, since those types are populated fresh from LORE's read-only warehouse or live Endlesss API/sync-index data — sssketch doesn't own their shape and both already have their own separate storage. A single flat file (not sharded per-source like `endlesssSyncIndex.ts`'s sync-index files), since favorites are meant to be source-independent.

## IPC + renderer wiring

Two new IPC channels in `src/main/index.ts`, alongside the existing `endlesss-*`/`toggle-plugin-favourite` block:

```ts
ipcMain.handle('list-riff-favourites', () => listFavouriteRiffCIDs())
ipcMain.handle('toggle-riff-favourite', (_event, riffCID: string) => toggleFavouriteRiff(riffCID))
```

Preload bridge (`src/preload/index.ts`):

```ts
listRiffFavourites: (): Promise<string[]> => ipcRenderer.invoke('list-riff-favourites'),
toggleRiffFavourite: (riffCID: string): Promise<string[]> =>
  ipcRenderer.invoke('toggle-riff-favourite', riffCID)
```

`StoreContext.tsx` loads the favourites list once on mount (mirroring how the plugin catalog is loaded), exposing:

```ts
riffFavourites: Set<string>
toggleRiffFavourite: (riffCID: string) => void // fires the IPC call, updates the Set from the returned list
```

Both browsers read from this single shared context — a riff favorited from the LORE browser shows favorited immediately in the Endlesss browser too (same `riffCID`, same `Set`), with no per-browser refetch needed.

## Interaction + visual

Right-click on a rifff circle instantly toggles favorite status — no context menu, no confirmation. `e.preventDefault()` is called to suppress any default context menu; the click itself calls `toggleRiffFavourite(riffCID)`.

- `EndlesssLibraryBrowser.tsx`'s `RiffCircle` component gains a `favorited: boolean` prop and an `onContextMenu` prop, wired at both call sites (shared-feed tab and private-jams tab).
- `LoreLibraryBrowser.tsx`'s inline circle `<button>` gets the same `onContextMenu` handler and fill-color logic added directly (no separate component exists there to extract into, and extracting one is out of scope — not needed for this feature to work correctly in both places).

Visual: when `favorited` is true, the circle's `background` becomes `var(--ra-recording-live)` (solid purple) instead of `riffCircleColor(ownerFraction)`'s grayscale value. The existing border hierarchy (selected ring, multi-selected ring, cached-vs-dashed) is a separate visual layer (the `border` CSS property, not `background`) and is untouched — it still renders normally on top of a purple-filled circle exactly as it does on a grayscale one.

## Non-goals

- Filtering the riff grid by favorite status — explicitly deferred, no scaffolding added now.
- Any visual/UI change to `RifffBlockRow.tsx` or the arranger timeline — favoriting only applies to the library browsers' own riff-selection circles, not to a riff already placed on the timeline.
- Syncing favorite status with LORE's own warehouse.db3 or any Endlesss server-side "favorite" concept — this is purely local, sssketch-owned state.

## Testing

`riffFavourites.ts`'s `loadFavourites`/`toggleFavouriteRiff` get real unit tests (TDD, injectable path override matching `pluginCatalog.test.ts`'s existing pattern for testing `app.getPath()`-dependent code). IPC/preload wiring verified via typecheck only, matching every other `*-favourite`/`endlesss-*` channel in this codebase. The two browser components' right-click + purple-fill changes are verified via typecheck + lint + manual walkthrough only, per this codebase's established convention of not unit-testing React components directly.
