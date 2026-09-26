// src/main/remoteServer.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  REMOTE_PORT,
  codesMatch,
  isAllowedHost,
  newPairingCode,
  recordPairAttempt,
  type PairingGate
} from '@shared/remoteAuth'
import {
  parseRemoteSlotKinds,
  type RemoteCommand,
  type RemoteStateResponse
} from '@shared/remoteState'
import { chooseLanAddress, type NetworkAddress } from '@shared/lanAddress'
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

/** The address on this machine a phone on the same wifi can actually reach
 * -- what the desktop shows him to type in. Null when there is no LAN at
 * all, in which case the feature cannot work and the UI says so rather than
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
 * If the top-ranked address is ever the wrong one on some machine,
 * `rankLanAddresses` already returns every survivor best-first -- offering
 * him the runners-up is then a change to the menu, not to this logic. */
export function lanIPv4Address(): string | null {
  return chooseLanAddress(flattenInterfaces())
}

export interface RemoteServerHandle {
  url: string
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
  /** Tests only. The real thing is always REMOTE_PORT -- fixed so the URL he
   * types once stays the URL forever -- and a test cannot bind 7373 without
   * fighting whatever copy of the app is already running on this machine. */
  portOverride?: number
}

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
 * Seven routes, and no route takes or returns a filesystem path or reads
 * the library. GET /api/loop takes no parameters of any kind -- it serves
 * the current Discover loop's wav bytes and names it in an x-loop-id
 * header, so there is no id to validate and nothing to address but "now".
 * A paired attacker can roll dice, save a rifff, add and remove slots, and
 * hear the loop that is already on screen. That is the entire blast radius,
 * by design rather than by accident.
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
      if (!isAllowedHost(req.headers.host, expectedHost)) {
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
    pairingCode,
    stop: (): void => {
      tokens.clear()
      server.close()
    }
  }
}
