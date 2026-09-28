// src/main/remoteServer.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  REMOTE_PORT,
  codesMatch,
  isAllowedHost,
  newPairingCode,
  recordPairAttempt,
  type PairingGate
} from '@shared/remoteAuth'
import {
  parseRemoteSlotAction,
  parseRemoteSlotKinds,
  type RemoteCommand,
  type RemoteStateResponse
} from '@shared/remoteState'
import {
  allLocalIPv4Addresses,
  computerNameHost,
  lanAddressCandidates,
  resolveRemoteAddress,
  withComputerName,
  type LanAddressCandidate,
  type NetworkAddress
} from '@shared/lanAddress'
import { PHONE_STEM_CONTENT_TYPE } from './remoteStemRenderer'
import {
  REMOTE_NOTHING_HERE_NOTICE,
  REMOTE_PAGE_CSP,
  REMOTE_PAGE_HTML,
  REMOTE_WRONG_ADDRESS_NOTICE,
  acceptsHtml,
  remoteNoticePage
} from './remotePage'

/** node's `networkInterfaces()` as a flat list -- the interface name carried
 * on each row instead of being the key above it, which is the shape the
 * pure ranking in @shared/lanAddress takes. */
function flattenInterfaces(): NetworkAddress[] {
  const rows: NetworkAddress[] = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      rows.push({
        name,
        address: address.address,
        family: address.family,
        internal: address.internal
      })
    }
  }
  return rows
}

/** This machine's bonjour name -- 'nickelm2.local' -- or null.
 *
 * `scutil --get LocalHostName` is the one macOS keeps and the one it
 * advertises over mDNS; `os.hostname()` is not (it can be whatever DHCP
 * handed back). Read ONCE and remembered: it is a preference a person
 * changes in System Settings, not something that moves while the app is
 * open, and this is called from the Host guard on every single request.
 *
 * Every failure is the same answer -- no name, and the picker simply does
 * not offer that row. scutil is missing on non-macOS, and this app is
 * macOS-first. */
let computerNameCache: { host: string | null } | null = null

export function computerNameHostname(): string | null {
  if (computerNameCache === null) {
    let raw: string | null = null
    try {
      raw = execFileSync('scutil', ['--get', 'LocalHostName'], {
        encoding: 'utf8',
        timeout: 2000
      })
    } catch {
      raw = null
    }
    computerNameCache = { host: computerNameHost(raw) }
  }
  return computerNameCache.host
}

/** Every address the phone remote could be served on right now, best
 * first -- what the modal's picker offers. See lanAddressCandidates for
 * which addresses are offered, which are preferred, and why those are two
 * different questions, and withComputerName for why `nickelm2.local` is
 * last and never the default. */
export function remoteAddressCandidates(): LanAddressCandidate[] {
  return withComputerName(lanAddressCandidates(flattenInterfaces()), computerNameHostname())
}

/** The address the desktop will serve on and shows him to type in: his
 * remembered choice when it is still one of this machine's addresses,
 * otherwise the best default. Null when this machine has nothing usable, in
 * which case the feature cannot work and the UI says so rather than
 * starting a server nothing can reach.
 *
 * This used to return the first non-internal IPv4 it came across, which on
 * a machine running tailscale meant the tailnet address: his laptop reached
 * it (same tailnet) and his phone got "connection failed". The choosing is
 * a ranking now, and it lives in @shared/lanAddress with his exact
 * three-interface case as a test fixture -- node does not guarantee the
 * order `networkInterfaces()` enumerates in, so nothing here may depend on
 * it.
 *
 * The ranking cannot, however, know that his router isolates wireless
 * clients and that the correctly-chosen wifi address is one his phone can
 * never reach. That is what `remembered` is for. */
export function lanIPv4Address(remembered: string | null = null): string | null {
  return resolveRemoteAddress(remoteAddressCandidates(), remembered)
}

/** Every IPv4 this machine currently holds, plus its bonjour name -- the
 * Host guard's allow-list. The addresses are read per request rather than
 * captured at startup: he joins and leaves networks while the app is
 * running, and an address that appeared after the server started is just
 * as much ours as one that was there first.
 *
 * The name is on the list because the picker offers it, and a row that
 * answers the wrong-address notice when chosen would be worse than no row.
 * It adds no DNS-rebinding path -- see isAllowedHost, which also refuses
 * to match anything on this list that is not an IPv4 literal or a
 * single-label `.local`. */
function ownAddresses(): string[] {
  const name = computerNameHostname()
  const addresses = allLocalIPv4Addresses(flattenInterfaces())
  return name === null ? addresses : [...addresses, name]
}

export interface RemoteServerHandle {
  url: string
  /** The address this server was started on -- the one the url and the QR
   * name. Reported back so the picker can mark the row the address bar on
   * the phone is going to say, rather than the row the resolver would pick
   * if asked again a second later. */
  address: string
  pairingCode: string
  stop(): void
}

export interface RemoteServerOptions {
  /** The last state the renderer pushed, plus the current loopId. Answered
   * verbatim by GET /api/state -- the server holds no model of Discover at
   * all. */
  getState: () => RemoteStateResponse
  /** The current Discover loop as wav bytes, rendered on demand and cached
   * by the caller. Null when there is no loop to play. Rejects when the
   * render failed -- answered as 503 rather than crashing the server. */
  loopWav: () => Promise<{ id: string; bytes: Buffer } | null>
  /** One stem's audio bytes for a 16-hex stem id, or null when the Mac is
   * not holding that id. Rejects when the transcode failed -- answered as
   * 503 rather than crashing the server. */
  stemBytes: (stemId: string) => Promise<Buffer | null>
  onCommand: (command: RemoteCommand) => void
  /** Called on every failed pairing attempt, so the desktop can say "two
   * tries left" and, on the fifth, that pairing is over for this session. */
  onPairingChanged: (gate: PairingGate) => void
  /** The listen itself can fail asynchronously -- port 7373 already taken
   * is the realistic one. An unhandled 'error' event on a node:http server
   * takes the whole Electron main process down with it, so this is not
   * optional politeness: the caller forgets the handle and tells him it is
   * not running. */
  onServerError: (error: Error) => void
  lanAddress: string
  /** Tests only -- the machine's own addresses, so a test does not have to
   * have the network it is testing. The real thing reads them fresh from
   * `networkInterfaces()` on every request. */
  localAddressesOverride?: () => string[]
  /** Tests only. The real thing is always REMOTE_PORT -- fixed so the URL he
   * types once stays the URL forever -- and a test cannot bind 7373 without
   * fighting whatever copy of the app is already running on this machine. */
  portOverride?: number
}

/** The ONLY shape GET /api/stem will consider. Checked before anything is
 * looked up, so nothing path-shaped ever reaches a map lookup, let alone a
 * filesystem call -- and the id is a lookup key into a map main built from
 * the loop it is holding, never a fragment of a filename. */
const STEM_ID = /^[0-9a-f]{16}$/

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      // A controller sends a few dozen bytes. Anything larger is not this
      // app's phone page and is dropped rather than buffered.
      if (raw.length > 4096) raw = ''
    })
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
  })
}

/** Starts the phone remote.
 *
 * Off by default and per-session: nothing here auto-starts, nothing is
 * persisted, and the handle's stop() is called on quit and whenever he
 * turns it off.
 *
 * Bound to 0.0.0.0 -- it has to be, or the phone cannot reach it. The
 * residual risk, stated plainly: anyone on his LAN can load the pairing
 * screen while this is on. That is the price of the phone reaching it at
 * all, and it is why this is off by default.
 *
 * Nine api routes, plus GET / itself, and no route takes or returns a
 * filesystem path or reads the library. (The count in this comment was
 * already one behind before /api/stem: a596b39's /api/slot-action made
 * seven into eight, and /api/stem makes it nine.)
 *
 * GET /api/loop takes no parameters of any kind -- it serves the current
 * Discover loop's wav bytes and names it in an x-loop-id header, so there
 * is no id to validate and nothing to address but "now". GET /api/stem is
 * the only route that takes a parameter at all, and STEM_ID is why the
 * no-path property survives it: sixteen lowercase hex characters, tested
 * before anything is looked up, then used as a KEY INTO A MAP the main
 * process built from the loop it is holding. It is never joined to a path
 * and never opened, and it means nothing to anything that does not already
 * hold that map.
 *
 * A paired attacker can roll dice, save a rifff, add and remove slots, and
 * hear the loop -- whole or stem by stem -- that is already on screen. That
 * is the entire blast radius, by design rather than by accident.
 *
 * BEFORE PAIRING THE SERVER SERVES THE PAIRING SCREEN AND NOTHING ELSE:
 * every unauthenticated request other than GET / and POST /api/pair gets
 * 401 -- including a path that does not exist, so nothing reveals which
 * routes are real. What that 401 LOOKS like depends only on who is asking
 * (see `refuse`): an empty object for the page's own fetch calls, and the
 * same one-line notice page for every navigation. Same status, same
 * indistinguishability, one of them readable on a phone. */
export function startRemoteServer(options: RemoteServerOptions): RemoteServerHandle {
  const port = options.portOverride ?? REMOTE_PORT
  const expectedHost = `${options.lanAddress}:${port}`
  const localAddresses = options.localAddressesOverride ?? ownAddresses
  const pairingCode = newPairingCode(Math.random)
  let gate: PairingGate = { attemptsUsed: 0, lockedOut: false }
  const tokens = new Set<string>()

  function respond(res: ServerResponse, status: number, body: unknown = {}): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  /** A refusal, answered as whatever the caller can read.
   *
   * THE BUG THIS EXISTS FOR (2026-09-26): every refusal here used to be
   * `{}` with a json content type, for the page's own fetch calls and for a
   * phone that had navigated into it alike. A browser draws two characters
   * of json as a full white screen, which is exactly what he reported and
   * is indistinguishable from a page that failed to render. His phone's tab
   * still pointed at the address the Mac advertised before f1fcc9b; the
   * server binds 0.0.0.0, so that address still connected and the Host
   * guard still refused it -- "loaded, blank", forever, with nothing on
   * screen to say why.
   *
   * The status code does not change, the page's own fetch calls still get
   * json (they send the match-everything wildcard, and show(false) on a 401
   * is how a stale token finds its way back to the pairing form), and every
   * unrecognised path still answers identically to every other -- nothing
   * here reveals which routes are real. */
  function refuse(req: IncomingMessage, res: ServerResponse, status: number, notice: string): void {
    if (!acceptsHtml(req.headers.accept)) return respond(res, status)
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': REMOTE_PAGE_CSP,
      'cache-control': 'no-store'
    })
    res.end(remoteNoticePage(notice))
  }

  function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) return false
    return tokens.has(header.slice('Bearer '.length))
  }

  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      // ANY of this machine's own addresses on this port, not only the one
      // it advertised -- see isAllowedHost for why that is no weaker
      // against DNS rebinding, and remoteServer.test.ts for the blank page
      // it was causing. `expectedHost` remains what the URL and the QR say;
      // it is no longer what the guard is built from.
      if (!isAllowedHost(req.headers.host, localAddresses(), port)) {
        return refuse(req, res, 403, REMOTE_WRONG_ADDRESS_NOTICE)
      }
      const url = (req.url ?? '/').split('?')[0]

      if (req.method === 'GET' && url === '/') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': REMOTE_PAGE_CSP,
          'cache-control': 'no-store'
        })
        res.end(REMOTE_PAGE_HTML)
        return
      }

      if (req.method === 'POST' && url === '/api/pair') {
        if (gate.lockedOut) return respond(res, 403, { lockedOut: true })
        const body = await readJsonBody(req)
        const correct = codesMatch(String(body.code ?? ''), pairingCode)
        gate = recordPairAttempt(gate, correct)
        options.onPairingChanged(gate)
        if (!correct) return respond(res, 401, { lockedOut: gate.lockedOut })
        const token = randomBytes(32).toString('hex')
        tokens.add(token)
        respond(res, 200, { token })
        return
      }

      if (!authorized(req)) return refuse(req, res, 401, REMOTE_NOTHING_HERE_NOTICE)

      if (req.method === 'GET' && url === '/api/state') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(options.getState()))
        return
      }

      if (req.method === 'GET' && url === '/api/loop') {
        // TAKES NO PARAMETERS AT ALL -- not a path, not an id, not a query
        // string. It serves whatever loop is current and names it in a
        // header. There is nothing to validate, nothing to traverse, and no
        // way to address anything but "now". A route with no input cannot be
        // given a bad one, which is how this keeps the property the rest of
        // the surface has: no route takes or returns a filesystem path.
        //
        // No byte-range handling, deliberately: the phone uses fetch +
        // decodeAudioData, not a media element, so Safari never asks for one.
        let loop: { id: string; bytes: Buffer } | null
        try {
          loop = await options.loopWav()
        } catch (error) {
          console.error('remoteServer: loop render failed:', error)
          return respond(res, 503)
        }
        if (loop === null) {
          res.writeHead(204)
          res.end()
          return
        }
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(loop.bytes.length),
          'x-loop-id': loop.id,
          'cache-control': 'no-store'
        })
        res.end(loop.bytes)
        return
      }

      // The per-stem audio route, 2026-09-27. Unlike /api/loop it DOES take a
      // parameter, and the parameter is the whole security argument: sixteen
      // lowercase hex characters, tested by STEM_ID before anything else
      // happens, then used as a key into a Map the main process built from
      // the EngineProject it is holding. It is never joined to a path,
      // never opened, and means nothing to anything that does not already
      // hold that map -- so this route serves audio one stem at a time
      // without the surface gaining any way to name a file.
      //
      // A 404 rather than the surface's usual indistinguishable 401 is
      // deliberate and has precedent: /api/add-slot answers 400 for a
      // malformed body, because a PAIRED phone already knows the route
      // exists and there is nothing left to conceal from it.
      //
      // cache-control is the one departure from no-store on this surface.
      // The id is a content hash, so a stale hit is impossible by
      // construction, and it saves re-downloading megabytes over tailscale
      // on a reload. Change it to no-store if that trade stops being worth
      // it; nothing else depends on it.
      if (req.method === 'GET' && url === '/api/stem') {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams
        const stemId = query.get('id') ?? ''
        if (!STEM_ID.test(stemId)) return respond(res, 404)
        let bytes: Buffer | null
        try {
          bytes = await options.stemBytes(stemId)
        } catch (error) {
          console.error('remoteServer: stem transcode failed:', error)
          return respond(res, 503)
        }
        if (bytes === null) return respond(res, 404)
        res.writeHead(200, {
          'content-type': PHONE_STEM_CONTENT_TYPE,
          'content-length': String(bytes.length),
          'cache-control': 'private, max-age=3600'
        })
        res.end(bytes)
        return
      }

      if (req.method === 'POST' && url === '/api/roll') {
        const body = await readJsonBody(req)
        const slotId = typeof body.slotId === 'string' ? body.slotId : null
        options.onCommand(slotId === null ? { kind: 'roll-all' } : { kind: 'roll-slot', slotId })
        return respond(res, 200)
      }

      if (req.method === 'POST' && url === '/api/keep') {
        options.onCommand({ kind: 'keep' })
        return respond(res, 200)
      }

      // The phone's kind picker. Kinds arrive as their own literal strings
      // (the seven of DISCOVER_SLOT_KIND_OPTIONS) and parseRemoteSlotKinds
      // is the only thing that decides whether they are kinds at all -- an
      // unknown string fails the whole request rather than being dropped,
      // so this route still cannot be handed anything path-shaped. The 400
      // is for a malformed body, and is the one thing on this surface that
      // answers differently from a 401: a paired phone already knows the
      // route exists, so there is nothing left to conceal from it.
      if (req.method === 'POST' && url === '/api/add-slot') {
        const body = await readJsonBody(req)
        const kinds = parseRemoteSlotKinds(body.kinds)
        if (kinds === null) return respond(res, 400)
        options.onCommand({ kind: 'add-slot', kinds })
        return respond(res, 200)
      }

      // An id the Mac no longer has is a harmless no-op on the renderer's
      // side (removeSlot filters by id), so there is nothing to validate
      // here beyond "a non-empty string".
      if (req.method === 'POST' && url === '/api/remove-slot') {
        const body = await readJsonBody(req)
        const slotId = typeof body.slotId === 'string' ? body.slotId : ''
        if (slotId === '') return respond(res, 400)
        options.onCommand({ kind: 'remove-slot', slotId })
        return respond(res, 200)
      }

      // One route for all five of the phone's per-row actions, 2026-09-27
      // -- four of them are the buttons already on every desktop Discover
      // slot row (similar/adjacent/random/duplicate) and the fifth is its
      // mute. parseRemoteSlotAction is the only thing that decides whether
      // an action is an action: an unknown string fails the whole request
      // rather than being dropped, exactly as an unknown kind does on
      // /api/add-slot, so this route cannot be handed anything
      // path-shaped either. An id the Mac no longer has is a harmless
      // no-op on the renderer's side, so the id is only checked for being
      // a non-empty string, same as /api/remove-slot.
      if (req.method === 'POST' && url === '/api/slot-action') {
        const body = await readJsonBody(req)
        const slotId = typeof body.slotId === 'string' ? body.slotId : ''
        const action = parseRemoteSlotAction(body.action)
        if (slotId === '' || action === null) return respond(res, 400)
        options.onCommand({ kind: 'slot-action', slotId, action })
        return respond(res, 200)
      }

      // Anything else, authenticated or not, answers exactly like an
      // unauthenticated request -- no 404 that reveals a route exists.
      refuse(req, res, 401, REMOTE_NOTHING_HERE_NOTICE)
    })()
  })

  server.on('error', (error: Error) => {
    console.error('remoteServer: listen failed:', error)
    options.onServerError(error)
  })

  server.listen(port, '0.0.0.0')

  return {
    url: `http://${expectedHost}`,
    address: options.lanAddress,
    pairingCode,
    stop: (): void => {
      tokens.clear()
      server.close()
    }
  }
}
