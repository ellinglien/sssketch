# How a desktop app lets a phone connect to it

Date: 2026-09-28
Status: research only — no code changed. A recommendation awaiting Elling's decision.

This exists because the phone remote does not reliably connect, a morning of live debugging did
not fix it, and the instruction was: stop tweaking settings, go find out how this is normally
solved. Tailscale is off the table.

---

## The recommendation, first

**Keep the LAN path exactly as it is and make it the default. Add exactly one fallback that
leaves the house through the gateway, and implement that fallback as a bundled outbound tunnel
— `cloudflared` in quick-tunnel mode — behind a one-function seam so the provider can be
swapped later.**

Three reasons, in order of weight:

1. **His network cannot be fixed from inside the app, and this is already proven in his own
   repo.** `src/shared/phoneRemoteView.ts:70-73` records that a bare `python3 -m http.server`
   on an unrelated port is equally unreachable between two browsers on that Wi-Fi while the
   gateway answers both. That is client isolation at layer 2. No address picker, no `.local`
   name, no mDNS, no protocol choice reaches across it. Anything that stays on the LAN is
   already known to fail there.
2. **The class of solution that does work on his network is also already known.** Tailscale
   works — the codebase says so in two places — and Tailscale on an isolated LAN gets across by
   leaving through the gateway. So the question is not *whether* a gateway-exiting path works,
   it is *which* one to build. That is an unusually strong position to be recommending from.
3. **Among gateway-exiting paths, a tunnel is the only one that costs nothing to run, nothing
   to operate, and almost nothing to build**, because it reuses the existing HTTP server and
   the 2282-line page verbatim. WebRTC, a relay, and a native app all cost substantially more
   and, on his specific network, arrive at the same place.

**Second choice, and its trigger:** run the tunnel server himself — the Gradio/Hugging Face
model, an FRP server on a small VPS. Switch to it if Cloudflare's rate limit bites, if
Cloudflare withdraws quick tunnels, or if he decides he is unwilling to route other people's
control traffic through a third party. Cost: roughly €4–6/month and an operational
responsibility that never ends. The point of the seam in the recommendation is that this switch
should be a day, not a rewrite.

**What I am explicitly recommending against: WebRTC.** Reasoning in full below, but the short
version is that on the network this is being built for, WebRTC's direct path is blocked and it
degrades to TURN — which is a paid relay — while still requiring a signalling server, a CSP
change, and several hundred lines that a tunnel does not need. It buys its keep when two peers
are on *different* networks behind *different* NATs. Both of ours are on the same hostile LAN.

**Honest answer to "does this fix his network":** yes. A tunnel is an outbound TCP connection
from the Mac to Cloudflare — the same shape of traffic as any web request the Mac already
makes, and the same shape Tailscale uses today. Client isolation does not touch it. The phone
then reaches the Mac from the internet side. This is a real fix for his case, not merely a
better error message.

**Honest answer to what it costs him elsewhere:** the phone's own-speaker loop playback will be
noticeably slower over the tunnel. `src/main/remoteLoopRenderer.ts:14` says a loop is up to
**11.3 MB of wav**. That is instant on a LAN and three to nine seconds over a home upstream
link. The tunnel path should either serve compressed audio or say plainly that phone playback
is a LAN feature.

---

## What is already established, and what it forecloses

These are from the repository, not from the web, and they beat any external source about his
situation.

| fact | where |
|---|---|
| The Bell Home Hub 3000 isolates wireless clients; Mac and iPhone on 192.168.2.x cannot reach each other at all | `src/shared/phoneRemoteView.ts:70-73` |
| Proven app-independently: a bare python server on another port was equally unreachable between two browsers on that Wi-Fi, while the gateway answered both | commit `af9899b` message |
| **His router also blocks mDNS** | `src/shared/lanAddress.ts:256`, `src/shared/lanAddress.test.ts:397` |
| The personal-hotspot test was void: iOS blocks the host phone from reaching its own hotspot clients | same |
| Tailscale is currently the only address that works | `src/shared/phoneRemoteView.ts:73`, and the design brief's "Second surface" section |
| A phone loop is up to 11.3 MB of wav (64 s at 44100/2/16) | `src/main/remoteLoopRenderer.ts:14` |
| The page polls state every 700 ms over plain HTTP | `src/main/remotePage.ts:795` |
| CSP is `default-src 'none'; … connect-src 'self'` — no external anything | design brief, "Hard constraints" |
| The pairing secret is 4 characters from a 32-symbol alphabet: 2²⁰ ≈ 1.05 M | `src/shared/remoteAuth.ts` |
| The repo already bundles, ships and `signIgnore`s a third-party CLI (rubberband) | `electron-builder.yml:13-27, 96-113` |

Two things follow immediately.

**mDNS is not the answer.** Not because `.local` is a bad idea — it is a good idea, it survives
DHCP moves, and the work landed today in `9aa18a6` is worth keeping — but because *his router
blocks mDNS*. It cannot fix the case it would be built to fix. Keep it as the address-stability
nicety it already is; do not promote it to the solution.

**The bandwidth question is not academic.** Any off-LAN path carries the 11.3 MB wav, and that
changes the arithmetic for TURN, for a relay, and for the felt quality of the feature.

### One thing the brief and the design brief disagree about

The research question says "ordinary non-technical users on ordinary home networks." The phone
remote's own design brief says the opposite: *"It is one person's tool. Elling built sssketch;
he is the only user of this page."* The repository is public, so both will become true
eventually, but they point at different answers today, and it is worth being explicit about it
because it changes what "good enough" means:

- **If this is one person's tool**, the cheapest honest answer is an internet path for one Mac
  and one phone, and almost any of the options below would do. The thing that makes it urgent
  is not user support load, it is that his own network is one of the bad ones.
- **If this is for everyone**, the thing that matters most is that the failure is rare, opt-in,
  and does not create a support channel — which is an argument for keeping LAN as the default
  and the fallback as something explicitly chosen.

The recommendation below is written so that the same build serves both, which is why "LAN stays
the default, the fallback is opt-in" is load-bearing rather than decoration.

### One loose end, offered and then dropped

The evidence notes the Mac's address moved through `.123`, `.126`, `.151` in a day, and that the
phone is now `192.168.2.123` — an address the Mac previously held. If a stale `.123` was ever
typed or scanned, the phone was connecting to itself and no SYN would leave it, which would look
exactly like the observed capture. I mention it once because it is cheap, and then set it aside:
the python-server test used two browsers and a different port and failed the same way, which is
not explainable by a stale address. **The client-isolation diagnosis stands.** This is not a
request to go debugging again.

### The missing SYN, explained — and the reasoning that was right

**Your reasoning was correct: from the Mac you cannot distinguish "the phone never emitted a
SYN" from "the phone emitted one and the AP dropped it."** A capture on the Mac taps the Mac's
own interface and only ever proves what arrived. Both hypotheses produce an identical capture.

But the research turned up a **third reading that explains the capture completely**, and it is
almost certainly what is happening:

> The phone broadcasts an ARP request for the Mac (broadcast — it arrives, you saw it). The Mac
> sends its ARP **reply**. That reply is **unicast, station to station** — which is exactly the
> traffic client isolation blocks. The phone never receives it, never completes its neighbour
> entry, and therefore **never sends a SYN at all**. There was never a SYN to drop.

This is not speculation about a proprietary box; it falls straight out of how the feature is
specified. Juniper Mist documents isolation and broadcast/multicast filtering as **two
independent knobs** — peer-to-peer isolation targets station-to-station **unicast** at layer 2,
while the separate broadcast/multicast filter, even when on, permits ARP, DHCP and IPv6 ND by
default ([Mist, *Isolation and Filtering*](https://www.mist.com/documentation/isolation/)). That
combination produces precisely the capture: broadcasts and multicast arrive, unicast never does,
no SYN is ever emitted. Ubiquiti's community has the mirror-image report — enabling broadcast
blocking broke devices because the controller "was unable to ARP for their IPs."

Note what this quietly contradicts in the evidence. "The Mac answers ARP for itself correctly"
is true and was observed — but it was observed **on the Mac, as the reply left**. Nothing in
that capture shows the reply *arriving at the phone*, and under this reading it does not. The
line "it now ARPs and gets the right MAC" is the one assumption in the evidence that the Mac's
own capture cannot support.

**There is one free check that would confirm it**, using the capture already taken: if the phone
ARPs for the Mac **repeatedly, every few seconds, indefinitely**, the reply is not getting back
and the diagnosis is settled. If it ARPs once and goes quiet, the reply arrived and something
else is suppressing the SYN. This is reading a file you already have, not another morning of
debugging. (The decisive-but-more-effort version, for the record and not as a request: `rvictl
-s <device-UDID>` over USB creates an `rvi0` interface and `tcpdump -i rvi0` shows exactly what
the iPhone emits.)

The apparent asymmetry (the Mac reaching thermostats) is normal and does not weaken this: those
devices may be on a different band, a different SSID, or wired, band steering may have put the
Mac and phone on different radios, and many implementations filter per-client rather than
globally.

---

## How comparable products actually do it

The pattern across everything that works for non-technical users is the same, and it is worth
stating before the table: **LAN first, with something that does not depend on the LAN behind
it.** The products that are LAN-only are exactly the products whose support pages tell users to
go change a router setting.

| product | primary transport | what it does when the LAN path fails | browser or native |
|---|---|---|---|
| **Syncthing** | direct TCP/QUIC, local discovery by broadcast/multicast, global discovery server | falls back to a **community relay pool**; traffic stays end-to-end encrypted so the relay is blind; retries direct periodically and drops the relay when direct succeeds ([docs](https://docs.syncthing.net/users/relaying.html)) | native |
| **Gradio `share=True`** | none — goes straight out | downloads a **modified FRP client** on first use and tunnels to Hugging Face's share server; random `*.gradio.live` subdomain; 72-hour expiry; self-hostable ([docs](https://www.gradio.app/guides/understanding-gradio-share-links), [huggingface/frp](https://github.com/huggingface/frp)) | browser |
| **Plex** | LAN discovery + direct connection | falls back to **Plex Relay** through Plex's own servers, bandwidth-capped; uses the `plex.direct` wildcard-certificate trick to get browser-trusted TLS to a private IP *(plex.tv 403s automated fetches — described from general knowledge, not a retrieved source)* | both |
| **Chromecast / Google Home** | mDNS on the LAN, nothing else | **tells the user to turn off AP isolation on their router** ([Google support](https://support.google.com/chromecast/answer/3222253?hl=en)) | native |
| **Sonos** | mDNS/SSDP on the LAN | same — the support answer is a router setting | native |
| **Home Assistant** | LAN HTTP | optional paid cloud remote access (Nabu Casa) | browser |
| **Logic Remote / Cubase iC Pro** | Bonjour + a native app over the LAN | nothing; it simply does not find the Mac | native only |
| **Cloudflare quick tunnels as a shipped product feature** | — | Beeper's own desktop-API docs recommend exactly this for remote access to a local desktop app ([Beeper docs](https://developers.beeper.com/desktop-api/advanced/remote-access/cloudflare/)) | browser |

**Provenance of the table:** the Syncthing, Gradio, Chromecast and Beeper rows are from primary
sources, linked. The Plex, Sonos, Home Assistant and Logic Remote / Cubase iC rows are general
knowledge that I could not retrieve a primary source for in this session (several of those sites
refuse automated fetches). They are all uncontroversial, but treat them as background rather
than as evidence.

The Chromecast/Sonos row is the important one. Those are two of the best-resourced consumer
products in the category, they hit precisely this failure, and after a decade their answer is
still a support article asking the user to reconfigure their router. That is the ceiling on
LAN-only. It is also explicitly ruled out here — the brief forbids asking the user to change a
setting on their phone or router.

The Syncthing and Gradio rows are the template being recommended: a LAN-independent fallback,
owned or borrowed, with an honest description of what it does.

---

## The options, honestly

### 1. Plain LAN HTTP — what ships today

**Real-world failure rate: low but unknowable, and he is inside it.** I could not find a
published figure for how many home networks have client isolation on, and I do not believe one
exists. The best available signal is negative evidence: network engineers observe that AP
isolation is not normally on by default on home equipment, because it would generate enormous
support load. It *is* normally on for guest SSIDs, and it is evidently on for at least some
Bell HH3000 deployments.

**What causes failure, in rough order:** AP/client isolation (his case); separate guest SSID or
band-split SSIDs putting the phone on a different segment; a VPN profile on the phone; the macOS
firewall; the address having changed since the QR was made; and a long tail of the user typing
`192.168.2.151:7373` into a mobile address bar and getting a Google search instead of a
navigation, which Safari has done for years and which produces the same "no SYN" signature.

**Verdict:** keep it. It is the fastest path, it is already built, it works for most people, and
it is the only path where 11.3 MB of wav is free. It is not sufficient on its own.

### 2. mDNS / Bonjour `.local`

**Does it help?** For address churn, yes — that is what shipped in `9aa18a6` and it is the right
fix for "the link I saved stopped working."

**Does it fix his case?** No. His router blocks mDNS; the codebase already records this.

**Does iOS Safari resolve `.local`?** This was flagged as genuinely uncertain, and the research
settled it better than expected — though not with a single quotable sentence.

The governing document is Apple's **TN3179, *Understanding local network privacy***, last
revised 2026-02-17
([Apple](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)).
Two things in it decide the question:

- Resolving a `.local` name **is** a gated local-network operation in general — TN3179's
  operation table lists "Resolving a local DNS name — Required: yes." So is a plain outgoing
  **unicast TCP connect** to a local address. It is emphatically **not** only multicast that is
  gated; enforcement is "deep in the networking stack" and applies to every networking API.
- **But Safari is explicitly exempt.** Verbatim: *"Traffic originating from WKWebView,
  SFSafariViewController, and Safari doesn't require local network access."*

So a page in mobile Safari reaching `http://mymac.local:7373` — or `http://192.168.2.151:7373`
— **is not subject to the iOS Local Network permission at all.** That permission is per-app and
code-signature-scoped; there is no per-website local-network permission in iOS Safari today.
This also means the Brave observation in the evidence is a red herring rather than a clue.

Two honest caveats:

- There is **no Apple sentence that says literally "iOS Safari resolves .local."** The
  conclusion is TN3179's exemption plus the OS routing `.local` to mDNS. It is a two-step
  inference; high confidence, not directly quotable.
- Apple's sources **contradict each other on WKWebView**. TN3179 says WKWebView traffic is
  exempt; Quinn (Apple DTS) says on the forums that *"a web view running in your app is
  considered to be your app from the perspective of local network privacy."* Both cannot be
  fully true. It does not affect Safari proper, where the sources agree.

**None of which changes the verdict, because his router blocks mDNS.** The repo's comment —
*"we could not prove it reaches a real iphone"* — was the right call at the time and the
conclusion still stands for a different reason: `.local` is a good address-stability feature and
a non-answer to the connection problem. Keep it non-default.

### 3. Browser restrictions on reaching private IPs — the thing to watch

This is worth its own section because if a mobile browser starts refusing plaintext requests to
private addresses, the LAN path degrades on its own, regardless of routers.

- Chrome shipped a **Local Network Access** permission prompt in **Chrome 142, 28 October
  2025** — **desktop and Android only** ([Chrome for Developers
  blog](https://developer.chrome.com/blog/local-network-access),
  [chromestatus](https://chromestatus.com/feature/5152728072060928),
  [Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY)).
- **The specification excludes top-level navigation, explicitly.** The [WICG
  explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md) states the
  proposal "currently restricts subresources and subframe navigations," and separately notes
  that "top-level navigations remain a risk after restrictions on subresource local network
  requests are in place" — i.e. they are knowingly out of scope. Typing or scanning a URL is a
  top-level navigation. And a page served *from* `192.168.2.151` fetching back to
  `192.168.2.151` is local→local, which the model does not gate.
- **WebKit is implementing it right now and has not shipped it.** PR #72725, "Add the Local
  Network Access check algorithm," was opened 2026-08-28 and merged 2026-09-11 behind a
  `LocalNetworkAccessEnabled` preference, and it **explicitly skips main resources and iframe
  navigations**. PR #74740 landed five days before this document was written. WebKit's
  standards-position issue is still open with no formal position
  ([#72725](https://github.com/WebKit/WebKit/pull/72725),
  [#74740](https://github.com/WebKit/WebKit/pull/74740),
  [#74003](https://github.com/WebKit/WebKit/pull/74003),
  [standards-positions #520](https://github.com/WebKit/standards-positions/issues/520)).
- **Chrome iOS and Brave iOS are WebKit**, and Chromium's LNA lives in the Chromium network
  service that iOS Chrome does not use for page loads. So: no LNA on any iOS browser today.
  That last step is an inference — no vendor states it outright.
- **Assessment:** LNA is *not* what is happening on his network, and on the current reading of
  both the spec and WebKit's implementation it will not break the LAN design either, because
  the navigation is top-level and the fetches are local-to-local. Confidence is good, not
  total. It remains a reason to prefer an architecture that does not depend on a browser's
  continued willingness to talk to `192.168.x.x`.

Two other browser-side theories, closed out while they were being checked, both ✅ from primary
sources:

- **HTTPS-first cannot explain a missing SYN.** Safari 18.2+ and Brave iOS upgrade http→https,
  but the upgrade **preserves the port** — `http://host:7373` becomes `https://host:7373` and
  still emits a SYN to 7373. It would explain a connection that dies in the TLS handshake, not
  one that never starts.
- **iCloud Private Relay is documented as not applying.** Apple's *iCloud Private Relay
  Overview*: "Private Relay will not attempt to proxy traffic that the device knows is specific
  to the local network, such as an IP address on the local subnet."
- Worth knowing for the future: WebKit follows the Fetch spec's blocked-port list, and a blocked
  port produces **no SYN** and a generic failure. **7373 is not on that list** — but if the port
  ever changes, check it against the list first.

One concrete consequence of plain HTTP that is *already* true and not speculative: an
`http://192.168.x.x` origin is **not a secure context**, so `crypto.subtle` is `undefined` on
that page ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle),
[W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/)). Any future plan that wants the
phone page to do real cryptography — including end-to-end encrypting itself against a relay —
cannot do it on the LAN path as built.

### 4. WebRTC with STUN, TURN as fallback — recommended against

Walking the ICE candidates for two devices on the same client-isolated LAN:

- **Host candidates** (`192.168.2.151` ↔ `192.168.2.123`): blocked. That is what client
  isolation is.
- **Server-reflexive candidates via STUN**: both peers discover the *same* public address. For
  them to reach each other this way the router must perform NAT hairpinning, and the hairpinned
  packet must be permitted — under the "only the gateway's MAC" filter it plausibly would be,
  since it arrives from the gateway. **Whether a Bell HH3000 hairpins, I do not know, and I
  could not find out.** Consumer routers vary widely. This may work on some isolated networks
  and not others, which is the worst possible property for a fallback.
- **Relay candidates via TURN**: work, because TURN is a server on the internet and both peers
  reach it outbound. This always works, and it is a relay.

So on the target network, WebRTC's realistic outcome is TURN. Then:

- **It still needs a signalling server.** Offers and answers have to reach the other peer
  somehow, and on this network they cannot go over the LAN. So a WebRTC design requires a
  developer-run (or vendor) service *anyway* — it does not avoid the server question, it adds
  ICE on top of it.
- **TURN is not free.** Cloudflare's standalone TURN is **$0.05 per real-time GB outbound**,
  free only when paired with their Realtime SFU
  ([docs](https://developers.cloudflare.com/realtime/turn/)). At up to 11.3 MB a loop that is
  about **90 loops per gigabyte, so five cents per ninety loops** — trivial in absolute terms,
  but it is a metered vendor account with a card attached, forever, attached to a free app, and
  it scales with other people's use rather than his. Public free TURN servers exist and should
  not be used: unowned, unaccountable, frequently dead, and they see every byte.
- **It needs the CSP opened.** `connect-src 'self'` governs ICE server URLs and the signalling
  socket. The hard constraint in the design brief would have to be relaxed.
- **The Electron side is the easy part** — Electron is Chromium and has WebRTC natively, so no
  native module is required. That is the one genuine point in its favour.

**Conclusion:** WebRTC is the right tool when two peers are on different networks behind
different NATs and you want to avoid paying for the media path. Here they are on the same
network, the direct path is blocked by policy rather than by NAT, and the media path ends up
relayed regardless. You would pay several hundred lines of ICE handling and a CSP exemption to
arrive at "a relay," which is the thing a tunnel gives you in about forty lines.

### 5. An outbound tunnel bundled with the app — recommended

The Mac opens an outbound connection to a tunnel provider; the provider gives back a public
HTTPS hostname that routes to port 7373 on the Mac; the QR encodes that hostname.

**Why this one:**

- **It reuses everything.** The HTTP server, the page string, the CSP (`connect-src 'self'`
  still holds — it is the same origin), the polling, the renderers. This is the only option on
  the list where the 2282-line page needs no rework.
- **It costs nothing to run and nothing to operate.**
- **It gives real, browser-trusted HTTPS**, which makes the page a secure context and unlocks
  `crypto.subtle`, wake lock, and anything else gated on that.
- **This repo already knows how to ship a third-party binary** — `extraResources` +
  `signIgnore` + `build/afterPack.js`, exactly as rubberband is shipped today. Two
  architectures, both signed under the existing notarized build.
- **`cloudflared` is Apache-2.0** ([repo](https://github.com/cloudflare/cloudflared)), which is
  one-way compatible with GPL-3; and bundling a separate executable that the app merely spawns
  is aggregation, not linking, so the licence question is easy.

**The real objections, not softened:**

Cloudflare's own documentation says, verbatim
([docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)):

> "Quick Tunnels are intended for testing and development only."
> "We don't guarantee any SLA or uptime of TryCloudflare — we plan to test new Cloudflare Tunnel
> features and improvements on these free tunnels."
> "Quick Tunnels are subject to a hard limit on the number of concurrent requests that can be
> proxied at any point in time. Currently, this limit is 200 in-flight requests."
> "Quick Tunnels do not support Server-Sent Events (SSE)."

Read against this feature: the 200 in-flight cap is irrelevant for one phone. SSE is not used —
the page polls. The SLA statement is the one that matters, and it is a genuine risk: this is a
free service the vendor reserves the right to change or withdraw, and a shipped feature would
break the day they do.

The mitigations are architectural, not contractual. **Keep the LAN path as the default and the
tunnel as an explicit, opt-in "beyond this network" mode**, so a tunnel outage degrades the app
to where it is today rather than breaking it. **Put the provider behind one function** —
`startTunnel(port): Promise<{url, stop}>` — so swapping to a self-hosted server is a day's work.

**Others considered:** ngrok requires an account and an auth token for essentially everything,
which is a non-starter for a flow where the user configures nothing — **I did not re-verify
ngrok's 2026 terms this session and it should be checked before being ruled out on that
basis.** `localhost.run` and Pinggy are
small operations with the same withdrawal risk as Cloudflare and none of the scale. A naive
`ssh -R` to a host of his own is tempting because macOS already ships `ssh` and nothing would
need bundling — but Gradio moved *off* SSH tunnelling to FRP partly for security reasons
([GHSA-3x5j-9vwr-8rr5](https://github.com/gradio-app/gradio/security/advisories/GHSA-3x5j-9vwr-8rr5)),
which is worth reading before repeating it.

**One thing to note about runtime download versus bundling:** Gradio downloads the FRP binary on
first use. On Apple Silicon every executable must be at least ad-hoc signed to run at all, so a
binary fetched at runtime is a quarantine and signing problem. Bundle it, the way rubberband is
bundled. It costs bundle size — tens of megabytes per architecture — and nothing else.

### 6. A rendezvous/relay server he runs himself — the second choice

Two shapes: run an **FRP server** (the Gradio/Hugging Face stack, open source and documented for
self-hosting) and keep the tunnel design above unchanged; or write a small WebSocket relay and
change the phone page to talk through it.

The first is strictly better for him — same client design, no page rewrite, proven code.

**Cost:** a small VPS. Hetzner's entry tier is in the €4–5/month range with terabytes of included
traffic, which is far more than this needs; the 11.3 MB wavs are the only meaningful load and
even heavy use is single-digit gigabytes per session. The money is not the problem.

**The burden is the problem, and it is permanent.** A relay that people's phones depend on has to
be patched, watched, renewed, and paid for by one person indefinitely, and when it goes down on
a Saturday the feature is broken for everyone. Syncthing solves this with a donated community
relay pool; Hugging Face solves it by being a company. Neither option is available here.

**Privacy:** state it plainly in the UI and the README, the way Syncthing does — the relay sees
your IP and how much traffic you moved, and with end-to-end encryption it does not see the
content. Note the catch found above: **the phone page cannot do real end-to-end encryption on
the LAN path**, because `http://192.168.x.x` is not a secure context and `crypto.subtle` is
unavailable. Over a tunnel or relay the page is HTTPS and it can.

**Condition under which this becomes the right first choice:** Cloudflare withdraws or throttles
quick tunnels; or the feature stops being opt-in and becomes something users rely on; or he
concludes that routing strangers' control traffic through Cloudflare is not something he wants
to ship without asking.

### 7. A native iOS app

Worth a serious paragraph, because it is the only option that would fix his network **without
any server at all**.

Apple's **Multipeer Connectivity** runs over **AWDL**, the peer-to-peer Wi-Fi link that AirDrop
uses. AirDrop works between his two machines. AWDL negotiates directly between devices rather
than through the access point, and Apple documents that devices on *different* infrastructure
networks can still talk over it
([Multipeer Connectivity](https://developer.apple.com/documentation/multipeerconnectivity),
[AWDL background](https://theapplewiki.com/wiki/Apple_Wireless_Direct_Link)). I could not find a
source that states outright "AWDL is unaffected by AP isolation" — but AirDrop working on his
network while HTTP fails is direct empirical evidence for exactly that, on the network that
matters.

**Why it is still not the recommendation:**

- It requires a Swift iOS app, a Swift/ObjC helper on the Mac side, Xcode, and the $99/year
  Apple Developer Program.
- **GPL-3 and the iOS App Store are in genuine conflict.** Apple removed VLC, GNU Go and Battle
  for Wesnoth in 2011 after a GPL enforcement notice, on the grounds that the App Store Usage
  Rules impose restrictions that GPL §6 forbids
  ([FSF](https://www.fsf.org/blogs/licensing/vlc-enforcement)). VLC relicensed to LGPL in
  response. This is not a settled-and-forgotten issue; it is the reason a GPL-3 project cannot
  casually ship an iOS companion.
- It replaces "open a web page" with "install an app," which is a much larger ask than the
  problem justifies.
- He has already said he does not need audio to continue with the screen off, which removes the
  main other reason to go native.

**Keep it on the shelf.** If the phone remote ever becomes central enough to justify it, AWDL is
the technically superior answer for Apple-to-Apple, and it is the only one that needs no
internet at all.

### 8. USB and wired

**Dead end without a native app.** iOS exposes no way for mobile Safari to reach a host over
USB. USB tethering and Personal Hotspot both make the *phone* the gateway, and iOS isolates the
host phone from its own clients — which is the same wall, and which the repo already found
empirically ("the personal-hotspot test was void"; corroborated by Apple's community
documentation of hotspot client isolation). `usbmuxd` tunnels Mac→phone for debugging, not
phone→Mac.

### 9. The Mac making its own Wi-Fi network

macOS Internet Sharing can put up an SSID the phone joins, bypassing the router entirely. Ruled
out for three reasons: joining a different Wi-Fi network is a setting change on the phone, which
the brief forbids; it takes the phone off the internet; and Internet Sharing was *already* a
cause of trouble this morning, colliding with the LAN subnet.

### 10. UPnP / NAT-PMP port mapping plus hairpinning

The app asks the router to forward a public port to itself, and the phone connects to the
public address. This is what BitTorrent clients do. Rejected: it depends on UPnP being enabled
(often off on ISP-supplied equipment), it depends on hairpinning working (unknown on the
HH3000), and it deliberately exposes a port to the whole internet with no gatekeeper, which is
strictly worse than a tunnel that terminates TLS and can be torn down.

---

## What it does to the security model

Today's model is defensible precisely because it is LAN-bound. A 4-character code is 2²⁰ ≈ 1.05
million possibilities with a five-attempt lockout, reachable only by something already on the
Wi-Fi. The `isAllowedHost` guard closes DNS rebinding. That is proportionate.

**A tunnel changes the threat model completely: the server becomes reachable from the entire
internet for as long as it is running.** The 4-character code is then the only thing between a
stranger and the Discover screen, and 2²⁰ with a per-session lockout is not the right order of
magnitude for an internet-facing endpoint — not because it is brute-forceable through the
limiter, but because the limiter itself becomes a denial-of-service surface (five wrong guesses
from anyone ends pairing for the session).

What standard practice requires:

1. **A high-entropy capability token for the tunnel path, not a human code.** 128 bits, from
   `crypto.randomBytes`, carried in the URL and therefore in the QR. The human-typed 4-character
   code stays for the LAN path, where it is appropriate; it should not be the credential for an
   internet-reachable URL.
2. **Capability URLs are accepted practice** — Plex, Gradio, Cloudflare quick tunnels and most
   "share a link" systems are capability URLs — with known leak vectors that must be respected:
   `Referer` on any outbound navigation, browser history, screenshots of the QR, and server
   logs. Mitigations: put the secret in the **fragment** where possible so it is never sent to a
   server, set `Referrer-Policy: no-referrer`, and have the page strip it from the address bar
   immediately (which `remotePage.ts` already does for the existing code).
3. **Bound lifetime.** The tunnel starts on demand, dies with the session, and the token is
   regenerated every start — the properties the existing design already has and should keep.
4. **The lockout needs rethinking for the tunnel path.** A session-permanent lockout triggered
   by five wrong guesses from the internet is a trivial denial of service. Rate-limit per source
   instead, or simply do not offer a typed code on the tunnel path at all — with a 128-bit token
   in the link, there is nothing to type.
5. **Two concrete code changes the tunnel forces**, both in `isAllowedHost`
   (`src/shared/remoteAuth.ts`), and both worth knowing before estimating:
   - the guard **requires a port in the `Host` header** ("no port in the header is not this
     server"). Over a tunnel the Host is `something.trycloudflare.com` on port 443, with no port
     in the header. As written, every tunnelled request 403s.
   - the guard only accepts this machine's own IPv4s and its own single-label `.local`. The
     tunnel hostname must join the allow-list. That is safe on the comment's own terms — the
     rebinding attack depends on the *attacker* controlling the name, and a quick-tunnel
     hostname is assigned by Cloudflare and routed only to our tunnel — but the reasoning should
     be written down next to the change, because that comment is load-bearing.
6. **TLS to a private IP, for completeness.** A LAN HTTP server cannot get a browser-trusted
   certificate for `192.168.2.151`. Plex solves this with the **`plex.direct` trick**: a real
   wildcard certificate for `*.plex.direct`, plus public DNS that resolves names of the form
   `192-168-2-151.<hash>.plex.direct` back to the private address — so the browser validates a
   genuine certificate while the connection actually goes to a LAN IP. *(Described from general
   knowledge; plex.tv returns 403 to automated fetches and I could not retrieve a primary
   source this session. Verify before repeating it anywhere load-bearing.)* It works, and it
   requires owning a domain, running DNS, and distributing certificate material to clients.
   **This is not worth doing here.** A tunnel gives trusted HTTPS for free, which is one more
   argument for it.

---

## Diagnosis, and failing honestly

Three separate questions.

**Can the app detect this specific situation — broadcasts arriving, no TCP ever?** Partially,
and the partial is worth having.

- The Mac can enumerate its layer-2 neighbours without privileges (`arp -an`) and can join the
  mDNS group on UDP 5353 with `SO_REUSEPORT` to watch who is multicasting. So it can
  legitimately say *"I can see N devices on this Wi-Fi."*
- It can then try to reach those neighbours. **If the Mac can reach the gateway and nothing
  else, that is client isolation and the app can say so with confidence.**
- Stronger still, and sayable without privileges: an iPhone announces itself over mDNS, so the
  Mac can know *"there is an iPhone on this Wi-Fi and it has never opened a connection to me."*
  That is a much better sentence than "check three things."
- **But this test produces false negatives on his own network**, which is the point worth being
  honest about: the Mac *can* reach other wireless clients there. The block is asymmetric or
  per-client. So a clean result from the reachability probe would wrongly reassure him.
- And the single most diagnostic signal — the phone ARPing for the Mac over and over and never
  getting a reply through — needs a privileged packet capture to observe. Not something to ship.

**The much better diagnostic only exists once a fallback exists.** If the phone can reach the
Mac over the tunnel but not over the LAN, that is a definitive, first-person answer — "your
phone can reach this Mac over the internet but not over your Wi-Fi; your router is separating
devices." The app gets this almost for free just by observing which path the phone actually
arrived on, with no probe at all. Note one trap: an HTTPS tunnel page **cannot** actively probe
`http://192.168.2.151:7373` to confirm, because that is mixed content and the browser blocks it.
The observation has to come from which QR the user ended up using, not from a fetch.

**What good products say.** The honest survey result is: not much, and mostly they blame the
router. Google's Chromecast answer is a support page telling the user to check for isolation
mode. Sonos the same. Syncthing shows "Disconnected" and lets the relay handle it. The products
that do not have a support page about this are the products that have a fallback.

**Which means the strongest argument for the recommendation is also the answer to this section:**
the best diagnosis is not needing one. The three lines added in `af9899b` are the right amount
of honesty for the LAN path and should stay. Building a cleverer detector is effort spent
explaining a failure instead of removing it.

---

## What it costs

**To build (the recommended option):**

- Spawn `cloudflared --url http://127.0.0.1:7373`, parse the assigned hostname from its output,
  surface it, tear it down on stop and on quit. Small — the shape of `engineProcess.ts`, which
  already does subprocess lifecycle in this codebase.
- Bundle two `cloudflared` binaries through `extraResources`/`signIgnore`, the rubberband
  pattern. Mechanical, already understood here, but it touches the signed and notarized build,
  so it needs a real packaged-build check, not just `npm run dev`.
- The two `isAllowedHost` changes above, with tests. `src/shared/remoteAuth.ts` is pure and
  already well covered, so this is TDD-shaped.
- A 128-bit token path alongside the 4-character code, and the QR/modal copy to go with it.
- Desktop UI: one clearly-labelled opt-in and an honest sentence about what it does. This is the
  part that deserves the most care and the least code.
- Deciding what happens to 11.3 MB wavs over the tunnel — compress, or disable phone playback
  off-LAN and say so.

**To run:** nothing.

**Ongoing burden:** watching for Cloudflare changing the deal, and keeping two bundled binaries
current. Real but small, and bounded by the fact that the LAN path keeps working regardless.

**The second choice, for comparison:** the client work is nearly identical, plus a VPS, plus FRP
server configuration, plus a domain, plus patching and uptime forever. Roughly €4–6/month and an
open-ended obligation.

---

## What I could not determine

Stated plainly, because a confident wrong answer has already cost a morning.

- **A single quotable Apple sentence saying "iOS Safari resolves `.local`."** The conclusion
  rests on TN3179's Safari exemption plus the OS routing `.local` to mDNS — two steps, not one.
  And it cannot be tested on his network, because mDNS is blocked there.
- **Apple contradicts itself on WKWebView** — TN3179 says web-view traffic is exempt from local
  network privacy, Quinn says a web view in your app *is* your app for this purpose. Unresolved.
  It does not affect Safari proper.
- **Whether Chrome iOS and Brave iOS appear in Settings → Privacy & Security → Local Network**,
  and whether Safari itself does. Both are a thirty-second on-device check and worth doing
  before anyone repeats the claim either way.
- **Whether iOS 26 changed anything in the local network privacy model.** No Apple documentation
  of a change exists that I could find; TN3179, revised 2026-02-17, says nothing about it. There
  are forum anecdotes only, and they should be treated as anecdotes.
- **Whether the Home Hub 3000 has client isolation on by default**, or any user-facing toggle
  for it. No authoritative source either way; users report being unable to find such a setting.
  One DSLReports thread whose title matches the symptom exactly
  (`dslreports.com/forum/r33112439`) returned HTTP 503 on every attempt and was never read. It
  does not change the recommendation — the python-server test already establishes the behaviour
  empirically — but it is the one unread source that was directly on point.
- **Whether the Bell Home Hub 3000 performs NAT hairpinning**, which is what would decide
  whether STUN alone could ever work there. Not documented anywhere I could find.
- **Any published figure for how common client isolation is on home networks.** I do not think
  one exists. The only usable signal is that it is not normally a default on consumer equipment.
- **Exactly which mechanism suppressed the SYN**, and as argued above this is not knowable from
  a capture taken on the Mac alone. Client isolation is the strongly-supported reading, and the
  bare-python-server test is what makes it strong.
- **Whether WebKit's Local Network Access work will ever apply to a page served from a private
  IP fetching back to the same private IP.** The specification's model says no. The
  implementation is in progress. I would not bet the architecture on it.
- **Several comparable products were not reached.** TouchOSC, Lemur, Duet Display, Luna Display,
  obs-websocket remote-control apps, Audiomovers Listento, Ableton Note, and — the one I most
  wanted — **REAPER's built-in web remote control**, which is architecturally almost identical
  to today's phone remote and would have been the best available proxy for its real-world
  failure rate. The session's web-search budget ran out before that survey finished. The pattern
  in the products that *were* reached is consistent enough that I do not think more of them
  would change the recommendation, but that is a judgement, not a finding.
- **2026 pricing for some alternatives** — I verified Cloudflare TURN ($0.05/real-time GB
  outbound, free only alongside their SFU) from primary documentation, but VPS and
  Workers/Durable Objects figures quoted above are approximate and should be re-checked before
  anyone commits money.

---

## Sources

- Cloudflare, *TryCloudflare / Quick Tunnels* — https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- Cloudflare, *Realtime TURN* — https://developers.cloudflare.com/realtime/turn/
- cloudflared (Apache-2.0) — https://github.com/cloudflare/cloudflared
- Gradio, *Understanding Gradio Share Links* — https://www.gradio.app/guides/understanding-gradio-share-links
- Hugging Face FRP fork — https://github.com/huggingface/frp
- Gradio security advisory, SSH tunnelling → FRP — https://github.com/gradio-app/gradio/security/advisories/GHSA-3x5j-9vwr-8rr5
- Syncthing, *Relaying* — https://docs.syncthing.net/users/relaying.html
- Google, *AP Isolation mode* (Chromecast) — https://support.google.com/chromecast/answer/3222253?hl=en
- Google, *Trouble setting up Chromecast or Google Nest* — https://support.google.com/googlehome/answer/7300406?hl=en
- Cisco Meraki, *Wireless Client Isolation* (mechanism) — https://documentation.meraki.com/MR/Firewall_and_Traffic_Shaping/Wireless_Client_Isolation
- Apple, **TN3179 *Understanding local network privacy*** (rev. 2026-02-17; the rendered page is JS-only, the text is at the `tutorials/data/...json` endpoint) — https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
- Apple, WWDC 2020 *Support local network privacy in your app* — https://developer.apple.com/videos/play/wwdc2020/10110/
- Apple Developer Forums, Quinn on "Local network prohibited" — https://developer.apple.com/forums/thread/788044
- Apple Support, *Apple devices might not open your internal network's ".local" domain* — https://support.apple.com/en-us/101903
- Apple, *iCloud Private Relay Overview* (Dec 2021) — https://www.apple.com/privacy/docs/iCloud_Private_Relay_Overview_Dec2021.PDF
- Juniper Mist, *Isolation and Filtering* (isolation and broadcast filtering are separate knobs) — https://www.mist.com/documentation/isolation/
- Chromium blink-dev, *Intent to Ship: Local network access restrictions* — https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY
- WebKit PR #72725 / #74740 / standards-positions #520 — https://github.com/WebKit/WebKit/pull/72725 · https://github.com/WebKit/WebKit/pull/74740 · https://github.com/WebKit/standards-positions/issues/520
- Bell forum, *Split 2.4 GHz and 5 GHz bands on the Home Hub 3000/4000/Giga Hub* — https://forum.bell.ca/t5/internet/split-2-4-ghz-and-5-ghz-bands-on-the-bell-home-hub-3000-4000/td-p/53
- Use Your Loaf, *Remote packet capture for iOS devices (`rvictl`)* — https://useyourloaf.com/blog/remote-packet-capture-for-ios-devices/
- Apple, *Multipeer Connectivity* — https://developer.apple.com/documentation/multipeerconnectivity
- The Apple Wiki, *Apple Wireless Direct Link* — https://theapplewiki.com/wiki/Apple_Wireless_Direct_Link
- Chrome for Developers, *New permission prompt for Local Network Access* — https://developer.chrome.com/blog/local-network-access
- Chrome Platform Status, *Local network access restrictions* — https://chromestatus.com/feature/5152728072060928
- WICG, *Private Network Access permission prompt explainer* — https://github.com/WICG/private-network-access/blob/main/permission_prompt/explainer.md
- WebKit PR #74003, *Record Local Network Access permission decisions* — https://github.com/WebKit/WebKit/pull/74003
- MDN, *Crypto.subtle* — https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle
- W3C, *Secure Contexts* — https://www.w3.org/TR/secure-contexts/
- FSF, *VLC developer takes a stand against DRM enforcement in Apple's App Store* — https://www.fsf.org/blogs/licensing/vlc-enforcement
- Beeper developer docs, *Remote access via Cloudflare* — https://developers.beeper.com/desktop-api/advanced/remote-access/cloudflare/
