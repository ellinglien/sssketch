# Radio: show moves as they happen

Elling, 2026-10-05: "is there a way to show when a transition action like a dropout or filter sweep is
taking place? maybe a quicker fade in and out." Approved as proposed ("yes, that sounds right").

## The idea

Today a move only flashes its word on the row, and the word fades slowly. Instead, **the row itself
shows the move while it sounds**, driven by the same curves the audio follows. Quick fades in and out.
Colourless: brightness and shape only, so it fits the design systems of both the web radio and
sssketch, which reserve colour for audio information.

## What each move looks like

| move (and where it comes from) | the row, while it sounds |
|---|---|
| drums out / low out / stop (turnarounds); breakdown rests (intensity arc); resting hooks; hole | waveform dims to about 25% brightness while silent, following the volume curve; fades in ~100 ms, back to full on the one |
| lift / dip (filter sweeps: turnarounds; filter-in arrivals) | waveform thins with the filter: lift (high-pass) fades its lower half's opacity, dip (low-pass) fades its upper detail. Shape follows the curve, back on the one |
| wash (reverb swell; bloom arrivals) | a soft glow or blur on the waveform that grows with the send, then clears |
| riser | a thin fill line on the row (or the ruler) sweeping toward the one |
| gap (riser gap / drop gap) | every silenced row dimmed; the one brings everything back at once |
| duck | a brief dip in brightness following the duck curve |
| throw (dub echo) | a short trailing ghost of the row's waveform, fading with the echo |

**Flash words:** the move's word stays on for the move's duration, then fades out fast (~150 ms),
replacing today's long fade.

## How

- **Drive the visuals from the plan, not from audio analysis.** Each runtime already holds the
  curves it schedules: turnaround plans (`radioTurnaround` merged row curves), gesture curves,
  throws and rests. A pure shared helper evaluates each row's visual state at a time:
  `radioRowVisualAt(plans, rowId, t)` returns `{ level, lowCut, highCut, wash, riser, ghost }`, each
  0..1. Both radios render from it, so they stay in sync and it can be tested.
- **Rendering:**
  - **Web:** CSS custom properties on the row (e.g. `--row-level`, `--row-wash`) updated per
    animation frame, with transitions short enough to read as following the music.
  - **Desktop:** the same through the row plates and the waveform cell's style.
  - Respect `prefers-reduced-motion`: show steady states, no sweeps or glows.
- **Cost:** one evaluation per row per frame, only while a plan is active, and idle otherwise.
- **Timing:** read the audio clock (the web's AudioContext time; the desktop's position tick) so the
  visuals land on the beat, not on React render timing.

## Sequencing and tests

- **Sequencing:** after the intensity arc's UI tasks (web full mode, desktop strip), because they
  touch the same row and strip files.
- **Tests:**
  - The shared helper is tested against known plan curves: level 0 during a drop, 1 on the one;
    lift and dip values; wash peak timing.
  - A headless screenshot pass covers the web at 320 and 390 px.
- **Walkthrough for Elling:** watch a drums-out, a lift, a wash, a riser into a gap, and a
  breakdown. Each should be visible while it sounds, with quick fades and nothing lingering.
