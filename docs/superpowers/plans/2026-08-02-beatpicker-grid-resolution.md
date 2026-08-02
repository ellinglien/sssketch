# Beat Picker Grid Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the beat picker's clickable grid subdivide each quarter-note beat according to the arranger's existing global snap-grid setting, instead of being hardcoded to one click per quarter note.

**Architecture:** All edits are confined to `src/renderer/src/components/BeatPicker.tsx`. `subdivisionsPerBeat = snapDiv / 4` and `totalSubdivisions = totalBeats * subdivisionsPerBeat` replace `totalBeats` as the grid's click-count; each subdivision index `i` maps to a fractional beat index `i / subdivisionsPerBeat`, which flows unmodified into the already-fractional-safe `offsetStepsForBeatIndex`/`rotationSecondsForStem` (`selectors.ts` — not touched by this plan). The "current pick" highlight and the free-play tap-along handler are updated to match the same resolution.

**Tech Stack:** TypeScript, React.

Full design context: `docs/superpowers/specs/2026-08-02-beatpicker-grid-resolution-design.md`.

**Testing note:** Per this codebase's established convention (`CLAUDE.md`'s Testing Conventions — React components are verified via typecheck + lint + manual walkthrough, not direct component tests), this plan has no new automated tests of its own. The underlying math this change relies on (`offsetStepsForBeatIndex`, `rotationSecondsForStem`) is already fully covered by `src/renderer/src/state/selectors.test.ts` and is not modified by any step below — each task ends by confirming that suite still passes, alongside `tsc`/`eslint`.

---

### Task 1: Derive grid resolution from the snap setting

**Files:**
- Modify: `src/renderer/src/components/BeatPicker.tsx:573-582`

- [ ] **Step 1: Replace the const block**

Find (currently lines 573–582):

```ts
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetKey = groupId
  const currentSteps = state.off[offsetKey] ?? 0
  // Matches peaks' own span (the whole rifff, not just the identity stem's
  // own duration) — see its doc comment for why. Using stem.barLength here
  // instead would mis-space the gridlines against that wider waveform
  // whenever the identity stem is shorter than the rifff (e.g. a 4-bar drum
  // loop identity stem in a 16-bar rifff).
  const totalBeats = rifff.barLength * 4
  const currentBeat = Math.round((-currentSteps * 4) / snapDiv)
```

Replace with:

```ts
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetKey = groupId
  const currentSteps = state.off[offsetKey] ?? 0
  // Matches peaks' own span (the whole rifff, not just the identity stem's
  // own duration) — see its doc comment for why. Using stem.barLength here
  // instead would mis-space the gridlines against that wider waveform
  // whenever the identity stem is shorter than the rifff (e.g. a 4-bar drum
  // loop identity stem in a 16-bar rifff).
  const totalBeats = rifff.barLength * 4
  // How many clickable grid positions make up one quarter-note beat, driven
  // by the same global snap-grid setting the transport bar's "snap 1/N"
  // button controls (SNAP_DIVS = [4, 8, 16, 32], always a multiple of 4) --
  // see docs/superpowers/specs/2026-08-02-beatpicker-grid-resolution-design.md.
  // 1 at snapDiv=4 (today's quarter-note-only grid), up to 8 at snapDiv=32.
  const subdivisionsPerBeat = snapDiv / 4
  const totalSubdivisions = totalBeats * subdivisionsPerBeat
  // One offsetSteps unit IS one subdivision by definition (both are exactly
  // 1/snapDiv of a bar), so recovering which subdivision is currently picked
  // needs no scaling -- just sign-flip and round defensively.
  const currentSubdivisionIndex = Math.round(-currentSteps)
  // Fractional quarter-note-equivalent value for display (e.g. 3.5) --
  // separate from currentSubdivisionIndex, which is what the grid's
  // highlight comparison below actually uses.
  const currentBeat = currentSubdivisionIndex / subdivisionsPerBeat
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: errors about `totalSubdivisions`/`subdivisionsPerBeat`/`currentSubdivisionIndex` being unused (they aren't consumed by the grid yet — that's Task 2). This is expected at this point; continue to Task 2 before worrying about it.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/BeatPicker.tsx
git commit -m "Derive beat picker grid resolution from the global snap setting"
```

---

### Task 2: Update the grid rendering to use the new resolution

**Files:**
- Modify: `src/renderer/src/components/BeatPicker.tsx` (grid button loop, currently lines 1000–1021)

- [ ] **Step 1: Replace the grid button loop**

Find:

```tsx
              {Array.from({ length: totalBeats }, (_, i) => i).map((beatIndex) => (
                <button
                  key={beatIndex}
                  onClick={() => pickBeat(beatIndex)}
                  title={`beat ${beatIndex + 1}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(beatIndex / totalBeats) * 100}%`,
                    width: `${100 / totalBeats}%`,
                    border: 'none',
                    borderLeft:
                      beatIndex % 4 === 0
                        ? '1px solid var(--ra-border-strong)'
                        : '1px solid var(--ra-grid-minor)',
                    background:
                      beatIndex === currentBeat
                        ? 'color-mix(in srgb, var(--ra-text) 18%, transparent)'
                        : 'transparent',
                    cursor: 'pointer'
                  }}
                />
              ))}
```

Replace with:

```tsx
              {Array.from({ length: totalSubdivisions }, (_, i) => i).map((i) => (
                <button
                  key={i}
                  onClick={() => pickBeat(i / subdivisionsPerBeat)}
                  title={`beat ${i / subdivisionsPerBeat + 1}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(i / totalSubdivisions) * 100}%`,
                    width: `${100 / totalSubdivisions}%`,
                    border: 'none',
                    borderLeft:
                      i % snapDiv === 0
                        ? '1px solid var(--ra-border-strong)'
                        : '1px solid var(--ra-grid-minor)',
                    background:
                      i === currentSubdivisionIndex
                        ? 'color-mix(in srgb, var(--ra-text) 18%, transparent)'
                        : 'transparent',
                    cursor: 'pointer'
                  }}
                />
              ))}
```

Note what does *not* change: `pickBeat`'s own function body (elsewhere in this file) takes a plain `number` and already forwards it, unmodified, into `offsetStepsForBeatIndex(beatIndex, snapDiv)` and `rotationSecondsForStem(steps, snapDiv, s)` — both handle the now-fractional `beatIndex` correctly with zero code changes, per the design doc. Same for the footer text (`loop begins at beat ${currentBeat + 1} of ${totalBeats}`, further down the file) — it already reads the `currentBeat` const, which is now fractional as of Task 1; no edit needed there either.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors (this was the consumer Task 1's new consts needed).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/BeatPicker.tsx
git commit -m "Render the beat picker grid at the derived subdivision resolution"
```

---

### Task 3: Match the tap-along handler to the same resolution

**Files:**
- Modify: `src/renderer/src/components/BeatPicker.tsx` (`markDownbeatRef.current`, currently lines 519–536)

- [ ] **Step 1: Replace the tap-along beat computation**

Find:

```ts
    markDownbeatRef.current = () => {
      if (!isFreePlaying || !rifff || !stem) return
      // Spans the whole rifff, not just the identity stem's own duration —
      // same reasoning as peaks/totalBeats above.
      const beatsInLoop = rifff.barLength * 4
      const riffDurationSec = (stem.durationSec / stem.barLength) * rifff.barLength
      const elapsed = getAudioContext().currentTime - freeStartTimeRef.current
      const elapsedInLoop = elapsed % riffDurationSec
      const secPerBeatNative = riffDurationSec / beatsInLoop
      const beatIndex = Math.round(elapsedInLoop / secPerBeatNative) % beatsInLoop
      const steps = offsetStepsForBeatIndex(beatIndex, SNAP_DIVS[state.snapIdx])
      dispatch({
        type: 'SET_OFFSET_STEPS',
        key: groupId,
        steps
      })
      pendingBakeRef.current = steps
    }
```

Replace with:

```ts
    markDownbeatRef.current = () => {
      if (!isFreePlaying || !rifff || !stem) return
      // Spans the whole rifff, not just the identity stem's own duration —
      // same reasoning as peaks/totalBeats above. Matches the click grid's
      // own resolution (see Task 1's subdivisionsPerBeat) so tapping along
      // and clicking a gridline stay consistent with each other -- see
      // docs/superpowers/specs/2026-08-02-beatpicker-grid-resolution-design.md.
      const snapDivNow = SNAP_DIVS[state.snapIdx]
      const subdivisionsPerBeatNow = snapDivNow / 4
      const subdivisionsInLoop = rifff.barLength * 4 * subdivisionsPerBeatNow
      const riffDurationSec = (stem.durationSec / stem.barLength) * rifff.barLength
      const elapsed = getAudioContext().currentTime - freeStartTimeRef.current
      const elapsedInLoop = elapsed % riffDurationSec
      const secPerSubdivision = riffDurationSec / subdivisionsInLoop
      const subdivisionIndex = Math.round(elapsedInLoop / secPerSubdivision) % subdivisionsInLoop
      const beatIndex = subdivisionIndex / subdivisionsPerBeatNow
      const steps = offsetStepsForBeatIndex(beatIndex, snapDivNow)
      dispatch({
        type: 'SET_OFFSET_STEPS',
        key: groupId,
        steps
      })
      pendingBakeRef.current = steps
    }
```

(This effect is self-contained by existing convention — it re-derives everything it needs from `rifff`/`stem`/`state` rather than closing over the Task 1 consts declared later in the component body, since it's registered before the early-return guard those consts sit below. That's why it computes its own `snapDivNow`/`subdivisionsPerBeatNow` instead of reading `snapDiv`/`subdivisionsPerBeat` directly.)

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/BeatPicker.tsx
git commit -m "Match beat picker tap-along resolution to the click grid"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — in particular `src/renderer/src/state/selectors.test.ts`'s `offsetStepsForBeatIndex`/`rotationSecondsForStem` tests, confirming the math this change relies on is genuinely untouched.

- [ ] **Step 2: Full typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 3: Manual verification**

Not automatable — no GUI interaction tooling in this environment.

1. Launch the app (`npm run dev`). Import (or re-pick a beat on) a rifff whose bar length is short enough to see the grid clearly (e.g. 1–2 bars).
2. At the default snap setting, confirm the grid shows more than one clickable position per quarter-note beat (4x the old count by default), and clicking a between-beats position produces a visibly correct playback preview (the loop audibly starts there, not snapped to the nearest quarter note).
3. Cycle the transport bar's snap-grid button to `1/4` (either before opening the picker or, if the picker rereads `state` live, while it's open) and confirm the grid shrinks back to exactly one position per quarter note — matching today's pre-change behavior exactly.
4. Confirm the highlighted "current pick" gridline lines up with whichever subdivision was actually picked, at more than one snap setting.
5. With free-play running, tap Space to mark a downbeat at a non-quarter-note position; confirm it lands on the same subdivision a click at that position would have.
6. Confirm the footer text ("loop begins at beat X of Y") shows a fractional number (e.g. "3.5") when a non-quarter-note position is picked, and a whole number when a quarter-note position is picked.
7. Confirm bar-boundary gridlines are still visually distinct (strong border) from the finer in-between lines at more than one snap setting.
8. Confirm baking (Inspector "re-pick beat" → confirm) a fractional-beat pick produces audio that audibly starts on the correct beat when played back in the arranger, not rounded to the nearest quarter note.

- [ ] **Step 4: Final commit (if any manual-verification fixes were needed)**

```bash
git add src/renderer/src/components/BeatPicker.tsx
git commit -m "Fix issues found during beat picker grid resolution manual verification"
```

(Skip this step if no fixes were needed — Task 3's commit is then the final one for this plan.)
