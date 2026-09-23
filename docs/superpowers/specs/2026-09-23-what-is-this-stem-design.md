# What is this stem: one surface for saying so, and a map that works without one

Date: 2026-09-23
Status: designed in chat with Elling; awaiting spec review

Follows `2026-09-23-arrangement-map-design.md`, which built the map but only for an
arrangement the auto-arranger made. Two things Elling asked for the same day, which turn out
to be one thing:

1. "cool for any arrangement to see it in the grid like that" — the map should have columns
   whether or not a wizard built them.
2. "tidy up and that auto-arrange first step can be merged perhaps?" — Tidy Up and the
   role-confirmation step are two surfaces asking one question.

They are one thing because the map needs an answer to that question. A map row is labelled
with the role the user confirmed; an arrangement nobody has labelled has nothing to put in
the row header. So part 1 ends in a button that opens part 2.

## The overlap is real, and it has already cost us a bug

Checked against the code rather than assumed. `ClusterStemsBrowser.tsx` (Tidy Up) and
`AutoArrangeRoleStep.tsx` (the role step) share:

- `useStemPreviewPlayback` — one hook, extracted out of Tidy Up specifically because the
  role step's copy of it had drifted.
- `useStemFeatureScan`, `useCachedStemEmbeddings`, `getCategoryCentroids`,
  `getConfirmedEmbeddings` — the same four inputs, fetched the same frozen-once-per-mount way,
  each file citing the other's comment for why.
- `stemTileGeometryFromFields`, and then two verbatim copies of `handleThumbnailClick` that
  each carry the same bug-history comment about `tileSpanBars` versus `visibleBars`.
- `ARRANGE_ROLE_OPTIONS`, `DRUM_SUB_ROLE_OPTIONS`, `DRUM_SUB_ROLE_LABELS` — the same eight
  roles and the same five kit pieces, in two pickers, with `stemRole.ts` noting the sharing
  exists "so both pickers offer the same 8 options in the same order."
- `upsertStemCategoryRole` — Tidy Up via `recordRoleCategories`, the wizards via
  `recordRoleCategorization` (`state/stemCategoryCapture.ts`). Both land in the same
  `StemCategories` table and both trigger the same server-side training
  (`main/categoryCentroidTraining.ts` → `categoryCentroids.ts`).

The two differ only in how they reach a suggestion, and that difference is itself the
evidence. Tidy Up: embedding → centroid → `guessArrangeRoleFromPresetName`. The role step:
`resolveStemRole` (busOf → preset name → `SOUND_TYPE_TO_ARRANGE_ROLE`) then
`refineRoleWithEmbeddingOrCentroidSuggestion`. Same ingredients, different order, two
implementations — and `ClusterStemsBrowser.tsx`'s own comment records what that cost:

> "arrange mode is much better at guessing currently... tidy up doesn't seem to be using it at
> all" (reported directly, 2026-09-15)

That was a user-visible defect whose entire cause was having two of these. It was fixed by
copying the missing lookup across, which is the fix that guarantees a third one later.

## The line the merge is cut along

**What a stem IS is global. What a stem DOES in this arrangement is local.**

That sentence decides everything below. A role is a claim about a file — it trains a
cross-project classifier, it is keyed by StemCID, it outlives the project. `included`,
`frequency`, and the arrangement's length and shape are claims about *this* arrangement, and
they mean nothing about the file.

So:

- **The merged surface owns the role.** It is Tidy Up, widened. It keeps its name, its
  grouping, its split, its keyboard shortcuts, its preview.
- **The role step keeps `included`, `frequency`, length and shape, and stops owning a role
  picker.** Each row shows the role read back from the global table. Clicking that readout
  opens `DiscoverReclassifyPicker` — which already exists, already says "this stem is",
  already writes a Tidy Up-style confirmation, and already lives at exactly this gesture on
  the Discover match meter. Two `<select>` elements and their stale-sub-role clearing logic
  go; nothing is built to replace them.
- **Both entry points write through one path.** `recordRoleCategorization` and
  `recordRoleCategories` become one function.

This is the "keep Tidy Up's existing behaviour and just make the role step call it" answer,
and it is the right one. The role step was never a better place to answer the question — it
was a worse place that happened to have a better suggestion chain.

## Scope: any stems, library included

Elling chose this deliberately. His reasoning, recorded because it is the whole argument:
**the categorisations are global — they train a cross-project classifier — so scoping the UI
narrower than the data is an artificial limit.** A role confirmed while tidying one sketch
already helps every future sketch. There is no reason the only way to reach that table is to
first drag something onto a timeline.

The surface therefore takes a **population**, and there are exactly two:

| | where the stems come from | clustered | preview path | writes |
|---|---|---|---|---|
| this sketch | `state.rifffs`, `startBar !== undefined` (today's behaviour, unchanged) | yes | `useStemPreviewPlayback` | role **and** bus |
| the library | the riff library DB, via the cached `StemFeatureCache` rows Discover already scans | **no** | Discover's throwaway-project path | role only |

The sketch is the default, because it is what every existing entry point already means.

Three consequences that have to be said out loud rather than discovered later:

**The library is not clustered, and cannot be.** `computeMergeSequence` is O(n³).
`categoryCentroids.ts` records testing against "a real ~45,000-stem backlog." Clustering that
is not a performance problem, it is arithmetic. But Tidy Up already has two halves — a
*suggested* half, grouped by the classifier with no dendrogram behind it at all, and a *DSP*
half that clusters. The library population gets the suggested half. That is a unification,
not a new mode: `expandFlatGroupIntoRows` already exists precisely because a suggested group
has no clustering behind it until someone asks for one.

**There are two audition paths, and that is the real cost of this scope.**
`useStemPreviewPlayback` solos by `stemKey(groupId, slot)` against `state.rifffs`. A library
stem has no such key and is in no rifff. Discover's own preview solved this already by
assembling a throwaway rifff (`assembleDiscoverRifff`) and sending it to the engine. So a
library-population audition goes through Discover's path and a sketch-population audition
goes through Tidy Up's. **The invariant that makes this acceptable is that both behave
identically where it matters: one stem at a time, and the toolkit blanked.** For the sketch
that is `stemPreviewOverrides` in `store.ts` — no curves, no reverb, no mute regions, no
risers, so a stem is judged as the file and not as the arrangement. For the library it is
free: a one-stem throwaway project has no toolkit to blank. Neither path may regress to
letting two stems sound at once.

**Bus assignment stops at the sketch boundary.** `ASSIGN_STEMS_TO_BUS` writes `state.busOf`,
keyed by stemKey, in this project. A library stem has neither. So the library population
writes `upsertStemCategoryRole` and not `upsertStemCategoryBus`. This asymmetry is correct
rather than unfortunate — the bus is a fact about an export of this project, the role is a
fact about a file — but it means the same click does slightly different work in the two
populations, and anyone reading the write path later deserves to know that on purpose.

**No native-engine changes are needed for any of this.** The engine already plays whatever
`EngineProject` it is handed and has no memory of a "real" project versus a preview — that is
established in `2026-09-15-discover-native-engine-preview-design.md` and nothing here asks it
for anything new.

## The taxonomy

The app has three vocabularies for what a stem is. They are not three answers to one
question, which is why all three can survive:

| | values | who supplies it | what question it answers | lives in |
|---|---|---|---|---|
| `SoundType` | drums, bass, notes, extInst, sampler, fx, extFx, audioIn | Endlesss, via the instrument bitmask. Never a human. | what did the recorder call this | `shared/types.ts` |
| Discover kinds | drums · bass · lead (mask), bassHeavy · rhythmic · bright · warm (trait); shown as drummy · bassish · leadesque · chonky · rhythmic · sparkly · buttery | nobody — chosen per **slot** | what am I looking for | `shared/discoverSlotKind.ts` |
| `ArrangeRole` (+ `DrumSubRole`) | drums, bass, lead, backing, aux, textureFx, fill, vocal | **a person**, in Tidy Up or the role step | what is this, for arranging | `shared/stemRole.ts` |
| `BusId` | drums, bass, lead, backing, aux | derived, `ARRANGE_ROLE_TO_BUS` | which export track does it pack into | `shared/types.ts` |

Read down the third column and the answer falls out. Only `ArrangeRole` is a judgement a
person makes about a stem. `SoundType` is provenance. Discover's kinds are a **query** — a
property of a slot, not of a stem; nothing writes one onto a file and nothing should.

So:

- **The merged surface writes `ArrangeRole` and `DrumSubRole`. Nothing else.**
- `BusId` is derived from it through `ARRANGE_ROLE_TO_BUS`. That is already how Tidy Up
  works today; no change.
- Discover's kinds stay derived in the direction that already exists,
  `ARRANGE_ROLE_SLOT_KINDS` (role → the kinds it can answer for). The reverse,
  `discoverSlotKindToArrangeRole`, also stays: a slot still has to hand a placed stem a role.
  Both tables are already documented as deliberately approximate and neither is load-bearing
  for anything a human confirmed.
- **Nothing stops existing.** No fourth taxonomy is proposed.

### The one thing that should change

`DiscoverReclassifyPicker` writes an `ArrangeRole` and labels its buttons with
`discoverRoleLabel(role, ROLE_LABELS)`, which prefers the *kind's* playful name where one
exists. So picking "drummy" there writes `arrangeRole: 'drums'`. That is the two vocabularies
leaking into each other at the one place a user is making a claim about a file.

The rule, and it is a one-line change: **kind names describe a slot; role names describe a
stem.** A picker that is writing a role says the role's name (`ROLE_LABELS`). The match meter,
which is explaining why a *slot* admitted a stem, keeps the kind names — that is what it is
talking about.

### What `SOUND_TYPE_TO_ARRANGE_ROLE` is for, now that it is clearer

It stays, as a seed and never as a confirmation. It has already been caught asserting
something it had not earned — `audioIn → vocal` fired confidently on the most common stem in
a real library, patched 2026-09-14 by flagging those rows `uncertain` rather than by deleting
the mapping. That patch is the right shape and should be read as the general rule: a machine
guess may pre-fill a picker and may never look like an answer. The merged surface's entire
job is turning those seeds into real answers.

## The notes field goes

Tidy Up's per-row free-text box (`note` in `ClusterRow`, added 2026-09-21 "for future
reference? for ML categorization perhaps?") is removed, along with `subcategoryNote` in
`recordRoleCategories`, the preload signature, and `StemRoleCategoryEntry`.

The reason is not taste. **Nothing reads it.** Grepping `subcategoryNote` / `SubcategoryNote`
across `src/` finds the column in `riffLibrarySchema.ts`, the migration that adds it, and the
INSERT in `stemCategoriesStore.ts` that binds it — and not one SELECT, not one consumer,
anywhere. Its own tooltip already says "does not affect classifier training." So it
is a write-only field occupying the busiest control row of the busiest modal in the app, on a
surface whose whole value is that the question can be answered in one click. A text box is
the one control on it that cannot be.

**The column stays.** Dropping a SQLite column means rebuilding a table that also holds the
user's real library, for no gain, and anything already typed into it would be destroyed. It
keeps its rows and stops gaining new ones. If a real consumer ever appears, the write path is
four lines.

## The map on any arrangement

Almost everything the map needs, it already reads off the live timeline.
`ArrangementMap.tsx`'s own doc comment is emphatic that it "holds no state and owns no grid" —
rows come from `coachMapRows(state)`, cells from `readRowPasses(row.clips, ...)`. What it
takes from `coach` is narrower than it looks: the column list, a phrase length, and three
decorations (`walkIndex`, `tension`, `phraseReading`) that are simply absent without a walk.

So the map does not need to be made general. It needs columns and a phrase.

### Columns: unnamed, one phrase each

Elling's choice (option **a**), and he rejected the alternative explicitly: **no inference of
section boundaries.** The app does not know where the verse ends and will not pretend to. A
column is one pass of the phrase, `ceil(totalBars / phraseBars)` of them, and the header
carries **no text at all** — the existing per-column tooltip already says which bar it starts
at, and a header that says "4" on every fourth column is a rule someone has to maintain
forever for no information. The strip still scrubs; that is what it is for.

Chosen over two alternatives worth recording. **Inferring sections from where material enters
and leaves** is what he said no to — and it would be wrong in the way that is hardest to
notice, because a plausible wrong boundary looks exactly like a right one. **One column per
bar** needs no phrase at all, but a 128-bar arrangement is then 128 columns of single squares
and the map stops being a map.

### The phrase, on an arrangement nobody was asked about

The guided map gets its phrase from Elling's own answer to a measurement
(`coachPhrase.ts`, `readLoopPhrase`). There is nobody to ask here, so the default is the
**bar length of the earliest placed rifff** — a rifff *is* a loop, and its `barLength` is the
nominal phrase without measuring anything. Where the timeline holds rifffs of several
different lengths, the existing phrase-button row appears, offering **the distinct bar lengths
actually present**. Those are facts about the arrangement rather than guesses about it, which
is the property that makes offering them allowed.

This is the one number the unguided map assumes, and it is worth being plain that it is about
**grid spacing and not about structure**. Getting it wrong makes the squares the wrong size.
It cannot make the map say something untrue about the song.

### Rows, and what makes a cell clickable

Today a row is toggleable when the builder laid it out, because `buildCellToggleActions` reads
the locked climax to find out what stem to put back. That is the only thing `climax` is
consulted for, and it is not the only place that fact lives: **a row that already has material
on it knows what belongs there.** A channel whose clips all resolve to one stem path can put
that stem back without a climax, from its own existing clip.

So the rule becomes one rule for both maps: **a row is toggleable when its material names a
single stem.** For a guided map that is every lane the builder made, unchanged. For an
unguided map it is every channel that holds one stem's clips — which, in practice, is most of
them, because that is what the arranger's rows already are. Risers and mixed rows stay
read-only for the reasons `coachMapRows.ts` already gives: a riser has no stem and toggling
one on would be inventing one, which is the spec's own named bad line.

Chosen over **off-only editing** (let a cell empty itself, since the material is right there,
but refuse to refill it). That is a one-way door with undo as the only way back, and a grid
where half the clicks are reversible is worse than a grid where none are.

### Row labels, which is where part 1 meets part 2

The guided map labels a row with the confirmed role, for a reason worth repeating: real
Endlesss material is recorded through audio-in, so a stem's name and its `SoundType` both read
"audio in" on nearly every row and the map says nothing (direct report, 2026-09-23). An
unguided map has the same problem and no climax to solve it with.

The fallback chain: **the confirmed role from the global `StemCategories` table** → the stem's
name → the path. The first link is exactly what the merged surface writes, which is the join
between these two halves. A library that has been through Tidy Up gives every map in the app
readable row headers for free, retroactively, with no wizard involved.

And when it has not: a plain button by the column strip, **"what is this?"**, opening the
merged surface on this sketch's stems. That is the "button prompting you to go and label
things" Elling asked for.

### sssketchy says nothing here

He walks *sections*, and there are none. There is no walk to run on an unguided map, and
inventing a nudge about labelling things is precisely the drill sergeant the map spec spends a
section ruling out. The button is a button; its label is UI copy and lives with the component
like every other button label in the app. **If this feature ever does need him to speak, that
line goes in `src/shared/coachScript.ts` and nowhere else** — that file holds every word he
says and `coachScript.test.ts` sweeps it.

## Colour

The constraint is that `typeColorVar(soundType)` is the one sanctioned source and no second
colour table may appear. Role-coloured rows would be nice. **They cannot be done through the
existing source**, and `coachMapRows.ts` has already worked out why, in a comment worth
quoting rather than re-deriving:

> `ArrangeRole` does not invert onto `SoundType` cleanly: `SOUND_TYPE_TO_ARRANGE_ROLE` sends
> both `fx` and `extFx` to `textureFx` and sends nothing at all to `aux`, so a
> `Record<ArrangeRole, SoundType>` would have to make two colour assignments up.

The other candidate, `busColorHex(ARRANGE_ROLE_TO_BUS[role])`, is total and already exists —
and is the tidied view's palette, flattens four of the eight roles onto aux's taupe, and would
make a map row disagree in colour with the very clip it points at in the arranger.

So rows keep the stem's own `typeColorVar` swatch and the role is carried by the row's **text**,
where it already is. The honest route to a role palette, if one is ever wanted, is to add role
tokens to `tokens.css` and make `typeColorVar` one lookup among several against a single token
source — a design-system change, not a feature change, and not this spec.

## What gets deleted

Worth listing, because this should come out smaller than it went in:

- Tidy Up's per-row note input, its `note` state, and `subcategoryNote` through the preload
  and store layers.
- The role step's two `<select>` pickers, its `updateRole` role/sub-role branch, and the
  stale-sub-role clearing that exists only because those two selects can disagree.
- One of the two `handleThumbnailClick` copies and one of the two suggestion chains.
- `recordRoleCategorization` and `recordRoleCategories`, replaced by one function.

## Open, deliberately not decided here

- **Where the merged surface lives.** Tidy Up is a modal; that is also what makes it safely
  mutually exclusive with the wizard (`useStemPreviewPlayback` notes the shared engine-
  ownership token is only safe because the two are never open at once). But a library pass is
  something you might sit in for an hour, which argues for a real view like the map. *To
  settle it I need to know which Elling expects: dipping in for thirty seconds, or working
  through the library.*
- **How the library population is ordered.** Unconfirmed first is obvious; within that,
  most-recently-imported, most-used-across-projects, or the classifier's least-confident.
  Least-confident is worth the most per click and costs the most to compute. *His preference.*
- **Whether "tidy up" is still the name.** It is his word and it has a tour step
  (`data-tour-id="tour-tidy"`), a menu entry, and `TidyUpNudgeModal.tsx` attached to it. "what
  is this?" is his phrase for the *question*; it may or may not be the name of the thing.
  Kept as "tidy up" here.
- **Whether an unguided map should offer to become a guided one.** That is the auto-arranger
  run against an arrangement that already exists, which is a different feature and is not
  designed here.

## Testing

Pure logic in `src/shared/`, TDD as ever:

- unguided column construction — bars and phrase in, column count and spans out, including the
  awkward cases (a total that is not a whole number of phrases, an empty timeline, a phrase
  longer than the arrangement).
- the phrase default and the distinct-lengths option list.
- the toggleable-row rule: material naming a single stem, material naming several, a riser, an
  empty row — and that the guided map's own rows still come out exactly as they do today.
- the write split: role always, bus only for the sketch population.
- the taxonomy tables stay total over their unions, which the type checker gets most of the
  way to already.

React components are not unit-tested in this codebase and no agent here can click the app or
hear it. **Only Elling can verify:**

- whether the unguided map is legible on a real messy arrangement, or whether sixty unnamed
  columns is just a wall.
- whether a library stem previewed through Discover's path *sounds* the same as a sketch stem
  previewed through Tidy Up's — same loudness, same one-at-a-time, same dryness.
- whether the classifier's suggestions across ~45,000 stems are good enough that a library
  pass is worth anyone's evening. If they are not, scope (b) is right in principle and
  worthless in practice, and that is the thing to find out first.
- whether losing the in-place role picker makes the auto-arrange wizard feel worse, and
  whether the reclassify popover is a good enough replacement in flow.
