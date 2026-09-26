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
 * same-origin fetch for the seven API routes. No images, no frames, no
 * forms, no base tag. The kind picker added two routes and no new kind of
 * resource, so this is unchanged by it and must stay that way. */
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
* { box-sizing: border-box; border-radius: 0; }
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
* { box-sizing: border-box; border-radius: 0; }
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
.kept-name { font-size: 10px; color: #8f8f8f; min-height: 16px; }
.rows { margin: 20px 0; }
.empty { margin: 20px 0; font-size: 11px; color: #8f8f8f; }
.track {
  position: relative;
  height: 22px;
  margin: 2px 0 18px;
  border-top: 1px solid #222222;
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
.slot { display: flex; gap: 6px; margin-bottom: 6px; }
.row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 14px 10px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
  font: inherit;
}
.row:active { background: #161616; }
.row .kind { width: 84px; flex: none; font-size: 11px; }
.row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.drop {
  width: 78px;
  flex: none;
  padding: 14px 4px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #6a6a6a;
  font: inherit;
  font-size: 10px;
}
button.drop:active { background: #161616; }
button.drop.armed { background: #ededed; border-color: #ededed; color: #050505; }
.actions { display: flex; gap: 8px; }
button.big {
  flex: 1;
  padding: 18px 8px;
  background: transparent;
  border: 1px solid #3a3a3a;
  color: #ededed;
  font: inherit;
  font-size: 12px;
}
button.big:active { background: #161616; }
button.big.on { background: #ededed; color: #050505; }
button.big.dim { border-color: #222222; color: #5a5a5a; }
.picker { margin-top: 26px; padding-top: 18px; border-top: 1px solid #222222; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
.chips.trait { margin-bottom: 10px; }
button.chip {
  flex: 1 1 30%;
  min-width: 96px;
  padding: 16px 4px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #8f8f8f;
  font: inherit;
  font-size: 11px;
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
    <div class="eyebrow">sssketch</div>
    <h1>side quest</h1>
    <div class="eyebrow" id="counts">kept 0 · rolled 0</div>
    <div class="kept-name" id="kept-name"></div>
    <!-- Zero slots is a START, not an error. It says what to do next and
         the thing to do it with is directly below it. -->
    <div class="empty" id="empty" hidden>pick what you want below, then add it</div>
    <div class="rows" id="rows"></div>
    <!-- Hidden with nothing in discover: roll all, play and keep all act on
         a loop that does not exist yet, and three dead buttons are what made
         the first screen feel like a dead end. They come back on the first
         add. -->
    <div id="loop" hidden>
      <div class="track" id="track"><div class="line" id="line" hidden></div></div>
      <div class="actions">
        <button class="big" id="roll-all">roll all</button>
        <button class="big" id="play">play</button>
        <button class="big" id="keep">keep</button>
      </div>
    </div>
    <div class="picker" id="picker">
      <div class="eyebrow">add a stem that is</div>
      <div class="chips" id="chips-mask"></div>
      <div class="chips trait" id="chips-trait"></div>
      <div class="actions">
        <button class="big dim" id="add-slot">add slot</button>
      </div>
    </div>
    <div class="eyebrow" id="mac"></div>
    <div class="msg" id="msg"></div>
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
  var pickerEl = document.getElementById('picker')
  var maskChipsEl = document.getElementById('chips-mask')
  var traitChipsEl = document.getElementById('chips-trait')
  var addEl = document.getElementById('add-slot')
  var countsEl = document.getElementById('counts')
  var keptNameEl = document.getElementById('kept-name')
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
          msgEl.textContent = ''
          if (wantPlaying) startSource()
        })
      })
      .catch(function () { msgEl.textContent = 'render failed' })
      .then(function () { fetching = false })
  }

  // The progress line, driven by the phone's OWN audio clock. Nothing about
  // its position comes from the Mac: no position messages, no clock sync.
  // Unclickable in two independent ways -- .track is pointer-events:none, and
  // no listener of any kind is attached to it or to the line. It is an
  // indicator. Do not add a seek.
  function tick() {
    if (srcNode && audioBuffer && audioCtx && audioBuffer.duration > 0) {
      var t = (audioCtx.currentTime - startedAt) % audioBuffer.duration
      lineEl.style.left = ((t / audioBuffer.duration) * 100) + '%'
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
      if (msgEl.textContent === text) msgEl.textContent = ''
    }, 1400)
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
    flash('adding')
  })

  // --- the rows ----------------------------------------------------------
  // Removing has no undo on the phone (undo stayed on the mac on purpose),
  // so it takes two taps: the first arms this row, the second does it. The
  // arming lapses on its own rather than sitting armed in a pocket, and any
  // other tap cancels it.
  var lastSlots = []
  var lastRowsKey = null
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

  function renderRows() {
    // Rebuilt only when something actually changed. The poll runs every
    // 700ms and wiping the rows under a thumb mid-tap loses the tap.
    var key = JSON.stringify(lastSlots) + '|' + armedRemoveId
    if (key === lastRowsKey) return
    lastRowsKey = key
    rowsEl.innerHTML = ''
    lastSlots.forEach(function (slot) {
      var wrap = document.createElement('div')
      wrap.className = 'slot'
      var b = document.createElement('button')
      b.className = 'row'
      var kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = slot.kindLabel
      kind.style.color = TYPE_COLORS[slot.soundType] || '#8f8f8f'
      var name = document.createElement('span')
      name.className = 'name'
      name.textContent = slot.stemName || '…'
      b.appendChild(kind)
      b.appendChild(name)
      b.addEventListener('click', function () {
        disarmRemove()
        renderRows()
        api('/api/roll', { slotId: slot.id })
      })
      var armed = armedRemoveId === slot.id
      var drop = document.createElement('button')
      drop.className = armed ? 'drop armed' : 'drop'
      drop.textContent = armed ? 'sure' : 'remove'
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
      wrap.appendChild(b)
      wrap.appendChild(drop)
      rowsEl.appendChild(wrap)
    })
  }

  function render(state) {
    countsEl.textContent = 'kept ' + state.kept + ' · rolled ' + state.rolled
    keptNameEl.textContent = state.lastKeptName ? 'kept · ' + state.lastKeptName : ''
    if (!state.discoverOpen) {
      lastSlots = []
      disarmRemove()
      renderRows()
      emptyEl.hidden = true
      loopEl.hidden = true
      pickerEl.hidden = true
      macEl.textContent = ''
      currentLoopId = null
      loadedLoopId = null
      audioBuffer = null
      if (wantPlaying) { wantPlaying = false; stopSource(); setPlayLabel() }
      msgEl.textContent = 'open discover on the mac'
      return
    }
    if (msgEl.textContent === 'open discover on the mac') msgEl.textContent = ''
    // state.playing is the MAC's transport, shown and never obeyed.
    macEl.textContent = state.playing ? 'mac playing' : ''
    setPlayLabel()
    currentLoopId = state.loopId
    if (wantPlaying && currentLoopId !== loadedLoopId) loadLoop()

    pickerEl.hidden = false
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
  document.getElementById('keep').addEventListener('click', function () { api('/api/keep', {}) })

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
