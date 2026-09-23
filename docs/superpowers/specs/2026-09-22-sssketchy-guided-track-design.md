# sssketchy: guiding the user through a rough track

Date: 2026-09-22
Status: designed in chat over two sessions (2026-09-22), approved section by section; awaiting spec review

## Goal

Walk a user from an empty project to an exported rough version of a track ("V1"), guided by a
small pixel character, **sssketchy**. The method is adapted from the MPA 6-Hour Workflow guide
Elling supplied: build the CLIMAX loop first, then subtract from it to make every other section,
then polish and export. It replaces "stare at an empty arranger" with a sequence of small,
skippable steps.

Fits the existing app: Discover already IS a climax-loop builder; the arranger already has the
write path auto-arrange/draw-arrange use; export already produces mixdowns/Ableton/REAPER/stems.

## The character

- 80×80 pixel-art sprite, **redrawn in the app's own greyscale palette** (head `--ra-text`,
  body `--ra-text-3`, eyes `--ra-bg-row-active`) — committed under
  `src/renderer/src/assets/sssketchy/` (idle, walk1-4, jump, hit1-4, climb1-4), converted from
  Elling's sprite pack.
- **Only ever appears during the guided flow** (Elling's decision) — never an ambient assistant.
- Stands on the bottom edge near whatever the current step concerns, with a Clippy-style speech
  bubble: short, lowercase copy, e.g. "this one's the drop. everything plays. want me to pick the
  stems?" — note the phrasing states what the step *is*, never "it looks like you're…", which
  would be a guess about what the user is doing (see the rule below).
- The bubble carries the current step plus **next · skip · do it for me**, and a **stuck?**
  affordance that lists the concrete moves this step can make. Those four are the whole
  interactive surface of the bubble.
- **Clicking the sprite itself** opens the full checklist (3 phases, all steps, phase timers) —
  a different gesture from the bubble's buttons, so the two never compete. He can be minimised to
  a corner sprite or dismissed (which ends the guided flow, resumable later).
- Animations: idle = bob; walk = moving to another area (Discover → timeline); jump = step
  finished, big jump at V1; hit = the "stuck?" nudge and errors; climb = while the app works
  (building a section, exporting). Death frames unused.
- **Copy is hand-written, with 3–4 variants per line, rotated.** Repeating himself word-for-word
  is most of what makes a character feel dead; vocabulary is cheap and it is the one part of
  "alive" we can buy without any inference.

## What he is allowed to say (the rule that keeps him from being Clippy)

**sssketchy never decides when to speak, and never has an opinion about your music.** Both of
those are inference, both are easy to get wrong, and a wrong confident suggestion about a track
the app cannot hear is exactly the failure this design exists to avoid (Elling, explicitly).

Instead:

- **The step triggers him, not a heuristic.** He speaks when you arrive somewhere in the flow.
  (The one exception is the gentle stuck-timer below, which is triggered by elapsed clock time —
  a fact, not a guess about the music — and only ever offers the same step actions.)
  Everything he says is true by construction, because it is about *the step*, not about your
  arrangement. He is "a guy who knows what to do next," not "a guy with notes on your song."
- **One thought at a time.** A new step's text replaces the old one; nothing stacks, nothing is
  saved for later, there is no list of pending suggestions. A stack would turn him into a todo
  list of things a computer thinks your song needs, which is a worse object than a small guy
  with one thing to say — and it would let unacted suggestions accumulate into pressure.
- **Poking him offers actions, not advice.** The bubble's **stuck?** button surfaces concrete
  moves *this step can make* ("want me to duplicate this section?"), drawn from the same tables
  that drive "do it for me". It never produces a judgement.
- **Everything he makes is ordinary, editable material.** Sections go down through the arranger's
  existing write path; a riser is the same riser you get from right-clicking, freely movable,
  resizable, and redrawable afterwards. One undo step each. The guided flow must never produce a
  second-class result that behaves differently from hand-made work.

### Considered and declined: an external LLM

Discussed connecting a cheap model (bring-your-own key) to generate his lines or answer typed
questions. **Declined for now.** The decisive reason is not cost — it is that the model cannot
hear the audio, so it would receive a text summary of facts the app already computed, paraphrase
them back, and occasionally invent one. All new risk, no new knowledge, against hand-written copy
that is wrong zero percent of the time.

The door stays open for one specific case that has no local substitute: answering a *typed*
free-form question. If it is ever built, the contract is — user's own key, pasted in Settings,
off by default, sssketchy fully functional without it, the model **never triggers anything and
never makes a decision**, and the Settings copy says plainly what is sent (a text summary:
section count, channel names, traits — never audio, never file paths).

## Coach state machine (pure, `src/shared/`, TDD)

Tracks: chosen flavour (melodic | groove), ordered phase-1 steps, current step, the locked
climax (stem ids + roles + gains), sections built so far (type, bars, which stems play),
per-phase elapsed time, and dismissed/minimised state. **Persisted in the project file**, so a
half-finished guided track resumes. All step transitions, suggestion tables and completion
checks are pure functions with tests; the panel/sprite is a thin renderer.

## Starting the flow

**Button only** (Elling's decision) — sssketchy never appears on his own, not even on an empty
project. The entry point is a button in the **project menu row**, alongside new / open / save /
tidy / export: it is a project-level verb like the rest of that row, the titlebar is already
crowded with the mode toggle, and putting it inside Discover would hide it from the person
opening an empty project for the first time, who is exactly who it is for.

A half-finished guided track resumes from the same button (see the coach state machine's
persistence above).

## Phase 1 — the climax loop (in Discover)

1. sssketchy asks **melodic or groove**, and offers **"start from a riff you love"** (existing
   Discover seeding).
2. Steps, ordered by the answer:
   - groove: low end (bassish + drummy) → harmony (leadesque · buttery) → drums filled out →
     supporting (chonky / rhythmic / sparkly) → the hook → rough balance.
   - melodic: harmony → low end → drums → supporting → hook → balance.
3. Each step pre-arms the matching kinds in Discover's add row; **"do it for me"** adds the slot
   itself. A step completes when a slot with those kinds resolves; next/skip always available.
   Seeded starts mark already-covered roles done ("you've got drums and bass, next: harmony").
4. The hook step suggests trying 3–4 options (reroll and compare).
5. **"lock in the climax"** freezes the loop: its stems, roles and gains become the material
   phase 2 carves from.

## Phase 2 — sections, one at a time (Elling chose section-by-section, build-as-you-go)

- sssketchy asks what comes first (suggests intro, or build for a short sketch).
- Per section: name + bar length (nudgeable ±4/±8), the climax stems as toggles **pre-set by
  subtraction rules** (intro: drums + supporting; build: add harmony/tension; drop: everything;
  breakdown: harmony + hook, no kick/bass; outro: mirrors intro), **preview** (loops just that
  section), then **next** places it on the timeline immediately.
- After each section: "what comes next?", from a suggestion table (after build → drop; after
  drop → breakdown or outro; …). Choosing **outro** ends phase 2.
- Subtraction defaults and transition suggestions are plain tested tables in `src/shared/`.
- Placement reuses the arranger's existing write path (buildArrangeReplaceActions), so the
  result is ordinary, fully editable arrangement — one undo step per section.

## Phase 3 — finish

- **Tension pass:** at each section boundary, offer the built-in toolkit (shipped 2026-09-22, see
  `2026-09-22-builtin-sound-toolkit-design.md`) — filter sweep/swell into drops, fade into
  breakdowns — toggle + preview each.
- **Risers into drops.** At every build→drop boundary sssketchy offers to drop a riser, pre-sized
  to the bars leading in, previewable, placed by the same action the right-click menu uses. This
  is the least ambiguous suggestion in the whole method — the section is literally named "drop" —
  and it is the most effective single move in the MPA workflow. It was out of scope when this
  spec was first written because risers did not exist yet; they do now.
- **Balance check:** play the whole track with the gain controls to hand.
- **Export V1:** the existing export picker (mixdown / Ableton / REAPER / stems), then
  sssketchy's big jump; the project is marked "V1 exported".

## Timekeeping (Elling chose the gentle timer)

Phase targets shown in the checklist (loop 60–90 min, arrangement 2–3 h, polish 45–60 min).
After ~10 minutes on one step, a quiet nudge: "stuck? try 'do this step for me', or move on."
Never blocks, never auto-advances.

## Build order (each its own plan)

1. sssketchy + coach framework (sprite component, speech bubble, checklist, state machine,
   persistence, start entry points).
2. Phase 1 (Discover integration, pre-arming, seeded-start detection, lock-in).
3. Phase 2 (section steps, subtraction/transition tables, preview, placement).
4. Phase 3 (tension pass, balance check, export hand-off, V1 marking).

## Testing

Pure step/suggestion/subtraction logic TDD'd in `src/shared/`; persistence round-trip tested in
the project-file layer; the panel, sprite animations and the Discover/arranger integration by
manual walkthrough (no GUI tooling for an agent here).

## Out of scope

- Generating audio or stems (sssketchy only arranges what Discover found).
- Mixing beyond gains, and mastering. Impacts/ear candy beyond the riser — possible later steps.
- sssketchy outside the guided flow.
- Any external LLM **in this build** — not rejected in principle, and Elling is open to it later;
  see "Considered and declined" above for the contract it would have to meet.
- Any suggestion that requires judging whether the music is *good*. He can point at what a step
  is for; he does not review your track.
