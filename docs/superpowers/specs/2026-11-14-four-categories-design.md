# Four categories: drums, bass, back, front

Status: design, approved in chat (2026-11-14). Not built.

## Why

Stems are sorted four overlapping ways: 8 arrange roles (drums, bass, lead, backing, aux,
textureFx, fill, vocal), 5 Tidy Up buses (drums, bass, lead, backing, aux), Discover's 3 mask
kinds (drums, bass, lead), and two overnight guessers (a 19-d feature centroid and a YAMNet
nearest-neighbour, plus YAMNet's own AudioSet top class). New users won't learn three
vocabularies for one question, and the guessers are poor.

Elling's idea: one model, four categories, **drums, bass, back, front**.

## What the test showed (2026-10-15)

Offline, on a copy of the owner's library, against his 296 hand-confirmed stems (scripts and
full numbers kept outside the repo):

- **Front vs back can't be labelled reliably from audio.** The best model (YAMNet embeddings plus
  features) is right ~70% of the time (65–68% on jams it never saw); ~80% on the third it's most
  sure of. The clues are real but weak: front parts move in pitch more; back parts play the whole
  loop and hold steady; front is a little brighter. Loudness says nothing. Part of the label is a
  musical judgement the audio doesn't carry.
- **Drums and bass are close to usable** (precision and recall ~0.75), and Endlesss's own
  instrument bits settle many of them.
- **Today's guesser is broken for front/back: 24% agreement, worse than chance.** Its reference
  set holds ~23k mask-labelled drums/bass rows, so most leads and pads come out as drums or bass.
- Old "fill" stems sit with drums better than with front (4 of 6).

So: drums and bass are sorted; front/back is a **dial** (a 0–1 score), used to rank, never shown
as a label the app decided. Your own label always wins.

## The design

### 1. The vocabulary (display and pickers only)

Everywhere the app shows or asks for a role or a bus, it offers four: **drums, bass, back,
front** (lowercase, that order). Stored values don't change:

| stored role / bus | shown as |
|---|---|
| drums, fill | drums |
| bass | bass |
| backing, aux, textureFx | back |
| lead, vocal | front |

- One pure module, `src/shared/stemCategory.ts`: `type StemCategory = 'drums' | 'bass' | 'back' |
  'front'`, `categoryOfRole(role)`, `categoryOfBus(bus)`, and the role and bus each category
  writes (front → `lead`, back → `backing`). Every picker and label goes through it.
- **Nothing on disk is rewritten.** Old projects, `StemCategories` rows and saved Discover state
  are read through the mapping, and new picks store a role and bus that older app versions
  already understand. No migration, no schema change for this part.
- **Pickers that change:** AutoArrangeRoleStep, ClusterStemsBrowser (Tidy Up),
  DiscoverReclassifyPicker, the Inspector's role readout, and any other `ARRANGE_ROLE_OPTIONS` or
  bus option list. The kick/snare/hat sub-labels under drums stay as they are.
- **Tidy Up and the stem exports have four groups.** A riff's `aux` and `backing` stems export
  into one "back" bus mixdown; `lead` exports as "front". The Ableton/REAPER track names follow.
- **Colours don't change.** They are Endlesss's sound types (facts, not guesses).
- **Known cost:** a new pick can no longer say "fill" or "vocal". Stems already labelled keep
  their stored role; new ones are drums or front.
- **Everywhere, not only the pickers** (Elling, 2026-11-14: "implement this division across the
  board"): auto-arrange's role labels and its role variety (`engineRoleFor` compares categories,
  drum sub-roles still count apart), the arrangement map's row labels, Tidy Up's groups and its
  "{group} N — " clip names, the tidied view's row groups and colours, and every export.
- **Role → bus for new tidies** (`ARRANGE_ROLE_TO_BUS`): fill → drums, vocal → lead, textureFx →
  backing, so a role's bus always has the role's category. A stem tidied before this as vocal or
  fill was stored with bus `aux`, so it shows as back until it's tidied again (the bus is what
  Tidy Up stored; nothing is rewritten).
- **Colours of the groups:** back takes backing's colour, front takes lead's.

### 2. Discover and radio

- The `lead` mask kind becomes **front**, and a new **back** kind joins it. Both draw from the
  same pool: stems that aren't drums or bass and have a guess (the model placed them as back or
  front), plus stems you labelled (a labelled front stem only in front, a labelled back stem only
  in back). Both **rank by the dial**, the way the trait kinds rank: front by high score, back by
  low. They respect the trait-match bar like the trait kinds do (`traitBar.ts`; the dial gets its
  own percentile table, built from the stored `FrontScore`s). Endlesss's "notes" tag no longer
  places a stem by itself (it says "melodic", not front or back); the model does.
- Saved slots and settings that say `lead` read as `front`: the arrangement map's locked climax
  (`coachClimax.ts`) and the phone's add-slot request (a phone page loaded before the update).
  Discover's and EEEDIT's slots live only in memory.
- Labels in the kind picker: **drums, bass, back, front** (plain: one vocabulary across the app,
  replacing drummy/bassish/leadesque), then the trait kinds with their names as today (chonky,
  rhythmic, sparkly, buttery). A rifff named "discover: drummy+leadesque" before keeps its name.
- Radio: what keyed on `lead` keys on `front` (intensity weight, never-folds, the melodic move
  table, the turnaround's kept row, the carry kind). `back` gets `warm`'s intensity weight (0.25)
  and the pad move table, and replaces `warm` as the starter bed's fourth layer.
- The arrangement map's intro and outro still drop the front; back parts now stay in them (before,
  `backing` counted as harmony and was dropped too).
- **The web radio** (ell.ing/radio) imports this repo's `src/shared` directly, so it changes in
  the same work to keep compiling: its front and back kinds read the stored role (front = lead or
  vocal, back = backing, aux or textureFx). No dial on the web yet, and no deploy without Elling.

### 3. One model

One small linear model replaces the guessers for roles:

- **Input:** the stem's YAMNet embedding only (`StemEmbeddingCache.EmbeddingJSON`, 1024 numbers,
  already computed for every scanned stem). The test's embedding-only model scored about the same
  as embeddings plus features (~70% vs ~71%), and three of the features aren't stored as such, so
  features are left out.
- **Output:** probabilities for drums, bass, back, front.
- **Weights ship with the app:** `src/shared/stemCategoryModel.json` (4 × ~1030 numbers, tens of
  KB), made by `scripts/train-stem-category-model.mts` from a copy of a library db: the owner's
  hand confirmations, plus Endlesss-masked drums and bass sampled to balance the classes (never
  thousands of them against a hundred front/back stems: that is today's bug). Weights are numbers,
  nothing personal. The script prints a cross-validated report (grouped by jam) and refuses to
  write weights that score below the 2026-10-15 baseline. Retraining with new labels is running
  that script again; there is no on-device training. The floor: front/back accuracy on jams the
  model didn't train on at least 0.60 (the old centroid scored 0.55, the live guesses 0.24), and,
  through the shipped 0.8 rule, drums and bass right at least half the time when the model says
  so (precision 0.5; Elling, 2026-11-14: a miss stays on the dial, a wrong call hides a lead).
  First training (2026-11-14, 296 labels, 25 jams): front/back 0.62; drums found 52%, right 66%;
  bass found 47%, right 53%.
- **Inference** is a dot product in main, inside the existing overnight scheduler
  (`stemAutoClassify.ts`), in its batches. It's far cheaper than today's centroid and
  nearest-neighbour passes, which it removes.

How a stem's category and dial are decided:

1. **Your label** (`StemCategories`) wins. A confirmed lead/vocal sets the dial to 1, a confirmed
   backing/aux/textureFx to 0 (at read time; nothing is stored). Rows the startup backfill copied
   from Endlesss's drums/bass tags (`Source = 'instrumentMask'`) count here as today, but are never
   used as human labels for training.
2. **Endlesss's instrument bits:** drums or bass (`instrumentMaskToSoundType`, as today) → that
   category. The notes bit no longer decides.
3. **The model:** drums or bass if that probability is ≥ 0.8; otherwise the stem is back-or-front
   and its dial is `p(front) / (p(front) + p(back))`.
4. **No embedding yet:** no guess and no dial; the stem still appears for the trait kinds, as today.

Stored: `StemAutoCategory` keeps its row (`ArrangeRole` = the category's stored role, `Source` =
`model`), plus a new nullable `FrontScore REAL` column (an `ALTER TABLE ... ADD COLUMN` in
`riffLibrarySchema.ts`, the usual pattern). When that column is added, every old guess is deleted
(`StemAutoCategory` rows except mask drums/bass), so every stem is re-guessed once, and the
classifier only skips stems whose row came from the model or the mask (an older app sharing the db
can't block a re-guess). The deleted rows include the old zero-shot rows stamped in seconds, so
`ComputedAt` is milliseconds throughout. `CLASSIFIER_VERSION` is bumped.

Tidy Up's suggestions for a sketch's stems and auto-arrange's role step read the stored guess too
(one path lookup, like `get-stem-category-roles`), instead of running their own guessers in the
window. Auto-arrange's drum sub-role guess goes with them: kick/snare/hat stays a manual pick.

**Removed:** the arrange-role and bus axes of the feature centroids (`categoryCentroids.ts`,
`busCentroids.json`, their training and backfills), the embedding nearest-neighbour role
suggestion (`embeddingMatch.ts`, main and shared, and the window-side refinements
`roleCentroidRefinement.ts`/`roleEmbeddingRefinement.ts`), the YAMNet AudioSet zero-shot role
(`audiosetClasses.ts`, its IPC, its "needs" entry and its writer fields), the already-unused
`resolveStemArrangeRole.ts`, and the "centroid store unreadable" startup dialog. Labels are still
written exactly as before (`upsertStemCategoryBus`/`Role`), just without retraining anything.
YAMNet itself stays: it makes the embeddings. Delete each only once nothing else reads it; Tidy Up
suggestions and Discover read the one model's result instead. The drum sub-role axis (manual only)
is untouched.

## Not in this

- Radio deliberately keeping one front sound at a time. It's a natural next step once the dial
  exists.
- On-device retraining from the user's own labels.
- Changing sound-type colours, or the kick/snare/hat sub-labels.

## Testing

- `stemCategory.ts`: every stored role and bus maps as the table says, and each category writes
  the stated role and bus (unit).
- Model inference: a fixture embedding gives the expected probabilities; the decision order
  (label, then mask, then model ≥ 0.8, then dial) as a pure function (unit).
- Training script: on a small synthetic fixture it trains, reports, and refuses weights below a
  threshold.
- Discover: `front` and `back` kinds rank by the dial and exclude drums/bass; a saved `lead` slot
  reads as `front` (unit, where the kind logic is pure).
- Export: `aux` and `backing` stems land in one "back" bus (existing export tests extended).
- Pickers and labels: typecheck and lint, then Elling's walkthrough (no UI test tooling here).

## Walkthrough (for Elling)

- Tidy Up, auto-arrange's role step and reclassify all offer drums, bass, back, front.
- An old project with lead/backing/aux stems shows them as front/back and exports four buses.
- Discover's front and back kinds sound right: front rows carry the tune, back rows sit under.
- After the overnight pass, today's "everything is drums or bass" guesses are gone.
