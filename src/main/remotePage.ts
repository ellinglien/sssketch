// src/main/remotePage.ts
import { REMOTE_PAIR_QUERY_PARAM } from '@shared/remoteAuth'
import {
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_SLOT_KIND_OPTIONS,
  isTraitSlotKind
} from '@shared/discoverSlotKind'
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES } from '@shared/radioTurnaround'
import { SILKSCREEN_REGULAR_WOFF2_BASE64 } from './remoteFont'

/** The page's own Content-Security-Policy, sent as a header by
 * remoteServer.ts. Everything the page needs and nothing it does not:
 * inline style and script (there is no bundler here and no second file to
 * fetch), data: fonts (the Silkscreen face is embedded -- see remoteFont.ts
 * and commit 25ab55d for why that combination has to be spelled out), and
 * same-origin fetch for the eight API routes. No images, no frames, no
 * forms, no base tag. The kind picker added two routes and no new kind of
 * resource, so this is unchanged by it and must stay that way. The
 * slot-action route (2026-09-27) added one more route and, again, no new
 * kind of resource. */
export const REMOTE_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'font-src data:',
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

// Hand-copied literals from src/renderer/src/styles/tokens.css, which is
// the single source of truth for this app's design tokens. This is a COPY
// and it will drift; that is cheaper tonight than any sharing mechanism
// between a Vite-bundled stylesheet and a main-process string. Colour is
// spent only on the slot rows, which carry a stem's own sound type,
// and on the progress line, which is #c56164 -- the same hand-copied
// --ra-playhead literal Playhead.tsx uses on the real timeline and
// DiscoverPanel.tsx draws over a previewing slot's waveform. Those two are
// the only things on this page that carry audio information. Everything else
// is monochrome, sharp-cornered, lowercase -- including the kind picker's
// own chips and the armed state of a remove, both of which invert instead
// of colouring.
const TYPE_COLORS: Record<string, string> = {
  drums: '#d98b4e',
  notes: '#c9a24a',
  bass: '#7fb0d8',
  extInst: '#c07fb8',
  sampler: '#9a8fd8',
  fx: '#5ec8b5',
  extFx: '#7fc98a',
  audioIn: '#c56164'
}

/** Whether this request is a BROWSER NAVIGATION rather than one of the
 * page's own fetch calls -- the one distinction that decides whether a
 * refusal is readable or a white void.
 *
 * `fetch()` with no Accept of its own sends the match-everything wildcard
 * and names no type; a navigation sends a list that leads with text/html.
 * Nothing else on this surface needs to know the difference, and nothing
 * about authorisation depends on it: the status code is the same either
 * way, and so is the fact that every unrecognised path answers
 * identically. */
export function acceptsHtml(accept: string | undefined): boolean {
  return (accept ?? '').toLowerCase().includes('text/html')
}

/** Refused because the Host header is not the address this server is
 * serving. The realistic cause, and the bug this page was written for
 * (2026-09-26): a phone whose tab still points at the address the Mac
 * advertised before the LAN-address ranking landed (f1fcc9b). The server
 * binds 0.0.0.0, so the old address still CONNECTS -- it is only the guard
 * that refuses it, which is why this reads as "loaded, blank" and not as
 * "cannot connect".
 *
 * It deliberately does not print the address it expected: the Host guard
 * exists so that something reaching this server under the wrong name learns
 * nothing about it, and a notice naming the right address would hand that
 * back. The Mac is one glance away and already shows it. */
export const REMOTE_WRONG_ADDRESS_NOTICE =
  'the mac is not serving this address. check the address the remote shows on the mac.'

/** Every unauthenticated request other than GET / and POST /api/pair, and
 * every request to a path that does not exist, authenticated or not -- one
 * identical answer, so nothing here reveals which routes are real. */
export const REMOTE_NOTHING_HERE_NOTICE = 'nothing at this address.'

/** A refusal, as a page a phone can read, instead of the two characters of
 * json a phone draws as a white screen.
 *
 * Same ground, same typeface and the same lowercase voice as the remote
 * itself, and nothing else: no retry, no diagnostics, no report. The font
 * is `swap` rather than the remote's `block` -- a one-line page must not
 * spend its first three seconds invisible, which is the failure being fixed
 * here. */
export function remoteNoticePage(line: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>sssketch · side quest</title>
<style>
@font-face {
  font-family: 'Silkscreen';
  src: url(data:font/woff2;base64,${SILKSCREEN_REGULAR_WOFF2_BASE64}) format('woff2');
  font-weight: 400;
  font-display: swap;
}
/* touch-action: manipulation kills the double-tap-to-zoom gesture, which he
 * hit by accident tapping a chip twice. It is manipulation rather than none:
 * none would also kill scrolling, and it deliberately leaves pinch-to-zoom
 * alone, so the page can still be zoomed on purpose. The other way to stop
 * this is user-scalable=no in the viewport, which takes pinch away too and
 * which safari has ignored since ios 10 anyway. On * rather than on body
 * because touch-action is not inherited -- the gesture is resolved against
 * the element actually tapped, which is always a chip or a button. */
* { box-sizing: border-box; border-radius: 0; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
body {
  margin: 0;
  padding: env(safe-area-inset-top, 0px) 16px env(safe-area-inset-bottom, 0px);
  background: #050505;
  color: #ededed;
  font-family: 'Silkscreen', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}
.wrap { max-width: 420px; margin: 0 auto; padding: 24px 0 32px; }
.eyebrow { font-size: 10px; color: #6a6a6a; letter-spacing: 0.08em; }
h1 { font-size: 15px; font-weight: 400; margin: 0 0 2px; }
.msg { font-size: 11px; color: #8f8f8f; margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">sssketch</div>
  <h1>side quest</h1>
  <div class="msg">${line}</div>
</div>
</body>
</html>`
}

/** The seven chips, in the desktop add row's own order and with its own
 * playful labels, plus which of the two groups each belongs to (mask kinds
 * filter, trait kinds rank -- the desktop draws a divider between them and
 * so does this). Generated from the shared list, so a new kind appears on
 * the phone by existing. */
const KIND_CHIPS = DISCOVER_SLOT_KIND_OPTIONS.map((kind) => ({
  k: kind,
  l: DISCOVER_SLOT_KIND_LABEL[kind],
  t: isTraitSlotKind(kind)
}))

/** The stem action sheet, as data. Four actions, and they are exactly the
 * four buttons that have been on every desktop Discover slot row since
 * 2026-09-20 -- `similar`, `adjacent`, `random`, `duplicate` -- reached by
 * tapping the row instead of by a mouse. `a` is the wire value
 * (RemoteSlotAction, @shared/remoteState), `l` is the two-word-maximum
 * label and `h` is the hint line under it. The hints are what a label of
 * two words cannot say; they are not tooltips and they are not sentences. */
const STEM_ACTIONS = [
  { a: 'similar', l: 'similar', h: 'another like it' },
  { a: 'adjacent', l: 'adjacent', h: 'same jam' },
  { a: 'random', l: 'random', h: 'anything at all' },
  { a: 'duplicate', l: 'duplicate', h: 'one more row' }
]

/** Radio's role actions (spec 2026-10-03-radio-anointed-stems-design 5), offered after the four
 * above only while radio runs: the hook toggle (`release` on a row with a hook), and `back` on a
 * row whose hook is away. Dig joins with the desktop's dig (Task 14). */
const ROLE_ACTIONS = {
  hook: { a: 'hook', l: 'hook', h: 'leaves, comes back' },
  release: { a: 'hook', l: 'release', h: 'let the hook go' },
  back: { a: 'back', l: 'back', h: 'next phrase' }
}

/** Radio's turn chips (2026-10-02): `m` is the wire value (the planner's TurnaroundMove, which
 * POST /api/turn checks), `l` the chip's label -- the desktop's, from the same table. */
const TURN_CHIPS = TURNAROUND_MOVES.map((move) => ({ m: move, l: TURNAROUND_MOVE_LABEL[move] }))

/** The whole phone remote, as one string. NOT bundled by Vite and not part
 * of the renderer build: no asset-copying config, no hashed-filename lookup
 * from main, nothing that can work in `npm run dev` and be missing from a
 * packaged build. */
export const REMOTE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>sssketch · side quest</title>
<style>
@font-face {
  font-family: 'Silkscreen';
  src: url(data:font/woff2;base64,${SILKSCREEN_REGULAR_WOFF2_BASE64}) format('woff2');
  font-weight: 400;
  font-display: block;
}
/* touch-action: manipulation kills the double-tap-to-zoom gesture, which he
 * hit by accident tapping a chip twice. It is manipulation rather than none:
 * none would also kill scrolling, and it deliberately leaves pinch-to-zoom
 * alone, so the page can still be zoomed on purpose. The other way to stop
 * this is user-scalable=no in the viewport, which takes pinch away too and
 * which safari has ignored since ios 10 anyway. On * rather than on body
 * because touch-action is not inherited -- the gesture is resolved against
 * the element actually tapped, which is always a chip or a button.
 *
 * user-select: none went on the same rule on 2026-09-27: "pressing and
 * holding to keep i selected the text below on my iphone". A press held
 * over text is how ios raises its selection handles and its callout, and
 * keep is a 700ms press. The rows had carried their own copy of this since
 * their long press was built; keep never had one, so the 700ms press
 * selected straight through the transport and the foot. One rule on *
 * replaces both, which is also why .row no longer declares it -- and it
 * outlived the long press, because a thumb resting anywhere on this page
 * still must not raise a selection.
 *
 * It has to be css. The script is not allowed to contain preventDefault
 * (remotePage.test.ts asserts it), and a selectstart handler is the only
 * way to do this in js. -webkit-touch-callout rides along because it is the
 * same press raising the same menu. */
* { box-sizing: border-box; border-radius: 0; touch-action: manipulation; -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
body {
  margin: 0;
  padding: env(safe-area-inset-top, 0px) 16px env(safe-area-inset-bottom, 0px);
  background: #050505;
  color: #ededed;
  font-family: 'Silkscreen', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}
/* 100vh first as the fallback, then 100dvh: ios safari's collapsing
 * toolbar is precisely what dvh exists for, and a layout measured against
 * the tall viewport puts its last control under the chrome. The column
 * survives the stack moving to the top -- it is what keeps the near-black
 * ground covering the whole screen on a short loop. */
.wrap {
  max-width: 420px;
  margin: 0 auto;
  padding: 24px 0 16px;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
/* #app deliberately has NO rule of its own. It was a flex column only so
 * the rows' margin-top:auto had something to push against, and a second
 * rule existed only to stop that column squashing what it pushed; with the
 * stack starting at the top, plain block flow does both for free.
 *
 * If one is ever needed again, write it as #app:not([hidden]) and never as
 * a bare id: an id (1-0-0) beats [hidden]'s display:none (0-1-0), so a bare
 * #app display rule would show the whole app state to an unpaired phone. */
.eyebrow { font-size: 10px; color: #6a6a6a; letter-spacing: 0.08em; }
h1 { font-size: 15px; font-weight: 400; margin: 0 0 2px; }
.topbar { display: flex; justify-content: space-between; align-items: baseline; }
/* The stack starts under the status line and builds downward, so the first
 * stem is where the eye already is and each new one appears below the last
 * (Elling, on a real iphone: "the waves can appear starting at the top of
 * the screen and build from under"). Everything below it -- new stem, the
 * transport, the foot -- simply follows it down the page. */
.rows { position: relative; margin: 20px 0 10px; }
.foot { text-align: center; margin-top: 12px; }
.empty { margin: 20px 0; font-size: 11px; color: #8f8f8f; }
/* The playhead's lane: the box the waveform canvases occupy and not a pixel
 * more. It used to span the whole of .rows, so the line crossed the kind
 * label and the x as well -- "the playhead line doesnt follow where the
 * waveform would be... it should follow the waves only" (Elling, on the
 * phone).
 *
 * The two insets are the row grid read off exactly, not estimated. A .row
 * is 42px 42px 1fr 44px with a 10px column-gap, 10px of left padding and a
 * 1px border all round, and the waveform is the third column of the second
 * line, in a .stem with no horizontal padding at all, with the canvas at
 * width:100% inside it. So it starts at 1 + 10 + 42 + 10 + 42 + 10 = 115px
 * and ends 1 + 44 + 10 = 55px short of the right edge, and that IS where
 * the drawn waveform starts and stops. If any of those numbers changes,
 * these two must change with it.
 *
 * Keeping the lane as its own element is what lets tick() stay a plain
 * left = progress * 100 + '%': the percentage is of the lane, so there is
 * no calc() and no second copy of the arithmetic in the script.
 *
 * The line is absolutely positioned inside it and comes after the rows in
 * the DOM, so no z-index is needed, and pointer-events: none plus the total
 * absence of any listener are the two independent reasons it is an
 * indicator and not a seek. */
.lane {
  position: absolute;
  left: 115px;
  right: 55px;
  top: 0;
  bottom: 0;
  pointer-events: none;
}
.line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #c56164;
  pointer-events: none;
}
/* A ROW IS TWO LINES. "reduce or make two rows for where the name is
 * currently" -- Elling, on the phone, 2026-09-27, asking for s and m of
 * their own. A name, a waveform and four controls do not fit across 390px
 * of iphone, so the row splits into what the stem IS and what can be done
 * to it:
 *
 *   drums      kick-loose-07-with-a-long-tail
 *   s    m     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~        x
 *
 * The first line is identity and runs the whole width of the row -- the
 * name spans the x's column as well, which is 54px that used to be an
 * ellipsis on every long stem name. The second line is the controls, with
 * the waveform lying between the two that change the mix and the one that
 * takes the row away.
 *
 * The four columns are 42, 42, the waveform, 44. 42px is the tap target
 * every control on this page is held to (see button.chip) and the gaps are
 * the row's own 10px, so s and m are two full-size targets with a real
 * gutter between them rather than two halves of one 84px cell.
 *
 * WHY x IS AT THE OTHER END. It was sketched as a stack -- x on the first
 * line, s and m under it -- which puts m a thumb's width below the one
 * destructive control on the screen. x had no neighbours before tonight;
 * giving it two, at the corner a thumb reaches for first, would buy a tidy
 * corner with the occasional removed stem. So the mix controls take the
 * left end of the controls line, x keeps the right end it has always had,
 * and a whole waveform lies between them. */
.row {
  display: grid;
  grid-template-columns: 42px 42px 1fr 44px;
  grid-template-areas: "kind kind name name" "solo mute wave drop";
  grid-template-rows: 28px 42px;
  align-items: center;
  column-gap: 10px;
  min-height: 72px;
  margin-bottom: 6px;
  padding: 0 0 0 10px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
}
.row:active { background: #161616; }
/* A ROW RADIO IS ABOUT TO CHANGE. Direct report, 2026-09-29, listening on
 * radio: "i don't see any preparatory blinking on the channels about to
 * transition... it seems to make sense to have that in the ui... like,
 * 'this one is about to change and is getting ready to transition'."
 *
 * THE ROW BREATHES, and that is all. It was a 2px rule along the bottom
 * of the row for one day; Elling, on the mac's own copy of it: "i think
 * the fade in and out indication is clear enough that 'something is going
 * to happen on this one soon'" and "can't it be the red playhead
 * indicator instead of a progress bar? that would streamline the ui".
 * This page has had a red playhead sweeping every row since 2026-09-26
 * (.lane / .line below) and a change lands at the loop top, so the line
 * reaching the end of the lane IS the moment -- the rule was drawing a
 * second time something already on screen.
 *
 * Same two depths as the mac, so the desk and the sofa say it the same
 * way. NOT the same pace any more: on 2026-09-30 the mac's breath moved
 * off a 2600ms timer onto the transport -- one breath every 4 bars, every
 * row in step (DiscoverPanel, @shared/discoverBreath). This page still
 * runs the old 2600ms timer below; bringing it onto the phone's own lap
 * clock is a separate change. Luminance only: there is no colour to spend on
 * chrome here either, and the one lit treatment in a typeface with no
 * bold belongs to button.lit.
 *
 * THE ONE EXCEPTION to "the playhead is the only motion here", and it is
 * allowed for the reason a blink was not: eased both ways over 2600ms,
 * unrelated to the tempo and never restarted at the wrap, it has no edge
 * to read a beat off and cannot be mistaken for something counting.
 *
 * One knock-on, small and accepted: an animation outranks a normal
 * declaration, so a breathing row does not flash .row:active under a
 * thumb. The tap it answers opens the action sheet, which is its own
 * acknowledgement.
 *
 * NOT A CLASS ON .row, still. paintGoingRow is the one and only thing
 * that writes a row's className -- that is how a rebuild under a pending
 * removal comes up already marked -- so paintAhead writes the row's own
 * animation style and nothing else, and the two painters cannot overwrite
 * each other. */
@keyframes ahead { 0%, 100% { background: #0a0a0a; } 50% { background: #161616; } }
@keyframes ahead-now { 0%, 100% { background: #161616; } 50% { background: #222222; } }
.row .kind { grid-area: kind; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* min-width: 0 is not decoration: a canvas carries an intrinsic width, and
 * without it the 1fr column would be sized to that rather than to what is
 * left of the row. */
.row .stem { grid-area: wave; min-width: 0; }
.row .name .role { color: #8a8a8a; }
.row .name {
  grid-area: name;
  /* The row has no right padding of its own -- x is flush with the border
   * -- so the name, which now runs past where x sits, carries the gutter
   * itself. */
  padding-right: 10px;
  display: block;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 24px rather than 18px: the waveform has a line to itself now, and the
 * shape is the one thing on this row that is worth reading from across a
 * table. */
.row canvas { display: block; width: 100%; height: 24px; }
/* s AND m. "buttosn for s and m instead" -- Elling, on the phone,
 * 2026-09-27, after a session with the tap cycle that hid them. One
 * character each: that is what solo and mute are called on every daw on
 * his machine, and the page's two-word rule is about not writing
 * sentences.
 *
 * Exactly button.chip's treatment at exactly its 42px, because this page
 * already has a way to draw a toggle and does not need a second one: a
 * grey letter in a box the colour of the row's own border when it is off,
 * and an inversion when it is on. Inversion is the page's whole vocabulary
 * for "engaged" -- .drop.armed and both sets of chips are the same white
 * block -- and it is the only one available, since nothing on this page
 * may fade and there is no colour to spend on chrome.
 *
 * An s lit on a soloed row is the BUTTON saying what it is, which a toggle
 * has to. It is not a second mark on the row: the row still says solo the
 * one way it ever has, by every other row losing its colour.
 *
 * A row whose stem has not resolved yet has nothing to mute or solo -- the
 * desktop row's own hasStemToActOn guard -- so both letters step down to
 * #3a3a3a and the buttons are disabled. Down to the dimmest ink on the
 * page, never faded. */
button.key {
  width: 42px;
  height: 42px;
  padding: 0;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #8f8f8f;
  font: inherit;
  font-size: 11px;
}
button.key.solo { grid-area: solo; }
button.key.mute { grid-area: mute; }
button.key:active { background: #161616; }
button.key.on { background: #ededed; border-color: #ededed; color: #050505; }
button.key:disabled { color: #3a3a3a; }
/* 44px wide and the full height of the controls line, so it keeps its own
 * tap target. A border-left rather than a box, so the row still reads as
 * one thing -- and that rule is now the only thing between the waveform
 * and the one control that removes a stem. */
button.drop {
  grid-area: drop;
  width: 44px;
  height: 42px;
  padding: 0;
  background: transparent;
  border: none;
  border-left: 1px solid #222222;
  color: #6a6a6a;
  font: inherit;
  font-size: 10px;
}
button.drop:active { background: #161616; }
button.drop.armed { background: #ededed; color: #050505; }
/* A ROW ON ITS WAY OUT. Between the confirming tap and the row actually
 * going there was no sign at all, which is indistinguishable from a tap
 * that missed -- so the instinct was to tap again.
 *
 * What it could NOT be, and why this is what it is. Nothing on this page
 * fades, so the whole family of dimmed treatments is out. There is no
 * colour to spend on chrome. #6a6a6a is the muted treatment, and a row on
 * its way out is still IN the loop that is playing -- it has not stopped
 * making a sound and must not look as though it has. And inversion already
 * means armed, which is a question ("sure"); letting it also mean a
 * statement you are being told would put two opposite affordances in one
 * white block, at the exact moment the right thing to do is stop tapping.
 *
 * So: a word, in the one cell whose job is removal, at full text strength
 * rather than the x's quiet grey -- the message lands where the thumb just
 * was. The row keeps every bit of its colour and takes one step of border,
 * #222222 to #3a3a3a, which is the same border the transport already
 * wears. :active is pinned back to the resting background because the row
 * answers nothing now, and a press that lights up would say otherwise. */
.row.going { border-color: #3a3a3a; }
.row.going:active { background: #0a0a0a; }
button.drop.going { color: #ededed; }
button.drop.going:active { background: transparent; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
button.big {
  flex: 1;
  height: 52px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid #3a3a3a;
  color: #ededed;
  font: inherit;
  font-size: 12px;
}
button.big:active { background: #161616; }
button.big.on { background: #ededed; color: #050505; }
button.big.dim { border-color: #222222; color: #5a5a5a; }
/* Keep while the Mac plays another user's stems, listen only. */
button.big:disabled { border-color: #222222; color: #5a5a5a; }
/* One sheet treatment, used by both sheets, so "something came up from the
 * bottom" means one thing. */
.sheet-bg {
  position: fixed;
  inset: 0;
  background: rgba(5,5,5,0.72);
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  background: #0a0a0a;
  border-top: 1px solid #3a3a3a;
}
.sheet .eyebrow { margin-top: 10px; }
.sheet .eyebrow:first-child { margin-top: 0; }
/* The one lit control on the page. In a typeface with no bold, an #ededed
 * border IS the hierarchy -- so nothing else may take one. */
button.lit {
  width: 100%;
  height: 120px;
  background: transparent;
  border: 1px solid #ededed;
  color: #ededed;
  font: inherit;
  font-size: 13px;
}
button.lit:active { background: #ededed; color: #050505; }
.act-name { font-size: 12px; color: #ededed; margin: 2px 0 10px; }
.acts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
button.act {
  min-height: 64px;
  padding: 8px 6px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
  font: inherit;
  font-size: 11px;
  text-align: left;
}
button.act:active { background: #161616; }
button.act .h { display: block; margin-top: 4px; font-size: 9px; color: #6a6a6a; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0 0; }
.chips.trait { margin-bottom: 8px; }
/* The handover grid, under the transport. Four chips across in ONE row
 * rather than the kind picker's wrapping 92px minimum -- these labels are
 * four characters and a second row of them here would push the foot off a
 * short screen. button.chip's own min-height still holds the tap target at
 * 42px, which is the number that actually matters to a thumb. */
.swapgrid { margin-top: 12px; }
.chips.grid button.chip { flex: 1 1 0; min-width: 0; }
/* Smaller type and tighter padding, but min-height holds the TAP target at
 * 42px whatever the type does. A chip that looks small is fine; a chip a
 * thumb misses is a bug. */
button.chip {
  flex: 1 1 30%;
  min-width: 92px;
  min-height: 42px;
  padding: 10px 4px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #8f8f8f;
  font: inherit;
  font-size: 10px;
}
button.chip:active { background: #161616; }
button.chip.on { background: #ededed; border-color: #ededed; color: #050505; }
/* A turn chip that cannot sound right now: still a target, quieter. */
button.chip.dim { border-color: #161616; color: #3a3a3a; }
input {
  width: 100%;
  padding: 16px 10px;
  background: #0a0a0a;
  border: 1px solid #3a3a3a;
  color: #ededed;
  font: inherit;
  font-size: 22px;
  letter-spacing: 0.3em;
  text-align: center;
  text-transform: uppercase;
  /* THE exception to the page-wide user-select: none above, and not an
   * optional one: this is the pair screen's four-character code field, and
   * user-select: none on an input takes the ios caret handles and the edit
   * menu with it -- paste, in particular, which is how a code copied off
   * the mac gets in. -webkit-touch-callout is reset for the same reason: it
   * is what raises that menu. */
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: default;
}
.msg { font-size: 11px; color: #8f8f8f; min-height: 18px; margin-top: 10px; }
[hidden] { display: none; }
</style>
</head>
<body>
<div class="wrap">

  <div id="pair">
    <div class="eyebrow">sssketch</div>
    <h1>side quest</h1>
    <div class="msg">scan the qr code on the mac, or type the code under it</div>
    <input id="code" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="4">
    <div class="actions" style="margin-top:10px">
      <button class="big" id="pair-go">pair</button>
    </div>
    <div class="msg" id="pair-msg"></div>
  </div>

  <div id="app" hidden>
    <!-- Two grey lines, not four. The counters ride the eyebrow row, and
         the status line below it carries a transient message for two
         seconds and then rests on the last kept rifff. -->
    <div class="topbar">
      <span class="eyebrow">sssketch</span>
      <span class="eyebrow" id="counts">kept 0 · rolled 0</span>
    </div>
    <div class="msg" id="msg"></div>
    <!-- Zero slots is a START, not an error. It says what to do next and
         the thing to do it with is directly below it. -->
    <div class="empty" id="empty" hidden>pick what you want below, then add it</div>
    <div class="rows" id="rows"><div class="lane" id="lane"><div class="line" id="line" hidden></div></div></div>
    <!-- The one #ededed-bordered control on the page, and never hidden:
         with nothing on screen it is the only thing there is to do. -->
    <button class="lit" id="new-stem">new stem</button>
    <!-- Hidden with nothing in discover: roll all, play and keep all act on
         a loop that does not exist yet, and three dead buttons are what made
         the first screen feel like a dead end. They come back on the first
         add. -->
    <div id="loop" hidden>
      <div class="actions">
        <button class="big" id="play">play</button>
        <button class="big" id="keep">keep</button>
        <button class="big" id="roll-all">roll all</button>
      </div>
      <!-- Where a new mix is allowed to take over. UNDER the transport, not
           over it: the three big buttons keep the position the thumb already
           knows, nothing above this moves when it appears, and a chip row of
           10px type is plainly subordinate to three 52px buttons rather than
           reading as a fourth one. It is a preference set once and then left
           alone, so it does not want the best thumb space on the page -- and
           it lives inside #loop so it comes and goes with the loop it
           describes: an empty discover has no handover to place. -->
      <!-- Radio's turn (2026-10-02): a turnaround at the next loop top. Shown
           only while radio runs on the mac (state.turn). The big button lets
           the mac choose; a chip plays its move. -->
      <div class="swapgrid" id="turn-box" hidden>
        <div class="actions">
          <button class="big" id="turn">turn</button>
        </div>
        <div class="chips grid" id="chips-turn"></div>
      </div>
      <div class="swapgrid">
        <div class="eyebrow">swap every</div>
        <div class="chips grid" id="chips-grid"></div>
      </div>
      <!-- And how the change takes when it gets there. A second row in the
           same idiom directly under the first, because the two are one
           question asked twice: when, and how. -->
      <div class="swapgrid">
        <div class="eyebrow">and take</div>
        <div class="chips grid" id="chips-xfade"></div>
      </div>
      <!-- Radio fold mode's switch (2026-10-02): the one radio setting the phone has, shown only
           while radio runs on the mac. -->
      <div class="swapgrid" id="fold-row" hidden>
        <div class="eyebrow">fold</div>
        <div class="chips grid" id="chips-fold"></div>
      </div>
    </div>
    <div class="eyebrow foot" id="mac"></div>

    <!-- The chooser stops living in the page: a sheet is its own collapse,
         and "new stem" above is the one thing you can do with an empty
         screen. -->
    <div id="kind-sheet" hidden>
      <div class="sheet-bg" id="kind-sheet-bg"></div>
      <div class="sheet">
        <div class="eyebrow">what kind</div>
        <div class="chips" id="chips-mask"></div>
        <div class="eyebrow">what it feels like</div>
        <div class="chips trait" id="chips-trait"></div>
        <div class="actions">
          <button class="big dim" id="kind-cancel">never mind</button>
          <button class="big dim" id="add-slot">add slot</button>
        </div>
      </div>
    </div>

    <!-- The hold menu. Same sheet treatment as the chooser, so "something
         came up from the bottom" means one thing. -->
    <div id="act-sheet" hidden>
      <div class="sheet-bg" id="act-sheet-bg"></div>
      <div class="sheet">
        <div class="eyebrow" id="act-kind"></div>
        <div class="act-name" id="act-name"></div>
        <div class="acts" id="acts"></div>
        <div class="actions">
          <button class="big dim" id="act-cancel">never mind</button>
        </div>
      </div>
    </div>
  </div>

  <!-- The last resort, and the only thing on this page that is about this
       page rather than about Discover. Unhidden by a window error listener
       (see the top of the script) so a script that throws leaves a line to
       read instead of a phone-sized void. -->
  <div class="msg" id="broke" hidden>something went wrong on this page. reload it.</div>

</div>
<script>
(function () {
  // FIRST, before anything that could throw. This does NOT catch the error:
  // it is a listener, the throw still happens and still reaches the
  // console, and a page that needs this line is still a bug. It only makes
  // that bug visible on a device with no console -- a blank phone is the
  // one failure that cannot be reported at all.
  window.addEventListener('error', function () {
    var broke = document.getElementById('broke')
    if (broke) broke.hidden = false
  })

  var TYPE_COLORS = ${JSON.stringify(TYPE_COLORS)}
  // The seven chips and, below them, what tapping each one does to a
  // selection. KIND_TOGGLE is not a reimplementation of the combination
  // rules -- it is toggleSlotKind (@shared/discoverSlotKind) called for
  // every selection and every chip at build time, indexed
  // [selection][chip]. Mask kinds OR together, trait kinds rank, and
  // bright/warm cannot both be on, here for the same reason and by the
  // same code as on the mac.
  var KINDS = ${JSON.stringify(KIND_CHIPS)}
  var KIND_TOGGLE = ${JSON.stringify(buildSlotKindToggleTable())}
  var token = null
  try { token = localStorage.getItem('sssketch-remote-token') } catch (e) { token = null }

  // WHEN THIS STEM IS ALLOWED TO CHANGE, as a number of bars -- 0 meaning
  // the end of the loop, which is what this page did before the grid
  // existed and is still the default.
  //
  // "instead of it playing only at the end of the loop, could we set it to
  // update every 4 bars, 8 bars, etc? a switch and setting to do that? so
  // it's seamless but can update a bit sooner" -- Elling, 2026-09-27, after
  // hearing the end-of-loop handover. It read "when does the whole mix
  // swap" then; per stem it reads "when can THIS stem change". The chips
  // say the same words, and re-labelling shipped copy for its own sake is
  // churn.
  //
  // FIVE OPTIONS NOW. own loop is what per-stem replacement made
  // possible: the most musical boundary for a stem changing under eleven
  // others is its own cycle. The default stays 0 -- his phone already has a
  // value stored under SWAP_GRID_KEY and a default that changed under him
  // would be a surprise -- but this is the one to try first.
  var SWAP_GRIDS = [
    { g: -1, l: 'own loop' },
    { g: 0, l: 'loop end' },
    { g: 8, l: '8 bars' },
    { g: 4, l: '4 bars' },
    { g: 2, l: '2 bars' }
  ]
  var SWAP_GRID_KEY = 'sssketch-remote-swap-grid'

  // HOW A HANDOVER TAKES, in bars. Bar-relative and not fixed seconds, so
  // the control means the same thing at 90 and at 160 -- and seconds per
  // bar is already derived from the buffers (see swapPeriod), so no new
  // number goes on the wire for it.
  //
  // A crossfade between two whole mixes was a strange object: the same
  // eleven stems fading out of themselves and back in, three decibels down
  // in the middle for nothing. Between ONE outgoing stem and ONE incoming
  // stem, under eleven that never move, it is an ordinary musical control.
  // That is why it waited for per-stem.
  var XFADES = [
    { x: 0, l: 'cut' },
    { x: 0.125, l: 'short' },
    { x: 0.5, l: 'long' }
  ]
  var XFADE_KEY = 'sssketch-remote-xfade'

  // THE SETTING LIVES ON THE PHONE. It is a preference about how a handover
  // should feel in this room on this device, not a fact about the project:
  // it needs no route of its own, it cannot drift out of step with the mac
  // because the mac never hears about it, and it survives a reload.
  //
  // Both storage calls are guarded and both failures land in the same place.
  // Private browsing throws outright, blocked site data throws on the read,
  // and a first visit simply has nothing there -- all three leave swapGrid
  // at 0, which is the behaviour that shipped before this existed. A phone
  // remote that showed a blank screen because site data is off would be a
  // bad trade for a preference. The saved value is matched against the
  // options rather than parsed, so nothing but one of these four can ever
  // come back out.
  var swapGrid = 0
  try {
    var savedGrid = localStorage.getItem(SWAP_GRID_KEY)
    for (var gi = 0; gi < SWAP_GRIDS.length; gi++) {
      if (savedGrid === String(SWAP_GRIDS[gi].g)) swapGrid = SWAP_GRIDS[gi].g
    }
  } catch (e) { swapGrid = 0 }

  // Same shape, same guards, same reason as the grid above, and the same
  // default-is-what-shipped rule: cut is today's behaviour, so nobody's
  // phone changes until they touch a chip.
  var xfade = 0
  try {
    var savedX = localStorage.getItem(XFADE_KEY)
    for (var xi = 0; xi < XFADES.length; xi++) {
      if (String(XFADES[xi].x) === savedX) xfade = XFADES[xi].x
    }
  } catch (e) { xfade = 0 }

  var pairEl = document.getElementById('pair')
  var appEl = document.getElementById('app')
  var rowsEl = document.getElementById('rows')
  var emptyEl = document.getElementById('empty')
  var loopEl = document.getElementById('loop')
  var maskChipsEl = document.getElementById('chips-mask')
  var traitChipsEl = document.getElementById('chips-trait')
  var addEl = document.getElementById('add-slot')
  var kindSheetEl = document.getElementById('kind-sheet')
  var countsEl = document.getElementById('counts')
  var msgEl = document.getElementById('msg')
  var pairMsgEl = document.getElementById('pair-msg')
  var playEl = document.getElementById('play')
  var laneEl = document.getElementById('lane')
  var lineEl = document.getElementById('line')
  var macEl = document.getElementById('mac')

  // The phone plays the loop ITSELF. The Mac is not touched in either
  // direction -- "phone audio distinct from the app", Elling, 2026-09-26 --
  // so both playing at once is intended, not a bug. macEl says so when it
  // happens.
  // THE PHONE IS THE MIXER, since 2026-09-27. One AudioBufferSourceNode per
  // stem, each through its own GainNode, all measured from ONE instant on
  // the audio clock. Mute and solo are a gain change on a buffer the phone
  // already holds -- no render, no fetch -- and rolling one slot costs one
  // stem instead of a whole re-rendered mixdown.
  var audioCtx = null
  // THE ONE INSTANT EVERY VOICE IS MEASURED FROM. Set once, when playback
  // starts, and never written again. That is the whole simplification.
  //
  // The single-buffer player moved its start time on every handover, because
  // the incoming mix began at its own bar 0 and there was no phrase in it to
  // match the outgoing loop to. Per stem there is: when one voice of twelve
  // is replaced, eleven are still mid-phrase, so the new one enters at the
  // phrase position everything else is already at (see offsetAt). One clock,
  // one fixed instant, nothing writing to it after the first start -- which
  // is also why ios suspending the tab cannot desync the stems from each
  // other. They all come back in the phase they left.
  var origin = 0
  var haveOrigin = false
  var wantPlaying = false
  // slotId -> { stemId, src, gain, dur, level }. What is SOUNDING.
  var voices = {}
  // stemId -> AudioBuffer. Survives a stem leaving the mix, because rolling
  // back to it must not cost another download.
  var buffers = {}
  // stemId -> true while its fetch is in flight.
  var fetchingIds = {}
  // stemId -> how many times fetching or decoding it has failed. Three
  // strikes and it is left alone until the id changes. Deliberately NOT the
  // analysis caches' "evict on rejection so a transient failure cannot
  // poison it" rule: that is for a cache asked again on the next mount, and
  // this is a poll running every 700ms, where an uncounted retry is an
  // infinite download.
  var failedIds = {}
  // slotId -> the last stemId the mac named for that row. NOT cleared when
  // the mac stops naming one: a muted slot is not in discover's preview
  // project at all, so its stemId goes null, and null means "the mac is not
  // naming one right now", never "throw the audio away".
  var wantedStemId = {}
  // How many bars the mac says the current set is. 0 means not known, which
  // swapPeriod reads as "the end of the loop" and never as a bad grid.
  var loopBars = 0

  // How far ahead of the audio clock a start or a handover has to be to be
  // scheduled at all.
  //
  // start(t) and stop(t) with a t that has already passed -- or that falls
  // inside the block the audio thread is rendering right now -- are clamped
  // to "as soon as possible", which is exactly the mid-bar cut this whole
  // mechanism exists to avoid. A render quantum is 128 frames (under 3ms),
  // but the audio thread runs a hardware buffer ahead of the main thread
  // (256 to 1024 frames on ios, so 5 to 21ms), and the main thread doing
  // this arithmetic can lose a frame or two to layout or gc on top of that.
  // 80ms clears all of it with room over, and is short against a bar at any
  // tempo -- so "wait for the boundary after this one" stays the rare case
  // rather than the normal one.
  var START_LEAD = 0.08
  var SWAP_LEAD = 0.08
  var MAX_STEM_TRIES = 3

  function setPlayLabel() {
    playEl.textContent = wantPlaying ? 'stop' : 'play'
    playEl.className = wantPlaying ? 'big on' : 'big'
  }

  // THE PHRASE LENGTH, in seconds. The longest voice spans the whole loop
  // by definition -- loopBars IS the longest resolved stem's bar length --
  // so this is the loop, derived from the buffers rather than from a tempo
  // on the wire. A tempo on the wire would be a second copy of the same
  // fact, free to disagree with it.
  function loopDur() {
    var best = 0
    for (var id in voices) {
      if (voices[id].dur > best) best = voices[id].dur
    }
    return best
  }

  // Where in its own cycle a stem of length dur is at time at. This one
  // line is what makes a replacement musical rather than merely
  // sample-accurate: the new stem does not start at its own bar 0, it
  // starts where the phrase already is. A daw does exactly this; the
  // whole-mix handover could not, because there was no phrase to be in.
  function offsetAt(at, dur) {
    var o = (at - origin) % dur
    if (o < 0) o = o + dur
    return o
  }

  function makeVoice(stemId, buf, at, level) {
    var g = audioCtx.createGain()
    // Set NOW, not at the boundary. setValueCurveAtTime refuses to run if
    // any other automation event falls inside the curve's own window, and
    // the crossfade's curve starts at exactly the boundary -- so an event
    // there would make every handover throw. Nothing is sounding through
    // this node until the source starts, so setting its baseline early is
    // free.
    g.gain.setValueAtTime(level, audioCtx.currentTime)
    g.connect(audioCtx.destination)
    var src = audioCtx.createBufferSource()
    src.buffer = buf
    // An AudioBufferSourceNode loops sample-accurately, inside the audio
    // graph. An <audio loop> element puts an audible gap at the loop point
    // in Safari, which would land on every downbeat of the exact judgement
    // this page exists to make.
    //
    // loopEnd is the buffer's whole duration because the mac trimmed it to
    // exactly the stem's own durationSec before encoding -- so the loop
    // point is where the engine would put it, with no number on the wire.
    // A 2-bar hat under an 8-bar pad therefore wraps four times a phrase,
    // in phase, with no arithmetic anywhere: the same tiling tileOffsetsPx
    // draws and PlaybackEngine::renderBlock walks, computed here by the
    // audio thread.
    src.loop = true
    src.loopStart = 0
    src.loopEnd = buf.duration
    src.connect(g)
    src.start(at, offsetAt(at, buf.duration))
    return { stemId: stemId, src: src, gain: g, dur: buf.duration, level: level }
  }

  // slotId -> { stemId, src, gain, dur, level, at }. A REPLACEMENT ALREADY
  // SCHEDULED: its source has start(at) called with at still in the future,
  // and the voice it replaces has stop(at) called on the same instant. Empty
  // the rest of the time.
  var pending = {}

  // Drops a replacement that was scheduled and then superseded or
  // abandoned. Its source has start(at) called with at still ahead, so
  // stop() with no argument means "never sound at all"; it is disconnected
  // either way, so nothing is left hanging off the destination.
  function cancelPending(slotId) {
    var p = pending[slotId]
    if (!p) return
    try { p.src.stop() } catch (e) {}
    try { p.src.disconnect() } catch (e) {}
    try { p.gain.disconnect() } catch (e) {}
    delete pending[slotId]
  }

  function killVoice(v) {
    if (!v) return
    v.src.onended = null
    try { v.src.stop() } catch (e) {}
    try { v.src.disconnect() } catch (e) {}
    try { v.gain.disconnect() } catch (e) {}
  }

  function stopAll() {
    for (var pid in pending) cancelPending(pid)
    for (var id in voices) killVoice(voices[id])
    voices = {}
    haveOrigin = false
    lineEl.hidden = true
  }

  // What this row's voice should be sounding at: 1, or 0 for a muted row.
  // Read off what is DRAWN, because that is what he is looking at while he
  // decides.
  function levelFor(slotId) {
    for (var i = 0; i < lastSlots.length; i++) {
      if (lastSlots[i].id === slotId) return lastSlots[i].muted ? 0 : 1
    }
    return 1
  }

  // 15ms. "INSTANT" CANNOT BE ZERO: a gain step on a sounding source is a
  // discontinuity, which is an audible pop -- the engine carries FadeGain's
  // ~3ms micro-fade for the same reason. 15ms is inaudible as a fade and is
  // the difference between a mute and a click. It is not a compromise on
  // "lets make mute and solo happen immediately" (Elling, 2026-09-27); it
  // is what immediately has to mean.
  var MUTE_RAMP = 0.015

  function setLevel(v, level) {
    if (!v || !audioCtx) return
    var now = audioCtx.currentTime
    // cancelScheduledValues first: a crossfade curve may still be running
    // on this param, and a mute you asked for has to win.
    v.gain.gain.cancelScheduledValues(now)
    v.gain.gain.setValueAtTime(v.gain.gain.value, now)
    v.gain.gain.linearRampToValueAtTime(level, now + MUTE_RAMP)
    v.level = level
  }

  // THE MIX, APPLIED TO WHAT IS SOUNDING. No render, no fetch, no round
  // trip to the mac -- this IS the feature. A muted voice is not stopped
  // and its buffer is not dropped, so unmuting is another 15ms ramp and the
  // stem comes back IN PHASE, because it never left the clock.
  //
  // Only a level that actually changed is written. A poll runs every 700ms
  // and a handover's fade can be scheduled seconds ahead of its boundary;
  // re-asserting a level nothing asked to change would cancel that curve
  // four times before it ever ran.
  function applyMix() {
    if (!audioCtx) return
    for (var slotId in voices) {
      var want = levelFor(slotId)
      if (voices[slotId].level !== want) setLevel(voices[slotId], want)
    }
  }

  // HOW OFTEN THE PLAYING LOOP OFFERS A HANDOVER, in seconds.
  //
  // Seconds per bar is the buffer's OWN duration divided by the bar count
  // the mac counted for it. Derived from the buffer rather than from a
  // tempo on purpose: the buffer is the ground truth for what is sounding,
  // and a tempo on the wire would be a second copy of the same fact, free
  // to disagree with it.
  //
  // TWO EDGES, both settled here rather than left to the arithmetic:
  //
  // A GRID LONGER THAN THE LOOP -- every 8 bars over a 4-bar loop. Taken
  // literally that means waiting two whole cycles for a handover, which is
  // worse than the default this setting is supposed to improve on. The grid
  // is capped at the loop, so the longest wait it can ever produce is the
  // wait it started with.
  //
  // A GRID THAT DOES NOT DIVIDE THE LOOP -- every 4 bars of a 6-bar loop.
  // Taken literally the boundaries land at bar 4, then bar 2 of the next
  // cycle, then bar 0, drifting across the phrase and never repeating; two
  // handovers in a row would be different musical events, and the second
  // one would arrive in the middle of a bar the ear is counting as a
  // pickup. So the grid steps DOWN to the largest number of bars that
  // divides the loop evenly: 4 over a 6-bar loop becomes 3, 8 over a 12-bar
  // loop becomes 6, 4 over an 8-bar loop stays 4. Every boundary is then
  // the same place in the loop on every cycle and the downbeats stay where
  // they were. It can never step below 1, which divides everything.
  //
  // Anything the mac has not given a whole positive bar count for falls
  // back to the whole loop -- the behaviour with no grid at all.
  function swapPeriod() {
    var dur = loopDur()
    if (!(dur > 0)) return 0
    if (swapGrid === 0) return dur
    var bars = loopBars
    if (!(bars > 0) || bars !== Math.floor(bars)) return dur
    var step = swapGrid
    if (step > bars) step = bars
    while (step > 1 && bars % step !== 0) step = step - 1
    return (dur * step) / bars
  }

  // HOW OFTEN THIS VOICE OFFERS A HANDOVER. Global for every setting but
  // one: own loop is the stem's OWN cycle, which is the boundary per-stem
  // replacement finally makes available. Without it a 2-bar hat rolled at
  // bar one of an 8-bar loop waits four times longer than it needs to.
  function periodFor(v) {
    if (swapGrid === -1) return v.dur > 0 ? v.dur : loopDur()
    return swapPeriod()
  }

  // How long a handover takes, in seconds. cut is 5ms -- NOT zero: a hard
  // gain step on a sounding source pops, the same reason MUTE_RAMP exists.
  function xfadeSec() {
    if (xfade === 0) return 0.005
    var dur = loopDur()
    var bars = loopBars
    if (!(dur > 0) || !(bars > 0)) return 0.005
    return xfade * (dur / bars)
  }

  // EQUAL POWER, not linear. Two uncorrelated stems crossfaded on straight
  // lines dip about 3dB in the middle -- inaudible at cut, obvious at long.
  // setValueCurveAtTime takes an arbitrary shape, so the fade is the same
  // sqrt curve every other blend in this codebase uses (LoopSewing.cpp,
  // LoopBoundaryFade.cpp). Built once.
  var XFADE_POINTS = 64
  var FADE_IN = new Float32Array(XFADE_POINTS)
  var FADE_OUT = new Float32Array(XFADE_POINTS)
  for (var fi = 0; fi < XFADE_POINTS; fi++) {
    var ft = fi / (XFADE_POINTS - 1)
    FADE_IN[fi] = Math.sqrt(ft)
    FADE_OUT[fi] = Math.sqrt(1 - ft)
  }

  function scaledCurve(shape, level) {
    var out = new Float32Array(XFADE_POINTS)
    for (var i = 0; i < XFADE_POINTS; i++) out[i] = shape[i] * level
    return out
  }

  // ONE ROW CHANGES, on a boundary, and the other eleven are not touched.
  // Both ends are committed on the audio clock against the one instant
  // every voice shares, which is what makes this sample-accurate rather
  // than "soon after this callback ran".
  function scheduleReplace(slotId, stemId, buf) {
    var v = voices[slotId]
    if (!v) return
    var period = periodFor(v)
    if (!(period > 0)) return
    var now = audioCtx.currentTime
    var at = origin + Math.ceil((now - origin) / period) * period
    // Too close to schedule honestly -- start(t) and stop(t) with a t
    // inside the block the audio thread is rendering are clamped to "as
    // soon as possible", which is the mid-bar cut this exists to avoid.
    // Take the next boundary instead; one more cycle of the old stem is the
    // price, and nobody can hear a change that did not happen yet.
    if (at - now < SWAP_LEAD) at = at + period
    var p = pending[slotId]
    if (p) {
      // A THIRD stem for this row arriving before the second has started.
      // Replacing it is clean only at the same instant, because the playing
      // voice's stop is already scheduled for p.at and re-scheduling a stop
      // that is about to fire has no honest answer. The boundary can only
      // have moved if we are inside SWAP_LEAD, so this one is dropped;
      // wantedStemId is unchanged, so the next reconcile asks again.
      if (p.at !== at) return
      cancelPending(slotId)
    }
    var fade = xfadeSec()
    var level = levelFor(slotId)
    var next = makeVoice(stemId, buf, at, 0)
    next.gain.gain.setValueCurveAtTime(scaledCurve(FADE_IN, level), at, fade)
    v.gain.gain.cancelScheduledValues(at)
    v.gain.gain.setValueCurveAtTime(scaledCurve(FADE_OUT, v.gain.gain.value), at, fade)
    // The OLD source runs until the fade is over, not until the boundary --
    // otherwise there is nothing left to fade out.
    v.src.stop(at + fade)
    // The old source ending IS the boundary, reported by the audio system
    // rather than guessed at by a second clock that could drift from it.
    v.src.onended = function () { commitReplace(slotId, at) }
    pending[slotId] = {
      stemId: next.stemId,
      src: next.src,
      gain: next.gain,
      dur: next.dur,
      level: next.level,
      at: at
    }
  }

  // The handover as the rest of the page sees it, a few milliseconds after
  // it already happened in the audio graph. ONE row moves; the phrase does
  // not restart, so the playhead does not jump.
  function commitReplace(slotId, at) {
    var p = pending[slotId]
    if (!p || p.at !== at) return
    delete pending[slotId]
    var old = voices[slotId]
    if (old) {
      old.src.onended = null
      try { old.src.disconnect() } catch (e) {}
      try { old.gain.disconnect() } catch (e) {}
    }
    voices[slotId] = { stemId: p.stemId, src: p.src, gain: p.gain, dur: p.dur, level: p.level }
    // Whatever the mix asked for while this was in flight wins now that the
    // curve scheduled at the boundary has run -- and a later mute is then
    // not fighting a finished curve.
    setLevel(voices[slotId], levelFor(slotId))
    // THE ROW MOVES HERE, with the sound, rather than up to a poll later:
    // this row is no longer mid-change, so the merge stops holding it.
    lastSlots = mergePolledSlots(polledSlots)
    renderRows()
  }

  // EVERYTHING THE MIXER DOES, in one function, called from the poll and
  // from every landed fetch. It compares what the mac is naming against
  // what is sounding and closes the gap; it is safe to call at any time and
  // does nothing when nothing has changed.
  function reconcile() {
    if (!audioCtx || !wantPlaying) return
    var slotId

    // Rows that are gone take their voice, and anything scheduled for
    // them, with them. A scheduled replacement is part of what is playing:
    // left alone it would start into a row that no longer exists and
    // commit itself through onended.
    for (slotId in voices) {
      if (!wantedStemId[slotId]) {
        cancelPending(slotId)
        killVoice(voices[slotId])
        delete voices[slotId]
      }
    }

    // Everything went away -- discover emptied, or every row was replaced
    // at once. There is nothing left to be in phase WITH, so the next
    // buffer to land starts a fresh phrase rather than waiting for a
    // boundary of a loop whose length is now zero.
    if (haveOrigin) {
      var sounding = false
      for (slotId in voices) sounding = true
      if (!sounding) { haveOrigin = false; lineEl.hidden = true }
    }

    if (!haveOrigin) {
      // Nothing is sounding yet. Start every voice we can, together, at one
      // instant a little way ahead of the clock so nothing is clamped to
      // "as soon as possible".
      var ready = 0
      for (slotId in wantedStemId) {
        if (buffers[wantedStemId[slotId]]) ready = ready + 1
      }
      if (ready === 0) { fetchMissing(); return }
      origin = audioCtx.currentTime + START_LEAD
      haveOrigin = true
      for (slotId in wantedStemId) {
        var first = buffers[wantedStemId[slotId]]
        if (first) {
          voices[slotId] = makeVoice(wantedStemId[slotId], first, origin, levelFor(slotId))
        }
      }
      lineEl.hidden = false
      fetchMissing()
      return
    }

    // Something is sounding. Bring every other voice up to what the mac
    // names, ONE ROW AT A TIME -- eleven rows that did not change are not
    // touched, and that is the entire point of this feature.
    for (slotId in wantedStemId) {
      var want = wantedStemId[slotId]
      var buf = buffers[want]
      if (!buf) continue
      var v = voices[slotId]
      if (!v) {
        // A row that joined mid-phrase -- a new slot, or a fetch that took
        // its time. It enters on a boundary too, at the phrase's phase.
        var period = swapPeriod()
        if (!(period > 0)) continue
        var now = audioCtx.currentTime
        var at = origin + Math.ceil((now - origin) / period) * period
        if (at - now < SWAP_LEAD) at = at + period
        voices[slotId] = makeVoice(want, buf, at, levelFor(slotId))
        continue
      }
      if (v.stemId === want) continue
      if (pending[slotId] && pending[slotId].stemId === want) continue
      scheduleReplace(slotId, want, buf)
    }
    fetchMissing()
  }

  // 160 MiB. Stereo float32 at 48kHz is seconds x 48000 x 2 x 4 = 384 KB per
  // second per stem, so a 16-second stem is 6.14 MB and twenty of them are
  // 122.9 MB. The budget is set ABOVE that on purpose: evicting a stem he is
  // actively listening to is a worse failure than a fatter tab, because it is
  // silent and reads as the mix being wrong rather than the phone being full.
  // This clears twenty 16-second stems by seven more stems' worth and binds at
  // 27 of them, 13 of 32 seconds, or 54 of 8. The spec's 96 MB was a MONO
  // figure and would evict at eleven stereo stems.
  //
  // IF IOS KILLS THE TAB (it reloads itself mid-listen, with no console):
  // halve this to 80 and set PHONE_STEM_CHANNELS to 1 in
  // src/main/remoteStemRenderer.ts. Mono at 80 MiB is the same headroom the
  // spec measured, and it is a two-line retreat.
  var STEM_BUDGET_BYTES = 160 * 1024 * 1024

  // A CAP ON STEM COUNT WOULD BE THE WRONG SHAPE: twenty 8-second stems are
  // cheaper than eight 32-second ones, and PHONE_LOOP_MAX_BARS is 32. What
  // costs memory is decoded seconds, so that is what is counted.
  function bytesOf(buf) {
    return buf.length * buf.numberOfChannels * 4
  }

  function decodedBytes() {
    var total = 0
    for (var id in buffers) total = total + bytesOf(buffers[id])
    return total
  }

  // Drops buffers nothing is asking for. A stem that survived a roll is
  // still wanted and is never touched -- eleven of twelve are kept, which
  // is the whole economy of this feature. What goes is the stem that left
  // the mix, which was only being held in case he rolled back to it.
  function evict() {
    if (decodedBytes() <= STEM_BUDGET_BYTES) return
    var wanted = {}
    for (var slotId in wantedStemId) wanted[wantedStemId[slotId]] = true
    for (var id in buffers) {
      if (wanted[id]) continue
      delete buffers[id]
      if (decodedBytes() <= STEM_BUDGET_BYTES) return
    }
  }

  // True while at least one wanted stem is not being fetched because there
  // is no room for it. Recomputed from scratch every pass, so it clears
  // itself the moment an eviction makes room.
  var overBudget = false

  function fetchMissing() {
    var was = overBudget
    overBudget = false
    for (var slotId in wantedStemId) {
      var id = wantedStemId[slotId]
      if (buffers[id] || fetchingIds[id]) continue
      if (failedIds[id] >= MAX_STEM_TRIES) continue
      if (decodedBytes() >= STEM_BUDGET_BYTES) { overBudget = true; continue }
      fetchStem(id)
    }
    // Only when it CHANGED. This runs on every poll, and a status line
    // rewritten every 700ms would eat the flash under the thumb.
    if (was !== overBudget) restStatus()
  }

  // ONE STEM'S AUDIO, addressed by nothing but the id the mac named for it.
  // The id is sixteen hex characters of a hash the mac computed from an
  // EngineStem it holds; this page has never seen a filename and still
  // cannot name one.
  function fetchStem(stemId) {
    fetchingIds[stemId] = true
    fetch('/api/stem?id=' + stemId, { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (!r.ok) throw new Error('stem ' + r.status)
        return r.arrayBuffer()
      })
      .then(function (bytes) {
        return audioCtx.decodeAudioData(bytes).then(function (buf) {
          // Kept whether or not anything still wants it: he may roll back,
          // and it is already paid for. Dropping it is the budget's job.
          buffers[stemId] = buf
          delete failedIds[stemId]
          evict()
          restStatus()
        })
      })
      .catch(function () {
        failedIds[stemId] = (failedIds[stemId] || 0) + 1
        restStatus()
      })
      .then(function () {
        delete fetchingIds[stemId]
        reconcile()
      })
  }

  // The progress line, driven by the phone's OWN audio clock and by the one
  // instant every voice shares. Nothing about its position comes from the
  // Mac: no position messages, no clock sync. It no longer jumps back on a
  // roll, because the loop no longer restarts -- one stem changed, the
  // phrase did not.
  //
  // The percentage below is of .lane, which is inset to exactly the column
  // the waveforms are drawn in (see the stylesheet), so 0% and 100% are the
  // first and last sample of the picture rather than the edges of the
  // screen. It is still unclickable in two independent ways: both .lane and
  // .line are pointer-events:none, and no listener of any kind is attached
  // to either. It is an indicator. Do not add a seek.
  function tick() {
    var dur = audioCtx && haveOrigin ? loopDur() : 0
    if (dur > 0) {
      var t = (audioCtx.currentTime - origin) % dur
      // A browser that reports the boundary exactly on the instant would
      // give a remainder of -0 or a hair less, and the line would jump to
      // the far end of the lane for one frame. A wrap is cheaper than
      // finding that out on a phone.
      if (t < 0) t = t + dur
      var progress = t / dur
      lineEl.style.left = (progress * 100) + '%'
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  function show(paired) {
    pairEl.hidden = paired
    appEl.hidden = !paired
  }
  show(!!token)

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body || {})
    })
  }

  // A short-lived line under the buttons. The state poll is up to 700ms
  // behind a tap, and at arm's length in a dark room that is long enough to
  // wonder whether the tap landed.
  var flashTimer = null
  function flash(text) {
    msgEl.textContent = text
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(function () {
      if (msgEl.textContent === text) restStatus()
    }, 2000)
  }

  // What the status line says when nothing transient is on it. The counters
  // moved up to the eyebrow row, so this line is the only place the last
  // kept name has left to live -- and an empty line under a busy thumb is
  // better than a stale one. Two seconds rather than the old 1400ms: at
  // arm's length in a dark room 1400 was short.
  // A MISSING STEM IS NOT HIDDEN. Judging an incomplete mix without knowing
  // it is incomplete is the one thing this screen must never do -- and
  // falling back to the whole rendered mixdown for one missing stem would
  // be a very large hammer.
  var lastKept = null
  function restStatus() {
    var missing = 0
    for (var slotId in wantedStemId) {
      if (failedIds[wantedStemId[slotId]] >= MAX_STEM_TRIES) missing = missing + 1
    }
    if (overBudget) { msgEl.textContent = 'too many stems'; return }
    if (missing > 0) {
      msgEl.textContent = missing + (missing === 1 ? ' stem missing' : ' stems missing')
      return
    }
    msgEl.textContent = lastKept ? 'last kept \\u00b7 ' + lastKept : ''
  }

  // PAIRING HAPPENS HERE AND NOWHERE ELSE. The typed form and the QR
  // link's ?${REMOTE_PAIR_QUERY_PARAM}= both come through this one
  // function, so both make the same POST /api/pair request and get the same
  // five-attempt limiter, the same Host guard, the same everything. Scanning
  // is a faster way to fill the form in -- it is not a second, weaker way in,
  // and the server did not have to grow one.
  function submitCode(code) {
    fetch('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code })
    })
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw j }) })
      .then(function (j) {
        token = j.token
        try { localStorage.setItem('sssketch-remote-token', token) } catch (e) {}
        pairMsgEl.textContent = ''
        show(true)
        poll()
      })
      .catch(function (j) {
        pairMsgEl.textContent = j && j.lockedOut ? 'too many tries, restart it on the mac' : 'wrong code'
      })
  }

  document.getElementById('pair-go').addEventListener('click', function () {
    submitCode(document.getElementById('code').value)
  })

  // The mac's QR code encodes this page's address with the pairing code
  // already in it, so the camera does the typing.
  var linkMatch = /[?&]${REMOTE_PAIR_QUERY_PARAM}=([^&]*)/.exec(location.search)
  if (linkMatch) {
    var linkCode = decodeURIComponent(linkMatch[1].replace(/\\+/g, ' '))
    // Stripped BEFORE the attempt is made, not after it succeeds, and
    // whether or not this page is already paired. Two reasons, both real: a
    // code left in the address bar rides along in a reload, a screenshot or
    // a shared tab; and a STALE code (the mac restarted, so the code
    // changed) would spend a fresh attempt off the five-attempt limiter on
    // every reload -- five refreshes would close pairing for the session
    // with nobody having typed anything wrong.
    try { history.replaceState(null, '', location.pathname) } catch (e) {}
    if (!token) {
      pairMsgEl.textContent = 'pairing'
      submitCode(linkCode)
    }
  }

  // --- the kind picker ---------------------------------------------------
  // A selection is a bitmask over KINDS, and the only thing that ever
  // changes it is a KIND_TOGGLE lookup. Tapping is not add-to-a-list: it is
  // the mac's own toggleSlotKind, so tapping sparkly with buttery already on
  // swaps them, and tapping drummy then rhythmic keeps both.
  var pendingMask = 0
  var chipEls = []

  // A sheet is its own collapse, so there is nothing to remember about
  // whether the chooser is expanded. "never mind" closes it WITHOUT
  // clearing the selection -- closing a sheet is not discarding a choice.
  function openKindSheet() {
    closeActionSheet()
    kindSheetEl.hidden = false
  }
  function closeKindSheet() {
    kindSheetEl.hidden = true
  }

  document.getElementById('new-stem').addEventListener('click', openKindSheet)
  document.getElementById('kind-cancel').addEventListener('click', closeKindSheet)
  document.getElementById('kind-sheet-bg').addEventListener('click', closeKindSheet)

  function selectedKinds() {
    var out = []
    for (var i = 0; i < KINDS.length; i++) {
      if (pendingMask & (1 << i)) out.push(KINDS[i].k)
    }
    return out
  }

  function paintChips() {
    var lit = 0
    for (var i = 0; i < KINDS.length; i++) {
      var on = (pendingMask & (1 << i)) !== 0
      chipEls[i].className = on ? 'chip on' : 'chip'
      if (on) lit++
    }
    // Two words, always the same two. The combination it will make is
    // readable from the lit chips directly above it, so the button does not
    // have to grow a sentence to say it -- buttons are two words maximum
    // (Elling, 2026-09-26), and that matters most on a phone.
    addEl.className = lit ? 'big' : 'big dim'
  }

  KINDS.forEach(function (kind, index) {
    var chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = kind.l
    chip.addEventListener('click', function () {
      pendingMask = KIND_TOGGLE[pendingMask][index]
      paintChips()
    })
    chipEls.push(chip)
    if (kind.t) traitChipsEl.appendChild(chip)
    else maskChipsEl.appendChild(chip)
  })
  paintChips()

  addEl.addEventListener('click', function () {
    var kinds = selectedKinds()
    // Nothing chosen is not worth a message: the chips are right above the
    // button and none of them is lit.
    if (kinds.length === 0) return
    api('/api/add-slot', { kinds: kinds })
    pendingMask = 0
    paintChips()
    // Back out of the way: the slot is on its way and the next thing he
    // wants to see is the row for it, not the chooser again.
    closeKindSheet()
    flash('adding')
  })

  // --- the handover grid -------------------------------------------------
  // Five chips, one lit, in the page's existing chip idiom: inversion marks
  // the chosen one, exactly as it marks a chosen kind, and no colour is
  // spent -- colour on this page belongs to stems and the playhead only.
  // Five at flex: 1 1 0 in a 390px column is about 68px each, still well
  // over the 42px tap floor the page holds itself to.
  //
  // CHANGING IT WHILE PLAYING TOUCHES NOTHING THAT IS ALREADY SCHEDULED. A
  // handover in flight has both of its ends committed on the audio clock --
  // the incoming source's start(at) and the playing source's stop(at) -- and
  // moving a stop that may already be inside the block the audio thread is
  // rendering has no honest answer. That is the same reason scheduleReplace
  // drops a handover whose boundary has moved rather than rescheduling one.
  // So a
  // pending handover keeps the boundary it was given and the new grid
  // applies from the next one: tapping a chip cancels nothing, schedules
  // nothing and cannot make or unmake a sound. At worst one more handover
  // lands on the old grid, seconds before the new setting takes over.
  var gridChipsEl = document.getElementById('chips-grid')
  var gridChipEls = []

  function paintGridChips() {
    for (var i = 0; i < SWAP_GRIDS.length; i++) {
      gridChipEls[i].className = SWAP_GRIDS[i].g === swapGrid ? 'chip on' : 'chip'
    }
  }

  SWAP_GRIDS.forEach(function (option) {
    var chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = option.l
    chip.addEventListener('click', function () {
      swapGrid = option.g
      try { localStorage.setItem(SWAP_GRID_KEY, String(option.g)) } catch (e) {}
      paintGridChips()
    })
    gridChipEls.push(chip)
    gridChipsEl.appendChild(chip)
  })
  paintGridChips()

  // --- how a handover takes ----------------------------------------------
  // Three chips, the same inversion, the same phone-local storage, no route
  // and no mac involvement. MUTE_RAMP is deliberately NOT governed by this:
  // a mute you asked for must not take half a bar to arrive.
  var xfadeChipsEl = document.getElementById('chips-xfade')
  var xfadeChipEls = []

  function paintXfadeChips() {
    for (var i = 0; i < XFADES.length; i++) {
      xfadeChipEls[i].className = XFADES[i].x === xfade ? 'chip on' : 'chip'
    }
  }

  XFADES.forEach(function (option) {
    var chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = option.l
    chip.addEventListener('click', function () {
      xfade = option.x
      try { localStorage.setItem(XFADE_KEY, String(option.x)) } catch (e) {}
      paintXfadeChips()
    })
    xfadeChipEls.push(chip)
    xfadeChipsEl.appendChild(chip)
  })
  paintXfadeChips()

  // --- radio fold mode's switch -------------------------------------------
  // Two chips, off and on, shown only while radio runs on the mac (the state's
  // fold field is a boolean then, null otherwise). A tap posts /api/fold; the next
  // poll paints what the mac says, so a lost tap never shows as taken.
  var foldRowEl = document.getElementById('fold-row')
  var foldChipsEl = document.getElementById('chips-fold')
  var foldState = null
  var foldChipEls = []

  function paintFold() {
    foldRowEl.hidden = foldState === null
    foldChipEls[0].className = foldState === false ? 'chip on' : 'chip'
    foldChipEls[1].className = foldState === true ? 'chip on' : 'chip'
  }

  ;[false, true].forEach(function (on) {
    var chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = on ? 'on' : 'off'
    chip.addEventListener('click', function () {
      if (foldState === null || foldState === on) return
      api('/api/fold', { on: on })
    })
    foldChipEls.push(chip)
    foldChipsEl.appendChild(chip)
  })
  paintFold()

  // --- the rows ----------------------------------------------------------
  // Removing has no undo on the phone (undo stayed on the mac on purpose),
  // so it takes two taps: the first arms this row, the second does it. The
  // arming lapses on its own rather than sitting armed in a pocket, and any
  // other tap cancels it.
  // What is DRAWN. Not necessarily the newest poll -- see mergePolledSlots.
  var lastSlots = []
  var lastRowsKey = null
  // The newest poll, whether or not it is drawn. reconcileGoing asks it
  // whether the mac itself still has a slot, which is a different question
  // from whether the row is still on screen.
  var polledSlots = []

  // THE ROWS CATCH UP WITH THE SOUND, ROW BY ROW.
  //
  // The mac's picture changes the moment a roll lands. That stem then has
  // to be transcoded, downloaded, decoded and waited on until a boundary.
  // Drawing its new name at the front of that gap means the row says one
  // thing while the phone plays another, and judging what you are hearing
  // is the entire purpose of this screen.
  //
  // PER ROW now, not per page: eleven rows that did not change are drawn
  // from the newest poll immediately, and only the one that is mid-change
  // holds. That is strictly better than the whole-page hold it replaces.
  //
  // Two things are deliberately NOT held. Nothing is held while nothing is
  // sounding -- there is no sound for the picture to run ahead of, and a
  // row rolled with the transport off would otherwise freeze forever. And
  // a stem that has given up after three tries is not on its way: freezing
  // a row on audio that will never arrive is worse than showing the mac's
  // picture early, which is the same judgement the whole-page hold made.
  function mergePolledSlots(polled) {
    if (!wantPlaying || !haveOrigin) return polled
    var out = []
    for (var i = 0; i < polled.length; i++) {
      var s = polled[i]
      var want = wantedStemId[s.id]
      var v = voices[s.id]
      var coming = !(failedIds[want] >= MAX_STEM_TRIES)
      var inFlight = want && coming && ((v && v.stemId !== want) || (!v && !buffers[want]))
      if (!inFlight) { out.push(s); continue }
      var drawn = null
      for (var j = 0; j < lastSlots.length; j++) if (lastSlots[j].id === s.id) drawn = lastSlots[j]
      // Its sound has not changed yet, so its name and shape do not either
      // -- but its own mute state is a thing he just did and must be shown.
      if (drawn) { drawn.muted = s.muted; drawn.soloed = s.soloed; out.push(drawn) }
      else out.push(s)
    }
    return out
  }

  // { canvas, peaks, color } per visible row, so a resize can redraw the
  // stack without waiting for the next poll to change something.
  var rowCanvases = []

  // THERE IS ONE GESTURE ON A ROW. There were two -- a short tap ran the
  // solo/mute cycle and a 450ms press opened the action sheet -- and
  // sharing one element between them cost a timer, a 10px slop threshold,
  // a fired flag, a moved flag and four pointer listeners whose whole job
  // was deciding which of the two had happened. s, m and x took the tap's
  // work, so the press has nothing left to be told apart from and the
  // arbitration went with it. That is the "simplidy" in "buttosn for s and
  // m instead! simplidy".
  //
  // What the deletion also removed, for nothing: a press that drifted 11px
  // did neither thing, and a sheet that opened under the thumb had to be
  // waited out before the row would answer again.

  function buzz() {
    // ios safari does not implement this; some browsers implement it and
    // throw when the document is not focused.
    if (navigator.vibrate) {
      try { navigator.vibrate(10) } catch (e) {}
    }
  }
  var armedRemoveId = null
  var armedRemoveTimer = null
  // Every visible row and its x, by slot id, so arming or marking one row
  // can repaint ONE row. Rebuilt with the rows; Object.create(null) so a
  // slot id can never collide with something inherited.
  var dropEls = Object.create(null)
  var rowEls = Object.create(null)
  // The last thing the mac said radio was about to do, or null. Held here
  // rather than read off a poll where it is needed, because renderRows can
  // run between polls (a handover lands and the merge stops holding a row)
  // and a fresh row has to come up already marked.
  var radioAhead = null
  // The other half of the same idea: everything on a row that says what
  // the MIX is doing -- the kind label, the canvas and the two key
  // buttons -- kept together so one row's mute or solo can be drawn
  // without going near the list. Each record is the same object
  // rowCanvases holds, so a resize and a mute cannot disagree about a
  // row's colour.
  var mixEls = Object.create(null)

  // THE ROWS THAT HAVE BEEN REMOVED AND HAVE NOT GONE YET, by slot id, each
  // holding the wall-clock instant its confirming tap posted. A pending
  // indicator and deliberately NOT an undo window: the remove posts on that
  // tap exactly as it always did, nothing is queued, delayed or cancellable,
  // and he asked to be shown it rather than to take it back.
  //
  // Wall-clock rather than the audio clock on purpose -- this is about the
  // mac answering, which has nothing to do with whether anything is
  // sounding, and the audio clock does not exist until play is pressed.
  var goingRemoveIds = Object.create(null)

  // HOW LONG A REMOVAL THE MAC NEVER TOOK STAYS DRAWN AS GOING. The mac
  // offline, the command lost, discover closed on it: nothing is coming and
  // a row cannot sit in limbo forever. Eight seconds is more than ten polls,
  // so it never fires on a slow but working mac -- and the clock is only
  // consulted at all when the mac's own live list STILL has the slot, so a
  // removal the mac DID take can never time out while it waits for a loop
  // boundary, however long that wait is (see reconcileGoing).
  var GOING_MS = 8000

  function isGoing(id) {
    return goingRemoveIds[id] !== undefined
  }

  // The whole of "armed", drawn, in the one place that draws it.
  //
  // THE BUG THIS EXISTS FOR (2026-09-27, on the phone): "initial click to
  // engage 'sure' and delete stem for stems low on screen when bottom
  // buttons are showing, it jumps the scroll to another point". Arming used
  // to go through renderRows, and armedRemoveId was part of its repaint key
  // -- so changing one button's label from x to sure wiped rowsEl's
  // innerHTML and rebuilt every row and every canvas. For that instant the
  // stack has no height, the document is shorter than the scroll offset,
  // and the browser clamps the offset to fit. Worst at the bottom of a long
  // stack, where there is least room to clamp into, which is exactly where
  // he found it.
  //
  // It also stopped every waveform on screen being redrawn to change two
  // characters, which nobody had complained about yet.
  function paintDrop(id) {
    var drop = dropEls[id]
    if (!drop) return
    // Going beats armed: the arming is what produced it, and the second tap
    // disarms before it marks, so the two never really coincide -- but the
    // order is written down rather than relied on.
    var going = isGoing(id)
    var armed = armedRemoveId === id
    drop.className = going ? 'drop going' : (armed ? 'drop armed' : 'drop')
    drop.textContent = going ? 'going' : (armed ? 'sure' : 'x')
  }

  // The other half of the same per-row repaint: the row's own border. Two
  // elements, two one-line painters, called from the same places -- and, as
  // with paintDrop, this is the ONLY thing that writes a row's class, so a
  // fresh row comes up already marked if the list was rebuilt under a
  // pending removal.
  function paintGoingRow(id) {
    var row = rowEls[id]
    if (!row) return
    row.className = isGoing(id) ? 'row going' : 'row'
  }

  // THE SAME PER-ROW REPAINT, for what radio is about to do. The mac names
  // at most one armed row and any number of held rows -- radio's own held
  // change plus every manual change waiting for the loop top, which is why
  // a tap on such a row is ignored -- and every other row simply stops
  // breathing.
  //
  // A HELD row is the brighter of the two: its change is decided and lands
  // at the very next wrap. An ARMED one is dimmer -- a pick is chosen and
  // warming, and the wrap it lands on may still be laps away. Neither one
  // counts anything down; the playhead in the lane does the "when".
  //
  // The row's own animation style and nothing else, so this and
  // paintGoingRow (which owns className) can never overwrite one another.
  function paintAhead(id) {
    var row = rowEls[id]
    if (!row) return
    var held = radioAhead !== null && (radioAhead.heldSlotIds || []).indexOf(id) !== -1
    var armed = !held && radioAhead !== null && radioAhead.armedSlotId === id
    row.style.animation = held
      ? 'ahead-now 2600ms ease-in-out infinite'
      : armed
        ? 'ahead 2600ms ease-in-out infinite'
        : ''
  }

  function paintAllAhead() {
    for (var id in rowEls) paintAhead(id)
  }

  function markGoing(id) {
    goingRemoveIds[id] = Date.now()
    paintDrop(id)
    paintGoingRow(id)
  }

  // A going row stops being going when it stops being DRAWN, which is
  // exactly what "will disappear soon" promised -- and not a moment before.
  // That can be a whole loop after the mac agreed, because the rows are held
  // to the sound one row at a time (see mergePolledSlots): the stem is
  // still sounding, so the row is still there to be marked.
  //
  // The timeout is the other branch and is deliberately NOT a plain timer:
  // it is consulted only for a slot the mac's own live list still names.
  // Still on the mac after eight seconds means the mac never took the
  // removal; gone from the mac but still drawn means it took it and the
  // sound has not caught up, which is not a failure and must never be
  // treated as one.
  function reconcileGoing() {
    for (var id in goingRemoveIds) {
      var drawn = false
      for (var i = 0; i < lastSlots.length; i++) {
        if (lastSlots[i].id === id) drawn = true
      }
      if (!drawn) { delete goingRemoveIds[id]; continue }
      var macStillHasIt = false
      for (var j = 0; j < polledSlots.length; j++) {
        if (polledSlots[j].id === id) macStillHasIt = true
      }
      if (macStillHasIt && Date.now() - goingRemoveIds[id] > GOING_MS) {
        delete goingRemoveIds[id]
        paintDrop(id)
        paintGoingRow(id)
      }
    }
  }

  function disarmRemove() {
    var was = armedRemoveId
    armedRemoveId = null
    if (armedRemoveTimer) { clearTimeout(armedRemoveTimer); armedRemoveTimer = null }
    if (was !== null) paintDrop(was)
  }

  function armRemove(id) {
    disarmRemove()
    armedRemoveId = id
    paintDrop(id)
    armedRemoveTimer = setTimeout(function () {
      armedRemoveId = null
      paintDrop(id)
    }, 4000)
  }

  function rowColor(slot) {
    // "gray means quieter/off" (StemWaveformRow.tsx). Mute suppresses the
    // colour; it never dims it. #6a6a6a is --ra-text-3, the exact grey the
    // desktop's always-visible layer is drawn in. A row with no sound type
    // yet has no colour to spend either.
    //
    // A STEM THAT GAVE UP DRAWS THE SAME WAY, because it is not sounding
    // either and that is the fact the colour carries. There is no spare
    // colour on this page and nothing on it may fade, so a third state
    // would have to invent a vocabulary; the status line says how many, in
    // words, which is where a count belongs.
    var dead = slot.stemId && failedIds[slot.stemId] >= MAX_STEM_TRIES
    return (slot.muted || dead) ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')
  }

  function audibleRowCount() {
    var n = 0
    for (var i = 0; i < lastSlots.length; i++) {
      if (!lastSlots[i].muted) n++
    }
    return n
  }

  // soloed is never remembered, here or on the mac: it is one row left in
  // the mix, read back off the mix. remoteStateFromSlots computes it the
  // same way from the same fact, so an optimistic paint and the poll that
  // replaces it can only ever agree.
  function recomputeSoloed() {
    var alone = audibleRowCount() === 1
    for (var i = 0; i < lastSlots.length; i++) {
      lastSlots[i].soloed = !lastSlots[i].muted && alone
    }
  }

  // Optimistic: the poll is up to 700ms behind and the row has to answer the
  // thumb now. The next poll overwrites all of it -- and while a loop swap is
  // pending the rows are held, so this paint is what he is looking at for as
  // long as a loop.
  //
  // A solo still has no appearance of its own on the ROW and deliberately
  // gets none. It drops every other row out of the mix, so every other row
  // loses its colour exactly as a mute does, and the one row still in
  // colour is the picture. The s button lights because a toggle has to say
  // whether it is engaged; the row itself takes no mark.
  //
  // A second press of an s that is already alone puts the whole mix back --
  // toggleSlotSolo's own behaviour, and the only gesture on this page that
  // restores every row at once. It is drawn here rather than waited for
  // because it is the one that most needs to be believed.
  function paintSlotAction(slot, action) {
    if (action === 'solo') {
      for (var i = 0; i < lastSlots.length; i++) {
        // Unresolved rows are not in the mac's full mix either -- the mix
        // it restores is every RESOLVED slot.
        if (slot.soloed) lastSlots[i].muted = !lastSlots[i].stemName
        else lastSlots[i].muted = lastSlots[i].id !== slot.id
      }
      recomputeSoloed()
      return
    }
    slot.muted = !slot.muted
    recomputeSoloed()
  }

  // Everything one row says about the mix, in the one place that says it:
  // the kind label's colour, the waveform's colour, and whether s and m are
  // engaged. Called for a fresh row as it is built and for a row the thumb
  // just changed, so the two can never draw the same state differently.
  function paintRowMix(slot) {
    var rec = mixEls[slot.id]
    if (!rec) return
    rec.color = rowColor(slot)
    rec.kind.style.color = rec.color
    rec.solo.className = slot.soloed ? 'key solo on' : 'key solo'
    rec.mute.className = slot.muted ? 'key mute on' : 'key mute'
    drawRowWave(rec.canvas, rec.peaks, rec.color)
  }

  // A mute or a solo changes the PICTURE without changing the list, so it
  // is painted onto the rows already on screen and nothing is rebuilt.
  // d7ff531 is the reason: wiping rowsEl under a thumb leaves the document
  // shorter than the scroll offset for an instant and the browser clamps
  // it, which is the scroll jump he found at the bottom of a long stack.
  // Arming a remove was fixed that way; this is the same class of state and
  // gets the same treatment. A solo touches every row, so every row is
  // repainted -- repainting is not rebuilding.
  //
  // The key comes forward with it. renderRows compares the poll against
  // what is DRAWN, and what is drawn is now what was just painted; without
  // this line the next poll -- which agrees -- would read as a change and
  // rebuild the stack 700ms after the tap, scroll jump and all.
  function paintMix() {
    for (var i = 0; i < lastSlots.length; i++) paintRowMix(lastSlots[i])
    lastRowsKey = JSON.stringify(lastSlots)
  }

  // The one way either verb leaves this page, whichever control asked for
  // it. A row on its way out has nothing left to ask it, and any other
  // press cancels a pending remove -- both are true of s and m as much as
  // they were of the tap that used to do this.
  function sendSlotAction(slot, next) {
    if (isGoing(slot.id)) return
    disarmRemove()
    paintSlotAction(slot, next)
    paintMix()
    // THE SOUND CHANGES HERE, before the mac has heard about it. The POST
    // below is only how the mac's own discover mix catches up; the phone no
    // longer waits for it and no longer re-downloads anything when it
    // lands.
    applyMix()
    api('/api/slot-action', { slotId: slot.id, action: next })
  }

  // One flat colour, once per row, on state change and on resize. Not per
  // frame -- these are static shapes; only the playhead moves.
  function drawRowWave(canvas, peaks, color) {
    var ctx = canvas.getContext ? canvas.getContext('2d') : null
    if (!ctx) return
    var cssW = canvas.clientWidth
    var cssH = canvas.clientHeight
    if (cssW <= 0 || cssH <= 0) return
    // Retina: the backing store is sized in DEVICE pixels and the context
    // is scaled back, so everything below is written in css pixels.
    // Assigning width or height also clears the canvas, so it is guarded.
    var dpr = window.devicePixelRatio || 1
    var w = Math.round(cssW * dpr)
    var h = Math.round(cssH * dpr)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    var mid = cssH / 2
    if (!peaks || peaks.length === 0) {
      // Nothing analysed yet: a flat rule, never a faked shape. Same answer
      // the master track used to give when it held no loop.
      ctx.fillStyle = '#222222'
      ctx.fillRect(0, Math.floor(mid), cssW, 1)
      return
    }
    var n = peaks.length
    var room = mid - 1
    ctx.fillStyle = color
    for (var i = 0; i < n; i++) {
      var x = (i * cssW) / n
      var bw = (((i + 1) * cssW) / n) - x - 0.5
      if (bw < 1) bw = 1
      var amp = (peaks[i] / 100) * room
      if (amp < 0.5) amp = 0.5
      ctx.fillRect(x, mid - amp, bw, amp * 2)
    }
  }

  function redrawRowWaves() {
    for (var i = 0; i < rowCanvases.length; i++) {
      drawRowWave(rowCanvases[i].canvas, rowCanvases[i].peaks, rowCanvases[i].color)
    }
  }
  window.addEventListener('resize', redrawRowWaves)
  window.addEventListener('orientationchange', redrawRowWaves)

  function renderRows() {
    // Rebuilt only when something actually changed. The poll runs every
    // 700ms and wiping the rows under a thumb mid-tap loses the tap. The
    // key stringifies the whole slot objects, so it covers muted and peaks
    // too -- without that the optimistic mute paint below would be
    // swallowed by this very guard.
    //
    // THE KEY IS THE SLOT DATA AND NOTHING ELSE. armedRemoveId used to be
    // in it, which made arming a remove cost a full rebuild and threw the
    // scroll offset up the page (see paintDrop above). Nothing purely
    // presentational belongs here: if a change can be drawn by touching the
    // element that shows it, draw it there instead. Everything the key
    // covers now -- the kind label, the name, the sound type, the mute and
    // the peaks -- is a different picture, not a different state of the
    // same one.
    var key = JSON.stringify(lastSlots)
    if (key === lastRowsKey) return
    lastRowsKey = key
    rowsEl.innerHTML = ''
    rowCanvases = []
    dropEls = Object.create(null)
    rowEls = Object.create(null)
    mixEls = Object.create(null)
    lastSlots.forEach(function (slot) {
      var row = document.createElement('div')
      // Registered first, then classed by the one function that classes a
      // row, for the same reason the x below is: a rebuild under a pending
      // removal must come up already marked.
      rowEls[slot.id] = row
      paintGoingRow(slot.id)

      var kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = slot.kindLabel

      // The name is its own cell on the first line now, and the waveform
      // is a cell on the second. They were one stacked cell when they
      // shared the middle column.
      var name = document.createElement('span')
      name.className = 'name'
      name.textContent = slot.stemName || '…'
      // radio's role words (hook · back in 16), after the name, dimmed
      if (slot.role && slot.role.words) {
        var role = document.createElement('span')
        role.className = 'role'
        role.textContent = ' · ' + slot.role.words
        name.appendChild(role)
      }

      var stem = document.createElement('span')
      stem.className = 'stem'
      var canvas = document.createElement('canvas')
      stem.appendChild(canvas)

      // s and m, in place of the cycle a tap used to run. A cycle whose
      // middle you cannot see is a guess -- "buttosn for s and m instead!
      // simplidy".
      var soloKey = document.createElement('button')
      soloKey.textContent = 's'
      var muteKey = document.createElement('button')
      muteKey.textContent = 'm'
      // Nothing to mute or solo until the stem resolves, which is the
      // desktop row's own guard on the same two buttons.
      soloKey.disabled = !slot.stemName
      muteKey.disabled = !slot.stemName
      soloKey.addEventListener('click', function () { sendSlotAction(slot, 'solo') })
      muteKey.addEventListener('click', function () { sendSlotAction(slot, 'mute') })

      var drop = document.createElement('button')
      dropEls[slot.id] = drop
      // Registered first, then painted by the one function that paints it,
      // so a fresh row comes up already armed if this rebuild happened
      // under an arming.
      paintDrop(slot.id)
      drop.addEventListener('click', function () {
        if (isGoing(slot.id)) return
        if (armedRemoveId === slot.id) {
          disarmRemove()
          api('/api/remove-slot', { slotId: slot.id })
          // Marked in the same breath as the post, so the row answers the
          // thumb now rather than in up to 700ms -- and then keeps
          // answering it until it actually goes, which with the rows held
          // to the audible loop can be a whole loop away.
          markGoing(slot.id)
          // Not 'removed': it is not, yet. The row says going and this line
          // must not claim otherwise.
          flash('removing')
          return
        }
        armRemove(slot.id)
      })

      // A TAP ON THE ROW OPENS THE MENU. It was a 450ms press for as long
      // as a tap meant mute; with s and m on the row a tap means nothing
      // else, so the menu takes the cheapest gesture on the page instead of
      // the most expensive one.
      //
      // A click, not a pointerup: the browser is the thing that already
      // knows a tap from the start of a scroll, and letting it decide is
      // the whole saving. An unresolved row has no actions to offer, which
      // is the desktop's own hasStemToActOn guard, and a row on its way out
      // has nothing left to ask it at all.
      if (slot.stemName) {
        row.addEventListener('click', function (e) {
          if (isGoing(slot.id)) return
          // s, m and x are inside the row, so their click passes through
          // here on its way up. Each one is its own gesture and none of
          // them is a request for the menu.
          if (e.target.tagName === 'BUTTON') return
          disarmRemove()
          openActionSheet(slot)
        })
      }

      // One record, held twice: by slot id so a mute can find this row's
      // parts, and in rowCanvases so a resize can redraw every canvas. The
      // same object both times, deliberately -- two copies of a row's
      // colour is two things to keep in step.
      var rec = {
        canvas: canvas,
        peaks: slot.peaks,
        color: rowColor(slot),
        kind: kind,
        solo: soloKey,
        mute: muteKey
      }
      mixEls[slot.id] = rec
      rowCanvases.push(rec)

      // Placed by grid-template-areas, so this order is the reading order
      // and not the layout.
      row.appendChild(kind)
      row.appendChild(name)
      row.appendChild(soloKey)
      row.appendChild(muteKey)
      row.appendChild(stem)
      row.appendChild(drop)
      rowsEl.appendChild(row)
      // Painted after the row is in place, for the same reason x is: a
      // rebuild mid-interval must come up already breathing.
      paintAhead(slot.id)
      // After append, so the canvas has a box to measure.
      paintRowMix(slot)
    })
    // The playhead's lane lives inside .rows and innerHTML just wiped it. It
    // is re-appended rather than rebuilt, so lineEl -- still inside it --
    // keeps pointing at the element tick() is moving.
    rowsEl.appendChild(laneEl)
  }

  // --- the stem action sheet ---------------------------------------------
  var ACTS = ${JSON.stringify(STEM_ACTIONS)}
  var ROLE_ACTS = ${JSON.stringify(ROLE_ACTIONS)}
  var actSheetEl = document.getElementById('act-sheet')
  var actsEl = document.getElementById('acts')
  var actSlot = null

  function closeActionSheet() {
    actSheetEl.hidden = true
    actSlot = null
  }

  // Every action is offered on every resolved row, including a locked one
  // -- that is what the desktop does: only roll all skips a locked slot,
  // and a deliberate per-slot action always wins. adjacent is offered even
  // when the mac would find nothing nearby; hiding it would mean shipping a
  // "has a riff anchor" flag to a page that deliberately knows nothing
  // about the library, and an adjacent with nothing nearby simply leaves
  // the row playing what it was already playing.
  function openActionSheet(slot) {
    closeKindSheet()
    actSlot = slot
    document.getElementById('act-kind').textContent = slot.kindLabel
    document.getElementById('act-kind').style.color = rowColor(slot)
    document.getElementById('act-name').textContent = slot.stemName || '…'
    actsEl.innerHTML = ''
    // radio's roles, only while radio runs
    var acts = ACTS.slice()
    if (radioAhead) {
      var hook = slot.role ? slot.role.hook : null
      acts.push(hook ? ROLE_ACTS.release : ROLE_ACTS.hook)
      if (hook === 'away' || hook === 'resting') acts.push(ROLE_ACTS.back)
    }
    acts.forEach(function (act) {
      var b = document.createElement('button')
      b.className = 'act'
      b.appendChild(document.createTextNode(act.l))
      var hint = document.createElement('span')
      hint.className = 'h'
      hint.textContent = act.h
      b.appendChild(hint)
      b.addEventListener('click', function () {
        if (!actSlot) return
        api('/api/slot-action', { slotId: actSlot.id, action: act.a })
        // adjacent is not a roll -- it swaps in a stem from the jam next
        // door, so saying "rolling" would describe the wrong thing
        // happening. duplicate does not roll either; it clones.
        flash(
          act.a === 'duplicate' ? 'copied'
            : act.a === 'adjacent' ? 'nearby'
              : act.a === 'hook' ? (act.l === 'release' ? 'released' : 'hooked')
                : act.a === 'back' ? 'coming back'
                  : 'rolling'
        )
        closeActionSheet()
      })
      actsEl.appendChild(b)
    })
    actSheetEl.hidden = false
  }

  document.getElementById('act-cancel').addEventListener('click', closeActionSheet)
  document.getElementById('act-sheet-bg').addEventListener('click', closeActionSheet)

  function render(state) {
    countsEl.textContent = 'kept ' + state.kept + ' · rolled ' + state.rolled
    lastKept = state.lastKeptName
    if (keepPending) {
      var keeps = state.keeps || []
      var answer = null
      for (var ki = 0; ki < keeps.length; ki++) {
        var k = keeps[ki]
        if (k.id === keepPending.id) answer = k
      }
      // The four outcomes: 'kept', 'already', 'refused', 'none'.
      if (answer && KEEP_SAYS[answer.outcome]) {
        keepPending = null
        flash(KEEP_SAYS[answer.outcome])
      } else if (Date.now() > keepPending.until) {
        keepPending = null
        flash('not kept')
      }
    }
    // Absent from an older Mac, which reads as false.
    listenOnly = state.listenOnly === true
    keepEl.disabled = listenOnly
    keepEl.textContent = listenOnly ? 'listening only' : 'keep'
    // WHAT RADIO IS ABOUT TO CHANGE, held before anything can rebuild the
    // rows below. Null from a mac with radio off -- and from an older one
    // that has never heard of it, which is the same no-mark either way.
    radioAhead = state.radio || null
    // Fold mode's switch: a boolean while radio runs, null (hidden) otherwise -- and from an
    // older mac, which never sends it.
    foldState = typeof state.fold === 'boolean' ? state.fold : null
    paintFold()
    if (!state.discoverOpen) {
      radioAhead = null
      lastSlots = []
      polledSlots = []
      goingRemoveIds = Object.create(null)
      disarmRemove()
      renderRows()
      emptyEl.hidden = true
      loopEl.hidden = true
      // Don't come back from a closed discover with a sheet still up.
      closeKindSheet()
      closeActionSheet()
      macEl.textContent = ''
      // Unconditionally, and BEFORE the wantPlaying check: stopAll is the
      // only thing that undoes everything scheduled, and it is idempotent
      // with nothing playing. Every buffer goes with it -- discover being
      // closed is the one teardown that keeps nothing at all.
      wantedStemId = {}
      buffers = {}
      fetchingIds = {}
      failedIds = {}
      loopBars = 0
      stopAll()
      if (wantPlaying) { wantPlaying = false; setPlayLabel() }
      msgEl.textContent = 'open discover on the mac'
      return
    }
    if (msgEl.textContent === 'open discover on the mac') restStatus()
    // state.playing is the MAC's transport, shown and never obeyed.
    macEl.textContent = state.playing ? 'mac playing' : ''
    setPlayLabel()
    // Kept whether or not it is drawn: reconcileGoing asks the mac's own
    // live list, which is a different question from what is on screen.
    polledSlots = state.slots
    // Guarded rather than trusted: a length the mac does not know is 0 there
    // and 0 here, and 0 means the whole loop. undefined fails this test too,
    // so a page served by an older mac degrades to the end-of-loop handover
    // instead of to arithmetic on nothing.
    loopBars = state.loopBars > 0 ? state.loopBars : 0

    // WHAT EACH ROW'S AUDIO IS, as the mac names it. A null stemId means
    // the mac is not naming one right now -- an unresolved slot, or a muted
    // one, which is not in discover's preview project at all. Keep whatever
    // that row last had: throwing the audio away would make unmuting cost a
    // download.
    var seen = {}
    for (var si = 0; si < state.slots.length; si++) {
      var ps = state.slots[si]
      seen[ps.id] = true
      if (ps.stemId) wantedStemId[ps.id] = ps.stemId
    }
    for (var gone in wantedStemId) {
      if (!seen[gone]) delete wantedStemId[gone]
    }
    if (wantPlaying) reconcile()

    // Nothing to roll, play or keep until there is a slot -- and the add
    // row is then the only thing on screen, which is the point.
    emptyEl.hidden = state.slots.length > 0
    loopEl.hidden = state.slots.length === 0
    lastSlots = mergePolledSlots(state.slots)

    // EVERYTHING BELOW RECONCILES AGAINST THE DRAWN ROWS, and this is the
    // line the three of them have to be on the same side of.
    //
    // The two guards below used to ask the mac's live state.slots instead,
    // from before the rows could lag the mac at all. Once they could, an
    // arming was dropped and an open sheet closed under a row that was
    // still drawn, still sounding and still under the thumb -- the mac had
    // moved on, but nothing the user could see had. Every one of these
    // gestures acts on a row that is DRAWN, so every one of them asks the
    // drawn rows whether it is still there. Fixed here rather than left
    // alone because the going mark needed exactly this list, and three
    // notions of "still there" in one function is how the next one goes
    // wrong. The cost is that a second tap can post a remove for a slot the
    // mac already dropped, which the mac simply does not find.
    reconcileGoing()
    // A slot that vanished from under an armed remove must not leave the
    // arming pointed at an id that is no longer on screen.
    if (armedRemoveId !== null) {
      var stillThere = lastSlots.some(function (s) { return s.id === armedRemoveId })
      if (!stillThere) disarmRemove()
    }
    // A slot that vanished from under an open sheet must not leave it
    // pointing at a row that is no longer there -- same rule as an armed
    // remove.
    if (actSlot !== null) {
      var actStillThere = lastSlots.some(function (s) { return s.id === actSlot.id })
      if (!actStillThere) closeActionSheet()
    }
    renderRows()
    paintTurn(state.turn)
    // A mute or a solo made on the MAC lands on the phone here, by the same
    // one line a tap on the phone takes. Nothing is re-fetched for it.
    applyMix()
    // AFTER renderRows, and unconditionally: radio moves to a different
    // row every few bars and the row list does not, so a rebuild is
    // exactly what must NOT be what draws this. renderRows paints a row it
    // has just built; this catches the far commoner case where it rebuilt
    // nothing at all.
    paintAllAhead()
  }

  document.getElementById('roll-all').addEventListener('click', function () { api('/api/roll', {}) })
  playEl.addEventListener('click', function () {
    if (wantPlaying) {
      wantPlaying = false
      stopAll()
      setPlayLabel()
      return
    }
    // iOS will not let an AudioContext produce sound unless it was started
    // from a user gesture. THIS CLICK IS THAT GESTURE -- the context is built
    // here, once, and kept. There is no autoplay path and there must not be
    // one: a context created on load is suspended and plays silence with no
    // error.
    if (!audioCtx) {
      var Ctor = window.AudioContext || window.webkitAudioContext
      audioCtx = new Ctor()
    }
    // Safari 16.4+. Without it, the hardware mute switch silences web audio
    // while the progress line keeps moving, which looks exactly like a bug.
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback' } catch (e) {}
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()
    wantPlaying = true
    setPlayLabel()
    reconcile()
  })
  // Keeping is a tap. It was a 700ms hold, on the reasoning that the one
  // thing on this page that writes to disk deserves a beat of intent --
  // and reported not working at all on his iPhone (2026-09-27), with the
  // instruction "doesnt need to be a touch and hold necessarily.. it an be
  // just a click".
  //
  // The likely reason it failed is worth recording, because it argues
  // against ever bringing a hold back here. A hold has to be abandoned when
  // the browser claims the gesture, so its undo was bound to the
  // pointercancel event -- and iOS fires that when it decides a touch
  // might become a scroll. The stack went top-aligned and the rows grew to
  // two lines on the same day, so the page became genuinely scrollable, and
  // a thumb resting on a button for most of a second on a scrollable page
  // is exactly the shape iOS reads as the start of a pan. The hold could
  // have been rescued with touch-action: none on this one button, but a tap
  // is what he asked for and a tap cannot be taken away from him by a
  // scroll heuristic.
  //
  // There is now NO hold anywhere on this page: the rows gave theirs up for
  // s, m and a tap that opens the menu, and this was the last one.
  var keepEl = document.getElementById('keep')

  // Each tap carries its own random id, and "kept" is said only when the
  // Mac answers THAT id (state.keeps, render below). The kept counter is
  // no evidence: a keep made on the Mac during the wait moves it too. A
  // tap before the first state, a duplicate request and a reloaded page
  // are all safe: ids are random, and main forwards an id once.
  // 409 means Discover is playing another user's stems, listen only.
  var keepPending = null
  var listenOnly = false
  var KEEP_SAYS = { kept: 'kept', already: 'already kept', refused: 'listening only', none: 'nothing to keep' }
  function newKeepId() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 24)
  }
  keepEl.addEventListener('click', function () {
    if (listenOnly) { flash('listening only'); return }
    buzz()
    var id = newKeepId()
    keepPending = { id: id, until: Date.now() + 8000 }
    flash('keeping')
    api('/api/keep', { keepId: id })
      .then(function (r) {
        if (!keepPending || keepPending.id !== id) return
        if (r.status === 409) { keepPending = null; flash('listening only'); return }
        if (!r.ok) { keepPending = null; flash('not kept') }
      })
      .catch(function () {
        if (keepPending && keepPending.id === id) { keepPending = null; flash('not kept') }
      })
  })

  // --- radio's turn ------------------------------------------------------
  // One tap, answered in the response: the mac says turning, nothing to
  // turn or radio off, and that is the flash. The button reads turning
  // and the chip of the move it plays is lit while the turn waits for the
  // top -- the state poll says so. A dimmed chip still answers a tap: the
  // mac's own answer says why nothing happened.
  var TURN_CHIPS = ${JSON.stringify(TURN_CHIPS)}
  var turnBoxEl = document.getElementById('turn-box')
  var turnEl = document.getElementById('turn')
  var turnChipsEl = document.getElementById('chips-turn')
  var turnChipEls = []
  function sendTurn(move) {
    buzz()
    api('/api/turn', move === null ? {} : { move: move })
      .then(function (r) { return r.json() })
      .then(function (body) { flash(body && body.answer ? body.answer : 'not turned') })
      .catch(function () { flash('not turned') })
  }
  turnEl.addEventListener('click', function () { sendTurn(null) })
  TURN_CHIPS.forEach(function (option) {
    var chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = option.l
    chip.addEventListener('click', function () { sendTurn(option.m) })
    turnChipEls.push(chip)
    turnChipsEl.appendChild(chip)
  })
  function paintTurn(turn) {
    turnBoxEl.hidden = !turn
    if (!turn) return
    turnEl.textContent = turn.waiting ? 'turning' : 'turn'
    var can = turn.moves || []
    for (var i = 0; i < TURN_CHIPS.length; i++) {
      var m = TURN_CHIPS[i].m
      turnChipEls[i].className =
        turn.waiting && turn.move === m ? 'chip on' : can.indexOf(m) === -1 ? 'chip dim' : 'chip'
    }
  }

  function poll() {
    if (!token) return
    fetch('/api/state', { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 401) { token = null; show(false); throw new Error('unpaired') }
        return r.json()
      })
      .then(render)
      .catch(function () {})
  }
  setInterval(poll, 700)
  poll()
})()
</script>
</body>
</html>`
