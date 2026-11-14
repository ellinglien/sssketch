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
  their stored role, so auto-arrange still treats them as before; new ones are drums or front.

### 2. Discover and radio

- The `lead` mask kind becomes **front**, and a new **back** kind joins it. Both draw from stems
  that aren't drums or bass (confirmed, mask, or confident guess) and **rank by the dial**, the way
  the trait kinds rank: front by high score, back by low. They respect the trait-match bar like the
  trait kinds do (`traitBar.ts`, `traitQuantiles.ts`: the dial gets its own percentile table).
- Saved slots and settings that say `lead` read as `front`.
- Labels in the kind picker: drums, bass, back, front, then bright, warm, rhythmic, bass-heavy
  (the trait kinds stay, as dials inside any category).
- Radio's per-kind weights and readouts that key on `lead` key on `front`; `back` gets the
  weight `aux`/backing material has today.

### 3. One model

One small linear model replaces the guessers for roles:

- **Input:** the stem's YAMNet embedding (`StemEmbeddingCache`, already computed for every scanned
  stem), plus the few feature fields that helped (pitch movement, how much of the loop it plays,
  pitch steadiness, brightness) where cached.
- **Output:** probabilities for drums, bass, back, front.
- **Weights ship with the app:** `src/shared/stemCategoryModel.json` (4 × ~1030 numbers, tens of
  KB), made by `scripts/train-stem-category-model.mjs` from a copy of a library db: the owner's
  hand confirmations, plus Endlesss-masked drums and bass sampled to balance the classes (never
  thousands of them against a hundred front/back stems: that is today's bug). Weights are numbers,
  nothing personal. The script prints a cross-validated report (grouped by jam) and refuses to
  write weights that score below the 2026-10-15 baseline. Retraining with new labels is running
  that script again; there is no on-device training.
- **Inference** is a dot product in main, inside the existing overnight scheduler
  (`stemAutoClassify.ts`), in its batches. It's far cheaper than today's centroid and
  nearest-neighbour passes, which it removes.

How a stem's category and dial are decided:

1. **Your label** (`StemCategories`) wins. A confirmed lead/vocal sets the dial to 1, a confirmed
   backing/aux/textureFx to 0.
2. **Endlesss's instrument bits:** drums or bass bit alone → that category.
3. **The model:** drums or bass if that probability is ≥ 0.8; otherwise the stem is back-or-front
   and its dial is `p(front) / (p(front) + p(back))`.
4. **No embedding yet:** no guess and no dial; the stem still appears for the trait kinds, as today.

Stored: `StemAutoCategory` keeps its row (`ArrangeRole` = the category's stored role, `Source` =
`model`), plus a new nullable `FrontScore REAL` column (an `ALTER TABLE ... ADD COLUMN` in
`riffLibrarySchema.ts`, the usual pattern). `CLASSIFIER_VERSION` is bumped, so every stem is
re-guessed once. The `ComputedAt` seconds/milliseconds mix the test found is normalised to
milliseconds on write.

**Removed:** the arrange-role and bus axes of the feature centroids (`categoryCentroids.ts`,
`busCentroids.json`, their training and backfills), the embedding nearest-neighbour role
suggestion (`embeddingMatch.ts`), and the YAMNet AudioSet zero-shot role (`audiosetClasses.ts`).
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
