# Discover: row icons, split radio flags, and a source dial — design

2026-09-29. Two changes to the Discover screen, agreed with Elling in one brainstorm (mockups in
`.superpowers/brainstorm/`, not committed).

1. **The row.** The one radio flag button that cycled `none → replace soon → hook` becomes two
   separate controls. The four text buttons on the right (similar / adjacent / random / duplicate)
   become icons, and the waveform gets the space they used.
2. **The source filter.** The `endlesss sounds` and `other sounds` switches become one dial that
   sets how likely a roll is to pick one or the other.

Neither touches the engine, the wire format, or the phone.

---

## 1. The row

### Why

- One button with three states was hard to read. `-`, `>`, `h` did not say what they meant, and
  cycling through replace-soon to get to hook made the order matter.
- Hook and replace-soon mean opposite things. One says "keep this", the other says "replace this".
  They belong next to the controls they resemble, not in one shared button.
- The four text buttons took about a third of the row's width. The waveform is the thing worth
  looking at.

### Layout

Left, in order: `x · lock · m · s · star · hold longer`

Right, in order: `change next · | · same kind · nearby jam · any stem · duplicate`

(`|` is a 1px divider in `--ra-border`.)

Every control is an 18px square, the same size the left-hand controls already are. The freed width
goes to the waveform column.

### Icons

All from `@phosphor-icons/react`, **regular** weight, sized to match the existing lock and star
(12px glyph in the 18px square). Picked by Elling from Phosphor candidates, avoiding anything a
transport or mixer already uses: no fast-forward, no loop arrow, no wave or `≈`, no dot.

| control | icon | tooltip (`data-tooltip`) |
|---|---|---|
| hold longer | `HandPalm` | hold longer |
| change next | `SignOut` | change next |
| similar | `CirclesThree` | same kind |
| adjacent | `Compass` | nearby jam |
| random | `Shuffle` | any stem |
| duplicate | `Copy` | duplicate |

Tooltips use the app's existing `data-tooltip` system, which is already fast. Every button keeps an
`aria-label` equal to its tooltip.

**Scope of the new dependency:** only these six icons use the package. The existing hand-drawn
lock, star, undo/redo and dice stay as they are. Migrating them is a separate, optional pass.

### Behaviour

The storage stays what it is: `RadioSlotFlags` holds at most one flag per slot, `'hook'` or
`'replace-soon'` (`src/shared/radioSlotFlags.ts`). Radio's turnover weighting already reads it and
does not change. Only the gesture that writes it changes.

- **Hold longer** toggles `hook` on this row.
  - At most one row holds the hook. Turning it on here clears it from any other row. Both rows are
    on screen, so the other row's hand visibly goes dark; nothing changes silently.
  - Turning it on here also clears `replace-soon` on this row.
- **Change next** toggles `replace-soon` on this row.
  - Any number of rows may have it.
  - Turning it on here clears `hook` on this row.
  - It still clears itself when this row's stem is replaced, by anyone (`commitSlotPick`, as today).
- Both are shown only while radio is on. When radio is off their squares keep their space
  (`visibility: hidden`), so the row does not shift when radio turns on. Same as the current button.
- On a **padlocked** row both are disabled and dimmed, because radio already skips locked rows. The
  stored flag is left alone, so unlocking restores it.

### Visual states

Following `tokens.css`: no colour on chrome, no `border-radius`.

- Off: transparent background, `--ra-border` border, `--ra-text-3` glyph.
- Hold longer on: the lock's own "on" treatment, a `--ra-text` fill with a `--ra-bg` glyph.
- Change next on: the softer treatment the current button uses for replace-soon, a
  `--ra-bg-row-active` fill with a `--ra-text` border and glyph.
- Disabled: `--ra-text-4` glyph, no pointer.

### Busy state

The small decorative dice beside the buttons, which spins while a roll is in flight, is removed.
Instead, while a reroll is in flight, the button that started it pulses (opacity) and the other
three reroll buttons are dimmed and disabled, as the text buttons are today.

### Code

- `src/shared/radioSlotFlags.ts`: replace `cycleRadioSlotFlag` with two pure functions,
  `toggleRadioHook(flags, id)` and `toggleRadioReplaceSoon(flags, id)`, test-first. Tests cover:
  - hook is on for at most one slot, and turning it on elsewhere moves it;
  - the two flags exclude each other on one slot;
  - toggling an already-set flag clears it;
  - the existing `forgetRadioSlotFlagOnChange` and `pruneRadioSlotFlags` behaviour is unchanged.
- `DiscoverPanel.tsx` (`DiscoverSlotRow`): the two new buttons, the four icon buttons, the removed
  decorative dice, and a narrower `gridTemplateColumns`. `cycleSlotFlag` is replaced by two handlers.
- `package.json`: add `@phosphor-icons/react`.

---

## 2. The source dial

### What it replaces

Today the four global roll switches under the add row are `prefer faves`, `endlesss sounds`,
`other sounds` and `my sounds` (`DEFAULT_GLOBAL_MODIFIERS` in `DiscoverPanel.tsx`, read through
`slotRollOptions` in `src/shared/discoverSlotModifier.ts`). The two source switches become one dial. `prefer faves` and
`my sounds` stay as switches.

A stem is "other" when its instrument mask says audio-in or mic. Everything else is "endlesss"
(`soundSourceMatchesFilter`). That split does not change.

### What the dial means

A number from 0 to 100, **0 = endlesss, 100 = other**.

- **The middle (50) is half and half**, regardless of how many of each the library has. Elling
  chose this over "no lean, library proportion". Because most libraries are mostly Endlesss
  sounds, other sounds will come up far more often at the middle than they do now with both
  switches ticked. That is intended.
- **The ends are hard.** At 0 a roll only ever picks endlesss sounds, and at 100 only other
  sounds. This is today's single-switch behaviour.
- **In between** is a probability: at 30, each roll picks other sounds 30% of the time.

### How a roll uses it

The source is drawn **per roll, before the candidate query**. The existing single-source filter
does the rest, so nothing in the main process changes.

1. Draw the source: `other` with probability `lean / 100`, else `endlesss`.
2. Call `getDiscoverCandidates` with that one source (`{ endlesss: true, audioIn: false }` or the
   reverse).
3. If that returns no candidates **and the dial is not at an end**, call again with the other
   source. A kind that has no audio-in stems (common for bass) should never fail a roll because the
   dial leaned the other way. At an end there is no fallback, because the end means "only".

This is one pure function in `src/shared/discoverSlotModifier.ts`, test-first:
`drawSoundSource(lean, random) → { first: DiscoverSoundSourceFilter, fallback: DiscoverSoundSourceFilter | null }`.
Tests cover:
- the ends never draw the other source and have no fallback;
- the middle draws each about half the time, checked with a seeded `random`;
- a value in between gives its fallback as the other source.

Every roll path goes through it, since all of them read `globalRollOptions.soundSource` today:
`pickForSlot`, which serves rolls, rerolls and radio's picks. `slotRollOptions` stops producing
`soundSource` from switches. The **nearby jam** popover takes a filter, not a draw: a single source
at an end, both sources otherwise.

### The control

The existing `Dial`, 0–100, placed beside the `matching` dial in the add row's right-hand column.

- Caption `source`, with small end labels `endlesss` (left) and `other` (right).
- Double-click resets to 50, the same reset gesture the master dials use.
- In-memory only, like the switches it replaces. It starts at 50 every session.

---

## Verification

- `npx vitest run`, `npm run typecheck`, `npm run lint`.
- **Not verifiable by an agent**, and needs Elling:
  - how the icons read at 18px;
  - tooltip timing;
  - whether the waveform width feels right;
  - whether half-and-half at the middle turns up too many other sounds in practice.

## Out of scope

- Moving the existing hand-drawn icons to the package.
- Adding the hook or change next controls to the phone. Deliberately absent, see the 2026-09-29
  handoff §5.
- Persisting the dial across sessions.
