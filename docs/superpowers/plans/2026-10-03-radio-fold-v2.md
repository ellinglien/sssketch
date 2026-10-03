# Radio fold mode v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fold mode livelier and explain itself. Folds re-fold and rotate, changes come faster, and drift can be heard. Both radios show a status line and a per-row readout with a phase dot. The controls are renamed `bend` and `mismatch` and get tooltips, any text works as a seed, and the web start screen's fold switch takes the form of the visuals switch.

**Architecture:**
- **Shared rules come first, in sssketch `src/shared/`.** They are pure and seeded, and both radios import them.
  - `radioFold.ts` gains re-fold, rotation, the 8–32 bar window, bend-scaled drift and any-text seeds.
  - A new `radioFoldStatus.ts` turns a machine state and step into the status line, the row readout and the phase dot.
- **The web radio (`ell.ing/radio`) comes next.**
  - The view carries the status.
  - Full mode shows the status and readouts, and renames its controls.
  - The start-screen switch reuses the visuals switch's words.
  - An offline render check proves a re-fold at a top is click-free.
- **sssketch's Discover comes last.** That means the menu renames, a status line in the radio bar, and a readout track on each row with its phase dot moved imperatively, like the playhead.
- **The engine needs no change.** CycleTable already crossfades any id or phase change at a top. One new native test pins the phase-only re-fold.

**Tech Stack:** TypeScript, vitest, React 19 / Electron (sssketch renderer), plain DOM + Vite (web), JUCE C++ `UnitTestRunner` (engine), headless-Chrome offline render checks (`npm run check:engine`).

**Spec:** `docs/superpowers/specs/2026-10-03-radio-fold-v2-design.md`, which builds on §5 ("as built") of `docs/superpowers/specs/2026-10-02-radio-fold-mode-design.md`.

**Change from Elling (2026-10-03, after the spec):** in web full mode with fold **off**, the fold settings (`bend`, `mismatch`, `seed`, `new`) stay **hidden** as they are today (`bc12f36`). They are not disabled. Ignore the spec's "disabled, not hidden" paragraph. Everything else stands, including the start-screen switch styled like the visuals switch.

**Validated before writing.** Every code block in Tasks 1–5 and 8–13 was applied to scratch copies of both repos (`$SCRATCH/v2proto`, `$SCRATCH/ss`, `$SCRATCH/web`) and checked there:
- sssketch: typecheck, lint, prettier and the full vitest suite all pass. The only failures are the engine-binary tests, because the scratch copy has no native build.
- Web: `npm run typecheck`, vitest, and `check:engine foldRefoldTop,foldChangeTop`, all pass.
- Tasks 1–5 were also checked one at a time, in order.
- The fuzzers (Task 6) passed against the result.
- **Task 7's C++ was not compiled.** It follows the existing `PlaybackEngineTests` cases line for line, but the executor builds and runs it for the first time.

`$SCRATCH` = `/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/2564036b-ae0a-45c2-9e3d-34f7c4f747fd/scratchpad`

---

## Ground rules

- Read both `CLAUDE.md`s first: `/Users/nickel/Claudecode/sssketch/CLAUDE.md` and `/Users/nickel/Claudecode/ell.ing/radio/CLAUDE.md`.
- **Two repos:**
  - sssketch: `/Users/nickel/Claudecode/sssketch`.
  - Web: `/Users/nickel/Claudecode/ell.ing/radio`. It imports sssketch's `src/shared` through `@shared`, so do the shared tasks first.
- Each task says which repo it is in. Paths are relative to that repo's root.
- **Every edit is an exact-string replacement.** The "replace … with …" blocks quote the current code, so use the Edit tool with those strings. If one does not match, stop and re-read the file. Do not improvise.
- **Commits:**
  - One commit per task, in that task's repo, staging only the files the task names.
  - Every commit message ends with exactly these two lines, after a blank line:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
    ```
- **Scratch work** (the fuzzers, probes) goes in `$SCRATCH`, never in either repo.
- **What an agent cannot check.** No agent can hear audio, see the UI or click through either app. Say so plainly in any report. UI tasks are verified by typecheck, lint and the pure models' tests, and Elling's walkthrough (Task 14) does the rest.
- **The native engine** does not hot-reload. After Task 7, rebuild it (`cd native-engine && cmake --build build`). Any manual check also needs a full app quit and relaunch.
- sssketch's prettier: `singleQuote`, no semicolons, `printWidth` 100, no trailing commas. The blocks below are already formatted. The web repo has no prettier and uses long lines, as its code does now.

## Spec points resolved

These are the choices the spec left open, or that the code forced, and how this plan settles them.

**Re-fold**
1. **When.** The chance is drawn on a settled fold's *own* realignment top (`realignsAt`), which is always a marked top. It is drawn only in a folded stretch, and only for a fold not already asked to leave (`unfoldSince === null`).
   - The rotation check runs first on that top. A fold either rotates or may re-fold, never both.
   - Chance: `lerp(0.3, 0.7, bend/100)` (`FOLD_REFOLD_CHANCE`).
2. **Targets.**
   - A length re-fold takes a length from the bend's menu. It must be inside the 30–120 s window, shorter than the row, and not its current target. It also draws a new phase from the bend's menu (always 0 below bend 50).
   - A phase-only re-fold keeps the length and takes another offset. It is one more choice, and only where the menu has offsets, which means bend 50 and up.
   - The move takes 1–2 steps (`radioFoldPath`). The row's mode is `refolding` (the spec's fourth mode), and it is `settled` again on the top after it lands.
3. **Flag for Elling: re-folds need room.**
   - Below bend 50 the menu is 7 or 9 beats, so a 2-bar (8-beat) row has only 7, with nothing to re-fold to. Re-folds at the default bend 40 therefore happen only on 3–4-bar rows.
   - Rotation still swaps layers there.
   - Measured at bend 40 on 4-bar rows: 41% of realignment tops re-folded (expected 46%). At bend 100: 77%.
4. **The walk back after a re-fold.**
   - The `walk` becomes the lengths the fold played that are longer than the new target, at most three, the nearest kept, then the target.
   - An unfold therefore still climbs monotonically through lengths the row played, in three visible steps at most (v1's bound). The fuzzer flagged longer walks before this cap was added.
   - The unfold path also drops any walk entry not longer than the cycle playing.

**Rotation**
5. **The count.** Each new fold draws `rotateAfter` ∈ {2, 3, 4} and counts its realignment tops in `realigns`. Both fields are optional in the state, so a v1 state reads as 0 and 4.
6. **The start.** On the top where `realigns >= rotateAfter`, if another row may fold (`foldable()`), the state records `rotate = { from, to }`. The replacement is drawn then, and `from` walks back from that same top.
   - No other new fold starts while it walks back.
   - On the top `from` has left, `to` folds in if it still may and the bend's row limit allows. Otherwise the usual pick runs.
   - A straight stretch clears the rotation.
   - It never exceeds the bend's row limit: one below 60, two from 60.

**Pace and drift**
7. **Faster changes.** `FOLD_PACE_BARS` is 8–32. The realignment preference (`FOLD_PREFER_WAIT_LAPS` = 2) is unchanged.
8. **Audible drift.**
   - `radioFoldDriftRange(bend)` gives the spec's ranges.
   - `FOLD_DRIFT_RANGE` stays, as the bend-0 range, which equals v1's.
   - Each new sweep draws its target at the current bend. A sweep already running keeps its target.

**Seeds**
9. **Codes and text.**
   - A trimmed, lowercased six-character code from the alphabet is that code.
   - Any other text is kept as typed: trimmed, at most 32 characters (`FOLD_SEED_TEXT_MAX`).
   - The machine draws from `foldSeedKey(seed)`. That is the code itself, so `autech` still draws `autech#0`, `autech#1`… For text it is `~` plus `hashText(lowercased)`, which is FNV-1a with seededRandom's finaliser. `elling` → `~7c2b3586`, and `Elling` folds the same.
   - A blank box keeps the current seed (`cleanFoldSeed` → null). In a settings file it is the default, or a fresh random seed where one is drawn.
   - Note: `K3X-9PQ` used to be cleaned to `k3x9pq` and is now text. Saved settings only ever held clean codes, so nothing saved changes.
10. **What "old seeds unchanged" means.** An old seed is the same seed: it draws from the same key. v2 adds draws (each fold's `rotateAfter`, the re-fold draws) and new rules, so a v2 run is not a note-for-note replay of a v1 run. Within v2, the same seed and the same events give the same decisions. Tests and the fuzzer cover this, including a JSON round trip and states saved before v2.
11. **Saved text seeds survive a reload.**
    - sssketch's `discoverSettingsStore` kept a saved seed only if it was a code. It now keeps any text (Task 1).
    - The web's `foldPrefs` does the same (Task 8).

**Status and readout**
12. **`radioFoldStatus`'s signature.** It is `(state, step, loopBars, bend, intervalBarsLeft)`. **`bend` replaces the spec's `bpm`:** nothing in the status needs the tempo, but bend 0 must read plain `straight` rather than `folding in N laps`.
    - `state` is the machine's latest state. `step` decided the lap playing.
    - `realignsInLaps` counts from the top of the lap playing, looking up to 32 laps ahead. A marked decided-lap top counts as 1.
    - `next change ~N bars` appears only on the folded line, as in the spec's examples.
    - Folded with nothing foldable reads `folded · nothing to fold`. Straight while folds walk back reads `straight · unfolding`.
13. **The readout.** `7 / 16` is the cycle against the **loop**, in beats. The second number is the loop's beats, not the row's own length. A half beat is written `½` (`3½ / 16`).
14. **The phase dot.** It is the spec's formula, with `beatsIn = (lapsIn × loopBars + pos) × 4`, and `lapsIn` taken from the step of the lap playing.
    - Web: a live `pos` that has wrapped past the view's tick adds a lap.
    - While **held** the web machine does not step, so the dots hide (the readout stays).
15. **Where the next change comes from.** sssketch's status line uses the rows' own count (`radioChangeWait.barsUntilChange`). The web uses `view.upcoming.barsUntil`.
16. **Placement.**
    - Web: the readout sits over the waveform's top right. The status line goes at the end of the fold group, only while fold is on.
    - sssketch: the status line goes in the radio bar after the turn chips. The readout is a new 16th grid track (44px) after 👎, and the dots are moved by the sweep layout effect.
17. **Start-screen switch.** It reads `fold: on` / `fold: off`, built from `switchWords` (shared with `visuals: …`). The name is dimmed to 0.45 and brightens to 0.8 on hover, and the value is bright when on and at 0.35 when off. Those are `.intro-visuals`'s numbers. It keeps its place, hung right of the centred play.

**Testing**
18. **The engine.** `CycleTable::apply` already leaves a tail for any live cycle whose id, length or phase changed. Task 7 adds the one missing case: same length, new phase, new id.
19. **Fuzz.**
    - Task 6 derives rev6 from rev5 with v2's invariants.
    - `2 cycles under 60 (any)` in the dynamic fuzzer is v1's documented allowance (§5: dropping the fader under 60 lets an extra fold finish). rev5 shows it too, with 6 hits.

## File map

**sssketch** (`/Users/nickel/Claudecode/sssketch`)

| File | Change |
|---|---|
| `src/shared/radioFold.ts` | Seeds (`cleanFoldSeed`, `foldSeedKey`), 8–32 window, `radioFoldDriftRange`, re-fold + rotation in `stepRadioFold`, `radioFoldRowRealignsAt` |
| `src/shared/radioFoldStatus.ts` (new) | `radioFoldStatus`, `radioFoldRowLabel`, `radioFoldBeatsLabel`, `radioFoldPhaseDot`, `radioFoldBeatsIn` |
| `src/shared/radioFold.test.ts`, `radioFoldStep.test.ts`, `radioFoldSettings.test.ts`, `radioFoldStatus.test.ts` (new) | Tests |
| `src/main/discoverSettingsStore.ts` (+ test) | Keep a saved text seed |
| `native-engine/Source/PlaybackEngineTests.cpp` | Phase-only re-fold crossfade test |
| `src/renderer/src/components/DiscoverRadioMenu.tsx` | `bend` / `mismatch` + tooltips, any-text seed, 8–32 in the hint |
| `src/renderer/src/components/DiscoverPanel.tsx` | Status line in the radio bar, row readout track + phase dot, dev log with the status |

**ell.ing/radio** (`/Users/nickel/Claudecode/ell.ing/radio`)

| File | Change |
|---|---|
| `src/radio/step.ts` (+ `step.test.ts`) | `RadioView.fold` (the status), 8–32 in comments |
| `src/ui/foldPrefs.ts` (+ test) | Any-text seed |
| `src/ui/fullModel.ts` (+ test) | `foldStatus`, `FullRow.fold`, `foldDots`, `fullKey` |
| `src/ui/full.ts`, `src/ui/full.css`, `src/main.ts` | Renames + tooltips, any-text seed, status line, readouts, dots each frame |
| `src/ui/visualsSwitch.ts` (+ test), `src/ui/simple.ts`, `src/ui/simple.css` | Start-screen `fold: on/off` in the visuals switch's form |
| `spike/engine-check/check.ts` | `foldRefoldTop` render check |

---

## Task 1: Any-text seeds (shared) and keeping them (sssketch main)

**Repo:** sssketch.
**Files:** Modify `src/shared/radioFold.ts`, `src/shared/radioFold.test.ts`, `src/shared/radioFoldSettings.test.ts`, `src/shared/radioFoldStep.test.ts`, `src/main/discoverSettingsStore.ts`, `src/main/discoverSettingsStore.test.ts`.

- [ ] **Step 1: Write the failing tests.**

In `src/shared/radioFold.test.ts`, replace:

```ts
import {
  DEFAULT_FOLD_SEED,
  FOLD_SEED_ALPHABET,
  newFoldSeed,
```

with:

```ts
import {
  DEFAULT_FOLD_SEED,
  FOLD_SEED_ALPHABET,
  FOLD_SEED_TEXT_MAX,
  cleanFoldSeed,
  foldSeedKey,
  newFoldSeed,
```

In `src/shared/radioFold.test.ts`, replace:

```ts
} from './radioFold'
```

with:

```ts
} from './radioFold'
import { hashText } from './seededRandom'
```

In `src/shared/radioFold.test.ts`, replace:

```ts
  it('a seed is six characters of the alphabet; a pasted one is cleaned', () => {
    expect(normalizeFoldSeed('k3x9pq')).toBe('k3x9pq')
    expect(normalizeFoldSeed(' K3X-9PQ ')).toBe('k3x9pq')
    expect(normalizeFoldSeed('abc')).toBe(DEFAULT_FOLD_SEED)
    expect(normalizeFoldSeed('k3x9pq0')).toBe('k3x9pq') // 0 is not in the alphabet
    expect(normalizeFoldSeed(42)).toBe(DEFAULT_FOLD_SEED)
  })
```

with:

```ts
  it('a seed: a six-character code in any case is that code; any other text is kept as typed', () => {
    expect(normalizeFoldSeed('k3x9pq')).toBe('k3x9pq')
    expect(normalizeFoldSeed(' K3X9PQ ')).toBe('k3x9pq')
    expect(normalizeFoldSeed('autech')).toBe('autech')
    // l and i are not in the alphabet, so `elling` is text, kept as typed (trimmed)
    expect(normalizeFoldSeed('elling')).toBe('elling')
    expect(normalizeFoldSeed(' Elling ')).toBe('Elling')
    expect(normalizeFoldSeed('K3X-9PQ')).toBe('K3X-9PQ')
    expect(normalizeFoldSeed('abc')).toBe('abc')
    expect(normalizeFoldSeed('x'.repeat(40))).toBe('x'.repeat(FOLD_SEED_TEXT_MAX))
    expect(normalizeFoldSeed('')).toBe(DEFAULT_FOLD_SEED)
    expect(normalizeFoldSeed('   ')).toBe(DEFAULT_FOLD_SEED)
    expect(normalizeFoldSeed(42)).toBe(DEFAULT_FOLD_SEED)
  })

  it('nothing usable cleans to null, so a box left empty keeps the seed in use', () => {
    expect(cleanFoldSeed('')).toBeNull()
    expect(cleanFoldSeed('  ')).toBeNull()
    expect(cleanFoldSeed(undefined)).toBeNull()
    expect(cleanFoldSeed('elling')).toBe('elling')
  })

  it('the machine draws from a code as it is, and from any other text by a stable hash', () => {
    expect(foldSeedKey('autech')).toBe('autech')
    expect(foldSeedKey('k3x9pq')).toBe('k3x9pq')
    expect(foldSeedKey('elling')).toBe(`~${hashText('elling')}`)
    // FNV-1a (hashText): the same on every machine and every run
    expect(foldSeedKey('elling')).toBe('~7c2b3586')
    expect(foldSeedKey('Elling')).toBe(foldSeedKey('elling'))
    expect(foldSeedKey('elling')).not.toBe(foldSeedKey('ellinh'))
  })
```

In `src/shared/radioFoldSettings.test.ts`, replace:

```ts
    expect(s.foldSeed).toBe('k3x9pq')
    expect(normalizeRadioSettings({ foldMode: true }).foldMode).toBe(true)
  })
```

with:

```ts
    expect(s.foldSeed).toBe('k3x9pq')
    expect(normalizeRadioSettings({ foldMode: true }).foldMode).toBe(true)
  })

  it('a text seed is kept as typed; a blank one is the default', () => {
    expect(normalizeRadioSettings({ foldSeed: 'elling' }).foldSeed).toBe('elling')
    expect(normalizeRadioSettings({ foldSeed: '  ' }).foldSeed).toBe('autech')
  })
```

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  createRadioFold,
```

with:

```ts
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  createRadioFold,
  foldSeedKey,
```

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
} from './radioFold'
```

with:

```ts
} from './radioFold'
import { seededRandom } from './seededRandom'
```

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
  it('decides one lap ahead: the first step is lap 0', () => {
    expect(stepRadioFold(createRadioFold('k3x9pq'), input(40)).lap).toBe(0)
  })
})
```

with:

```ts
  it('decides one lap ahead: the first step is lap 0', () => {
    expect(stepRadioFold(createRadioFold('k3x9pq'), input(40)).lap).toBe(0)
  })

  it('an old six-character seed draws from itself, as it always has', () => {
    // the first draw sizes the first folded stretch: 48 bars at fold 40, +-25%
    const first = seededRandom('autech#0')()
    const laps = Math.max(1, Math.round((48 * (0.75 + 0.5 * first)) / 4))
    expect(stepRadioFold(createRadioFold('autech'), input(40)).state.stretchEndsLap).toBe(laps)
  })

  it('a text seed draws from its hash; the same text replays, in any case', () => {
    const first = seededRandom(`${foldSeedKey('elling')}#0`)()
    const laps = Math.max(1, Math.round((48 * (0.75 + 0.5 * first)) / 4))
    expect(stepRadioFold(createRadioFold('elling'), input(40)).state.stretchEndsLap).toBe(laps)
    const a = run('elling', 300, () => input(70)).map((s) => s.cycles)
    const b = run('Elling', 300, () => input(70)).map((s) => s.cycles)
    expect(b).toEqual(a)
    expect(run('ellinh', 300, () => input(70)).map((s) => s.cycles)).not.toEqual(a)
  })
})
```

In `src/main/discoverSettingsStore.test.ts`, replace:

```ts
    expect(loadDiscoverSettings().radio.foldSeed).toBe('k3x9pq')
    writeFileSync(join(dir, 'discoverSettings.json'), JSON.stringify({ radio: {} }), 'utf-8')
    expect(loadDiscoverSettings().radio.foldSeed).toMatch(FOLD_SEED)
  })
```

with:

```ts
    expect(loadDiscoverSettings().radio.foldSeed).toBe('k3x9pq')
    writeFileSync(join(dir, 'discoverSettings.json'), JSON.stringify({ radio: {} }), 'utf-8')
    expect(loadDiscoverSettings().radio.foldSeed).toMatch(FOLD_SEED)
  })

  it('keeps a saved text seed as typed (v2: any text is a seed)', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ radio: { foldSeed: 'Elling' } }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radio.foldSeed).toBe('Elling')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ radio: { foldSeed: '   ' } }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radio.foldSeed).toMatch(FOLD_SEED)
  })
```

- [ ] **Step 2: Run them and see them fail.**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFold.test.ts src/shared/radioFoldSettings.test.ts src/shared/radioFoldStep.test.ts src/main/discoverSettingsStore.test.ts`
Expected: FAIL.
- `radioFold.test.ts` and `radioFoldStep.test.ts` fail, because `cleanFoldSeed` and `foldSeedKey` do not exist yet (`… is not a function`) and `normalizeFoldSeed('elling')` returns `autech`.
- `radioFoldSettings.test.ts` fails with `expected 'autech' to be 'elling'`.
- `discoverSettingsStore.test.ts` fails with `expected '<6 random chars>' to be 'Elling'`.

- [ ] **Step 3: Implement.**

In `src/shared/radioFold.ts`, replace:

```ts
import { seededRandom } from './seededRandom'
```

with:

```ts
import { hashText, seededRandom } from './seededRandom'
```

In `src/shared/radioFold.ts`, replace:

```ts
/** Lowercase letters and digits without the lookalikes (0/o, 1/l/i): a code read off a screen
 * and typed back has to survive the trip. */
export const FOLD_SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const FOLD_SEED_LENGTH = 6
export const DEFAULT_FOLD_SEED = 'autech'
```

with:

```ts
/** Lowercase letters and digits without the lookalikes (0/o, 1/l/i): a code read off a screen
 * and typed back has to survive the trip. */
export const FOLD_SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const FOLD_SEED_LENGTH = 6
export const DEFAULT_FOLD_SEED = 'autech'
/** Any-text seeds (v2 section 3) are kept up to this many characters. */
export const FOLD_SEED_TEXT_MAX = 32
/** A six-character code: what `new` draws, and every seed saved before any-text seeds. */
const FOLD_SEED_CODE = new RegExp(`^[${FOLD_SEED_ALPHABET}]{${FOLD_SEED_LENGTH}}$`)
```

In `src/shared/radioFold.ts`, replace:

```ts
/** A typed or pasted seed: lowercased, everything outside the alphabet dropped. Exactly six
 * characters must remain, or it is the default. */
export function normalizeFoldSeed(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_FOLD_SEED
  const kept = [...value.trim().toLowerCase()].filter((ch) => FOLD_SEED_ALPHABET.includes(ch))
  return kept.length === FOLD_SEED_LENGTH ? kept.join('') : DEFAULT_FOLD_SEED
}
```

with:

```ts
/** A typed seed, or null when there is nothing to use (not a string, or blank: a box left empty
 * keeps the seed in use). A six-character code, in any case, is that code lowercased, so every
 * saved seed replays exactly as before; any other text is kept as typed, trimmed, at most
 * FOLD_SEED_TEXT_MAX characters (v2 section 3). */
export function cleanFoldSeed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (t === '') return null
  const lower = t.toLowerCase()
  if (FOLD_SEED_CODE.test(lower)) return lower
  return [...t].slice(0, FOLD_SEED_TEXT_MAX).join('')
}

/** A saved or typed seed, the default for nothing usable (cleanFoldSeed). */
export function normalizeFoldSeed(value: unknown): string {
  return cleanFoldSeed(value) ?? DEFAULT_FOLD_SEED
}

/** What the machine draws from: a code as it is (so `autech` draws `autech#0`, `autech#1`... as
 * it always has), any other text through FNV-1a (hashText), lowercased: `Elling` and `elling`
 * fold the same. The `~` keeps a hashed text from ever equalling a code. */
export function foldSeedKey(seed: string): string {
  const lower = seed.toLowerCase()
  return FOLD_SEED_CODE.test(lower) ? lower : `~${hashText(lower)}`
}
```

In `src/shared/radioFold.ts`, replace:

```ts
  const draw = (): number => seededRandom(`${s.seed}#${s.draws++}`)()
```

with:

```ts
  const key = foldSeedKey(s.seed)
  const draw = (): number => seededRandom(`${key}#${s.draws++}`)()
```

In `src/main/discoverSettingsStore.ts`, replace:

```ts
import { newFoldSeed, normalizeFoldSeed } from '@shared/radioFold'
```

with:

```ts
import { cleanFoldSeed, newFoldSeed } from '@shared/radioFold'
```

In `src/main/discoverSettingsStore.ts`, replace:

```ts
/** Fold mode's first seed is random, not the shared default (Elling, 2026-10-03): a seed
 * that was saved and is still a valid seed is kept; anything else draws a fresh one, which
 * the next save keeps. */
function withRandomFoldSeed(settings: DiscoverSettings, savedSeed: unknown): DiscoverSettings {
  if (
    typeof savedSeed === 'string' &&
    normalizeFoldSeed(savedSeed) === savedSeed.trim().toLowerCase()
  ) {
    return settings
  }
```

with:

```ts
/** Fold mode's first seed is random, not the shared default (Elling, 2026-10-03): a saved
 * seed -- any text since v2 (cleanFoldSeed) -- is kept; none, or a blank one, draws a fresh one,
 * which the next save keeps. */
function withRandomFoldSeed(settings: DiscoverSettings, savedSeed: unknown): DiscoverSettings {
  if (cleanFoldSeed(savedSeed) !== null) return settings
```

- [ ] **Step 4: Run them and see them pass.**

Run: the same command as Step 2.
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioFold.ts src/shared/radioFold.test.ts src/shared/radioFoldSettings.test.ts src/shared/radioFoldStep.test.ts src/main/discoverSettingsStore.ts src/main/discoverSettingsStore.test.ts
git commit -F - <<'EOF'
radio fold v2: any text is a seed -- a six-character code draws from itself as before, other text from its FNV-1a hash; a saved text seed is kept

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 2: Faster changes, 8–32 bars (shared)

**Repo:** sssketch.
**Files:** Modify `src/shared/radioFold.ts`, `src/shared/radioFoldSettings.test.ts`.

- [ ] **Step 1: Write the failing test.**

In `src/shared/radioFoldSettings.test.ts`, replace:

```ts
  it('fold mode replaces the pace window with 16-64 bars, and gives the pace window back off', () => {
    const on = normalizeRadioSettings({ pace: 'fast', foldMode: true })
    expect(radioPaceWindowOf(on)).toEqual({ min: 16, max: 64 })
```

with:

```ts
  it('fold mode replaces the pace window with 8-32 bars, and gives the pace window back off', () => {
    const on = normalizeRadioSettings({ pace: 'fast', foldMode: true })
    expect(radioPaceWindowOf(on)).toEqual({ min: 8, max: 32 })
```

- [ ] **Step 2: Run it and see it fail.**

Run: `npx vitest run src/shared/radioFoldSettings.test.ts`
Expected: FAIL with `expected { min: 16, max: 64 } to deeply equal { min: 8, max: 32 }`.

- [ ] **Step 3: Implement.**

In `src/shared/radioFold.ts`, replace:

```ts
/** The pace window while the mode is on (spec section 1): it replaces the user's. */
export const FOLD_PACE_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 16,
  max: 64
})
```

with:

```ts
/** The pace window while the mode is on (spec section 1): it replaces the user's. 8-32 bars
 * since v2 (2026-10-03-radio-fold-v2-design.md section 1: "faster changes"), 16-64 before. */
export const FOLD_PACE_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 8,
  max: 32
})
```

- [ ] **Step 4: Run it and see it pass.**

Run: `npx vitest run src/shared/radioFoldSettings.test.ts src/shared/radioFoldStep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/shared/radioFold.ts src/shared/radioFoldSettings.test.ts
git commit -F - <<'EOF'
radio fold v2: changes come every 8-32 bars while fold mode is on, down from 16-64

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 3: Audible drift, scaled by bend (shared)

**Repo:** sssketch.
**Files:** Modify `src/shared/radioFold.ts`, `src/shared/radioFoldStep.test.ts`.

- [ ] **Step 1: Write the failing tests.**

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  createRadioFold,
  foldSeedKey,
```

with:

```ts
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  createRadioFold,
  foldSeedKey,
  radioFoldDriftRange,
```

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
describe('drift', () => {
  it('moves slowly inside its ranges, from rest, and never closes the filter', () => {
    const steps = run('k3x9pq', 200, () => input(40))
    expect(steps[0].drift.perc.cutoff[0]).toBe(FOLD_DRIFT_RANGE.cutoff.rest)
    for (const s of steps) {
      for (const d of Object.values(s.drift)) {
        for (const p of ['cutoff', 'send', 'dub'] as const) {
          const [a, b] = d[p]
          expect(Math.min(a, b)).toBeGreaterThanOrEqual(
            Math.min(FOLD_DRIFT_RANGE[p].min, FOLD_DRIFT_RANGE[p].rest) - 1e-12
          )
          expect(Math.max(a, b)).toBeLessThanOrEqual(FOLD_DRIFT_RANGE[p].max + 1e-12)
          // a sweep is 32 bars at the least: on a 4-bar loop, under a ninth of the range a lap
          expect(Math.abs(b - a)).toBeLessThanOrEqual(
            (FOLD_DRIFT_RANGE[p].max - FOLD_DRIFT_RANGE[p].min) / 8 + 1e-12
          )
        }
      }
    }
  })

  it('steps at most an eighth of a range a lap, on any loop length (a sweep is 8 laps or more)', () => {
    for (const loopBars of [1, 4, 8, 16, 32]) {
      const steps = run('k3x9pq', 120, () => ({ ...input(40), loopBars }))
      for (const s of steps) {
        for (const d of Object.values(s.drift)) {
          for (const p of ['cutoff', 'send', 'dub'] as const) {
            const [a, b] = d[p]
            expect(Math.abs(b - a)).toBeLessThanOrEqual(
              (FOLD_DRIFT_RANGE[p].max - FOLD_DRIFT_RANGE[p].min) / 8 + 1e-12
            )
          }
        }
      }
    }
  })
```

with:

```ts
describe('drift', () => {
  it("scales with bend: v1's range at 0, a deeper cutoff and more send at 100", () => {
    expect(radioFoldDriftRange(0)).toEqual(FOLD_DRIFT_RANGE)
    expect(FOLD_DRIFT_RANGE.cutoff.min).toBeCloseTo(0.62, 12)
    expect(FOLD_DRIFT_RANGE.send.max).toBeCloseTo(0.15, 12)
    expect(FOLD_DRIFT_RANGE.dub.max).toBeCloseTo(0.18, 12)
    const full = radioFoldDriftRange(100)
    expect(full.cutoff.min).toBeCloseTo(0.4, 12)
    expect(full.send.max).toBeCloseTo(0.3, 12)
    expect(full.dub.max).toBeCloseTo(0.35, 12)
    expect(radioFoldDriftRange(50).cutoff.min).toBeCloseTo(0.51, 12)
    for (const bend of [0, 25, 50, 75, 100]) {
      const r = radioFoldDriftRange(bend)
      // the filter never closes; sends are only ever added
      expect(r.cutoff.min).toBeGreaterThan(0.39)
      expect(r.cutoff.max).toBe(1)
      expect(r.send.min).toBe(0)
      expect(r.dub.min).toBe(0)
    }
  })

  it('moves slowly inside its ranges, from rest, and never closes the filter', () => {
    for (const fold of [40, 100]) {
      const R = radioFoldDriftRange(fold)
      const steps = run('k3x9pq', 200, () => input(fold))
      expect(steps[0].drift.perc.cutoff[0]).toBe(R.cutoff.rest)
      for (const s of steps) {
        for (const d of Object.values(s.drift)) {
          for (const p of ['cutoff', 'send', 'dub'] as const) {
            const [a, b] = d[p]
            expect(Math.min(a, b)).toBeGreaterThanOrEqual(Math.min(R[p].min, R[p].rest) - 1e-12)
            expect(Math.max(a, b)).toBeLessThanOrEqual(R[p].max + 1e-12)
            // a sweep is 32 bars at the least: on a 4-bar loop, under a ninth of the range a lap
            expect(Math.abs(b - a)).toBeLessThanOrEqual((R[p].max - R[p].min) / 8 + 1e-12)
          }
        }
      }
    }
  })

  it('at full bend it goes past the old range, so it is heard', () => {
    let lowest = 1
    let most = 0
    for (const s of run('k3x9pq', 400, () => input(100))) {
      for (const d of Object.values(s.drift)) {
        lowest = Math.min(lowest, d.cutoff[0])
        most = Math.max(most, d.send[0], d.dub[0] - 0.03)
      }
    }
    expect(lowest).toBeLessThan(FOLD_DRIFT_RANGE.cutoff.min)
    expect(most).toBeGreaterThan(FOLD_DRIFT_RANGE.send.max)
  })

  it('steps at most an eighth of a range a lap, on any loop length (a sweep is 8 laps or more)', () => {
    const R = radioFoldDriftRange(40)
    for (const loopBars of [1, 4, 8, 16, 32]) {
      const steps = run('k3x9pq', 120, () => ({ ...input(40), loopBars }))
      for (const s of steps) {
        for (const d of Object.values(s.drift)) {
          for (const p of ['cutoff', 'send', 'dub'] as const) {
            const [a, b] = d[p]
            expect(Math.abs(b - a)).toBeLessThanOrEqual((R[p].max - R[p].min) / 8 + 1e-12)
          }
        }
      }
    }
  })
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/shared/radioFoldStep.test.ts`
Expected: FAIL. `radioFoldDriftRange` is not exported, so the file fails to load.

- [ ] **Step 3: Implement.**

In `src/shared/radioFold.ts`, replace:

```ts
/** Where drift may go, and where it rests. The cutoff never closes (0.62 is about 1.4 kHz). */
export const FOLD_DRIFT_RANGE: Readonly<
  Record<FoldDriftParam, { min: number; max: number; rest: number }>
> = Object.freeze({
  cutoff: { min: 0.62, max: 1, rest: 1 },
  send: { min: 0, max: 0.15, rest: 0 },
  dub: { min: 0, max: 0.18, rest: 0 }
})
```

with:

```ts
export type FoldDriftRange = Readonly<
  Record<FoldDriftParam, { min: number; max: number; rest: number }>
>
/** Where drift may go at a bend (0..100), and where it rests (v2 section 1, "audible drift"): the
 * cutoff from 1 down to 0.62 - 0.22b (0.4 at bend 100; never closed), the added reverb send up to
 * 0.15 + 0.15b, the dub send up to 0.18 + 0.17b (sends only ever added). */
export function radioFoldDriftRange(bend: number): FoldDriftRange {
  const b = normalizeFoldAmount(bend, DEFAULT_RADIO_FOLD) / 100
  return {
    cutoff: { min: 0.62 - 0.22 * b, max: 1, rest: 1 },
    send: { min: 0, max: 0.15 + 0.15 * b, rest: 0 },
    dub: { min: 0, max: 0.18 + 0.17 * b, rest: 0 }
  }
}
/** The range at bend 0: v1's fixed range (0.62 is about 1.4 kHz). */
export const FOLD_DRIFT_RANGE: FoldDriftRange = Object.freeze(radioFoldDriftRange(0))
```

In `src/shared/radioFold.ts`, replace:

```ts
  for (const row of audible) {
    const d: RowDrift = { ...(s.drift[row.id] ?? restingDrift(lap)) }
    for (const p of FOLD_DRIFT_PARAMS) {
      if (lap >= d[p].startLap + d[p].laps) {
        const range = FOLD_DRIFT_RANGE[p]
```

with:

```ts
  const ranges = radioFoldDriftRange(input.fold)
  for (const row of audible) {
    const d: RowDrift = { ...(s.drift[row.id] ?? restingDrift(lap)) }
    for (const p of FOLD_DRIFT_PARAMS) {
      if (lap >= d[p].startLap + d[p].laps) {
        const range = ranges[p]
```

- [ ] **Step 4: Run them and see them pass.**

Run: `npx vitest run src/shared/radioFold`
Expected: PASS (75 tests across the fold files).

- [ ] **Step 5: Commit.**

```bash
git add src/shared/radioFold.ts src/shared/radioFoldStep.test.ts
git commit -F - <<'EOF'
radio fold v2: drift scales with bend -- cutoff down to 0.4, reverb send to 0.3, dub to 0.35 at bend 100; v1's range at bend 0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 4: Re-fold at realignment, and rotation (shared)

**Repo:** sssketch.
**Files:** Modify `src/shared/radioFold.ts`, `src/shared/radioFoldStep.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - The new fixtures: `WIDE` has two 4-bar rhythmic rows, so the low menu has two lengths to re-fold between and a fold has somewhere to rotate.
  - The four-step test now runs over several seeds, because v2's added draws move which seed reaches the 4-step curve.
  - The walk-back test is rewritten for re-folds.
  - A new `describe` covers re-fold and rotation.

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  createRadioFold,
  foldSeedKey,
  radioFoldDriftRange,
```

with:

```ts
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  FOLD_ROTATE_AFTER_REALIGNS,
  createRadioFold,
  foldSeedKey,
  radioFoldDriftRange,
```

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
    let checked = 0
    let fourStep = 0
    // 40 keeps to 8 -> 7; 90 reaches 8 -> 3, which takes four distinct lengths
    for (const fold of [40, 90]) {
      const steps = run('k3x9pq', 400, () => input(fold))
```

with:

```ts
    let checked = 0
    let fourStep = 0
    // 40 keeps to 8 -> 7; 90 reaches 8 -> 3, which takes four distinct lengths
    for (const [fold, seed] of [40, 90].flatMap((f) => SEEDS.map((sd) => [f, sd] as const))) {
      const steps = run(seed, 400, () => input(fold))
```

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
  it("unfolding walks back the same way: the fold's own lengths in reverse, then full", () => {
    let checked = 0
    for (const fold of [40, 90]) {
      const steps = run('k3x9pq', 600, () => input(fold))
      // every length each row's fold restarted on, from its first folded lap until it leaves
      const open = new Map<string, { out: number[]; back: number[] }>()
      for (const s of steps) {
        for (const [rowId, ep] of open) {
          if (s.state.rows.some((r) => r.rowId === rowId)) continue
          expect(ep.back).toEqual(ep.out.slice(0, -1).reverse())
          if (ep.out.length > 1) checked++
          open.delete(rowId)
        }
        for (const r of s.state.rows) {
          if (r.originLap !== s.lap) continue
          const ep = open.get(r.rowId) ?? { out: [], back: [] }
          open.set(r.rowId, ep)
          ;(r.mode === 'unfolding' ? ep.back : ep.out).push(r.cycleBeats)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
```

with:

```ts
  it("unfolding walks back the way it came: up through the fold's own lengths, then full", () => {
    let checked = 0
    let refolded = 0
    for (const [fold, rows] of [
      [40, BAND],
      [90, BAND],
      [40, WIDE],
      [90, WIDE]
    ] as const) {
      const steps = run('k3x9pq', 600, () => input(fold, rows))
      // every length each row's fold restarted on, from its first folded lap until it leaves
      const open = new Map<string, { out: number[]; back: number[]; refolded: boolean }>()
      for (const s of steps) {
        for (const [rowId, ep] of open) {
          if (s.state.rows.some((r) => r.rowId === rowId)) continue
          // never shrinking on the way back, and only through lengths the fold played
          for (let k = 1; k < ep.back.length; k++)
            expect(ep.back[k]).toBeGreaterThan(ep.back[k - 1])
          for (const b of ep.back) expect(ep.out).toContain(b)
          // a fold that never re-folded walks its own steps back exactly (v1)
          if (!ep.refolded) expect(ep.back).toEqual(ep.out.slice(0, -1).reverse())
          else refolded++
          if (ep.out.length > 1) checked++
          open.delete(rowId)
        }
        for (const r of s.state.rows) {
          if (r.originLap !== s.lap) continue
          const ep = open.get(r.rowId) ?? { out: [], back: [], refolded: false }
          open.set(r.rowId, ep)
          if (r.mode === 'refolding') ep.refolded = true
          ;(r.mode === 'unfolding' ? ep.back : ep.out).push(r.cycleBeats)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(refolded).toBeGreaterThan(0)
  })
```

In `src/shared/radioFoldStep.test.ts`, replace:

```ts
const input = (fold: number, rows: RadioFoldRow[] = BAND): RadioFoldInput => ({
```

with:

```ts
/** BAND plus two 4-bar rhythmic rows: below bend 50 a 2-bar row has one length (7; 9 is longer
 * than it), a 4-bar row two (7 and 9), so it can re-fold, and a fold has a row to rotate to. */
const WIDE: RadioFoldRow[] = [
  ...BAND,
  row('clap', { kinds: ['rhythmic'], barLength: 4 }),
  row('shaker', { kinds: ['rhythmic'], barLength: 4 })
]

const SEEDS = ['k3x9pq', 'autech', 'gae4rb', 'qb78ma']

const input = (fold: number, rows: readonly RadioFoldRow[] = BAND): RadioFoldInput => ({
```

Append to the end of `src/shared/radioFoldStep.test.ts`:

```ts

describe('stepRadioFold v2: re-fold and rotate', () => {
  /** Every top where a settled fold met its own realignment and stayed in (no rotation, no
   * unfold), and whether it re-folded there. */
  function realignTops(fold: number): { tops: number; refolds: number } {
    let tops = 0
    let refolds = 0
    for (const seed of SEEDS) {
      const steps = run(seed, 600, () => input(fold, WIDE))
      for (let i = 1; i < steps.length; i++) {
        for (const p of steps[i - 1].state.rows) {
          if (p.mode !== 'settled' || p.unfoldSince !== null) continue
          if (((steps[i].lap - p.originLap) * 32) % (p.cycleBeats * 2) !== 0) continue
          const r = steps[i].state.rows.find((x) => x.rowId === p.rowId)
          if (!r || r.mode === 'unfolding' || steps[i].stretch !== 'folded') continue
          // a 4-bar row: below bend 50 a 2-bar row has no other length to go to
          if (p.fullBeats !== 16) continue
          tops++
          if (r.mode === 'refolding') refolds++
        }
      }
    }
    return { tops, refolds }
  }

  it('re-folds only on its own realignment top, to another length or phase from the menu, in the window', () => {
    let refolds = 0
    let phaseOnly = 0
    for (const fold of [40, 90]) {
      for (const seed of SEEDS) {
        const steps = run(seed, 400, () => input(fold, WIDE))
        for (let i = 1; i < steps.length; i++) {
          for (const r of steps[i].state.rows) {
            const p = steps[i - 1].state.rows.find((x) => x.rowId === r.rowId)
            if (!p || p.mode !== 'settled' || r.mode !== 'refolding') continue
            refolds++
            // whole laps since its origin are a whole number of its cycles: a realignment
            expect(((steps[i].lap - p.originLap) * 32) % (p.cycleBeats * 2)).toBe(0)
            expect(steps[i].marked).toBe(true)
            expect(r.originLap).toBe(steps[i].lap)
            expect([r.targetBeats, r.phaseBeats]).not.toEqual([p.targetBeats, p.phaseBeats])
            expect(radioFoldAllowedCycles(16, 120)).toContain(r.targetBeats)
            expect(r.targetBeats).toBeLessThan(r.fullBeats)
            if (r.targetBeats === p.targetBeats) {
              phaseOnly++
              // a phase-only re-fold needs a menu with offsets: bend 50 and up
              expect(fold).toBeGreaterThanOrEqual(50)
            }
          }
        }
      }
    }
    expect(refolds).toBeGreaterThan(0)
    expect(phaseOnly).toBeGreaterThan(0)
  })

  it('a re-fold lands in one or two steps and is settled on the top after', () => {
    let checked = 0
    for (const seed of SEEDS) {
      const steps = run(seed, 400, () => input(90, WIDE))
      for (let i = 1; i + 1 < steps.length; i++) {
        for (const r of steps[i].state.rows) {
          const p = steps[i - 1].state.rows.find((x) => x.rowId === r.rowId)
          if (!p || p.mode !== 'settled' || r.mode !== 'refolding') continue
          const after = steps[i + 1].state.rows.find((x) => x.rowId === r.rowId)
          if (!after || after.mode === 'unfolding') continue
          expect(after.mode).toBe('settled')
          expect(after.cycleBeats).toBe(r.targetBeats)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("re-folds more often at a higher bend (0.3 + 0.4 x bend's chance)", () => {
    const low = realignTops(40)
    const high = realignTops(100)
    expect(low.tops).toBeGreaterThan(20)
    expect(high.tops).toBeGreaterThan(20)
    const lowRate = low.refolds / low.tops
    const highRate = high.refolds / high.tops
    expect(lowRate).toBeGreaterThan(0.25)
    expect(lowRate).toBeLessThan(0.7)
    expect(highRate).toBeGreaterThan(lowRate)
  })

  it('a fold rotates out after its drawn 2-4 realignment tops; its replacement folds in on the top it leaves', () => {
    let rotations = 0
    let landed = 0
    for (const fold of [40, 90]) {
      for (const seed of SEEDS) {
        const steps = run(seed, 600, () => input(fold, WIDE))
        for (let i = 1; i < steps.length; i++) {
          const rot = steps[i].state.rotate
          if (!rot || steps[i - 1].state.rotate) continue
          rotations++
          const was = steps[i - 1].state.rows.find((r) => r.rowId === rot.from)!
          const from = steps[i].state.rows.find((r) => r.rowId === rot.from)!
          expect(was.mode).toBe('settled')
          expect(from.mode).toBe('unfolding')
          expect(from.realigns).toBe(from.rotateAfter)
          expect(from.rotateAfter).toBeGreaterThanOrEqual(FOLD_ROTATE_AFTER_REALIGNS.min)
          expect(from.rotateAfter).toBeLessThanOrEqual(FOLD_ROTATE_AFTER_REALIGNS.max)
          expect(rot.to).not.toBe(rot.from)
          // nothing new folds while it walks back
          let j = i + 1
          while (j < steps.length && steps[j].state.rows.some((r) => r.rowId === rot.from)) {
            const fresh = steps[j].state.rows.filter(
              (r) => !steps[j - 1].state.rows.some((x) => x.rowId === r.rowId)
            )
            expect(fresh).toEqual([])
            j++
          }
          // on the top it has left, its replacement folds in (a stretch ending first stops it)
          if (j < steps.length && steps[j].stretch === 'folded') {
            const to = steps[j].state.rows.find((r) => r.rowId === rot.to)
            expect(to?.originLap).toBe(steps[j].lap)
            landed++
          }
        }
      }
    }
    expect(rotations).toBeGreaterThan(0)
    expect(landed).toBeGreaterThan(0)
  })

  it('never more rows than the bend allows, through re-folds and rotations', () => {
    for (const seed of SEEDS) {
      for (const fold of [40, 59, 60, 100]) {
        for (const s of run(seed, 400, () => input(fold, WIDE))) {
          expect(s.cycles.length).toBeLessThanOrEqual(fold < 60 ? 1 : FOLD_MAX_ROWS)
        }
      }
    }
  })

  it('the same seed and events give the same decisions, and a JSON round trip changes nothing', () => {
    const a = run('k3x9pq', 400, () => input(90, WIDE))
    expect(run('k3x9pq', 400, () => input(90, WIDE))).toEqual(a)
    const mid = JSON.parse(JSON.stringify(a[150].state)) as RadioFoldState
    const rest = run('k3x9pq', 249, () => input(90, WIDE), mid)
    expect(rest).toEqual(a.slice(151))
  })

  it('a state saved before v2 (no rotation, no realign count) steps on', () => {
    const a = run('k3x9pq', 200, () => input(90, WIDE))
    const old = JSON.parse(JSON.stringify(a[120].state)) as Partial<RadioFoldState>
    delete old.rotate
    for (const r of old.rows ?? []) {
      delete (r as { realigns?: number }).realigns
      delete (r as { rotateAfter?: number }).rotateAfter
    }
    const steps = run('k3x9pq', 80, () => input(90, WIDE), old as RadioFoldState)
    expect(steps).toEqual(run('k3x9pq', 80, () => input(90, WIDE), old as RadioFoldState))
    for (const s of steps) expect(s.cycles.length).toBeLessThanOrEqual(FOLD_MAX_ROWS)
  })
})
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/shared/radioFoldStep.test.ts`
Expected: FAIL. With no `refolding` mode and no `rotate` yet, the new `describe`'s counts (`refolds`, `phaseOnly`, `rotations`, `checked`) are 0. The rewritten walk-back test's `refolded` is 0 too.

- [ ] **Step 3: Implement.**

In `src/shared/radioFold.ts`, replace:

```ts
/** The pace window while the mode is on (spec section 1): it replaces the user's. 8-32 bars
 * since v2 (2026-10-03-radio-fold-v2-design.md section 1: "faster changes"), 16-64 before. */
export const FOLD_PACE_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 8,
  max: 32
})
```

with:

```ts
/** The pace window while the mode is on (spec section 1): it replaces the user's. 8-32 bars
 * since v2 (2026-10-03-radio-fold-v2-design.md section 1: "faster changes"), 16-64 before. */
export const FOLD_PACE_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 8,
  max: 32
})
/** A settled fold re-folds at its own realignment top with this chance, from bend 0 to 100
 * (v2 section 1): to a new length, or a new phase where the bend's menu has offsets. */
export const FOLD_REFOLD_CHANCE: Readonly<{ atNone: number; atFull: number }> = Object.freeze({
  atNone: 0.3,
  atFull: 0.7
})
/** A fold rotates out after this many of its own realignment tops, drawn per fold (v2 section 1),
 * when another row could take its place. */
export const FOLD_ROTATE_AFTER_REALIGNS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 2,
  max: 4
})
```

In `src/shared/radioFold.ts`, replace:

```ts
  mode: 'folding' | 'settled' | 'unfolding'
  /** The lap it was asked to unfold on (the stretch ended), or null. */
  unfoldSince: number | null
  serial: number
}
```

with:

```ts
  /** `refolding`: a settled fold moving to a new length or phase at its realignment top (v2),
   * one or two lengths, and settled again on the top after it lands. */
  mode: 'folding' | 'settled' | 'unfolding' | 'refolding'
  /** The lap it was asked to unfold on (the stretch ended), or null. */
  unfoldSince: number | null
  serial: number
  /** Its own realignment tops passed settled, and how many it rotates out after (drawn,
   * FOLD_ROTATE_AFTER_REALIGNS). Absent in a state saved before v2: none, and the most. */
  realigns?: number
  rotateAfter?: number
}
```

In `src/shared/radioFold.ts`, replace:

```ts
  /** The decided lap's top is a realignment (radioFoldMarkedBarsAhead reads it). */
  marked: boolean
}
```

with:

```ts
  /** The decided lap's top is a realignment (radioFoldMarkedBarsAhead reads it). */
  marked: boolean
  /** A rotation under way (v2): `from` walks back out, and `to` folds in on the top `from` has
   * left. Absent in a state saved before v2: none. */
  rotate?: { from: string; to: string } | null
}
```

In `src/shared/radioFold.ts`, replace:

```ts
    serial: 0,
    marked: false
  }
}
```

with:

```ts
    serial: 0,
    marked: false,
    rotate: null
  }
}
```

In `src/shared/radioFold.ts`, replace:

```ts
  const restart = (r: RadioFoldRowState): void => {
    r.originLap = lap
    r.serial = ++s.serial
  }
```

with:

```ts
  const restart = (r: RadioFoldRowState): void => {
    r.originLap = lap
    r.serial = ++s.serial
  }
  /** Rows that may start a fold on this top: foldable, with a target at this bend, not already
   * folded and not just left (a row that leaves plays full length for at least this top). */
  const foldable = (): RadioFoldRow[] => {
    const taken = new Set(s.rows.map((r) => r.rowId))
    return input.rows.filter(
      (row) =>
        !taken.has(row.id) &&
        !left.has(row.id) &&
        radioFoldCanFold(row, anchorId) &&
        foldTargets(row, loopBeats, input.bpm, f).length > 0
    )
  }
```

In `src/shared/radioFold.ts`, replace:

```ts
  // 3. Unfolding starts: at once while still folding or outside the window, else on the row's own
```

with:

```ts
  // 2b. A settled fold's own realignment top (v2 section 1). It counts the top; once it has passed
  //     its drawn count it rotates out if another row could take its place -- it walks back from
  //     here (3), and that row folds in on the top the walk-back ends (5). Otherwise it re-folds
  //     by the bend's chance: a new length from the bend's menu (never its own) in one or two
  //     steps, or, where the menu has offsets (bend 50 and up), the same length at a new phase.
  //     Only in a folded stretch, never a fold already asked to leave.
  if (s.stretch === 'folded' && f > 0) {
    for (const r of s.rows) {
      if (r.mode !== 'settled' || r.unfoldSince !== null || !realignsAt(r, lap, loopBeats)) continue
      r.realigns = (r.realigns ?? 0) + 1
      if (
        (s.rotate ?? null) === null &&
        r.realigns >= (r.rotateAfter ?? FOLD_ROTATE_AFTER_REALIGNS.max)
      ) {
        const others = foldable()
        if (others.length > 0) {
          s.rotate = { from: r.rowId, to: pickFrom(others, draw()).id }
          r.unfoldSince = lap
          continue
        }
      }
      if (draw() >= lerp(FOLD_REFOLD_CHANCE.atNone, FOLD_REFOLD_CHANCE.atFull, f)) continue
      const row = byId.get(r.rowId)!
      const lengths = foldTargets(row, loopBeats, input.bpm, f).filter((c) => c !== r.targetBeats)
      const phases = phaseMenu(f)
      const otherPhases = phases.filter((p) => p !== r.phaseBeats)
      // null: the same length at a new phase
      const choices: (number | null)[] = [...lengths, ...(otherPhases.length > 0 ? [null] : [])]
      if (choices.length === 0) continue
      const pick = pickFrom(choices, draw())
      r.mode = 'refolding'
      if (pick === null) {
        r.phaseBeats = pickFrom(otherPhases, draw())
        r.path = []
      } else {
        r.phaseBeats = pickFrom(phases, draw())
        r.targetBeats = pick
        r.path = radioFoldPath(r.cycleBeats, pick, 1 + Math.floor(draw() * 2))
        r.cycleBeats = r.path.shift() ?? pick
        // the walk back out passes only lengths it played longer than the new target, at most
        // three of them, the nearest: an unfold stays three steps at most, as in v1
        r.walk = [...(r.walk ?? []).filter((w) => w > pick).slice(-3), pick]
      }
      restart(r)
    }
  }

  // 3. Unfolding starts: at once while still folding or outside the window, else on the row's own
```

In `src/shared/radioFold.ts`, replace:

```ts
    const due =
      r.mode === 'folding' ||
      outside.has(r.rowId) ||
```

with:

```ts
    const due =
      r.mode === 'folding' ||
      r.mode === 'refolding' ||
      outside.has(r.rowId) ||
```

In `src/shared/radioFold.ts`, replace:

```ts
    r.path =
      r.walk !== undefined
        ? [...r.walk.slice(0, -1).reverse(), r.fullBeats]
        : radioFoldPath(r.cycleBeats, r.fullBeats, 3)
```

with:

```ts
    const from = r.cycleBeats
    r.path =
      r.walk !== undefined
        ? [
            ...r.walk
              .slice(0, -1)
              .reverse()
              .filter((w) => w > from),
            r.fullBeats
          ]
        : radioFoldPath(r.cycleBeats, r.fullBeats, 3)
```

In `src/shared/radioFold.ts`, replace:

```ts
    const next = r.path.shift()
    if (next === undefined) {
      if (r.mode === 'folding') r.mode = 'settled'
      continue
    }
    r.cycleBeats = next
    restart(r)
    if (r.mode === 'folding') r.walk?.push(next)
    if (r.path.length === 0 && r.mode === 'folding') r.mode = 'settled'
  }
```

with:

```ts
    const next = r.path.shift()
    if (next === undefined) {
      if (r.mode === 'folding' || r.mode === 'refolding') r.mode = 'settled'
      continue
    }
    r.cycleBeats = next
    restart(r)
    if (r.mode === 'folding') r.walk?.push(next)
    if (r.path.length === 0 && (r.mode === 'folding' || r.mode === 'refolding')) r.mode = 'settled'
  }
```

In `src/shared/radioFold.ts`, replace:

```ts
  // 5. New folds, only in a folded stretch: one at once when none is folding, a second (high
  //    `fold` only) on a realignment top, half the time. A row still walking back holds its
  //    place against the most rows at once, so below fold 60 one row at a time it is.
  if (s.stretch === 'folded' && f > 0) {
    const active = s.rows.filter((r) => r.unfoldSince === null).length
    const may = s.rows.length < maxRows(f) && (active === 0 || (marked && draw() < 0.5))
    if (may) {
      const taken = new Set(s.rows.map((r) => r.rowId))
      const candidates = input.rows.filter(
        (row) =>
          !taken.has(row.id) &&
          !left.has(row.id) &&
          radioFoldCanFold(row, anchorId) &&
          foldTargets(row, loopBeats, input.bpm, f).length > 0
      )
      if (candidates.length > 0) {
        const row = pickFrom(candidates, draw())
        const target = pickFrom(foldTargets(row, loopBeats, input.bpm, f), draw())
        const phase = pickFrom(phaseMenu(f), draw())
        const full = row.barLength * 4
        const path = radioFoldPath(full, target, 2 + Math.floor(draw() * 3))
        const first = path.shift() ?? target
        s.rows.push({
          rowId: row.id,
          stemId: row.stemId!,
          fullBeats: full,
          targetBeats: target,
          cycleBeats: first,
          phaseBeats: phase,
          originLap: lap,
          path,
          walk: [first],
          mode: path.length === 0 ? 'settled' : 'folding',
          unfoldSince: null,
          serial: ++s.serial
        })
      }
    }
  }
```

with:

```ts
  // 5. New folds, only in a folded stretch: one at once when none is folding, a second (high
  //    `fold` only) on a realignment top, half the time. A row still walking back holds its
  //    place against the most rows at once, so below fold 60 one row at a time it is. A rotation
  //    (2b) holds every other new fold back until its `from` has left; on that top its `to` folds
  //    in, if it still may (else the usual pick).
  if (s.stretch !== 'folded' || f === 0) s.rotate = null
  if (s.stretch === 'folded' && f > 0) {
    let row: RadioFoldRow | undefined
    const rotate = s.rotate ?? null
    if (rotate !== null && !s.rows.some((r) => r.rowId === rotate.from)) {
      s.rotate = null
      if (s.rows.length < maxRows(f)) row = foldable().find((x) => x.id === rotate.to)
    }
    if (row === undefined && (s.rotate ?? null) === null) {
      const active = s.rows.filter((r) => r.unfoldSince === null).length
      const may = s.rows.length < maxRows(f) && (active === 0 || (marked && draw() < 0.5))
      const candidates = may ? foldable() : []
      if (candidates.length > 0) row = pickFrom(candidates, draw())
    }
    if (row !== undefined) {
      const target = pickFrom(foldTargets(row, loopBeats, input.bpm, f), draw())
      const phase = pickFrom(phaseMenu(f), draw())
      const full = row.barLength * 4
      const path = radioFoldPath(full, target, 2 + Math.floor(draw() * 3))
      const first = path.shift() ?? target
      const { min, max } = FOLD_ROTATE_AFTER_REALIGNS
      const rotateAfter = min + Math.floor(draw() * (max - min + 1))
      s.rows.push({
        rowId: row.id,
        stemId: row.stemId!,
        fullBeats: full,
        targetBeats: target,
        cycleBeats: first,
        phaseBeats: phase,
        originLap: lap,
        path,
        walk: [first],
        mode: path.length === 0 ? 'settled' : 'folding',
        unfoldSince: null,
        serial: ++s.serial,
        realigns: 0,
        rotateAfter
      })
    }
  }
```

- [ ] **Step 4: Run them and see them pass.**

Run: `npx vitest run src/shared/radioFold src/shared/radioSchedule.test.ts`
Expected: PASS. The fold files have 82 tests.

- [ ] **Step 5: Commit.**

```bash
git add src/shared/radioFold.ts src/shared/radioFoldStep.test.ts
git commit -F - <<'EOF'
radio fold v2: a settled fold re-folds at its realignment top (0.3-0.7 by bend; a new length, or a new phase from bend 50) and rotates out after 2-4 realignments, its replacement folding in on the top it leaves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 5: `radioFoldStatus`, the row readout and the phase dot (shared)

**Repo:** sssketch.
**Files:** Create `src/shared/radioFoldStatus.ts` and `src/shared/radioFoldStatus.test.ts`. Modify `src/shared/radioFold.ts`.

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioFoldStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  createRadioFold,
  stepRadioFold,
  type RadioFoldInput,
  type RadioFoldRow,
  type RadioFoldState,
  type RadioFoldStep
} from './radioFold'
import {
  radioFoldBeatsIn,
  radioFoldBeatsLabel,
  radioFoldPhaseDot,
  radioFoldRowLabel,
  radioFoldStatus
} from './radioFoldStatus'

const row = (id: string, over: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-stem`,
  kinds: ['rhythmic'],
  barLength: 2,
  hooked: false,
  audible: true,
  percussive: false,
  ...over
})

const BAND: RadioFoldRow[] = [
  row('drums', { kinds: ['drums'], barLength: 4 }),
  row('hats', { kinds: ['drums'], barLength: 1 }),
  row('perc', { kinds: ['rhythmic'], barLength: 2 }),
  row('lead', { kinds: ['lead'], barLength: 4 })
]

const input = (fold: number): RadioFoldInput => ({ rows: BAND, loopBars: 4, bpm: 120, fold })

/** perc settled at 7 beats from lap 0 on a 16-beat loop, decided up to `lap`: it realigns every
 * 7 laps (112 beats). */
const settled = (lap: number): RadioFoldState => ({
  ...createRadioFold('k3x9pq'),
  lap,
  loopBeats: 16,
  bpm: 120,
  stretch: 'folded',
  stretchEndsLap: 1000,
  rows: [
    {
      rowId: 'perc',
      stemId: 'perc-stem',
      fullBeats: 8,
      targetBeats: 7,
      cycleBeats: 7,
      phaseBeats: 0,
      originLap: 0,
      path: [],
      walk: [7],
      mode: 'settled',
      unfoldSince: null,
      serial: 1,
      realigns: 0,
      rotateAfter: 4
    }
  ]
})

function run(seed: string, wraps: number, fold: number): RadioFoldStep[] {
  const out: RadioFoldStep[] = []
  let s = createRadioFold(seed)
  for (let i = 0; i < wraps; i++) {
    const step = stepRadioFold(s, input(fold))
    out.push(step)
    s = step.state
  }
  return out
}

describe('radioFoldStatus', () => {
  it('is null with no machine, or one that has not stepped', () => {
    expect(radioFoldStatus(null, null, 4, 40, 12)).toBeNull()
    expect(radioFoldStatus(createRadioFold('k3x9pq'), null, 4, 40, 12)).toBeNull()
  })

  it('folded: the rows, the next realignment and the next change, in one line', () => {
    const now = stepRadioFold(settled(4), input(40)) // decides lap 5, which plays next
    const next = stepRadioFold(now.state, input(40)) // decides lap 6; lap 5 plays
    const st = radioFoldStatus(next.state, now, 4, 40, 19.6)!
    expect(st.stretch).toBe('folded')
    expect(st.rows).toEqual([
      { rowId: 'perc', cycleBeats: 7, fullBeats: 8, phaseBeats: 0, mode: 'settled', lapsIn: 5 }
    ])
    // lap 7 is its realignment: two tops on from lap 5's
    expect(st.realignsInLaps).toBe(2)
    expect(st.nextChangeBars).toBe(20)
    expect(st.summary).toBe('folded · 1 row · realigns in 2 laps · next change ~20 bars')
  })

  it("the decided lap's own top marked is a realignment in 1 lap", () => {
    const now = stepRadioFold(settled(5), input(40)) // decides lap 6
    const next = stepRadioFold(now.state, input(40)) // decides lap 7: marked
    expect(next.marked).toBe(true)
    const st = radioFoldStatus(next.state, now, 4, 40, null)!
    expect(st.realignsInLaps).toBe(1)
    expect(st.summary).toBe('folded · 1 row · realigns in 1 lap')
  })

  it('folded with nothing that may fold says so', () => {
    const rows = [
      row('drums', { kinds: ['drums'], barLength: 4 }),
      row('lead', { kinds: ['lead'] })
    ]
    const a = stepRadioFold(createRadioFold('k3x9pq'), { ...input(40), rows })
    const b = stepRadioFold(a.state, { ...input(40), rows })
    expect(radioFoldStatus(b.state, a, 4, 40, 8)!.summary).toBe(
      'folded · nothing to fold · next change ~8 bars'
    )
  })

  it('straight: when the next folded stretch starts, or just straight at bend 0', () => {
    let seen = 0
    const steps = run('k3x9pq', 300, 40)
    for (let i = 1; i < steps.length; i++) {
      const now = steps[i - 1]
      if (now.stretch !== 'straight' || now.cycles.length > 0) continue
      const st = radioFoldStatus(steps[i].state, now, 4, 40, 12)!
      const laps = Math.max(1, steps[i].state.stretchEndsLap - now.lap)
      expect(st.summary).toBe(`straight · folding in ${laps} lap${laps === 1 ? '' : 's'}`)
      seen++
    }
    expect(seen).toBeGreaterThan(0)
    const zero = run('k3x9pq', 20, 0)
    expect(radioFoldStatus(zero[19].state, zero[18], 4, 0, 12)!.summary).toBe('straight')
  })

  it('straight while folds still walk back reads unfolding', () => {
    const steps = run('k3x9pq', 300, 40)
    const i = steps.findIndex((s, k) => k > 0 && s.stretch === 'straight' && s.cycles.length > 0)
    expect(i).toBeGreaterThan(0)
    expect(radioFoldStatus(steps[i + 1].state, steps[i], 4, 40, 12)!.summary).toBe(
      'straight · unfolding'
    )
  })
})

describe('the row readout and the phase dot', () => {
  it('a cycle against the loop in beats, a half as ½', () => {
    expect(radioFoldRowLabel(7, 16)).toBe('7 / 16')
    expect(radioFoldRowLabel(3.5, 16)).toBe('3½ / 16')
    expect(radioFoldRowLabel(5.5, 8)).toBe('5½ / 8')
    expect(radioFoldBeatsLabel(0.5)).toBe('½')
  })

  it('the dot goes round the cycle and sits on the downbeat at realignment', () => {
    expect(radioFoldPhaseDot(7, 0, 0)).toBe(0)
    expect(radioFoldPhaseDot(7, 0, 3.5)).toBeCloseTo(0.5, 12)
    // 7 against 16 realigns after 112 beats: seven laps
    expect(radioFoldPhaseDot(7, 0, 112)).toBe(0)
    expect(radioFoldPhaseDot(7, 0, 16)).toBeCloseTo(2 / 7, 12)
    // a phase offset: the cycle starts that much later
    expect(radioFoldPhaseDot(7, 0.25, 0.25)).toBe(0)
    expect(radioFoldPhaseDot(7, 0.25, 0)).toBeCloseTo(6.75 / 7, 12)
    expect(radioFoldPhaseDot(0, 0, 3)).toBe(0)
  })

  it('beats in: whole laps since its origin plus the position in the lap playing', () => {
    const r = {
      rowId: 'p',
      cycleBeats: 7,
      fullBeats: 8,
      phaseBeats: 0,
      mode: 'settled' as const,
      lapsIn: 6
    }
    expect(radioFoldBeatsIn(r, 4, 0)).toBe(96)
    expect(radioFoldBeatsIn(r, 4, 4)).toBe(112)
    expect(radioFoldPhaseDot(7, 0, radioFoldBeatsIn({ ...r, lapsIn: 7 }, 4, 0))).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and see it fail.**

Run: `npx vitest run src/shared/radioFoldStatus.test.ts`
Expected: FAIL with `Failed to resolve import "./radioFoldStatus"`.

- [ ] **Step 3: Implement.** First export the realignment test from `radioFold.ts`:

In `src/shared/radioFold.ts`, replace:

```ts
/** Whether a row's cycle lines up with the loop at the top of `lap`. */
function realignsAt(r: RadioFoldRowState, lap: number, loopBeats: number): boolean {
  if (lap <= r.originLap) return false
  return ((lap - r.originLap) * halves(loopBeats)) % halves(r.cycleBeats) === 0
}
```

with:

```ts
/** Whether a row's cycle lines up with the loop at the top of `lap`. */
function realignsAt(r: RadioFoldRowState, lap: number, loopBeats: number): boolean {
  if (lap <= r.originLap) return false
  return ((lap - r.originLap) * halves(loopBeats)) % halves(r.cycleBeats) === 0
}

/** realignsAt, for radioFoldStatus (radioFoldStatus.ts). */
export function radioFoldRowRealignsAt(
  r: RadioFoldRowState,
  lap: number,
  loopBeats: number
): boolean {
  return realignsAt(r, lap, loopBeats)
}
```

Then create `src/shared/radioFoldStatus.ts`:

```ts
// src/shared/radioFoldStatus.ts
//
// What fold mode is doing, said plainly (spec 2026-10-03-radio-fold-v2-design.md section 2): the
// status line both radios show while the mode is on, and each folded row's readout (`7 / 16`, its
// cycle against the loop in beats) with a phase dot that travels round the cycle and sits on the
// downbeat at realignment. Pure, and shared, so sssketch's Discover and the web radio say the same.

import {
  DEFAULT_RADIO_FOLD,
  normalizeFoldAmount,
  radioFoldRowRealignsAt,
  type RadioFoldRowState,
  type RadioFoldState,
  type RadioFoldStep
} from './radioFold'

/** How far ahead the status looks for a realignment, in laps. */
export const FOLD_STATUS_HORIZON_LAPS = 32

export interface RadioFoldStatusRow {
  rowId: string
  cycleBeats: number
  fullBeats: number
  phaseBeats: number
  mode: RadioFoldRowState['mode']
  /** Whole laps from the cycle's origin top to the top of the lap playing (0 on its first). */
  lapsIn: number
}

export interface RadioFoldStatus {
  stretch: 'folded' | 'straight'
  /** The rows folded in the lap playing. */
  rows: RadioFoldStatusRow[]
  /** Laps until the next realignment top, counted from the top of the lap playing; null for
   * none within FOLD_STATUS_HORIZON_LAPS. */
  realignsInLaps: number | null
  /** Bars until radio's next change, as the runtime counts it; null when it does not know. */
  nextChangeBars: number | null
  /** The one line: `folded · 2 rows · realigns in 3 laps · next change ~20 bars`. */
  summary: string
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The status for the lap playing. `state`: the machine's latest (it decided the lap after the
 * one playing, or the one playing until that step has run); `step`: the step that decided the
 * lap playing, null before there is one. `bend` is the `fold` fader (0 never folds again);
 * `intervalBarsLeft` the runtime's own count to the next change. Null without a machine. */
export function radioFoldStatus(
  state: RadioFoldState | null,
  step: RadioFoldStep | null,
  loopBars: number,
  bend: number,
  intervalBarsLeft: number | null
): RadioFoldStatus | null {
  if (state === null || state.lap < 0) return null
  const playing = step?.lap ?? state.lap - 1
  const stretch = step?.stretch ?? 'straight'
  const rows: RadioFoldStatusRow[] = (step?.state.rows ?? []).map((r) => ({
    rowId: r.rowId,
    cycleBeats: r.cycleBeats,
    fullBeats: r.fullBeats,
    phaseBeats: r.phaseBeats,
    mode: r.mode,
    lapsIn: Math.max(0, playing - r.originLap)
  }))
  const loopBeats = loopBars * 4
  let realignsInLaps: number | null = state.lap === playing + 1 && state.marked ? 1 : null
  if (loopBeats > 0) {
    for (let k = 1; k <= FOLD_STATUS_HORIZON_LAPS && realignsInLaps === null; k++) {
      const lap = playing + k
      const hit = state.rows.some(
        (r) =>
          r.mode === 'settled' &&
          r.unfoldSince === null &&
          radioFoldRowRealignsAt(r, lap, loopBeats)
      )
      if (hit) realignsInLaps = k
    }
  }
  const nextChangeBars =
    intervalBarsLeft !== null && Number.isFinite(intervalBarsLeft)
      ? Math.max(0, Math.round(intervalBarsLeft))
      : null
  const parts: string[] = [stretch]
  if (stretch === 'folded') {
    parts.push(rows.length === 0 ? 'nothing to fold' : plural(rows.length, 'row'))
    if (realignsInLaps !== null) parts.push(`realigns in ${plural(realignsInLaps, 'lap')}`)
    if (nextChangeBars !== null) parts.push(`next change ~${plural(nextChangeBars, 'bar')}`)
  } else if (rows.length > 0) {
    parts.push('unfolding')
  } else if (normalizeFoldAmount(bend, DEFAULT_RADIO_FOLD) > 0) {
    parts.push(`folding in ${plural(Math.max(1, state.stretchEndsLap - playing), 'lap')}`)
  }
  return { stretch, rows, realignsInLaps, nextChangeBars, summary: parts.join(' · ') }
}

/** Beats as the readout writes them: whole, or with a half as ½ (3.5 is `3½`). */
export function radioFoldBeatsLabel(beats: number): string {
  const whole = Math.floor(beats + 1e-9)
  const half = beats - whole >= 0.5 - 1e-9
  return half ? `${whole === 0 ? '' : whole}½` : String(whole)
}

/** A folded row's readout: its cycle against the loop, in beats (`7 / 16`, `3½ / 16`). */
export function radioFoldRowLabel(cycleBeats: number, loopBeats: number): string {
  return `${radioFoldBeatsLabel(cycleBeats)} / ${radioFoldBeatsLabel(loopBeats)}`
}

/** The phase dot, 0..1 round the cycle: ((beats since the cycle's origin - phase) mod cycle) /
 * cycle. 0 is the cycle's downbeat, where it sits when the row realigns with the loop. */
export function radioFoldPhaseDot(cycleBeats: number, phaseBeats: number, beatsIn: number): number {
  if (!(cycleBeats > 0) || !Number.isFinite(beatsIn)) return 0
  const x = (beatsIn - phaseBeats) % cycleBeats
  return (x < 0 ? x + cycleBeats : x) / cycleBeats
}

/** Beats since a status row's cycle began, at `posBars` into the lap playing. */
export function radioFoldBeatsIn(
  row: RadioFoldStatusRow,
  loopBars: number,
  posBars: number
): number {
  return (row.lapsIn * loopBars + posBars) * 4
}
```

- [ ] **Step 4: Run it, then typecheck and lint.**

Run: `npx vitest run src/shared/radioFold && npm run typecheck && npx eslint src/shared/radioFold*.ts`
Expected: 91 tests pass, typecheck is clean and lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add src/shared/radioFold.ts src/shared/radioFoldStatus.ts src/shared/radioFoldStatus.test.ts
git commit -F - <<'EOF'
radio fold v2: radioFoldStatus -- the status line, each folded row's cycle against the loop (7 / 16), and its phase dot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 6: Re-run the fuzzers with v2's invariants (scratch, no commit)

This derives rev6 from rev5's three-way fuzzer (`$SCRATCH/fm/rev5/fuzz.ts`, `fuzz_hi.ts`). It keeps every v1 invariant and adapts four of them to v2:
- The drift range follows the bend.
- `walk tail` skips `refolding`.
- Fold monotonicity runs only to the first re-fold.
- The reversed-walk check skips re-folded episodes.

It adds four checks:
- Re-folds only on marked tops.
- Rotations start from a settled fold.
- No new fold during a rotation walk-back.
- A v1-shaped legacy state, with none of the v2 fields, still steps.

- [ ] **Step 1: Write the generator.** Create `$SCRATCH/v2fuzz/fuzz_v2.py`:

```python
# Makes the v2 fuzzers from rev5's: python3 fuzz_v2.py <rev5 dir> <out dir> <shared dir>
import os, sys
src, out, shared = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
PAIRS = [
("""  FOLD_CYCLE_BEATS,
  createRadioFold,""", """  FOLD_CYCLE_BEATS,
  createRadioFold,
  radioFoldDriftRange,"""),
("""        const R = FOLD_DRIFT_RANGE[p]
        if (Math.min(x, y) < R.min - 1e-12 || Math.max(x, y) > R.max + 1e-12) fail(`drift ${p} out of range`, `${x} ${y}`)
        if (p !== 'cutoff' && Math.min(x, y) < 0) fail('send below 0', `${x}`)
        if (p === 'cutoff' && Math.min(x, y) < 0.62 - 1e-12) fail('cutoff closes', `${x}`)""",
"""        // v2: the range scales with bend; a sweep drawn at another bend stays inside bend 100's
        const R = radioFoldDriftRange(sc.constFold ? inp.fold : 100)[p]
        if (Math.min(x, y) < R.min - 1e-12 || Math.max(x, y) > R.max + 1e-12) fail(`drift ${p} out of range`, `${x} ${y}`)
        if (p !== 'cutoff' && Math.min(x, y) < 0) fail('send below 0', `${x}`)
        if (p === 'cutoff' && Math.min(x, y) < 0.4 - 1e-12) fail('cutoff closes', `${x}`)"""),
("""      if (r.walk && r.mode !== 'unfolding' && r.walk[r.walk.length - 1] !== r.cycleBeats) fail('walk tail != cycle', `${seed} lap ${i}`)""",
"""      if (r.walk && r.mode !== 'unfolding' && r.mode !== 'refolding' && r.walk[r.walk.length - 1] !== r.cycleBeats) fail('walk tail != cycle', `${seed} lap ${i}`)
      if (r.mode === 'refolding' && !(r.cycleBeats > 0 && r.cycleBeats < r.fullBeats)) fail('refold off range', `${seed} lap ${i}`)"""),
("""    if (st.cycles.length > 0) foldedSteps++""", """    if (st.cycles.length > 0) foldedSteps++
    // v2: a rotation starts on a settled fold's realignment top; nothing new folds while it walks back
    if (i > 0 && st.state.rotate && !a[i - 1].state.rotate) {
      rotations++
      const was = a[i - 1].state.rows.find((x) => x.rowId === st.state.rotate!.from)
      if (!was || was.mode !== 'settled') fail('rotation not from a settled fold', `${seed} lap ${i}`)
    }
    const pend = i > 0 ? a[i - 1].state.rotate : null
    if (pend && st.state.rows.some((x) => x.rowId === pend.from)) {
      for (const r of st.state.rows) if (!a[i - 1].state.rows.some((x) => x.rowId === r.rowId)) fail('new fold during a rotation walk-back', `${seed} lap ${i}`)
    }
    if (pend && !st.state.rows.some((x) => x.rowId === pend.from) && st.state.rows.some((x) => x.rowId === pend.to && x.originLap === i)) rotationsLanded++
    if (i > 0) for (const r of st.state.rows) {
      const p = a[i - 1].state.rows.find((x) => x.rowId === r.rowId)
      if (p && p.mode === 'settled' && r.mode === 'refolding') {
        refolds++
        if (!st.marked) fail('refold off a realignment top', `${seed} lap ${i}`)
      }
    }"""),
("""let legacyRuns = 0""", """let legacyRuns = 0
let refolds = 0
let refoldEpisodes = 0
let rotations = 0
let rotationsLanded = 0"""),
("""      const foldPart = lens.filter((x) => x.mode !== 'unfolding')""", """      // v2: a re-fold moves a settled fold on; the first fold-in is what runs to the first re-fold
      const firstRefold = lens.findIndex((x) => x.mode === 'refolding')
      const refolded = firstRefold >= 0
      if (refolded) refoldEpisodes++
      const foldPart = lens.slice(0, refolded ? firstRefold : lens.length).filter((x) => x.mode !== 'unfolding')"""),
("""        if (!leftEarly && JSON.stringify(want) !== JSON.stringify(unfoldPart.map((x) => x.cycle))) fail""",
 """        if (!leftEarly && !refolded && JSON.stringify(want) !== JSON.stringify(unfoldPart.map((x) => x.cycle))) fail"""),
("""console.log({ checkedEpisodes, twoRowSteps, foldedSteps, markedSteps, walkChecked, bpmChanges, loopChanges, legacyRuns })""",
 """console.log({ checkedEpisodes, twoRowSteps, foldedSteps, markedSteps, walkChecked, bpmChanges, loopChanges, legacyRuns, refolds, refoldEpisodes, rotations, rotationsLanded })"""),
# legacy state: v2 fields gone too
("""    delete old.bpm
    for (const r of old.rows) delete r.walk""", """    delete old.bpm
    delete old.rotate
    for (const r of old.rows) {
      delete r.walk
      delete r.realigns
      delete r.rotateAfter
    }"""),
]
for name in ['fuzz.ts', 'fuzz_hi.ts']:
    s = open(os.path.join(src, name)).read()
    s = s.replace('/Users/nickel/Claudecode/sssketch/src/shared', shared)
    for old, new in PAIRS:
        assert s.count(old) == 1, (name, old[:70], s.count(old))
        s = s.replace(old, new)
    open(os.path.join(out, name), 'w').write(s)
print('ok')
```

- [ ] **Step 2: Generate, bundle and run both fuzzers against the real shared code.**

```bash
SCRATCH=/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/2564036b-ae0a-45c2-9e3d-34f7c4f747fd/scratchpad
cd $SCRATCH/v2fuzz
python3 fuzz_v2.py $SCRATCH/fm/rev5 $SCRATCH/fm/rev6 /Users/nickel/Claudecode/sssketch/src/shared
for f in fuzz fuzz_hi; do
  /Users/nickel/Claudecode/sssketch/node_modules/.bin/esbuild $SCRATCH/fm/rev6/$f.ts --bundle --platform=node --outfile=$SCRATCH/fm/rev6/$f.js --log-level=error
  node $SCRATCH/fm/rev6/$f.js | tail -14
done
```

Expected:
- `fuzz`: `failures: { '2 cycles under 60 (any)': 1 }`. This is the documented fader-drop allowance (Spec point 19); any other key is a bug. It also prints `refolds` ≈ 1000, `rotations` ≈ 20 and `rotationsLanded` > 0.
- `fuzz_hi`: `failures: {}`, with `refolds` ≈ 4800 and `rotations` ≈ 90.

Paste both summaries into the Task 14 report.

## Task 7: Engine test, a phase-only re-fold crossfades (sssketch native)

**Repo:** sssketch.
**Files:** Modify `native-engine/Source/PlaybackEngineTests.cpp`.

The table already treats a changed id or phase as a change (`CycleTable.cpp`: `carried` needs the same id, length *and* phase). The existing tests cover a new length and a phased incoming cycle. This test pins v2's phase-only re-fold.

- [ ] **Step 1: Add the test.** In `native-engine/Source/PlaybackEngineTests.cpp`, replace:

```cpp
            // A stem whose head is not silence: unfolding at the top hands over to the straight stem,
```

with:

```cpp
            // v2's re-fold (spec 2026-10-03-radio-fold-v2-design section 1): a settled fold at its
            // realignment top may keep its length and take a new phase under a new id. The table
            // treats any change of id, length or phase as a change (CycleTable::apply's `carried`),
            // so it crossfades like every other fold step at a top: the outgoing 7-beat cycle is
            // 2 s into a tile at the top (0.125), the incoming 7 beats - a quarter beat in (0.42).
            beginTest("a re-fold to the same length at a new phase crossfades at the top");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_refold_phase_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                PlaybackEngine engine(cache);
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                std::vector<float> lap1;
                const double phase = 1.0 / 16.0; // a sixteenth of a bar: a quarter beat
                const float worst = acrossTop(engine, foldRow(7.0 / 4.0, phase, "perc~2"), channelChains, lap1);
                expect(worst < 0.002f, "largest step across a phase-only re-fold " + juce::String(worst));
                // past 10 ms it is the re-folded cycle at full gain, a quarter beat later on its grid
                const double inTileSec = std::fmod(-phase * 4.0 + 7.0 + 0.02, 7.0);
                expectWithinAbsoluteError(lap1[(size_t) (0.02 * 44100.0)], (float) (inTileSec / 16.0), 0.002f);
                ramp.deleteFile();
            }

            // A stem whose head is not silence: unfolding at the top hands over to the straight stem,
```

- [ ] **Step 2: Build and run the engine's tests.**

```bash
cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build
./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test PlaybackEngine
./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test CycleTable
```

Expected: both suites report 0 failures, including the new test.
- If the new test fails on the level check alone, print `lap1[882]`. The expected level at 0.02 s is `6.77 / 16 ≈ 0.4231`.
- If the step check fails, stop: that is a real click.
- If engine-spawn tests elsewhere fail with timeouts, check the memory note on coreaudiod's thread leak before blaming the code.

- [ ] **Step 3: Commit.**

```bash
cd /Users/nickel/Claudecode/sssketch
git add native-engine/Source/PlaybackEngineTests.cpp
git commit -F - <<'EOF'
engine test: a phase-only re-fold at the top (radio fold v2) crossfades like any other fold step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 8: Web, the view carries the status, faster changes, any-text seeds

**Repo:** ell.ing/radio. It needs Tasks 1–5 in sssketch's working tree.
**Files:** Modify `src/radio/step.ts`, `src/radio/step.test.ts`, `src/ui/foldPrefs.ts`, `src/ui/foldPrefs.test.ts`.

- [ ] **Step 1: Write the failing tests.**

In `src/radio/step.test.ts`, replace:

```ts
  it('changes come 16 to 64 bars apart while it is on', () => {
    const sim = new Sim(FOLD)
    sim.send({ type: 'play' })
    sim.run(0, 4)
    expect(sim.s.clock!.intervalBars).toBeGreaterThanOrEqual(16)
    expect(sim.s.clock!.intervalBars).toBeLessThanOrEqual(64 + 2 * 4)
  })
```

with:

```ts
  it('changes come 8 to 32 bars apart while it is on', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const sim = new Sim(FOLD, seeded(seed))
      sim.send({ type: 'play' })
      sim.run(0, 4)
      expect(sim.s.clock!.intervalBars).toBeGreaterThanOrEqual(8)
      expect(sim.s.clock!.intervalBars).toBeLessThanOrEqual(32 + 2 * 4)
    }
  })

  it('the view carries the fold status while the mode is on, and none with it off', () => {
    const sim = new Sim({ ...FOLD, fold: 100 })
    sim.send({ type: 'play' })
    sim.run(0, 120)
    const v = view(sim.s)
    expect(v.fold).not.toBeNull()
    expect(v.fold).toEqual(radioFoldStatus(sim.s.fold, sim.s.foldNow, v.loopBars, 100, v.upcoming?.barsUntil ?? null))
    expect(v.fold!.summary).toMatch(/^(folded|straight)/)
    sim.send({ type: 'foldControls', foldMode: false, fold: 100, clash: 25, foldSeed: 'autech' })
    expect(view(sim.s).fold).toBeNull()
  })
```

In `src/radio/step.test.ts`, replace:

```ts
      // on: from the pace's 8-16 bars to fold mode's 16-64, counted from this tick
```

with:

```ts
      // on: from the pace's 8-16 bars to fold mode's 8-32, counted from this tick
```

In `src/radio/step.test.ts`, replace:

```ts
      expect(on.intervalBars).toBeGreaterThanOrEqual(16)
      expect(on.intervalBars).toBeLessThanOrEqual(64)
```

with:

```ts
      expect(on.intervalBars).toBeGreaterThanOrEqual(8)
      expect(on.intervalBars).toBeLessThanOrEqual(32 + 2 * 4)
```

In `src/radio/step.test.ts`, replace:

```ts
import { HOOK_HOLD_FACTOR, REPLACE_SOON_FACTOR } from '@shared/radioSlotFlags'
```

with:

```ts
import { HOOK_HOLD_FACTOR, REPLACE_SOON_FACTOR } from '@shared/radioSlotFlags'
import { radioFoldStatus } from '@shared/radioFoldStatus'
```

In `src/ui/foldPrefs.test.ts`, replace:

```ts
      loadFoldPrefs(memory({ [FOLD_KEY]: JSON.stringify({ on: 'yes', fold: 300, clash: 'x', seed: 'abc' }) }), D, fixed)
    ).toEqual({ on: false, fold: 100, clash: 25, seed: DRAWN })
```

with:

```ts
      loadFoldPrefs(memory({ [FOLD_KEY]: JSON.stringify({ on: 'yes', fold: 300, clash: 'x', seed: '  ' }) }), D, fixed)
    ).toEqual({ on: false, fold: 100, clash: 25, seed: DRAWN })
    expect(loadFoldPrefs(memory({ [FOLD_KEY]: JSON.stringify({ seed: 42 }) }), D, fixed).seed).toBe(DRAWN)
```

In `src/ui/foldPrefs.test.ts`, replace:

```ts
  it('a saved autech is a seed like any other', () => {
```

with:

```ts
  it('a seed is any text, kept as typed (an old six-character code included)', () => {
    const s = memory({ [FOLD_KEY]: JSON.stringify({ on: true, fold: 40, clash: 25, seed: 'Elling' }) })
    expect(loadFoldPrefs(s, D, fixed).seed).toBe('Elling')
    const code = memory({ [FOLD_KEY]: JSON.stringify({ on: true, fold: 40, clash: 25, seed: 'k3x9pq' }) })
    expect(loadFoldPrefs(code, D, fixed).seed).toBe('k3x9pq')
  })

  it('a saved autech is a seed like any other', () => {
```

- [ ] **Step 2: Run them and see them fail.**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts src/ui/foldPrefs.test.ts`
Expected:
- `the view carries the fold status…` fails, because `v.fold` is `undefined`.
- `a seed is any text…` fails, because the seed comes back as a fresh random one, not `Elling`.

- [ ] **Step 3: Implement.**

In `src/radio/step.ts`, replace:

```ts
} from '@shared/radioFold'
import {
  radioClashAmount,
```

with:

```ts
} from '@shared/radioFold'
import { radioFoldStatus, type RadioFoldStatus } from '@shared/radioFoldStatus'
import {
  radioClashAmount,
```

In `src/radio/step.ts`, replace:

```ts
  turn: { waiting: boolean; move: TurnaroundMove | null; nothing: boolean; canSound: TurnaroundMove[] }
}
```

with:

```ts
  turn: { waiting: boolean; move: TurnaroundMove | null; nothing: boolean; canSound: TurnaroundMove[] }
  /** Fold mode's status for the lap playing (@shared/radioFoldStatus: the status line, each folded
   * row's cycle and phase); null with the mode off or before its first step. */
  fold: RadioFoldStatus | null
}
```

In `src/radio/step.ts`, replace:

```ts
    next: nextView(s),
    upcoming: next,
    turn: turnView(s),
```

with:

```ts
    next: nextView(s),
    upcoming: next,
    turn: turnView(s),
    fold: s.settings.foldMode && s.phase === 'running' ? radioFoldStatus(s.fold, s.foldNow, loopBars, s.settings.fold, next?.barsUntil ?? null) : null,
```

In `src/radio/step.ts`, replace:

```ts
 * window (the pace's 3-6 bars, or fold mode's 16-64), so it is drawn again from the one that now
```

with:

```ts
 * window (the pace's 3-6 bars, or fold mode's 8-32), so it is drawn again from the one that now
```

In `src/radio/step.ts`, replace:

```ts
/** A change's interval: fold mode's window (16-64 bars), moved to a realignment top when one is
```

with:

```ts
/** A change's interval: fold mode's window (8-32 bars), moved to a realignment top when one is
```

In `src/ui/foldPrefs.ts`, replace:

```ts
// on every change. Anything missing or unreadable falls back to the radio's defaults, field by field,
// except the seed: a visitor with none saved (or a junk one) gets a fresh random seed, saved at once
// so it stays theirs (Elling, 2026-10-03: not `autech` for everyone).
import { FOLD_SEED_ALPHABET, FOLD_SEED_LENGTH, newFoldSeed, normalizeFoldAmount, normalizeFoldSeed } from '@shared/radioFold'
```

with:

```ts
// on every change. Anything missing or unreadable falls back to the radio's defaults, field by field,
// except the seed: a visitor with none saved (or a blank one) gets a fresh random seed, saved at once
// so it stays theirs (Elling, 2026-10-03: not `autech` for everyone). A seed is any text (v2:
// cleanFoldSeed), kept as typed.
import { cleanFoldSeed, newFoldSeed, normalizeFoldAmount } from '@shared/radioFold'
```

In `src/ui/foldPrefs.ts`, replace:

```ts
  /** six characters of the seed alphabet */
  seed: string
```

with:

```ts
  /** any text, as typed (a six-character code or words: @shared/radioFold cleanFoldSeed) */
  seed: string
```

In `src/ui/foldPrefs.ts`, replace:

```ts
/** A stored seed that is a real one: six characters of the alphabet once normalized. */
function validSeed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const kept = [...value.trim().toLowerCase()].filter((ch) => FOLD_SEED_ALPHABET.includes(ch))
  return kept.length === FOLD_SEED_LENGTH ? normalizeFoldSeed(value) : null
}


```

with:

```ts

```

In `src/ui/foldPrefs.ts`, replace:

```ts
  const seed = validSeed(o.seed)
```

with:

```ts
  const seed = cleanFoldSeed(o.seed)
```

- [ ] **Step 4: Run them and see them pass, then typecheck.**

Run: `npx vitest run src && npm run typecheck`
Expected: PASS (632 tests in `src`). The typecheck is clean.

- [ ] **Step 5: Commit.**

```bash
git add src/radio/step.ts src/radio/step.test.ts src/ui/foldPrefs.ts src/ui/foldPrefs.test.ts
git commit -F - <<'EOF'
radio fold v2: the view carries the fold status (@shared/radioFoldStatus); changes every 8-32 bars; any text is a seed, kept as typed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 9: Web full mode, readout, phase dot, status line, `bend` / `mismatch`

**Repo:** ell.ing/radio.
**Files:** Modify `src/ui/fullModel.ts`, `src/ui/fullModel.test.ts`, `src/ui/full.ts`, `src/ui/full.css`, `src/main.ts`.

With fold off, the group's sliders, seed and `new` stay **hidden** (Elling's change). The existing `drawFold` already does this and is untouched. The status line hides with the mode, through `model.foldStatus === null`.

- [ ] **Step 1: Write the failing tests.**

In `src/ui/fullModel.test.ts`, replace:

```ts
  fullKey,
  fullModel,
```

with:

```ts
  foldDots,
  fullKey,
  fullModel,
```

Append to the end of `src/ui/fullModel.test.ts`:

```ts

describe('fold mode: the status line, the row readout, the phase dot', () => {
  const fold = (over: Partial<NonNullable<FullView['fold']>> = {}): NonNullable<FullView['fold']> => ({
    stretch: 'folded',
    rows: [{ rowId: 'r1', cycleBeats: 7, fullBeats: 8, phaseBeats: 0, mode: 'settled', lapsIn: 3 }],
    realignsInLaps: 4,
    nextChangeBars: 20,
    summary: 'folded · 1 row · realigns in 4 laps · next change ~20 bars',
    ...over
  })
  const rows = [row({ slot: 'r0' }), row({ slot: 'r1', bars: 2 })]

  it('the status line while the mode is on; none off', () => {
    expect(fullModel(view({ rows, loopBars: 4, fold: fold() })).foldStatus).toBe('folded · 1 row · realigns in 4 laps · next change ~20 bars')
    expect(fullModel(view({ rows, loopBars: 4, fold: null })).foldStatus).toBeNull()
    expect(fullModel(view({ rows, loopBars: 4 })).foldStatus).toBeNull()
  })

  it('a folded row reads its cycle against the loop in beats; a straight row nothing', () => {
    const m = fullModel(view({ rows, loopBars: 4, fold: fold() }))
    expect(m.rows.map((r) => r.fold)).toEqual([null, '7 / 16'])
    const half = fullModel(view({ rows, loopBars: 4, fold: fold({ rows: [{ ...fold().rows[0], cycleBeats: 3.5 }] }) }))
    expect(half.rows[1].fold).toBe('3½ / 16')
  })

  it('a change of the status or a readout redraws', () => {
    const a = fullKey(view({ rows, loopBars: 4, fold: fold() }))
    expect(fullKey(view({ rows, loopBars: 4, fold: fold({ summary: 'straight · folding in 2 laps' }) }))).not.toBe(a)
    expect(fullKey(view({ rows, loopBars: 4, fold: fold({ rows: [{ ...fold().rows[0], cycleBeats: 9 }] }) }))).not.toBe(a)
  })

  it('the dot goes round the cycle from its origin, and sits on the downbeat at realignment', () => {
    // 3 laps of 16 beats in, at the lap's top: 48 beats, 6 into the 7-beat cycle
    expect(foldDots(view({ rows, loopBars: 4, fold: fold(), pos: 0 }), 0).get('r1')).toBeCloseTo(6 / 7, 9)
    // lap 7 from its origin is 112 beats: the realignment
    const at7 = fold({ rows: [{ ...fold().rows[0], lapsIn: 7 }] })
    expect(foldDots(view({ rows, loopBars: 4, fold: at7, pos: 0 }), 0).get('r1')).toBe(0)
    // the audio clock has wrapped past the view's tick: a lap on
    expect(foldDots(view({ rows, loopBars: 4, fold: fold({ rows: [{ ...fold().rows[0], lapsIn: 6 }] }), pos: 3.9 }), 0.05).get('r1')).toBeCloseTo(
      radioDot(7, 0, 7 * 16 + 0.2),
      9
    )
  })

  it('no dots while held, stopped, or with the mode off', () => {
    expect(foldDots(view({ rows, loopBars: 4, fold: fold(), held: true }), 1).size).toBe(0)
    expect(foldDots(view({ rows, loopBars: 4, fold: fold(), phase: 'stopped' }), 1).size).toBe(0)
    expect(foldDots(view({ rows, loopBars: 4, fold: null }), 1).size).toBe(0)
  })
})

/** radioFoldPhaseDot, written out: ((beats - phase) mod cycle) / cycle. */
function radioDot(cycle: number, phase: number, beats: number): number {
  const x = (beats - phase) % cycle
  return (x < 0 ? x + cycle : x) / cycle
}
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/ui/fullModel.test.ts`
Expected: FAIL. `foldDots` is not a function, and `foldStatus` / `fold` are undefined.

- [ ] **Step 3: Implement.**

In `src/ui/fullModel.ts`, replace:

```ts
import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES, type TurnaroundMove } from '@shared/radioTurnaround'
```

with:

```ts
import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES, type TurnaroundMove } from '@shared/radioTurnaround'
import { radioFoldBeatsIn, radioFoldPhaseDot, radioFoldRowLabel } from '@shared/radioFoldStatus'
```

In `src/ui/fullModel.ts`, replace:

```ts
  /** The turn; absent reads as at rest, every chip dimmed. */
  turn?: RadioView['turn']
}
```

with:

```ts
  /** The turn; absent reads as at rest, every chip dimmed. */
  turn?: RadioView['turn']
  /** Fold mode's status (@shared/radioFoldStatus); null or absent with the mode off. */
  fold?: RadioView['fold']
  /** Where the playhead was at the view's tick, bars (foldDots); absent reads as 0. */
  pos?: number
}
```

In `src/ui/fullModel.ts`, replace:

```ts
  /** The fixed window's tiles and lines; null for a row with no stem yet. */
  layout: DiscoverWindowLayout | null
}
```

with:

```ts
  /** The fixed window's tiles and lines; null for a row with no stem yet. */
  layout: DiscoverWindowLayout | null
  /** Fold mode's readout on a folded row: its cycle against the loop in beats (`7 / 16`); null
   * for a row playing straight, and with the mode off. */
  fold: string | null
}
```

In `src/ui/fullModel.ts`, replace:

```ts
export interface FullModel {
  rows: FullRow[]
  strip: FullStrip
```

with:

```ts
export interface FullModel {
  rows: FullRow[]
  strip: FullStrip
  /** Fold mode's status line (`folded · 2 rows · realigns in 3 laps · next change ~20 bars`), in
   * the fold group; null with the mode off. */
  foldStatus: string | null
```

In `src/ui/fullModel.ts`, replace:

```ts
export function fullModel(view: FullView, opts: FullOptions = {}): FullModel {
  return {
    rows: view.rows.map((r) => ({
```

with:

```ts
/** A row's fold readout (FullRow['fold']). */
function foldLabel(view: FullView, slot: string): string | null {
  const f = view.fold?.rows.find((x) => x.rowId === slot)
  return f && view.loopBars > 0 ? radioFoldRowLabel(f.cycleBeats, view.loopBars * 4) : null
}

export function fullModel(view: FullView, opts: FullOptions = {}): FullModel {
  return {
    foldStatus: view.fold?.summary ?? null,
    rows: view.rows.map((r) => ({
```

In `src/ui/fullModel.ts`, replace:

```ts
      layout: r.stemId ? discoverWindowLayout({ stemBars: r.bars, loopBars: view.loopBars }) : null
    })),
```

with:

```ts
      layout: r.stemId ? discoverWindowLayout({ stemBars: r.bars, loopBars: view.loopBars }) : null,
      fold: foldLabel(view, r.slot)
    })),
```

In `src/ui/fullModel.ts`, replace:

```ts
  const rows = view.rows.map((r) =>
    [r.slot, r.stemId, r.bars, r.muted, !!r.soloed, r.audible, r.flag, r.approach?.state ?? '', r.name, r.jam, r.swap?.state ?? '', !!r.stemId && liked.has(r.stemId)].join('|')
  )
```

with:

```ts
  const rows = view.rows.map((r) =>
    [r.slot, r.stemId, r.bars, r.muted, !!r.soloed, r.audible, r.flag, r.approach?.state ?? '', r.name, r.jam, r.swap?.state ?? '', !!r.stemId && liked.has(r.stemId), foldLabel(view, r.slot) ?? ''].join('|')
  )
```

In `src/ui/fullModel.ts`, replace:

```ts
  return [view.phase, view.bpm, view.tempoTarget, view.held, view.pace, view.loopBars, failed, !!view.next, heartLiked, turn, ...rows].join('\n')
}
```

with:

```ts
  return [view.phase, view.bpm, view.tempoTarget, view.held, view.pace, view.loopBars, failed, !!view.next, heartLiked, turn, view.fold?.summary ?? '', ...rows].join('\n')
}

/** Each folded row's phase dot, 0..1 round its cycle (@shared/radioFoldStatus radioFoldPhaseDot),
 * at `pos` bars into the lap playing (the audio clock's, each frame). A `pos` that has wrapped
 * since the view's tick is a lap further on. None while held (the machine does not step, so its
 * laps would run behind the engine's), stopped, or with the mode off. */
export function foldDots(view: FullView, pos: number): Map<string, number> {
  const out = new Map<string, number>()
  const f = view.fold
  if (!f || view.held || view.phase !== 'running' || !(view.loopBars > 0)) return out
  const wrapped = pos + 1e-6 < (view.pos ?? 0) - view.loopBars / 2 ? 1 : 0
  for (const r of f.rows) {
    const beats = radioFoldBeatsIn({ ...r, lapsIn: r.lapsIn + wrapped }, view.loopBars, pos)
    out.set(r.rowId, radioFoldPhaseDot(r.cycleBeats, r.phaseBeats, beats))
  }
  return out
}
```

In `src/main.ts`, replace:

```ts
      full.frame(playing ? sweepPct(lap, pos) : null, breath(lap, pos, playing))
```

with:

```ts
      full.frame(playing ? sweepPct(lap, pos) : null, breath(lap, pos, playing), foldDots(v, pos))
```

In `src/main.ts`, replace:

```ts
  advanceLap,
```

with:

```ts
  advanceLap,
  foldDots,
```

In `src/ui/full.ts`, replace:

```ts
import { FOLD_SEED_ALPHABET, FOLD_SEED_LENGTH, newFoldSeed } from '@shared/radioFold'
```

with:

```ts
import { FOLD_SEED_TEXT_MAX, cleanFoldSeed, newFoldSeed } from '@shared/radioFold'
```

In `src/ui/full.ts`, replace:

```ts
  /** The playhead (percent of the window, null for none) and the rows' breath (0..1). */
  frame(sweepPct: number | null, breath: number): void
```

with:

```ts
  /** The playhead (percent of the window, null for none), the rows' breath (0..1), and each
   * folded row's phase dot (0..1 round its cycle, fullModel's foldDots), by slot. */
  frame(sweepPct: number | null, breath: number, foldDots?: ReadonlyMap<string, number>): void
```

In `src/ui/full.ts`, replace:

```ts
  ph: HTMLDivElement
  mute: HTMLButtonElement
```

with:

```ts
  ph: HTMLDivElement
  /** Fold mode's readout: the cycle against the loop, and the phase dot. */
  fold: HTMLDivElement
  foldLabel: HTMLSpanElement
  foldDot: HTMLSpanElement
  mute: HTMLButtonElement
```

In `src/ui/full.ts`, replace:

```ts
    const ph = h('div', 'ph')
    wave.append(canvas, ph)
```

with:

```ts
    const ph = h('div', 'ph')
    // fold mode's readout (sssketch spec 2026-10-03-radio-fold-v2-design section 2): the row's cycle
    // against the loop in beats, and a dot going round the cycle, on the downbeat (left) when the
    // row realigns. Over the waveform's top right; shown only on a folded row.
    const fold = h('div', 'fold')
    fold.setAttribute('aria-hidden', 'true')
    fold.hidden = true
    const foldLabel = h('span', 'fold-label')
    const foldTrack = h('span', 'fold-track')
    const foldDot = h('span', 'fold-dot')
    foldTrack.append(foldDot)
    fold.append(foldLabel, foldTrack)
    wave.append(canvas, ph, fold)
```

In `src/ui/full.ts`, replace:

```ts
    const r: RowEls = { el, wave, canvas, ph, mute, solo, skip, like, dislike, row: null, drawn: '' }
```

with:

```ts
    const r: RowEls = { el, wave, canvas, ph, fold, foldLabel, foldDot, mute, solo, skip, like, dislike, row: null, drawn: '' }
```

In `src/ui/full.ts`, replace:

```ts
  // fold mode, beside the turn (ui/foldPrefs.ts): the switch (pressed = on), how folded, how
  // mismatched, and the seed -- typed or pasted (six characters), or `new`
  const foldGrp = h('div', 'knob')
```

with:

```ts
  // fold mode, beside the turn (ui/foldPrefs.ts): the switch (pressed = on), bend, mismatch, and
  // the seed -- any text, typed or pasted, or `new`; those hide with fold off (Elling, 2026-10-03:
  // hidden as before, not disabled). The status line shows only while fold mode is on.
  const foldGrp = h('div', 'knob')
```

In `src/ui/full.ts`, replace:

```ts
  const folded = range('folded', 'how folded', on.readFold().fold / 100, (v) => on.fold({ ...on.readFold(), fold: Math.round(v * 100) }))
  const clash = range('clash', 'how mismatched', on.readFold().clash / 100, (v) => on.fold({ ...on.readFold(), clash: Math.round(v * 100) }))
  const seed = h('input', 'w readout')
  seed.size = FOLD_SEED_LENGTH
  seed.spellcheck = false
  seed.setAttribute('aria-label', 'fold seed')
  seed.title = 'the same seed replays the same rules; the stems also depend on the library'
  seed.addEventListener('change', () => {
    const kept = [...seed.value.trim().toLowerCase()].filter((ch) => FOLD_SEED_ALPHABET.includes(ch)).join('')
    if (kept.length === FOLD_SEED_LENGTH) on.fold({ ...on.readFold(), seed: kept })
    drawFold()
  })
```

with:

```ts
  // renamed (v2 section 3): `folded` is bend, `clash` mismatch; the prefs keep `fold` and `clash`.
  // Their tooltips are longer than this strip's usual words: Elling asked for the explanation.
  const folded = range('bend', 'bend', on.readFold().fold / 100, (v) => on.fold({ ...on.readFold(), fold: Math.round(v * 100) }))
  folded.wrap.title = 'how far layers bend off the beat'
  const clash = range('mismatch', 'mismatch', on.readFold().clash / 100, (v) => on.fold({ ...on.readFold(), clash: Math.round(v * 100) }))
  clash.wrap.title = 'how unlike the rest new layers are'
  const seed = h('input', 'w readout')
  seed.size = 10
  seed.maxLength = FOLD_SEED_TEXT_MAX
  seed.spellcheck = false
  seed.setAttribute('aria-label', 'fold seed')
  seed.title = 'same seed, same folding. any text'
  seed.addEventListener('change', () => {
    // any text; a box left empty keeps the seed in use
    const kept = cleanFoldSeed(seed.value)
    if (kept !== null) on.fold({ ...on.readFold(), seed: kept })
    drawFold()
  })
```

In `src/ui/full.ts`, replace:

```ts
  foldGrp.append(foldBtn, folded.wrap, clash.wrap, seed, newSeed)
```

with:

```ts
  const foldStatus = h('span', 'fold-status')
  foldStatus.setAttribute('role', 'status')
  foldStatus.hidden = true
  foldGrp.append(foldBtn, folded.wrap, clash.wrap, seed, newSeed, foldStatus)
```

In `src/ui/full.ts`, replace:

```ts
      const want = new Set(model.rows.map((r) => r.slot))
```

with:

```ts
      foldStatus.hidden = model.foldStatus === null
      if (foldStatus.textContent !== (model.foldStatus ?? '')) foldStatus.textContent = model.foldStatus ?? ''

      const want = new Set(model.rows.map((r) => r.slot))
```

In `src/ui/full.ts`, replace:

```ts
        r.skip.setAttribute('aria-busy', String(row.swap !== null))
        draw(r)
```

with:

```ts
        r.skip.setAttribute('aria-busy', String(row.swap !== null))
        r.fold.hidden = row.fold === null
        if (row.fold !== null && r.foldLabel.textContent !== row.fold) r.foldLabel.textContent = row.fold
        draw(r)
```

In `src/ui/full.ts`, replace:

```ts
    frame(pct, b) {
      rowsEl.style.setProperty('--breath', b.toFixed(4))
      for (const r of rows.values()) {
        const show = pct !== null && !!r.row?.layout
        r.ph.style.display = show ? 'block' : 'none'
        if (show) r.ph.style.left = `${pct}%`
      }
    },
```

with:

```ts
    frame(pct, b, foldDots) {
      rowsEl.style.setProperty('--breath', b.toFixed(4))
      for (const [slot, r] of rows) {
        const show = pct !== null && !!r.row?.layout
        r.ph.style.display = show ? 'block' : 'none'
        if (show) r.ph.style.left = `${pct}%`
        const dot = foldDots?.get(slot)
        r.foldDot.hidden = dot === undefined
        if (dot !== undefined) r.foldDot.style.left = `${(dot * 100).toFixed(2)}%`
      }
    },
```

In `src/ui/full.css`, replace:

```css
.full .ph { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--mark); display: none; pointer-events: none; }
```

with:

```css
.full .ph { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--mark); display: none; pointer-events: none; }
/* fold mode's readout on a folded row (full.ts): its cycle against the loop in beats over the
   waveform's top right, and under it the phase dot's track, the dot at its left end on the
   downbeat, where it sits when the row realigns */
.full .fold { position: absolute; top: 2px; right: 4px; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; color: var(--mid); font-size: 9px; line-height: 1; pointer-events: none; }
.full .fold[hidden] { display: none; }
.full .fold-track { position: relative; width: 28px; height: 1px; background: var(--faint); }
.full .fold-dot { position: absolute; top: -1px; width: 3px; height: 3px; margin-left: -1px; background: var(--ink); }
.full .fold-dot[hidden] { display: none; }
/* the status line in the fold group, only while fold mode is on */
.full .fold-status { color: var(--mid); white-space: nowrap; }
.full .fold-status[hidden] { display: none; }
```

- [ ] **Step 4: Run, then typecheck.**

Run: `npx vitest run src && npm run typecheck`
Expected: PASS (637 tests in `src`). The typecheck is clean.

- [ ] **Step 5: Commit.**

```bash
git add src/ui/fullModel.ts src/ui/fullModel.test.ts src/ui/full.ts src/ui/full.css src/main.ts
git commit -F - <<'EOF'
full mode fold v2: each folded row reads its cycle against the loop (7 / 16) with a phase dot; the status line in the fold group; folded/clash renamed bend/mismatch with tooltips; the seed takes any text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 10: Web start screen, the fold switch in the visuals switch's form

**Repo:** ell.ing/radio.
**Files:** Modify `src/ui/visualsSwitch.ts`, `src/ui/visualsSwitch.test.ts`, `src/ui/simple.ts`, `src/ui/simple.css`.

`controlsModel` is unchanged: its entry is still `{ id: 'fold', label: 'fold', switch: true, active }`. `simple.ts` now draws a switch entry as `sw-name` + `sw-value` spans with `data-state`, the same markup `visualsSwitch` makes, and `simple.css` gives it `.intro-visuals`'s dimming and hover.

- [ ] **Step 1: Write the failing test.**

In `src/ui/visualsSwitch.test.ts`, replace:

```ts
import { visualsWords } from './visualsSwitch'
```

with:

```ts
import { switchWords, visualsWords } from './visualsSwitch'
```

In `src/ui/visualsSwitch.test.ts`, replace:

```ts
    expect(w(false)).toBe('visuals: off')
  })
```

with:

```ts
    expect(w(false)).toBe('visuals: off')
  })

  it('the same words for the fold switch beside the centred play: fold: on / fold: off', () => {
    expect(switchWords('fold', true)).toEqual({ name: 'fold:', value: 'on' })
    expect(switchWords('fold', false)).toEqual({ name: 'fold:', value: 'off' })
  })
```

- [ ] **Step 2: Run it and see it fail.**

Run: `npx vitest run src/ui/visualsSwitch.test.ts`
Expected: FAIL. `switchWords` is not a function.

- [ ] **Step 3: Implement.**

In `src/ui/visualsSwitch.ts`, replace:

```ts
/** "visuals: on" / "visuals: off". */
export function visualsWords(on: boolean): { name: string; value: 'on' | 'off' } {
  return { name: 'visuals:', value: on ? 'on' : 'off' }
}
```

with:

```ts
/** A word switch's words: its name and its state, `fold: on` / `visuals: off`. */
export function switchWords(name: string, on: boolean): { name: string; value: 'on' | 'off' } {
  return { name: `${name}:`, value: on ? 'on' : 'off' }
}

/** "visuals: on" / "visuals: off". */
export function visualsWords(on: boolean): { name: string; value: 'on' | 'off' } {
  return switchWords('visuals', on)
}
```

In `src/ui/simple.ts`, replace:

```ts
import type { ControlEntry, ControlId, ControlsModel } from './controlsModel'
```

with:

```ts
import type { ControlEntry, ControlId, ControlsModel } from './controlsModel'
import { switchWords } from './visualsSwitch'
```

In `src/ui/simple.ts`, replace:

```ts
    x.dataset.id = e.id
    if (x.textContent !== e.label) x.textContent = e.label
```

with:

```ts
    x.dataset.id = e.id
    if (e.switch) {
      // the fold switch beside the centred play, in the intro's visuals switch's form (Elling,
      // 2026-10-03): `fold: on` / `fold: off`, a name and its state word (simple.css)
      const w = switchWords(e.label, !!e.active)
      if (x.querySelector('.sw-value') === null) {
        const name = document.createElement('span')
        name.className = 'sw-name'
        const value = document.createElement('span')
        value.className = 'sw-value'
        x.replaceChildren(name, ' ', value)
      }
      x.querySelector('.sw-name')!.textContent = w.name
      x.querySelector('.sw-value')!.textContent = w.value
      x.dataset.state = w.value
    } else if (x.textContent !== e.label) x.textContent = e.label
```

In `src/ui/simple.css`, replace:

```css
/* the fold switch beside the centred play (Elling, 2026-10-03): a plain word like the corners'
   (no box), hung just right of the play so the play stays dead centre; `fold` at rest when off,
   at full bright ink and underlined (.on) when fold mode is on */
.simple .c-center .w.switch {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 44px;
  padding: 0 6px;
  opacity: 0.35;
  color: var(--simple-ink);
}
.simple .c-center .w.switch::before { content: none; }
.simple .c-center .w.switch.on { opacity: 1; color: var(--simple-ink-bright); }
@media (hover: hover) {
  .simple .c-center .w.switch:hover { opacity: 1; color: var(--simple-ink-bright); }
}
.simple .c-center button.w.switch:active { opacity: 1; color: var(--simple-ink-bright); }
.simple.kbd .c-center button.w.switch:focus-visible { opacity: 1; color: var(--simple-ink-bright); outline: 1px solid var(--simple-ink-bright); outline-offset: -6px; }
```

with:

```css
/* the fold switch beside the centred play (Elling, 2026-10-03), in the form of the intro's visuals
   switch (intro.css .intro-visuals): `fold: on` / `fold: off`, no box, hung just right of the play
   so the play stays dead centre; the name dim, the state word bright when on and faint when off,
   the name brightening under the pointer; never underlined */
.simple .c-center .w.switch {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 44px;
  padding: 0 8px;
  white-space: nowrap;
  opacity: 1;
  color: var(--simple-ink);
  text-decoration: none;
}
.simple .c-center .w.switch::before { content: none; }
.simple .c-center .w.switch .sw-name { opacity: 0.45; transition: opacity 0.25s; }
.simple .c-center .w.switch[data-state='on'] .sw-value { color: var(--simple-ink-bright); }
.simple .c-center .w.switch[data-state='off'] .sw-value { opacity: 0.35; }
@media (hover: hover) {
  .simple .c-center .w.switch:hover .sw-name { opacity: 0.8; }
}
.simple .c-center button.w.switch:active .sw-name { opacity: 0.8; }
.simple.kbd .c-center button.w.switch:focus-visible { outline: 1px solid var(--simple-ink-bright); outline-offset: 2px; }
```

- [ ] **Step 4: Run, then typecheck.**

Run: `npx vitest run src && npm run typecheck`
Expected: PASS (638 tests in `src`). The typecheck is clean.

- [ ] **Step 5: Look at it.**

Run `npm run dev` and open the page. Use the Chrome tools if available; otherwise leave it to Elling's walkthrough, and say so.
- The intro shows `fold: off` (or `on`) right of the centred play, styled like `visuals: on` below it.
- Clicking it flips the word and does not start the radio.
- After stop, the same switch is beside the centred play.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/visualsSwitch.ts src/ui/visualsSwitch.test.ts src/ui/simple.ts src/ui/simple.css
git commit -F - <<'EOF'
start screen: the fold switch reads fold: on / fold: off in the visuals switch's form -- the name dim, the state word bright when on, faint when off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 11: Web render check, a re-fold at a top is click-free

**Repo:** ell.ing/radio.
**Files:** Modify `spike/engine-check/check.ts`.

- [ ] **Step 1: Add the check.**

In `spike/engine-check/check.ts`, replace:

```ts
// by explicit name: a production build minifies function names (run-built.mjs)
const all: Record<string, () => Promise<void>> = {
```

with:

```ts
async function foldRefoldTop() {
  // radio fold v2 (sssketch spec 2026-10-03-radio-fold-v2-design section 1): a settled fold
  // re-folds at its own realignment top. The 4-bar ramp (0 -> 1 over 8 s) folded to 7 beats
  // (3.5 s) from the first wrap W realigns with the 8 s loop every 56 s (7 laps): at T = W + 56 the
  // cycle is at its own seam. There it re-folds -- staged mid-lap, as a radio stages a lap ahead --
  // either to a new length (9 beats, a new id) or to the same length at a new phase (a quarter
  // beat on, a new id). Both go through the change-at-a-top crossfade: the largest sample step
  // round T stays at the seam fade's size (no click), and the new cycle reads right after it.
  const W = START + 8
  const T = W + 56
  const ramp = (ctx: BaseAudioContext) => row(buf(ctx, 8, (i) => i / (8 * SR)), 4)
  const fold7 = { rowId: 'a', id: 'a~1', bars: 7 / 4, phaseBars: 0 }
  const measure = async (next: typeof fold7, soonAt: number, expectedSoon: number) => {
    const x = await render(
      T + 6,
      (ctx, e) => {
        e.setRow('a', ramp(ctx))
        e.setCycles(W, [fold7])
      },
      { bypass: true, at: [[T - 3, (e) => e.setCycles(T, [next])]] }
    )
    let worst = 0
    const s0 = Math.round((T - 0.03) * SR) + dryDelay
    for (let i = s0; i < s0 + Math.round(0.06 * SR); i++) worst = Math.max(worst, Math.abs(x[i] - x[i - 1]))
    return {
      // 55.5 s after W is 3 s into the 7-beat cycle
      beforeTop: r6(at(x, T - 0.5)),
      expectedBeforeTop: r6(3 / 8),
      soon: r6(at(x, T + soonAt)),
      expectedSoon: r6(expectedSoon),
      topMaxStep: r6(worst)
    }
  }
  const ok = (m: Awaited<ReturnType<typeof measure>>) =>
    Math.abs(m.beforeTop - m.expectedBeforeTop) < 0.002 && Math.abs(m.soon - m.expectedSoon) < 0.002 && m.topMaxStep < 0.0025
  // a new length: 0.5 s into the new 9-beat cycle
  const length = await measure({ rowId: 'a', id: 'a~2', bars: 9 / 4, phaseBars: 0 }, 0.5, 0.5 / 8)
  // a new phase, a quarter beat (0.125 s) on: 0.1 s after T is 3.475 s into the 7-beat cycle
  const phase = await measure({ rowId: 'a', id: 'a~2', bars: 7 / 4, phaseBars: 1 / 16 }, 0.1, 3.475 / 8)
  out.foldRefoldTop = { length, phase, pass: ok(length) && ok(phase) }
}

// by explicit name: a production build minifies function names (run-built.mjs)
const all: Record<string, () => Promise<void>> = {
```

In `spike/engine-check/check.ts`, replace:

```ts
  foldCycle,
  foldChangeTop,
  widthStage,
```

with:

```ts
  foldCycle,
  foldChangeTop,
  foldRefoldTop,
  widthStage,
```

- [ ] **Step 2: Run it, with the neighbouring fold checks.**

Run: `ENGINE_CHECK_PORT=5317 node spike/engine-check/run.mjs foldRefoldTop,foldChangeTop,foldCycle`
Expected: `all engine checks passed`. In scratch the result was:
- `foldRefoldTop.length`: `{ beforeTop: 0.375, soon: 0.0625, topMaxStep: ~0.0009 }`.
- `foldRefoldTop.phase`: `{ beforeTop: 0.375, soon: 0.434375, topMaxStep: ~0.0009 }`.

Pick a free port if 5317 is taken.

- [ ] **Step 3: Typecheck and commit.**

```bash
npm run typecheck
git add spike/engine-check/check.ts
git commit -F - <<'EOF'
engine check: foldRefoldTop -- a re-fold at a realignment top (a new length, or the same length at a new phase) crossfades, no click

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 12: sssketch radio menu, `bend` / `mismatch`, tooltips, any-text seed

**Repo:** sssketch.
**Files:** Modify `src/renderer/src/components/DiscoverRadioMenu.tsx`.

The settings keys stay `fold` and `clash`. Only the labels change.

- [ ] **Step 1: Implement.**

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
import { FOLD_SEED_ALPHABET, FOLD_SEED_LENGTH, newFoldSeed } from '@shared/radioFold'
```

with:

```tsx
import { FOLD_SEED_TEXT_MAX, cleanFoldSeed, newFoldSeed } from '@shared/radioFold'
```

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
/** The fold seed: six characters, typed or pasted, committed on enter or when focus leaves.
 * Anything that does not clean up to six characters of the alphabet goes back to the seed in use. */
```

with:

```tsx
/** The fold seed: any text (v2, cleanFoldSeed), typed or pasted, committed on enter or when
 * focus leaves. A box left empty goes back to the seed in use. */
```

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
      // the same cleaning as normalizeFoldSeed, but nothing falls back to the default here
      const kept = [...draft.trim().toLowerCase()]
        .filter((ch) => FOLD_SEED_ALPHABET.includes(ch))
        .join('')
      if (kept.length === FOLD_SEED_LENGTH && kept !== value) onCommit(kept)
```

with:

```tsx
      // the same cleaning as normalizeFoldSeed, but nothing falls back to the default here
      const kept = cleanFoldSeed(draft)
      if (kept !== null && kept !== value) onCommit(kept)
```

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
      maxLength={FOLD_SEED_LENGTH + 4}
```

with:

```tsx
      maxLength={FOLD_SEED_TEXT_MAX}
```

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
        width: 56,
        padding: 'var(--ra-s-0) 4px',
```

with:

```tsx
        width: 84,
        padding: 'var(--ra-s-0) 4px',
```

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'how folded',
          [
            <FoldSlider
              key="fold"
              label="how folded"
              value={settings.fold}
              onCommit={(v) => onChange({ fold: v })}
            />
          ],
          '0 is always straight'
        )}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'clash',
          [
            <FoldSlider
              key="clash"
              label="how mismatched"
              value={settings.clash}
              onCommit={(v) => onChange({ clash: v })}
            />
          ],
          'how mismatched'
        )}
```

with:

```tsx
      {/* Renamed (v2, 2026-10-03): `how folded` is bend, `clash` mismatch; the settings keep
          `fold` and `clash`, so a saved file still reads. The tooltips are longer than this
          menu's usual two or three words: Elling asked for the explanation. */}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'bend',
          [
            <FoldSlider
              key="fold"
              label="bend"
              value={settings.fold}
              onCommit={(v) => onChange({ fold: v })}
            />
          ],
          'how far layers bend off the beat'
        )}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'mismatch',
          [
            <FoldSlider
              key="clash"
              label="mismatch"
              value={settings.clash}
              onCommit={(v) => onChange({ clash: v })}
            />
          ],
          'how unlike the rest new layers are'
        )}
```

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
          'the same seed replays the same rules. the stems also depend on the library, so a changed library can pick different ones'
```

with:

```tsx
          'same seed, same folding. any text'
```

In `src/renderer/src/components/DiscoverRadioMenu.tsx`, replace:

```tsx
fold loops one or two short layers at odd lengths against the beat, and changes come every 16 to 64 bars while it is on'}
```

with:

```tsx
fold loops one or two short layers at odd lengths against the beat, and changes come every 8 to 32 bars while it is on'}
```

- [ ] **Step 2: Typecheck and lint.**

Run: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverRadioMenu.tsx`
Expected: clean. React components are not unit-tested in this codebase. The seed's cleaning is `cleanFoldSeed`, tested in Task 1.

- [ ] **Step 3: Commit.**

```bash
git add src/renderer/src/components/DiscoverRadioMenu.tsx
git commit -F - <<'EOF'
radio menu fold v2: how folded / clash renamed bend / mismatch with tooltips; the seed takes any text (empty keeps it); the hint says 8 to 32 bars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 13: sssketch Discover, status line, row readout and phase dot, dev log

**Repo:** sssketch.
**Files:** Modify `src/renderer/src/components/DiscoverPanel.tsx`.

How it fits together:
- `runOwedRadioFoldStep` already knows the step of the lap now playing (`radioFoldNowRef`). It now also:
  - computes the status;
  - writes the rows to `radioFoldDotsRef`, for the dots;
  - sets `radioFoldView` a microtask later (the repo's no-sync-setState rule);
  - adds the status summary to the dev line.
- **Render** derives the status line and the per-row labels from `radioFoldView` plus `radioChangeWait`.
- **The sweep layout effect**, which already writes the playhead straight to the DOM every `pos`, also moves each `[data-fold-dot]`.
- **Reset and mode-off** clear both.
- **The row grid** gets a 16th track. The one-playhead overlay shares `DISCOVER_ROW_GRID_COLUMNS`, so the overlay's column 5 is still the rows' waveform.

- [ ] **Step 1: Implement.**

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
  type RadioFoldLanding
} from '@shared/radioFoldLanes'
```

with:

```tsx
  type RadioFoldLanding
} from '@shared/radioFoldLanes'
import {
  radioFoldBeatsIn,
  radioFoldPhaseDot,
  radioFoldRowLabel,
  radioFoldStatus,
  type RadioFoldStatusRow
} from '@shared/radioFoldStatus'
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
  const sweepLineRef = useRef<HTMLDivElement>(null)
  // The rows' wrapper, which carries --discover-breath for every row.
```

with:

```tsx
  const sweepLineRef = useRef<HTMLDivElement>(null)
  // FOLD MODE'S READOUT (v2, @shared/radioFoldStatus): the folded rows of the lap playing, as its
  // step left them -- the phase dots read it below, straight to the DOM like the line -- and the
  // machine's state with that step, for the status line and each row's `7 / 16` (render reads
  // these, so they are state, set a microtask after the step: radioFoldAtWrap).
  const radioFoldDotsRef = useRef<RadioFoldStatusRow[]>([])
  const [radioFoldView, setRadioFoldView] = useState<{
    state: RadioFoldState
    step: RadioFoldStep | null
  } | null>(null)
  // The rows' wrapper, which carries --discover-breath for every row.
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
    rowsRef.current?.style.setProperty('--discover-breath', breath.toFixed(4))
    const line = sweepLineRef.current
```

with:

```tsx
    rowsRef.current?.style.setProperty('--discover-breath', breath.toFixed(4))
    // FOLD MODE'S PHASE DOTS, off the same position: each folded row's dot goes round its cycle
    // and sits at the left end, the downbeat, when the row realigns (radioFoldPhaseDot).
    rowsRef.current?.querySelectorAll<HTMLElement>('[data-fold-dot]').forEach((dot) => {
      const r = radioFoldDotsRef.current.find((x) => x.rowId === dot.dataset.foldDot)
      dot.style.display = r !== undefined && playing ? 'block' : 'none'
      if (r === undefined || !playing) return
      const frac = radioFoldPhaseDot(
        r.cycleBeats,
        r.phaseBeats,
        radioFoldBeatsIn(r, previewLoopBars, pos)
      )
      dot.style.left = `${(frac * 100).toFixed(2)}%`
    })
    const line = sweepLineRef.current
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
    const step = stepRadioFold(state, { rows, loopBars, bpm, fold: radioSettings.fold })
    radioFoldRef.current = step.state
    radioFoldNextRef.current = step
    if (FOLD_DEV_LOG) console.log(radioFoldStepLine(step, rows))
```

with:

```tsx
    const step = stepRadioFold(state, { rows, loopBars, bpm, fold: radioSettings.fold })
    radioFoldRef.current = step.state
    radioFoldNextRef.current = step
    // the readout of the lap now playing (the step decided a lap ago), for the dots now and the
    // status line and the rows' readouts on the next render
    const now = radioFoldNowRef.current
    const status = radioFoldStatus(step.state, now, loopBars, radioSettings.fold, null)
    radioFoldDotsRef.current = status?.rows ?? []
    void Promise.resolve().then(() => setRadioFoldView({ state: step.state, step: now }))
    if (FOLD_DEV_LOG) console.log(`${radioFoldStepLine(step, rows)} · ${status?.summary ?? ''}`)
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
    radioFoldStepOwedRef.current = null
    radioFoldSoundedRef.current = false
    void window.rifffApi.engineStageCycles([], true)
```

with:

```tsx
    radioFoldStepOwedRef.current = null
    radioFoldSoundedRef.current = false
    radioFoldDotsRef.current = []
    void Promise.resolve().then(() => setRadioFoldView(null))
    void window.rifffApi.engineStageCycles([], true)
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
  // The mode switched while radio runs. The running interval was drawn from the other window (the
  // pace's, or fold mode's 16-64 bars), so it is drawn again from the one that now applies
```

with:

```tsx
  // The mode switched while radio runs. The running interval was drawn from the other window (the
  // pace's, or fold mode's 8-32 bars), so it is drawn again from the one that now applies
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
    if (radioSettings.foldMode) return
    radioFoldStepOwedRef.current = null
    if (radioFoldRef.current === null) return
```

with:

```tsx
    if (radioSettings.foldMode) return
    radioFoldStepOwedRef.current = null
    // the readout goes with the mode, at once (the folds themselves unfold at the next top)
    radioFoldDotsRef.current = []
    void Promise.resolve().then(() => setRadioFoldView(null))
    if (radioFoldRef.current === null) return
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
        ? lingeringNotice(lingering, lingeringStuck)
        : undefined

  return (
```

with:

```tsx
        ? lingeringNotice(lingering, lingeringStuck)
        : undefined

  // FOLD MODE'S STATUS (v2, @shared/radioFoldStatus): the line in the radio bar and each folded
  // row's readout, only while radio runs with the mode on. The next change is the rows' own count
  // (radioChangeWait), so the line says what the rows show.
  const radioFoldStatusNow =
    radioOn && radioSettings.foldMode && radioFoldView !== null
      ? radioFoldStatus(
          radioFoldView.state,
          radioFoldView.step,
          previewLoopBars,
          radioSettings.fold,
          radioChangeWait?.barsUntilChange ?? null
        )
      : null
  const radioFoldReadouts = new Map(
    (radioFoldStatusNow?.rows ?? []).map((r) => [
      r.rowId,
      radioFoldRowLabel(r.cycleBeats, previewLoopBars * 4)
    ])
  )

  return (
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
        {radioMenu && (
          <DiscoverRadioMenu
```

with:

```tsx
        {/* FOLD MODE'S STATUS LINE (v2), while radio runs with fold on: what the folding is
            doing, in one terse line. Monochrome: chrome. */}
        {radioFoldStatusNow !== null && (
          <span
            role="status"
            style={{ fontSize: 9, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}
          >
            {radioFoldStatusNow.summary}
          </span>
        )}
        {radioMenu && (
          <DiscoverRadioMenu
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
              soundSourceAudioIn={soundSourceForLean(sourceLean).audioIn}
```

with:

```tsx
              soundSourceAudioIn={soundSourceForLean(sourceLean).audioIn}
              foldReadout={radioFoldReadouts.get(slot.id) ?? null}
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
const DISCOVER_ROW_GRID_COLUMNS =
  '18px 18px 18px 18px 1fr 14px 110px 14px 1px 18px 18px 18px 18px 18px 18px'
```

with:

```tsx
// 2026-10-03, radio fold v2: a 16th track after 👎, 44px, for fold mode's readout (`3½ / 16`).
const DISCOVER_ROW_GRID_COLUMNS =
  '18px 18px 18px 18px 1fr 14px 110px 14px 1px 18px 18px 18px 18px 18px 18px 44px'
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
  soundSourceEndlesss,
  soundSourceAudioIn
}: {
```

with:

```tsx
  soundSourceEndlesss,
  soundSourceAudioIn,
  foldReadout
}: {
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
  soundSourceAudioIn: boolean
}): React.JSX.Element {
```

with:

```tsx
  soundSourceAudioIn: boolean
  /** Fold mode's readout on a folded row (v2): its cycle against the loop in beats, `7 / 16`;
   * null on a straight row and while fold mode is off. The phase dot under it is moved by
   * DiscoverPanel's sweep layout effect (data-fold-dot), never by render. */
  foldReadout: string | null
}): React.JSX.Element {
```

In `src/renderer/src/components/DiscoverPanel.tsx`, replace:

```tsx
          <ThumbsDown size={12} weight={radioFlag === 'replace-soon' ? 'fill' : 'regular'} />
        </RowIconButton>
      </div>
```

with:

```tsx
          <ThumbsDown size={12} weight={radioFlag === 'replace-soon' ? 'fill' : 'regular'} />
        </RowIconButton>
        {/* FOLD MODE'S READOUT (v2, @shared/radioFoldStatus), track 16, after 👎: a folded
            row's cycle against the loop in beats, and under it the phase dot's track -- the dot
            at its left end on the downbeat, where it sits when the row realigns. Hidden with
            `visibility` on a straight row, so the track stays. */}
        <div
          data-tooltip={foldReadout !== null ? 'its cycle against the loop, in beats' : undefined}
          style={{
            gridColumn: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 3,
            fontSize: 8,
            color: 'var(--ra-text-3)',
            visibility: foldReadout !== null ? 'visible' : 'hidden'
          }}
        >
          <span>{foldReadout ?? ''}</span>
          <span
            aria-hidden
            style={{ position: 'relative', width: 32, height: 1, background: 'var(--ra-border)' }}
          >
            <span
              data-fold-dot={slot.id}
              style={{
                position: 'absolute',
                top: -1,
                width: 3,
                height: 3,
                marginLeft: -1,
                background: 'var(--ra-text)',
                display: 'none'
              }}
            />
          </span>
        </div>
      </div>
```

- [ ] **Step 2: Typecheck, lint, prettier.**

Run: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx && npx prettier --check src/renderer/src/components/DiscoverPanel.tsx`
Expected: clean. Babel's "deoptimised the styling … exceeds the max of 500KB" note is normal for this file.

- [ ] **Step 3: Commit.**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -F - <<'EOF'
discover fold v2: the status line in the radio bar, each folded row's cycle against the loop with a phase dot (a 16th row track), the dev line ends with the status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

## Task 14: Verification, then Elling's walkthrough

- [ ] **Step 1: sssketch, everything.**

```bash
cd /Users/nickel/Claudecode/sssketch
npm run typecheck && npm run lint && npm test
```

Expected: clean, all pass. Engine-spawn tests need the binary built in Task 7. If they time out, check the coreaudiod note first.

- [ ] **Step 2: Web, everything.**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
npm run typecheck && npm test && ENGINE_CHECK_PORT=5317 npm run check:engine
```

Expected: clean, all pass, `all engine checks passed`.

- [ ] **Step 3: The fuzzers once more**, on the final code (Task 6, Step 2). Expected: as Task 6.

- [ ] **Step 4: The report.**
  - List the commits in both repos.
  - Include the fuzz summaries.
  - Repeat Spec point 3: below bend 50, 2-bar rows cannot re-fold, so at the default bend 40 most change comes from rotation and the faster window.
  - Say plainly that no agent heard or saw any of it.
  - Do not deploy the web radio, and do not upload anything. Both wait for Elling.

- [ ] **Step 5: Elling's walkthrough.** This is the spec's §4 list, with where to look:
  1. **Over a few minutes, folded rows change length and swap between layers.**
     - sssketch: Discover, radio on, fold on, bend ~70. Watch the row readouts: `7 / 16` → `9 / 16`, and a readout moving to another row.
     - In a dev build, the console's `[radio-fold]` lines show `refolding` and the summary.
  2. **Changes come noticeably more often than before.** The interval is now 8–32 bars.
  3. **Drift is audible at high bend.** Try bend 90–100 and listen for the slow filter and send sweeps.
  4. **The readout and phase dot make sense, and the dot lands on the beat when a layer realigns.** The status line's `realigns in N laps` counts down to it.
  5. **`elling` works as a seed and replays.** Type `elling` in either radio's seed box, play, note the first folds, re-enter `elling`, and they replay.
  6. **(Web)** `fold: on/off` beside the centred play looks like `visuals: on/off`. In full mode with fold off, bend, mismatch, seed and `new` are hidden.

