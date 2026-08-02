# LORE Riff-by-ID Lookup Design

## Background

`LoreLibraryBrowser` already lets you browse a LORE jam's riffs (search jams → pick one → scroll/filter its riffs → import). There's no way to jump directly to a *specific* riff if you already know its ID (a riffCID, e.g. `8ab5f2c02be111eeb2c02fa155878117`) — you'd have to know which jam it's in and scroll to find it manually.

This adds a riff-ID input to the browser that resolves an ID, switches to that riff's jam, and shows it centered in a window of the riffs immediately before/after it — answering both "import this specific riff" and "what jam is this from, and what's around it" in one motion.

## Data model note

The local warehouse (`warehouse.db3`) is a flat cache: a riff's row is either fully present — with its jam, creation time, everything — or it isn't in the database at all. There's no separate index of "riffs known to exist but not yet synced." So when an ID can't be found, there's normally nothing else locally to point to. The one real exception is user error: a pasted ID with stray whitespace or wrong case would fail a strict match even though the real riff is sitting right there locally.

## Backend: `resolveRiffWithContext`

New function in `src/main/loreWarehouse.ts`, alongside the existing `resolveRiff`:

```ts
export interface RiffContextResult {
  jamCID: string
  /** Offset to pass to listRiffs(jamCID, {offset}) to fetch a ~20-riff page
   * centered on the target riff (10 before, 10 after — see "Centering
   * math" below). */
  offset: number
  /** The riffCID actually matched -- identical to the input except when the
   * typo-tolerant fallback (below) kicked in, so the caller can highlight
   * the right row even if the pasted ID had a case/whitespace mismatch. */
  matchedRiffCID: string
}

export function resolveRiffWithContext(riffCID: string): RiffContextResult | null
```

**Lookup:** tries an exact `RiffCID = ?` match first. If that misses, retries with a trimmed, case-insensitive comparison (`WHERE RiffCID = ? COLLATE NOCASE` against the trimmed input) — catches a copy-paste with stray whitespace or wrong case without pretending to recover from a genuinely wrong/unsynced ID. If both miss, returns `null`.

**Centering math:** once the row is found (with its `OwnerJamCID` and `CreationTime`), runs one `COUNT(*)` query:

```sql
SELECT COUNT(*) FROM Riffs WHERE OwnerJamCID = ? AND CreationTime > ?
```

That count is the target's rank in the jam's most-recent-first ordering (`listRiffs`'s own `ORDER BY CreationTime DESC`, unchanged). `offset = max(0, rank - 10)` centers a 20-row page on the target. (Riffs sharing the *exact* same unix-second timestamp as the target have no stable secondary sort in the existing `listRiffs` query either — an acceptable, pre-existing simplification; centering can land a few positions off in that rare case.)

No new SQL query type is needed to actually fetch the window — the renderer reuses the *existing* `listRiffs(jamCID, { offset })` IPC call with no other filters, so the whole date/tempo-grouped rendering, ownership coloring, and import flow already in `LoreLibraryBrowser` applies unchanged.

## IPC + preload

`loreResolveRiffWithContext(riffCID: string): Promise<RiffContextResult | null>`, wired through `main/index.ts` and `preload/index.ts` the same way `loreListRiffs`/`loreResolveRiff` already are.

## Renderer: `LoreLibraryBrowser`

**New UI:** a riff-ID text input next to the existing jam search, with a "go" action (Enter key or button). Submitting:

1. Calls `loreResolveRiffWithContext`.
2. **Not found:** shows an inline message ("not found in the local warehouse") next to the input. Nothing else changes — current jam/filters/riffs stay exactly as they were.
3. **Found:** clears every filter (`bpmFilter`, `userNameFilter`, `dateFromFilter`, `dateToFilter`, `onlyFullyCached`, `onlyContainsMe` — *not* `loreUsername`, which is a persistent identity setting, not a filter scope), sets `selectedJamCID` to the result's `jamCID`, and stashes the result's `offset` and `matchedRiffCID` in two new pieces of state (`pendingJumpOffset`, `highlightRiffCID`).

**Wiring into the existing fetch effect:** the effect that fetches page 1 whenever `selectedJamCID`/filters change (currently always calls `buildRiffFilters(0)`) is extended: if `pendingJumpOffset !== null`, it fetches with that offset instead of 0, then clears `pendingJumpOffset` (so a later, unrelated jam change goes back to starting at offset 0 normally). `nextOffsetRef` is set from the result exactly as it already is today — "load more" (infinite scroll) from here on continues forward (older) from the end of the centered window, reusing 100% of the existing pagination code with no new bidirectional-scroll machinery. Scrolling further *back* toward more-recent riffs than the centered window isn't part of this design (YAGNI — can be added later if it turns out to matter in practice).

**Highlighting the target:** once the centered page loads, the row whose `riffCID === highlightRiffCID` scrolls into view and gets a brief highlighted outline (reusing the grid's existing per-riff ref/scroll pattern used elsewhere in this component), then `highlightRiffCID` is cleared. From there, importing it is the existing click-to-import flow — no new import path.

## Testing

`resolveRiffWithContext`'s two genuinely new pieces of logic get unit tests against the existing test warehouse fixture (same pattern `resolveRiff`/`listRiffs` already use):
- Exact match, trimmed/case-insensitive fallback match, and true not-found (all three return shapes).
- Centering math: a riff at the very start of a jam (rank 0, offset clamps to 0), a riff in the middle (offset = rank − 10), and a riff at the very end (offset near the jam's total riff count, `listRiffs` naturally returns fewer than 20 with `hasMore: false`).

The renderer-side jump/highlight wiring isn't covered by an automated test (no React interaction-test setup exists in this codebase yet — see `oneShotResize.ts`'s pure-function split for the same precedent of keeping the testable logic out of the component itself); it's part of this feature's manual verification instead.
