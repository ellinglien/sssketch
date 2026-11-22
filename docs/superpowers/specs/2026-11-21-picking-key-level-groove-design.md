# Better picks: key, level, balance

Status: built on the `better-picks` branch (2026-11-21), unmerged; awaiting the final review and a listening walkthrough.

First of three designs from Elling's "make the matching and the transitions more natural"
(2026-11-18). The other two come after this one and get their own specs:

2. Radio's shape: key changes on purpose at turnarounds, one front at a time.
3. The mix: making room in the frequencies, transitions chosen by the sound.

This one changes what Discover and radio **pick** and how loud a pick **arrives**. No engine
changes. Both radios (desktop and ell.ing/radio) share the picker, so both get it.

## What exists today

- `rankCandidates` (`src/shared/discoverRanking.ts`) scores a candidate on tempo closeness, a
  favourites boost, trait terms, and radio's clash, dig and intensity terms. **Nothing reads key.**
- Every riff has `Riffs.Root` and `Riffs.Scale` (Endlesss's own, set per riff in the jam). In the
  owner's library 98% of 80,827 riffs carry both. Roots are spread over all twelve notes. 56% of
  scales are one value (5, minor), which looks like an untouched default; 3.5% are 17, chromatic.
  So the root is better evidence than the scale, and neither is proof of what was played.
- Every analysed stem has `loudnessLufs` (`src/shared/stemLevel.ts`, BS.1770). Only radio's
  intensity score reads it. A new row always arrives at gain 1.
- Onset times are detected during analysis but only two summaries are kept (density and
  regularity). Nothing says whether a stem is straight or swung.

## 1. Key

**A candidate carries its riff's key.** `DiscoverCandidate` gains `riffRoot` and `riffScale`
(both `number | null`), filled wherever `riffBpm` is filled.

**How well two keys fit** is one pure function, `keyFit(a, b)` in a new `src/shared/keyFit.ts`,
returning 0 to 1:

- Each key becomes its set of notes (root plus the scale's steps, from a table of the 18 Endlesss
  scales beside `RIFF_LIBRARY_SCALE_NAMES`).
- `shared = notes in both / notes in the smaller set`. Same key, relative major and minor, and a
  pentatonic inside its parent scale all give 1. A fifth apart gives 6/7. A semitone or a tritone
  apart gives 2/7.
- `keyFit = clamp((shared - 0.5) / 0.5, 0, 1)`: half the notes shared or fewer is a plain clash, 0.
- An unknown key (null, out of range) or chromatic is **neutral: 0.5**. It never beats a known
  match and is never treated as a clash.

**The ranking term.** `rankCandidates` takes an optional `key: { others: Key[] }`: the keys of the
rows that will sound with the pick (every other row that isn't drums, and has a key). A
candidate's term is `KEY_WEIGHT * mean(keyFit(candidate, each other))`. There is no "bed key"
vote: a pick is scored against what it will actually play with, so a bed in two related keys works
without a special case.

- **Drums are exempt both ways:** a drums candidate gets no key term, and drum rows aren't in
  `others`. Decided by the slot's kinds / the row's category, as the pump does.
- **No other rows with a key** (first roll, drums only): no term, exactly today's ranking.
- **A strong lean, not a rule** (Elling, 2026-11-18, by default: "go ahead"): `KEY_WEIGHT = 2`,
  above a favourite's 1.5, so at matching 25% a fitting stem is drawn about three times as often
  as a clashing one of the same tempo. A clashing favourite can still land. The number is checked
  by a test that draws 10,000 picks from a synthetic pool and asserts the share that fit, so it is
  measured, not asserted.
- **Fold mode's clash** stays out of key, as its spec says: the key term applies at every clash
  amount.
- **Rows seeded from a project riff** have no library riff, so no key: neutral.

**Seen:** the row tooltip that shows a stem's date also shows its key ("f minor"), from
`resolveKeyName`. No new control.

**Web radio:** `export-index.mjs` writes each record's root and scale (two small integers);
`pick.ts` passes `others` the same way.

## 2. Level

A new row arrives with its gain already set so that it sits at a common loudness, instead of at 1.

- `arrivalGain(loudnessLufs)` in `src/shared/stemLevel.ts`: `10^((TARGET - lufs) / 20)`, clamped
  to `[0.25, 1]`. **It only turns down.** Row gains are 0 to 1, stems at unity are already loud
  (four measured at +3.7 dBFS peaks), and a boost could clip. A quiet stem arrives at 1, as today.
- `TARGET` is the library's 25th percentile of `loudnessLufs` from the trait quantile cache, so
  three stems in four are trimmed toward the quieter quarter. Fixed fallback: -23 LUFS.
- An unmeasured stem arrives at 1.
- **Drums aren't trimmed** (2026-11-22): a stem rolled for a drums row arrives at 1. Trimming
  them weakened the drum pump and lowered the level into the master glue.
- It is the row's **ordinary, visible gain**: the same control you drag on the waveform. Nothing
  hidden, and a kept or added row carries it into the project with no new plumbing. Changing the
  gain by hand works as before.
- It applies to rows radio or a roll fills. A row whose gain you set by hand keeps your gain when
  its stem is rerolled, scaled by the new stem's trim over the old one's, so your balance holds.
- The candidate carries `arrivalGain` (main computes it, attached for every roll).

**Web radio:** the index record gains the stem's loudness; the layer's gain starts at
`arrivalGain`.

## 3. Balance

Elling, 2026-11-21: "it'd be cool to balance strong elements with each other consciously ...
lots of loud bits, sparse, low volume ... and how they would match with each other."

- **Presence.** Each stem already has the radio's intensity parts (`radioIntensity.ts`): `busy`
  (how many attacks, how steady) and `full` (loudness, and how much of the loop sounds). A stem's
  **presence** is the mean of those two parts, 0 to 1, null when it has neither. Lots of loud hits
  is high; sparse and quiet is low. No new measurement and no rescan.
- **The ranking term.** A pick is scored against the rows it will sound with:
  `want = 1 - (the strongest other row's presence)`, and the term is
  `BALANCE_WEIGHT * (1 - |candidate's presence - want|)`, `BALANCE_WEIGHT = 1` (a trait's weight).
  A strong part already sounding pulls sparse picks up; a sparse bed pulls a strong pick up.
- **Who counts** (Elling: "bass should stay in the balance... drums out of the balance, or ...
  maybe sometimes"): bass, back and front rows count, both as the pick and as the others. Drums
  don't: a drums pick gets no term and drum rows aren't among the others. "Sometimes" is design
  2's rotating focus, where one focus counts drums too; the term takes a `countDrums` flag for it,
  off here.
- No other counted row with a presence, or a candidate without one: no term.
- It runs beside radio's intensity arc, which leans on a stem's rank inside its own pool; the two
  add.
- The candidate carries `presence` (attached with the arrival gain, for every roll). The web
  index carries it as `p`.

## 4. Fewer rows

Elling, 2026-11-21: "i find the number of elements in the radio often a bit too many", and to a
fixed lower peak: "yes ... would be awesome". Radio's density arc (`radioDensity.ts`) peaks at
**3 or 4 rows** instead of 4 or 5. The low point stays 2 or 3. Shared, so both radios change. No
new control. Rows he adds by hand are untouched, as before.

## Moved to design 2

- **Groove** (straight or swung, like the drums). Elling: "conflicting rhythms and combinations
  are cool", and "varying the method could be great". So groove is not an always-on rule: it
  becomes one of radio's rotating matching focuses (in key, locked groove, contrast, space) in the
  next design, with its measurement and its one-off rescan.
## Not in this

- A "key" dial. One fixed lean first; a control only if the fixed one proves wrong.
- Detecting the key from audio. The stored key is used as it is.
- Transposing a stem to fit.
- Anything in designs 2 and 3.

## Depends on

Built on the `four-categories` branch (it changes the same picker files and decides which rows
are drums). That branch is unmerged and waits for Elling's walkthrough, so this merges after it.

## Testing

- `keyFit`: same key, relative minor, pentatonic in parent, fifth, semitone, tritone, chromatic,
  null (unit).
- `rankCandidates` with `key`: drums exempt, no others = unchanged scores, the 10,000-draw share.
- `arrivalGain`: never above 1, floor, null, the reroll scaling (unit).
- The balance term: a strong bed prefers a sparse pick and the reverse, drums exempt, no others
  = unchanged scores (unit).
- Web radio: index round-trip of the new fields; `pick.ts` terms.
- Listening is Elling's: agents can't hear it.

## Walkthrough (for Elling)

- Radio for ten minutes at the default matching: melodic layers that come in sound in key with
  the bed far more often than before; hover a row to read its key.
- New rows no longer jump out loud; the row's gain shows where it was set.
- With a busy, loud part playing, the parts that join it are sparser; with a thin bed, a
  stronger part comes in. Drums don't change this.
