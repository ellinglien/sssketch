# phone remote — design brief

**For a design pass. Written 2026-09-27, against the code as it stands that day.**

This brief exists so a design pass starts from what is true rather than rediscovering it.
Everything below marked **fixed** is a hard constraint of the platform or the product; the
questions at the end are the parts genuinely open.

---

## What this is

sssketch is a macOS desktop app for turning Endlesss "rifff" stem exports into arrangements.
One screen in it, **Discover**, is a slot machine for stems: you declare a few slots ("a drums
one", "a bright one"), it pulls candidates from your riff library, stacks them into a loop, and
plays it. You roll until something is good, then press **keep**, which saves that combination
into a `discovered` room as a rifff you can open later.

The **phone remote** is a web page the Mac serves on the local network so you can drive Discover
from the sofa. **The audio never leaves the Mac** — the phone is a controller, plus (since
2026-09-26) it can also play the current loop through its own speaker, rendered on the Mac and
fetched as a wav.

It is one person's tool. Elling built sssketch; he is the only user of this page. It does not
need onboarding, marketing, empty-state charm, or accommodation of people who have never seen
Discover. It needs to be good to hold.

### The moment it is used

On a sofa, one-handed, phone in portrait, at night, while the Mac plays music across the room.
The interesting verb is **rolling until something is good** — a repeated, low-stakes, slightly
addictive tap. The page is closer to a games console than a dashboard. The product's own voice
calls this a "side quest", and the whole app is pitched at a Silkscreen-font, classic-video-game
register.

---

## Hard constraints — fixed, do not design around them

**The page is a single string constant** in `src/main/remotePage.ts` (Electron main process).
No bundler, no second file, no build step, no framework. Everything ships inline.

**Content-Security-Policy**, set as a header by the server and not negotiable:

```
default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';
font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'
```

Consequences, all of them absolute:
- **No external anything.** No Google Fonts, no CDN, no icon library, no image host.
- **No images at all** — `default-src 'none'` and no `img-src`. Not even a data: URI image.
  Anything pictorial must be CSS, text, or `<canvas>`.
- No iframes, no forms, no `<base>`.
- Fetch is same-origin only.

**Typeface: Silkscreen**, embedded as a base64 woff2. It is a pixel font. It has **no bold and
no italic** — weight cannot carry hierarchy. Size, colour, spacing and inversion are the only
levers. Fallback is `ui-monospace, monospace`.

**No `border-radius` anywhere.** Set globally as `* { border-radius: 0 }`. Sharp corners are the
house style across the whole product.

**Near-black monochrome.** Ground is `#050505`. Colour is spent *only* on things carrying audio
information. On this page exactly two things qualify and they are already coloured:
- slot rows tint by the stem's sound type (`drums #d98b4e`, `bass #7fb0d8`, `lead …` — a fixed
  8-entry table copied from the desktop)
- the playhead line is `#c56164`, the same red the real timeline uses

Everything else is grey: `#ededed` text, `#8f8f8f` secondary, `#6a6a6a` eyebrow, `#3a3a3a`
borders-strong, `#222222` borders, `#0a0a0a` raised surfaces. **Do not introduce a new colour**
and do not colour chrome. Selected/armed states **invert** rather than colour.

**Copy is lowercase.** No emoji. No exclamation marks. **Buttons are two words maximum, or an
icon.** Labels are playful but terse.

**Touch targets.** Anything tappable is at least ~42px tall even where the type is 10px; the type
size and the hit area are decoupled on purpose. `touch-action: manipulation` is set globally
(double-tap zoom caused a real bug; pinch-zoom is deliberately preserved).

**Layout envelope.** Content column is `max-width: 420px`, centred, 16px side padding, with
`env(safe-area-inset-*)` top and bottom. Must work on a small iPhone in portrait. Must render
correctly in **iOS Safari and Brave**.

**Script dialect.** The inline JS is deliberately conservative — no arrow functions, no `?.`, no
`??`. This is enforced by a test. It matters only if you write code; see "what to deliver".

---

## What is on the page today

Two states. **Pair** (eyebrow / `side quest` / instruction / 4-char code input / `pair`), then
the app.

The app, top to bottom, exactly as it stacks now:

| block | content | notes |
|---|---|---|
| eyebrow | `sssketch` | 10px `#6a6a6a` |
| h1 | `side quest` | 15px, regular |
| counts | `kept 0 · rolled 0` | 10px eyebrow |
| kept-name | last kept rifff's name | 10px, reserves 16px even when empty |
| empty | `pick what you want below, then add it` | only when there are no slots |
| rows | one row per slot: kind label (84px) + stem name (ellipsised) + a 78px remove button | 14px padding, `#0a0a0a` on `#222222` |
| track | **34px waveform canvas** + 1px red playhead line | added 2026-09-26 |
| actions | `roll all` · `play` · `keep` | three equal buttons, 18px padding, transparent on `#3a3a3a` |
| picker | collapsed to one `add stem` button once slots exist; expanded it is an eyebrow + 3 mask chips + 4 trait chips + `add slot` | chips 10px type, 42px min-height, `min-width: 92px`, 3 per row |
| mac | which Mac, small | |
| msg | transient status line | |

**The waveform** is computed on the phone from the `AudioBuffer` it already decoded for playback
— 128 buckets, absolute max per bucket, played portion `#ededed`, unplayed `#3a3a3a`. Nothing is
fetched for it.

**This stack was never designed as a whole. It accreted**, one feature at a time, over about a
day. That is the honest reason for this pass.

---

## What is not up for redesign

- **The interaction model.** Slots, roll, keep. Not being rethought here.
- **Pairing.** A 4-char code and a QR on the Mac. Security-shaped; leave it.
- **Audio staying on the Mac.** The phone's own playback is a bonus, not the point.
- **What the page can know.** It sees the current slots, their stem names and sound types, counts
  of kept/rolled, the loop's wav, and a playhead position. It cannot see the library, waveforms
  of individual stems, tempo, or key.

---

## The real questions

1. **Hierarchy.** Nine stacked blocks in a 420px column, each added independently. What actually
   deserves the top of the screen? The rows are the content; the buttons are the verb; `counts`,
   `kept-name`, `mac` and `msg` are all small grey lines competing for the same register.

2. **The three buttons are equal and should probably not be.** `roll all`, `play`, `keep` have
   identical weight today. `roll all` is the repeated verb, the one pressed most; `keep` is rare,
   deliberate, and the only irreversible-ish one. `play` is a toggle pretending to be a button.

3. **The waveform's job.** It is currently decoration plus a progress indicator. Should it be the
   largest element — the thing you watch — or stay a 34px strip? It is the only non-text thing on
   the page, and the only element that can carry the "this is a music toy" feeling.

4. **One-handed reach.** Nothing about the current layout considers the thumb. The most-pressed
   control (`roll all`) sits mid-page; the least-pressed (`add stem`) sits below it.

5. **Radio mode, if it ever arrives here.** Radio shipped on the Mac 2026-09-26: leave it on and
   one layer of the stack swaps itself every 6–48 bars. On the phone that would turn this from a
   control panel into a lean-back surface — you watch and occasionally pin something. **It is not
   built for the phone and may never be**, but if the layout can be right for both without
   contorting, that is worth knowing. Do not add speculative UI for it.

6. **The pair screen** is four elements on an otherwise empty phone screen and currently looks
   like a form. It is the first thing anyone sees.

---

## Second surface: the desktop modal

`src/renderer/src/components/PhoneRemoteModal.tsx`, 271 lines, all inline styles against the
desktop's `--ra-*` tokens. It is what you open on the Mac to connect a phone. It shows: a QR code
(drawn as CSS/canvas, no image), the pairing code, the address, a copy-link button, and — added
2026-09-26 — a row of chips to pick which network address to serve on (`en0 192.168.2.126`,
`utun0 100.66.121.12`, `bridge100 192.168.3.1`).

That address picker exists because his router isolates wireless clients and the only address that
works is a Tailscale one. It is a genuinely awkward thing to explain in a small box, and it is
currently explained by a 10px line reading `if the phone cannot reach it, try another`.

Same design system, same constraints, except this one is a normal React component inside the app
(so no CSP problem and the real `tokens.css` applies).

---

## What to deliver

**Layout thinking, not production code.** The page is a hand-written string in the main process
under a strict CSP; whatever comes back will be translated by hand. A standalone HTML mockup is
the most useful single artifact — it can be opened and judged — but it will be read as a
specification, not pasted.

Most useful, in order:
1. One or two **complete alternative layouts** for the app state, at 390×844 (iPhone portrait),
   as HTML that can actually be looked at.
2. The **reasoning** — what got promoted, what got demoted, what got cut.
3. The **pair screen** and the **desktop modal**, if there is appetite.

If you do write HTML: inline everything, no external resources, **no `<img>` at all**, no
`border-radius`, Silkscreen with a monospace fallback (the real face is embedded in the product;
a mockup can name the family and fall back), and keep the palette above.

**Say what you could not judge.** Nobody involved can hold this on a phone during the design
pass — the only person who can is Elling.
