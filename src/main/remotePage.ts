// src/main/remotePage.ts
import { REMOTE_PAIR_QUERY_PARAM } from '@shared/remoteAuth'
import {
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_SLOT_KIND_OPTIONS,
  isTraitSlotKind
} from '@shared/discoverSlotKind'
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
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
 * 2026-09-20 -- `similar`, `adjacent`, `random`, `duplicate` -- reached from
 * a long press instead of a mouse. `a` is the wire value
 * (RemoteSlotAction, @shared/remoteState), `l` is the two-word-maximum
 * label and `h` is the hint line under it. The hints are what a label of
 * two words cannot say; they are not tooltips and they are not sentences. */
const STEM_ACTIONS = [
  { a: 'similar', l: 'similar', h: 'another like it' },
  { a: 'adjacent', l: 'adjacent', h: 'same jam' },
  { a: 'random', l: 'random', h: 'anything at all' },
  { a: 'duplicate', l: 'duplicate', h: 'one more row' }
]

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
 * holding to keep i selected the text below on my iphone". Every gesture on
 * this page is a press -- a row is 450ms, keep is 700ms -- and a press held
 * over text is how ios raises its selection handles and its callout. The
 * rows had carried their own copy of this since the long press was built;
 * keep never had one, so the 700ms press selected straight through the
 * transport and the foot. One rule on * replaces both, which is also why
 * .row no longer declares it.
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
.row .kind { grid-area: kind; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* min-width: 0 is not decoration: a canvas carries an intrinsic width, and
 * without it the 1fr column would be sized to that rather than to what is
 * left of the row. */
.row .stem { grid-area: wave; min-width: 0; }
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
/* isolation scopes the blend to this button, so the fill inverts the label
 * and nothing else on the page. */
button.keep { position: relative; overflow: hidden; isolation: isolate; }
button.keep .fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  background: #ededed;
}
button.keep .fill.run { transition: width 700ms linear; }
/* The label is white on black; where the white fill passes under it, the
 * difference blend makes it black on white. An inversion, not a colour --
 * #ededed is the page's own text colour. */
button.keep .keep-label,
button.keep .hint {
  position: relative;
  mix-blend-mode: difference;
  color: #ededed;
}
button.keep .hint { font-size: 9px; margin-left: 6px; color: #6a6a6a; }
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
        <button class="big keep" id="keep"><span class="fill" id="keep-fill"></span><span class="keep-label">keep</span><span class="hint">hold</span></button>
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
      <div class="swapgrid">
        <div class="eyebrow">swap every</div>
        <div class="chips grid" id="chips-grid"></div>
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

  // WHERE A NEW MIX IS ALLOWED TO TAKE OVER, as a number of bars -- 0
  // meaning the end of the loop, which is what this page did before the
  // grid existed and is still the default.
  //
  // "instead of it playing only at the end of the loop, could we set it to
  // update every 4 bars, 8 bars, etc? a switch and setting to do that? so
  // it's seamless but can update a bit sooner" -- Elling, 2026-09-27, after
  // hearing the end-of-loop handover.
  var SWAP_GRIDS = [
    { g: 0, l: 'loop end' },
    { g: 8, l: '8 bars' },
    { g: 4, l: '4 bars' },
    { g: 2, l: '2 bars' }
  ]
  var SWAP_GRID_KEY = 'sssketch-remote-swap-grid'

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
  var audioCtx = null
  // The buffer you are HEARING, the source playing it, and the audio-clock
  // time it started at. All three move together, and only in startSource
  // and commitSwap.
  var audioBuffer = null
  var srcNode = null
  var startedAt = 0
  // loadedLoopId is the id of the buffer that is audible; currentLoopId is
  // the id the mac wants. They differ for as long as a new mix is being
  // rendered, fetched, decoded and then waited on -- and the rows follow
  // loadedLoopId, not currentLoopId, so the picture never runs ahead of the
  // sound.
  var loadedLoopId = null
  // How many bars long the buffer you are HEARING is, as the mac counted
  // them (RemoteState.loopBars -- the same number it hands the engine as
  // loopLengthBars). 0 means not known, which swapPeriod reads as "the end
  // of the loop" and never as a bad grid. It moves with audioBuffer and
  // only where audioBuffer moves.
  var loadedLoopBars = 0
  var currentLoopId = null
  var wantPlaying = false
  var fetching = false
  // A decoded loop that is not audible YET: its source is already scheduled
  // to start at .at, and the source playing now is already scheduled to stop
  // at that same instant. Null the rest of the time. See takeLoop.
  var pendingSwap = null

  // How far ahead of the audio clock a handover has to be to be scheduled at
  // all.
  //
  // start(t) and stop(t) with a t that has already passed -- or that falls
  // inside the block the audio thread is rendering right now -- are clamped
  // to "as soon as possible", which is exactly the mid-loop cut this whole
  // mechanism exists to avoid. A render quantum is 128 frames (under 3ms),
  // but the audio thread runs a hardware buffer ahead of the main thread
  // (256 to 1024 frames on ios, so 5 to 21ms), and the main thread doing
  // this arithmetic can lose a frame or two to layout or gc on top of that.
  // 80ms clears all of it with room over, and is short against a bar at any
  // tempo -- so "wait for the loop after this one" stays the rare case
  // rather than the normal one.
  var SWAP_LEAD = 0.08

  function setPlayLabel() {
    playEl.textContent = wantPlaying ? 'stop' : 'play'
    playEl.className = wantPlaying ? 'big on' : 'big'
  }

  // Drops a swap that was scheduled and then superseded or abandoned. The
  // source has had start(at) called on it with at still in the future, so
  // stop() with no argument means "never sound at all"; it is disconnected
  // either way, so nothing is left hanging off the destination.
  function cancelPendingSwap() {
    if (!pendingSwap) return
    try { pendingSwap.src.stop() } catch (e) {}
    try { pendingSwap.src.disconnect() } catch (e) {}
    pendingSwap = null
  }

  function stopSource() {
    // A scheduled swap is part of "what is playing", so stopping takes it
    // with us. Left alone it would start into a stopped transport, and the
    // onended below would commit it as if it were being heard.
    cancelPendingSwap()
    if (srcNode) {
      srcNode.onended = null
      try { srcNode.stop() } catch (e) {}
      srcNode.disconnect()
      srcNode = null
    }
    lineEl.hidden = true
  }

  function startSource() {
    if (!audioCtx || !audioBuffer) return
    stopSource()
    srcNode = audioCtx.createBufferSource()
    srcNode.buffer = audioBuffer
    // An AudioBufferSourceNode loops sample-accurately, inside the audio
    // graph. An <audio loop> element puts an audible gap at the loop point in
    // Safari, which would land on every downbeat of the exact judgement this
    // page exists to make.
    srcNode.loop = true
    srcNode.connect(audioCtx.destination)
    startedAt = audioCtx.currentTime
    srcNode.start()
    lineEl.hidden = false
  }

  // How many bars long the loop with THIS id is. The mac pushes the length
  // alongside the loop id in one snapshot (see render), so the bars belong
  // to that loop and not to whatever happens to be playing while it
  // downloads. A buffer the newest poll does not name gets 0 -- unknown, so
  // the whole loop -- rather than a length borrowed from a different mix.
  function barsForLoop(id) {
    return polledLoopId === id ? polledLoopBars : 0
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
    var dur = audioBuffer.duration
    if (swapGrid === 0) return dur
    var bars = loadedLoopBars
    if (!(bars > 0) || bars !== Math.floor(bars)) return dur
    var step = swapGrid
    if (step > bars) step = bars
    while (step > 1 && bars % step !== 0) step = step - 1
    return (dur * step) / bars
  }

  // A freshly decoded loop, and the ONE place that decides when it becomes
  // the loop you hear.
  function takeLoop(buf, id) {
    // NOTHING IS SOUNDING: take it now. There is no audio to interrupt, so
    // there is no boundary worth waiting for -- waiting would only mean the
    // play button does nothing for up to a loop's length, and the rows sat
    // on a picture of something silent. This branch is also the first load
    // after play is pressed, where wantPlaying is true but no source exists
    // yet.
    if (!wantPlaying || !srcNode || !audioBuffer || !(audioBuffer.duration > 0)) {
      cancelPendingSwap()
      audioBuffer = buf
      loadedLoopId = id
      loadedLoopBars = barsForLoop(id)
      adoptPolledSlots()
      if (wantPlaying) startSource()
      return
    }
    // SOMETHING IS SOUNDING: hand over on the next boundary of the grid. The
    // playing source started at startedAt on the audio clock and has looped
    // seamlessly ever since, so the loop's own boundaries are startedAt + k
    // * duration -- and an N-bar grid's are the very same arithmetic with a
    // shorter period (see swapPeriod, which returns the whole duration on
    // the default setting, so this IS still the end of the loop unless a
    // chip says otherwise). Scheduling both ends against that one instant is
    // what makes this sample-accurate rather than "soon after this callback
    // ran".
    var period = swapPeriod()
    var now = audioCtx.currentTime
    var at = startedAt + Math.ceil((now - startedAt) / period) * period
    // Too close to schedule honestly -- take the boundary after it instead.
    // One more step of the old mix is the price, and nobody can hear a swap
    // that did not happen; a clamped start, cutting the loop mid-bar, is
    // exactly what they would hear.
    if (at - now < SWAP_LEAD) at = at + period
    if (pendingSwap) {
      // A THIRD loop arriving before the second one has started. Replacing
      // it is clean only at the same instant, because the playing source's
      // stop is already scheduled for pendingSwap.at and re-scheduling a
      // stop that is about to fire is the one case here with no honest
      // answer. The boundary can only have moved if we are inside SWAP_LEAD
      // of the handover -- an 80ms window -- so in that case this buffer is
      // simply dropped. loadedLoopId has not changed, so the next poll asks
      // for it again, by which time the swap it was racing has landed.
      if (pendingSwap.at !== at) return
      cancelPendingSwap()
    }
    var next = audioCtx.createBufferSource()
    next.buffer = buf
    next.loop = true
    next.connect(audioCtx.destination)
    next.start(at)
    srcNode.stop(at)
    // The old source ending IS the boundary, reported by the audio system
    // instead of guessed at by a second clock that could drift from it.
    srcNode.onended = commitSwap
    pendingSwap = { src: next, buffer: buf, id: id, bars: barsForLoop(id), at: at }
  }

  // The handover as the rest of the page sees it, a few milliseconds after
  // it already happened in the audio graph. Everything measured against the
  // playing loop moves in one step: the buffer the playhead divides by (the
  // two loops need not be the same length), the clock it counts from, the id
  // the fetcher dedupes against, and the rows.
  function commitSwap() {
    if (!pendingSwap) return
    var swap = pendingSwap
    pendingSwap = null
    if (srcNode) {
      srcNode.onended = null
      srcNode.disconnect()
    }
    srcNode = swap.src
    audioBuffer = swap.buffer
    startedAt = swap.at
    loadedLoopId = swap.id
    loadedLoopBars = swap.bars
    // THE PLAYHEAD RESTARTS HERE, and on a mid-loop handover that is the
    // honest picture rather than a glitch. The incoming buffer begins at its
    // OWN bar 0 -- there is no phase in it to match the outgoing loop to,
    // and matching one would mean starting the new mix part-way in, which is
    // not what a new mix means. So the line jumps back to the left at the
    // same instant the sound does and the rows change with it: one event,
    // drawn once. It is a step at a boundary, never a drift backwards, and
    // tick's own negative-remainder wrap still covers a browser that reports
    // the end exactly on the instant.
    adoptPolledSlots()
  }

  function loadLoop() {
    if (fetching || !wantPlaying || !token || !audioCtx) return
    if (!currentLoopId) { msgEl.textContent = 'nothing to play'; return }
    if (currentLoopId === loadedLoopId) return
    // Already decoded and waiting for a boundary. Without this the same wav
    // would be downloaded again every 700ms until the swap lands.
    if (pendingSwap && pendingSwap.id === currentLoopId) return
    fetching = true
    msgEl.textContent = 'loading the loop'
    fetch('/api/loop', { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 204) { msgEl.textContent = 'nothing to play'; return null }
        if (!r.ok) { msgEl.textContent = 'render failed'; return null }
        var id = r.headers.get('x-loop-id')
        return r.arrayBuffer().then(function (bytes) { return { id: id, bytes: bytes } })
      })
      .then(function (got) {
        if (!got) return null
        return audioCtx.decodeAudioData(got.bytes).then(function (buf) {
          // The download is over, whatever happens next -- takeLoop may not
          // make a sound for another loop's length.
          restStatus()
          takeLoop(buf, got.id)
        })
      })
      .catch(function () { msgEl.textContent = 'render failed' })
      .then(function () { fetching = false })
  }

  // The progress line, driven by the phone's OWN audio clock. Nothing about
  // its position comes from the Mac: no position messages, no clock sync.
  // The percentage below is of .lane, which is inset to exactly the column
  // the waveforms are drawn in (see the stylesheet), so 0% and 100% are the
  // first and last sample of the picture rather than the edges of the
  // screen. It is still unclickable in two independent ways: both .lane and
  // .line are pointer-events:none, and no listener of any kind is attached
  // to either. It is an indicator. Do not add a seek.
  function tick() {
    if (srcNode && audioBuffer && audioCtx && audioBuffer.duration > 0) {
      var t = (audioCtx.currentTime - startedAt) % audioBuffer.duration
      // startedAt is the boundary the swap was scheduled for, and commitSwap
      // runs when the audio system reports it -- normally a few ms after, so
      // t is positive. A browser that delivers onended ON the instant rather
      // than after it would give a remainder of -0 or a hair less, and the
      // line would jump to the far end of the lane for one frame. A wrap is
      // cheaper than finding that out on a phone.
      if (t < 0) t = t + audioBuffer.duration
      var progress = t / audioBuffer.duration
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
  var lastKept = null
  function restStatus() {
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
  // Four chips, one lit, in the page's existing chip idiom: inversion marks
  // the chosen one, exactly as it marks a chosen kind, and no colour is
  // spent -- colour on this page belongs to stems and the playhead only.
  //
  // CHANGING IT WHILE PLAYING TOUCHES NOTHING THAT IS ALREADY SCHEDULED. A
  // handover in flight has both of its ends committed on the audio clock --
  // the incoming source's start(at) and the playing source's stop(at) -- and
  // moving a stop that may already be inside the block the audio thread is
  // rendering has no honest answer. That is the same reason takeLoop drops a
  // buffer whose boundary has moved rather than rescheduling one. So a
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

  // --- the rows ----------------------------------------------------------
  // Removing has no undo on the phone (undo stayed on the mac on purpose),
  // so it takes two taps: the first arms this row, the second does it. The
  // arming lapses on its own rather than sitting armed in a pocket, and any
  // other tap cancels it.
  // What is DRAWN. Not necessarily the newest poll -- see adoptPolledSlots.
  var lastSlots = []
  var lastRowsKey = null
  // The newest poll, and the loop id it arrived with. The two are one
  // snapshot: state.slots is the set of stems state.loopId renders, so they
  // are stored and used together.
  var polledSlots = []
  var polledLoopId = null
  // The loop length that arrived with polledLoopId, in bars. Part of the
  // same snapshot for the same reason the slots are: it describes THAT loop.
  var polledLoopBars = 0

  // The rows catch up with the sound; they never run ahead of it.
  //
  // The mac's picture changes the moment a roll lands. The wav for it then
  // has to be rendered, downloaded, decoded and waited on until the end of
  // the loop that is playing -- seconds, in the ordinary case. Drawing the
  // new stem's name and waveform at the front of that gap would mean the row
  // says one thing while the phone plays another, every single time, and
  // judging what you are hearing is the entire purpose of this screen.
  //
  // So the rows move exactly when the audible loop does, and this is called
  // from the two places where that happens: commitSwap, and takeLoop's
  // nothing-is-sounding branch. The guard is what makes it safe to call from
  // either -- it draws the poll only if the poll is describing the loop that
  // is now audible.
  function adoptPolledSlots() {
    if (polledLoopId !== loadedLoopId) return
    lastSlots = polledSlots
    renderRows()
  }

  // Whether the picture is being held back right now. Only while the sound
  // is genuinely on its way: a fetch in flight, or a swap already scheduled.
  // If the render failed there is nothing coming, and freezing the rows on a
  // loop that will never arrive would be worse than showing the mac's
  // picture early.
  function holdingForSwap() {
    if (!wantPlaying || !srcNode) return false
    if (polledLoopId === loadedLoopId) return false
    return fetching || pendingSwap !== null
  }
  // { canvas, peaks, color } per visible row, so a resize can redraw the
  // stack without waiting for the next poll to change something.
  var rowCanvases = []

  // Two gestures on one element, arbitrated exactly. Short tap takes the row
  // round its solo/mute cycle (see nextSlotAction), long press opens the
  // action sheet. The rules that matter: a fired long press must NOT also
  // fire the tap on release; a scroll must not come back as a mute; and the
  // x inside the row must start neither.
  var HOLD_MS = 450
  var SLOP_PX = 10
  var holdTimer = null
  var holdFired = false
  var holdMoved = false
  var holdX = 0
  var holdY = 0

  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
  }

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

  function markGoing(id) {
    goingRemoveIds[id] = Date.now()
    paintDrop(id)
    paintGoingRow(id)
  }

  // A going row stops being going when it stops being DRAWN, which is
  // exactly what "will disappear soon" promised -- and not a moment before.
  // That can be a whole loop after the mac agreed, because the rows are held
  // to the loop that is audible (see adoptPolledSlots): the stem is still in
  // the mix, so the row is still there to be marked.
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
    return slot.muted ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')
  }

  // A row's tap cycle, asked for on 2026-09-27 after the first real iphone
  // session: "could we also add solo? first press is solo, then second press
  // is mute / like double tap".
  //
  //   audible, others too -> solo   toggleSlotSolo: every other row drops out
  //   soloed              -> mute   toggleSlotPreview: this row drops out too
  //   muted               -> mute   toggleSlotPreview: this row comes back
  //
  // Two verbs cover three states because the mac's own two functions do, and
  // both are the buttons already on the desktop row. Nothing new is invented
  // here and nothing about a solo is remembered -- soloed is read off the
  // mix (see RemoteSlotView.soloed), not off a mode.
  //
  // What the third press lands on is the truth of the MIX rather than a
  // fixed carousel. Unmuting this row while the others are still out leaves
  // it the only audible row again, which IS a solo -- the same mix, so the
  // same reading, and the next press mutes again. Everything comes back one
  // row at a time, a tap each, exactly as the desktop's own mute buttons
  // would do it. The one thing that restores a whole mix in one gesture is a
  // second solo of an already-soloed slot, and that is not reachable from
  // muted, so the phone does not pretend to offer it.
  function nextSlotAction(slot) {
    if (slot.muted) return 'mute'
    return slot.soloed ? 'mute' : 'solo'
  }

  function audibleRowCount() {
    var n = 0
    for (var i = 0; i < lastSlots.length; i++) {
      if (!lastSlots[i].muted) n++
    }
    return n
  }

  // Optimistic: the poll is up to 700ms behind and the row has to answer the
  // thumb now. The next poll overwrites all of it -- and while a loop swap is
  // pending the rows are held, so this paint is what he is looking at for as
  // long as a loop.
  //
  // A solo has no appearance of its own and deliberately gets none. It drops
  // every other row out of the mix, so every other row loses its colour
  // exactly as a mute does, and the one row still in colour is the picture.
  // A mark on the soloed row would be a second way of saying the same thing,
  // and it could only be drawn out of inversion or grey -- there is no spare
  // colour on this page, and nothing on it is ever allowed to fade.
  function paintSlotAction(slot, action) {
    if (action === 'solo') {
      for (var i = 0; i < lastSlots.length; i++) {
        lastSlots[i].muted = lastSlots[i].id !== slot.id
        lastSlots[i].soloed = lastSlots[i].id === slot.id
      }
      return
    }
    slot.muted = !slot.muted
    slot.soloed = !slot.muted && audibleRowCount() === 1
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
    lastSlots.forEach(function (slot) {
      var row = document.createElement('div')
      // Registered first, then classed by the one function that classes a
      // row, for the same reason the x below is: a rebuild under a pending
      // removal must come up already marked.
      rowEls[slot.id] = row
      paintGoingRow(slot.id)
      var color = rowColor(slot)

      var kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = slot.kindLabel
      kind.style.color = color

      // The name is its own cell on the first line now, and the waveform
      // is a cell on the second. They were one stacked cell when they
      // shared the middle column.
      var name = document.createElement('span')
      name.className = 'name'
      name.textContent = slot.stemName || '…'

      var stem = document.createElement('span')
      stem.className = 'stem'
      var canvas = document.createElement('canvas')
      stem.appendChild(canvas)

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

      // An unresolved row does neither gesture, matching the desktop's own
      // hasStemToActOn guard on its mute button. The row carries no click
      // listener at all, so there is no second event to suppress -- this
      // page is not allowed to suppress one (see the last-resort test).
      if (slot.stemName) {
        row.addEventListener('pointerdown', function (e) {
          // A row already on its way out has nothing left to ask it: no
          // mute, no solo, no action sheet. Guarded at BOTH ends of the
          // gesture, because a press that began before the confirming tap
          // must not complete after it.
          if (isGoing(slot.id)) return
          if (e.target.tagName === 'BUTTON') return
          holdFired = false
          holdMoved = false
          holdX = e.clientX
          holdY = e.clientY
          cancelHold()
          holdTimer = setTimeout(function () {
            holdTimer = null
            holdFired = true
            buzz()
            openActionSheet(slot)
          }, HOLD_MS)
        })
        row.addEventListener('pointermove', function (e) {
          if (holdTimer === null && !holdFired) return
          var dx = e.clientX - holdX
          var dy = e.clientY - holdY
          if (dx < 0) dx = -dx
          if (dy < 0) dy = -dy
          if (dx > SLOP_PX || dy > SLOP_PX) { holdMoved = true; cancelHold() }
        })
        // The scroll the browser stole must not come back as a mute.
        row.addEventListener('pointercancel', function () { holdMoved = true; cancelHold() })
        row.addEventListener('pointerleave', function () { holdMoved = true; cancelHold() })
        row.addEventListener('pointerup', function (e) {
          cancelHold()
          if (isGoing(slot.id)) return
          if (e.target.tagName === 'BUTTON') return
          if (holdFired || holdMoved) return
          disarmRemove()
          var next = nextSlotAction(slot)
          paintSlotAction(slot, next)
          renderRows()
          api('/api/slot-action', { slotId: slot.id, action: next })
        })
      }

      // Placed by grid-template-areas, so this order is the reading order
      // and not the layout.
      row.appendChild(kind)
      row.appendChild(name)
      row.appendChild(stem)
      row.appendChild(drop)
      rowsEl.appendChild(row)
      // After append, so the canvas has a box to measure.
      drawRowWave(canvas, slot.peaks, color)
      rowCanvases.push({ canvas: canvas, peaks: slot.peaks, color: color })
    })
    // The playhead's lane lives inside .rows and innerHTML just wiped it. It
    // is re-appended rather than rebuilt, so lineEl -- still inside it --
    // keeps pointing at the element tick() is moving.
    rowsEl.appendChild(laneEl)
  }

  // --- the stem action sheet ---------------------------------------------
  var ACTS = ${JSON.stringify(STEM_ACTIONS)}
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
    ACTS.forEach(function (act) {
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
        flash(act.a === 'duplicate' ? 'copied' : act.a === 'adjacent' ? 'nearby' : 'rolling')
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
    if (!state.discoverOpen) {
      lastSlots = []
      polledSlots = []
      polledLoopId = null
      polledLoopBars = 0
      goingRemoveIds = Object.create(null)
      disarmRemove()
      renderRows()
      emptyEl.hidden = true
      loopEl.hidden = true
      // Don't come back from a closed discover with a sheet still up.
      closeKindSheet()
      closeActionSheet()
      macEl.textContent = ''
      currentLoopId = null
      loadedLoopId = null
      loadedLoopBars = 0
      audioBuffer = null
      // Unconditionally, and BEFORE the wantPlaying check: stopSource is
      // the only thing that undoes a scheduled swap completely -- cancelling
      // the pending source alone would leave the playing one's stop(at)
      // still scheduled, and it would fall silent at the boundary with
      // nothing taking over. It is idempotent with nothing playing.
      stopSource()
      if (wantPlaying) { wantPlaying = false; setPlayLabel() }
      msgEl.textContent = 'open discover on the mac'
      return
    }
    if (msgEl.textContent === 'open discover on the mac') restStatus()
    // state.playing is the MAC's transport, shown and never obeyed.
    macEl.textContent = state.playing ? 'mac playing' : ''
    setPlayLabel()
    currentLoopId = state.loopId
    // Kept whether or not it is drawn: this is what adoptPolledSlots will
    // draw when the sound catches up with it.
    polledSlots = state.slots
    polledLoopId = state.loopId
    // Guarded rather than trusted: a length the mac does not know is 0 there
    // and 0 here, and 0 means the whole loop. undefined fails this test too,
    // so a page served by an older mac degrades to the end-of-loop handover
    // instead of to arithmetic on nothing.
    polledLoopBars = state.loopBars > 0 ? state.loopBars : 0
    if (wantPlaying && currentLoopId !== loadedLoopId) loadLoop()

    // Nothing to roll, play or keep until there is a slot -- and the add
    // row is then the only thing on screen, which is the point.
    emptyEl.hidden = state.slots.length > 0
    loopEl.hidden = state.slots.length === 0
    // The one exception to "the renderer pushes and the phone draws": while
    // the sound is on its way, the rows stay on the loop that is sounding.
    // renderRows is still called either way -- an optimistic mute painted
    // between polls has to survive a poll that changed nothing.
    if (!holdingForSwap()) lastSlots = state.slots

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
  }

  document.getElementById('roll-all').addEventListener('click', function () { api('/api/roll', {}) })
  playEl.addEventListener('click', function () {
    if (wantPlaying) {
      wantPlaying = false
      stopSource()
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
    if (audioBuffer && loadedLoopId === currentLoopId) startSource()
    else loadLoop()
  })
  // Keeping is the one thing on this page that feels irreversible, and the
  // thumb doing it is the same thumb tapping rows to mute them. Same
  // arbitration shape as a row's long press, so there is one mental model
  // on the page and not two.
  var KEEP_MS = 700
  var keepTimer = null
  var keepX = 0
  var keepY = 0
  var keepFillEl = document.getElementById('keep-fill')
  var keepEl = document.getElementById('keep')

  function cancelKeep() {
    if (keepTimer) { clearTimeout(keepTimer); keepTimer = null }
    keepFillEl.className = 'fill'
    keepFillEl.style.width = '0'
  }

  keepEl.addEventListener('pointerdown', function (e) {
    keepX = e.clientX
    keepY = e.clientY
    cancelKeep()
    keepFillEl.className = 'fill run'
    keepFillEl.style.width = '100%'
    keepTimer = setTimeout(function () {
      keepTimer = null
      buzz()
      api('/api/keep', {})
      flash('kept')
      cancelKeep()
    }, KEEP_MS)
  })
  keepEl.addEventListener('pointermove', function (e) {
    if (keepTimer === null) return
    var dx = e.clientX - keepX
    var dy = e.clientY - keepY
    if (dx < 0) dx = -dx
    if (dy < 0) dy = -dy
    if (dx > SLOP_PX || dy > SLOP_PX) cancelKeep()
  })
  keepEl.addEventListener('pointerup', cancelKeep)
  keepEl.addEventListener('pointerleave', cancelKeep)
  keepEl.addEventListener('pointercancel', cancelKeep)

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
