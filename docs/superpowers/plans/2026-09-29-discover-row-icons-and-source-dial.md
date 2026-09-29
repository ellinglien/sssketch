# Discover row icons, split radio flags, and source dial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Discover's one three-state radio flag button into "hold longer" and "change next", turn the row's four text buttons into Phosphor icons, and replace the endlesss/other sound switches with a 0–100 source dial.

**Architecture:** All new logic is pure and lives in `src/shared/` (two flag toggles in `radioSlotFlags.ts`, a per-roll source draw in `discoverSlotModifier.ts`), built test-first and added *before* anything is removed. The UI work is confined to `DiscoverPanel.tsx`. No main-process, engine, preload, or phone changes: the dial draws a single-source filter per roll and hands it to the IPC calls that already exist.

**Tech Stack:** TypeScript, React 19, vitest, `@phosphor-icons/react` (new).

**Spec:** `docs/superpowers/specs/2026-09-29-discover-row-icons-and-source-dial-design.md`

---

## Ground rules for whoever executes this

- **Read `CLAUDE.md` first.** Design rules are strict: monochrome chrome, no `border-radius`, lowercase copy, tooltips 2–3 words.
- **Stage explicit paths, never `git add -A`.** Other agents may be working in this tree.
- **`DiscoverPanel.tsx` is ~7,500 lines.** Line numbers below are as of `50b2392` and will drift. Anchor on the quoted code, not the number.
- **Order matters.** Tasks 1–3 are additive only. `cycleRadioSlotFlag` and the `'endlesss' | 'other'` modifiers are removed only in Tasks 4 and 5, in the same task that rewires every caller. That keeps typecheck green after every commit.
- **After every task:** `npm run typecheck` and `npx vitest run` must pass. Lint: `npx eslint <changed files>` must show 0 errors and no new warnings. The repo baseline is exactly 4 pre-existing prettier warnings (`npm run lint`).
- **No agent can see or click the app.** Tasks 4 and 5 end with a manual check that must be handed to Elling, not claimed.

---

## File map

| file | change |
|---|---|
| `src/shared/radioSlotFlags.ts` | add `toggleRadioHook`, `toggleRadioReplaceSoon` (Task 1); remove `cycleRadioSlotFlag` (Task 4) |
| `src/shared/radioSlotFlags.test.ts` | tests for the toggles (Task 1); old cycle tests rewritten against the toggles (Task 4) |
| `src/shared/discoverSlotModifier.ts` | add `drawSoundSource`, `soundSourceForLean` (Task 2); drop `'endlesss' \| 'other'` and `soundSource` (Task 5) |
| `src/shared/discoverSlotModifier.test.ts` | tests for the draw (Task 2); source-switch tests removed (Task 5) |
| `package.json`, `package-lock.json` | add `@phosphor-icons/react` (Task 3) |
| `src/renderer/src/components/DiscoverPanel.tsx` | row controls and grid (Task 4); dial and roll wiring (Task 5) |

---

### Task 1: Two flag toggles (additive)

**Files:**
- Modify: `src/shared/radioSlotFlags.ts` (add after `radioHookSlotId`, before the `cycleRadioSlotFlag` doc comment)
- Test: `src/shared/radioSlotFlags.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/shared/radioSlotFlags.test.ts`, add `toggleRadioHook` and `toggleRadioReplaceSoon` to the import list from `'./radioSlotFlags'`. Then append at the end of the file:

```ts
describe('toggleRadioHook', () => {
  it('turns the hook on, and off again', () => {
    const on = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(on, 'a')).toBe('hook')
    expect(radioSlotFlagOf(toggleRadioHook(on, 'a'), 'a')).toBeNull()
  })

  it('moves the hook -- two centres is no centre', () => {
    const first = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    const second = toggleRadioHook(first, 'b')
    expect(radioSlotFlagOf(second, 'a')).toBeNull()
    expect(radioHookSlotId(second)).toBe('b')
  })

  it('replaces replace-soon on the same row', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(toggleRadioHook(tired, 'a'), 'a')).toBe('hook')
  })

  it('leaves replace-soon on other rows alone', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'b')
    expect(radioSlotFlagOf(toggleRadioHook(tired, 'a'), 'b')).toBe('replace-soon')
  })

  it('never mutates what it is given', () => {
    const before = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    toggleRadioHook(before, 'b')
    expect(radioSlotFlagOf(before, 'a')).toBe('hook')
  })
})

describe('toggleRadioReplaceSoon', () => {
  it('turns replace-soon on, and off again', () => {
    const on = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(on, 'a')).toBe('replace-soon')
    expect(radioSlotFlagOf(toggleRadioReplaceSoon(on, 'a'), 'a')).toBeNull()
  })

  it('can be on for any number of rows', () => {
    let flags = NO_RADIO_SLOT_FLAGS
    for (const id of ['a', 'b', 'c']) flags = toggleRadioReplaceSoon(flags, id)
    for (const id of ['a', 'b', 'c']) expect(radioSlotFlagOf(flags, id)).toBe('replace-soon')
  })

  it('replaces the hook on the same row', () => {
    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    const tired = toggleRadioReplaceSoon(hooked, 'a')
    expect(radioSlotFlagOf(tired, 'a')).toBe('replace-soon')
    expect(radioHookSlotId(tired)).toBeNull()
  })

  it('never costs the hook on another row', () => {
    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioHookSlotId(toggleRadioReplaceSoon(hooked, 'b'))).toBe('a')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/radioSlotFlags.test.ts`
Expected: FAIL. `toggleRadioHook` / `toggleRadioReplaceSoon` are not exported.

- [ ] **Step 3: Implement**

In `src/shared/radioSlotFlags.ts`, insert directly after the `radioHookSlotId` function:

```ts
/** The row's "hold longer" control: hook this slot, or release it.
 *
 * AT MOST ONE HOOK. Two hooks is two centres, which is no centre, so
 * hooking this slot releases any hook on another -- the way a radio button
 * does. That release is visible: every row is on screen, and the other
 * row's hand goes dark in the same render. (The old single cycle button
 * could reach this state by accident on its way somewhere else; two
 * separate controls cannot.)
 *
 * One flag per slot, so hooking a slot that was marked replace-soon
 * replaces that mark. Replace-soon on OTHER slots is untouched. */
export function toggleRadioHook(flags: RadioSlotFlags, id: string): RadioSlotFlags {
  const turningOn = flags[id] !== 'hook'
  const out: Record<string, RadioSlotFlag> = {}
  for (const [otherId, flag] of Object.entries(flags)) {
    if (otherId === id) continue
    if (turningOn && flag === 'hook') continue
    out[otherId] = flag
  }
  if (turningOn) out[id] = 'hook'
  return out
}

/** The row's "change next" control: mark this slot to be replaced soon,
 * or unmark it.
 *
 * NOT at-most-one. Replace-soon makes no claim about the track's
 * structure; being tired of three layers at once is an ordinary thing to
 * be, and making it exclusive would mean flagging a second layer silently
 * unflags the first. It never touches another slot's flag of either kind.
 *
 * One flag per slot, so marking a hooked slot replaces its hook. */
export function toggleRadioReplaceSoon(flags: RadioSlotFlags, id: string): RadioSlotFlags {
  const out: Record<string, RadioSlotFlag> = {}
  for (const [otherId, flag] of Object.entries(flags)) if (otherId !== id) out[otherId] = flag
  if (flags[id] !== 'replace-soon') out[id] = 'replace-soon'
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/radioSlotFlags.test.ts`
Expected: PASS, all tests including the existing `cycleRadioSlotFlag` ones.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSlotFlags.ts src/shared/radioSlotFlags.test.ts
git commit -m "hold longer and change next can each be said on their own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The per-roll source draw (additive)

**Files:**
- Modify: `src/shared/discoverSlotModifier.ts` (append at end of file)
- Test: `src/shared/discoverSlotModifier.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/shared/discoverSlotModifier.test.ts`, add `drawSoundSource` and `soundSourceForLean` to the import list from `'./discoverSlotModifier'`. Then append:

```ts
const ENDLESSS_ONLY = { endlesss: true, audioIn: false }
const OTHER_ONLY = { endlesss: false, audioIn: true }

describe('drawSoundSource', () => {
  it('is always endlesss, with no fallback, at 0', () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(drawSoundSource(0, () => r)).toEqual({ first: ENDLESSS_ONLY, fallback: null })
    }
  })

  it('is always other, with no fallback, at 100', () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(drawSoundSource(100, () => r)).toEqual({ first: OTHER_ONLY, fallback: null })
    }
  })

  it('draws other with probability lean/100, and falls back to the other source', () => {
    expect(drawSoundSource(30, () => 0.29)).toEqual({ first: OTHER_ONLY, fallback: ENDLESSS_ONLY })
    expect(drawSoundSource(30, () => 0.3)).toEqual({ first: ENDLESSS_ONLY, fallback: OTHER_ONLY })
  })

  it('is half and half at the middle', () => {
    let other = 0
    const n = 1000
    for (let i = 0; i < n; i++) {
      // An even walk over [0, 1) -- deterministic, no seed library needed.
      if (drawSoundSource(50, () => (i + 0.5) / n).first.audioIn) other++
    }
    expect(other).toBe(n / 2)
  })

  it('clamps a value outside 0-100 to the nearest end', () => {
    expect(drawSoundSource(-5, () => 0).fallback).toBeNull()
    expect(drawSoundSource(140, () => 0.99).first).toEqual(OTHER_ONLY)
  })
})

describe('soundSourceForLean', () => {
  it('is one source at each end, and both in between', () => {
    expect(soundSourceForLean(0)).toEqual(ENDLESSS_ONLY)
    expect(soundSourceForLean(100)).toEqual(OTHER_ONLY)
    expect(soundSourceForLean(1)).toEqual({ endlesss: true, audioIn: true })
    expect(soundSourceForLean(50)).toEqual({ endlesss: true, audioIn: true })
    expect(soundSourceForLean(99)).toEqual({ endlesss: true, audioIn: true })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/discoverSlotModifier.test.ts`
Expected: FAIL. `drawSoundSource` / `soundSourceForLean` are not exported.

- [ ] **Step 3: Implement**

Append to `src/shared/discoverSlotModifier.ts`:

```ts
/** The source dial's two ends. 0 is endlesss, 100 is other. */
export const SOURCE_LEAN_ENDLESSS = 0
export const SOURCE_LEAN_OTHER = 100
export const DEFAULT_SOURCE_LEAN = 50

const ENDLESSS_ONLY: DiscoverSoundSourceFilter = { endlesss: true, audioIn: false }
const OTHER_ONLY: DiscoverSoundSourceFilter = { endlesss: false, audioIn: true }

function clampLean(lean: number): number {
  return Math.min(SOURCE_LEAN_OTHER, Math.max(SOURCE_LEAN_ENDLESSS, lean))
}

/** Which source ONE roll asks for, given the dial.
 *
 * Drawn per roll, before the candidate query, so the existing single-source
 * filter does all the real work and nothing in the main process changes.
 * `other` with probability lean/100: the middle is half and half whatever
 * the library holds (Elling, 2026-09-29, chose that over "library
 * proportion").
 *
 * The ends are HARD -- only that source, no fallback -- because an end
 * means "only". Anywhere in between, `fallback` is the other source, for
 * the caller to try when the drawn one has nothing for this slot: a kind
 * with no audio-in stems (common for bass) must never fail a roll because
 * the dial leaned the other way. */
export function drawSoundSource(
  lean: number,
  random: () => number = Math.random
): { first: DiscoverSoundSourceFilter; fallback: DiscoverSoundSourceFilter | null } {
  const l = clampLean(lean)
  if (l <= SOURCE_LEAN_ENDLESSS) return { first: ENDLESSS_ONLY, fallback: null }
  if (l >= SOURCE_LEAN_OTHER) return { first: OTHER_ONLY, fallback: null }
  return random() < l / 100
    ? { first: OTHER_ONLY, fallback: ENDLESSS_ONLY }
    : { first: ENDLESSS_ONLY, fallback: OTHER_ONLY }
}

/** The dial as a plain filter, for the one place that browses rather than
 * rolls -- the nearby-jam popover lists stems, it does not draw one. One
 * source at an end, both in between. */
export function soundSourceForLean(lean: number): DiscoverSoundSourceFilter {
  const l = clampLean(lean)
  if (l <= SOURCE_LEAN_ENDLESSS) return ENDLESSS_ONLY
  if (l >= SOURCE_LEAN_OTHER) return OTHER_ONLY
  return { endlesss: true, audioIn: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/discoverSlotModifier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/discoverSlotModifier.ts src/shared/discoverSlotModifier.test.ts
git commit -m "a roll can draw its source from a lean instead of two switches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Add the Phosphor package

**Files:**
- Modify: `package.json`, `package-lock.json`

`react` sits in `devDependencies` here, because the renderer is bundled by electron-vite and nothing
from it needs to ship in the app's `node_modules`. The icons follow the same rule.

- [ ] **Step 1: Install**

Run: `npm install --save-dev @phosphor-icons/react`
Expected: `package.json` gains `"@phosphor-icons/react"` under `devDependencies`.

- [ ] **Step 2: Confirm the six icons exist under these names**

Run:
```bash
node --input-type=module -e "const p = await import('@phosphor-icons/react'); for (const n of ['HandPalm','SignOut','CirclesThree','Compass','Shuffle','Copy']) console.log(n, typeof p[n])"
```
Expected: six lines, each ending `object` or `function`. (The package is ESM-only: a `require()` returns an empty object and would wrongly report every icon `undefined`.) If any says `undefined`, stop and report the missing name rather than substituting another icon.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (nothing imports it yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "phosphor icons, as a package rather than copied by hand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The row — two radio controls, icon buttons, wider waveform

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Modify: `src/shared/radioSlotFlags.ts` (remove `cycleRadioSlotFlag`)
- Modify: `src/shared/radioSlotFlags.test.ts` (rewrite the cycle-based tests)

This task removes `cycleRadioSlotFlag`. Its only caller outside tests is `DiscoverPanel.tsx`
(`grep -rn cycleRadioSlotFlag src` confirms this before you start), so both change here together.

- [ ] **Step 1: A small icon-button component**

In `DiscoverPanel.tsx`, add a new component directly after `function StarIcon(...)` (around line 5954). It is the one style every new 18px square shares:

```tsx
/** One 18px square on a Discover row. Every new control on the row
 * (2026-09-29, docs/superpowers/specs/2026-09-29-discover-row-icons-and-
 * source-dial-design.md) is one of these, so the states cannot drift
 * between buttons:
 *
 *   `on`: the padlock's own treatment, an inverted fill -- "hold longer".
 *   `soft`: lit but outlined -- "change next", a request that is spent on
 *     the next change and then gone.
 *   `pulsing`: the reroll this button started is still in flight.
 *
 * Monochrome in every state, per tokens.css: colour on this row is for
 * audio only. */
function RowIconButton({
  gridColumn,
  tooltip,
  onClick,
  children,
  state = 'off',
  disabled = false,
  pulsing = false,
  hidden = false,
  buttonRef
}: {
  gridColumn: number
  tooltip: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
  state?: 'off' | 'on' | 'soft'
  disabled?: boolean
  pulsing?: boolean
  hidden?: boolean
  buttonRef?: React.Ref<HTMLButtonElement>
}): React.JSX.Element {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled || hidden}
      data-tooltip={tooltip}
      aria-label={tooltip}
      aria-pressed={state === 'off' ? undefined : true}
      style={{
        gridColumn,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        visibility: hidden ? 'hidden' : 'visible',
        pointerEvents: hidden ? 'none' : 'auto',
        background:
          state === 'on'
            ? 'var(--ra-text)'
            : state === 'soft'
              ? 'var(--ra-bg-row-active)'
              : 'transparent',
        border: `1px solid ${state === 'off' ? 'var(--ra-border)' : 'var(--ra-text)'}`,
        color: disabled
          ? 'var(--ra-text-4)'
          : state === 'on'
            ? 'var(--ra-bg)'
            : state === 'soft'
              ? 'var(--ra-text)'
              : 'var(--ra-text-2)',
        cursor: disabled ? 'default' : 'pointer',
        animation: pulsing ? 'discover-slot-pulse 900ms ease-in-out infinite' : undefined
      }}
    >
      {children}
    </button>
  )
}
```

Add the icon imports next to the other imports at the top of the file:

```ts
import { CirclesThree, Compass, Copy, HandPalm, Shuffle, SignOut } from '@phosphor-icons/react'
```

- [ ] **Step 2: Replace the row's props**

In the `DiscoverSlotRow` props type, replace:

```ts
  onCycleRadioFlag: () => void
```

with:

```ts
  /** The "hold longer" control -- toggles `hook` on this row
   * (toggleRadioHook). */
  onToggleHook: () => void
  /** The "change next" control -- toggles `replace-soon` on this row
   * (toggleRadioReplaceSoon). */
  onToggleReplaceSoon: () => void
```

In the destructuring list, replace `onCycleRadioFlag,` with `onToggleHook,` and `onToggleReplaceSoon,`.

- [ ] **Step 3: Replace the panel's handler and the call site**

Replace the whole `cycleSlotFlag` function and its doc comment (search `function cycleSlotFlag`) with:

```ts
  /** The row's two radio controls. Undo deliberately does not cover them,
   * the same way it does not cover the padlock or mute: they are a
   * statement about what radio should do next, not an edit to the loop. */
  function toggleSlotHook(id: string): void {
    setRadioSlotFlags((prev) => toggleRadioHook(prev, id))
  }
  function toggleSlotReplaceSoon(id: string): void {
    setRadioSlotFlags((prev) => toggleRadioReplaceSoon(prev, id))
  }
```

At the `<DiscoverSlotRow` call site, replace:

```tsx
            onCycleRadioFlag={() => cycleSlotFlag(slot.id)}
```

with:

```tsx
            onToggleHook={() => toggleSlotHook(slot.id)}
            onToggleReplaceSoon={() => toggleSlotReplaceSoon(slot.id)}
```

In the `@shared/radioSlotFlags` import list at the top of the file, replace `cycleRadioSlotFlag,` with `toggleRadioHook,` and `toggleRadioReplaceSoon,` (keep alphabetical order with the neighbouring names).

- [ ] **Step 4: Replace the grid tracks**

Find the row's `gridTemplateColumns` (search `'18px 18px 18px 18px 18px 18px 1fr 14px 110px 14px 16px 70px 70px 70px 70px'`) and replace that string with:

```ts
            '18px 18px 18px 18px 18px 18px 1fr 14px 110px 14px 18px 1px 18px 18px 18px 18px',
```

Append one paragraph to the long comment directly above it:

```ts
          // 2026-09-29, the icon row: tracks 12-15 were four 70px text
          // buttons and are now four 18px squares (13-16), with "change
          // next" in track 11 (was the 16px decorative dice) and a 1px
          // divider in 12. Every track stays a FIXED width, for the reason
          // above; only the 1fr waveform grows.
```

The tracks are now:

| track | content |
|---|---|
| 1–5 | x, lock, m, s, star (unchanged) |
| 6 | hold longer |
| 7 | waveform (1fr) |
| 8 | spacer |
| 9 | kind label + meter |
| 10 | spacer |
| 11 | change next |
| 12 | divider |
| 13 | same kind |
| 14 | nearby jam |
| 15 | any stem |
| 16 | duplicate |

- [ ] **Step 5: Replace the old flag button with "hold longer"**

Delete the whole old flag control: the `{/* RADIO'S ONE GESTURE. ... */}` comment block and the `<button onClick={onCycleRadioFlag} ...>...</button>` that follows it (it ends with the `{radioFlag === 'hook' ? 'h' : ...}` line and `</button>`). Put this in its place:

```tsx
        {/* HOLD LONGER -- radio's hook, next to the padlock because both say
            "keep this". The difference is one line: the padlock is never,
            the hook is rarely (about 2.5x as long, see HOOK_HOLD_FACTOR).
            A padlocked row greys it out, since radio already skips locked
            rows; the stored flag is kept, so unlocking restores it.
            RENDERED ALWAYS, hidden with `visibility` while radio is off --
            a conditionally-rendered child in this grid is the bug the
            gridTemplateColumns comment above describes. Split from the old
            three-state cycle button on 2026-09-29; see the spec. */}
        <RowIconButton
          gridColumn={6}
          tooltip="hold longer"
          onClick={onToggleHook}
          state={radioFlag === 'hook' ? 'on' : 'off'}
          disabled={slot.locked}
          hidden={!radioOn}
        >
          <HandPalm size={12} />
        </RowIconButton>
```

- [ ] **Step 6: Replace the decorative dice and the four text buttons**

Find the block that starts with the comment `{/* Purely decorative -- direct request, 2026-09-17: "place a dice` and ends with the `duplicate` button's closing `</button>` (just before the row's closing `</div>` and `{nearbyMenu && nearbyAnchor !== null && (`). Replace that whole range with:

```tsx
        {/* CHANGE NEXT -- radio's replace-soon, on this side because it
            means "replace this", like the four buttons after it, just on
            radio's clock instead of now. Same visibility and padlock rules
            as hold longer. */}
        <RowIconButton
          gridColumn={11}
          tooltip="change next"
          onClick={onToggleReplaceSoon}
          state={radioFlag === 'replace-soon' ? 'soft' : 'off'}
          disabled={slot.locked}
          hidden={!radioOn}
        >
          <SignOut size={12} />
        </RowIconButton>
        <div
          style={{ gridColumn: 12, width: 1, height: 18, background: 'var(--ra-border)' }}
        />
        {/* The four rerolls, as icons (2026-09-29). The decorative dice that
            used to sit here and spin while a roll was in flight is gone:
            the button that STARTED the roll pulses instead, and the others
            dim, which says the same thing about the right button. */}
        <RowIconButton
          gridColumn={13}
          tooltip="same kind"
          onClick={() => {
            setRerollAction('similar')
            onReroll()
          }}
          disabled={rerolling}
          pulsing={rerolling && rerollAction === 'similar'}
        >
          <CirclesThree size={12} />
        </RowIconButton>
        {nearbyAnchor !== null && (
          <RowIconButton
            gridColumn={14}
            tooltip="nearby jam"
            buttonRef={nearbyButtonRef}
            onClick={(e) => {
              if (nearbyMenu) {
                closeNearbyMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setNearbyMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            state={nearbyMenu ? 'soft' : 'off'}
            disabled={rerolling}
          >
            <Compass size={12} />
          </RowIconButton>
        )}
        <RowIconButton
          gridColumn={15}
          tooltip="any stem"
          onClick={() => {
            setRerollAction('random')
            onRerollRandom()
          }}
          disabled={rerolling}
          pulsing={rerolling && rerollAction === 'random'}
        >
          <Shuffle size={12} />
        </RowIconButton>
        <RowIconButton gridColumn={16} tooltip="duplicate" onClick={onDuplicate}>
          <Copy size={12} />
        </RowIconButton>
```

Note two deliberate changes from the old buttons:
- **nearby jam** used to be tinted `--ra-stretch-on` while its menu was open. That is colour on chrome, which the spec rules out, so it now uses the monochrome `soft` state.
- **nearby jam** is now disabled during a reroll, like its two siblings. The old button was not.

- [ ] **Step 7: Track which reroll the row started**

Inside `DiscoverSlotRow`, next to its other `useState` calls (for example right after the `resolved` state), add:

```tsx
  // Which of this row's own reroll buttons started the roll in flight, so
  // that one pulses and the others only dim. A roll started from anywhere
  // else (radio, the phone, the panel's roll-all) leaves this stale, but it
  // is only read while `rerolling`, and a stale value then pulses a button
  // for a roll it did not start -- so it is cleared when the roll ends.
  const [rerollAction, setRerollAction] = useState<'similar' | 'random' | null>(null)
  if (!rerolling && rerollAction !== null) setRerollAction(null)
```

(The render-time reset is the same pattern `DiscoverPanel` already uses for `tempoText`: a setState during render, guarded so it settles in one extra render, which `react-hooks/set-state-in-effect` allows where an effect would not.)

- [ ] **Step 8: Remove `cycleRadioSlotFlag`**

In `src/shared/radioSlotFlags.ts`, delete `cycleRadioSlotFlag` and its whole doc comment (from `/** One press of the row's flag control: none -> replace soon -> hook ->` down to the function's closing `}`).

In `src/shared/radioSlotFlags.test.ts`:
- remove `cycleRadioSlotFlag` from the import list;
- delete the `hook()` helper and the whole `describe('cycleRadioSlotFlag', ...)` block (the toggle tests from Task 1 now cover everything it covered);
- in the three remaining `describe` blocks, replace every `hook(X, 'id')` with `toggleRadioHook(X, 'id')` and every single `cycleRadioSlotFlag(X, 'id')` with `toggleRadioReplaceSoon(X, 'id')`. The meaning is identical: one cycle press was replace-soon, and `hook()` was two presses.

Then confirm nothing else refers to the old names:

Run: `grep -rn "cycleRadioSlotFlag\|cycleSlotFlag\|onCycleRadioFlag" src`
Expected: no output.

- [ ] **Step 9: Remove the now-unused `DiceIcon` spin variant only if unused**

Run: `grep -n "DiceIcon" src/renderer/src/components/DiscoverPanel.tsx`
Expected: the definition, plus the toolbar's `<DiceIcon size={18} spinning={rerollingSlotIds.size > 0} />`. Leave `DiceIcon` in place (the toolbar still uses it). Update the sentence in its doc comment that begins `Two usages: purely decorative in DiscoverSlotRow` to read: `One usage: the toolbar's own "similar all" button, rendered bigger via the size prop.`

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npx vitest run && npx eslint src/renderer/src/components/DiscoverPanel.tsx src/shared/radioSlotFlags.ts src/shared/radioSlotFlags.test.ts`
Expected: typecheck clean, all tests pass, 0 lint errors and 0 warnings in these files. If prettier warns, run `npx prettier --write` on the listed files and re-run.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx src/shared/radioSlotFlags.ts src/shared/radioSlotFlags.test.ts
git commit -m "a row holds or hurries with two controls, and rerolls with icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Manual check (hand to Elling, do not claim)**

With `npm run dev`, Discover open, radio on:
- the hand and sign-out squares appear only with radio on, and the row does not shift when radio toggles;
- hand on row A, then on row B: A's hand goes dark;
- sign-out on a hooked row: the hand goes dark and sign-out lights;
- padlock a row: both grey out;
- "same kind" pulses while its roll is in flight, and the other buttons dim;
- tooltips appear quickly and read `hold longer`, `change next`, `same kind`, `nearby jam`, `any stem`, `duplicate`;
- the waveform is visibly wider.

---

### Task 5: The source dial

**Files:**
- Modify: `src/shared/discoverSlotModifier.ts`
- Modify: `src/shared/discoverSlotModifier.test.ts`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Narrow the modifier type (test first)**

In `src/shared/discoverSlotModifier.test.ts`, delete these tests from `describe('slotRollOptions', ...)`:
- `"'endlesss' alone restricts to endlesss sounds"`
- `"'other' alone restricts to non-endlesss sounds"`
- `'both sources selected means both'`

and from `describe('toggleSlotModifier', ...)`:
- `'endlesss and other are independent (both may be on)'`

Replace the `'defaults to both sound sources, ...'` test with:

```ts
  it('defaults to no ownership filter and no favourite preference', () => {
    expect(slotRollOptions([], withUser)).toEqual({
      onlyOwnStems: false,
      preferFavourites: false
    })
  })
```

In `describe('DISCOVER_SLOT_MODIFIER_OPTIONS', ...)`, update the canonical-order test so it expects exactly `['preferFaves', 'mine']`. Rename it from "lists the 4 modifiers" to "lists the 2 modifiers".

Run: `npx vitest run src/shared/discoverSlotModifier.test.ts`
Expected: FAIL. The default still includes `soundSource`, and the options list still has four entries.

- [ ] **Step 2: Narrow the module**

In `src/shared/discoverSlotModifier.ts`:

```ts
/** Discover's two remaining roll switches (prefer favourites, only my
 * stems). The endlesss/other source switches became the source dial on
 * 2026-09-29 -- see drawSoundSource. */
export type DiscoverSlotModifier = 'preferFaves' | 'mine'

export const DISCOVER_SLOT_MODIFIER_OPTIONS: DiscoverSlotModifier[] = ['preferFaves', 'mine']

export const DISCOVER_SLOT_MODIFIER_LABEL: Record<DiscoverSlotModifier, string> = {
  preferFaves: 'prefer faves',
  mine: 'my sounds'
}
```

Change `DiscoverSlotRollOptions` and `slotRollOptions` to:

```ts
export interface DiscoverSlotRollOptions {
  onlyOwnStems: boolean
  preferFavourites: boolean
}

/** What the switch set means for a roll. 'mine' only takes effect with a
 * username to match against. The sound source is not a switch any more --
 * each roll draws it from the dial (drawSoundSource). */
export function slotRollOptions(
  modifiers: readonly DiscoverSlotModifier[],
  { hasUsername }: { hasUsername: boolean }
): DiscoverSlotRollOptions {
  const set = new Set(modifiers)
  return {
    onlyOwnStems: set.has('mine') && hasUsername,
    preferFavourites: set.has('preferFaves')
  }
}
```

Run: `npx vitest run src/shared/discoverSlotModifier.test.ts`
Expected: PASS.

`npm run typecheck` will now FAIL in `DiscoverPanel.tsx`. The next steps fix every error.

- [ ] **Step 3: Dial state in the panel**

In `DiscoverPanel.tsx`, change `DEFAULT_GLOBAL_MODIFIERS` to:

```ts
const DEFAULT_GLOBAL_MODIFIERS: DiscoverSlotModifier[] = ['mine']
```

Directly under the `globalRollOptions` line (search `const globalRollOptions = slotRollOptions(`), add:

```ts
  // The source dial (2026-09-29): 0 = endlesss, 100 = other, 50 = half and
  // half. In-memory, like the switches it replaced. Mirrored into a ref
  // because radio's picks run from long-lived callbacks that would
  // otherwise read the value from whenever they were created.
  const [sourceLean, setSourceLean] = useState(DEFAULT_SOURCE_LEAN)
  const sourceLeanRef = useRef(DEFAULT_SOURCE_LEAN)
  function changeSourceLean(lean: number): void {
    sourceLeanRef.current = lean
    setSourceLean(lean)
  }
```

Add `DEFAULT_SOURCE_LEAN`, `drawSoundSource` and `soundSourceForLean` to the `@shared/discoverSlotModifier` import list.

- [ ] **Step 4: `pickForSlot` draws its source**

In `pickForSlot`, replace:

```ts
      const candidates = await window.rifffApi.getDiscoverCandidates(
        kinds,
        rollOptions.onlyOwnStems,
        currentUsername,
        rollOptions.soundSource
      )
```

with:

```ts
      // The source dial: this roll's source is drawn here, and the other
      // source is tried only if the drawn one has nothing for this slot
      // (never at an end -- see drawSoundSource).
      const draw = drawSoundSource(sourceLeanRef.current)
      let candidates = await window.rifffApi.getDiscoverCandidates(
        kinds,
        rollOptions.onlyOwnStems,
        currentUsername,
        draw.first
      )
      if (candidates.length === 0 && draw.fallback !== null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        candidates = await window.rifffApi.getDiscoverCandidates(
          kinds,
          rollOptions.onlyOwnStems,
          currentUsername,
          draw.fallback
        )
      }
```

- [ ] **Step 5: `rollRandomForSlot` draws its source**

In `rollRandomForSlot`, replace:

```ts
      const candidate = await window.rifffApi.getRandomDiscoverCandidate(
        kinds,
        rollOptions.onlyOwnStems,
        currentUsername,
        rollOptions.soundSource
      )
```

with:

```ts
      const draw = drawSoundSource(sourceLeanRef.current)
      let candidate = await window.rifffApi.getRandomDiscoverCandidate(
        kinds,
        rollOptions.onlyOwnStems,
        currentUsername,
        draw.first
      )
      if (candidate === null && draw.fallback !== null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return
        candidate = await window.rifffApi.getRandomDiscoverCandidate(
          kinds,
          rollOptions.onlyOwnStems,
          currentUsername,
          draw.fallback
        )
      }
```

- [ ] **Step 6: The nearby-jam paths use a filter**

In `rollAdjacentForSlot`, replace `globalRollOptions.soundSource` with `soundSourceForLean(sourceLeanRef.current)`.

At the `<DiscoverSlotRow` call site, replace:

```tsx
            soundSourceEndlesss={globalRollOptions.soundSource.endlesss}
            soundSourceAudioIn={globalRollOptions.soundSource.audioIn}
```

with:

```tsx
            soundSourceEndlesss={soundSourceForLean(sourceLean).endlesss}
            soundSourceAudioIn={soundSourceForLean(sourceLean).audioIn}
```

In `DiscoverSlotRow`'s props doc comment for these two (search `DiscoverPanel's own global endlesss sounds / other sounds toggles`), change the first line to `The source dial as a filter (soundSourceForLean) -- passed as two`.

- [ ] **Step 7: The switch row loses its source logic**

In the global roll filters block (search `{/* Global roll filters -- see globalModifiers. */}`), replace the whole `.map((modifier) => { ... })` body with:

```tsx
            {DISCOVER_SLOT_MODIFIER_OPTIONS.map((modifier) => {
              const disabled = modifier === 'mine' && !hasUsername
              return (
                <BracketToggle
                  key={modifier}
                  checked={!disabled && globalModifiers.includes(modifier)}
                  onChange={() => setGlobalModifiers((prev) => toggleSlotModifier(prev, modifier))}
                  label={DISCOVER_SLOT_MODIFIER_LABEL[modifier]}
                  disabled={disabled}
                  tooltip={disabled ? MY_SOUNDS_NEEDS_USERNAME : undefined}
                />
              )
            })}
```

Update the comment near the `globalModifiers` state (search `the four roll filters (prefer faves,`) so its first line says `the roll filters (prefer faves, my sounds; the endlesss/other pair became the source dial on 2026-09-29)`.

- [ ] **Step 8: The dial**

In the add row's right-hand column (search `Captioned "matching", so clockwise = MORE matching`), the column is a flex row holding one dial block. Add a second block **before** the matching block, inside the same bordered container:

```tsx
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              marginRight: 12
            }}
          >
            {/* The source dial (2026-09-29): 0 = endlesss sounds, 100 =
                other sounds, 50 = half and half. The ends are "only". See
                drawSoundSource. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 7, color: 'var(--ra-text-4)' }}>endlesss</span>
              <Dial
                value={sourceLean}
                onChange={changeSourceLean}
                defaultValue={DEFAULT_SOURCE_LEAN}
                size={30}
                ariaLabel="source"
                tooltip="other clockwise"
              />
              <span style={{ fontSize: 7, color: 'var(--ra-text-4)' }}>other</span>
            </div>
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              source
            </span>
          </div>
```

Widen the column so both dials fit, and keep the add row centred. Change:

```ts
const ADD_ROW_DIAL_COLUMN_WIDTH = 96
```

to:

```ts
const ADD_ROW_DIAL_COLUMN_WIDTH = 200
```

and update the comment above it to `Wide enough for the dial column's margin + divider + padding + the source dial with its end labels + the "matching" dial; the empty left track mirrors it.`

- [ ] **Step 9: Nothing else still reads the old shape**

Run: `grep -n "soundSource\b\|rollOptions.soundSource\|globalRollOptions.soundSource\|'endlesss'\|'other'" src/renderer/src/components/DiscoverPanel.tsx`
Expected: no reference to `globalRollOptions.soundSource` or `rollOptions.soundSource`. The only `soundSource` hits should be the row prop names and the `DiscoverNearbyPopover` `soundSource=` prop, which still receives `{ endlesss: soundSourceEndlesss, audioIn: soundSourceAudioIn }`.

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npx vitest run && npx eslint src/renderer/src/components/DiscoverPanel.tsx src/shared/discoverSlotModifier.ts src/shared/discoverSlotModifier.test.ts`
Expected: typecheck clean, all tests pass, 0 lint errors and 0 warnings in these files. Then run `npm run lint`: exactly the 4 pre-existing warnings.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx src/shared/discoverSlotModifier.ts src/shared/discoverSlotModifier.test.ts
git commit -m "one dial leans rolls toward endlesss or other sounds, half and half in the middle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Manual check (hand to Elling, do not claim)**

- The `source` dial sits beside `matching`, with `endlesss` and `other` at its ends, and the add row stays centred.
- At the left end, rolls only bring Endlesss sounds. At the right end, only audio-in/mic sounds.
- At the middle, about half the rolls are other sounds.
- A bass slot with the dial just off the right end still rolls something, because it falls back to Endlesss sounds.
- Double-click resets the dial to the middle.
- `prefer faves` and `my sounds` still work.

---

### Task 6: Full verification

- [ ] **Step 1: The full suite, including the CI exclusion list**

Run: `npx vitest run && CI=1 npx vitest run && npm run typecheck && npm run lint`
Expected: all pass. Lint shows exactly the 4 pre-existing warnings. Known flakes that are not regressions, and that pass when run alone: `pluginScan.test.ts > … a real installed VST3`, `playbackEngineLifecycle.test.ts`, `stemAutoClassify.test.ts`.

- [ ] **Step 2: Nothing leaked**

Run: `git status --short`
Expected: clean. Every change is committed, and nothing from `.superpowers/` is staged (it is gitignored).

- [ ] **Step 3: Report**

Tell Elling what shipped, list the manual checks from Tasks 4 and 5, and say plainly that none of the UI was seen by an agent.
