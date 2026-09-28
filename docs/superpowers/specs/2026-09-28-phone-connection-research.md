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
2. **The class of solution that does work on his network is also already known — and it is a
   relay.** Tailscale works there; the codebase says so in two places. And Tailscale's own
   description of how it works is that *every* connection begins on a DERP relay and upgrades
   to direct only if NAT traversal succeeds — **if it never succeeds, traffic stays on DERP
   indefinitely** ([Tailscale, *How NAT traversal
   works*](https://tailscale.com/blog/how-nat-traversal-works)). On a client-isolated LAN it
   never succeeds. So the thing already working on his network today is a relayed path out
   through the gateway. The question is not *whether* that shape works — it is already proven,
   by him, this week — it is only which one to build so he can stop depending on someone
   else's. That is an unusually strong position to be recommending from.
3. **Among gateway-exiting paths, a tunnel is the only one that costs nothing to run, nothing
   to operate, and almost nothing to build**, because it reuses the existing HTTP server and
   the 2282-line page verbatim. WebRTC, a relay, and a native app all cost substantially more
   and, on his specific network, arrive at the same place.

**Second choice, and its trigger:** own the far end himself. Two shapes, and the research
changed which one I would pick. The obvious one is the Gradio/Hugging Face model — an **FRP
server on a €5-a-month VPS** — which needs no page changes at all but makes him a sysadmin
forever. The better one, if it ever comes to this, is a **WebSocket relay on Cloudflare Workers
+ Durable Objects**: Durable Objects have had a free tier since April 2025, and Cloudflare
charges **nothing for bandwidth**, which is the only cost driver this workload has. That one can
plausibly run at zero with no box to patch — but it is the single option that requires
rewriting the phone page. Switch to either if Cloudflare withdraws quick tunnels, if the
in-flight limit bites, or if he decides he is unwilling to route other people's control traffic
through a third party. The point of the seam in the recommendation is that the first switch
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
| **REAPER web remote** — the closest architectural twin to ours | plain HTTP, port 8080, **no discovery at all** (no Bonjour, mDNS, UPnP or NAT-PMP anywhere in its changelog), optional password off by default | `rc.reaper.fm` — a **rendezvous redirect**, not a relay: a permanent short URL that resolves to your current LAN IP, keyed by public IP. Fixes address churn only. Nothing for isolation. | browser |
| **OBS / obs-websocket** | `ws://` on 4455, password auth, LAN only | nothing. Issues get closed with "please use the discord" | browser or native |
| **Ableton Link** | custom **UDP multicast** to `224.76.78.75:20808` (verifiable in [the source](https://github.com/Ableton/link)) | **no fallback at all.** The UI shows a peer count, which conflates "nobody is running Link" with "your packets are being dropped." Their docs instead list [five router-free paths](https://help.ableton.com/hc/en-us/articles/360003279779) — ad-hoc network, router with no WAN, direct Ethernet, Lightning cable | native |
| **Ableton Note** | **split architecture**: timing over Link on the LAN, **content transfer over Ableton Cloud** | n/a — the heavy path never used the LAN ([docs](https://help.ableton.com/hc/en-us/articles/6121083513756)) | native |
| **Audiomovers Listento** | **deliberately not P2P** — a dozen global servers, custom protocol over ports 80/443, chosen explicitly to avoid NAT/firewall problems | n/a; there is no LAN path to fail | browser on both ends — a direct consequence of going cloud-relay |
| **TouchOSC / Lemur** | OSC over UDP, Zeroconf discovery (TouchOSC) | manual IP entry, plus a "Network Info" dialog showing the machine's own addresses. Hexler says outright that discovery *"can not always work reliably"* | native |
| **Logic Remote** | Bonjour + native app *(inferred — Apple publishes no transport description and Logic Remote is absent from Apple's own port list)* | nothing. [Apple KB 101940](https://support.apple.com/en-us/101940) is a six-item checklist; Apple's fallback for the unsupported case is "use a VNC app" | native only |
| **Cubase iC Pro** | Bonjour + SKI Remote extension | manual IP entry — **with the desktop showing its own IP next to the field**. The most thorough troubleshooting article in the survey ([Steinberg](https://helpcenter.steinberg.de/hc/en-us/articles/206531824)) | native |
| **Luna Display** | Bonjour, with **five transports** including true peer-to-peer, USB, Thunderbolt, Ethernet | **QR-code manual connect**, and "cable kickstart" — connect by wire once, then unplug. Says the cause in plain English: *"Router restrictions… prevent devices on the same network from talking to each other"* ([Astropad](https://support.astropad.com/en/articles/11835445)) | native |
| **Duet Display** | originally **cable only, on purpose**; Duet Air added wireless with an account and a rendezvous service | manual checklist. Their documented workaround for restricted networks is *"enabling the laptop's hotspot"* | native |
| **LocalSend** — closest open-source analogue | UDP multicast `224.0.0.167:53317` + HTTP/TCP, plus an **"HTTP legacy mode"** that scans every local IP when multicast fails | strictly LAN, no relay — but **names the cause in its README**: *"Make sure to disable AP-Isolation on your router"* | native |
| **PairDrop / Snapdrop** | WebRTC, peers grouped by **public IP** as seen by the signalling server | public instance has TURN and it rescues the transfer; **the shipped self-host default is STUN-only and the transfer just dies.** The WebSocket path is chosen by capability, not as a failure fallback — [that is an open issue since 2023](https://github.com/schlagmichdoch/PairDrop/issues/228) | browser (PWA) |
| **Syncthing** | direct TCP/QUIC; local discovery by broadcast/multicast; global discovery over HTTPS | falls back to a **community relay pool**, end-to-end encrypted so the relay sees only ciphertext; **periodically retries direct and drops the relay when it succeeds**; and the UI literally shows `Relay (Client)` as the connection type ([docs](https://docs.syncthing.net/users/relaying.html), [relay spec](https://docs.syncthing.net/specs/relay-v1.html)) | native |
| **Plex** | a **cloud candidate directory plus client-side racing** — the server publishes its reachable addresses to plex.tv and clients try local → remote → relay | **Plex Relay**: outbound from the server, TLS not terminated by Plex, deliberately capped at 2 Mbps per stream and no downloads, so it stays a last resort ([docs](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/)) | both |
| **Chrome Remote Desktop** | the only full **ICE ladder** in the survey — Direct → STUN → TURN, UDP preferred with TCP fallback, all documented | relays through Google data centres automatically. **No user-facing indication of which rung you are on** ([Google](https://support.google.com/chrome/a/answer/16364503)) | native host, browser client |
| **VS Code Remote Tunnels** | **relay only.** *"VS Code will make outbound connections to a service hosted in Azure; no firewall changes are generally necessary, and VS Code doesn't set up any network listeners"* ([docs](https://code.visualstudio.com/docs/remote/tunnels)) | n/a — there is no direct path to fail | browser or native |
| **Home Assistant / Nabu Casa** | LAN HTTP, plus an **always-on opt-in outbound tunnel** ([SniTun](https://github.com/NabuCasa/snitun), an SNI-routed TCP multiplexer; the TLS key never leaves the user's box) | nothing switches automatically — the cloud path is parallel, not a fallback. The companion app picks internal vs external URL by **SSID/BSSID**, not by probing | browser |
| **Gradio `share=True`** | none — goes straight out | downloads a modified **FRP client** on first use and tunnels to Hugging Face's share server; random `*.gradio.live` subdomain; 72-hour expiry; self-hostable ([docs](https://www.gradio.app/guides/understanding-gradio-share-links), [huggingface/frp](https://github.com/huggingface/frp)) | browser |
| **Chromecast / Google Home** | mDNS on the LAN, nothing else | **tells the user to turn off AP isolation on their router**, and says plainly that on a guest, hotel or public network *"you won't be able to set up your device"* ([Google](https://support.google.com/googlehome/answer/7300406)) | native |
| **Sonos** | SSDP/UPnP multicast | declares the offending topologies **unsupported** rather than diagnosing them — guest networks, extenders, EOP, VPNs blocking local resources ([system requirements](https://support.sonos.com/en-us/article/sonos-system-requirements)). Notably, Sonos has **never** used the words "AP isolation" in official documentation | native |
| **Beeper desktop API** | — | recommends bundling a **Cloudflare quick tunnel** for remote access to a local desktop app ([docs](https://developers.beeper.com/desktop-api/advanced/remote-access/cloudflare/)) | browser |

Five things fall out of that table, and they are what actually drive the recommendation.

**1. LAN-only products do not solve this; they hand it to the user.** Chromecast and Sonos are
two of the best-resourced consumer products in the category, they hit precisely this failure,
and after a decade their answers are still "change your router setting" and "that topology is
unsupported." That is the ceiling on LAN-only — and it is explicitly ruled out here, because the
brief forbids asking the user to change a setting.

**2. The closest twin to our design has the same problem, and mostly does not fix it.** REAPER's
web remote is a plain LAN HTTP server on a fixed port with no discovery — architecturally almost
identical to the phone remote. Roughly fifteen distinct "won't load on my phone" threads run
from 2011 to 2024 across r/Reaper and the Cockos forum, and **in the majority nobody ever
confirms a fix**; the modal outcome is the poster going quiet or being told it is "a home
networking question, not a Reaper question." The cleanest case is
[r/Reaper `mntq28`](https://www.reddit.com/r/Reaper/comments/mntq28/): *"seems all devices … can
see the printer, but none of them can see each other"* → *"Well, there you go. I'd look at the
router config."* Unresolved. The important methodological note is that this cause is usually
**correct but unnamed**, so searching forums for "AP isolation" badly undercounts it.

REAPER *does* have one thing we do not: `rc.reaper.fm`, a permanent short URL that redirects to
the machine's current LAN address. It is a **rendezvous directory, not a relay** — traffic never
touches Cockos — and it solves address churn, which is the same problem `.local` solves. It does
nothing for isolation. Its error string is, however, a small masterpiece of legible failure:
*"Either the ID is incorrect, or this device is not connected to the same local network as the
computer running REAPER."*

**3. Music tooling has already gone relay-first when it mattered.** Audiomovers Listento is a
professional audio product that chose *not* to do peer-to-peer at all, running everything
through its own servers on ports 80 and 443 specifically so that no network configuration is
ever required. Ableton Note splits it: timing over Link on the LAN, content over Ableton Cloud.
Neither treats the LAN as something that can be relied on for the part that must work.

**4. Everyone's real escape hatch is "make your own network," and everyone's real fallback is
manual address entry.** Duet tells users to enable the laptop's hotspot; PairDrop's FAQ says the
same; Lemur *prefers* ad-hoc to a router; Ableton documents five router-free paths; Sonos says
wire it. And the quality of a product's documentation tracks exactly how well it supports typing
an address by hand. **Cubase iC Pro shows the Mac's own IP next to the manual-entry field** —
which is, essentially, the address picker that shipped in `a8746a1` and `9aa18a6`. That work was
the right instinct and matches the best practice in the category; it simply cannot reach across
a layer-2 block.

**5. The one gap nobody has filled — and it is cheap for us.** The failure signature that
matters here is **"found but unreachable,"** not "not found." AP isolation produces it; so does
Firefox's mDNS ICE-candidate obfuscation in PairDrop's case. **No product in this survey
distinguishes the two.** Syncthing comes closest by naming the mode it ended up in (`Relay
(Client)` in the UI, with an FAQ explaining that this means a direct connection could not be
established). That is the model worth copying, and it is free once a fallback exists.

---

## The options, honestly

### 1. Plain LAN HTTP — what ships today

**Real-world failure rate: low but unknowable, and he is inside it.** There is no published
figure for how many home networks have client isolation on, and I do not believe one exists.
Two usable signals instead:

- Negative evidence: network engineers observe that AP isolation is not normally on by default
  on home equipment, because it would generate enormous support load. It *is* normally on for
  guest SSIDs, hotel and public networks, and Wi-Fi extenders.
- **The best available proxy is REAPER's web remote**, which is the same architecture. Fifteen
  or so "won't load on my phone" threads over thirteen years is not a catastrophe — but the
  majority end unresolved, and the cause is usually correct-but-unnamed. Read as a rate: this
  fails for a small minority of people, and when it fails it tends to stay failed.

The honest summary is that the LAN path is fine for most people and a dead end for the rest,
with no way to tell in advance which you are. Elling is in the second group.

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
- **Server-reflexive candidates via STUN**: both peers discover the *same* public address, so
  reaching each other requires the router to hairpin. **This was researched properly and the
  answer is no, do not rely on it**, for two independent reasons:
  - Hairpinning is *mandatory* under [RFC 4787 REQ-9](https://datatracker.ietf.org/doc/html/rfc4787)
    and compliance is not universal. Comcast/Xfinity
    [deliberately disable it](https://forums.xfinity.com/conversations/your-home-network/whats-the-deal-with-hairpin-natloopback-being-disabled/666481689e1ca35abf349c72);
    OpenWrt's own conformance testbed has [an open REQ-9
    failure](https://gitlab.com/ynezz/openwrt-testbed/-/issues/273). The WebRTC team's standard
    diagnosis of exactly this symptom is ["your NAT doesn't support
    hairpinning"](https://groups.google.com/g/discuss-webrtc/c/fP20Q9le4V8). **No 2020s
    measurement study gives a prevalence figure** — treat any number you see as unverified.
  - And there is a second gate that closes it regardless: even where the router hairpins, the
    reflected packet still has to be **delivered to the other wireless client**, and under
    client isolation that is precisely the delivery that is denied
    ([Meraki](https://documentation.meraki.com/Wireless/Operate_and_Maintain/How_Tos/Firewall_and_Traffic_Shaping/Wireless_Client_Isolation),
    [Aruba](https://arubanetworking.hpe.com/techdocs/central/2.5.8/content/nms/access-points/cfg/networks/client-isolation.htm)).
- **Relay candidates via TURN**: these work, and they work **even though both peers are behind
  the same NAT** — each peer makes its own allocation over its own client→gateway path, so no
  hairpinning is involved.

So on a client-isolated LAN, **ICE falls all the way to TURN with no intermediate state.** That
is not a hedge; it is the documented behaviour of the filter. Then:

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

**Others considered:**

- **ngrok is disqualified on numbers, not on taste.** The 2026 free plan requires an account and
  authtoken, and allows **20,000 HTTP requests per month** with an interstitial page on every
  HTTP endpoint ([pricing](https://ngrok.com/pricing)). This page polls every 700 ms — about
  5,100 requests an hour — so a free ngrok account is exhausted in under four hours of use, and
  every end user would need their own account. (The ngrok agent's own licence text was not
  verified; it does not matter given the above.)
- **`localhost.run` and Pinggy** are small operations with the same withdrawal risk as
  Cloudflare and none of the scale.
- **A naive `ssh -R`** to a host of his own is tempting because macOS already ships `ssh` and
  nothing would need bundling — but Gradio moved *off* SSH tunnelling to FRP partly for security
  reasons
  ([GHSA-3x5j-9vwr-8rr5](https://github.com/gradio-app/gradio/security/advisories/GHSA-3x5j-9vwr-8rr5)),
  which is worth reading before repeating it.

**One thing to note about runtime download versus bundling:** Gradio downloads the FRP binary on
first use. On Apple Silicon every executable must be at least ad-hoc signed to run at all, so a
binary fetched at runtime is a quarantine and signing problem. Bundle it, the way rubberband is
bundled. It costs bundle size — tens of megabytes per architecture — and nothing else.

### 6. A rendezvous/relay server he runs himself — the second choice

Two shapes, and the research changed which one is better.

**Shape A — run an FRP server on a VPS** (the Gradio/Hugging Face stack, open source and
documented for self-hosting) and keep the tunnel client design above completely unchanged. No
page rewrite, proven code, and a box you own. 2026 prices, checked:
[Hetzner](https://www.hetzner.com/cloud/cost-optimized/) raised prices on 15 June 2026 —
CAX11 (ARM) €5.99/month, CX23 €5.49/month, both excluding IPv4, with 20 TB of included EU
traffic; Linode/Akamai Nanode $5/month with 1 TB; DigitalOcean $4/month with 500 GB;
[Fly.io](https://fly.io/pricing) shared-cpu-1x at roughly $1.94/month plus $0.02/GB egress;
Railway now $1/month after a 30-day trial. **The money is not the problem.** The problem is that
a box has to be patched, watched, renewed and paid for by one person indefinitely, and when it
falls over on a Saturday the feature is broken for everyone.

**Shape B — a WebSocket relay on Cloudflare Workers + Durable Objects, which can genuinely cost
nothing.** This was the surprise of the research. Durable Objects have been on the **free plan
since April 2025** (SQLite-backed):
[100,000 DO requests/day, 13,000 GB-s/day, 5 GB of storage](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/).
On the paid plan the account minimum is $5/month. Two details make it fit this workload almost
suspiciously well
([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)):

- **There is no bandwidth charge at all** — verbatim, *"There are no additional charges for data
  transfer (egress) or throughput (bandwidth)."* The 11.3 MB wavs, which are the cost driver
  everywhere else on this page, are free here.
- Over WebSockets, outgoing messages are free and incoming are billed at a 20:1 ratio, so a
  700 ms poll converted to a push costs very little.

**One hard requirement if this is ever built:** use the **WebSocket Hibernation API**
(`state.acceptWebSocket()`), not `ws.accept()`. With plain `accept()`, an idle 30-minute session
burns roughly 225 GB-s and blows the free duration cap on its own; Cloudflare's own worked
example is $20.65/month with hibernation against $142.95/month without, for identical work.

**What Shape B costs instead of money:** it is the one option that **requires rewriting the
phone page**, because the page would stop talking to a same-origin HTTP server and start talking
through a relay. That is the 2282-line string and its 700 ms polling loop. Against that: no
server to patch, no renewal, no Saturday outage that is his to fix, and plausibly a bill of
zero.

Syncthing solves the operator problem with a donated community relay pool; Hugging Face solves
it by being a company. Neither is available here — but Shape B is the closest thing to solving
it by not having a server at all.

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
   certificate for `192.168.2.151`. Plex solves this with the **`plex.direct` trick**, and it is
   worth understanding concretely because it is the only real answer to this problem:

   Plex runs a DNS zone in which any name of the form `<dashed-ip>.<hash>.plex.direct` resolves
   to that IP — including private ones. `192-168-1-50.625d…89.plex.direct` returns
   `192.168.1.50`. Each server gets **its own** wildcard certificate for `*.<hash>.plex.direct`,
   and both the certificate and its private key are delivered to the user's machine. Clients
   learn the server's addresses from plex.tv and connect to the matching `plex.direct` name, so
   the hostname matches the certificate on LAN and WAN alike with no DNS propagation wait.
   Originally DigiCert-issued; Plex's current documentation says Let's Encrypt.
   ([Filippo Valsorda's writeup](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/),
   [Plex](https://support.plex.tv/articles/206225077-how-to-use-secure-server-connections/).)

   Two caveats carried from the research. It is textbook **DNS-rebinding shape**, so Pi-hole,
   NextDNS and router rebinding protection routinely break it — which is why Plex ships dnsmasq
   and unbound snippets and a server setting called "Treat WAN IP As LAN Bandwidth" to
   compensate. And the precedent for shipping key material is poor: SEC Consult found Plex
   shipping an extractable private key for `*.hub.plex.tv` in 2014 and the certificate was
   revoked; the per-server hash in `plex.direct` is the fix for exactly that.

   **This is not worth doing here.** It needs a domain, a DNS zone, per-user certificate
   issuance and key distribution — a whole subsystem. A tunnel gives browser-trusted HTTPS for
   free, which is one more argument for it.

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
(Chrome's Local Network Access work does grant a mixed-content exemption for private-IP
literals and `.local` names — but that is Chrome on desktop and Android, and WebKit has not
implemented LNA, so there is no such exemption on any iOS browser. This is also the wall OBS
Tablet Remote hits, and it says so on its own landing page.) The observation therefore has to
come from which QR the user ended up using, not from a fetch.

**What good products say.** The survey answer is blunt: **nobody diagnoses the network for the
user.** The best anyone does is enumerate suspects and then hand it over. The observed ranking:

- **Syncthing is the best**, and it is best for one reason: it **names the mode it ended up in**.
  The UI's connection type reads `Relay (Client)`, and the FAQ says that means a direct
  connection could not be established. It does not diagnose the router; it tells you truthfully
  which path you are on and lets you draw the conclusion.
- **Plex** has the best written diagnosis anywhere — its remote-playback requirements page
  explicitly lists *"restrictions on devices being able to see each other"* and *"privacy /
  security settings … that do not allow making local network connections"* — but a weak in-app
  signal (an undocumented "Indirect" label).
- **Luna Display** says it in one plain sentence: *"Router restrictions might disable Apple
  Bonjour … or prevent devices on the same network from talking to each other."*
- **Google** is the only vendor here that names the cause and the remedy outright — and the
  remedy is a router setting, which is what this brief forbids.
- **Chrome Remote Desktop** is the worst: a full documented ICE ladder and no user-facing
  indication whatsoever of which rung you are on.
- **All of music tooling** — REAPER, OBS, Ableton Link, TouchOSC, Logic Remote — says nothing.
  Link's peer count actively conflates "nobody is running Link" with "your packets are dropped."

**And the gap worth taking: no product in this survey distinguishes *found but unreachable* from
*not found*.** That is exactly this failure's signature, and it is the cheapest differentiator
available — and it becomes nearly free the moment a fallback exists, because arriving over the
fallback while the LAN path stays silent *is* the distinction, observed rather than inferred.
Copy Syncthing: say which path you are on.

**Which means the strongest argument for the recommendation is also the answer to this section:**
the best diagnosis is not needing one. The three lines added in `af9899b` are the right amount
of honesty for the LAN path and should stay. Building a cleverer detector for a LAN-only app is
effort spent explaining a failure instead of removing it.

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

**The second choice, for comparison:**

- *FRP on a VPS:* the client work is nearly identical to the recommendation, plus a server, plus
  FRP configuration, plus a domain, plus patching and uptime forever. Roughly €5–6/month and an
  open-ended obligation.
- *Cloudflare Workers + Durable Objects:* plausibly $0/month and nothing to patch, but it is the
  one option that requires rewriting the phone page off same-origin polling and onto a relayed
  WebSocket — and it must use the hibernation API or the free tier evaporates.

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
- **A true failure *rate* for REAPER's web remote.** There is no denominator. The honest claim
  is "roughly fifteen distinct unresolved-or-network-diagnosed threads over thirteen years
  across three venues, with maintainers consistently treating it as out of scope."
- **Logic Remote's actual transport.** Apple publishes nothing, and Logic Remote does not even
  appear in Apple's own port list. Bonjour plus a proprietary session protocol is well-supported
  inference, not documented fact.
- **Whether Duet Air relays pixels or only signalling**, and whether Luna Display's
  peer-to-peer mode is AWDL specifically. Neither vendor publishes a protocol description.
- **An official Plex definition of "Indirect"** — the word appears in their UI and in no
  document.
- **2026 pricing for a few things.** I verified Cloudflare TURN ($0.05/real-time GB
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
- Syncthing, *Relay protocol v1* — https://docs.syncthing.net/specs/relay-v1.html
- Syncthing, *Firewall setup* — https://docs.syncthing.net/users/firewall.html
- Tailscale, *How NAT traversal works* (every connection starts on DERP and stays there if direct never succeeds) — https://tailscale.com/blog/how-nat-traversal-works
- Apple Developer Forums, Quinn, *Wi-Fi Fundamentals* ("some APs refuse to forward STA-to-STA traffic") — https://developer.apple.com/forums/thread/45283
- Meraki, *Wireless Client Isolation* — https://documentation.meraki.com/Wireless/Operate_and_Maintain/How_Tos/Firewall_and_Traffic_Shaping/Wireless_Client_Isolation
- HPE Aruba Networking, *Client isolation* — https://arubanetworking.hpe.com/techdocs/central/2.5.8/content/nms/access-points/cfg/networks/client-isolation.htm
- RFC 4787 (REQ-9, hairpinning) — https://datatracker.ietf.org/doc/html/rfc4787
- Xfinity forum, hairpin NAT deliberately disabled — https://forums.xfinity.com/conversations/your-home-network/whats-the-deal-with-hairpin-natloopback-being-disabled/666481689e1ca35abf349c72
- OpenWrt testbed, open RFC 4787 REQ-9 failure — https://gitlab.com/ynezz/openwrt-testbed/-/issues/273
- discuss-webrtc, "your NAT doesn't support hairpinning" — https://groups.google.com/g/discuss-webrtc/c/fP20Q9le4V8
- REAPER User Guide v7.80 §15.31 (web browser interface) — https://www.reaper.fm/userguide/ReaperUserGuide780.pdf
- r/Reaper, *Web Control not working on other devices* — https://www.reddit.com/r/Reaper/comments/mntq28/
- r/Reaper, AP-isolation mention — https://www.reddit.com/r/Reaper/comments/jo3mki/
- obs-websocket — https://github.com/obsproject/obs-websocket · OBS Tablet Remote's mixed-content warning — https://t2t2.github.io/obs-tablet-remote/
- Ableton, *Link troubleshooting* — https://help.ableton.com/hc/en-us/articles/209073069-Link-Troubleshooting · *connecting without a router* — https://help.ableton.com/hc/en-us/articles/360003279779 · Link source — https://github.com/Ableton/link
- Ableton Note / Ableton Cloud — https://help.ableton.com/hc/en-us/articles/6121083513756
- Audiomovers Listento — https://audiomovers.com/listento *(site is JS-rendered and its help URLs have moved; quotes came from indexed copies, not pages loaded directly — verify before reusing)*
- Hexler, *TouchOSC — OSC connections* — https://hexler.net/touchosc/manual/connections-osc
- Apple, *If you can't connect Logic Remote to your Mac* — https://support.apple.com/en-us/101940
- Steinberg, *Cubase iC Pro troubleshooting* — https://helpcenter.steinberg.de/hc/en-us/articles/206531824-Cubase-iC-Pro-troubleshooting
- Astropad, *Luna Display Wi-Fi connection troubleshooting* — https://support.astropad.com/en/articles/11835391-wifi-connection-issues-troubleshooting
- Duet Display, connecting wirelessly — https://www.duetdisplay.com/help-center/connecting-to-duet-for-android-wirelessly
- LocalSend protocol (and its README naming AP isolation) — https://github.com/localsend/protocol
- PairDrop `server/peer.js` (public-IP room keying) — https://github.com/schlagmichdoch/PairDrop/blob/master/server/peer.js · issue #228, the WebSocket path is not a failure fallback — https://github.com/schlagmichdoch/PairDrop/issues/228
- Plex, *Using plex.tv resources information to troubleshoot app connections* — https://support.plex.tv/articles/206721658-using-plex-tv-resources-information-to-troubleshoot-app-connections/
- Plex, *Requirements for remote playback* ("restrictions on devices being able to see each other") — https://support.plex.tv/articles/requirements-for-remote-playback-of-personal-media/
- Plex, *Accessing a server through Relay* — https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/
- Plex, *How to use secure server connections* — https://support.plex.tv/articles/206225077-how-to-use-secure-server-connections/
- Filippo Valsorda, *How Plex is doing HTTPS for all its users* — https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/
- Sonos, *System requirements* (unsupported topologies) — https://support.sonos.com/en-us/article/sonos-system-requirements · Ruckus KB 000006140 (names client isolation, as a network vendor rather than Sonos) — https://support.ruckuswireless.com/articles/000006140
- Chrome Remote Desktop network guide (Direct / STUN / TURN) — https://support.google.com/chrome/a/answer/16364503
- VS Code Remote Tunnels — https://code.visualstudio.com/docs/remote/tunnels
- Nabu Casa, *Remote access deep dive* — https://github.com/NabuCasa/support/blob/main/src/cloud/remote-access/remote-access-deep-dive.md · SniTun — https://github.com/NabuCasa/snitun
- Home Assistant companion app, networking (SSID/BSSID-based URL switching) — https://companion.home-assistant.io/docs/troubleshooting/networking/
- ngrok pricing (20,000 HTTP requests/month on the free plan) — https://ngrok.com/pricing
- Cloudflare, *Durable Objects free tier* — https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/ · *Durable Objects pricing* (no egress charge; WebSocket hibernation) — https://developers.cloudflare.com/durable-objects/platform/pricing/
- Hetzner 2026 price adjustment — https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ · https://www.hetzner.com/cloud/cost-optimized/
- Fly.io pricing — https://fly.io/pricing
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
