# sssketch — design handoff

A portable brief for tinkering with sssketch's UI in Claude Design (claude.ai/design) or
anywhere else that benefits from real grounding instead of a blank slate. Everything below is
pulled directly from the app's actual source — `src/renderer/src/styles/tokens.css` is the
single source of truth; this doc is a readable summary of it, not a separate spec that can
drift from the real thing.

Worth knowing: this design language didn't start from scratch — it was originally worked out
*in* Claude Design (`Rifff Arranger.dc.html`, then re-cut into a monochrome pass called
`Ssstitch 6b Real.dc.html`) and imported into the codebase as tokens. Picking it back up there
is continuing something, not starting over.

## Identity

A near-black, monochrome desktop app shell. Comic Relief (an open Comic Sans replacement)
throughout, sharp corners everywhere — no rounded rectangles anywhere, buttons and clips
included. Color is spent deliberately and sparingly: almost the entire UI is greyscale, and
saturated color appears *only* on things that carry actual audio information (stem
waveforms/glyphs, the playhead, mute/danger state). Chrome — panels, buttons, borders, text —
never gets color.

No gradients, no glow, no blur, no scale-on-hover anywhere. Interaction states are plain:

- **hover** — background steps one shade brighter
- **focus** — a 1px accent border, no glow/ring
- **disabled** — 30% opacity, `cursor: not-allowed`

## Color tokens

**Shell (near-black neutrals)**

| Token | Hex | Use |
|---|---|---|
| `--ra-bg-page` | `#050505` | canvas behind the app |
| `--ra-bg-frame` / `--ra-bg-bar` / `--ra-bg-rail` / `--ra-bg-row` | `#0a0a0a` | app frame, transport bar, inspector, shelf, ruler, block rows |
| `--ra-bg-row-active` | `#161616` | selected row, control fill |
| `--ra-bg-row-sub` | `#0e0e0e` | expanded stem sub-row |
| `--ra-border` | `#222222` | default border |
| `--ra-border-soft` | `#1a1a1a` | quieter border |
| `--ra-border-strong` | `#3a3a3a` | primary buttons, dashed drop targets |
| `--ra-grid-minor` | `#151515` | bar lines between downbeats |

**Text**

| Token | Hex | Use |
|---|---|---|
| `--ra-text` | `#ededed` | primary |
| `--ra-text-2` | `#8f8f8f` | secondary |
| `--ra-text-3` | `#6a6a6a` | tertiary |
| `--ra-text-4` | `#3a3a3a` | disabled |

**Sound-type colors** — the only saturated colors on screen besides the playhead. Each type
gets one hue, applied consistently as a swatch, clip fill, waveform, glyph ring, and chip:

| Type | Hex |
|---|---|
| drums | `#d98b4e` |
| notes | `#c9a24a` |
| bass | `#7fb0d8` |
| ext. instrument | `#c07fb8` |
| sampler | `#9a8fd8` |
| fx | `#5ec8b5` |
| ext. fx | `#7fc98a` |
| audio in | `#c56164` |

Alpha recipe for any type color `C`, applied consistently everywhere a type color is used:
- clip background — `C` @ 7%
- clip border — `C` @ 50%
- chip background — `C` @ 14%
- glyph petal — `C`, opacity .55
- selected card — background `C` @ 10%, border `C` @ 60%

**State colors**

| Token | Hex | Use |
|---|---|---|
| `--ra-playhead` | `#c56164` | playback cursor |
| `--ra-mute-on` | `#c56164` | muted state |
| `--ra-recording-live` | `#8f7dd4` | live loop-record capture + a committed recorded take's identity color — deliberately distinct from the `audio-in` sound-type color, which covers any audio-in stem regardless of how it got there |

Toggle-active chrome (play, envelope, compact, stretch buttons) is a subtle grey fill + bright
ink, *not* a saturated color — this app spends color only on audio data, never on chrome. The
one exception is the transport play button, which inverts to a bright background / dark ink
while playing, as a deliberate "live" cue.

## Typography

Font stack: `'Comic Relief', ui-rounded, 'Comic Sans MS', system-ui, sans-serif`

| Size | Use |
|---|---|
| 9px | slot numbers, dB, meta |
| 10px | labels, eyebrows, hints |
| 11px | stem + rifff names |
| 13px | app title, body |
| 14px | inspector title, tempo value |
| 16px | transport position, offset value |
| 19px | tempo pair |

Weights: regular (400), semibold (600), bold (700). Line-height: 1.25 tight / 1.6 body.
Letter-spacing: 0.06em for labels, 0.08em for uppercase eyebrows.

**Copy voice:** all UI copy is lowercase. Eyebrows (section labels) are uppercase. No emoji,
no exclamation marks, ever.

## Geometry & spacing

- **Corner radius: 0px, everywhere.** No rounded rectangles — buttons, clips, panels, cards,
  none of it.
- Spacing scale: `4 / 7 / 9 / 10 / 12 / 14 / 20 / 32px`
- Fixed chrome heights: transport bar 46px, ruler 24px, block row 52px, stem sub-row 26px,
  stem lane 34px, titlebar 38px
- Fixed chrome widths: lane header 212px, inspector 308px, shelf card 212px, popover 268px
- Timeline zoom: 24px per bar as the default

## Motion

- fast (hovers): 120ms
- medium (state changes): 220ms
- slow (panel slides): 380ms
- easing: `cubic-bezier(0.22, 0.8, 0.32, 1)` throughout — no default/linear easing

## Elevation

Popovers get one soft drop shadow (`0 6px 20px rgba(0,0,0,0.4)`) and nothing else — no shadows
on buttons, panels, or cards.

## Component conventions worth knowing

- Buttons have no default browser chrome — every one gets an explicit dark-theme style
  (background, border, text color) or it falls back to invisible near-white-on-white browser
  defaults. A disabled button gets dimmer border/text rather than relying on the browser's
  automatic disabled styling.
- Dialogs share one visual treatment: the same near-black panel + border, centered, with a
  semi-transparent dark backdrop and no click-outside-to-dismiss (an ambiguous "click away"
  shouldn't stand in for pressing an explicit button on anything consequential).
