# The arrangement map: sssketchy inside the auto-arranger

Date: 2026-09-23
Status: designed in chat with Elling, section by section; awaiting spec review

Supersedes most of `2026-09-22-sssketchy-guided-track-design.md`. That flow was built in full
overnight 2026-09-22/23 and Elling walked it. His verdict, in his words: "i think sssketchy
should be merged into the existing auto-arranger, giving it a bit more of a step by step
granular flow… we should pivot sssketchy to be used there instead of anywhere else," and
"building a loop for the climax… that is the easy part for people, honestly."

## What we learned by building the wrong thing first

Three findings from the walkthrough, each of which sets a rule here:

1. **Phase one solved a problem nobody has.** Six guided steps to assemble a climax loop in
   Discover, when assembling a loop is the part people already enjoy and are good at. Deleted.
2. **A standalone flow is the wrong home.** sssketchy lives in the auto-arranger now, and
   nowhere else. The project-menu entry point goes.
3. **Screen-driving was considered and rejected by Elling before it was built** — having
   sssketchy send the user between Discover and the arranger. "I feel now that this isn't
   helpful." Not in scope, and worth not re-deriving.

## Sources

- A producer workflow guide Elling read during the earlier pass, summarised here in our own
  words: build the climax loop first, then subtract from it to make every other section. This is
  long-standing common practice rather than anything proprietary — the same move shows up in the
  structure article below and in most "get out of the loop" advice.
- edmprod.com/beatport-analysis — EDM song structure as paint-by-numbers. Its most useful
  observation for us: hardstyle, future bass and big-room tracks all land on nearly the same
  section ORDER (`A B C D B C D A`). What actually differs by genre is section LENGTH. That is
  why there is no genre picker below.
- jukeblocks.io — a roles-by-sections grid generated from a template, which is what the map
  below is modelled on.

## The map

**One arrangement, two zoom levels.** A view toggle between the timeline and a map: rows are the
arranger's own channel rows, columns are sections. Toggling a cell edits the real clips — there
is no commit step and no second model to drift out of sync.

```
  [ map ]  [ timeline ]

          intro |     verse     | bld | DROP |
                | 1 | 2 | 3 | 4 |     |      |
  kick      .   | x | x | x | x |  x  |  x   |
  bass      .   | . | x | x | x |  .  |  x   |
  lead      .   | . | . | x | x |  x  |  x   |
  hook      .   | . | . | . | x |  .  |  x   |
```

Chosen over a grid-you-commit and over a timeline-only walk: the map stays useful long after the
guided pass, and a section you cannot yet imagine is exactly what a map is for.

### Cells split per pass

A section runs for N passes of the loop, and **each pass is its own cell**. This is the answer to
the repetition problem below, and it is what "granular" means here: stems arrive and leave across
a section, so four passes of a four-bar loop stop being four identical bars.

## Sections are measured in phrases, not bars

Currently section lengths are hardcoded (intro 8, verse 16, drop 16, nudged ±4/±8) with **no
relationship to the loop at all**. Elling caught this: "the starting loop will be different
lengths… are you taking number of bars into account."

The consequences today: a 6-bar loop in a 16-bar verse gives two passes and a two-bar stump cut
mid-idea; a 4-bar loop in a 16-bar verse is four identical repeats and nothing notices.

**So a section's length is a count of passes, and the nudges are ±1 and ±2 passes.** Section
boundaries then always land on phrase boundaries whatever the loop length is. The template's bar
counts (below) become targets that round to the nearest whole number of passes.

## The phrase pass, and who decides

A loop's NOMINAL length is not necessarily its musical phrase. An 8-bar loop can be the same 4
bars twice.

This is **measurable, not a matter of taste**: comparing a stem against itself at candidate
periods (1, 2, 4, 8 bars) finds the smallest period that explains it. Per stem, because a kick
repeating every bar is fine while a lead repeating every 2 bars in an 8-bar loop is what makes a
track feel stuck. The real phrase length is the LONGEST true period across the loop's stems.

Because it is a measurement, sssketchy can state it as a fact without breaking the rule below:

> "this 8-bar loop is really the same 4 bars twice."

**Elling decides what happens next — this is a direct instruction ("loop in the user in those
decisions though about the loop length"):**

- The finding is REPORTED, once, before the map is built. Nothing is halved, trimmed or resized
  automatically.
- He answers what the phrase actually is — the measured value or the nominal one — and section
  sizing follows HIS answer.
- He can change it afterwards; the map re-sizes, it does not rebuild.
- If the measurement is inconclusive, sssketchy says nothing rather than guessing.

The advice this enables is the useful, non-bossy kind: "your phrase is 4 bars — you could halve
this loop and get twice the arrangement out of the same material." Ignorable.

## Getting started: two questions

1. **"What is this loop?"** — drop / verse / intro / not sure. This decides where the material
   the user already has lands in the structure. It is the article's central move and it replaces
   all six of phase one's steps.
2. **"How long a journey?"** — a shape, shown in the article's own letter notation, with no genre
   attached:

   | | | |
   |---|---|---|
   | short | `A B D A` | ~2 min |
   | standard | `A B C D B C D A` | ~4 min |
   | long | `A B C D E C D A` | ~6 min |

   `A` intro/outro · `B` verse · `C` build · `D` drop · `E` breakdown

   Target lengths from the article, rounded to whole passes: intro/outro 8–16 bars, verse 16
   (second 16–32), build 8, drop 8–16 (second the same or longer).

   Chosen over a genre picker deliberately: the order barely varies by genre, so a genre list
   would mostly be one template wearing six names, and someone would have to be right about
   genres.

## The map arrives pre-filled, and says so

Cells come filled in from the template — intro sparse, drop full, build without the hook. This
**deliberately reverses** the everything-on/user-subtracts rule from the superseded phase 2, and
the reversal is the point: eight identical sections is the blank page again, and the whole value
of paint-by-numbers is that it does the imagining the user cannot do yet.

What makes it legitimate here is that the map shows the entire song at once, so nothing is
removed invisibly. Elling's condition: **sssketchy states that he made the call, and states the
way out.**

> "that is the usual shape. cmd+z puts everything back on if you would rather start full."

## sssketchy on this surface

He **walks the sections with you**, one at a time, highlighting that column and naming what the
section is FOR. Leaving the walk keeps the map.

**Goals, not dictates. Advice, not rules** (Elling, twice). The distinction that matters:

- Good: "the verse should hint at the drop without giving it away."
- Good: "this is where it lifts."
- Bad: "add a riser at bar 48."
- Bad: anything asserting his track needs something.

A goal is a statement about song structure, which is true regardless of what the user made. This
is a better fit for the governing rule than the superseded design managed, because a goal cannot
be wrong about music the app has not heard.

### Tone: a gentle coach, not a teacher or a drill sergeant

Elling's words, and the hardest part of this to get right, because "states the goal of the
section" drifts into lecturing almost by itself.

- **Not a drill sergeant.** No imperatives aimed at the user, no checklists of what they must do
  next, no counting what they have not finished. He never chases.
- **Not a teacher.** He is not explaining music theory, and a step is not a lesson. If a line
  could open with "remember that…", it is wrong.
- **A gentle coach.** He says what a section is for, offers a way in, and is comfortable being
  ignored. He is at ease with the user skipping, leaving, or doing the opposite.

The test to apply to every line: *could a friend say this while leaning over your shoulder,
without it being annoying?*

| | |
|---|---|
| drill sergeant | "add a riser here. next: thin out the verse." |
| teacher | "a verse, by definition, establishes the melodic motif before the drop." |
| gentle coach | "this one is the lift into the drop. want to try taking the hook out?" |
| gentle coach | "nothing has to change here. it already does its job." |

That last row matters: he is allowed to say a section needs nothing. A coach who always has a
suggestion is a drill sergeant with better manners.

### Carried over unchanged from the superseded spec

- One thought at a time; a new step's text replaces the old. No stack.
- The step triggers him; he never decides when to speak and never judges the music.
- Copy is hand-written, 3–4 rotated variants, lowercase, no emoji, no exclamation marks.
- Everything he makes is ordinary editable material: one undo step, no special objects.
- No external LLM in this build — declined for now, not in principle. Contract unchanged.
- The sprite, bubble, checklist and coach state machine survive; only where he lives changes.

## What happens to the code that exists

- **Phase 1 — deleted** (Elling: "yes del phase 1"). `coachPhase1.ts`, its Discover pre-arming,
  the seeded-start detection, the flavour question, `coachDiscoverBridge.ts`, and the phase-one
  step rows.
- **Phase 2 — rebuilt around the map.** The section model (`coachSections.ts`) largely survives;
  what changes is that lengths become passes, cells split per pass, and defaults arrive
  pre-filled from a template rather than everything-on.
- **Phase 3 — mostly kept.** The tension pass still applies at section joins, risers still go
  into drops, and the balance/export steps are unchanged. It plugs into the map's boundaries
  instead of phase 2's section list.
- **The project-menu entry point — deleted.** The auto-arranger is the only way in.

## Open, deliberately not decided here

- Whether the map gets an energy row (the article draws an "energy map" as an automation line;
  jukeblocks has an Automation row). Appealing, but it is a second thing to design.
- Dragging a riser vertically between rows (already noted in the riser-own-row plan).
- Whether the walk should be resumable across sessions, as the superseded flow was.

## Testing

Pure logic in `src/shared/` TDD'd as ever: the phrase measurement, pass arithmetic, the template
tables, and the map↔arrangement round trip (the risky part — every timeline edit must read back
into the map correctly). React components are not unit-tested in this codebase, and no agent here
can click the app or hear it, so the map's feel, the walk, and whether the phrase measurement is
RIGHT on real Endlesss loops are all Elling's to verify.
