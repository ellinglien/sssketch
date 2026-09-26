// src/main/remotePage.ts
import { SILKSCREEN_REGULAR_WOFF2_BASE64 } from './remoteFont'

/** The page's own Content-Security-Policy, sent as a header by
 * remoteServer.ts. Everything the page needs and nothing it does not:
 * inline style and script (there is no bundler here and no second file to
 * fetch), data: fonts (the Silkscreen face is embedded -- see remoteFont.ts
 * and commit 25ab55d for why that combination has to be spelled out), and
 * same-origin fetch for the five API routes. No images, no frames, no
 * forms, no base tag. */
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
// spent only on the slot rows, which carry a stem's own sound type -- the
// one thing on this page that carries audio information. Everything else
// is monochrome, sharp-cornered, lowercase.
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
.row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  width: 100%;
  text-align: left;
  padding: 14px 10px;
  margin-bottom: 6px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
  font: inherit;
}
.row:active { background: #161616; }
.row .kind { width: 84px; flex: none; font-size: 11px; }
.row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
    <div class="msg">enter the code shown on the mac</div>
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
    <div class="rows" id="rows"></div>
    <div class="actions">
      <button class="big" id="roll-all">roll all</button>
      <button class="big" id="play">play</button>
      <button class="big" id="keep">keep</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>

</div>
<script>
(function () {
  var TYPE_COLORS = ${JSON.stringify(TYPE_COLORS)}
  var token = null
  try { token = localStorage.getItem('sssketch-remote-token') } catch (e) { token = null }

  var pairEl = document.getElementById('pair')
  var appEl = document.getElementById('app')
  var rowsEl = document.getElementById('rows')
  var countsEl = document.getElementById('counts')
  var keptNameEl = document.getElementById('kept-name')
  var msgEl = document.getElementById('msg')
  var pairMsgEl = document.getElementById('pair-msg')
  var playEl = document.getElementById('play')

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

  document.getElementById('pair-go').addEventListener('click', function () {
    var code = document.getElementById('code').value
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
  })

  function render(state) {
    countsEl.textContent = 'kept ' + state.kept + ' · rolled ' + state.rolled
    keptNameEl.textContent = state.lastKeptName ? 'kept · ' + state.lastKeptName : ''
    if (!state.discoverOpen) {
      rowsEl.innerHTML = ''
      msgEl.textContent = 'open discover on the mac'
      return
    }
    msgEl.textContent = ''
    playEl.textContent = state.playing ? 'stop' : 'play'
    playEl.className = state.playing ? 'big on' : 'big'

    rowsEl.innerHTML = ''
    state.slots.forEach(function (slot) {
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
        api('/api/roll', { slotId: slot.id })
      })
      rowsEl.appendChild(b)
    })
  }

  document.getElementById('roll-all').addEventListener('click', function () { api('/api/roll', {}) })
  playEl.addEventListener('click', function () {
    api('/api/transport', { play: playEl.textContent === 'play' })
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
