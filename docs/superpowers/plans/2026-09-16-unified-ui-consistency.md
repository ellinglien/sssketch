# Unified UI Consistency Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every screen in sssketch actually honor the design system `tokens.css` already
defines — one modal shape, one z-index scale, one backdrop, real hover/focus/disabled
feedback, and icon-only buttons wherever a text button sits crowded next to already-iconified
siblings.

**Architecture:** No new shared React components. Every file keeps hand-rolling its own inline
`style={{...}}` objects, same as today. Consistency comes from (a) three small additions to
`tokens.css`, (b) two new global CSS rules in `global.css` (hover, focus) that apply app-wide
with almost zero per-file touches, and (c) per-file mechanical edits: swapping hardcoded
literals for the new tokens, converting 7 modals to one shared shape, and converting ~14 text
buttons across 9 files to hand-drawn SVG icons matching the existing `DiscoverPanel.tsx`
convention.

**Tech Stack:** React + TypeScript (renderer), plain CSS custom properties (`tokens.css`,
`global.css`), no new dependencies.

---

## Before you start

Read `docs/superpowers/specs/2026-09-16-unified-ui-consistency-design.md` in full — this plan
implements it exactly, with a few corrections found by re-reading the real current files (noted
inline below where they matter, e.g. `OnboardingModal.tsx` turned out to have no eyebrow header
at all, unlike the spec's own general description of the "eyebrow family").

Every task below is verified with `npm run typecheck` + `npx eslint --cache <touched files>`.
No task in this plan needs a new test file or TDD — this is CSS/JSX styling work with no new
pure/testable logic, matching this codebase's own established convention for React-component-only
changes (see root `CLAUDE.md`'s "Testing conventions" section). The very last task is a full
`npm test` run plus a manual-walkthrough checklist for Elling, since this environment can't
click through the real app to confirm the visual result.

Match every edit below by **code content**, not by trusting a line number blindly — re-verify
each file's current exact content immediately before editing it (it may have drifted a line or
two since this plan was written).

---

### Task 1: New tokens in `tokens.css`

**Files:**
- Modify: `src/renderer/src/styles/tokens.css`

- [ ] **Step 1: Add the backdrop token, z-index scale, and spacing sub-scale token**

Open `src/renderer/src/styles/tokens.css`. Find this existing block (currently lines 96-114):

```css
  /* ——— geometry ——— */
  /* 6b is sharp-cornered throughout — no rounded rects anywhere in the
   * mockup, buttons and clips included. */
  --ra-r-1: 0px;
  --ra-r-2: 0px;
  --ra-r-3: 0px;
  --ra-r-4: 0px;
  --ra-r-5: 0px;
  --ra-r-6: 0px;
  --ra-r-7: 0px;

  --ra-s-1: 4px;
  --ra-s-2: 7px;
  --ra-s-3: 9px;
  --ra-s-4: 10px;
  --ra-s-5: 12px;
  --ra-s-6: 14px;
  --ra-s-7: 20px;
  --ra-s-8: 32px;
```

Replace it with (adds `--ra-s-0` directly above `--ra-s-1`, nothing else in this block changes):

```css
  /* ——— geometry ——— */
  /* 6b is sharp-cornered throughout — no rounded rects anywhere in the
   * mockup, buttons and clips included. */
  --ra-r-1: 0px;
  --ra-r-2: 0px;
  --ra-r-3: 0px;
  --ra-r-4: 0px;
  --ra-r-5: 0px;
  --ra-r-6: 0px;
  --ra-r-7: 0px;

  /* --ra-s-0 is a sub-scale value, not a full step -- it formalizes a
   * "compact chip/select vertical padding" value that was already
   * copy-pasted identically (as a raw '3px') across 7 different files
   * before this token existed. See docs/superpowers/specs/
   * 2026-09-16-unified-ui-consistency-design.md. */
  --ra-s-0: 3px;
  --ra-s-1: 4px;
  --ra-s-2: 7px;
  --ra-s-3: 9px;
  --ra-s-4: 10px;
  --ra-s-5: 12px;
  --ra-s-6: 14px;
  --ra-s-7: 20px;
  --ra-s-8: 32px;
```

Then find this existing block (currently lines 131-136):

```css
  /* ——— elevation & motion ——— */
  --ra-shadow-popover: 0 6px 20px rgba(0, 0, 0, 0.4);
  --ra-dur-fast: 120ms;   /* hovers */
  --ra-dur-med: 220ms;    /* state changes */
  --ra-dur-slow: 380ms;   /* panel slides */
  --ra-ease: cubic-bezier(0.22, 0.8, 0.32, 1);
```

Replace it with (adds `--ra-backdrop` and the z-index scale, nothing else changes):

```css
  /* ——— elevation & motion ——— */
  --ra-shadow-popover: 0 6px 20px rgba(0, 0, 0, 0.4);
  --ra-backdrop: rgba(0, 0, 0, 0.4);
  --ra-dur-fast: 120ms;   /* hovers */
  --ra-dur-med: 220ms;    /* state changes */
  --ra-dur-slow: 380ms;   /* panel slides */
  --ra-ease: cubic-bezier(0.22, 0.8, 0.32, 1);

  /* ——— z-index scale ——— */
  /* Four tiers, replacing 7 previously undocumented ad hoc values (20, 30,
   * 100, 110, 500, 1000, 1200) scattered across modals/panels/popovers with
   * no ordering rule. See docs/superpowers/specs/
   * 2026-09-16-unified-ui-consistency-design.md. */
  --ra-z-anchored: 100;            /* context menus, plugin chain panels,
                                       popovers pinned to a trigger element */
  --ra-z-modal: 110;               /* every app-level modal/dialog */
  --ra-z-fullscreen: 1000;         /* full-screen views: Library Browser,
                                       BeatPicker, BusyOverlay */
  --ra-z-fullscreen-popover: 1200; /* a popover that must float above a
                                       full-screen view's own content (e.g.
                                       Discover's nearby popover) */
```

- [ ] **Step 2: Typecheck (CSS has no typecheck, confirm the app still builds)**

Run: `npm run typecheck`
Expected: passes with no errors (this file has no TS to break, this just confirms nothing else
references these tokens yet in a way that would fail).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles/tokens.css
git commit -m "tokens.css: add backdrop, z-index scale, and s-0 spacing tokens

Foundation for the unified UI consistency pass -- every later task in
this plan references these by name. See docs/superpowers/specs/
2026-09-16-unified-ui-consistency-design.md."
```

---

### Task 2: Global hover + focus CSS rules

**Files:**
- Modify: `src/renderer/src/styles/global.css`

- [ ] **Step 1: Add the two new rules**

Open `src/renderer/src/styles/global.css`. Find this existing block (currently lines 89-93):

```css
button {
  font-family: inherit;
  cursor: pointer;
  color: inherit;
}
```

Replace it with:

```css
button {
  font-family: inherit;
  cursor: pointer;
  color: inherit;
}

/* Real hover feedback, app-wide, with almost zero per-file touches --
 * `filter` composes with whatever a component already does on hover
 * (e.g. Shelf.tsx's own opacity-driven tile "lit" state) rather than
 * fighting it. `:not(:disabled)` keeps a disabled button visually inert.
 * See docs/superpowers/specs/2026-09-16-unified-ui-consistency-design.md
 * -- "1.12" is a starting point, not pixel-verified from this environment. */
button:not(:disabled):hover,
[role='button']:hover {
  filter: brightness(1.12);
}

/* Focus-visible feedback, app-wide. Deliberately `outline`, not `border`:
 * almost every button/input in this codebase already sets its own
 * `border` via inline style, and an inline style always wins over an
 * external stylesheet rule for the SAME CSS property -- `outline` is a
 * separate property (doesn't affect box size, can't be overridden by an
 * inline `border`), so this one rule works everywhere with no inline
 * style touched. Grey border, no new accent color -- direct decision,
 * see the design spec. */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[role='button']:focus-visible {
  outline: 1px solid var(--ra-border-strong);
  outline-offset: -1px;
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/styles/global.css`
Expected: both pass (eslint on a `.css` file is a no-op, confirms the command itself doesn't
error).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles/global.css
git commit -m "global.css: real hover + focus-visible feedback, app-wide

Two new rules cover almost every interactive element with zero per-file
changes: hover uses filter:brightness (composes with existing per-
component hover logic like Shelf.tsx's tile opacity), focus uses
outline (a separate CSS property from border, so it isn't overridden by
the inline border every button/input already sets). See docs/superpowers/
specs/2026-09-16-unified-ui-consistency-design.md."
```

---

### Task 3: `BeatPicker.tsx` — disabled opacity + token swap

**Files:**
- Modify: `src/renderer/src/components/BeatPicker.tsx`

Before editing, re-run `grep -n "0\.5" src/renderer/src/components/BeatPicker.tsx` to confirm
the exact current line numbers below haven't drifted (this plan was written against a version
with these at lines 922, 1310, 1336, 1355).

- [ ] **Step 1: Fix the three disabled-opacity values**

At (approximately) lines 1310, 1336, and 1355, find each occurrence of:

```ts
                opacity: applying ? 0.5 : 1,
```

(the exact surrounding indentation differs slightly between the three — match by the
`applying ? 0.5 : 1` text itself, there are exactly three). Change `0.5` to `0.3` in all three,
matching the app's documented disabled convention (`tokens.css`'s own state comment:
"disabled = 30% opacity"):

```ts
                opacity: applying ? 0.3 : 1,
```

- [ ] **Step 2: Swap the backdrop/z-index literals for tokens**

At (approximately) line 916-936, find:

```tsx
  return (
    <div
      onClick={() => escapeRef.current()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Higher than LibraryBrowser's own overlay (zIndex 1000): after a
        // LORE import, BeatPicker opens while that panel is still open
        // behind it (the panel deliberately stays open across imports so
        // browsing isn't interrupted) — needs to render on top to actually
        // be usable, not just mounted-but-invisible underneath. Real bug
        // this fixed: LibraryBrowser's own zIndex grew from 10 to 1000 at
        // some point (see its own root style) without this getting bumped
        // to match, so the picker silently opened UNDER the library panel
        // -- clicking import looked like nothing happened at all.
        zIndex: 1010
      }}
    >
```

Replace the `background`/`zIndex` lines only (keep everything else, including the comment,
unchanged — just update the comment's own literal "1010" reference to explain the token
instead):

```tsx
  return (
    <div
      onClick={() => escapeRef.current()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Above LibraryBrowser's own overlay (--ra-z-fullscreen): after a
        // LORE import, BeatPicker opens while that panel is still open
        // behind it (the panel deliberately stays open across imports so
        // browsing isn't interrupted) — needs to render on top to actually
        // be usable, not just mounted-but-invisible underneath. Real bug
        // this fixed: LibraryBrowser's own zIndex grew from 10 to 1000 at
        // some point (see its own root style) without this getting bumped
        // to match, so the picker silently opened UNDER the library panel
        // -- clicking import looked like nothing happened at all. Uses the
        // same tier as a full-screen popover (--ra-z-fullscreen-popover)
        // rather than a new one-off value, since the real requirement is
        // just "above the fullscreen tier."
        zIndex: 'var(--ra-z-fullscreen-popover)'
      }}
    >
```

Leave the `onClick={() => escapeRef.current()}` backdrop-click-to-dismiss AS-IS — this is a
deliberate exception, not drift: BeatPicker is a big, content-rich full-screen picker tool
(closer to `LibraryBrowser.tsx`'s own full-screen browser, which the design spec already
excludes from the "no backdrop-click-dismiss" rule) rather than a small consequential-choice
dialog.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/BeatPicker.tsx`
Expected: both pass. `zIndex: 'var(--ra-z-fullscreen-popover)'` is a string in a
`React.CSSProperties` object (the `zIndex` property accepts `string | number`) — if typecheck
complains, confirm it's inside a plain `style={{...}}` object literal, not a typed constant that
narrows `zIndex` to `number` elsewhere in this file.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/BeatPicker.tsx
git commit -m "BeatPicker: disabled opacity 0.5->0.3, backdrop/z-index tokens

Three 'applying' busy-state opacity values now match the app's
documented 0.3 disabled convention. Backdrop/z-index now reference the
new tokens.css tiers instead of one-off literals -- backdrop-click-to-
dismiss stays, deliberately (this is a full-screen tool, not a small
dialog). See docs/superpowers/specs/2026-09-16-unified-ui-consistency-design.md."
```

---

### Task 4: `EditableText.tsx` — simplify focus handling

**Files:**
- Modify: `src/renderer/src/components/EditableText.tsx`

Depends on Task 2 (the new global `:focus-visible` rule).

- [ ] **Step 1: Remove the bespoke border-based focus treatment**

Open `src/renderer/src/components/EditableText.tsx`. Find the current return statement:

```tsx
  return (
    <input
      type="text"
      value={text}
      title={title}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(value)
          e.currentTarget.blur()
        }
      }}
      style={{
        background: focused ? 'var(--ra-bg-row-active)' : 'transparent',
        border: `1px solid ${focused ? 'var(--ra-border-strong)' : 'transparent'}`,
        color: 'inherit',
        font: 'inherit',
        padding: '1px 3px',
        margin: '-1px -3px',
        outline: 'none',
        minWidth: 0,
        ...style
      }}
    />
  )
```

Replace the `style` object only (everything else in the return statement is unchanged) —
drops the border toggle and the `outline: 'none'` override, so the new global
`:focus-visible` rule (Task 2) supplies the focus ring instead. Keeps the `background` toggle,
which is a real, distinct "click-to-edit" affordance, not just a focus ring:

```tsx
      style={{
        background: focused ? 'var(--ra-bg-row-active)' : 'transparent',
        border: '1px solid transparent',
        color: 'inherit',
        font: 'inherit',
        padding: '1px 3px',
        margin: '-1px -3px',
        minWidth: 0,
        ...style
      }}
    />
  )
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/EditableText.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/EditableText.tsx
git commit -m "EditableText: rely on the new global focus-visible rule

Drops this component's own bespoke border-toggle-on-focus and its
outline:none override, letting the new app-wide :focus-visible outline
rule (global.css) supply the focus ring instead. The background toggle
stays -- that's a real click-to-edit affordance, not just focus styling."
```

---

### Task 5: Token-literal swap in the 4 already-Family-A-shaped dialogs

**Files:**
- Modify: `src/renderer/src/components/LockInConfirmDialog.tsx`
- Modify: `src/renderer/src/components/UnsavedChangesDialog.tsx`
- Modify: `src/renderer/src/components/UpdateAvailableDialog.tsx`
- Modify: `src/renderer/src/components/LoopOrOneShotPrompt.tsx`

Depends on Task 1. These four files already match the canonical modal shape exactly (no
structural change needed) — this task only swaps their hardcoded `zIndex: 110` /
`background: 'rgba(0, 0, 0, 0.4)'` literals for the new tokens.

- [ ] **Step 1: `LockInConfirmDialog.tsx`**

Find (currently lines 48-53):

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
```

Replace with:

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-modal)',
        background: 'var(--ra-backdrop)',
```

- [ ] **Step 2: `UnsavedChangesDialog.tsx`**

Find (currently lines 41-46):

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
```

Replace with:

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-modal)',
        background: 'var(--ra-backdrop)',
```

- [ ] **Step 3: `UpdateAvailableDialog.tsx`**

Find (currently lines 36-41):

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
```

Replace with:

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-modal)',
        background: 'var(--ra-backdrop)',
```

While in this file, also fix an unrelated, pre-existing invalid CSS variable reference found
during this plan's own fresh read — line 82 currently reads:

```tsx
              style={{
                height: 4,
                background: 'var(--ra-bg)',
                border: '1px solid var(--ra-border)'
              }}
```

`--ra-bg` does not exist anywhere in `tokens.css` (the real color tokens are `--ra-bg-page`,
`--ra-bg-frame`, `--ra-bg-bar`, `--ra-bg-rail`, `--ra-bg-row`, `--ra-bg-row-active`,
`--ra-bg-row-sub`) — this silently falls back to no background. Change it to the recessed-well
token already used elsewhere in the app for this kind of sunken track:

```tsx
              style={{
                height: 4,
                background: 'var(--ra-bg-row-sub)',
                border: '1px solid var(--ra-border)'
              }}
```

- [ ] **Step 4: `LoopOrOneShotPrompt.tsx`**

Find (currently lines 148-153):

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
```

Replace with:

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-modal)',
        background: 'var(--ra-backdrop)',
```

- [ ] **Step 5: Typecheck + lint**

Run:
```bash
npm run typecheck
npx eslint --cache src/renderer/src/components/LockInConfirmDialog.tsx src/renderer/src/components/UnsavedChangesDialog.tsx src/renderer/src/components/UpdateAvailableDialog.tsx src/renderer/src/components/LoopOrOneShotPrompt.tsx
```
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/LockInConfirmDialog.tsx src/renderer/src/components/UnsavedChangesDialog.tsx src/renderer/src/components/UpdateAvailableDialog.tsx src/renderer/src/components/LoopOrOneShotPrompt.tsx
git commit -m "Swap hardcoded backdrop/z-index literals for the new tokens

These 4 dialogs already match the canonical modal shape -- just
replacing zIndex:110/rgba(0,0,0,0.4) with var(--ra-z-modal)/
var(--ra-backdrop). Also fixes an invalid --ra-bg reference in
UpdateAvailableDialog.tsx (that token doesn't exist; the progress
track now uses --ra-bg-row-sub instead)."
```

---

### Task 6: `NewProjectModal.tsx` — convert to canonical modal shape

**Files:**
- Modify: `src/renderer/src/components/NewProjectModal.tsx`

Depends on Task 1.

- [ ] **Step 1: Drop the eyebrow header, unify border/backdrop/z-index, remove backdrop-click-dismiss**

Find the current return statement:

```tsx
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
          width: 'min(360px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">name this project</span>
        <input
```

Replace with (drops the outer `onClick={onCancel}` and inner `onClick={(e) => e.stopPropagation()}` —
no longer needed once backdrop-click no longer dismisses; drops the eyebrow, replacing it with
a plain body-text line carrying the same information; `border-strong` -> `border`, backdrop/
z-index -> tokens):

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(360px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>name this project</p>
        <input
```

Then find (a few lines further down, the `marginTop: 10` on the `<input>`'s own style) and
leave that untouched — the input's `marginTop: 10` already provides the right gap below the
new `<p>` since it replaces the eyebrow at the same position.

Button order is already correct here (cancel left, create/primary right) — no change needed.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/NewProjectModal.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/NewProjectModal.tsx
git commit -m "NewProjectModal: convert to the canonical modal shape

Drops the uppercase eyebrow header (folded into a plain body-text
line), border-strong -> border, backdrop/z-index -> new tokens, and
removes backdrop-click-to-dismiss (a consequential choice deserves an
explicit button). See docs/superpowers/specs/
2026-09-16-unified-ui-consistency-design.md."
```

---

### Task 7: `TidyUpNudgeModal.tsx` — convert to canonical modal shape

**Files:**
- Modify: `src/renderer/src/components/TidyUpNudgeModal.tsx`

Depends on Task 1.

- [ ] **Step 1: Drop the eyebrow header, unify border/backdrop/z-index, remove backdrop-click-dismiss**

Find:

```tsx
  return (
    <div
      onClick={onExportAnyway}
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
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">this project hasn&apos;t been tidied up yet</span>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-2)' }}>
          tidy up groups similar stems onto shared Ableton tracks, making the exported project much
          easier to mix. tidy up first?
        </div>
```

Replace with (this one is a particularly important fix, not just style: currently a stray
click OUTSIDE the modal silently commits to "export anyway" — a real, consequential action a
misclick could trigger. Folds the eyebrow's own information into the body paragraph's opening
sentence instead of a separate header):

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--ra-text)' }}>
          this project hasn&apos;t been tidied up yet -- tidy up groups similar stems onto shared
          Ableton tracks, making the exported project much easier to mix. tidy up first?
        </div>
```

Note the merged paragraph drops the separate `marginTop: 10, color: 'var(--ra-text-2)'` div
that used to sit below the eyebrow — it's now one paragraph using the same body-text color
(`--ra-text`, matching every other Family A dialog's own body paragraph) as every other
canonical-shape modal.

Button order is already correct here (export anyway = secondary/left, tidy up first =
primary/right) — no change needed.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/TidyUpNudgeModal.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/TidyUpNudgeModal.tsx
git commit -m "TidyUpNudgeModal: convert to the canonical modal shape

Drops the eyebrow header (folded into the body paragraph's opening
sentence), border-strong -> border, backdrop/z-index -> new tokens.
Also removes backdrop-click-to-dismiss -- previously a stray click
OUTSIDE the modal silently committed to 'export anyway,' a real
consequential action a misclick could trigger."
```

---

### Task 8: `ExportFormatPicker.tsx` — convert to canonical modal shape + add explicit cancel

**Files:**
- Modify: `src/renderer/src/components/ExportFormatPicker.tsx`

Depends on Task 1.

- [ ] **Step 1: Drop the eyebrow header, unify border/backdrop/z-index, replace backdrop-dismiss with an explicit cancel button**

This file has no footer button pair today — just a vertical list of format choices, dismissed
only via backdrop click. Removing backdrop-click-to-dismiss here without adding anything else
would strand the user with no way to close it except picking a format. Add an explicit
"cancel" button (matching every other Family A dialog's own convention).

Find the full current return statement:

```tsx
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
          <button style={{ ...buttonStyle, marginBottom: 0 }} onClick={() => onChoose('reaper')}>
            reaper project
          </button>
        </div>
      </div>
    </div>
  )
```

Replace with:

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(260px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>export as</p>
        <div style={{ marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('ableton')}>
            ableton project
          </button>
          <button style={{ ...buttonStyle, marginBottom: 0 }} onClick={() => onChoose('reaper')}>
            reaper project
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/ExportFormatPicker.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ExportFormatPicker.tsx
git commit -m "ExportFormatPicker: convert to the canonical modal shape

Drops the eyebrow header, border-strong -> border, backdrop/z-index ->
new tokens. Removing backdrop-click-to-dismiss would have stranded the
user (no other way to close this picker) -- added an explicit cancel
button instead."
```

---

### Task 9: `StemsFormatPicker.tsx` — convert to canonical modal shape + add explicit cancel

**Files:**
- Modify: `src/renderer/src/components/StemsFormatPicker.tsx`

Depends on Task 1. Identical pattern to Task 8 (`ExportFormatPicker.tsx`) — same file
structure, same fix.

- [ ] **Step 1: Drop the eyebrow header, unify border/backdrop/z-index, replace backdrop-dismiss with an explicit cancel button**

Find the full current return statement:

```tsx
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
          width: 'min(280px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">export stems as</span>
        <div style={{ marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('stems')}>
            mixed by bus
          </button>
          <button
            style={{ ...buttonStyle, marginBottom: 0 }}
            onClick={() => onChoose('stemTracks')}
          >
            individual tracks
          </button>
        </div>
      </div>
    </div>
  )
```

Replace with:

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(280px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>export stems as</p>
        <div style={{ marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('stems')}>
            mixed by bus
          </button>
          <button
            style={{ ...buttonStyle, marginBottom: 0 }}
            onClick={() => onChoose('stemTracks')}
          >
            individual tracks
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/StemsFormatPicker.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/StemsFormatPicker.tsx
git commit -m "StemsFormatPicker: convert to the canonical modal shape

Same fix as ExportFormatPicker.tsx (identical structure): drops the
eyebrow header, border-strong -> border, backdrop/z-index -> new
tokens, added an explicit cancel button so removing backdrop-click-
to-dismiss doesn't strand the user."
```

---

### Task 10: `AudioDeviceModal.tsx` — convert to canonical modal shape

**Files:**
- Modify: `src/renderer/src/components/AudioDeviceModal.tsx`

Depends on Task 1.

- [ ] **Step 1: Drop the eyebrow header, unify border/backdrop/z-index, remove backdrop-click-dismiss**

Find:

```tsx
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(340px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <span className="ra-eyebrow">audio</span>
```

Replace with (this modal has no prose body, only form fields -- "audio" becomes a plain,
un-tracked label rather than folding into a sentence, since there's no sentence for it to open):

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(340px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>audio settings</p>
```

Then find the close button's own border (near the end of the file):

```tsx
        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-end',
            height: 28,
            borderRadius: 0,
            padding: '0 14px',
            fontSize: 11,
            fontWeight: 700,
            border: '1px solid var(--ra-border-strong)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            cursor: 'pointer'
          }}
        >
          close
        </button>
```

Replace `border: '1px solid var(--ra-border-strong)'` with `border: '1px solid var(--ra-border)'`
(everything else in this button unchanged):

```tsx
        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-end',
            height: 28,
            borderRadius: 0,
            padding: '0 14px',
            fontSize: 11,
            fontWeight: 700,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            cursor: 'pointer'
          }}
        >
          close
        </button>
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/AudioDeviceModal.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AudioDeviceModal.tsx
git commit -m "AudioDeviceModal: convert to the canonical modal shape

Drops the eyebrow header (this modal has no prose body, so 'audio'
becomes a plain label rather than folding into a sentence),
border-strong -> border, backdrop/z-index -> new tokens, removes
backdrop-click-to-dismiss (the explicit close button remains
sufficient -- no other button existed only via backdrop click)."
```

---

### Task 11: `LibraryLocationModal.tsx` — convert to canonical modal shape + flip button order

**Files:**
- Modify: `src/renderer/src/components/LibraryLocationModal.tsx`

Depends on Task 1.

- [ ] **Step 1: Drop the eyebrow header, unify border/backdrop/z-index, flip button order**

Find:

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500
      }}
    >
      <div
        style={{
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 18
        }}
      >
        <span className="ra-eyebrow">sketches save to</span>
        <div
          style={{
            fontSize: 11,
            color: 'var(--ra-text-2)',
            marginTop: 8,
            padding: '6px 8px',
            border: '1px solid var(--ra-border)',
            wordBreak: 'break-all'
          }}
        >
          {libraryRoot ?? '…'}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          <button
            onClick={onContinue}
            style={{
              height: 'auto',
              minHeight: 22,
              borderRadius: 0,
              padding: '4px 10px',
              fontSize: 10,
              whiteSpace: 'nowrap',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            use this folder
          </button>
          <button
            onClick={onChooseFolder}
            style={{
              height: 'auto',
              minHeight: 22,
              borderRadius: 0,
              padding: '4px 10px',
              fontSize: 10,
              whiteSpace: 'nowrap',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            choose folder…
          </button>
        </div>
      </div>
    </div>
  )
```

Replace with (drops the eyebrow, folded into a plain body-text line; border-strong -> border;
backdrop/z-index -> tokens; **the two buttons swap positions** — "choose folder…" (secondary)
now comes first/left, "use this folder" (primary) now comes second/right, matching every other
dialog's primary-rightmost convention):

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 18
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>sketches save to</p>
        <div
          style={{
            fontSize: 11,
            color: 'var(--ra-text-2)',
            marginTop: 8,
            padding: '6px 8px',
            border: '1px solid var(--ra-border)',
            wordBreak: 'break-all'
          }}
        >
          {libraryRoot ?? '…'}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 14,
            justifyContent: 'flex-end'
          }}
        >
          <button
            onClick={onChooseFolder}
            style={{
              height: 'auto',
              minHeight: 22,
              borderRadius: 0,
              padding: '4px 10px',
              fontSize: 10,
              whiteSpace: 'nowrap',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            choose folder…
          </button>
          <button
            onClick={onContinue}
            style={{
              height: 'auto',
              minHeight: 22,
              borderRadius: 0,
              padding: '4px 10px',
              fontSize: 10,
              whiteSpace: 'nowrap',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            use this folder
          </button>
        </div>
      </div>
    </div>
  )
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/LibraryLocationModal.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/LibraryLocationModal.tsx
git commit -m "LibraryLocationModal: canonical shape + flip button order

Drops the eyebrow header, border-strong -> border, backdrop/z-index ->
new tokens. The primary action ('use this folder') was leftmost --
flipped to rightmost, matching every other dialog's convention."
```

---

### Task 12: `OnboardingModal.tsx` — token-literal swap only (reduced scope)

**Files:**
- Modify: `src/renderer/src/components/OnboardingModal.tsx`

Depends on Task 1. **This file's scope is smaller than the other 6** — a fresh read found it
has NO `className="ra-eyebrow"` header anywhere (its "arrangement tool for endlesss" tagline
and the recovery notice are already plain bold body text, `fontWeight: 700`, not eyebrow-
styled), and its pure-black background + `border-strong` were both put there deliberately,
per direct feedback, and documented in the file's own comment ("A real, literal black...
per direct feedback"). Its button layout (new project / open project / log into endlesss) is
three parallel top-level choices, not a primary/secondary confirm pair, so the "primary
rightmost" button-order rule doesn't cleanly apply here either — leave the button order as-is.

Only the two hardcoded literals get swapped for tokens; nothing else in this file changes.

- [ ] **Step 1: Swap `zIndex`/backdrop**

Find:

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500
      }}
    >
```

Replace with:

```tsx
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/OnboardingModal.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/OnboardingModal.tsx
git commit -m "OnboardingModal: backdrop/z-index -> tokens (reduced scope)

This file's own black background, border-strong, and headerless body
text were all deliberate, direct-feedback-driven choices (see the
file's own comments) -- NOT drift, unlike the other 6 'eyebrow modal'
files. Only the backdrop/z-index literals move to the new tokens; the
rest of this modal's own distinct look stays exactly as designed."
```

---

### Task 13: `TransportBar.tsx` — 4 icon buttons

**Files:**
- Modify: `src/renderer/src/components/TransportBar.tsx`

- [ ] **Step 1: Add 4 new hand-drawn SVG icon components**

Open `src/renderer/src/components/TransportBar.tsx`. Find a spot near the top of the file
(after the imports, before the main exported component — check where any existing local
helper functions/components in this file already live and match that spot) and add:

```tsx
// Hand-drawn SVG glyphs -- no icon library, monochrome via currentColor,
// same convention as DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/
// LockGlyph etc. Direct request, 2026-09-16: "check for any other
// buttons in the interface that might be replaced with icons." These four
// sit in the same transport toolbar row as this file's own already-icon
// MetronomeIcon/SettingsGearIcon/RecDotIcon -- the strongest icon/text
// crowding signal found in the whole app.
function ChainLinkIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="5" width="7" height="6" rx="3" />
      <rect x="7.5" y="5" width="7" height="6" rx="3" />
    </svg>
  )
}

function EnvelopeIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M2 12 C 5 12, 5 4, 8 4 S 11 12, 14 12" />
      <circle cx="2" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function SlidersIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M3 13 V3" />
      <path d="M8 13 V3" />
      <path d="M13 13 V3" />
      <circle cx="3" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="13" cy="4.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PlusMicIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="1.5" width="4" height="7" rx="2" />
      <path d="M4 8 a4 4 0 0 0 8 0" />
      <path d="M8 12 V14.5" />
      <path d="M11.5 2 V5" />
      <path d="M10 3.5 H13" />
    </svg>
  )
}
```

- [ ] **Step 2: Convert the "link" button**

Find (currently lines 647-667):

```tsx
      <button
        onClick={() => {
          const next = !linkStatus.enabled
          void window.rifffApi.engineSetLinkEnabled(next).then(() => {
            void window.rifffApi.engineGetLinkStatus().then(setLinkStatus)
          })
        }}
        aria-label="Toggle Ableton Link"
        title="Ableton Link — sync tempo with other Link-enabled apps on this network"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: linkStatus.enabled ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        link{linkStatus.enabled && linkStatus.numPeers > 0 ? ` · ${linkStatus.numPeers}` : ''}
      </button>
```

Replace with (icon replaces the word "link"; the live peer count — real, glanceable state, not
just a verb — stays visible as a small suffix next to the icon rather than disappearing into
the tooltip):

```tsx
      <button
        onClick={() => {
          const next = !linkStatus.enabled
          void window.rifffApi.engineSetLinkEnabled(next).then(() => {
            void window.rifffApi.engineGetLinkStatus().then(setLinkStatus)
          })
        }}
        aria-label="Toggle Ableton Link"
        title="Ableton Link — sync tempo with other Link-enabled apps on this network"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: linkStatus.enabled ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        <ChainLinkIcon />
        {linkStatus.enabled && linkStatus.numPeers > 0 ? `· ${linkStatus.numPeers}` : ''}
      </button>
```

- [ ] **Step 3: Convert the "envelope" button**

Find (currently lines 669-684):

```tsx
      <button
        onClick={() => dispatch({ type: 'TOGGLE_VOLUME_DRAG_MODE' })}
        aria-label="Toggle volume drag mode"
        title={state.volumeDragMode ? 'envelope drag: on (V)' : 'envelope drag: off (V)'}
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.volumeDragMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        envelope
      </button>
```

Replace the button's children only (its style/handlers/title are unchanged):

```tsx
      <button
        onClick={() => dispatch({ type: 'TOGGLE_VOLUME_DRAG_MODE' })}
        aria-label="Toggle volume drag mode"
        title={state.volumeDragMode ? 'envelope drag: on (V)' : 'envelope drag: off (V)'}
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.volumeDragMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        <EnvelopeIcon />
      </button>
```

- [ ] **Step 4: Convert the "fx on main" button**

Find (currently lines 686-701):

```tsx
      <button
        onClick={() => setMasterChainPanelOpen((open) => !open)}
        aria-label="Toggle master chain panel"
        title="master plugin chain"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: masterChainPanelOpen ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        fx on main
      </button>
```

Replace the button's children only:

```tsx
      <button
        onClick={() => setMasterChainPanelOpen((open) => !open)}
        aria-label="Toggle master chain panel"
        title="master plugin chain"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: masterChainPanelOpen ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        <SlidersIcon />
      </button>
```

- [ ] **Step 5: Convert the "+ rec channel" button**

Find (currently lines 704-718):

```tsx
      <button
        onClick={() => dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })}
        title="add another recording channel (/)"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)'
        }}
      >
        + rec channel
      </button>
```

Replace the button's children only:

```tsx
      <button
        onClick={() => dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })}
        title="add another recording channel (/)"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)'
        }}
      >
        <PlusMicIcon />
      </button>
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/TransportBar.tsx`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/TransportBar.tsx
git commit -m "TransportBar: convert link/envelope/fx-on-main/+rec-channel to icons

These 4 text buttons sat in the same toolbar row as this file's own
already-icon MetronomeIcon/SettingsGearIcon/RecDotIcon -- the most
crowded icon/text inconsistency found in the app. Each keeps its
existing title as the tooltip; link's live peer count stays visible
as a small suffix next to its icon rather than disappearing entirely."
```

---

### Task 14: `ChannelChainPanel.tsx` + `MasterChainPanel.tsx` — "edit" -> pencil icon

**Files:**
- Modify: `src/renderer/src/components/ChannelChainPanel.tsx`
- Modify: `src/renderer/src/components/MasterChainPanel.tsx`

Same glyph, same fix, in both files (they already share the same 2-slot-panel structure and
`buttonStyle()` convention per each file's own doc comment referencing the other).

- [ ] **Step 1: Add a local `PencilIcon` to `ChannelChainPanel.tsx`**

Near the top of `src/renderer/src/components/ChannelChainPanel.tsx` (after the existing
`buttonStyle`/`selectStyle` helpers, before the exported `ChannelChainPanel` function), add:

```tsx
// Hand-drawn SVG glyph -- no icon library, same convention as
// DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/LockGlyph etc. Direct
// request, 2026-09-16: replace the repeated-per-slot "edit" text button.
function PencilIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.5 2.5 L13.5 5.5 L5 14 L2 14 L2 11 Z" />
      <path d="M9 4 L12 7" />
    </svg>
  )
}
```

- [ ] **Step 2: Use it in place of the "edit" text**

Find (currently lines 168-175):

```tsx
              <button
                onClick={() => void window.rifffApi.engineOpenChannelPluginEditor(channelId, slot)}
                disabled={editDisabled}
                aria-label={`edit channel ${channelId} slot ${label} plugin`}
                style={buttonStyle(editDisabled)}
              >
                edit
              </button>
```

Replace with (`title` added, matching the existing `aria-label` text, so hovering shows the
same tooltip a sighted mouse user needs now that there's no text label):

```tsx
              <button
                onClick={() => void window.rifffApi.engineOpenChannelPluginEditor(channelId, slot)}
                disabled={editDisabled}
                aria-label={`edit channel ${channelId} slot ${label} plugin`}
                title={`edit channel ${channelId} slot ${label} plugin`}
                style={buttonStyle(editDisabled)}
              >
                <PencilIcon />
              </button>
```

- [ ] **Step 3: Add the identical local `PencilIcon` to `MasterChainPanel.tsx`**

Near the top of `src/renderer/src/components/MasterChainPanel.tsx` (same spot relative to its
own `buttonStyle`/`selectStyle` helpers), add the exact same `PencilIcon` function as Step 1.

- [ ] **Step 4: Use it in `MasterChainPanel.tsx`**

Find (currently lines 163-167):

```tsx
                disabled={editDisabled}
                aria-label={`edit slot ${label} plugin`}
                style={buttonStyle(editDisabled)}
              >
                edit
              </button>
```

Replace with:

```tsx
                disabled={editDisabled}
                aria-label={`edit slot ${label} plugin`}
                title={`edit slot ${label} plugin`}
                style={buttonStyle(editDisabled)}
              >
                <PencilIcon />
              </button>
```

- [ ] **Step 5: Swap the z-index literal in both files**

Both files currently have `zIndex: 100` in their own outer backdrop `style` object (already
exactly matching the new `--ra-z-anchored` tier — from the spec's own token-swap table). In
`ChannelChainPanel.tsx`, find:

```tsx
        zIndex: 100,
```

Replace with:

```tsx
        zIndex: 'var(--ra-z-anchored)',
```

Do the identical replacement in `MasterChainPanel.tsx` (same `zIndex: 100` line in its own
backdrop style object).

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
npm run typecheck
npx eslint --cache src/renderer/src/components/ChannelChainPanel.tsx src/renderer/src/components/MasterChainPanel.tsx
```
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ChannelChainPanel.tsx src/renderer/src/components/MasterChainPanel.tsx
git commit -m "ChannelChainPanel + MasterChainPanel: 'edit' -> pencil icon, z-index -> token

Same repeated-per-slot text button, same glyph, in both files (they
already share this panel structure per each file's own doc comment).
Keeps the existing aria-label text as the new title tooltip. zIndex:100
now references the new --ra-z-anchored token."
```

---

### Task 15: `PluginCatalogBrowser.tsx` — "use" -> checkmark icon + disabled-opacity fix

**Files:**
- Modify: `src/renderer/src/components/PluginCatalogBrowser.tsx`

- [ ] **Step 1: Add a local `CheckmarkIcon`**

Near the top of `src/renderer/src/components/PluginCatalogBrowser.tsx` (near its own
`buttonStyle` helper, if one exists in this file — otherwise directly above the exported
component function), add:

```tsx
// Hand-drawn SVG glyph -- no icon library, same convention as
// DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/LockGlyph etc. Direct
// request, 2026-09-16: replace the repeated-per-row "use" text button.
function CheckmarkIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 L6.5 12 L13 4" />
    </svg>
  )
}
```

- [ ] **Step 2: Use it in place of the "use" text**

Find (currently lines 119-129):

```tsx
              <button
                onClick={() => {
                  onSelect(entry.id)
                  onClose()
                }}
                disabled={!loadable}
                aria-label={`use ${entry.name}`}
                style={buttonStyle(!loadable)}
              >
                use
              </button>
```

Replace with:

```tsx
              <button
                onClick={() => {
                  onSelect(entry.id)
                  onClose()
                }}
                disabled={!loadable}
                aria-label={`use ${entry.name}`}
                title={`use ${entry.name}`}
                style={buttonStyle(!loadable)}
              >
                <CheckmarkIcon />
              </button>
```

- [ ] **Step 3: Fix a disabled-opacity value found during this task's own fresh read**

A few lines above the button just edited (currently line 96), this same row-wrapping element
uses `0.5` for its disabled/unloadable state, the same drift pattern Task 3 fixed in
`BeatPicker.tsx` — the design spec's own audit only sampled `BeatPicker.tsx`'s 3 occurrences,
this is a 4th found while re-reading this file fresh. Find:

```tsx
                padding: '4px 0',
                opacity: loadable ? 1 : 0.5
              }}
```

Replace with:

```tsx
                padding: '4px 0',
                opacity: loadable ? 1 : 0.3
              }}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/PluginCatalogBrowser.tsx`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/PluginCatalogBrowser.tsx
git commit -m "PluginCatalogBrowser: 'use' -> checkmark icon, disabled 0.5->0.3

Also fixes a 4th disabled-opacity drift instance (0.5, should be the
app's documented 0.3) found while re-reading this file fresh for the
icon conversion -- the design spec's own audit only sampled
BeatPicker.tsx's 3 occurrences of this same pattern."
```

---

### Task 16: `ProjectLibraryBrowser.tsx` — history/preview/restore icons

**Files:**
- Modify: `src/renderer/src/components/ProjectLibraryBrowser.tsx`

- [ ] **Step 1: Add local `HistoryIcon` and `UndoIcon`**

Near the top of `src/renderer/src/components/ProjectLibraryBrowser.tsx` (near its own
`buttonStyle` helper), add:

```tsx
// Hand-drawn SVG glyphs -- no icon library, same convention as
// DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/LockGlyph etc. Direct
// request, 2026-09-16.
function HistoryIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8.5" r="5.5" />
      <path d="M8 5.5 V8.5 L10.5 10" />
      <path d="M5 1.5 H11" />
    </svg>
  )
}

// Same shape as DiscoverPanel.tsx's own UndoIcon -- re-declared locally
// rather than imported/shared, matching this codebase's own "each file
// hand-rolls its small icon components" convention (no shared component
// library, per the design spec's explicit decision).
function UndoIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 6 H7 a4 4 0 0 0 -4 4 v1" />
      <path d="M5.5 8 l-2.5 2 l2.5 2" />
    </svg>
  )
}
```

- [ ] **Step 2: Convert the "history" button**

Find (currently lines 385-398):

```tsx
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleToggleHistory(sketch.name)
                  }}
                  title="earlier autosaved versions"
                  aria-label={`earlier versions of ${sketch.name}`}
                  style={{
                    ...buttonStyle(),
                    color: historyOpenName === sketch.name ? 'var(--ra-text)' : 'var(--ra-text-2)'
                  }}
                >
                  history
                </button>
```

Replace the button's children only (everything else unchanged):

```tsx
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleToggleHistory(sketch.name)
                  }}
                  title="earlier autosaved versions"
                  aria-label={`earlier versions of ${sketch.name}`}
                  style={{
                    ...buttonStyle(),
                    color: historyOpenName === sketch.name ? 'var(--ra-text)' : 'var(--ra-text-2)'
                  }}
                >
                  <HistoryIcon />
                </button>
```

- [ ] **Step 3: Convert the "preview"/"stop" button**

Find (currently lines 446-466):

```tsx
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handlePreviewClick(sketch.name, backup.path)
                        }}
                        title={
                          previewingPath === backup.path ? 'stop preview' : 'preview (audio only)'
                        }
                        aria-label={
                          previewingPath === backup.path
                            ? `stop preview of ${sketch.name} at ${formatMtime(backup.mtimeMs)}`
                            : `preview ${sketch.name} at ${formatMtime(backup.mtimeMs)}`
                        }
                        style={{
                          ...buttonStyle(),
                          color:
                            previewingPath === backup.path ? 'var(--ra-text)' : 'var(--ra-text-2)'
                        }}
                      >
                        {previewingPath === backup.path ? 'stop' : 'preview'}
                      </button>
```

Replace the last line only (the plain-text ternary becomes the ▶/■ glyphs already used
elsewhere in this app for the same play/stop meaning, e.g. `TransportBar.tsx`'s own transport
button and `DiscoverPanel.tsx`'s own preview play/stop button — reuse that convention rather
than inventing a new one):

```tsx
                        {previewingPath === backup.path ? '■' : '▶'}
                      </button>
```

- [ ] **Step 4: Convert the "restore" default state only (armed "restore?" stays text)**

Find (currently lines 467-485):

```tsx
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRestoreClick(sketch.name, backup.path)
                        }}
                        title={
                          restoreArmedPath === backup.path
                            ? 'click again to restore this version'
                            : 'restore this version'
                        }
                        aria-label={
                          restoreArmedPath === backup.path
                            ? `confirm restore ${sketch.name} to ${formatMtime(backup.mtimeMs)}`
                            : `restore ${sketch.name} to ${formatMtime(backup.mtimeMs)}`
                        }
                        style={buttonStyle()}
                      >
                        {restoreArmedPath === backup.path ? 'restore?' : 'restore'}
                      </button>
```

Replace the last line only, matching this same file's own delete button's established
icon-default/text-confirm pattern (`{deleteArmedName === sketch.name ? 'delete?' : '×'}` a
few dozen lines above):

```tsx
                        {restoreArmedPath === backup.path ? 'restore?' : <UndoIcon />}
                      </button>
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/ProjectLibraryBrowser.tsx`
Expected: both pass. If TypeScript complains about the button's children type (a ternary
returning either a string or a `React.JSX.Element`), that's expected and valid — React allows
`ReactNode` children of either type; if the error is something else, re-check the exact
surrounding JSX wasn't mismatched during the edit.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ProjectLibraryBrowser.tsx
git commit -m "ProjectLibraryBrowser: history/preview/restore -> icons

'history' -> a clock glyph, 'preview'/'stop' -> the same ▶/■ glyphs
already used elsewhere in the app for this exact meaning, and
'restore' (default state only) -> an undo-arrow glyph -- the armed
'restore?' confirm-text state stays as text, matching this file's own
established delete-button icon-default/text-confirm pattern."
```

---

### Task 17: `ClusterStemsBrowser.tsx` — play/stop text drop + "split" -> fork icon + focus fix

**Files:**
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`

This task gained an extra step after Task 2's own code-quality review: Task 2 (global.css)
added an app-wide `:focus-visible { outline: ... }` rule, and the reviewer found that this
file's own `buttonStyle()` helper sets `outline: 'none'` unconditionally on every button it
styles (the close button, ~5 bus-assign buttons, the preview/play button) — silently
overriding the new global rule for this entire file, the same inline-property-wins-over-
stylesheet issue Task 4 already fixes in `EditableText.tsx`. Step 1 below addresses it, since
this task already touches this exact file.

- [ ] **Step 1: Remove `buttonStyle()`'s own `outline: 'none'` override**

Find the current `buttonStyle()` function and its own doc comment (near the top of the file):

```tsx
// See ProjectLibraryBrowser.tsx's own buttonStyle doc comment -- buttons in
// this app have no default chrome, so every button needs an explicit
// dark-theme style or it falls back to near-invisible default control chrome.
//
// Active state reuses ChannelRow.tsx's own solo-button visual language
// (bright near-white border/text vs. dim gray) rather than a background
// swap -- the modal's own panel background is itself var(--ra-bg-row-active),
// so a background-only "active" indicator was blending straight into the
// panel behind it and reading as not-pressed-at-all. outline:none overrides
// the browser's own default focus ring, which was otherwise visually
// indistinguishable from "this bus is assigned" (see 2026-08-05 screenshot
// report: a plain keyboard-focused, UNassigned "aux" button looked "selected"
// purely from the native focus outline).
// state 'confirmed' matches the original boolean `active` meaning exactly
// (this row's own busOf already agrees). 'suggested' is new -- a lighter,
// dashed-border hint for a bus the centroid classifier proposed but the
// user hasn't clicked yet, distinguishable from both "confirmed" and "just
// one of the other four options."
function buttonStyle(state?: 'confirmed' | 'suggested'): React.CSSProperties {
  const confirmed = state === 'confirmed'
  const suggested = state === 'suggested'
  return {
    fontFamily: 'inherit',
    fontSize: 9,
    padding: '3px 8px',
    background: confirmed ? 'var(--ra-stretch-on-bg)' : 'transparent',
    border: `1px ${suggested && !confirmed ? 'dashed' : 'solid'} ${confirmed || suggested ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: confirmed ? 'var(--ra-stretch-on)' : suggested ? 'var(--ra-text)' : 'var(--ra-text-2)',
    fontWeight: confirmed ? 700 : 400,
    cursor: 'pointer',
    outline: 'none'
  }
}
```

Replace with (drops `outline: 'none'` and updates the comment to explain why removing it is
now safe — the 2026-08-05 bug was the browser's own DEFAULT focus ring, typically bright/bold,
reading as visually similar to the bright near-white "confirmed" active-state border; the new
app-wide focus rule (global.css, Task 2) uses a deliberately muted, dim grey
`var(--ra-border-strong)` outline instead, which stays visually distinct from the bright
`var(--ra-stretch-on)` "confirmed" border rather than being confusable with it):

```tsx
// See ProjectLibraryBrowser.tsx's own buttonStyle doc comment -- buttons in
// this app have no default chrome, so every button needs an explicit
// dark-theme style or it falls back to near-invisible default control chrome.
//
// Active state reuses ChannelRow.tsx's own solo-button visual language
// (bright near-white border/text vs. dim gray) rather than a background
// swap -- the modal's own panel background is itself var(--ra-bg-row-active),
// so a background-only "active" indicator was blending straight into the
// panel behind it and reading as not-pressed-at-all.
//
// No outline:none override here (there used to be one -- see 2026-08-05
// screenshot report: a plain keyboard-focused, UNassigned "aux" button
// looked "selected" purely from the BROWSER'S OWN default focus ring,
// which was bright/bold enough to be confusable with the "confirmed"
// active state's own bright near-white border). The app-wide focus rule
// (global.css, added for the 2026-09-16 unified UI consistency pass) uses
// a deliberately dim, muted outline (var(--ra-border-strong)) instead of
// the browser default -- distinct enough from the bright "confirmed"
// border that the original confusability shouldn't reproduce, while still
// giving every button in this file a real focus indicator (which, with
// outline:none, none of them had at all).
//
// state 'confirmed' matches the original boolean `active` meaning exactly
// (this row's own busOf already agrees). 'suggested' is new -- a lighter,
// dashed-border hint for a bus the centroid classifier proposed but the
// user hasn't clicked yet, distinguishable from both "confirmed" and "just
// one of the other four options."
function buttonStyle(state?: 'confirmed' | 'suggested'): React.CSSProperties {
  const confirmed = state === 'confirmed'
  const suggested = state === 'suggested'
  return {
    fontFamily: 'inherit',
    fontSize: 9,
    padding: '3px 8px',
    background: confirmed ? 'var(--ra-stretch-on-bg)' : 'transparent',
    border: `1px ${suggested && !confirmed ? 'dashed' : 'solid'} ${confirmed || suggested ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: confirmed ? 'var(--ra-stretch-on)' : suggested ? 'var(--ra-text)' : 'var(--ra-text-2)',
    fontWeight: confirmed ? 700 : 400,
    cursor: 'pointer'
  }
}
```

This is a real, deliberate judgment call (removing a documented workaround because the
condition that motivated it no longer applies), not a mechanical token swap — flag it in the
implementer's own report and in the task's commit message so it's easy to find and revert if
Elling's own manual walkthrough (Task 23) finds the new focus ring IS still confusable with the
"confirmed" state on this file specifically.

- [ ] **Step 2: Add a local `ForkIcon`**

Near the top of `src/renderer/src/components/ClusterStemsBrowser.tsx` (near its own
`buttonStyle` helper), add:

```tsx
// Hand-drawn SVG glyph -- no icon library, same convention as
// DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/LockGlyph etc. Direct
// request, 2026-09-16: replace the "split" text button.
function ForkIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2 V7" />
      <path d="M8 7 L3.5 13" />
      <path d="M8 7 L12.5 13" />
    </svg>
  )
}
```

- [ ] **Step 3: Drop the redundant text next to the existing ▶/■ glyph**

Find (currently lines 1017-1026):

```tsx
        <button
          onClick={onPlay}
          style={{
            ...buttonStyle(rowIsPreviewing && playing ? 'confirmed' : undefined),
            whiteSpace: 'nowrap'
          }}
          title="solo + play this whole cluster, from its own earliest clip"
        >
          {rowIsPreviewing && playing ? '■ playing' : '▶ play'}
        </button>
```

Replace the last line only (the icon's already there — the trailing word is redundant, same
fix already applied to `DiscoverPanel.tsx`'s own play button earlier this session):

```tsx
          {rowIsPreviewing && playing ? '■' : '▶'}
        </button>
```

- [ ] **Step 4: Convert the "split" button**

Find (currently lines 1039-1047):

```tsx
        {members.length > 1 && splittable && (
          <button
            onClick={onSplit}
            style={{ ...buttonStyle(), whiteSpace: 'nowrap' }}
            title="split this cluster into its two closest sub-groups"
          >
            split
          </button>
        )}
```

Replace the last line only:

```tsx
        {members.length > 1 && splittable && (
          <button
            onClick={onSplit}
            style={{ ...buttonStyle(), whiteSpace: 'nowrap' }}
            title="split this cluster into its two closest sub-groups"
          >
            <ForkIcon />
          </button>
        )}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/ClusterStemsBrowser.tsx`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ClusterStemsBrowser.tsx
git commit -m "ClusterStemsBrowser: drop redundant play/stop text, split -> fork icon

The play/stop button already showed its own glyph next to the word --
the word was redundant. 'split' becomes a diverging-arrows icon,
keeping its existing title as the tooltip. Also removes buttonStyle()'s
own outline:none override (found by Task 2's code-quality review): it
was silently swallowing the new app-wide focus-visible outline rule.
The 2026-08-05 bug that override was originally added for was about the
BROWSER'S OWN bright default focus ring being confusable with the
bright 'confirmed' active-state border -- the new rule's own muted,
dim outline shouldn't reproduce that confusion, but this is a judgment
call worth Elling's own eyes during the Task 23 walkthrough."
```

---

### Task 18: `DiscoverNearbyPopover.tsx` — "back to start" -> rewind icon

**Files:**
- Modify: `src/renderer/src/components/DiscoverNearbyPopover.tsx`

- [ ] **Step 1: Add a local `RewindIcon`**

Near the top of `src/renderer/src/components/DiscoverNearbyPopover.tsx` (before the exported
`DiscoverNearbyPopover` function, alongside its own local component helpers), add:

```tsx
// Hand-drawn SVG glyph -- no icon library, same convention as
// DiscoverPanel.tsx's own DiceIcon/ShuffleIcon/LockGlyph etc. Direct
// request, 2026-09-16: replace the "back to start" text button.
function RewindIcon(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <rect x="2" y="3" width="1.6" height="10" />
      <path d="M13.5 3 L13.5 13 L5.5 8 Z" />
    </svg>
  )
}
```

- [ ] **Step 2: Use it in place of the "back to start" text**

Find (this popover's own header row):

```tsx
        <button
          onClick={() => handlePick(startCandidate)}
          disabled={atStart}
          title="back to the riff this slot started with"
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            padding: '2px 6px',
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: atStart ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: atStart ? 'default' : 'pointer'
          }}
        >
          back to start
        </button>
```

Replace with (`display:flex/alignItems:center` added so the icon centers correctly inside a
button whose padding was tuned for a text label; everything else unchanged):

```tsx
        <button
          onClick={() => handlePick(startCandidate)}
          disabled={atStart}
          title="back to the riff this slot started with"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            fontSize: 9,
            padding: '3px 6px',
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: atStart ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: atStart ? 'default' : 'pointer'
          }}
        >
          <RewindIcon />
        </button>
```

- [ ] **Step 3: Swap the z-index literal**

Find (this popover's own outer `style` object, currently line 243):

```tsx
        zIndex: 1200,
```

Replace with:

```tsx
        zIndex: 'var(--ra-z-fullscreen-popover)',
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/DiscoverNearbyPopover.tsx`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverNearbyPopover.tsx
git commit -m "DiscoverNearbyPopover: 'back to start' -> rewind icon, z-index -> token

Keeps its existing title as the tooltip. Sits in the same small
popover as the already-icon </> step buttons. zIndex:1200 now
references the new --ra-z-fullscreen-popover token."
```

---

### Task 19: `DiscoverPanel.tsx` — drop redundant "reroll all" text

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Drop the text next to the existing `ShuffleIcon`, add a `title`**

Find (currently lines 1646-1665):

```tsx
        <button
          onClick={() => void rerollAll()}
          disabled={rerollingSlotIds.size > 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'inherit',
            fontSize: 9,
            padding: '4px 10px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: rerollingSlotIds.size > 0 ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: rerollingSlotIds.size > 0 ? 'default' : 'pointer'
          }}
        >
          {rerollingSlotIds.size > 0 ? <LoadingLoader size={11} /> : <ShuffleIcon />}
          {rerollingSlotIds.size > 0 ? 'rerolling…' : 'reroll all'}
        </button>
```

Replace with (this button has no `title` today — unlike the per-slot reroll button it mirrors,
which already went icon-only with one — so add it here too, otherwise the icon-only version
would lose its only remaining explanation):

```tsx
        <button
          onClick={() => void rerollAll()}
          disabled={rerollingSlotIds.size > 0}
          title={rerollingSlotIds.size > 0 ? 'rerolling…' : 'reroll all'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'inherit',
            fontSize: 9,
            padding: '4px 10px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: rerollingSlotIds.size > 0 ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: rerollingSlotIds.size > 0 ? 'default' : 'pointer'
          }}
        >
          {rerollingSlotIds.size > 0 ? <LoadingLoader size={11} /> : <ShuffleIcon />}
        </button>
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "DiscoverPanel: drop redundant 'reroll all' text next to its icon

Its own per-slot sibling reroll button already went icon-only earlier
this session -- this was the one inconsistent holdout in the same
panel. Adds a title tooltip, which this button never had before."
```

---

### Task 20: `LibraryBrowser.tsx` — "close" -> ×

**Files:**
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

- [ ] **Step 1: Replace the text with the same × character already used elsewhere in the app**

Find (currently lines 1578-1591):

```tsx
          <button
            onClick={onClose}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            close
          </button>
```

Replace with (a plain `×` character, not a new SVG — this matches the exact convention already
used for the same "close" meaning in `ChannelChainPanel.tsx`, `MasterChainPanel.tsx`,
`ClusterStemsBrowser.tsx`'s own delete button, `PluginCatalogBrowser.tsx`, and
`ProjectLibraryBrowser.tsx`'s own delete button — no new icon needed here):

```tsx
          <button
            onClick={onClose}
            title="close"
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            ×
          </button>
```

- [ ] **Step 2: Swap this screen's own z-index literal**

`LibraryBrowser.tsx`'s own full-screen modal (its opaque `var(--ra-bg-page)` backdrop is
deliberate, documented in this file's own comment a few lines above — leave that alone, only
the z-index is drift) currently has, at line 1521:

```tsx
        zIndex: 1000
```

Replace with:

```tsx
        zIndex: 'var(--ra-z-fullscreen)'
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/LibraryBrowser.tsx`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/LibraryBrowser.tsx
git commit -m "LibraryBrowser: 'close' -> ×, z-index -> token

Plain × character, not a new icon -- 5 other files already use exactly
this for the same 'close' meaning. This screen's own deliberate opaque
backdrop is untouched (documented as intentional in this file's own
comment) -- only its zIndex:1000 now references --ra-z-fullscreen."
```

---

### Task 21: `Shelf.tsx` — spacing fix

**Files:**
- Modify: `src/renderer/src/components/Shelf.tsx`

- [ ] **Step 1: Snap the one off-scale padding value to the token scale**

Find (currently line 292):

```tsx
        padding: '11px 14px',
```

Replace with:

```tsx
        padding: '12px 14px',
```

(`11` isn't on the `--ra-s-*` scale; the nearest values are `10`/`12` — `12` matches the
existing `14` on the other axis more closely, and the visual difference from `11` is
imperceptible.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/Shelf.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Shelf.tsx
git commit -m "Shelf: snap one off-scale padding value (11px -> 12px) to the token scale"
```

---

### Task 22: `ContextMenu.tsx` + `BusyOverlay.tsx` — remaining z-index token swaps

**Files:**
- Modify: `src/renderer/src/components/ContextMenu.tsx`
- Modify: `src/renderer/src/components/BusyOverlay.tsx`

Depends on Task 1. Neither file needs an icon or modal-shape change — this is purely the last
two z-index literals from the spec's own token-swap table that no other task already touches.

- [ ] **Step 1: `ContextMenu.tsx`**

Find (currently line 105):

```tsx
        zIndex: 20,
```

Replace with:

```tsx
        zIndex: 'var(--ra-z-anchored)',
```

- [ ] **Step 2: `BusyOverlay.tsx`**

Find (currently line 18):

```tsx
        zIndex: 1000,
```

Replace with:

```tsx
        zIndex: 'var(--ra-z-fullscreen)',
```

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
npm run typecheck
npx eslint --cache src/renderer/src/components/ContextMenu.tsx src/renderer/src/components/BusyOverlay.tsx
```
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ContextMenu.tsx src/renderer/src/components/BusyOverlay.tsx
git commit -m "ContextMenu + BusyOverlay: z-index literals -> tokens

The last two of the 7 previously undocumented ad hoc z-index values --
20 and 1000 -- now reference --ra-z-anchored and --ra-z-fullscreen."
```

---

### Task 23: Final verification + manual walkthrough checklist

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: every existing test still passes (this plan added no new tests — it's CSS/JSX
styling work with no new pure logic). If anything fails, it means one of the 22 tasks above
broke something unrelated — investigate that specific failure before considering this plan
done, don't just re-run and hope.

- [ ] **Step 2: Full typecheck + lint sweep**

Run:
```bash
npm run typecheck
npx eslint --cache .
```
Expected: both clean. Each task already verified its own touched files individually — this is
the final, whole-repo confirmation that nothing was missed.

- [ ] **Step 3: Hand this checklist to Elling**

This environment has no GUI/audio tooling, so nothing above can confirm the actual *look* of
any of this. Elling needs to run `npm run dev` and manually check:

- **Modals** (`NewProjectModal`, `TidyUpNudgeModal`, `ExportFormatPicker`, `StemsFormatPicker`,
  `AudioDeviceModal`, `LibraryLocationModal`): open each one — do they look right (no separate
  eyebrow header, lighter border, same backdrop darkness as e.g. the "unsaved changes" dialog)?
  Does clicking OUTSIDE any of them correctly do nothing now (previously some dismissed, or in
  `TidyUpNudgeModal`'s case, silently exported anyway)? Do `ExportFormatPicker`/
  `StemsFormatPicker` now have a working "cancel" button? Does `LibraryLocationModal`'s primary
  button ("use this folder") now sit on the right?
- **`OnboardingModal`**: confirm it still looks the way it did before (deliberately mostly
  unchanged — only backdrop/z-index moved to tokens).
- **Hover**: hover over a handful of buttons/tiles across a few different screens (Shelf tiles,
  transport bar buttons, a Discover slot's icon row, a modal's own buttons) — do they visibly
  brighten? Does it look right layered on top of Shelf's own existing tile-lit behavior, or does
  it look like double emphasis?
- **Focus**: Tab through a form (e.g. `NewProjectModal`'s name field, then its buttons) — does
  each focused control show a visible grey outline? Specifically also tab through
  `ClusterStemsBrowser.tsx`'s own bus-assign buttons (Tidy Up flow) — Task 17 removed a
  deliberate `outline: 'none'` there (added 2026-08-05 because the browser's own default focus
  ring was confusable with the "confirmed" active-state border) on the theory that the new,
  more muted focus outline won't reproduce that confusion. Confirm a keyboard-focused,
  UNASSIGNED bus button still reads clearly as "focused, not assigned" — not as if it were
  already confirmed.
- **Icon buttons**: hover each of these and confirm the tooltip reads correctly and the glyph
  is recognizable at a glance: `TransportBar`'s link/envelope/fx-on-main/+rec-channel,
  `ChannelChainPanel`/`MasterChainPanel`'s edit (pencil), `PluginCatalogBrowser`'s use
  (checkmark), `ProjectLibraryBrowser`'s history (clock) / preview (▶/■) / restore (undo
  arrow), `ClusterStemsBrowser`'s split (fork), `DiscoverNearbyPopover`'s back-to-start
  (rewind), `DiscoverPanel`'s reroll-all (no more redundant text), `LibraryBrowser`'s close
  (×). None of these glyphs were pixel-verified from this environment — if any reads
  ambiguous or ugly at real size, that's expected feedback to act on, not a sign something
  broke.

Report back whichever of these don't look/behave right, and this plan's work can be corrected
in a fast follow-up rather than needing to re-plan from scratch.
