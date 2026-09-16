# Unified UI Consistency Pass — Design

## Background

Elling asked, unprompted, after a round of Discover live-testing and an icon-button
simplification (`LoopOrOneShotPrompt.tsx`): "let's look at a unified ui redesign of all of
the screens." Once framed against the app's own `tokens.css` (which already defines a
full design system — color, a spacing scale, a type scale, sharp corners, and even a
documented hover/focus/disabled convention at the bottom of the file), what's actually
needed isn't a new visual direction — it's making every screen actually honor the system
that's already written down. Confirmed via direct choice: **"audit + conform"** — no new
shared React components, no restructuring of how components are styled (every component
keeps hand-rolling its own inline `style={{...}}` objects, same as today), just fixing
drift against the existing tokens and filling the couple of real gaps the audit found in
the token set itself.

Three research passes (read-only, real code citations) grounded this spec:
- An icon-vs-text button audit across all 46 `src/renderer/src/components/*.tsx` files.
- A modal/dialog chrome, spacing-scale, and color/state-convention audit.
- A separate, unrelated performance audit (N+1 queries, missing statement caching,
  missing batch IPC) — real findings, but **explicitly out of scope for this spec**,
  queued as its own follow-up.

## Goals

- Every modal/dialog in the app shares one visual shape, one z-index scale, one backdrop
  treatment, and one footer-button-order convention.
- Every interactive control (button, tile, row) gets real hover and focus feedback,
  matching tokens.css's own documented convention, almost entirely via two new global CSS
  rules rather than touching dozens of files.
- The handful of buttons that are crowded next to already-iconified siblings, or repeated
  once per row, become icon-only (hand-drawn SVG, no icon library — the pattern already
  established in `DiscoverPanel.tsx`), each with a `title` tooltip.
- The token set gains three small, targeted additions (a backdrop-opacity token, a
  z-index scale, one sub-scale spacing token) that make the "conform" work possible —
  it does NOT gain a new accent/focus color (explicit decision: stay grey-only, keep
  color reserved for audio-carrying UI).
- One real, isolated off-scale spacing value gets fixed.

## Non-goals

- No new shared React components (no `<Modal>`, `<Button>`, `<IconButton>` wrapper).
  Each file keeps its own inline styles; consistency comes from all of them referencing
  the same tokens and following the same shape, not from a shared implementation.
- No new accent/hue color anywhere in UI chrome. Focus stays a neutral grey border.
- No performance work — that's the separate, already-identified follow-up.
- No change to `LibraryBrowser.tsx`'s own full-screen browser chrome (opaque backdrop,
  `zIndex: 1000`) — already documented in that file as deliberately different from a
  dialog (it's a screen, not a modal), confirmed still correct by this audit.
- `ChannelRow.tsx`'s single-letter `m`/`s`/`fx`/`x` buttons and other buttons already
  ≤2 characters stay as text — they're already effectively icons.

## 1. Modal/dialog chrome

Every app-level modal converges on the shape already used by `LockInConfirmDialog.tsx`,
`UnsavedChangesDialog.tsx`, `UpdateAvailableDialog.tsx`, and `LoopOrOneShotPrompt.tsx`
(picked directly, via the visual comparison): plain body text, no separate uppercase
eyebrow header, `border: 1px solid var(--ra-border)` (the lighter of the two borders
currently in use), backdrop `var(--ra-backdrop)` (new token, see below), and the
primary/confirm action always rightmost in the footer.

**Files converting to this shape** (currently the "eyebrow modal" family —
`className="ra-eyebrow"` header, `border: var(--ra-border-strong)`, backdrop
0.5 or 0.6, `zIndex` 30 or 500):
- `NewProjectModal.tsx`
- `TidyUpNudgeModal.tsx`
- `ExportFormatPicker.tsx`
- `StemsFormatPicker.tsx`
- `AudioDeviceModal.tsx`
- `LibraryLocationModal.tsx`
- `OnboardingModal.tsx`

For each: drop the eyebrow `<div className="ra-eyebrow">` header element itself, but
**keep whatever real orientation information it carried** — fold it into the opening
line of body text (e.g. as the first sentence, or a bolded lead-in) rather than deleting
it outright. `.ra-eyebrow` the CSS class itself is NOT being removed from `global.css` —
it's still the right tool for section labels elsewhere in the app (e.g. Shelf's "rifff
library" label); only its use as a *modal header* goes away.

Two behavior changes, not just style, called out explicitly:
- **Button order**: `LibraryLocationModal.tsx` and `OnboardingModal.tsx` currently put
  the primary action leftmost — both flip to match the rest of the app (primary
  rightmost).
- **Backdrop-click-to-dismiss**: currently inconsistent even within the eyebrow family
  (`AudioDeviceModal.tsx` dismisses on backdrop click; `LibraryLocationModal.tsx` and
  `OnboardingModal.tsx` don't, with no documented reason either way). Every modal now
  follows the already-documented `LockInConfirmDialog.tsx` rationale: **no
  backdrop-click-to-dismiss, anywhere** — a consequential choice deserves an explicit
  button, not an easily-mis-clicked backdrop. This removes `AudioDeviceModal.tsx`'s
  current backdrop `onClick`.

**Files already correct, no shape change needed** (only get the token-literal swaps in
§2 below): `LockInConfirmDialog.tsx`, `UnsavedChangesDialog.tsx`,
`UpdateAvailableDialog.tsx`, `LoopOrOneShotPrompt.tsx`.

## 2. New tokens (additions to `tokens.css`, nothing removed or renamed)

```css
/* ——— backdrop ——— */
--ra-backdrop: rgba(0, 0, 0, 0.4);

/* ——— z-index scale ——— */
--ra-z-anchored: 100;          /* context menus, plugin chain panels, popovers
                                   pinned to a trigger element */
--ra-z-modal: 110;             /* every app-level modal/dialog */
--ra-z-fullscreen: 1000;       /* full-screen views: Library Browser, BusyOverlay */
--ra-z-fullscreen-popover: 1200; /* a popover that must float above a full-screen
                                     view's own content (e.g. Discover's nearby popover) */

/* ——— spacing sub-scale ——— */
--ra-s-0: 3px;   /* compact chip/select vertical padding — already a de facto
                    standard, copy-pasted identically across 7 files; this just
                    names it */
```

Every current hardcoded literal that these replace, by file (swap the literal for the
token, no visual change except where §1 already changed the value):

| Current | Files | New |
|---|---|---|
| `rgba(0,0,0,0.4)` | `LockInConfirmDialog`, `UnsavedChangesDialog`, `UpdateAvailableDialog`, `LoopOrOneShotPrompt`, `MasterChainPanel`, `ChannelChainPanel` | `var(--ra-backdrop)` |
| `rgba(0,0,0,0.5)` / `0.6` | the 7 files in §1 | `var(--ra-backdrop)` |
| `zIndex: 20` | `ContextMenu.tsx` | `var(--ra-z-anchored)` |
| `zIndex: 100` | `MasterChainPanel.tsx`, `ChannelChainPanel.tsx` | `var(--ra-z-anchored)` |
| `zIndex: 30` | the 4 of the 7 files in §1 that used 30 | `var(--ra-z-modal)` |
| `zIndex: 110` | `LockInConfirmDialog`, `UnsavedChangesDialog`, `UpdateAvailableDialog`, `LoopOrOneShotPrompt` | `var(--ra-z-modal)` |
| `zIndex: 500` | the 3 of the 7 files in §1 that used 500 | `var(--ra-z-modal)` |
| `zIndex: 1000` | `LibraryBrowser.tsx`'s own modal, `BusyOverlay.tsx` | `var(--ra-z-fullscreen)` |
| `zIndex: 1200` | `DiscoverNearbyPopover.tsx` | `var(--ra-z-fullscreen-popover)` |
| `'3px 8px'` / `'3px 4px'` / `'1px 3px'` | `ChannelChainPanel`, `MasterChainPanel`, `ClusterStemsBrowser`, `PluginCatalogBrowser`, `LibraryBrowser`, `ProjectLibraryBrowser`, `EditableText` | `'var(--ra-s-0) ...'` (keep the other side of the padding shorthand as-is — those are already on-scale) |

## 3. States

**Focus** — one new global rule in `global.css`, no per-file changes needed:

```css
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[role='button']:focus-visible {
  outline: 1px solid var(--ra-border-strong);
  outline-offset: -1px;
}
```

Deliberately `outline`, not `border` — every button in this codebase already sets its own
`border` via inline style, and an inline style always wins over an external stylesheet
rule for the *same* CSS property, `!important` aside. `outline` is a separate property
from `border` (doesn't affect box size, doesn't get overridden by an inline `border`), so
this one rule lights up focus-visible feedback everywhere immediately, no inline style
touched. `EditableText.tsx`'s own existing (border-based) focus treatment can switch to
this same rule too, dropping its bespoke handling.

**Hover** — same approach, one new global rule:

```css
button:not(:disabled):hover,
[role='button']:hover {
  filter: brightness(1.12);
}
```

`filter` composes with whatever a component already does on hover rather than fighting
it — `Shelf.tsx`'s existing opacity-driven tile "lit" state (hover is one of several
inputs to it) keeps working exactly as today, this just adds a subtle brighten on top.
Worth a real look once Elling runs the app — `1.12` is a starting point, not a value that
can be pixel-verified from this environment.

**Disabled** — standardize on `opacity: 0.3` (the already-documented, already-dominant
value). Three lines in `BeatPicker.tsx` (its "applying" busy state) currently use `0.5`
instead — change those three to `0.3`.

**Active/selected** — no changes; the audit found this already consistent (reuses
`--ra-play-on`/`--ra-stretch-on-bg` tokens app-wide, no ad hoc hardcoded colors).

## 4. Icon buttons

Convert these text buttons to icon-only (hand-drawn inline SVG matching
`DiscoverPanel.tsx`'s existing `DiceIcon`/`ShuffleIcon`/`StarIcon`/`NearbyIcon`/`LockGlyph`
convention — `viewBox 0 0 16 16`, `stroke="currentColor"`, `strokeWidth="1.3"`, round
caps/joins, no icon library), each keeping its current tooltip text as the button's
`title` attribute:

| File | Current label | New glyph |
|---|---|---|
| `ChannelChainPanel.tsx` (per slot) | `"edit"` | pencil |
| `MasterChainPanel.tsx` (per slot) | `"edit"` | pencil (same glyph, shared between the two files) |
| `PluginCatalogBrowser.tsx` (per row) | `"use"` | checkmark |
| `ProjectLibraryBrowser.tsx` (per sketch row) | `"history"` | clock/history arrow |
| `ProjectLibraryBrowser.tsx` (per backup row) | `"preview"` / `"stop"` | ▶ / ■ (matches `TransportBar.tsx`'s own existing convention — reuse, don't reinvent) |
| `ProjectLibraryBrowser.tsx` (per backup row, default state only) | `"restore"` | counterclockwise/undo arrow — **the armed `"restore?"` confirm-text state stays as text**, matching the neighboring delete button's own established icon→confirm-text pattern |
| `ClusterStemsBrowser.tsx` (per cluster row) | `"▶ play"` / `"■ playing"` | drop the trailing word, keep the existing ▶/■ — the icon's already there, the text is redundant |
| `ClusterStemsBrowser.tsx` (per multi-stem row) | `"split"` | two diverging arrows |
| `DiscoverNearbyPopover.tsx` | `"back to start"` | rewind-to-start |
| `DiscoverPanel.tsx` ("reroll all") | text next to an existing `ShuffleIcon` | drop the text, keep the icon — its own per-slot sibling button already went icon-only, this is the one inconsistent holdout |
| `LibraryBrowser.tsx` | `"close"` | × (matches the same × convention already used in `ChannelChainPanel`/`MasterChainPanel`/`ClusterStemsBrowser`/`PluginCatalogBrowser`/`ProjectLibraryBrowser`) |
| `TransportBar.tsx` | `"link"` / `"link · N"` | chain-link (title carries "Ableton Link") |
| `TransportBar.tsx` | `"envelope"` | S-curve/automation glyph |
| `TransportBar.tsx` | `"fx on main"` | sliders/knobs glyph |
| `TransportBar.tsx` | `"+ rec channel"` | "+" with a small mic glyph |

Explicitly staying as text (already reviewed, not candidates): `Inspector.tsx`'s
`"discover this rifff"` / `"stretch on"` / `"pick loop start"` / `"zero"` / `"ungroup"`,
`LibraryBrowser.tsx`'s `"sync"` / `"cancel"` / `"import to project"` / mode tabs,
`Shelf.tsx`'s `"import"`, `DiscoverPanel.tsx`'s `"plunk in arranger"` / consent-dialog
buttons / the tempo-match button (the bpm number it shows is load-bearing info, not just
a verb), and every one-off confirm/primary-CTA dialog (`OnboardingModal`, `NewProjectModal`,
`LockInConfirmDialog`, etc. — text reinforces confidence on a consequential, rare action).

## 5. Spacing

One real, isolated off-scale value: `Shelf.tsx`'s detail-header `padding: '11px 14px'` —
`11` isn't on the `--ra-s-*` scale (nearest are `10`/`12`). Changes to `'12px 14px'`
(`var(--ra-s-4)`). No other broad spacing changes — the audit found the rest of the app
already tracks the scale closely enough that a wider sweep isn't warranted.

## Testing

Same convention as every other UI-only change this session: typecheck (`npm run
typecheck`) + lint (`npx eslint --cache`) + the existing automated test suite
(`npm test`) as verification from this side — this environment has no GUI tooling, so a
coding agent cannot click through the app to confirm the actual look. The final task in
the implementation plan is a manual-walkthrough checklist for Elling: open each converted
modal (does it look/behave right, does backdrop-click correctly NOT dismiss, does the
button order read correctly), hover and tab-focus a handful of buttons/tiles across a few
different screens (does the new global hover/focus CSS look right — this is the one part
of this spec that's a genuine judgment call, not a mechanical token swap), and glance at
each converted icon button's tooltip.

## Out of scope, tracked separately

The performance audit's findings (N+1 query in Discover's adjacency navigation, missing
prepared-statement caching in `stemAutoCategoryStore.ts`/`stemFeatureCacheStore.ts`/
`stemCategoriesStore.ts`/`riffLibraryWriter.ts`, missing batch IPC for per-stem feature/
embedding cache reads, synchronous `existsSync` calls blocking the main thread in
`listRiffs()`, missing `React.memo` on `RiffCircle.tsx`, and two silent-failure gaps in
`App.tsx`'s save/open error handling) are real and already fully written up — queued as
the next thing to brainstorm/plan once this pass ships.
