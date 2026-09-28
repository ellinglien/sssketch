# One way out through the gateway, when the wifi will not carry it

Date: 2026-09-28
Status: designed, not built. Input: `docs/superpowers/specs/2026-09-28-phone-connection-research.md`.
Decision already made by Elling — *"i like the cloudflare idea.. can we implement that too?"* — so
this document does not re-argue it. It designs it, and it carries the research's five objections
forward as constraints rather than as caveats.

Plan: `docs/superpowers/plans/2026-09-28-phone-tunnel-fallback.md`.

---

## 0. What this is, in one paragraph

The LAN path stays exactly as it is and stays the default. Behind the `not connecting?`
disclosure that shipped this morning in `af9899b`/`a8746a1`, one more line appears: a way to
reach this Mac that leaves through the gateway instead of across the wifi. It is a
`cloudflared` quick tunnel, spawned on demand, behind a one-function seam so the provider can be
replaced. It is off by default, explicitly started, explicitly consented to once, and it stops
when the remote stops, when the Mac sleeps, and when the app quits. Over that link the phone is a
**controller only** — no loop wav, no per-stem audio — and both the page and the server enforce
that, for different reasons.

**Why build it when it is his network that is broken:** because client isolation is common enough
that other people will hit it (guest SSIDs, extenders, hotels, plenty of ISP boxes), and today a
user who does gets a spinner, three honest sentences, and no way forward. This is the way
forward. It is also the only thing on the research's list that makes the phone page a **secure
context**, which is what `Screen Wake Lock` needs — the phone screen currently sleeps mid-session
and the page cannot stop it.

---

## 1. The five objections, as constraints

The research recorded five real objections to Cloudflare quick tunnels. Each one becomes a line in
this design rather than a footnote.

| objection (research §5) | what it forces here |
|---|---|
| the terms say **testing and development only**, no SLA | the tunnel can never be the default, can never auto-start, and can never be something the app silently falls back to. When it fails the app degrades to exactly what ships today. §2, §9 |
| the CDN terms reserve the right to limit *"pictures, audio files, or other large files"* | **no audio over the tunnel, at all.** `/api/loop` (up to 11.3 MB) and `/api/stem` (~640 KB × 12 ≈ 7.7 MB) are refused server-side on the tunnel path, and the page does not even ask. §7 |
| `*.trycloudflare.com` is widely DNS-blocked after malware abuse | the failure has to be legible: "the phone could not resolve that address" is a different sentence from "the tunnel did not start", and the modal must be able to say both. And the seam exists so that a provider whose hostnames are not poisoned can replace it. §3, §9 |
| quick tunnels force QUIC (`cloudflared#1609`), so a network blocking outbound UDP fails | a start failure is a normal, expected outcome with its own copy, not an error dialog. The LAN path is untouched by it. §4.4, §9 |
| installing `cloudflared` binds the user to Cloudflare's terms | **this is the argument that decides bundle-versus-download.** §4 |

---

## 2. The seam

One function. Everything provider-specific lives behind it.

`src/shared/publicTunnel.ts` — types only, no node imports, so it is importable from anywhere and
testable without a process:

```ts
/** A public way in to one local port, while it lasts. */
export interface PublicTunnel {
  /** Scheme and host, no path, no trailing slash:
   * 'https://four-random-words.trycloudflare.com'. HTTPS is not optional --
   * see §5 (the capability token rides in a fragment) and §8 (secure
   * context). */
  readonly origin: string
  /** The host alone, lowercased, no port. The ONE literal the Host guard
   * compares against -- see §6. */
  readonly host: string
  /** Kills the provider and resolves once it is gone. Idempotent, and safe
   * to call after onClosed has already fired. */
  stop(): Promise<void>
}

export interface TunnelOpenOptions {
  /** Reject rather than hang. Nothing may be left running when it rejects. */
  timeoutMs: number
  /** Fires EXACTLY ONCE, when the path stops working for any reason the
   * provider can see -- crash, exit, a reconnect it gave up on. Never fires
   * after stop() has been called. */
  onClosed: (reason: string) => void
}

export interface TunnelProvider {
  /** For the log line and the modal: 'cloudflare quick tunnel'. */
  readonly label: string
  /** Is the provider usable right now, with no network call? For
   * cloudflared: is the verified binary on disk. */
  ready(): Promise<boolean>
  open(port: number, options: TunnelOpenOptions): Promise<PublicTunnel>
}
```

And the one call site's entry point, `src/main/publicTunnel.ts`:

```ts
export function tunnelProvider(): TunnelProvider  // returns the cloudflared one
```

**What a second implementation has to satisfy.** This list is the contract, and it is written
down because the research's whole reason for a seam is that free tunnels change the deal:

1. **A browser-trusted `https://` origin.** Not `http://`. `bore.pub` is disqualified by this line
   alone — the research verified it refuses HTTPS. Without HTTPS there is no secure context, the
   fragment-carried token is sent in clear, and the wake-lock win disappears.
2. **A host that is one stable literal for the tunnel's whole life.** The Host guard compares a
   string; a provider that rotates hostnames mid-session, or that routes a wildcard, cannot be
   admitted safely.
3. **`onClosed` fires exactly once and promptly.** The guard stops admitting the hostname the
   instant it fires (§6), so a provider that dies silently leaves the guard admitting a name that
   no longer points at us — which is not a rebinding hole (nothing routes there) but is a stale
   accept, and staleness in a guard is how holes start.
4. **`stop()` leaves no process.** §4.4.
5. **No credential embedded in the source.** This is the TURN lesson from the research §4:
   *"in a GPL-3 app any embedded credential is a published credential."* A provider requiring an
   API key is only admissible if the key is the *user's own*, entered by them.
6. **It carries roughly 1.5 requests per second per connected phone, indefinitely, unmetered.**
   The page polls every 700 ms. ngrok's 20,000 requests/month is spent in under four hours; that
   is why ngrok is not behind this seam and never will be.
7. **It must not require the phone page's transport to change.** Same-origin polling, `connect-src
   'self'`, one HTTP server. A provider that needs a relayed WebSocket is a different plan (the
   research's Shape B), and swapping to it is not a seam change — say so honestly rather than
   pretending the seam covers it.

---

## 3. Getting the binary — the decision with the largest hidden cost

### 3.1 The two options, costed

**Bundle it**, the rubberband way (`electron-builder.yml`'s `extraResources` + `signIgnore`,
`build/afterPack.js`, `scripts/vendor-*.sh`, and a step in `.github/workflows/release.yml`):

- +37.6 MiB per DMG (the research measured the 2026.9.3 arm64 binary), shipped to 100% of users
  for a feature a small minority will use. Each DMG is single-arch, so it is +37.6 MiB per file,
  not +75.
- **It is not quite the rubberband pattern, and the difference is the expensive part.**
  `afterPack.js` *signs* rubberband with our Developer ID, because brew's copy is ad-hoc signed.
  `cloudflared` arrives **Developer-ID signed by Cloudflare Inc. (68WVV388M8), hardened runtime,
  secure timestamp** (research §5). Re-signing it would strip that. So the correct handling is
  *signIgnore it but do not sign it in afterPack* — a third variant of a hook whose own doc
  comment records a real "sssketch is damaged and can't be opened" Gatekeeper rejection caused by
  getting this ordering wrong once already.
- It touches `electron-builder.yml`, `build/afterPack.js` and `.github/workflows/release.yml` —
  the three files with the worst surprise-at-release-time record in this repo (the arch-name feed
  bug, the afterPack/afterSign ordering, the x64 rubberband bottle countdown).
- And it makes Cloudflare's *"your installation of cloudflared software constitutes a symbol of
  your signature indicating that you accept the terms"* true for every person who installs
  sssketch, whether or not they ever open the phone remote.

**Download on first use**, into `app.getPath('userData')`:

- Nothing in the signed build changes. `electron-builder.yml`, `build/afterPack.js` and
  `.github/workflows/release.yml` are **untouched**. Stated explicitly because the brief asks: a
  release-time surprise is expensive here, and this recommendation buys zero of them.
- The DMG does not grow. Nobody who never opens the phone remote ever has a Cloudflare binary on
  their machine.
- It needs a trust story, and it has a good one: **the thing being downloaded is already signed
  and notarized by its own vendor**, which is precisely what killed the Gradio-style runtime
  download in the research's reading (*"on Apple Silicon every executable must be at least ad-hoc
  signed to run at all"*). It is. So the trust story is: pinned version, pinned SHA-256 of the
  release asset, HTTPS to Cloudflare's own GitHub releases, and — after extraction and before the
  first exec — `codesign --verify --strict` plus an identity check that the team identifier is
  `68WVV388M8`. Three independent checks, two of which Apple enforces anyway.
- It puts a network fetch in the middle of the flow the user is struggling with. **This objection
  is weaker here than it sounds and it is worth saying why:** client isolation is a layer-2 filter
  between wireless *clients*. It does not touch the path to the gateway or to the internet — the
  research's own evidence is that the gateway answers both devices fine. The flow that is broken
  is the LAN flow. The WAN flow is the one that works, and it is the one this download uses. It is
  still a visible step and it still deserves its own copy and a cancel button (§8.2), not a
  hidden stall.
- No redistribution of someone else's binary at all, which makes the licence question moot rather
  than merely easy.

### 3.2 Licence

`cloudflared` is **Apache-2.0**. Apache-2.0 is one-way compatible with GPL-3, and in any case the
app *spawns a separate executable over argv* rather than linking — mere aggregation, the identical
argument `scripts/vendor-rubberband.sh`'s own doc comment already makes for a GPLv2+ CLI. So
bundling would be clean. **Downloading makes it cleaner still: we redistribute nothing.** The
user's machine fetches it from Cloudflare, under Cloudflare's terms, after being told so.

### 3.3 Recommendation

**Download on first use.** Three reasons, in order of weight:

1. **It makes the consent real.** Objection 5 is that bundling silently binds users to a
   third-party contract. A feature whose entire design is "off by default, explicitly started"
   should not have already installed Cloudflare's software on every user's disk before they have
   heard of it. Fetching it *after* the disclosure is read and `turn on` is pressed is the same
   decision, made honestly.
2. **It keeps the signed, notarized build untouched.** Zero changes to `electron-builder.yml`,
   `build/afterPack.js`, `.github/workflows/release.yml`. Given this repo's history, that is worth
   more than the 37.6 MiB.
3. **The objection that normally kills runtime downloads does not apply**, because the binary is
   vendor-signed and notarized.

**What would change my mind, specifically:**

- **A real download-and-exec test on a clean Mac showing Gatekeeper or the quarantine attribute
  blocking the spawn.** A file written by node's `fs` gets no `com.apple.quarantine` xattr (that
  is LaunchServices' doing, for downloads made by apps that opt in), and a notarized Mach-O passes
  assessment either way — but I have not run it, and this is the single test that flips the
  decision. If it fails, bundle it: the packaging path is known, and §3.1 says exactly which
  variant of the afterPack pattern it needs.
- **Cloudflare ceasing to publish a plain, checksummable macOS release asset** over HTTPS.
- **Pin rot proving worse than expected.** A pinned version Cloudflare later withdraws makes the
  feature stop working for new users. Mitigation: the version and hash live in one constant
  (`src/shared/cloudflaredRelease.ts`) with the date they were checked beside them, and the
  failure message names the pin rather than showing a spinner. If that turns out to need attention
  more than once or twice a year, bundling becomes the cheaper maintenance.
- **Elling preferring one fewer moving part.** This is a taste call as much as a technical one and
  it is his app.

---

## 4. Process lifecycle

### 4.1 Spawn and parse

```
<binary> tunnel --url http://127.0.0.1:7373 --no-autoupdate
```

`--no-autoupdate` is not optional: a bundled-or-cached binary that rewrites itself invalidates the
pinned SHA-256 and the signature check that was done against it.

`cloudflared` prints the assigned hostname to **stderr**, inside a boxed banner. The parser is pure
and lives in `src/shared/publicTunnel.ts`:

```ts
export function parseQuickTunnelUrl(output: string): string | null
```

It accepts exactly `https://<label>.trycloudflare.com` where `<label>` is one or more of
`[a-z0-9-]`, returns the origin lowercased with no trailing slash, and returns `null` for
everything else. It accumulates across chunks the way `engineProcess.ts` accumulates
`stderrBuffer` — for exactly the same documented reason, that OS pipe buffering splits one logical
write across several `data` events, and checking only the latest chunk spuriously times out on a
healthy start.

The provider-specific hostname shape lives **here, in the parser**, and nowhere else. The Host
guard (§6) never learns the string `trycloudflare.com`; it compares a literal it was handed. That
separation is what lets a second provider drop in without touching the security code.

### 4.2 Readiness

Resolve when `parseQuickTunnelUrl` returns non-null. Reject on `error`, on early `exit`, and on a
timeout of **20 seconds** — shorter than `engineProcess.ts`'s 45 s because there is no Rosetta AOT
translation and no Gatekeeper first-run bundle evaluation to pay for, and because a person is
watching a modal. On every rejection path, `SIGKILL` the child before rejecting.

### 4.3 Health, crash, sleep, and the URL changing

- **Health** is process liveness and nothing more. If the process is alive the desktop says
  `tunnel on`; when it exits the desktop says `tunnel stopped`. There is deliberately no
  reachability probe: an HTTPS page cannot probe the LAN origin (mixed content), the Mac cannot
  tell whether the *phone's* DNS resolves `trycloudflare.com`, and inventing a green light that
  can be wrong is the Ableton Link peer-count mistake the research names.
- **Crash** → `onClosed` fires → the tunnel hostname is cleared from the guard immediately, the
  capability grant is revoked, the renderer is told, the modal says `tunnel stopped`. **No
  automatic restart.** A restart mints a new hostname *and* a new token, which silently invalidates
  the QR code the user is looking at. Restarting is a button.
- **Sleep** → `powerMonitor.on('suspend')` **stops the tunnel**. A laptop should not close its lid
  with an internet-facing door open that its owner has forgotten about, and sleep stops playback
  anyway, so the cost is nil. On resume the modal says `tunnel stopped on sleep`, which is honest
  and requires no probe.
- **The URL changing** only happens across tunnel restarts — a quick tunnel's hostname is fixed for
  the life of the process. On restart the modal redraws the QR from the new origin and the new
  token; any phone paired to the old one is gone. Say that in the copy (`the old link stops
  working`), do not try to migrate it.
- **Idle** → if no tunnelled request has arrived for **two hours**, stop the tunnel. The page polls
  every 700 ms while it is open, so idle means the page is closed, and two hours of a closed page
  is a forgotten door. Pure logic (`shouldStopIdleTunnel(lastSeenAt, now)`), so it is TDD'd.

### 4.4 It must die with the app — and the orphan problem is already documented here

There is a known orphan in this project: a stray engine survived with PPID 1 and held the audio
device. A stray *tunnel* is strictly worse, because it holds a door to the internet open. Four
layers, and none of them alone is sufficient:

1. **No `detached`.** Spawn with the default (`detached: false`), so the child is in the app's
   process group and does not survive a group signal.
2. **Every teardown path kills it.** `stopTunnel()` sends `SIGTERM`, waits 2 s, then `SIGKILL`.
   It is called from: the `stop tunnel` button; `stopPhoneRemote()` (so turning the remote off
   takes the tunnel with it); `app.on('will-quit')` (where `stopPhoneRemote()` already lives);
   `powerMonitor` suspend; and the idle timer.
3. **A last-ditch synchronous kill on `process.on('exit')`** in main, which is the only hook that
   still runs when Electron is tearing down without a clean quit.
4. **A pidfile and a reaper, which is the layer that actually closes the crash case.** On spawn,
   write `{ pid, startedAt, binaryPath }` to `<userData>/cloudflared/running.json`; delete it on a
   clean stop. On the **next app start**, if that file exists, check whether the pid is alive *and*
   whether its command matches our binary path (`ps -p <pid> -o comm=`) — both, so a recycled pid
   belonging to something else is never killed — and if so, kill it and delete the file. This is
   the standard shape and it is the only one that survives a hard crash of the whole app.

**One thing worth stating so it is not over-claimed:** a stray `cloudflared` pointed at a port with
nothing listening is a 502, not an exposure. The exposure appears only if the app restarts and the
remote is switched on again underneath it. The reaper runs at start, before any of that, so the
window does not open. But the residual risk is bounded even without it, and saying so is more
useful than pretending every stray is a breach.

---

## 5. The security model

This is the part that must not be hand-waved, so it is settled here in full.

### 5.1 What is wrong with today's model on a public URL

Today: four characters from a 32-symbol alphabet (2²⁰ ≈ 1.05 M), five attempts, then pairing is
closed for the session. On a LAN that is proportionate — the attacker has to already be on the
wifi. On a public URL two things break at once:

- 2²⁰ is not the right order of magnitude for an internet-facing endpoint. The W3C TAG's
  *Good Practices for Capability URLs* suggests 120+ bits; NIST SP 800-63B requires 64 bits minimum
  from an approved RNG for a session identifier.
- **The limiter becomes the attack.** Five wrong guesses from anyone on the internet ends pairing
  for the session. That is a one-line denial of service against the feature.

And the URL is not a secret: quick-tunnel hostnames turn up in Google's index (research §5,
objection 2).

### 5.2 What replaces it

**Nothing replaces it on the LAN.** The 4-character code, `REMOTE_MAX_PAIR_ATTEMPTS`,
`recordPairAttempt`, `REMOTE_PAIR_QUERY_PARAM` and `pairedRemoteUrl` are **unchanged**, and every
one of their tests keeps passing untouched. The LAN path is not the thing that got worse.

On the tunnel path, five decisions:

**1. `POST /api/pair` is refused outright over the tunnel.** Not rate-limited — refused. There is
no typed code on that path, so there is no 2²⁰ secret facing the internet and no five-attempt
lockout to trip. This is the research's own *"or offer no typed code at all on that path"*, taken
literally because it is the cheapest correct answer.

**2. A 128-bit capability token.** `randomBytes(16)`, base64url, from `node:crypto`. Minted fresh
on every tunnel start. **Single-use** and **expiring after ten minutes** (Jellyfin Quick Connect's
number). Compared with `crypto.timingSafeEqual` on equal-length buffers, never with `===`.

**3. It reaches the phone in the URL *fragment*, and the QR is the channel.** The tunnel QR encodes
`https://<host>/#k=<token>`. Per RFC 3986 a fragment is never transmitted to the server, so it
stays out of access logs, proxy logs and `Referer` — the TAG document recommends exactly this. The
page reads `location.hash`, **POSTs it in a body** to `POST /api/claim`, and calls
`history.replaceState(null, '', location.pathname)` to scrub it, before the request is made and
whether or not the page is already paired — the identical ordering and the identical reasoning the
existing `REMOTE_PAIR_QUERY_PARAM` branch already uses in `remotePage.ts`.

A human cannot type 128 bits, and is not asked to. **There is no typed fallback on the tunnel
path** — if the camera will not scan, the `copy link` button already on the modal copies the whole
URL, and Universal Clipboard carries it. That is the same second path the LAN card already offers.

**The fragment is better, not good, and the leak list is worth writing down**: browser history and
its cloud sync; address-bar autocomplete; a screenshot of the QR, or the QR simply sitting on
screen; link unfurling by iOS, Slack or Discord if the URL is pasted; clipboard managers; pasting
into a search box. `replaceState` rewrites the current history entry but the URL may already have
been recorded before the script ran. **Single-use plus a ten-minute expiry is therefore not
optional**, and neither is the next item.

**4. Approve on the Mac.** This is the decision that makes the entropy argument mostly evaporate,
and it costs one button. A claim does not succeed on its own: it parks, and a small prompt appears
on the desktop —

> a phone is asking to connect over the internet.
>
> `refuse`  `allow once`

— and the session token is issued only on `allow once`. The user is standing at the Mac when they
pair; they always are, because the QR is on the Mac's screen. Jellyfin's pattern, and the research
calls it *"the cheapest security improvement available."*

Rules: **one outstanding prompt at a time.** A second claim while a prompt is open gets `429` and
raises no second prompt, so a leaked URL cannot be turned into a prompt-spam attack. A prompt not
answered within sixty seconds is refused. A refused claim consumes the token — the user restarts
the tunnel, or presses `new link` for a fresh grant, if they believe the first one leaked.

**5. Rate limiting, and the outer bound.** Twenty failed claim attempts on a tunnel session
**stops the tunnel**, and the modal says `too many attempts, tunnel stopped`. Not a pairing
lockout: the honest response to strangers rattling the handle is to close the door, not to jam it
shut while leaving it open. This *is* a denial of service someone who has the URL can trigger —
the cost is the user pressing `start tunnel` again — and that is the right trade, because the LAN
path is entirely unaffected and the user is at the machine. **Remembering the Matter/Thread
finding from the research** — the SDK whose cryptography was correct and whose lockout was not
enforced, *"effectively nullifying the intended lockout"* — **the test that proves the twenty-first
attempt stops the tunnel gets written before the claim route does.**

### 5.3 Are tunnelled requests authenticated differently from LAN ones?

Only at the door. Past it, no.

- **At the door:** LAN → `POST /api/pair` with a 4-character code. Tunnel → `POST /api/claim` with
  a 128-bit token plus desktop approval. Each route refuses the other path's origin.
- **Past the door:** one session bearer token from `randomBytes(32)`, one `tokens` Set, one
  `authorized()` check, exactly as today. There is no second auth mechanism to keep in sync,
  which is the whole reason the claim route hands back the same shape `/api/pair` does.

**Cookie or bearer?** The research prefers an `HttpOnly; Secure; SameSite=Strict` cookie. This
design keeps the existing bearer in `localStorage`, deliberately: the page's CSP is
`default-src 'none'` with a single inlined script and no user data interpolated into the page
string (state is written with `textContent`; the only `innerHTML` uses are `= ''` clears), so the
XSS the `HttpOnly` flag defends against has no route in, and a second auth mechanism in the same
server is a real cost. **What would change it:** the page gaining any third-party subresource, any
`innerHTML` write of state, or any route that echoes input.

### 5.4 Off by default, and never silent

- The tunnel never starts with the app, never starts with the remote, and is never started by a
  failure. Nothing auto-falls-back. (Home Assistant's model: the cloud path is *parallel*, not a
  fallback, and the client picks by SSID rather than by probing.)
- Starting it requires: opening the remote, opening `not connecting?`, reading the disclosure once,
  and pressing a button. Four deliberate acts.
- While it runs, the modal says so, and the gear menu's phone-remote row says so.
- It stops with the remote, on sleep, on quit, on idle, and on the button.

---

## 6. `isAllowedHost`, and how the tunnel gets admitted without weakening it

### 6.1 Why every tunnelled request 403s today

`isAllowedHost` (`src/shared/remoteAuth.ts`) does two things that both refuse a tunnel:

```ts
const separator = host.lastIndexOf(':')
// No port in the header is not this server: 7373 is never a scheme
// default, so a browser talking to us always sends one.
if (separator <= 0) return false
if (host.slice(separator + 1) !== String(port)) return false
```

A browser fetching `https://abc-def.trycloudflare.com/` sends `Host: abc-def.trycloudflare.com` —
**no port**, because 443 is the scheme default. And even with a port it would fail `matchableEntry`,
which admits only an IPv4 literal or a single-label `.local`.

### 6.2 The design: a second door, not a wider one

**`isAllowedHost` is not modified.** Its body, its comment and all of its tests stay exactly as
they are — including the five refusal classes the suite asserts (every name; a list entry that is
neither IP literal nor `.local`; another machine's address; the right address on the wrong port and
a missing port; a machine with no addresses). Changing a guard whose comment is load-bearing, in a
way that has to keep five specific refusals true, is how a careless security regression happens.

Instead, two new pure functions beside it:

```ts
/** The tunnel's own door. `tunnelHost` is the EXACT hostname our own tunnel
 * process reported to us, lowercased, or null when no tunnel is running --
 * in which case this refuses everything and the whole surface does not
 * exist.
 *
 * WHY THIS IS SAFE ON isAllowedHost'S OWN TERMS. That comment says the
 * property is: rebinding works by making A NAME THE ATTACKER CONTROLS
 * resolve to an address on the victim's network. This admits exactly one
 * name, and it is not a name an attacker controls -- it was assigned by the
 * provider to OUR tunnel, at OUR request, moments ago, it routes only to
 * our tunnel, and we are comparing against the literal string we were
 * handed rather than against a pattern or a suffix. An attacker who owns
 * evil.example.com and points it at 127.0.0.1 still sends
 * `Host: evil.example.com`, which is not our literal, and is refused here
 * and by isAllowedHost alike.
 *
 * NO SUFFIX MATCHING, EVER. `endsWith('.trycloudflare.com')` would admit
 * every other person's quick tunnel, which is the actual hole available
 * here. This file does not contain the string 'trycloudflare'.
 *
 * The port rule is inverted from isAllowedHost's, and deliberately: over
 * the tunnel the scheme IS https, so 443 is the default and the browser
 * sends no port. Bare host, or host:443. Nothing else. */
export function isAllowedTunnelHost(
  hostHeader: string | undefined,
  tunnelHost: string | null
): boolean

/** The one call the server makes. Either door, never a blend. */
export function isAllowedRequestHost(
  hostHeader: string | undefined,
  ownAddresses: string[],
  port: number,
  tunnelHost: string | null
): boolean {
  return (
    isAllowedHost(hostHeader, ownAddresses, port) ||
    isAllowedTunnelHost(hostHeader, tunnelHost)
  )
}
```

`remoteServer.ts` swaps its one guard call for `isAllowedRequestHost(..., options.tunnelHost())`,
where `tunnelHost` is a getter read **per request** — the same reason `ownAddresses` is read per
request rather than captured at startup. When the tunnel closes, the very next request is refused.

### 6.3 Four properties this arrangement has, stated so they can be tested

1. **With no tunnel running (`tunnelHost === null`), behaviour is bit-identical to today.** Every
   existing test passes; the new door refuses unconditionally.
2. **A careless `ownAddresses.push(tunnelHost)` does nothing.** `matchableEntry` already refuses
   anything that is not an IPv4 literal or a single-label `.local`, so the *wrong* way to do this
   silently fails closed. That is worth a test of its own, as defence-in-depth against a future
   change.
3. **The tunnel host is never admitted on the LAN port and the LAN addresses are never admitted
   portless.** `192.168.1.40` with no port stays refused; `abc.trycloudflare.com:7373` is refused.
4. **The guard knows no provider.** `src/shared/remoteAuth.ts` gains no knowledge of Cloudflare.

### 6.4 One thing the guard cannot do, said out loud

The Host guard closes DNS rebinding. It does not, and cannot, stop **anyone who has the tunnel
URL** from reaching the pairing surface — that is what a public URL means. The things that stop
them are: the 128-bit single-use token, the ten-minute expiry, the desktop approval, and the
fact that the whole surface is a Discover screen that is already on the Mac. That is the honest
statement of the blast radius, and it belongs next to the existing one in `startRemoteServer`'s
doc comment.

---

## 7. Payload discipline — the phone is a controller over the tunnel

**Both.** The page knows, and the server refuses. They are not redundant; they answer different
questions.

**The server refusal is what the CDN terms rest on.** `/api/loop` and `/api/stem` answer `403`
with `{ tunnelled: true }` when the request arrived through the tunnel door, regardless of what
the page thinks, regardless of a stale tab, and regardless of a hand-written request. Cloudflare's
Service-Specific Terms name *"audio files"* and *"other large files"*; a promise that our page
will not ask is not a control, and a 403 is.

**The page knowing is what makes it not feel broken.** `/api/state` gains one field:

```ts
export type RemoteVia = 'lan' | 'tunnel'
```

computed per request from which door admitted it. When the page sees `via === 'tunnel'` it never
enters mixer mode at all: no `/api/stem` fetches, no per-stem faders, no `AudioContext`, no
`STEM_BUDGET_BYTES` accounting. It is one branch around the block that already exists.

**What the user sees**, in the phone page's rest line, in the page's own lowercase voice:

> controls only over the internet. the audio stays on the mac.

and in the desktop modal, before they start:

> the phone will not play audio over this link.

It is a real feature loss and it is stated, not hidden — which is what the research asked for, and
also what makes the 100–200 ms round trip tolerable: a control that lands in a fifth of a second
reads as a slightly slow control, where a twelve-stem mixer at that latency reads as broken.

**Not a hack, a boundary:** this is the same split Ableton Note ships — timing on the LAN, content
over the cloud — arrived at from the opposite direction.

---

## 8. The UI, and the actual copy

Design tokens are the law (`src/renderer/src/styles/tokens.css`): near-black monochrome, Silkscreen,
**no `border-radius` anywhere**, lowercase, no emoji, no exclamation marks, colour only on things
that carry audio information, buttons two words max, tooltips two or three words.

### 8.1 Where it lives

Inside `PhoneRemoteModal.tsx`'s existing `not connecting?` disclosure, **below** the three
`REMOTE_TROUBLE_REASONS` lines and below the address rows. That placement is the argument: the
disclosure already names three causes the user can check and then runs out of things to offer.
This is the "try another way" it is already leading toward.

Collapsed state, one row:

```
connect from anywhere            [ turn on ]
```

with the tooltip `uses the internet`.

### 8.2 The disclosure, first time only

Pressing `turn on` the first time replaces the row with this block. It is the whole consent, and
it is written to be read rather than clicked past:

```
this makes a link that reaches this mac from the internet, so the phone can
connect when the wifi will not carry it.

the link goes through cloudflare. they can see the address of this mac, the
address of the phone, and when each request happens. no audio goes over this
link -- the phone is controls only, and the sound stays here.

cloudflare calls this a testing service. there is no uptime promise, and they
can change or withdraw it. using it accepts cloudflare's terms.

it downloads a small program from cloudflare the first time. it runs only
while you leave it on, and stops when you close the remote, when this mac
sleeps, and when you quit.
```

Buttons: `not now` · `turn on`.
Link, plain underlined text in `--ra-text-2`: `cloudflare terms`.

Accepting writes `tunnelConsentAcceptedAt` (ISO date) into `phoneRemoteSettingsStore.ts`, beside
`preferredAddress` — a per-machine fact, never in a `.sssketchproj`. Afterwards the disclosure is
reachable from a `how it works` link in the row, and is re-shown if the stored date predates a
bumped `TUNNEL_DISCLOSURE_VERSION` (so a change to what Cloudflare sees can re-ask).

### 8.3 The steps, each with its own line

- Downloading: `getting cloudflared · 14 of 38 mb` with a `cancel` button.
- Verifying: `checking signature`.
- Starting: `starting tunnel`.
- Running: the QR swaps to the tunnel link, and:

```
tunnel on
this link reaches this mac from the internet. controls only, no audio.
the link stops working when you stop it.
```

Buttons: `stop tunnel` · `new link` (mints a fresh capability grant without restarting the
process, for when the first QR was photographed).

- Failures, each its own sentence, because they mean different things:
  - `could not download it` — with `try again`.
  - `the file did not match` (checksum) or `the signature did not check out` — with no retry
    button, because a retry is the wrong response to that.
  - `the tunnel did not start` — the QUIC/UDP case and the generic case both land here.
  - `tunnel stopped` / `tunnel stopped on sleep` / `too many attempts, tunnel stopped`.

### 8.4 The approval prompt

Its own small modal, **not** inside `PhoneRemoteModal` — the card can be dismissed while the remote
runs (that is what `close, remote stays on` means), and an approval that only appears on a card
nobody has open is an approval that never appears.

```
a phone is asking to connect over the internet.
```

Buttons: `refuse` · `allow once`. Sixty seconds, then it refuses itself.

### 8.5 Say which path the phone arrived on — Syncthing's lesson, for free

The research's §"Diagnosis": *no product in the survey distinguishes "found but unreachable" from
"not found"*, and Syncthing comes closest simply by **naming the mode it ended up in**
(`Relay (Client)` in its UI). Once the tunnel exists, the Mac gets that for nothing — it knows
which door each request came through. One line on the modal:

```
phone connected · over the internet
```
or
```
phone connected · over wi-fi
```

That is the definitive first-person diagnosis the research says only exists once a fallback does:
if the phone arrives over the tunnel and never over wi-fi, the user's router is separating their
devices, and they now know it without anyone probing anything.

---

## 9. Disclosure, README, and `AI_DISCLOSURE.md`'s neighbourhood

**`AI_DISCLOSURE.md` is not edited.** It is about who wrote the code, not about what leaves the
machine, and editing it by analogy would blur a document whose value is that it says one thing.
Stated here so nobody does it.

**`README.md`** gains a short paragraph in the feature list near the existing Rubberband /
third-party lines: the phone remote is LAN-first; there is an optional, off-by-default way to
reach it from the internet; it uses `cloudflared` (Apache-2.0), downloaded on demand from
Cloudflare's own releases and not bundled; audio never goes over it; and a link to Cloudflare's
terms. Four sentences, not a support page.

**A new `PRIVACY.md`, beside `AI_DISCLOSURE.md`.** One page, and it exists because the research
established that IP addresses are personal data under GDPR (Recital 30, *Breyer*), that Article
3(2) has no commerciality carve-out, and that Article 13 transparency therefore applies even to a
free GPL app with EU users. It names, plainly: that the LAN path sends nothing anywhere; that the
tunnel path routes through Cloudflare, who terminate TLS and therefore see this Mac's IP, the
phone's IP (home location, and travel pattern if the phone is on cellular), timing, duration and
volume, and the assigned hostname; that no audio traverses it by design; that it is off by default,
per-session, and started explicitly; and that the provider sits behind a one-function seam so it
can be replaced or self-hosted. Borrow magic-wormhole's honesty and **write the limit down before
anyone depends on it**: this is a free third-party service with no uptime promise, and it may be
limited or withdrawn.

---

## 10. Scope

### In — minimum lovable

A phone that cannot reach the Mac over the wifi can scan a second QR code, get a desktop approval
prompt, and drive Discover from anywhere, with the audio staying on the Mac and the whole thing
switched off again by one button, by sleep, by quitting, or by two hours of silence.

### Not now, deliberately

- **The 700 ms poll stays a poll.** The research flags a WebSocket with a sub-100-second heartbeat
  (the measured quick-tunnel idle death was 130 s) as the right shape and *"the one hidden cost
  worth flagging"*. It is right, and it is a separate plan: it touches the 2282-line page, it is
  what makes any *metered* provider affordable, and quick tunnels are not metered by request, so
  nothing here needs it. **Do not fold it in.**
- **No self-hosted FRP server and no Workers + Durable Objects relay.** The seam exists for them;
  the research's §6 has the triggers.
- **No `plex.direct`-style TLS on the LAN path.** A domain, a DNS zone, per-user certificate
  issuance and key distribution, to solve a problem the tunnel solves for free.
- **No end-to-end encryption between phone and Mac.** `crypto.subtle` exists over the tunnel and
  does not on the LAN, so it would be a tunnel-only feature, and the desktop approval plus the
  narrow blast radius is what it would be buying. Revisit if the surface ever grows past Discover.
- **No automatic LAN→tunnel fallback, ever.** Not a scope cut; a design rule.
- **No auto-restart of a crashed tunnel.** §4.3.
- **No Windows or Linux path.** macOS-first, like the rest.
- **No bundling, and therefore no changes to `electron-builder.yml`, `build/afterPack.js` or
  `.github/workflows/release.yml`.** If the §3.3 test flips the recommendation, that is a change of
  plan with a release-time cost, and it must be said out loud at that moment.
- **Nothing under `native-engine/`.**

---

## 11. Testing, honestly

- **`src/shared/` is TDD'd** and is where every decision with a correctness rule lives:
  `isAllowedTunnelHost` / `isAllowedRequestHost`, the capability-grant state machine,
  `parseQuickTunnelUrl`, the idle-stop predicate, the claim attempt counter. The Matter lesson —
  correct cryptography, unenforced throttle — means the twenty-first-attempt test is written
  before the route.
- **React components are not unit-tested in this codebase.** `PhoneRemoteModal.tsx` and the
  approval prompt are verified by `npm run typecheck`, `npm run lint`, the suite staying green,
  and then by Elling. This environment has no GUI, no camera and no phone: **no agent may claim to
  have scanned a QR code, seen a modal, or connected a phone.**
- **The tunnel subprocess is tested with a real subprocess and an injectable path override**, the
  `engineProcess.ts` / `pluginScan.ts` convention, not a mock of `child_process`. The real
  subprocess in CI is a **stub shell script** written into a temp dir that prints a
  `trycloudflare.com` banner line to stderr and then sleeps — that exercises spawn, chunked stderr
  accumulation, readiness, timeout, teardown, and the orphan reaper, all for real, with no network
  and no third-party binary.
- **Real `cloudflared` never runs in CI.** CI must not download a third-party binary or open a
  tunnel to the internet. The real-binary paths (download, checksum, `codesign` verification, a
  live tunnel) are covered by a **manual walkthrough**, written into the plan as a numbered list
  Elling runs once — the same intentional, documented choice this codebase already makes for real
  plugin scanning and live playback.
- **`vitest.config.ts`:** nothing in this design opens better-sqlite3, so the CI exclusion list is
  **not** touched. That is stated deliberately rather than by omission, because a stale list
  silently broke every release for six weeks.

---

## 12. What can and cannot be proven before Elling tries it

**Proven by the suite:** the guard admits exactly one literal host and nothing else; the five
existing refusals still hold; the grant is single-use, expiring and timing-safe; the twenty-first
attempt stops the tunnel; the audio routes refuse the tunnel door; the parser reads a chunked
banner; the process dies on every teardown path and a survivor is reaped at next start.

**Not provable here, and each needs Elling:**

1. That his phone's DNS resolves `*.trycloudflare.com` at all, on wifi and on cellular.
2. That his network permits the outbound QUIC a quick tunnel forces.
3. That a node-downloaded, Cloudflare-notarized binary execs cleanly on a clean Mac — the test
   that would flip §3.3.
4. That the round trip is tolerable in the hand. 106–200 ms was measured; whether tap-to-roll at
   that latency feels like a controller or like lag is a judgement only he can make.
5. That the phone page, in a real secure context for the first time, behaves — including whether
   `Screen Wake Lock` then works, which is the quiet second prize.

**And the honest framing of the whole thing:** this does not make sssketch's phone remote reliable.
It gives the small minority for whom the LAN path is a dead end one way through, on a free service
whose terms say it is for testing, behind a seam because those terms will change. The LAN path
remains the product. This is the escape hatch, labelled as one.
