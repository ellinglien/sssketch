# Phone tunnel fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the wifi will not carry it, the phone remote can be reached from the internet
instead — through a `cloudflared` quick tunnel that is off by default, explicitly started,
consented to once, controls-only, and gone the moment it is not wanted.

**Architecture:** Three phases. **Phase A is the security precondition** — the Host guard gains a
second, single-literal door and the server gains a 128-bit single-use capability grant with
desktop approval, while nothing user-visible changes, because none of it may land after a public
URL exists. **Phase B is the tunnel** — a one-function seam (`TunnelProvider`), a `cloudflared`
binary downloaded on demand and signature-checked, a subprocess with four layers of
die-with-the-app, the consent copy, and the audio routes refusing the tunnel door. **Phase C is
the honest extras** — naming which path the phone arrived on (Syncthing's lesson), and a two-hour
idle stop.

**Tech Stack:** TypeScript, Node (Electron main), React 19, vitest. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-09-28-phone-tunnel-fallback-design.md` (2026-09-28). Its §10
"not now" list is the scope boundary — **if something is not named as in, it is out.**
Input research: `docs/superpowers/specs/2026-09-28-phone-connection-research.md`.

**Elling's brief, verbatim:** *"i like the cloudflare idea.. can we implement that too?"*

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. `EngineProject` /
`buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and **this plan changes neither.**

**NO PACKAGING CHANGES.** `electron-builder.yml`, `build/afterPack.js` and
`.github/workflows/release.yml` are **not touched** by any task here. That is a deliberate
consequence of the download-on-first-use recommendation (spec §3.3), not an oversight. If Task 7's
step 1 finding flips that recommendation, **STOP and report it** rather than quietly editing the
signed build.

**Baseline to hold:** 198 files / 3171 tests green, `npm run typecheck` 0 errors, `npm run lint`
0 errors + **4 pre-existing prettier warnings** (those 4 are the baseline — not to fix, not to add
to). **Re-measure `npm test` on whatever commit you actually start from** and hold the *delta*:
this plan adds **5 new test files** and **zero newly-failing tests**.

**`src/main/remoteServer.test.ts` is FLAKY in the full parallel run and green in isolation** — it
binds a real HTTP port and a colliding worker takes the whole file down. If the full suite reports
failures only in that file, re-run it alone (`npx vitest run src/main/remoteServer.test.ts`) and
treat a clean isolated run as green. **No other file may fail.**

---

## Findings that shaped this plan — read these before Task 1

1. **Every tunnelled request 403s today, for two independent reasons.** `isAllowedHost`
   (`src/shared/remoteAuth.ts`) does `if (separator <= 0) return false` — *"No port in the header
   is not this server"* — and a browser on `https://x.trycloudflare.com` sends `Host:
   x.trycloudflare.com` with **no port**, because 443 is the scheme default. And `matchableEntry`
   admits only an IPv4 literal or a single-label `.local`, so the hostname could never join the
   list anyway.

2. **`isAllowedHost` is NOT modified by this plan, and that is the design.** Its tests assert five
   refusal classes (every name; a non-IP non-`.local` list entry; another machine's address; the
   right address on the wrong port *and* a missing port; a machine with no addresses). A second
   function beside it keeps all five true by construction. **If you find yourself editing
   `isAllowedHost`'s body, you have taken a wrong turn.**

3. **`matchableEntry` makes the *wrong* way to do this fail closed.** Pushing the tunnel hostname
   into `ownAddresses` silently does nothing, because it is neither an IPv4 literal nor a
   single-label `.local`. Task 1 has a test asserting exactly that, as defence-in-depth against a
   future change.

4. **No suffix matching, ever.** `endsWith('.trycloudflare.com')` would admit every *other*
   person's quick tunnel — that is the real hole available here. `src/shared/remoteAuth.ts` must
   not contain the string `trycloudflare` at all; the provider-specific shape lives in the parser
   (Task 6).

5. **`node:crypto` is not importable from `src/shared/`.** It is imported by both main and
   renderer. So the timing-safe comparison stays in `remoteServer.ts` and the pure grant machine
   takes a `tokenMatches: boolean` — the same injection convention `newPairingCode(random)`
   already uses.

6. **The server already has everything the claim route needs.** `startRemoteServer` already holds
   a `tokens: Set<string>` and an `authorized()` bearer check, and `/api/pair` already mints
   `randomBytes(32).toString('hex')`. The claim route hands back **the same shape** so there is no
   second auth mechanism past the door.

7. **`getState()` has no request, so `via` cannot come from it.** `RemoteServerOptions.getState`
   is `() => RemoteStateResponse` and is built in `src/main/index.ts` with no knowledge of who is
   asking. Task 3 adds a separate wire type (`RemoteStateWire`) that the server spreads `via` into,
   so `src/main/index.ts`'s `getState` is untouched.

8. **`engineProcess.ts` is the subprocess pattern to copy, including the buffering bug it fixed.**
   It accumulates `stderrBuffer` across `data` events because *"OS pipe buffering can split one
   logical stderr write across multiple chunks"*. The tunnel parser has the identical exposure.
   Copy the shape: accumulate, test the running buffer, `cleanup()` that clears every timer,
   `SIGKILL` before rejecting.

9. **Real binaries with an injectable path override, never a mock of `child_process`.** CLAUDE.md:
   *"tests use a real compiled artifact via an injectable `binaryPathOverride`/similar rather than
   a fake."* Task 8 does this with a **stub shell script** written into a temp dir — a real
   subprocess, real pipes, real chunked stderr, no network and no third-party binary. Real
   `cloudflared` never runs in CI.

10. **`vitest.config.ts` is NOT touched.** Nothing here opens better-sqlite3. Stated deliberately,
    because a stale exclusion list silently broke every release for six weeks — but the rule is
    "add a file that opens the addon", and none of the three new main-process test files does.

11. **React components are not unit-tested in this codebase** (CLAUDE.md). Tasks 4, 10 and 14 have
    **no component tests**, deliberately. They are verified by typecheck + lint + the suite staying
    green, then by Elling. **This environment has no GUI, no camera and no phone: no agent may
    claim to have scanned a QR code, seen a modal, or connected a phone.**

12. **The phone page is one constant string with a strict CSP** (`REMOTE_PAGE_CSP`:
    `default-src 'none'; … connect-src 'self'`). A tunnel is the **same origin**, so the CSP needs
    no change at all. Task 11 must not touch it.

13. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React
    effect (`react-hooks/set-state-in-effect`; the established workaround is deferring through
    `void Promise.resolve().then(...)`), on render-time impurity (`react-hooks/purity` — no
    `Math.random()`, `Date.now()` or `performance.now()` inside a component-scoped function), and
    requires an **explicit return type on every function**, inline ones included. Prettier:
    `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

14. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`): near-black monochrome,
    Silkscreen, **no `border-radius` anywhere** (`borderRadius: 0` is written explicitly on every
    button in `PhoneRemoteModal.tsx`), lowercase copy, no emoji, no exclamation marks, buttons two
    words max, tooltips two or three words. Colour only on things carrying audio information.

15. **The Matter/Thread cautionary tale, from the research:** a reference SDK whose cryptography
    was correct and whose lockout *"was not actually enforced, effectively nullifying the intended
    lockout."* **The test that proves the twenty-first claim stops the tunnel is written before the
    claim route.** Task 2 before Task 3, not negotiable.

---

## File map

**Create:**

| file | responsibility |
|---|---|
| `src/shared/capabilityGrant.ts` | the 128-bit grant's state machine: single use, expiry, attempt budget. Pure. |
| `src/shared/capabilityGrant.test.ts` | its tests |
| `src/shared/publicTunnel.ts` | the seam's types + `parseQuickTunnelUrl` + `shouldStopIdleTunnel`. Pure. |
| `src/shared/publicTunnel.test.ts` | its tests |
| `src/shared/cloudflaredRelease.ts` | the pinned version, the pinned SHA-256s, the asset name and URL, the team id. Pure. |
| `src/shared/cloudflaredRelease.test.ts` | its tests |
| `src/main/cloudflaredInstall.ts` | download, verify checksum, extract, verify signature, cache in userData |
| `src/main/cloudflaredInstall.test.ts` | its tests (local fixture, no network) |
| `src/main/cloudflaredTunnel.ts` | the `TunnelProvider` implementation: spawn, parse, teardown, pidfile, reaper |
| `src/main/cloudflaredTunnel.test.ts` | its tests (stub binary via `binaryPathOverride`) |
| `src/renderer/src/components/RemoteApprovalModal.tsx` | the desktop `allow once` prompt, its own modal |
| `PRIVACY.md` | what leaves the machine, and to whom |

**Modify:**

| file | change |
|---|---|
| `src/shared/remoteAuth.ts` | `+isAllowedTunnelHost`, `+isAllowedRequestHost`, `+RemoteVia`. `isAllowedHost` untouched. |
| `src/shared/remoteAuth.test.ts` | new describes, existing ones untouched |
| `src/shared/remoteState.ts` | `+RemoteStateWire` |
| `src/shared/phoneRemoteView.ts` | `+PhoneRemoteTunnelView`, `+tunnel` on `PhoneRemoteModalView`, `+TUNNEL_DISCLOSURE` copy |
| `src/shared/phoneRemoteView.test.ts` | new describes |
| `src/main/remoteServer.ts` | `tunnelHost` getter, `via`, `/api/claim`, `/api/pair` + audio routes refuse the tunnel door |
| `src/main/remoteServer.test.ts` | new describes |
| `src/main/phoneRemoteSettingsStore.ts` | `+tunnelConsentVersion` |
| `src/main/phoneRemoteSettingsStore.test.ts` | new describes |
| `src/main/index.ts` | tunnel state, IPC handlers, approval plumbing, `will-quit`, `powerMonitor`, `process.on('exit')` |
| `src/preload/index.ts` | the new IPC channels |
| `src/renderer/src/components/PhoneRemoteModal.tsx` | the tunnel block inside `not connecting?` |
| `src/main/remotePage.ts` | the `#k=` claim branch, and mixer-off over the tunnel |
| `README.md` | four sentences on the optional internet path |

**Not modified, deliberately:** `electron-builder.yml`, `build/afterPack.js`,
`.github/workflows/release.yml`, `vitest.config.ts`, `AI_DISCLOSURE.md`, anything under
`native-engine/`.

---

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run <path>       # one file
npm test                    # the whole suite
npm run typecheck           # both tsc configs
npm run lint                # eslint
```

---

# Phase A — the security precondition

**Phase A changes nothing a user can see.** Nothing sets a tunnel hostname yet, so the new door
refuses unconditionally and the app behaves bit-identically to today. **It must land first and
whole**: a public URL cannot be switched on above a 4-character code with a five-attempt session
lockout, and every part of Phase A is what replaces that on the tunnel path. Say this plainly to
Elling if he asks why the first phase ships nothing.

---

## Task 1: The tunnel's own door

**Files:**
- Modify: `src/shared/remoteAuth.ts`
- Modify: `src/shared/remoteAuth.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/remoteAuth.test.ts` (leave every existing `describe` and `it` exactly as it
is — Finding 2):

```ts
describe('isAllowedTunnelHost', () => {
  const TUNNEL = 'four-random-words.trycloudflare.com'

  it('refuses everything when no tunnel is running', () => {
    expect(isAllowedTunnelHost(TUNNEL, null)).toBe(false)
    expect(isAllowedTunnelHost('localhost:7373', null)).toBe(false)
    expect(isAllowedTunnelHost(undefined, null)).toBe(false)
  })

  it('admits the exact hostname, bare or on 443, case and space insensitive', () => {
    expect(isAllowedTunnelHost(TUNNEL, TUNNEL)).toBe(true)
    expect(isAllowedTunnelHost(`${TUNNEL}:443`, TUNNEL)).toBe(true)
    expect(isAllowedTunnelHost(`  ${TUNNEL.toUpperCase()}  `, TUNNEL)).toBe(true)
  })

  it('refuses any other port, which is what the LAN door is for', () => {
    expect(isAllowedTunnelHost(`${TUNNEL}:7373`, TUNNEL)).toBe(false)
    expect(isAllowedTunnelHost(`${TUNNEL}:80`, TUNNEL)).toBe(false)
    expect(isAllowedTunnelHost(`${TUNNEL}:`, TUNNEL)).toBe(false)
  })

  // THE HOLE THAT WOULD BE AVAILABLE HERE, closed by test.
  it('never suffix-matches, so nobody else quick tunnel is admitted', () => {
    expect(isAllowedTunnelHost('someone-else.trycloudflare.com', TUNNEL)).toBe(false)
    expect(isAllowedTunnelHost(`evil-${TUNNEL}`, TUNNEL)).toBe(false)
    expect(isAllowedTunnelHost(`${TUNNEL}.evil.com`, TUNNEL)).toBe(false)
    expect(isAllowedTunnelHost(`sub.${TUNNEL}`, TUNNEL)).toBe(false)
  })

  it('refuses a name an attacker does control', () => {
    expect(isAllowedTunnelHost('evil.example.com', TUNNEL)).toBe(false)
    expect(isAllowedTunnelHost('evil.example.com:443', TUNNEL)).toBe(false)
  })

  it('refuses an empty tunnel host, so a bad parse cannot open the door', () => {
    expect(isAllowedTunnelHost('', '')).toBe(false)
    expect(isAllowedTunnelHost('anything', '')).toBe(false)
  })
})

describe('isAllowedRequestHost', () => {
  const OURS = ['192.168.1.40', '100.66.121.12']
  const TUNNEL = 'four-random-words.trycloudflare.com'

  it('is bit-identical to isAllowedHost when no tunnel is running', () => {
    for (const header of [
      '192.168.1.40:7373',
      'localhost:7373',
      '192.168.1.99:7373',
      '192.168.1.40',
      'evil.example.com',
      TUNNEL
    ]) {
      expect(isAllowedRequestHost(header, OURS, 7373, null)).toBe(
        isAllowedHost(header, OURS, 7373)
      )
    }
  })

  it('opens the tunnel door without opening anything else', () => {
    expect(isAllowedRequestHost(TUNNEL, OURS, 7373, TUNNEL)).toBe(true)
    expect(isAllowedRequestHost('192.168.1.40:7373', OURS, 7373, TUNNEL)).toBe(true)
    // Still every refusal the LAN door makes.
    expect(isAllowedRequestHost('192.168.1.40', OURS, 7373, TUNNEL)).toBe(false)
    expect(isAllowedRequestHost('192.168.1.99:7373', OURS, 7373, TUNNEL)).toBe(false)
    expect(isAllowedRequestHost('evil.example.com', OURS, 7373, TUNNEL)).toBe(false)
    expect(isAllowedRequestHost('evil.example.com:7373', OURS, 7373, TUNNEL)).toBe(false)
  })

  // DEFENCE IN DEPTH. The wrong way to do this must do nothing at all --
  // matchableEntry already refuses anything that is not an ip literal or a
  // single-label .local, so a future `ownAddresses.push(tunnelHost)` fails
  // closed instead of opening a portless door.
  it('does nothing if the tunnel host is put on the address list by mistake', () => {
    expect(isAllowedRequestHost(TUNNEL, [...OURS, TUNNEL], 7373, null)).toBe(false)
    expect(isAllowedRequestHost(`${TUNNEL}:7373`, [...OURS, TUNNEL], 7373, null)).toBe(false)
  })
})

describe('remoteVia', () => {
  const OURS = ['192.168.1.40']
  const TUNNEL = 'four-random-words.trycloudflare.com'

  it('names the door a request came through', () => {
    expect(remoteVia('192.168.1.40:7373', OURS, 7373, TUNNEL)).toBe('lan')
    expect(remoteVia('localhost:7373', OURS, 7373, TUNNEL)).toBe('lan')
    expect(remoteVia(TUNNEL, OURS, 7373, TUNNEL)).toBe('tunnel')
  })

  it('is lan for anything that got through neither, so a refusal never reads as tunnelled', () => {
    expect(remoteVia('evil.example.com', OURS, 7373, TUNNEL)).toBe('lan')
  })
})
```

Add `isAllowedRequestHost`, `isAllowedTunnelHost` and `remoteVia` to the existing import block at
the top of the file.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/remoteAuth.test.ts`
Expected: FAIL — `isAllowedTunnelHost is not a function` (and the same for the other two).

- [ ] **Step 3: Implement**

Append to `src/shared/remoteAuth.ts`, **below** `isAllowedHost` and without touching it:

```ts
/** Which door a request came through. The phone page is told, so it can stop
 * being a mixer off-LAN (see RemoteStateWire), and the desktop is told, so it
 * can name the path the phone actually arrived on rather than guessing --
 * which is the one diagnostic no product in the research's survey offers. */
export type RemoteVia = 'lan' | 'tunnel'

/** THE TUNNEL'S OWN DOOR, and the whole of it.
 *
 * `tunnelHost` is the EXACT hostname our own tunnel process reported to us,
 * lowercased, or null when no tunnel is running -- in which case this refuses
 * everything and the surface does not exist.
 *
 * WHY THIS IS SAFE ON isAllowedHost'S OWN TERMS. That comment states the
 * property plainly: rebinding works by making A NAME THE ATTACKER CONTROLS
 * resolve to an address on the victim's network. This admits exactly one
 * name, and it is not a name an attacker controls -- it was assigned by the
 * provider to OUR tunnel, at OUR request, moments ago; it routes only to our
 * tunnel; and we compare against the literal string we were handed, never
 * against a pattern. An attacker who owns evil.example.com and points it at
 * 127.0.0.1 still sends `Host: evil.example.com`, which is not our literal,
 * and is refused here exactly as it is refused there.
 *
 * NO SUFFIX MATCHING, EVER. `endsWith('.trycloudflare.com')` would admit
 * every OTHER person's quick tunnel, which is the actual hole available in
 * this design. This file does not contain the name of any provider, and must
 * not gain one: the provider-specific hostname shape lives in
 * parseQuickTunnelUrl (src/shared/publicTunnel.ts) and nowhere else.
 *
 * THE PORT RULE IS INVERTED FROM isAllowedHost'S, DELIBERATELY. There the
 * rule is "no port in the header is not this server", because 7373 is never
 * a scheme default. Here the scheme IS https, 443 IS the default, and a
 * browser therefore sends no port at all. Bare host, or host:443. Nothing
 * else -- notably not :7373, which belongs to the other door. */
export function isAllowedTunnelHost(
  hostHeader: string | undefined,
  tunnelHost: string | null
): boolean {
  if (!hostHeader) return false
  if (tunnelHost === null) return false
  const expected = tunnelHost.trim().toLowerCase()
  if (expected === '') return false
  const host = hostHeader.trim().toLowerCase()
  if (host === expected) return true
  return host === `${expected}:443`
}

/** The one guard call the server makes. Either door, never a blend: neither
 * function can be persuaded to accept the other's shape, so widening one
 * cannot widen the other. */
export function isAllowedRequestHost(
  hostHeader: string | undefined,
  ownAddresses: string[],
  port: number,
  tunnelHost: string | null
): boolean {
  return (
    isAllowedHost(hostHeader, ownAddresses, port) || isAllowedTunnelHost(hostHeader, tunnelHost)
  )
}

/** Which door admitted this request. Only meaningful once
 * isAllowedRequestHost has already said yes; a request that got through
 * neither reads as 'lan', which is the conservative answer -- it means a
 * refusal is never reported as having arrived over the tunnel, and it means
 * the tunnel's own restrictions are never relaxed by a guess. */
export function remoteVia(
  hostHeader: string | undefined,
  ownAddresses: string[],
  port: number,
  tunnelHost: string | null
): RemoteVia {
  return isAllowedTunnelHost(hostHeader, tunnelHost) &&
    !isAllowedHost(hostHeader, ownAddresses, port)
    ? 'tunnel'
    : 'lan'
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/shared/remoteAuth.test.ts`
Expected: PASS, with **every pre-existing test in the file still passing** — in particular
`still refuses every name, which is what dns rebinding needs` and
`refuses the right address on the wrong port, and a missing port`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/remoteAuth.ts src/shared/remoteAuth.test.ts
git commit -m "a second door for the guard, admitting one literal name and nothing like it"
```

---

## Task 2: The capability grant

**Files:**
- Create: `src/shared/capabilityGrant.ts`
- Create: `src/shared/capabilityGrant.test.ts`

Finding 15: this task comes before the route that uses it, because the lockout is the part that
gets shipped broken.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/capabilityGrant.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_MAX_ATTEMPTS,
  CAPABILITY_TOKEN_BYTES,
  CAPABILITY_TTL_MS,
  capabilityUrl,
  evaluateClaim,
  markConsumed,
  newGrant,
  tunnelShouldStop,
  type CapabilityGrant
} from './capabilityGrant'

const T0 = 1_700_000_000_000
const TOKEN = 'FKcQ1t2u3v4w5x6y7z8A9B'

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return { ...newGrant(TOKEN, T0), ...overrides }
}

describe('the numbers', () => {
  it('is 128 bits, which is what a capability url needs', () => {
    expect(CAPABILITY_TOKEN_BYTES).toBe(16)
  })

  it('expires in ten minutes', () => {
    expect(CAPABILITY_TTL_MS).toBe(10 * 60 * 1000)
  })

  it('allows twenty wrong guesses and no more', () => {
    expect(CAPABILITY_MAX_ATTEMPTS).toBe(20)
  })
})

describe('evaluateClaim', () => {
  it('asks the mac when the token is right, fresh and unused', () => {
    const result = evaluateClaim(grant(), true, T0 + 1000)
    expect(result.outcome).toBe('approve-needed')
    expect(result.grant.failedAttempts).toBe(0)
  })

  it('counts a wrong token and says only that it was wrong', () => {
    const result = evaluateClaim(grant(), false, T0 + 1000)
    expect(result.outcome).toBe('wrong')
    expect(result.grant.failedAttempts).toBe(1)
  })

  // A wrong token must never learn WHY it would have failed anyway --
  // otherwise an expired or consumed grant is a probe for whether the real
  // one was ever used.
  it('says wrong, not expired, for a wrong token against an expired grant', () => {
    const result = evaluateClaim(grant(), false, T0 + CAPABILITY_TTL_MS + 1)
    expect(result.outcome).toBe('wrong')
  })

  it('says wrong, not consumed, for a wrong token against a used grant', () => {
    const result = evaluateClaim(markConsumed(grant()), false, T0 + 1000)
    expect(result.outcome).toBe('wrong')
  })

  it('is single use', () => {
    const result = evaluateClaim(markConsumed(grant()), true, T0 + 1000)
    expect(result.outcome).toBe('consumed')
  })

  it('expires exactly at the ttl, not a millisecond later', () => {
    expect(evaluateClaim(grant(), true, T0 + CAPABILITY_TTL_MS).outcome).toBe('approve-needed')
    expect(evaluateClaim(grant(), true, T0 + CAPABILITY_TTL_MS + 1).outcome).toBe('expired')
  })

  // THE MATTER LESSON, WRITTEN BEFORE THE ROUTE (research: a reference SDK
  // whose lockout "was not actually enforced"). The twenty-first attempt is
  // the one that must be provably dead.
  it('refuses the twenty-first attempt even with the right token', () => {
    let g = grant()
    for (let i = 0; i < CAPABILITY_MAX_ATTEMPTS; i++) {
      g = evaluateClaim(g, false, T0 + 1000).grant
    }
    expect(g.failedAttempts).toBe(CAPABILITY_MAX_ATTEMPTS)
    expect(tunnelShouldStop(g)).toBe(true)
    const result = evaluateClaim(g, true, T0 + 1000)
    expect(result.outcome).toBe('too-many')
    expect(result.grant.failedAttempts).toBe(CAPABILITY_MAX_ATTEMPTS)
  })

  it('does not raise tunnelShouldStop before the budget is spent', () => {
    let g = grant()
    for (let i = 0; i < CAPABILITY_MAX_ATTEMPTS - 1; i++) {
      g = evaluateClaim(g, false, T0 + 1000).grant
    }
    expect(tunnelShouldStop(g)).toBe(false)
  })
})

describe('capabilityUrl', () => {
  it('puts the token in the fragment, which is never sent to a server', () => {
    expect(capabilityUrl('https://four-words.trycloudflare.com', TOKEN)).toBe(
      `https://four-words.trycloudflare.com/#k=${TOKEN}`
    )
  })

  it('tolerates a trailing slash on the origin, like pairedRemoteUrl does', () => {
    expect(capabilityUrl('https://four-words.trycloudflare.com/', TOKEN)).toBe(
      `https://four-words.trycloudflare.com/#k=${TOKEN}`
    )
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/capabilityGrant.test.ts`
Expected: FAIL — `Failed to resolve import "./capabilityGrant"`.

- [ ] **Step 3: Implement**

Create `src/shared/capabilityGrant.ts`:

```ts
// src/shared/capabilityGrant.ts
//
// The tunnel path's way in -- docs/superpowers/specs/2026-09-28-phone-tunnel-
// fallback-design.md §5.
//
// WHY THIS EXISTS AT ALL. On the LAN a 4-character code out of 32^4 with a
// five-attempt lockout is proportionate: the attacker has to already be on
// the wifi. On a public url it is not, for two separate reasons. 2^20 is the
// wrong order of magnitude for an internet-facing endpoint (the W3C TAG's
// capability-url guidance suggests 120+ bits; NIST SP 800-63B requires 64
// minimum for a session identifier), and the five-attempt lockout becomes the
// attack -- five wrong guesses from anyone ends pairing for the session.
//
// So on the tunnel path the typed code is not offered and POST /api/pair is
// refused outright; this is what replaces it. None of it touches the LAN
// path, whose code, limiter and query-param link are unchanged.
//
// THE COMPARISON IS NOT DONE HERE. crypto.timingSafeEqual is node-only and
// this module is imported by the renderer, so evaluateClaim takes the boolean
// -- the same injection convention newPairingCode(random) already uses.

/** 128 bits from crypto.randomBytes. Not 64: this rides in a url that lands
 * in browser history, its cloud sync, address-bar autocomplete, screenshots
 * of the qr, and anything that unfurls links. The entropy is the cheap part;
 * the single use, the ten-minute expiry and the mac's own approval are what
 * actually carry it. */
export const CAPABILITY_TOKEN_BYTES = 16

/** Jellyfin Quick Connect's number, and for the same reason: the person
 * scanning is standing at the machine, so ten minutes is generous. */
export const CAPABILITY_TTL_MS = 10 * 60 * 1000

/** Twenty wrong claims stops the TUNNEL, not pairing. The honest response to
 * strangers rattling a handle is to close the door, not to jam it shut and
 * leave it open. It is a denial of service anyone holding the url can
 * trigger, costing one press of `start tunnel` -- accepted, because the lan
 * path is entirely unaffected and the user is at the machine. */
export const CAPABILITY_MAX_ATTEMPTS = 20

/** How long the mac's approval prompt waits before refusing itself. */
export const CAPABILITY_PROMPT_TIMEOUT_MS = 60_000

export interface CapabilityGrant {
  /** base64url of CAPABILITY_TOKEN_BYTES random bytes. */
  token: string
  issuedAt: number
  consumed: boolean
  failedAttempts: number
}

export function newGrant(token: string, now: number): CapabilityGrant {
  return { token, issuedAt: now, consumed: false, failedAttempts: 0 }
}

export type ClaimOutcome =
  /** Right token, fresh, unused -- park it and ask the mac. */
  | 'approve-needed'
  | 'wrong'
  | 'consumed'
  | 'expired'
  | 'too-many'

export interface ClaimEvaluation {
  outcome: ClaimOutcome
  grant: CapabilityGrant
}

/** THE ORDER OF THESE CHECKS IS THE SECURITY PROPERTY, not a style choice.
 *
 * The budget is checked first, so a spent grant cannot be probed at all. The
 * token is checked SECOND, before consumption and expiry, so that a wrong
 * token always reads exactly 'wrong' and never learns whether the real grant
 * had already been used or had run out -- which would turn a wrong guess into
 * a working oracle for whether anyone else got in. Consumption and expiry are
 * only ever reported to somebody who already holds the right token, which is
 * to say to the person looking at their own qr code. */
export function evaluateClaim(
  grant: CapabilityGrant,
  tokenMatches: boolean,
  now: number
): ClaimEvaluation {
  if (grant.failedAttempts >= CAPABILITY_MAX_ATTEMPTS) return { outcome: 'too-many', grant }
  if (!tokenMatches) {
    return {
      outcome: 'wrong',
      grant: { ...grant, failedAttempts: grant.failedAttempts + 1 }
    }
  }
  if (grant.consumed) return { outcome: 'consumed', grant }
  if (now - grant.issuedAt > CAPABILITY_TTL_MS) return { outcome: 'expired', grant }
  return { outcome: 'approve-needed', grant }
}

export function markConsumed(grant: CapabilityGrant): CapabilityGrant {
  return { ...grant, consumed: true }
}

/** Read after every claim. True means the tunnel comes down now. */
export function tunnelShouldStop(grant: CapabilityGrant): boolean {
  return grant.failedAttempts >= CAPABILITY_MAX_ATTEMPTS
}

/** What the tunnel qr encodes.
 *
 * THE FRAGMENT, NOT THE QUERY, AND THE REASON MATTERS. Per RFC 3986 a
 * fragment is never transmitted to the server, so the token stays out of
 * access logs, proxy logs and Referer -- which the query parameter the lan
 * path uses (REMOTE_PAIR_QUERY_PARAM) does not. The page reads
 * location.hash, POSTs it in a body, and scrubs it with history.replaceState
 * before the request is made, exactly as remotePage.ts already scrubs the lan
 * code. Better, not good: it is still in browser history and history sync.
 * Single use and a short expiry are not optional, and neither is the mac's
 * approval. */
export function capabilityUrl(origin: string, token: string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin
  return `${base}/#k=${token}`
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/shared/capabilityGrant.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/capabilityGrant.ts src/shared/capabilityGrant.test.ts
git commit -m "a hundred and twenty-eight bits, used once, and the mac still gets to say no"
```

---

## Task 3: The server learns there are two doors

**Files:**
- Modify: `src/shared/remoteState.ts`
- Modify: `src/main/remoteServer.ts`
- Modify: `src/main/remoteServer.test.ts`

- [ ] **Step 1: Add the wire type**

Append to `src/shared/remoteState.ts`:

```ts
import type { RemoteVia } from './remoteAuth'

/** What GET /api/state actually puts on the wire.
 *
 * SEPARATE FROM RemoteStateResponse ON PURPOSE. `via` is a fact about the
 * REQUEST -- which door it came through -- and getState() in src/main/index.ts
 * is built once, per server, with no idea who is asking. The server spreads
 * this field in at response time instead, so nothing in main has to learn
 * about the tunnel to answer a poll. */
export interface RemoteStateWire extends RemoteStateResponse {
  via: RemoteVia
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/main/remoteServer.test.ts`. Match the file's existing helper style for starting a
server on a `portOverride` with a `localAddressesOverride`; add `tunnelHost` and `approveClaim` to
the options each test passes.

```ts
describe('the tunnel door', () => {
  const TUNNEL = 'four-random-words.trycloudflare.com'

  it('403s a tunnelled request when no tunnel is running', async () => {
    const h = start({ tunnelHost: () => null })
    const res = await fetch(`http://127.0.0.1:${h.port}/`, { headers: { host: TUNNEL } })
    expect(res.status).toBe(403)
    h.stop()
  })

  it('serves the page over the tunnel host when one is running', async () => {
    const h = start({ tunnelHost: () => TUNNEL })
    const res = await fetch(`http://127.0.0.1:${h.port}/`, { headers: { host: TUNNEL } })
    expect(res.status).toBe(200)
    h.stop()
  })

  it('refuses POST /api/pair over the tunnel, so there is no typed code facing the internet', async () => {
    const h = start({ tunnelHost: () => TUNNEL })
    const res = await fetch(`http://127.0.0.1:${h.port}/api/pair`, {
      method: 'POST',
      headers: { host: TUNNEL, 'content-type': 'application/json' },
      body: JSON.stringify({ code: h.pairingCode })
    })
    expect(res.status).toBe(403)
    // And the five-attempt limiter was not touched by it.
    expect(h.gate.attemptsUsed).toBe(0)
    h.stop()
  })

  it('still pairs with the typed code over the lan while a tunnel is up', async () => {
    const h = start({ tunnelHost: () => TUNNEL })
    const res = await fetch(`http://127.0.0.1:${h.port}/api/pair`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${h.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: h.pairingCode })
    })
    expect(res.status).toBe(200)
    h.stop()
  })

  it('tells the page which door it came through', async () => {
    const h = start({ tunnelHost: () => TUNNEL })
    const token = await pairOverLan(h)
    const lan = await getState(h, `127.0.0.1:${h.port}`, token)
    const tun = await getState(h, TUNNEL, token)
    expect(lan.via).toBe('lan')
    expect(tun.via).toBe('tunnel')
    h.stop()
  })

  // THE CDN TERMS NAME THIS PAYLOAD. A promise that our page will not ask is
  // not a control; a 403 is.
  it('refuses the audio routes over the tunnel and serves them over the lan', async () => {
    const h = start({ tunnelHost: () => TUNNEL })
    const token = await pairOverLan(h)
    for (const path of ['/api/loop', `/api/stem?id=${'a'.repeat(16)}`]) {
      const tun = await fetch(`http://127.0.0.1:${h.port}${path}`, {
        headers: { host: TUNNEL, authorization: `Bearer ${token}` }
      })
      expect(tun.status).toBe(403)
      const lan = await fetch(`http://127.0.0.1:${h.port}${path}`, {
        headers: { host: `127.0.0.1:${h.port}`, authorization: `Bearer ${token}` }
      })
      expect(lan.status).not.toBe(403)
    }
    h.stop()
  })
})

describe('POST /api/claim', () => {
  const TUNNEL = 'four-random-words.trycloudflare.com'

  it('is refused over the lan, where the typed code is the way in', async () => {
    const h = start({ tunnelHost: () => TUNNEL })
    const res = await fetch(`http://127.0.0.1:${h.port}/api/claim`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${h.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ k: h.grantToken })
    })
    expect(res.status).toBe(403)
    h.stop()
  })

  it('issues a bearer token once the mac approves', async () => {
    const h = start({ tunnelHost: () => TUNNEL, approveClaim: async () => true })
    const res = await fetch(`http://127.0.0.1:${h.port}/api/claim`, {
      method: 'POST',
      headers: { host: TUNNEL, 'content-type': 'application/json' },
      body: JSON.stringify({ k: h.grantToken })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string }
    expect(body.token).toMatch(/^[0-9a-f]{64}$/)
    h.stop()
  })

  it('issues nothing when the mac refuses', async () => {
    const h = start({ tunnelHost: () => TUNNEL, approveClaim: async () => false })
    const res = await fetch(`http://127.0.0.1:${h.port}/api/claim`, {
      method: 'POST',
      headers: { host: TUNNEL, 'content-type': 'application/json' },
      body: JSON.stringify({ k: h.grantToken })
    })
    expect(res.status).toBe(403)
    h.stop()
  })

  it('is single use', async () => {
    const h = start({ tunnelHost: () => TUNNEL, approveClaim: async () => true })
    const once = async (): Promise<number> =>
      (
        await fetch(`http://127.0.0.1:${h.port}/api/claim`, {
          method: 'POST',
          headers: { host: TUNNEL, 'content-type': 'application/json' },
          body: JSON.stringify({ k: h.grantToken })
        })
      ).status
    expect(await once()).toBe(200)
    expect(await once()).toBe(410)
    h.stop()
  })

  it('raises no second prompt while one is open', async () => {
    let prompts = 0
    const h = start({
      tunnelHost: () => TUNNEL,
      approveClaim: async () => {
        prompts += 1
        await new Promise((r) => setTimeout(r, 50))
        return true
      }
    })
    const claim = (): Promise<Response> =>
      fetch(`http://127.0.0.1:${h.port}/api/claim`, {
        method: 'POST',
        headers: { host: TUNNEL, 'content-type': 'application/json' },
        body: JSON.stringify({ k: h.grantToken })
      })
    const [a, b] = await Promise.all([claim(), claim()])
    expect(prompts).toBe(1)
    expect([a.status, b.status].sort()).toEqual([200, 429])
    h.stop()
  })

  it('stops the tunnel after twenty wrong claims and never prompts for any of them', async () => {
    let prompts = 0
    let stopped = 0
    const h = start({
      tunnelHost: () => TUNNEL,
      approveClaim: async () => {
        prompts += 1
        return true
      },
      onTunnelAbuse: () => {
        stopped += 1
      }
    })
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`http://127.0.0.1:${h.port}/api/claim`, {
        method: 'POST',
        headers: { host: TUNNEL, 'content-type': 'application/json' },
        body: JSON.stringify({ k: 'not-the-token' })
      })
      expect(res.status).toBe(401)
    }
    expect(prompts).toBe(0)
    expect(stopped).toBe(1)
    const after = await fetch(`http://127.0.0.1:${h.port}/api/claim`, {
      method: 'POST',
      headers: { host: TUNNEL, 'content-type': 'application/json' },
      body: JSON.stringify({ k: h.grantToken })
    })
    expect(after.status).toBe(429)
    h.stop()
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/main/remoteServer.test.ts`
Expected: FAIL — the new describes fail (403 where 200 is expected, `/api/claim` 401s as an
unknown path). **The pre-existing describes in the file must still pass.**

- [ ] **Step 4: Implement**

In `src/main/remoteServer.ts`:

Extend the imports:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  REMOTE_PORT,
  codesMatch,
  isAllowedRequestHost,
  newPairingCode,
  recordPairAttempt,
  remoteVia,
  type PairingGate
} from '@shared/remoteAuth'
import {
  CAPABILITY_TOKEN_BYTES,
  evaluateClaim,
  markConsumed,
  newGrant,
  tunnelShouldStop,
  type CapabilityGrant
} from '@shared/capabilityGrant'
import type { RemoteStateWire } from '@shared/remoteState'
```

Add to `RemoteServerOptions`:

```ts
  /** The hostname our own tunnel is currently reachable on, or null. READ PER
   * REQUEST, never captured -- the same reason ownAddresses is read per
   * request. When the tunnel closes, the very next request is refused. */
  tunnelHost: () => string | null
  /** Asks the desktop whether to admit a phone that arrived over the tunnel
   * holding a valid capability token. Resolves true for `allow once`. THIS IS
   * THE STEP THAT MAKES GUESSING THE TOKEN WORTH NOTHING -- the entropy is the
   * cheap half. Jellyfin Quick Connect's pattern. */
  approveClaim: () => Promise<boolean>
  /** Twenty wrong claims from the internet. The caller stops the tunnel. */
  onTunnelAbuse: () => void
```

Add to `RemoteServerHandle`:

```ts
  /** base64url, 128 bits, minted with this server. What the tunnel qr
   * encodes, via capabilityUrl(). Regenerated by newGrant(). */
  grantToken: string
  /** Mints a fresh grant and returns its token -- the modal's `new link`,
   * for when the first qr was photographed. Does not touch the tunnel. */
  renewGrant(): string
```

Inside `startRemoteServer`, beside `const tokens = new Set<string>()`:

```ts
  let grant: CapabilityGrant = newGrant(newCapabilityToken(), Date.now())
  /** One outstanding approval prompt at a time, so a leaked url cannot be
   * turned into prompt spam on the desktop. */
  let promptOpen = false

  function issueSessionToken(): string {
    const token = randomBytes(32).toString('hex')
    tokens.add(token)
    return token
  }
```

and a module-level helper above `startRemoteServer`:

```ts
/** base64url so it survives a url fragment untouched -- no padding, no
 * percent-encoding, nothing a qr scanner or a paste can mangle. */
function newCapabilityToken(): string {
  return randomBytes(CAPABILITY_TOKEN_BYTES).toString('base64url')
}

/** Constant-time, and length-safe: timingSafeEqual throws on a length
 * mismatch, which would itself be a timing oracle if it were allowed to
 * escape. Different lengths are simply not equal. */
function tokensMatch(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

Replace the guard call at the top of the request handler:

```ts
      const tunnelHost = options.tunnelHost()
      if (!isAllowedRequestHost(req.headers.host, localAddresses(), port, tunnelHost)) {
        return refuse(req, res, 403, REMOTE_WRONG_ADDRESS_NOTICE)
      }
      const via = remoteVia(req.headers.host, localAddresses(), port, tunnelHost)
```

Guard `/api/pair` — insert as its first line, before the lockout check:

```ts
      if (req.method === 'POST' && url === '/api/pair') {
        // NO TYPED CODE FACING THE INTERNET. 2^20 with a five-attempt session
        // lockout is proportionate on a wifi somebody already had to join; on
        // a public url it is both too small and a one-line denial of service
        // against pairing. The tunnel path claims instead -- see /api/claim.
        if (via === 'tunnel') return respond(res, 403, { tunnelled: true })
        if (gate.lockedOut) return respond(res, 403, { lockedOut: true })
```

Add `/api/claim` immediately after the `/api/pair` block:

```ts
      // THE TUNNEL PATH'S WAY IN, and the only one. 128 bits from the url
      // fragment (never sent to a server by the browser -- RFC 3986; the page
      // POSTs it in a body), single use, ten-minute expiry, twenty wrong
      // guesses and the tunnel comes down, and the mac itself still has to
      // say yes. See src/shared/capabilityGrant.ts for why each of those five
      // is there, and the spec's §5 for what it replaces.
      if (req.method === 'POST' && url === '/api/claim') {
        if (via !== 'tunnel') return respond(res, 403, { lanOnly: true })
        const body = await readJsonBody(req)
        const offered = typeof body.k === 'string' ? body.k : ''
        const evaluated = evaluateClaim(grant, tokensMatch(offered, grant.token), Date.now())
        grant = evaluated.grant
        if (evaluated.outcome === 'wrong') {
          if (tunnelShouldStop(grant)) options.onTunnelAbuse()
          return respond(res, 401)
        }
        if (evaluated.outcome === 'too-many') return respond(res, 429)
        // Consumed and expired are only ever seen by somebody holding the
        // right token, which is to say by the person looking at their own qr.
        // 410 rather than 401 so the page can say "get a new link on the mac"
        // instead of "wrong".
        if (evaluated.outcome !== 'approve-needed') return respond(res, 410, { stale: true })
        if (promptOpen) return respond(res, 429, { asking: true })
        promptOpen = true
        let approved = false
        try {
          approved = await options.approveClaim()
        } finally {
          promptOpen = false
        }
        // Consumed either way: a refused claim burns the link, so a leaked
        // url cannot be retried until somebody clicks the wrong button.
        grant = markConsumed(grant)
        if (!approved) return respond(res, 403, { refused: true })
        return respond(res, 200, { token: issueSessionToken() })
      }
```

Refactor `/api/pair`'s success branch to use `issueSessionToken()` so there is one minting site.

Add the `via` field to `/api/state`:

```ts
      if (req.method === 'GET' && url === '/api/state') {
        const wire: RemoteStateWire = { ...options.getState(), via }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(wire))
        return
      }
```

Guard both audio routes — as the first line inside each of the `/api/loop` and `/api/stem` blocks:

```ts
        // NO AUDIO OVER THE TUNNEL. Cloudflare's Service-Specific Terms
        // reserve the right to limit "a disproportionate percentage of
        // pictures, audio files, or other large files" on the free CDN, and
        // this route is up to 11.3 MB of wav (/api/loop) or ~640 KB a stem
        // (/api/stem, twelve of them on a first load). The page already knows
        // not to ask -- it reads `via` -- but a promise from a page is not a
        // control. This is. See the spec's §7.
        if (via === 'tunnel') return respond(res, 403, { tunnelled: true })
```

And in the returned handle:

```ts
    grantToken: grant.token,
    renewGrant: (): string => {
      grant = newGrant(newCapabilityToken(), Date.now())
      return grant.token
    },
```

> `grantToken` on the handle is the token **at start**. `renewGrant()` returns the current one.
> Callers that need the live value after a renew must use the return of `renewGrant()`; nothing in
> this plan reads `grantToken` after calling it.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run src/main/remoteServer.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: FAIL in `src/main/index.ts` — `tunnelHost`, `approveClaim` and `onTunnelAbuse` are
missing from the `startRemoteServer` call. Add the three temporary stubs there now, so the tree
compiles at the end of every task:

```ts
    // Phase A: no tunnel exists yet, so the second door refuses everything and
    // nothing about this server's behaviour changes. Task 9 replaces all three.
    tunnelHost: () => null,
    approveClaim: () => Promise.resolve(false),
    onTunnelAbuse: () => {}
```

Re-run `npm run typecheck`. Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/remoteState.ts src/main/remoteServer.ts src/main/remoteServer.test.ts src/main/index.ts
git commit -m "two doors into the same server, and only one of them takes a typed code"
```

---

## Task 4: The mac gets to say no

**Files:**
- Create: `src/renderer/src/components/RemoteApprovalModal.tsx`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/App.tsx` (or wherever `PhoneRemoteModal` is mounted — grep
  for `<PhoneRemoteModal` and mount the new one as a sibling)

No component test — Finding 11.

- [ ] **Step 1: The main-process half**

In `src/main/index.ts`, beside the other phone-remote module state:

```ts
/** The one outstanding approval request, if a phone is asking right now.
 * Resolved by the renderer's answer, or by the sixty-second timer, whichever
 * comes first -- never left hanging, because the http request on the other
 * end of it is holding a socket open. */
let pendingClaimApproval: ((approved: boolean) => void) | null = null

function askToApproveClaim(): Promise<boolean> {
  // Nothing to ask with. A phone must not get in because the window was
  // closed, so the answer is no.
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false)
  if (pendingClaimApproval !== null) return Promise.resolve(false)
  const win = mainWindow
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (approved: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingClaimApproval = null
      win.webContents.send('remote-claim-resolved')
      resolve(approved)
    }
    const timer = setTimeout(() => finish(false), CAPABILITY_PROMPT_TIMEOUT_MS)
    pendingClaimApproval = finish
    win.webContents.send('remote-claim-asked')
  })
}

ipcMain.handle('answer-remote-claim', (_event, approved: boolean) => {
  pendingClaimApproval?.(approved)
})
```

Import `CAPABILITY_PROMPT_TIMEOUT_MS` from `@shared/capabilityGrant`. Register the
`ipcMain.handle` beside the other `phone-remote` handlers.

Leave `approveClaim: () => Promise.resolve(false)` in the `startRemoteServer` call for now —
Task 9 swaps it to `askToApproveClaim`, once there is a tunnel that can produce a claim. (Wiring it
here would be dead code with no way to reach it, and no way to test it by hand.)

- [ ] **Step 2: The preload half**

In `src/preload/index.ts`, beside `onPhoneRemoteStatus`:

```ts
  onRemoteClaimAsked: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('remote-claim-asked', listener)
    return () => ipcRenderer.removeListener('remote-claim-asked', listener)
  },
  onRemoteClaimResolved: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('remote-claim-resolved', listener)
    return () => ipcRenderer.removeListener('remote-claim-resolved', listener)
  },
  answerRemoteClaim: (approved: boolean): Promise<void> =>
    ipcRenderer.invoke('answer-remote-claim', approved),
```

Mirror the same three entries in the `Window` interface declaration in `src/preload/index.d.ts`
if that file carries the `rifffApi` type (grep for `getPhoneRemoteStatus` and follow the pattern
you find).

- [ ] **Step 3: The component**

Create `src/renderer/src/components/RemoteApprovalModal.tsx`:

```tsx
/** A phone that arrived over the tunnel, holding a valid capability token,
 * asking to be let in.
 *
 * ITS OWN MODAL, NOT PART OF PhoneRemoteModal, and that is the whole point of
 * the file. The phone-remote card can be dismissed while the remote keeps
 * running -- that is what `close, remote stays on` means -- and an approval
 * that only appears inside a card nobody has open is an approval that never
 * appears.
 *
 * Same shell as PhoneRemoteModal: fixed overlay, centred card, sharp corners,
 * lowercase, no click-outside dismiss. There is no dismiss at all, in fact:
 * the two buttons are the only exits, and the request refuses itself after
 * sixty seconds on the main side either way. */
export function RemoteApprovalModal({
  onAnswer
}: {
  onAnswer: (approved: boolean) => void
}): React.JSX.Element {
  const buttonStyle: React.CSSProperties = {
    height: 28,
    borderRadius: 0,
    padding: '0 14px',
    fontSize: 11,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text)',
    cursor: 'pointer'
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(320px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>
          a phone is asking to connect over the internet.
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ra-s-2)' }}>
          <button
            onClick={() => onAnswer(false)}
            aria-label="refuse this phone"
            title="keeps it out"
            style={{ ...buttonStyle, color: 'var(--ra-mute-on)' }}
          >
            refuse
          </button>
          <button
            onClick={() => onAnswer(true)}
            aria-label="let this phone in once"
            title="lets it in"
            style={{ ...buttonStyle, border: '1px solid var(--ra-border-strong)' }}
          >
            allow once
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Mount it**

Where `PhoneRemoteModal` is mounted, add sibling state and the two subscriptions. **Finding 13:** a
synchronous `setState` inside an effect is a lint error here; these are inside callbacks, not in
the effect body, so they are fine.

```tsx
  const [claimAsked, setClaimAsked] = useState(false)

  useEffect(() => {
    const offAsked = window.rifffApi.onRemoteClaimAsked(() => setClaimAsked(true))
    const offResolved = window.rifffApi.onRemoteClaimResolved(() => setClaimAsked(false))
    return () => {
      offAsked()
      offResolved()
    }
  }, [])
```

```tsx
      {claimAsked && (
        <RemoteApprovalModal
          onAnswer={(approved) => {
            setClaimAsked(false)
            void window.rifffApi.answerRemoteClaim(approved)
          }}
        />
      )}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, 4 prettier warnings.
Run: `npm test`
Expected: the baseline plus Tasks 1–3's new tests. No new failures.

**Say honestly in the report that the modal has not been seen.** There is no GUI here.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/RemoteApprovalModal.tsx src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/App.tsx
git commit -m "the mac is asked before a stranger gets in, and it is asked in its own window"
```

---

## Task 5: Phase A checkpoint

- [ ] **Step 1: Full verification**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: 2 new test files, ~28 new tests, everything else unchanged. 0 typecheck errors. 0 lint
errors + 4 prettier warnings. If only `src/main/remoteServer.test.ts` fails, re-run it alone.

- [ ] **Step 2: Confirm nothing user-visible moved**

Run `npm run dev`, open the phone remote, and confirm the modal, the QR, the pairing code and the
`not connecting?` disclosure are **exactly as before**. There is no tunnel yet; the second door
refuses everything; `via` is always `'lan'`. Report what was and was not checked — an agent
without a GUI cannot do this step and must say so.

- [ ] **Step 3: Report to Elling before starting Phase B**

One paragraph: the security work is in and tested, nothing he can see has changed, and Phase B is
what turns it on.

---

# Phase B — the tunnel

---

## Task 6: The seam

**Files:**
- Create: `src/shared/publicTunnel.ts`
- Create: `src/shared/publicTunnel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/publicTunnel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  TUNNEL_IDLE_STOP_MS,
  TUNNEL_READY_TIMEOUT_MS,
  parseQuickTunnelUrl,
  shouldStopIdleTunnel
} from './publicTunnel'

const BANNER = `
2026-09-28T14:02:11Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-09-28T14:02:13Z INF +--------------------------------------------------------+
2026-09-28T14:02:13Z INF |  Your quick Tunnel has been created! Visit it at:       |
2026-09-28T14:02:13Z INF |  https://four-random-words.trycloudflare.com            |
2026-09-28T14:02:13Z INF +--------------------------------------------------------+
`

describe('parseQuickTunnelUrl', () => {
  it('finds the assigned origin in the banner', () => {
    expect(parseQuickTunnelUrl(BANNER)).toBe('https://four-random-words.trycloudflare.com')
  })

  it('lowercases it, because the host guard compares literals', () => {
    expect(parseQuickTunnelUrl('https://Four-Words.TryCloudflare.com')).toBe(
      'https://four-words.trycloudflare.com'
    )
  })

  it('finds nothing before the banner has arrived', () => {
    expect(parseQuickTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBe(
      null
    )
    expect(parseQuickTunnelUrl('')).toBe(null)
  })

  it('survives being split across chunks, which is why the caller accumulates', () => {
    const a = '…Visit it at:\n| https://four-random'
    const b = '-words.trycloudflare.com  |\n'
    expect(parseQuickTunnelUrl(a)).toBe(null)
    expect(parseQuickTunnelUrl(a + b)).toBe('https://four-random-words.trycloudflare.com')
  })

  // THE ONE THAT WOULD BE A REAL HOLE: a prefix match handing the host guard
  // a literal that is not actually the host we end up on.
  it('refuses a name that merely starts with one', () => {
    expect(parseQuickTunnelUrl('https://x.trycloudflare.com.evil.com')).toBe(null)
    expect(parseQuickTunnelUrl('https://x.trycloudflare.computer')).toBe(null)
  })

  it('refuses http, because the token rides in a fragment and needs a secure context', () => {
    expect(parseQuickTunnelUrl('http://x.trycloudflare.com')).toBe(null)
  })

  it('refuses anything that is not the provider we spawned', () => {
    expect(parseQuickTunnelUrl('https://evil.example.com')).toBe(null)
    expect(parseQuickTunnelUrl('https://.trycloudflare.com')).toBe(null)
  })
})

describe('shouldStopIdleTunnel', () => {
  const T0 = 1_700_000_000_000

  it('stops after two hours', () => {
    expect(TUNNEL_IDLE_STOP_MS).toBe(2 * 60 * 60 * 1000)
  })

  it('measures from the last tunnelled request', () => {
    expect(shouldStopIdleTunnel(T0, T0 - 10_000, T0 + TUNNEL_IDLE_STOP_MS)).toBe(false)
    expect(shouldStopIdleTunnel(T0, T0 - 10_000, T0 + TUNNEL_IDLE_STOP_MS + 1)).toBe(true)
  })

  // The page polls every 700ms while it is open, so "idle" means the page is
  // closed. A tunnel nobody has used since it started is the forgotten-door
  // case this exists for.
  it('measures from the start when nothing has ever arrived', () => {
    expect(shouldStopIdleTunnel(null, T0, T0 + TUNNEL_IDLE_STOP_MS)).toBe(false)
    expect(shouldStopIdleTunnel(null, T0, T0 + TUNNEL_IDLE_STOP_MS + 1)).toBe(true)
  })
})

describe('TUNNEL_READY_TIMEOUT_MS', () => {
  it('is twenty seconds -- a person is watching a modal', () => {
    expect(TUNNEL_READY_TIMEOUT_MS).toBe(20_000)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/publicTunnel.test.ts`
Expected: FAIL — `Failed to resolve import "./publicTunnel"`.

- [ ] **Step 3: Implement**

Create `src/shared/publicTunnel.ts`:

```ts
// src/shared/publicTunnel.ts
//
// THE SEAM. Everything provider-specific about reaching this mac from the
// internet lives behind these types -- see the spec's §2 for the seven things
// a second implementation has to satisfy, and the research's §5/§6 for why a
// seam rather than a commitment: every free tunnel in ten years has either
// monetised, added an interstitial, added an account requirement, or died,
// and when it shifts it shifts for every user at once, in a version already
// shipped.
//
// No node imports. The parser and the two predicates are pure so they are
// tested without a process, and the types are importable from the renderer.

/** A public way in to one local port, while it lasts. */
export interface PublicTunnel {
  /** Scheme and host, no path, no trailing slash. HTTPS is not optional: the
   * capability token rides in a url fragment, and the wake-lock win the whole
   * feature quietly buys depends on the page being a secure context. */
  readonly origin: string
  /** The host alone, lowercased, no port -- the ONE literal
   * isAllowedTunnelHost compares against. */
  readonly host: string
  /** Kills the provider and resolves once it is gone. Idempotent, and safe
   * after onClosed has already fired. */
  stop(): Promise<void>
}

export interface TunnelOpenOptions {
  /** Reject rather than hang, and leave nothing running when it rejects. */
  timeoutMs: number
  /** Fires EXACTLY ONCE when the path stops working, for any reason the
   * provider can see. Never after stop() has been called. The guard clears
   * the hostname the instant it fires, so a provider that dies silently must
   * not be admissible. */
  onClosed: (reason: string) => void
}

export interface TunnelProvider {
  /** For the log line and the modal: 'cloudflare quick tunnel'. */
  readonly label: string
  /** Usable right now, with no network call? For cloudflared: is the verified
   * binary already on disk. */
  ready(): Promise<boolean>
  open(port: number, options: TunnelOpenOptions): Promise<PublicTunnel>
}

/** Twenty seconds, against engineProcess.ts's forty-five. There is no Rosetta
 * AOT translation and no Gatekeeper first-run bundle evaluation to pay for
 * here, and a person is watching a modal waiting for a qr code. */
export const TUNNEL_READY_TIMEOUT_MS = 20_000

/** Two hours with nothing arriving and the tunnel comes down on its own. The
 * page polls every 700ms while it is open, so idle means the page is closed,
 * and two hours of a closed page is a door somebody forgot. "Off by default
 * and explicitly started" deserves "and it does not stay on because you
 * forgot" beside it. */
export const TUNNEL_IDLE_STOP_MS = 2 * 60 * 60 * 1000

export function shouldStopIdleTunnel(
  lastRequestAt: number | null,
  startedAt: number,
  now: number
): boolean {
  return now - (lastRequestAt ?? startedAt) > TUNNEL_IDLE_STOP_MS
}

/** THE ONLY PLACE IN THIS CODEBASE THAT KNOWS THE PROVIDER'S HOSTNAME SHAPE.
 * src/shared/remoteAuth.ts deliberately does not: the guard compares a
 * literal it was handed, so swapping providers is a change here and nowhere
 * near the security code.
 *
 * The negative lookahead is load-bearing, not tidiness. Without it,
 * `https://x.trycloudflare.com.evil.com` matches its own prefix and this
 * function hands the host guard a literal that is NOT the host requests will
 * actually arrive on -- which is the one way this parser could open a hole.
 *
 * https only: see PublicTunnel.origin. */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?![a-z0-9.\-])/i

export function parseQuickTunnelUrl(output: string): string | null {
  const match = QUICK_TUNNEL_URL.exec(output)
  return match === null ? null : match[0].toLowerCase()
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/shared/publicTunnel.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/publicTunnel.ts src/shared/publicTunnel.test.ts
git commit -m "one function's worth of contract, so the provider can be replaced in a day"
```

---

## Task 7: The pin, and getting the binary

**Files:**
- Create: `src/shared/cloudflaredRelease.ts`
- Create: `src/shared/cloudflaredRelease.test.ts`
- Create: `src/main/cloudflaredInstall.ts`
- Create: `src/main/cloudflaredInstall.test.ts`

- [ ] **Step 1: Pin a real version and real hashes, and check the assumption that decides this**

Three commands. Run all three and record the output; do not guess any value.

```bash
# 1. The current release tag and the exact macOS asset names.
curl -sL https://api.github.com/repos/cloudflare/cloudflared/releases/latest \
  | grep -E '"(tag_name|name)":' | grep -Ei 'tag_name|darwin'

# 2. The two hashes, for whatever the asset names in (1) actually are.
for A in cloudflared-darwin-arm64.tgz cloudflared-darwin-amd64.tgz; do
  curl -sL -o "/tmp/$A" "https://github.com/cloudflare/cloudflared/releases/download/<TAG>/$A"
  echo "$A $(shasum -a 256 "/tmp/$A" | cut -d' ' -f1)"
done

# 3. THE ASSUMPTION THAT DECIDES BUNDLE-VERSUS-DOWNLOAD (spec §3.3).
tar -xzf /tmp/cloudflared-darwin-arm64.tgz -C /tmp
xattr -l /tmp/cloudflared || echo "no xattrs -- no quarantine"
codesign -dv --verbose=2 /tmp/cloudflared 2>&1 | grep -E 'Authority|TeamIdentifier|flags'
/tmp/cloudflared --version
```

**If step 3's `--version` does not run, or the team identifier is not `68WVV388M8`, or the binary
is not hardened-runtime signed: STOP and report.** That is the finding that flips the
recommendation to bundling, and bundling touches the signed build — which is a decision for Elling,
not for this task.

- [ ] **Step 2: Write the failing tests for the pin**

Create `src/shared/cloudflaredRelease.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CLOUDFLARED_SHA256,
  CLOUDFLARED_TEAM_ID,
  CLOUDFLARED_VERSION,
  cloudflaredAssetName,
  cloudflaredDownloadUrl
} from './cloudflaredRelease'

describe('the pin', () => {
  it('names a version', () => {
    expect(CLOUDFLARED_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/)
  })

  it('carries a real sha256 for each arch, not a placeholder', () => {
    for (const arch of ['arm64', 'x64'] as const) {
      expect(CLOUDFLARED_SHA256[arch]).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(CLOUDFLARED_SHA256.arm64).not.toBe(CLOUDFLARED_SHA256.x64)
  })

  it('maps node arch names onto cloudflare asset names', () => {
    expect(cloudflaredAssetName('arm64')).toBe('cloudflared-darwin-arm64.tgz')
    expect(cloudflaredAssetName('x64')).toBe('cloudflared-darwin-amd64.tgz')
  })

  it('builds the release url from the pinned version, over https to github', () => {
    const url = cloudflaredDownloadUrl('arm64')
    expect(url.startsWith('https://github.com/cloudflare/cloudflared/releases/download/')).toBe(
      true
    )
    expect(url).toContain(CLOUDFLARED_VERSION)
    expect(url.endsWith(cloudflaredAssetName('arm64'))).toBe(true)
  })

  it('knows whose signature to insist on', () => {
    expect(CLOUDFLARED_TEAM_ID).toBe('68WVV388M8')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/shared/cloudflaredRelease.test.ts`
Expected: FAIL — `Failed to resolve import "./cloudflaredRelease"`.

- [ ] **Step 4: Implement the pin, with the values from Step 1**

Create `src/shared/cloudflaredRelease.ts`. **Substitute the real tag and the two real hashes from
Step 1 — the strings below are shaped correctly and are not the answer:**

```ts
// src/shared/cloudflaredRelease.ts
//
// ONE PLACE, ON PURPOSE. The tunnel provider is downloaded rather than
// bundled (spec §3.3), which means the trust story is three things: https to
// cloudflare's own release host, a pinned sha256 checked before anything is
// executed, and cloudflare's own developer-id signature checked after
// extraction. All three of the facts those depend on live here, with the date
// they were checked, so the pin is one file to look at rather than a grep.
//
// WHEN THIS ROTS: a version cloudflare later withdraws makes the download 404
// and the feature stop working for new users. That failure names the pin in
// its message (see cloudflaredInstall.ts) rather than showing a spinner. If
// it needs attention more than once or twice a year, bundling becomes the
// cheaper maintenance -- see the spec's §3.3 for what else that would cost.
//
// Checked: 2026-09-28.

export const CLOUDFLARED_VERSION = '2026.9.3'

/** sha256 of the release tarball, per arch. Produced by:
 *   shasum -a 256 cloudflared-darwin-<arch>.tgz
 * Recomputed whenever CLOUDFLARED_VERSION moves, never carried over. */
export const CLOUDFLARED_SHA256: Record<'arm64' | 'x64', string> = {
  arm64: '0000000000000000000000000000000000000000000000000000000000000000',
  x64: '1111111111111111111111111111111111111111111111111111111111111111'
}

/** Cloudflare Inc.'s developer-id team identifier, as reported by
 * `codesign -dv`. The binary arrives signed, hardened-runtime and notarized
 * by them -- which is exactly why a runtime download is safe here and was not
 * for gradio's frp client. */
export const CLOUDFLARED_TEAM_ID = '68WVV388M8'

/** node's process.arch names are not cloudflare's asset names. */
export function cloudflaredAssetName(arch: 'arm64' | 'x64'): string {
  return arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz'
}

export function cloudflaredDownloadUrl(arch: 'arm64' | 'x64'): string {
  return `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${cloudflaredAssetName(arch)}`
}
```

- [ ] **Step 5: Write the failing tests for the installer**

Create `src/main/cloudflaredInstall.test.ts`. It mocks **only** `app.getPath`, the narrow surface
this codebase's convention allows (see `pluginCatalog.test.ts`), and feeds the installer a
`file://` URL over a real tarball built in a temp dir — a real download path, a real tar, a real
hash check, no network.

```ts
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''

vi.mock('electron', () => ({ app: { getPath: (): string => root } }))

import { installCloudflared, installedCloudflaredPath } from './cloudflaredInstall'

function makeTarball(dir: string, body: string): { path: string; sha256: string } {
  writeFileSync(join(dir, 'cloudflared'), body)
  chmodSync(join(dir, 'cloudflared'), 0o755)
  const path = join(dir, 'fixture.tgz')
  execFileSync('/usr/bin/tar', ['-czf', path, '-C', dir, 'cloudflared'])
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
}

describe('installCloudflared', () => {
  let work = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cfroot-'))
    work = mkdtempSync(join(tmpdir(), 'cfwork-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  it('downloads, checks the hash, extracts and leaves an executable behind', async () => {
    const { path, sha256 } = makeTarball(work, '#!/bin/sh\necho ok\n')
    const result = await installCloudflared({
      url: pathToFileURL(path).href,
      sha256,
      verifySignature: false
    })
    expect(result.ok).toBe(true)
    expect(existsSync(installedCloudflaredPath())).toBe(true)
  })

  // THE CHECK THAT MATTERS. A binary whose bytes are not the bytes we pinned
  // is never written where anything could spawn it.
  it('refuses a tarball whose hash does not match the pin, and installs nothing', async () => {
    const { path } = makeTarball(work, '#!/bin/sh\necho tampered\n')
    const result = await installCloudflared({
      url: pathToFileURL(path).href,
      sha256: 'f'.repeat(64),
      verifySignature: false
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('checksum')
    expect(existsSync(installedCloudflaredPath())).toBe(false)
  })

  it('names the pin when the download itself fails, instead of failing blankly', async () => {
    const result = await installCloudflared({
      url: pathToFileURL(join(work, 'does-not-exist.tgz')).href,
      sha256: 'a'.repeat(64),
      verifySignature: false
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('download')
    expect(result.message).toContain('does-not-exist.tgz')
  })

  it('is idempotent -- a second install over a good one is a no-op success', async () => {
    const { path, sha256 } = makeTarball(work, '#!/bin/sh\necho ok\n')
    const opts = { url: pathToFileURL(path).href, sha256, verifySignature: false }
    expect((await installCloudflared(opts)).ok).toBe(true)
    expect((await installCloudflared(opts)).ok).toBe(true)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/main/cloudflaredInstall.test.ts`
Expected: FAIL — `Failed to resolve import "./cloudflaredInstall"`.

- [ ] **Step 7: Implement the installer**

Create `src/main/cloudflaredInstall.ts`:

```ts
// src/main/cloudflaredInstall.ts
//
// Fetches the tunnel provider's binary the first time somebody asks for it,
// and never before -- see the spec's §3.3. The decisive argument is consent:
// cloudflare's own text says installing cloudflared "constitutes a symbol of
// your signature indicating that you accept the terms", and a feature that is
// off by default should not have installed a third party's software on every
// user's disk before they have heard of it.
//
// It also means electron-builder.yml, build/afterPack.js and
// .github/workflows/release.yml are untouched by this whole feature, which in
// this repo is worth a great deal.
//
// THREE CHECKS BEFORE ANYTHING IS EXECUTED, and all three have to pass:
//   1. https to cloudflare's own github release host, at a pinned version;
//   2. a pinned sha256 over the downloaded bytes, checked in a temp file --
//      nothing is written to the install path until it matches;
//   3. cloudflare's own developer-id signature, checked with codesign after
//      extraction, including the team identifier.
// (2) and (3) are independent: (2) says these are the bytes we pinned, (3)
// says apple agrees cloudflare signed them.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import {
  CLOUDFLARED_SHA256,
  CLOUDFLARED_TEAM_ID,
  CLOUDFLARED_VERSION,
  cloudflaredDownloadUrl
} from '@shared/cloudflaredRelease'

const execFileAsync = promisify(execFile)

function installDir(): string {
  return join(app.getPath('userData'), 'cloudflared', CLOUDFLARED_VERSION)
}

/** Versioned, so bumping the pin installs beside the old copy rather than
 * over a running one, and so a stale binary can never be mistaken for the
 * pinned one. */
export function installedCloudflaredPath(): string {
  return join(installDir(), 'cloudflared')
}

export function isCloudflaredInstalled(): boolean {
  return existsSync(installedCloudflaredPath())
}

export type InstallFailure = 'download' | 'checksum' | 'extract' | 'signature'

export type InstallResult =
  | { ok: true; path: string }
  | { ok: false; reason: InstallFailure; message: string }

export interface InstallOptions {
  /** Tests only -- a file:// url over a fixture tarball. Production uses the
   * pinned release url. */
  url?: string
  /** Tests only. */
  sha256?: string
  /** Tests only: a fixture tarball is not signed by cloudflare. Never false
   * in production. */
  verifySignature?: boolean
}

function hostArch(): 'arm64' | 'x64' {
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

export async function installCloudflared(options: InstallOptions = {}): Promise<InstallResult> {
  const target = installedCloudflaredPath()
  if (existsSync(target)) return { ok: true, path: target }

  const arch = hostArch()
  const url = options.url ?? cloudflaredDownloadUrl(arch)
  const expected = options.sha256 ?? CLOUDFLARED_SHA256[arch]

  // A temp sibling, so a failure at any step leaves the install path empty
  // and isCloudflaredInstalled() keeps telling the truth.
  const staging = `${installDir()}.partial`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  try {
    let bytes: Buffer
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`http ${response.status}`)
      bytes = Buffer.from(await response.arrayBuffer())
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        reason: 'download',
        // NAMES THE PIN. A pinned version cloudflare later withdraws is the
        // realistic failure here, and "could not download" without the url is
        // a support conversation nobody can start.
        message: `could not download ${url}: ${detail}`
      }
    }

    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected) {
      return {
        ok: false,
        reason: 'checksum',
        message: `${url} did not match the pinned checksum (expected ${expected}, got ${actual})`
      }
    }

    const tarball = join(staging, 'cloudflared.tgz')
    writeFileSync(tarball, bytes)
    try {
      await execFileAsync('/usr/bin/tar', ['-xzf', tarball, '-C', staging])
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: 'extract', message: `could not unpack ${url}: ${detail}` }
    }
    const extracted = join(staging, 'cloudflared')
    if (!existsSync(extracted)) {
      return { ok: false, reason: 'extract', message: `${url} did not contain cloudflared` }
    }
    chmodSync(extracted, 0o755)

    if (options.verifySignature !== false) {
      const failure = await verifySignature(extracted)
      if (failure !== null) return { ok: false, reason: 'signature', message: failure }
    }

    mkdirSync(installDir(), { recursive: true })
    writeFileSync(target, readFileSync(extracted))
    chmodSync(target, 0o755)
    return { ok: true, path: target }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Null when it checks out, else the sentence to show. Two separate
 * questions: is the signature valid at all, and is it cloudflare's. */
async function verifySignature(path: string): Promise<string | null> {
  try {
    await execFileAsync('/usr/bin/codesign', ['--verify', '--strict', path])
  } catch {
    return 'the downloaded program is not correctly signed'
  }
  let described = ''
  try {
    const { stderr } = await execFileAsync('/usr/bin/codesign', ['-dv', '--verbose=2', path])
    described = stderr
  } catch {
    return 'the downloaded program could not be checked'
  }
  if (!described.includes(`TeamIdentifier=${CLOUDFLARED_TEAM_ID}`)) {
    return 'the downloaded program is not signed by cloudflare'
  }
  return null
}
```

- [ ] **Step 8: Run both test files and make sure they pass**

Run: `npx vitest run src/shared/cloudflaredRelease.test.ts src/main/cloudflaredInstall.test.ts`
Expected: PASS, 9 tests.

**`vitest.config.ts` is NOT edited** — `cloudflaredInstall.test.ts` mocks only `app.getPath` and
opens no database (Finding 10).

- [ ] **Step 9: Commit**

```bash
git add src/shared/cloudflaredRelease.ts src/shared/cloudflaredRelease.test.ts src/main/cloudflaredInstall.ts src/main/cloudflaredInstall.test.ts
git commit -m "fetch it once, check it three ways, and never bundle somebody else's binary"
```

---

## Task 8: The process, and making sure it dies

**Files:**
- Create: `src/main/cloudflaredTunnel.ts`
- Create: `src/main/cloudflaredTunnel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/cloudflaredTunnel.test.ts`. The "binary" is a **real shell script** spawned
through `binaryPathOverride` — Finding 9. No mock of `child_process`, and nothing touches the
network.

```ts
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let root = ''

vi.mock('electron', () => ({ app: { getPath: (): string => root } }))

import { cloudflaredProvider, reapStrayTunnel, tunnelPidfilePath } from './cloudflaredTunnel'

/** A stub that behaves like cloudflared's --url mode: prints the banner to
 * stderr in two chunks (so the accumulate-across-chunks path is real, not
 * assumed) and then stays up until it is killed. */
function stubBinary(dir: string, body: string): string {
  const path = join(dir, 'stub-cloudflared')
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}

const HEALTHY = `#!/bin/sh
printf '%s' 'INF |  https://four-random' >&2
sleep 0.05
printf '%s\\n' '-words.trycloudflare.com  |' >&2
while true; do sleep 1; done
`

const SILENT = `#!/bin/sh
while true; do sleep 1; done
`

const CRASHER = `#!/bin/sh
printf '%s\\n' 'INF |  https://four-random-words.trycloudflare.com  |' >&2
sleep 0.2
exit 3
`

describe('cloudflaredProvider.open', () => {
  let dir = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cftroot-'))
    dir = mkdtempSync(join(tmpdir(), 'cft-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the hostname out of a banner split across chunks', async () => {
    const tunnel = await cloudflaredProvider({
      binaryPathOverride: stubBinary(dir, HEALTHY)
    }).open(7373, { timeoutMs: 5000, onClosed: () => {} })
    expect(tunnel.origin).toBe('https://four-random-words.trycloudflare.com')
    expect(tunnel.host).toBe('four-random-words.trycloudflare.com')
    await tunnel.stop()
  }, 15000)

  it('rejects on a timeout and leaves nothing running', async () => {
    const provider = cloudflaredProvider({ binaryPathOverride: stubBinary(dir, SILENT) })
    await expect(provider.open(7373, { timeoutMs: 300, onClosed: () => {} })).rejects.toThrow(
      /timed out/
    )
    expect(existsSync(tunnelPidfilePath())).toBe(false)
  }, 15000)

  it('rejects when the binary is not there, without spawning anything', async () => {
    const provider = cloudflaredProvider({ binaryPathOverride: join(dir, 'nope') })
    await expect(provider.open(7373, { timeoutMs: 300, onClosed: () => {} })).rejects.toThrow(
      /not found/
    )
  })

  it('calls onClosed exactly once when it crashes', async () => {
    let closed = 0
    const tunnel = await cloudflaredProvider({
      binaryPathOverride: stubBinary(dir, CRASHER)
    }).open(7373, { timeoutMs: 5000, onClosed: () => (closed += 1) })
    await new Promise((r) => setTimeout(r, 600))
    expect(closed).toBe(1)
    await tunnel.stop()
    expect(closed).toBe(1)
  }, 15000)

  it('does not call onClosed for a stop we asked for', async () => {
    let closed = 0
    const tunnel = await cloudflaredProvider({
      binaryPathOverride: stubBinary(dir, HEALTHY)
    }).open(7373, { timeoutMs: 5000, onClosed: () => (closed += 1) })
    await tunnel.stop()
    await new Promise((r) => setTimeout(r, 200))
    expect(closed).toBe(0)
  }, 15000)

  it('stop is idempotent', async () => {
    const tunnel = await cloudflaredProvider({
      binaryPathOverride: stubBinary(dir, HEALTHY)
    }).open(7373, { timeoutMs: 5000, onClosed: () => {} })
    await tunnel.stop()
    await tunnel.stop()
  }, 15000)

  // A STRAY TUNNEL IS WORSE THAN A STRAY ENGINE -- one holds an audio device,
  // the other holds a door to the internet. There is a documented orphan in
  // this project (an engine that survived with PPID 1), so this layer is the
  // one that has to work when the app dies without running any handler.
  it('writes a pidfile while it runs and deletes it on a clean stop', async () => {
    const tunnel = await cloudflaredProvider({
      binaryPathOverride: stubBinary(dir, HEALTHY)
    }).open(7373, { timeoutMs: 5000, onClosed: () => {} })
    expect(existsSync(tunnelPidfilePath())).toBe(true)
    const record = JSON.parse(readFileSync(tunnelPidfilePath(), 'utf-8')) as { pid: number }
    expect(typeof record.pid).toBe('number')
    await tunnel.stop()
    expect(existsSync(tunnelPidfilePath())).toBe(false)
  }, 15000)
})

describe('reapStrayTunnel', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cftroot-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('does nothing when there is no pidfile', () => {
    expect(reapStrayTunnel()).toBe('none')
  })

  it('clears a pidfile whose process is long gone', () => {
    writeFileSync(
      tunnelPidfilePath(),
      JSON.stringify({ pid: 999999, startedAt: 0, binaryPath: '/nope/cloudflared' })
    )
    expect(reapStrayTunnel()).toBe('gone')
    expect(existsSync(tunnelPidfilePath())).toBe(false)
  })

  // THE RECYCLED-PID TRAP. Killing by pid alone would eventually kill
  // something innocent, so the command has to match too.
  it('refuses to kill a live pid that is not our binary', () => {
    writeFileSync(
      tunnelPidfilePath(),
      JSON.stringify({
        pid: process.pid,
        startedAt: 0,
        binaryPath: '/definitely/not/this/cloudflared'
      })
    )
    expect(reapStrayTunnel()).toBe('mismatch')
    expect(existsSync(tunnelPidfilePath())).toBe(false)
  })
})
```

Add `vi` to the vitest import.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/cloudflaredTunnel.test.ts`
Expected: FAIL — `Failed to resolve import "./cloudflaredTunnel"`.

- [ ] **Step 3: Implement**

Create `src/main/cloudflaredTunnel.ts`:

```ts
// src/main/cloudflaredTunnel.ts
//
// The TunnelProvider implementation, and the four layers that make sure it
// dies with the app -- see the spec's §4.4.
//
// WHY FOUR LAYERS AND NOT ONE. There is a documented orphan in this project:
// a stray engine survived with PPID 1 and held the audio device. A stray
// TUNNEL is strictly worse, because it holds a door to the internet open. No
// single layer covers a hard crash of the whole app, so:
//   1. no `detached`, so the child is in our process group;
//   2. every teardown path SIGTERMs then SIGKILLs (stop button, remote off,
//      will-quit, sleep, idle);
//   3. a synchronous kill on process.on('exit'), in src/main/index.ts, which
//      is the last hook that runs when electron tears down without quitting;
//   4. a pidfile and a reaper at next start -- THE ONLY LAYER THAT SURVIVES A
//      HARD CRASH, and therefore the one that actually matters.
//
// Honest bound, so this is not over-claimed: a stray cloudflared pointed at a
// port with nothing listening is a 502, not an exposure. It only becomes one
// if the app restarts and the remote is switched on underneath it -- and the
// reaper runs at start, before any of that, so the window does not open.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  parseQuickTunnelUrl,
  type PublicTunnel,
  type TunnelOpenOptions,
  type TunnelProvider
} from '@shared/publicTunnel'
import { installedCloudflaredPath, isCloudflaredInstalled } from './cloudflaredInstall'

/** How long a SIGTERM is given before SIGKILL. */
const TERM_GRACE_MS = 2000

export function tunnelPidfilePath(): string {
  return join(app.getPath('userData'), 'cloudflared', 'running.json')
}

interface PidRecord {
  pid: number
  startedAt: number
  binaryPath: string
}

function writePidfile(record: PidRecord): void {
  mkdirSync(dirname(tunnelPidfilePath()), { recursive: true })
  writeFileSync(tunnelPidfilePath(), JSON.stringify(record), 'utf-8')
}

function clearPidfile(): void {
  rmSync(tunnelPidfilePath(), { force: true })
}

export type ReapOutcome = 'none' | 'gone' | 'mismatch' | 'killed'

/** Called ONCE at app start, before anything can start a tunnel. */
export function reapStrayTunnel(): ReapOutcome {
  if (!existsSync(tunnelPidfilePath())) return 'none'
  let record: PidRecord
  try {
    record = JSON.parse(readFileSync(tunnelPidfilePath(), 'utf-8')) as PidRecord
  } catch {
    clearPidfile()
    return 'gone'
  }
  clearPidfile()
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(record.pid, 0)
  } catch {
    return 'gone'
  }
  // BOTH CHECKS, ALWAYS. A pid is recycled; killing on the pid alone would
  // eventually kill something innocent that happens to hold that number.
  let command = ''
  try {
    command = execFileSync('/bin/ps', ['-p', String(record.pid), '-o', 'comm='], {
      encoding: 'utf8'
    }).trim()
  } catch {
    return 'gone'
  }
  if (command !== record.binaryPath) return 'mismatch'
  try {
    process.kill(record.pid, 'SIGKILL')
  } catch {
    return 'gone'
  }
  console.warn(`cloudflaredTunnel: killed a stray tunnel from a previous run (pid ${record.pid})`)
  return 'killed'
}

export interface CloudflaredOptions {
  /** Tests only -- a stub script standing in for the real binary, the same
   * convention engineProcess.ts and pluginScan.ts use. Production reads the
   * installed path. */
  binaryPathOverride?: string
}

export function cloudflaredProvider(options: CloudflaredOptions = {}): TunnelProvider {
  const binaryPath = options.binaryPathOverride ?? installedCloudflaredPath()
  return {
    label: 'cloudflare quick tunnel',
    ready: (): Promise<boolean> =>
      Promise.resolve(
        options.binaryPathOverride !== undefined
          ? existsSync(binaryPath)
          : isCloudflaredInstalled()
      ),
    open: (port, openOptions) => openTunnel(binaryPath, port, openOptions)
  }
}

function openTunnel(
  binaryPath: string,
  port: number,
  options: TunnelOpenOptions
): Promise<PublicTunnel> {
  if (!existsSync(binaryPath)) {
    return Promise.reject(new Error(`cloudflared not found at ${binaryPath}`))
  }

  return new Promise<PublicTunnel>((resolve, reject) => {
    // --no-autoupdate is NOT optional: a binary that rewrites itself
    // invalidates the pinned checksum and the signature that were checked
    // against it (see cloudflaredInstall.ts).
    const proc: ChildProcess = spawn(
      binaryPath,
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )

    let settled = false
    let stopping = false
    let closedFired = false
    // ACCUMULATED, NOT PER-CHUNK, for exactly the reason engineProcess.ts
    // records: os pipe buffering splits one logical stderr write across
    // several data events, and testing only the latest chunk misses a split
    // banner and times out on a healthy start.
    let stderrBuffer = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.kill('SIGKILL')
      clearPidfile()
      reject(new Error(`timed out waiting for a tunnel url (${options.timeoutMs}ms)`))
    }, options.timeoutMs)

    function fireClosed(reason: string): void {
      if (closedFired || stopping) return
      closedFired = true
      clearPidfile()
      options.onClosed(reason)
    }

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      console.log('[cloudflared]', text)
      if (settled) return
      stderrBuffer += text
      const origin = parseQuickTunnelUrl(stderrBuffer)
      if (origin === null) return
      settled = true
      clearTimeout(timer)
      if (proc.pid !== undefined) {
        writePidfile({ pid: proc.pid, startedAt: Date.now(), binaryPath })
      }
      resolve({
        origin,
        host: origin.replace(/^https:\/\//, ''),
        stop: (): Promise<void> => stopProcess(proc, () => (stopping = true))
      })
    })

    proc.once('error', (err) => {
      if (settled) return fireClosed(err.message)
      settled = true
      clearTimeout(timer)
      clearPidfile()
      reject(err)
    })

    proc.once('exit', (code) => {
      if (settled) return fireClosed(`cloudflared exited (code ${code})`)
      settled = true
      clearTimeout(timer)
      clearPidfile()
      reject(new Error(`cloudflared exited early (code ${code}) before reporting a url`))
    })
  })
}

/** SIGTERM, a grace period, then SIGKILL -- and resolve only once the process
 * is actually gone, so a caller that awaits this can safely assume nothing is
 * left holding the port or the door. */
function stopProcess(proc: ChildProcess, markStopping: () => void): Promise<void> {
  markStopping()
  clearPidfile()
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const kill = setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }, TERM_GRACE_MS)
    proc.once('exit', () => {
      clearTimeout(kill)
      resolve()
    })
    proc.kill('SIGTERM')
  })
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/main/cloudflaredTunnel.test.ts`
Expected: PASS, 10 tests. If the pidfile `comm=` comparison fails because `ps` truncates or
reports a basename rather than the full path on this machine, **fix it by comparing the basename
on both sides** and note the change in the commit message — do not relax the check to pid-only.

- [ ] **Step 5: Commit**

```bash
git add src/main/cloudflaredTunnel.ts src/main/cloudflaredTunnel.test.ts
git commit -m "a tunnel that dies four different ways, because a stray one is a door left open"
```

---

## Task 9: Main wires it up

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts` (+ `src/preload/index.d.ts` if present)

- [ ] **Step 1: The state and the lifecycle**

In `src/main/index.ts`, beside the other phone-remote module state:

```ts
/** The public tunnel, when one is running. Off by default, never
 * auto-started, never started by a failure, and gone on every teardown path
 * -- see cloudflaredTunnel.ts for the four layers and why there are four. */
let publicTunnel: PublicTunnel | null = null
let tunnelStartedAt = 0
let lastTunnelRequestAt: number | null = null
let tunnelNotice: string | null = null

function currentTunnelHost(): string | null {
  return publicTunnel?.host ?? null
}

async function stopPublicTunnel(notice: string | null): Promise<void> {
  const tunnel = publicTunnel
  publicTunnel = null
  lastTunnelRequestAt = null
  tunnelNotice = notice
  await tunnel?.stop()
  mainWindow?.webContents.send('phone-remote-status', phoneRemoteStatus())
}
```

Extend `PhoneRemoteStatus` (in `src/main/index.ts`, in `src/preload/index.ts`, and in
`src/shared/phoneRemoteView.ts` — all three carry the same shape):

```ts
  /** The public origin when a tunnel is running, else null. */
  tunnelOrigin: string | null
  /** The capability link the tunnel qr encodes, else null. */
  tunnelLink: string | null
  /** Why the last tunnel stopped, when it stopped for a reason worth saying.
   * Cleared when a new one starts. */
  tunnelNotice: string | null
  /** Whether the disclosure has been accepted on this machine, at the current
   * disclosure version. */
  tunnelConsented: boolean
  /** Whether the provider's binary is already on disk. */
  tunnelReady: boolean
```

and fill them in `phoneRemoteStatus()`:

```ts
    tunnelOrigin: publicTunnel?.origin ?? null,
    tunnelLink:
      publicTunnel !== null && remoteServer !== null
        ? capabilityUrl(publicTunnel.origin, remoteServer.grantToken)
        : null,
    tunnelNotice,
    tunnelConsented:
      loadPhoneRemoteSettings().tunnelConsentVersion === TUNNEL_DISCLOSURE_VERSION,
    tunnelReady: isCloudflaredInstalled()
```

> `remoteServer.grantToken` is the token the server started with. Task 12's `new link` handler
> calls `renewGrant()` and pushes a fresh status immediately, so the modal never reads a stale one.
> If you prefer, hold the live token in a module variable updated by both sites — either is fine,
> **pick one and use it in both places.**

- [ ] **Step 2: Replace the three Phase A stubs**

In the `startRemoteServer` call:

```ts
    tunnelHost: currentTunnelHost,
    approveClaim: askToApproveClaim,
    onTunnelAbuse: () => {
      void stopPublicTunnel('too many attempts, tunnel stopped')
    },
```

- [ ] **Step 3: The IPC handlers**

Beside the other `phone-remote` handlers:

```ts
  ipcMain.handle('accept-tunnel-disclosure', () => {
    savePhoneRemoteSettings({
      ...loadPhoneRemoteSettings(),
      tunnelConsentVersion: TUNNEL_DISCLOSURE_VERSION
    })
    return phoneRemoteStatus()
  })

  ipcMain.handle('install-tunnel-provider', async () => {
    const result = await installCloudflared()
    if (!result.ok) {
      console.error(`install-tunnel-provider: ${result.message}`)
      tunnelNotice = installNotice(result.reason)
    }
    return phoneRemoteStatus()
  })

  /** THE ONLY WAY A TUNNEL EVER STARTS. Nothing auto-starts it, nothing falls
   * back to it, and it refuses to start at all unless the remote is already
   * up and the disclosure has been accepted on this machine -- there is no
   * point opening a door to a server that is not running, and no version of
   * this feature runs without consent. */
  ipcMain.handle('start-phone-tunnel', async () => {
    if (publicTunnel !== null) return phoneRemoteStatus()
    if (remoteServer === null) return phoneRemoteStatus()
    if (loadPhoneRemoteSettings().tunnelConsentVersion !== TUNNEL_DISCLOSURE_VERSION) {
      return phoneRemoteStatus()
    }
    try {
      publicTunnel = await cloudflaredProvider().open(REMOTE_PORT, {
        timeoutMs: TUNNEL_READY_TIMEOUT_MS,
        onClosed: (reason) => {
          console.warn(`phone tunnel closed: ${reason}`)
          // NO AUTOMATIC RESTART. A restart mints a new hostname AND a new
          // token, silently invalidating the qr code on screen. Restarting is
          // a button.
          void stopPublicTunnel('tunnel stopped')
        }
      })
      tunnelStartedAt = Date.now()
      lastTunnelRequestAt = null
      tunnelNotice = null
    } catch (err) {
      console.error('start-phone-tunnel:', err)
      publicTunnel = null
      tunnelNotice = 'the tunnel did not start'
    }
    return phoneRemoteStatus()
  })

  ipcMain.handle('stop-phone-tunnel', async () => {
    await stopPublicTunnel(null)
    return phoneRemoteStatus()
  })

  /** A fresh capability grant without restarting the process -- the modal's
   * `new link`, for when the first qr was photographed. */
  ipcMain.handle('renew-tunnel-link', () => {
    remoteServer?.renewGrant()
    return phoneRemoteStatus()
  })
```

with:

```ts
function installNotice(reason: InstallFailure): string {
  if (reason === 'download') return 'could not download it'
  if (reason === 'checksum') return 'the file did not match'
  if (reason === 'signature') return 'the signature did not check out'
  return 'could not unpack it'
}
```

- [ ] **Step 4: Every teardown path**

In `stopPhoneRemote()`, first line — **the tunnel goes with the remote, always**:

```ts
function stopPhoneRemote(): void {
  // The tunnel is a door INTO this server. It can never outlive it.
  void stopPublicTunnel(null)
  remoteServer?.stop()
  …
```

Beside `app.on('will-quit', …)` (which already calls `stopPhoneRemote()`), add:

```ts
// LAYER 3 OF FOUR (see cloudflaredTunnel.ts). The last hook that runs when
// electron tears down without a clean quit. Synchronous only -- no awaits, no
// promises; there is no event loop left to resolve one.
process.on('exit', () => {
  try {
    execFileSync('/bin/rm', ['-f', tunnelPidfilePath()])
  } catch {
    /* nothing to do at exit */
  }
})

// A LAPTOP SHOULD NOT CLOSE ITS LID WITH A DOOR OPEN ITS OWNER HAS FORGOTTEN.
// Sleep stops playback anyway, so this costs nothing, and it closes a real
// exposure window. The modal says so on resume rather than pretending.
powerMonitor.on('suspend', () => {
  if (publicTunnel === null) return
  void stopPublicTunnel('tunnel stopped on sleep')
})
```

> The `process.on('exit')` handler cannot `await tunnel.stop()`. The actual kill at that moment
> comes from layer 1: the child is in our process group and has no `detached`. This handler only
> clears the pidfile so the reaper has nothing stale to chase. **If you would rather leave the
> pidfile for the reaper to handle, delete this handler entirely and say so** — three layers that
> work beat four where one is decorative.

Reap at start, in the same place `startPlaybackEngine()` is called:

```ts
  // LAYER 4, and the only one that survives a hard crash. Before anything can
  // start a tunnel.
  reapStrayTunnel()
```

- [ ] **Step 5: Preload**

```ts
  acceptTunnelDisclosure: (): Promise<PhoneRemoteStatus> =>
    ipcRenderer.invoke('accept-tunnel-disclosure'),
  installTunnelProvider: (): Promise<PhoneRemoteStatus> =>
    ipcRenderer.invoke('install-tunnel-provider'),
  startPhoneTunnel: (): Promise<PhoneRemoteStatus> => ipcRenderer.invoke('start-phone-tunnel'),
  stopPhoneTunnel: (): Promise<PhoneRemoteStatus> => ipcRenderer.invoke('stop-phone-tunnel'),
  renewTunnelLink: (): Promise<PhoneRemoteStatus> => ipcRenderer.invoke('renew-tunnel-link'),
```

and extend the preload's own `PhoneRemoteStatus` interface with the five new fields.

- [ ] **Step 6: Persist the consent**

In `src/main/phoneRemoteSettingsStore.ts`, add to `PhoneRemoteSettings`:

```ts
  /** Which version of the tunnel disclosure was accepted on this machine, or
   * null if it never was.
   *
   * A VERSION AND NOT A BOOLEAN, so that a change to what the disclosure says
   * -- what cloudflare can see, what the terms are -- re-asks instead of
   * riding on a yes given to different text. Per machine, beside
   * preferredAddress, never in a .sssketchproj: it describes a decision about
   * this computer's network, not the music on it. */
  tunnelConsentVersion: number | null
```

with the same defaulting-and-never-throwing shape the file already uses, `DEFAULT_SETTINGS` gaining
`tunnelConsentVersion: null`, and a parse guard of
`typeof parsed.tunnelConsentVersion === 'number' ? parsed.tunnelConsentVersion : null`.

Add to `src/main/phoneRemoteSettingsStore.test.ts`:

```ts
  it('defaults tunnel consent to null, so a fresh machine is asked', () => {
    expect(loadPhoneRemoteSettings().tunnelConsentVersion).toBe(null)
  })

  it('round-trips a tunnel consent version alongside the address', () => {
    savePhoneRemoteSettings({ preferredAddress: '192.168.1.40', tunnelConsentVersion: 1 })
    expect(loadPhoneRemoteSettings()).toEqual({
      preferredAddress: '192.168.1.40',
      tunnelConsentVersion: 1
    })
  })

  it('treats a non-numeric consent version as never consented', () => {
    writeFileSync(storeFile(), JSON.stringify({ tunnelConsentVersion: 'yes' }))
    expect(loadPhoneRemoteSettings().tunnelConsentVersion).toBe(null)
  })
```

(match the file's existing helpers for `storeFile()` / the temp userData dir).

- [ ] **Step 7: Verify**

```bash
npx vitest run src/main/phoneRemoteSettingsStore.test.ts
npm run typecheck
npm run lint
```

Expected: PASS, 0 errors, 4 prettier warnings.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/main/phoneRemoteSettingsStore.ts src/main/phoneRemoteSettingsStore.test.ts
git commit -m "one way to open it, five ways it closes, and a consent that knows what it agreed to"
```

---

## Task 10: The copy, and the view model

**Files:**
- Modify: `src/shared/phoneRemoteView.ts`
- Modify: `src/shared/phoneRemoteView.test.ts`

The copy lives in `src/shared/`, where it is testable and where it cannot drift into three places.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/phoneRemoteView.test.ts`:

```ts
describe('TUNNEL_DISCLOSURE', () => {
  it('is lowercase, with no emoji and no exclamation marks', () => {
    const text = TUNNEL_DISCLOSURE.join(' ')
    expect(text).toBe(text.toLowerCase())
    expect(text).not.toMatch(/!/)
    // eslint-disable-next-line no-control-regex
    expect(text).toMatch(/^[\x00-\x7F]*$/)
  })

  it('names all four things a person is agreeing to', () => {
    const text = TUNNEL_DISCLOSURE.join(' ')
    expect(text).toContain('internet')
    expect(text).toContain('cloudflare')
    expect(text).toContain('no audio')
    expect(text).toContain('terms')
  })

  it('is versioned, so changing it re-asks', () => {
    expect(TUNNEL_DISCLOSURE_VERSION).toBe(1)
  })
})

describe('phoneRemoteTunnelView', () => {
  const base: PhoneRemoteStatus = {
    running: true,
    url: 'http://192.168.1.40:7373',
    pairingCode: 'K7QM',
    attemptsUsed: 0,
    lockedOut: false,
    lanAddress: '192.168.1.40',
    candidates: [],
    tunnelOrigin: null,
    tunnelLink: null,
    tunnelNotice: null,
    tunnelConsented: false,
    tunnelReady: false
  }

  it('asks for consent first, on a machine that has never said yes', () => {
    expect(phoneRemoteTunnelView(base).step).toBe('consent')
  })

  it('offers to start once consent is given and the program is there', () => {
    expect(
      phoneRemoteTunnelView({ ...base, tunnelConsented: true, tunnelReady: true }).step
    ).toBe('idle')
  })

  it('needs the program before it can start', () => {
    expect(
      phoneRemoteTunnelView({ ...base, tunnelConsented: true, tunnelReady: false }).step
    ).toBe('needs-install')
  })

  it('is running once there is an origin, and carries the link the qr encodes', () => {
    const view = phoneRemoteTunnelView({
      ...base,
      tunnelConsented: true,
      tunnelReady: true,
      tunnelOrigin: 'https://four-words.trycloudflare.com',
      tunnelLink: 'https://four-words.trycloudflare.com/#k=abc'
    })
    expect(view.step).toBe('running')
    expect(view.link).toBe('https://four-words.trycloudflare.com/#k=abc')
  })

  it('says what it is while it is on, including the thing it cannot do', () => {
    const view = phoneRemoteTunnelView({
      ...base,
      tunnelConsented: true,
      tunnelReady: true,
      tunnelOrigin: 'https://four-words.trycloudflare.com',
      tunnelLink: 'https://four-words.trycloudflare.com/#k=abc'
    })
    expect(view.lines.join(' ')).toContain('controls only, no audio')
  })

  it('passes a notice through without inventing one', () => {
    expect(phoneRemoteTunnelView(base).notice).toBe(null)
    expect(phoneRemoteTunnelView({ ...base, tunnelNotice: 'tunnel stopped' }).notice).toBe(
      'tunnel stopped'
    )
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/phoneRemoteView.test.ts`
Expected: FAIL — `TUNNEL_DISCLOSURE is not defined`.

- [ ] **Step 3: Implement**

Append to `src/shared/phoneRemoteView.ts` (and add the five new fields to the
`PhoneRemoteStatus` interface at the top of that file, matching main and preload):

```ts
/** Bumped when the disclosure's TEXT changes in a way that changes what a
 * person is agreeing to. A stored consent at an older version re-asks. */
export const TUNNEL_DISCLOSURE_VERSION = 1

/** THE WHOLE CONSENT, and it is written to be read rather than clicked past.
 *
 * Four paragraphs because there are four things somebody is agreeing to and
 * pretending there are fewer would be the checkbox-nobody-reads version of
 * this: that their machine becomes reachable from the internet; that a third
 * party carries it and can see who is talking to whom and when; that the
 * third party calls it a testing service with no promises; and that a program
 * gets downloaded from that third party.
 *
 * Lowercase, no emoji, no exclamation marks, like everything else in this
 * app. Buttons are `not now` and `turn on`. */
export const TUNNEL_DISCLOSURE: readonly string[] = [
  'this makes a link that reaches this mac from the internet, so the phone can connect when the wifi will not carry it.',
  'the link goes through cloudflare. they can see the address of this mac, the address of the phone, and when each request happens. no audio goes over this link -- the phone is controls only, and the sound stays here.',
  "cloudflare calls this a testing service. there is no uptime promise, and they can change or withdraw it. using it accepts cloudflare's terms.",
  'it downloads a small program from cloudflare the first time. it runs only while you leave it on, and stops when you close the remote, when this mac sleeps, and when you quit.'
]

export const TUNNEL_TERMS_URL = 'https://www.cloudflare.com/website-terms/'

export type PhoneRemoteTunnelStep = 'consent' | 'needs-install' | 'idle' | 'running'

export interface PhoneRemoteTunnelView {
  step: PhoneRemoteTunnelStep
  /** The capability link the tunnel qr encodes, when running. */
  link: string | null
  /** What to say under the heading, in this step. */
  lines: readonly string[]
  /** The last thing that went wrong or stopped, or null. */
  notice: string | null
}

const RUNNING_LINES: readonly string[] = [
  'this link reaches this mac from the internet.',
  'controls only, no audio.',
  'the old link stops working when you stop it.'
]

export function phoneRemoteTunnelView(status: PhoneRemoteStatus): PhoneRemoteTunnelView {
  const notice = status.tunnelNotice
  if (status.tunnelOrigin !== null) {
    return { step: 'running', link: status.tunnelLink, lines: RUNNING_LINES, notice }
  }
  if (!status.tunnelConsented) {
    return { step: 'consent', link: null, lines: TUNNEL_DISCLOSURE, notice }
  }
  if (!status.tunnelReady) {
    return {
      step: 'needs-install',
      link: null,
      lines: ['it needs a small program from cloudflare the first time.'],
      notice
    }
  }
  return {
    step: 'idle',
    link: null,
    lines: ['controls only, no audio. it stops when you stop it.'],
    notice
  }
}
```

Add `tunnel: phoneRemoteTunnelView(status)` to `PhoneRemoteModalView` and to
`phoneRemoteModalView()`'s return.

> Note the double quotes on the third paragraph: prettier's `singleQuote: true` makes an
> apostrophe-bearing string the one place a double-quoted literal is correct, and it will not
> rewrite it. Do not escape it into a single-quoted string.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/shared/phoneRemoteView.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add src/shared/phoneRemoteView.ts src/shared/phoneRemoteView.test.ts
git commit -m "say the four things plainly, once, and remember which version was agreed to"
```

---

## Task 11: The tunnel block on the card

**Files:**
- Modify: `src/renderer/src/components/PhoneRemoteModal.tsx`

No component test — Finding 11. The component's props gain `view.tunnel` (Task 10) and five
callbacks.

- [ ] **Step 1: New props**

```tsx
  /** Records the one-time consent. */
  onAcceptTunnelDisclosure: () => void
  onInstallTunnelProvider: () => void
  onStartTunnel: () => void
  onStopTunnel: () => void
  /** A fresh capability link without restarting the tunnel, for when the
   * first qr was photographed. */
  onRenewTunnelLink: () => void
```

Wire all five at the call site to the preload methods from Task 9, each followed by pushing the
returned status into whatever state already holds `PhoneRemoteStatus`.

- [ ] **Step 2: The block, inside the existing disclosure**

Inside the `{troubleOpen && ( … )}` region, **after** the `REMOTE_TROUBLE_REASONS` spans and
after the address rows — that placement is the argument, spec §8.1:

```tsx
            {troubleOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--ra-s-1)',
                  borderTop: '1px solid var(--ra-border)',
                  paddingTop: 'var(--ra-s-2)'
                }}
              >
                <span className="ra-eyebrow">connect from anywhere</span>
                {view.tunnel.lines.map((line) => (
                  <span key={line} style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
                    {line}
                  </span>
                ))}
                {view.tunnel.step === 'consent' && (
                  <a
                    href={TUNNEL_TERMS_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 10, color: 'var(--ra-text-2)' }}
                  >
                    cloudflare terms
                  </a>
                )}
                {view.tunnel.notice !== null && (
                  <span style={{ fontSize: 10, color: 'var(--ra-mute-on)' }}>
                    {view.tunnel.notice}
                  </span>
                )}
                <div style={{ display: 'flex', gap: 'var(--ra-s-2)', flexWrap: 'wrap' }}>
                  {view.tunnel.step === 'consent' && (
                    <button
                      onClick={onAcceptTunnelDisclosure}
                      aria-label="accept and set up the internet link"
                      title="uses the internet"
                      style={buttonStyle}
                    >
                      turn on
                    </button>
                  )}
                  {view.tunnel.step === 'needs-install' && (
                    <button
                      onClick={onInstallTunnelProvider}
                      aria-label="download the program cloudflare needs"
                      title="downloads it"
                      style={buttonStyle}
                    >
                      get it
                    </button>
                  )}
                  {view.tunnel.step === 'idle' && (
                    <button
                      onClick={onStartTunnel}
                      aria-label="start the internet link"
                      title="opens the link"
                      style={buttonStyle}
                    >
                      start tunnel
                    </button>
                  )}
                  {view.tunnel.step === 'running' && (
                    <>
                      <button
                        onClick={onStopTunnel}
                        aria-label="stop the internet link"
                        title="closes it"
                        style={{ ...buttonStyle, color: 'var(--ra-mute-on)' }}
                      >
                        stop tunnel
                      </button>
                      <button
                        onClick={onRenewTunnelLink}
                        aria-label="make a fresh link"
                        title="new code"
                        style={buttonStyle}
                      >
                        new link
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
```

- [ ] **Step 3: Swap the QR when the tunnel is running**

Replace the `qr` memo so the tunnel link wins when there is one:

```tsx
  // THE TUNNEL LINK WHEN THERE IS ONE. Two qr codes on one card would be two
  // things to choose between at exactly the moment somebody is already stuck.
  // The lan link is still the address text above, still typed, still copied.
  const qrTarget = view.tunnel.link ?? view.pairedUrl
  const qr = useMemo(() => qrSvg(qrTarget), [qrTarget])
```

and point the copy button at `qrTarget` too, so `copy link` copies whichever link the QR shows.

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 errors, 4 prettier warnings, no new test failures.

**Report honestly that no modal was seen and no QR was scanned.**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/PhoneRemoteModal.tsx
git commit -m "the way out lives under the question that runs out of answers"
```

---

## Task 12: The phone, over the tunnel

**Files:**
- Modify: `src/main/remotePage.ts`

Two changes, and **`REMOTE_PAGE_CSP` is not one of them** — a tunnel is the same origin, so
`connect-src 'self'` still holds (Finding 12).

- [ ] **Step 1: The claim branch**

Beside the existing `REMOTE_PAIR_QUERY_PARAM` branch, and **before** it, so a page opened from a
tunnel QR never tries the LAN form:

```js
  // THE TUNNEL'S WAY IN. The mac's tunnel qr encodes .../#k=<128 bits>. A
  // fragment is never sent to a server (rfc 3986), so the token stays out of
  // access logs and Referer -- the page reads it and POSTs it in a body
  // instead.
  //
  // Scrubbed BEFORE the request, and whether or not this page is already
  // paired, for the same two reasons the lan code is: a token left in the
  // address bar rides along in a reload, a screenshot or a shared tab; and a
  // stale one would spend an attempt off the twenty-attempt budget on every
  // refresh.
  var hashMatch = /[#&]k=([^&]*)/.exec(location.hash)
  if (hashMatch) {
    var claimKey = decodeURIComponent(hashMatch[1])
    try { history.replaceState(null, '', location.pathname) } catch (e) {}
    if (!token) {
      pairMsgEl.textContent = 'asking the mac'
      fetch('/api/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ k: claimKey })
      })
        .then(function (r) {
          if (r.status === 410) throw new Error('used')
          if (r.status === 429) throw new Error('busy')
          if (r.status === 403) throw new Error('refused')
          if (!r.ok) throw new Error('wrong')
          return r.json()
        })
        .then(function (j) {
          token = j.token
          try { localStorage.setItem('sssketch-remote-token', token) } catch (e) {}
          pairMsgEl.textContent = ''
          show(true)
          poll()
        })
        .catch(function (e) {
          pairMsgEl.textContent =
            e.message === 'used' ? 'that link is used up. get a new one on the mac.'
            : e.message === 'busy' ? 'the mac is already being asked. try again.'
            : e.message === 'refused' ? 'the mac said no.'
            : 'that link did not work.'
        })
    }
  }
```

- [ ] **Step 2: Controls only, over the tunnel**

Where the poll handles the state response, hold the door on the mixer:

```js
  // CONTROLS ONLY OVER THE INTERNET. The mac refuses /api/loop and /api/stem
  // on the tunnel path regardless of what this page does -- cloudflare's cdn
  // terms name audio files and large files specifically -- so asking would
  // only produce a row of failed fetches and a wrong-looking mix. The page
  // therefore never becomes a mixer at all off-lan: no stem fetches, no
  // audio context, no budget accounting.
  var tunnelled = false
```

in the poll's success handler, before `reconcile()`:

```js
      tunnelled = state.via === 'tunnel'
```

and as the first line of the function that owns the mixer (the one at the `EVERYTHING THE MIXER
DOES, in one function` comment) and of `fetchMissing`:

```js
    if (tunnelled) return
```

and in `restStatus()`, before the other cases:

```js
    if (tunnelled) {
      msgEl.textContent = 'controls only over the internet. the audio stays on the mac.'
      return
    }
```

- [ ] **Step 3: Verify**

```bash
npx vitest run src/main/remotePage.test.ts
npm run typecheck && npm run lint
```

Expected: PASS, 0 errors, 4 prettier warnings. If `remotePage.test.ts` asserts anything about the
page string's length or shape, update those assertions rather than trimming the code.

- [ ] **Step 4: Commit**

```bash
git add src/main/remotePage.ts
git commit -m "over the internet the phone is a controller, and it says so instead of failing"
```

---

## Task 13: What leaves the machine, written down

**Files:**
- Create: `PRIVACY.md`
- Modify: `README.md`

**`AI_DISCLOSURE.md` is NOT edited** — it is about who wrote the code, not about what leaves the
machine, and editing it by analogy blurs a document whose value is that it says one thing.

- [ ] **Step 1: `PRIVACY.md`**

```markdown
# What leaves this machine

sssketch runs locally. Your audio, your projects and your library never leave your computer,
and nothing here phones home. There is one optional feature that sends anything anywhere, and
this page is about that one.

## The phone remote, on your own network

The default. sssketch runs a small web server on port 7373 and your phone loads a page from it
over your wifi. Nothing leaves your network, no account is involved, and no third party is
touched. It is off by default and stops when you quit.

## The phone remote, from the internet — optional, off by default

Some routers keep devices on the same wifi from reaching each other. When that happens the
default path cannot work at all, and sssketch can open an outbound tunnel instead, so the phone
reaches this Mac from the internet rather than across the wifi.

It uses **cloudflared** (Apache-2.0), Cloudflare's own program, downloaded on demand from
Cloudflare's releases the first time you turn it on. It is not bundled with sssketch.

While it is running, **Cloudflare carries the connection and terminates its TLS**, so they can
see:

- this Mac's IP address, and the phone's IP address — which is roughly where you are, and, if
  the phone is on cellular, where it has been;
- when each request happens, how long the session lasts, and how much data it moves;
- the temporary hostname assigned to the tunnel.

They cannot see your audio, because **no audio is sent over this link at all**. Over the tunnel
the phone is a controller only — the loop and the per-stem audio are refused by sssketch itself,
not merely left unrequested. The sound stays on the Mac.

Cloudflare describes quick tunnels as a **testing and development service** with no uptime
promise, and can change, limit or withdraw them at any time. Installing and running cloudflared
accepts [Cloudflare's terms](https://www.cloudflare.com/website-terms/).

**The limit, written down before anyone depends on it:** this is a free third-party service that
nobody here pays for or operates. It may be limited or shut down, and if that happens the phone
remote keeps working on your own network exactly as before.

### Control

- It never starts on its own, and nothing falls back to it. You open the remote, open
  `not connecting?`, read the disclosure once, and press a button.
- It stops when you stop it, when you turn the remote off, when this Mac sleeps, when you quit,
  and after two hours with nothing connected.
- Pairing over it needs a 128-bit single-use link that expires in ten minutes **and** a click on
  this Mac to admit each phone.
- The provider sits behind a one-function seam in the source
  (`src/shared/publicTunnel.ts`), so it can be replaced or self-hosted.

## Crash reports, analytics, telemetry

None. There are none.
```

- [ ] **Step 2: `README.md`**

In the feature list, near the existing Rubberband / third-party lines:

```markdown
  - Phone remote over your own wifi, and — optionally, off by default — from the internet via a
    [cloudflared](https://github.com/cloudflare/cloudflared) quick tunnel (Apache-2.0, downloaded
    on demand from Cloudflare rather than bundled). No audio goes over the tunnel; the phone is a
    controller only. See [PRIVACY.md](PRIVACY.md) for exactly what Cloudflare can see.
```

- [ ] **Step 3: Commit**

```bash
git add PRIVACY.md README.md
git commit -m "write down what leaves the machine, and the limit, before anyone depends on it"
```

---

## Task 14: Phase B checkpoint, and the walkthrough only Elling can do

- [ ] **Step 1: Full verification**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: 5 new test files, ~59 new tests, 0 typecheck errors, 0 lint errors + 4 prettier
warnings. `vitest.config.ts` unchanged. `electron-builder.yml`, `build/afterPack.js` and
`.github/workflows/release.yml` unchanged — check with `git diff --stat master`.

- [ ] **Step 2: Write the walkthrough into the handoff, verbatim**

Real `cloudflared` never runs in CI and cannot run here. These eleven steps are the coverage, and
they are Elling's:

1. Open the phone remote. Confirm the card, the QR, the code and `not connecting?` all look as
   they did.
2. Open `not connecting?`. Confirm `connect from anywhere` is **below** the three reasons and the
   address rows, and that the disclosure is four paragraphs with a `cloudflare terms` link.
3. Press `turn on`, then `get it`. Watch it download. Confirm it names the program and does not
   hang silently.
4. Press `start tunnel`. Confirm a URL appears and the QR changes.
5. **Scan the new QR with the phone, on cellular with wifi off.** Confirm the desktop asks
   `a phone is asking to connect over the internet.` Press `allow once`. Confirm the phone
   connects.
6. Confirm the phone says `controls only over the internet` and shows **no** per-stem faders.
7. Roll a slot from the phone. Confirm it lands on the Mac. Note whether it feels like a control
   or like lag — that judgement is the one nobody else can make.
8. Scan the **same** QR again from a second browser. Confirm it says the link is used up.
9. Press `new link`, scan again, confirm it works, and confirm the previous link does not.
10. Close the lid, wait, open it. Confirm the modal says `tunnel stopped on sleep` and that
    `ps aux | grep cloudflared` shows nothing.
11. Force-quit sssketch while the tunnel is running (Activity Monitor → Force Quit). Confirm
    `ps aux | grep cloudflared` shows nothing, or that relaunching sssketch kills it and logs
    `killed a stray tunnel from a previous run`.

**Also worth knowing, and free to check:** with the phone on the tunnel, the page is HTTPS for the
first time, which means `Screen Wake Lock` is available. If the phone screen stops sleeping
mid-session, that is the quiet second prize landing.

- [ ] **Step 3: Report to Elling**

Name what was tested by the suite, what was not, and the four things from the spec's §12 that
only he can settle.

---

# Phase C — the honest extras

---

## Task 15: Say which path the phone arrived on

**Files:**
- Modify: `src/main/remoteServer.ts`
- Modify: `src/shared/phoneRemoteView.ts`
- Modify: `src/shared/phoneRemoteView.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/components/PhoneRemoteModal.tsx`

The research's one identified gap: *no product in the survey distinguishes "found but unreachable"
from "not found"*, and Syncthing comes closest by naming the mode it ended up in. Once both doors
exist, the Mac gets that for nothing.

- [ ] **Step 1: Write the failing test**

```ts
describe('phoneRemoteConnectionLine', () => {
  it('says nothing before a phone has arrived', () => {
    expect(phoneRemoteConnectionLine(null)).toBe(null)
  })

  it('names the path, which is the whole diagnosis', () => {
    expect(phoneRemoteConnectionLine('lan')).toBe('phone connected · over wi-fi')
    expect(phoneRemoteConnectionLine('tunnel')).toBe('phone connected · over the internet')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/phoneRemoteView.test.ts`
Expected: FAIL — `phoneRemoteConnectionLine is not a function`.

- [ ] **Step 3: Implement**

In `src/shared/phoneRemoteView.ts`:

```ts
/** SYNCTHING'S LESSON, AND IT IS THE ONLY ONE WORTH COPYING FROM THE SURVEY.
 * Its ui reads `Relay (Client)` and its faq says that means a direct
 * connection could not be established. It does not diagnose the router; it
 * says truthfully which path you are on and lets you draw the conclusion.
 *
 * That is a real diagnosis here and not a nicety: if the phone arrives over
 * the tunnel and never over wi-fi, the router is separating the devices, and
 * the person now knows it without anyone probing anything. It only exists
 * because a second path exists. */
export function phoneRemoteConnectionLine(via: RemoteVia | null): string | null {
  if (via === null) return null
  return via === 'tunnel' ? 'phone connected · over the internet' : 'phone connected · over wi-fi'
}
```

In `src/main/remoteServer.ts`, add one option and call it from the authorized branch of the
request handler (after `authorized(req)` passes, so an unpaired prod does not count as a phone):

```ts
  /** The door the last AUTHORIZED request came through, so the desktop can
   * name the path the phone actually arrived on. */
  onPhoneSeen: (via: RemoteVia) => void
```

In `src/main/index.ts`, hold `lastPhoneVia: RemoteVia | null`, set it from `onPhoneSeen`, clear it
in `stopPhoneRemote()`, add `lastPhoneVia` to `PhoneRemoteStatus` (all three copies), and push a
status update **only when the value changes** — the page polls every 700 ms and a status push per
poll would be 1.4 IPC messages a second forever.

In `PhoneRemoteModal.tsx`, render `phoneRemoteConnectionLine(view.lastPhoneVia)` as one
`fontSize: 10, color: 'var(--ra-text-2)'` span above the two exit buttons, when non-null.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/shared/phoneRemoteView.test.ts src/main/remoteServer.test.ts
npm run typecheck && npm run lint
git add src/main/remoteServer.ts src/shared/phoneRemoteView.ts src/shared/phoneRemoteView.test.ts src/main/index.ts src/renderer/src/components/PhoneRemoteModal.tsx
git commit -m "name the path it arrived on, which is the only diagnosis anyone in the survey got right"
```

---

## Task 16: The door does not stay open because you forgot

**Files:**
- Modify: `src/main/remoteServer.ts`
- Modify: `src/main/index.ts`

`shouldStopIdleTunnel` and `TUNNEL_IDLE_STOP_MS` already exist and are already tested (Task 6).
This task only wires them.

- [ ] **Step 1: Record when a tunnelled request last arrived**

In `remoteServer.ts`, extend `onPhoneSeen`'s call site to fire for **every** admitted request on
the tunnel door, not only authorized ones — an unpaired phone reloading the page is still the
tunnel being used, and stopping it underneath somebody mid-pairing would be worse than leaving it
up an hour longer. (Keep `lastPhoneVia` in index.ts fed only by the authorized path; these are two
different questions sharing one callback, so pass the authorization state:)

```ts
  onRequestSeen: (via: RemoteVia, authorized: boolean) => void
```

Replace `onPhoneSeen` with this and update Task 15's wiring accordingly:
`lastPhoneVia` is set only when `authorized` is true; `lastTunnelRequestAt` is set whenever
`via === 'tunnel'`.

- [ ] **Step 2: The timer**

In `src/main/index.ts`, when a tunnel starts:

```ts
  // A door nobody has walked through in two hours is a door somebody forgot.
  // The page polls every 700ms while it is open, so idle genuinely means the
  // page is closed -- see shouldStopIdleTunnel.
  tunnelIdleTimer = setInterval(() => {
    if (publicTunnel === null) return
    if (!shouldStopIdleTunnel(lastTunnelRequestAt, tunnelStartedAt, Date.now())) return
    void stopPublicTunnel('tunnel stopped after two hours')
  }, 60_000)
```

Clear it in `stopPublicTunnel()`. A one-minute tick against a two-hour threshold, so the timer
costs nothing and the stop is never more than a minute late.

- [ ] **Step 3: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/main/remoteServer.ts src/main/index.ts
git commit -m "two hours with nobody on the other end and it closes itself"
```

---

## Task 17: Phase C checkpoint

- [ ] **Step 1: Final verification**

```bash
npm test
npm run typecheck
npm run lint
git diff --stat master -- electron-builder.yml build/afterPack.js .github/workflows/release.yml vitest.config.ts AI_DISCLOSURE.md native-engine
```

Expected: the suite green with 5 new test files; 0 typecheck errors; 0 lint errors + 4 prettier
warnings; and **the last command prints nothing at all**.

- [ ] **Step 2: Report**

Name: the seam's contract, the download-not-bundle decision and its flip condition, how the Host
guard admits the tunnel, what replaced the 4-character code, the payload decision, and the four
things from the spec's §12 that only Elling can settle.

---

## Not in this change, deliberately

- **The 700 ms poll stays a poll.** The research names a WebSocket with a sub-100-second heartbeat
  (the measured quick-tunnel idle death was 130 s) as the right shape and *"the one hidden cost
  worth flagging"* — and it is right, and it is a separate plan. It touches the 2282-line page, it
  is what makes any *metered* provider affordable, and quick tunnels are not metered by request.
  **Do not fold it in.**
- **No self-hosted FRP server, and no Workers + Durable Objects relay.** The seam exists for them.
- **No `plex.direct`-style TLS on the LAN path.**
- **No end-to-end encryption between phone and Mac.** `crypto.subtle` exists over the tunnel and
  not on the LAN, so it would be tunnel-only, and the desktop approval is what it would be buying.
- **No automatic LAN→tunnel fallback, ever.** A design rule, not a scope cut.
- **No auto-restart of a crashed tunnel.**
- **No Windows or Linux path.**
- **No bundling, and therefore no changes to `electron-builder.yml`, `build/afterPack.js` or
  `.github/workflows/release.yml`.** If Task 7 step 1 flips that, **STOP and report** — it is
  Elling's call, not this plan's.
- **No `vitest.config.ts` change.** Nothing here opens better-sqlite3.
- **No `AI_DISCLOSURE.md` change.**
- **Nothing under `native-engine/`.**

---

## Self-review

**Spec coverage.** §2 the seam → Task 6. §3 bundle-versus-download → Task 7 (with the flip test as
its first step). §4 process lifecycle → Task 8 (spawn, parse, health, teardown, pidfile, reaper)
and Task 9 (sleep, quit, remote-off, crash policy). §5 security → Tasks 1–4 (guard, grant, claim
route, approval) and Task 16 (idle). §6 the Host guard → Task 1. §7 payload discipline → Task 3
(server refusal) and Task 12 (page behaviour). §8 the copy → Tasks 10, 11, 4. §8.5 which path →
Task 15. §9 disclosure → Task 13. §11 testing → the stub-binary decision in Task 8, the
`vitest.config.ts` note in Task 7, the walkthrough in Task 14.

**Type consistency.** `RemoteVia` is defined once in `remoteAuth.ts` and used in `remoteState.ts`,
`phoneRemoteView.ts`, `remoteServer.ts` and `index.ts`. `PhoneRemoteStatus` exists in **three**
places (`src/main/index.ts`, `src/preload/index.ts`, `src/shared/phoneRemoteView.ts`) and Tasks 9,
10 and 15 each add fields to all three — that duplication is pre-existing and this plan does not
consolidate it, but **a field added to one and not the others is a typecheck error, so the
compiler catches it.** `PublicTunnel`/`TunnelProvider`/`TunnelOpenOptions` are defined once in
`publicTunnel.ts` and implemented once in `cloudflaredTunnel.ts`. `onPhoneSeen` in Task 15 is
**replaced** by `onRequestSeen` in Task 16 — that is stated in Task 16 step 1 rather than left as
two names for one thing.

**Known gap, stated rather than hidden.** Task 7 step 4 ships placeholder hashes that Task 7 step 1
produces; the test asserts the *shape* (64 lowercase hex, two different values) and cannot assert
the value. A worker who skips step 1 will ship a pin that fails at download time with a checksum
error naming the URL — legible, not silent, but wrong. **Do step 1.**

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-28-phone-tunnel-fallback.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast
   iteration. Phase boundaries (Tasks 5, 14, 17) are natural review points and Task 5 in particular
   should not be skipped: it is where "the security landed and nothing changed" gets confirmed
   before anything opens a public URL.
2. **Inline Execution** — execute in this session using `superpowers:executing-plans`, batching
   within a phase and checkpointing at each phase boundary.

Which approach?
