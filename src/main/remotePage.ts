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
/* The playhead, inside .rows (which is position: relative). It comes after
 * the rows in the DOM and is absolutely positioned, so no z-index is
 * needed, and pointer-events: none plus the total absence of any listener
 * are the two independent reasons it is an indicator and not a seek. */
.line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #c56164;
  pointer-events: none;
}
.row {
  display: grid;
  grid-template-columns: 84px 1fr 44px;
  align-items: center;
  column-gap: 10px;
  min-height: 50px;
  margin-bottom: 6px;
  padding: 0 0 0 10px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
  /* A 450ms press on text raises ios's selection callout and magnifier.
   * Suppressed here and not in js, because remotePage.test.ts asserts the
   * script never contains preventDefault. */
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.row:active { background: #161616; }
.row .kind { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .stem { min-width: 0; padding: 6px 0; }
.row .name {
  display: block;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row canvas { display: block; width: 100%; height: 18px; margin-top: 3px; }
/* 44px wide, 48px tall: it keeps its own tap target even though the row's
 * own minimum is 50px. A border-left rather than a box, so the row still
 * reads as one thing. */
button.drop {
  width: 44px;
  height: 48px;
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
    <div class="rows" id="rows"><div class="line" id="line" hidden></div></div>
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
  var lineEl = document.getElementById('line')
  var macEl = document.getElementById('mac')

  // The phone plays the loop ITSELF. The Mac is not touched in either
  // direction -- "phone audio distinct from the app", Elling, 2026-09-26 --
  // so both playing at once is intended, not a bug. macEl says so when it
  // happens.
  var audioCtx = null
  var audioBuffer = null
  var srcNode = null
  var loadedLoopId = null
  var currentLoopId = null
  var startedAt = 0
  var wantPlaying = false
  var fetching = false

  function setPlayLabel() {
    playEl.textContent = wantPlaying ? 'stop' : 'play'
    playEl.className = wantPlaying ? 'big on' : 'big'
  }

  function stopSource() {
    if (srcNode) {
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

  function loadLoop() {
    if (fetching || !wantPlaying || !token || !audioCtx) return
    if (!currentLoopId) { msgEl.textContent = 'nothing to play'; return }
    if (currentLoopId === loadedLoopId) return
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
          audioBuffer = buf
          loadedLoopId = got.id
          restStatus()
          if (wantPlaying) startSource()
        })
      })
      .catch(function () { msgEl.textContent = 'render failed' })
      .then(function () { fetching = false })
  }

  // The progress line, driven by the phone's OWN audio clock. Nothing about
  // its position comes from the Mac: no position messages, no clock sync.
  // It spans the slot-row stack now that there is no master waveform to sit
  // over -- and it is still unclickable in two independent ways: .line is
  // pointer-events:none, and no listener of any kind is attached to it. It
  // is an indicator. Do not add a seek.
  function tick() {
    if (srcNode && audioBuffer && audioCtx && audioBuffer.duration > 0) {
      var t = (audioCtx.currentTime - startedAt) % audioBuffer.duration
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

  // --- the rows ----------------------------------------------------------
  // Removing has no undo on the phone (undo stayed on the mac on purpose),
  // so it takes two taps: the first arms this row, the second does it. The
  // arming lapses on its own rather than sitting armed in a pocket, and any
  // other tap cancels it.
  var lastSlots = []
  var lastRowsKey = null
  // { canvas, peaks, color } per visible row, so a resize can redraw the
  // stack without waiting for the next poll to change something.
  var rowCanvases = []

  // Two gestures on one element, arbitrated exactly. Short tap mutes, long
  // press opens the action sheet. The rules that matter: a fired long press
  // must NOT also fire the tap on release; a scroll must not come back as a
  // mute; and the x inside the row must start neither.
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

  function disarmRemove() {
    armedRemoveId = null
    if (armedRemoveTimer) { clearTimeout(armedRemoveTimer); armedRemoveTimer = null }
  }

  function armRemove(id) {
    disarmRemove()
    armedRemoveId = id
    armedRemoveTimer = setTimeout(function () {
      armedRemoveId = null
      renderRows()
    }, 4000)
  }

  function rowColor(slot) {
    // "gray means quieter/off" (StemWaveformRow.tsx). Mute suppresses the
    // colour; it never dims it. #6a6a6a is --ra-text-3, the exact grey the
    // desktop's always-visible layer is drawn in. A row with no sound type
    // yet has no colour to spend either.
    return slot.muted ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')
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
    // key stringifies the whole slot objects, so it now covers muted and
    // peaks too -- without that the optimistic mute paint below would be
    // swallowed by this very guard.
    var key = JSON.stringify(lastSlots) + '|' + armedRemoveId
    if (key === lastRowsKey) return
    lastRowsKey = key
    rowsEl.innerHTML = ''
    rowCanvases = []
    lastSlots.forEach(function (slot) {
      var row = document.createElement('div')
      row.className = 'row'
      var color = rowColor(slot)

      var kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = slot.kindLabel
      kind.style.color = color

      var stem = document.createElement('span')
      stem.className = 'stem'
      var name = document.createElement('span')
      name.className = 'name'
      name.textContent = slot.stemName || '…'
      var canvas = document.createElement('canvas')
      stem.appendChild(name)
      stem.appendChild(canvas)

      var armed = armedRemoveId === slot.id
      var drop = document.createElement('button')
      drop.className = armed ? 'drop armed' : 'drop'
      drop.textContent = armed ? 'sure' : 'x'
      drop.addEventListener('click', function () {
        if (armedRemoveId === slot.id) {
          disarmRemove()
          renderRows()
          api('/api/remove-slot', { slotId: slot.id })
          flash('removed')
          return
        }
        armRemove(slot.id)
        renderRows()
      })

      // An unresolved row does neither gesture, matching the desktop's own
      // hasStemToActOn guard on its mute button. The row carries no click
      // listener at all, so there is no second event to suppress -- this
      // page is not allowed to suppress one (see the last-resort test).
      if (slot.stemName) {
        row.addEventListener('pointerdown', function (e) {
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
          if (e.target.tagName === 'BUTTON') return
          if (holdFired || holdMoved) return
          disarmRemove()
          // Optimistic: the poll is up to 700ms behind and the row must
          // answer the thumb now. The next poll overwrites it either way.
          slot.muted = !slot.muted
          renderRows()
          api('/api/slot-action', { slotId: slot.id, action: 'mute' })
        })
      }

      row.appendChild(kind)
      row.appendChild(stem)
      row.appendChild(drop)
      rowsEl.appendChild(row)
      // After append, so the canvas has a box to measure.
      drawRowWave(canvas, slot.peaks, color)
      rowCanvases.push({ canvas: canvas, peaks: slot.peaks, color: color })
    })
    // The playhead lives inside .rows and innerHTML just wiped it. It is
    // re-appended rather than rebuilt, so lineEl keeps pointing at the
    // element tick() is moving.
    rowsEl.appendChild(lineEl)
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
      audioBuffer = null
      if (wantPlaying) { wantPlaying = false; stopSource(); setPlayLabel() }
      msgEl.textContent = 'open discover on the mac'
      return
    }
    if (msgEl.textContent === 'open discover on the mac') restStatus()
    // state.playing is the MAC's transport, shown and never obeyed.
    macEl.textContent = state.playing ? 'mac playing' : ''
    setPlayLabel()
    currentLoopId = state.loopId
    if (wantPlaying && currentLoopId !== loadedLoopId) loadLoop()

    // Nothing to roll, play or keep until there is a slot -- and the add
    // row is then the only thing on screen, which is the point.
    emptyEl.hidden = state.slots.length > 0
    loopEl.hidden = state.slots.length === 0
    // A slot that vanished from under an armed remove must not leave the
    // arming pointed at an id that no longer exists.
    if (armedRemoveId !== null) {
      var stillThere = state.slots.some(function (s) { return s.id === armedRemoveId })
      if (!stillThere) disarmRemove()
    }
    // A slot that vanished from under an open sheet must not leave it
    // pointing at an id the mac no longer has -- same rule as an armed
    // remove.
    if (actSlot !== null) {
      var actStillThere = state.slots.some(function (s) { return s.id === actSlot.id })
      if (!actStillThere) closeActionSheet()
    }
    lastSlots = state.slots
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
