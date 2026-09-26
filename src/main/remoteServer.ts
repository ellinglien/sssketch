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
import type { RemoteCommand, RemoteStateResponse } from '@shared/remoteState'
import { REMOTE_PAGE_CSP, REMOTE_PAGE_HTML } from './remotePage'

/** The first non-internal IPv4 address on this machine -- what the desktop
 * shows him to type into the phone. Null when there is no LAN at all, in
 * which case the feature cannot work and the UI says so rather than
 * starting a server nothing can reach. */
export function lanIPv4Address(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
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
 * Five routes, and no route takes or returns a filesystem path or reads
 * the library. GET /api/loop takes no parameters of any kind -- it serves
 * the current Discover loop's wav bytes and names it in an x-loop-id
 * header, so there is no id to validate and nothing to address but "now".
 * A paired attacker can roll dice, save a rifff, and hear the loop that is
 * already on screen. That is the entire blast radius, by design rather
 * than by accident.
 *
 * BEFORE PAIRING THE SERVER SERVES THE PAIRING SCREEN AND NOTHING ELSE:
 * every unauthenticated request other than GET / and POST /api/pair gets
 * 401 with an empty object -- including a path that does not exist, so
 * nothing reveals which routes are real. */
export function startRemoteServer(options: RemoteServerOptions): RemoteServerHandle {
  const expectedHost = `${options.lanAddress}:${REMOTE_PORT}`
  const pairingCode = newPairingCode(Math.random)
  let gate: PairingGate = { attemptsUsed: 0, lockedOut: false }
  const tokens = new Set<string>()

  function respond(res: ServerResponse, status: number, body: unknown = {}): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) return false
    return tokens.has(header.slice('Bearer '.length))
  }

  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      if (!isAllowedHost(req.headers.host, expectedHost)) return respond(res, 403)
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

      if (!authorized(req)) return respond(res, 401)

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

      // Anything else, authenticated or not, answers exactly like an
      // unauthenticated request -- no 404 that reveals a route exists.
      respond(res, 401)
    })()
  })

  server.on('error', (error: Error) => {
    console.error('remoteServer: listen failed:', error)
    options.onServerError(error)
  })

  server.listen(REMOTE_PORT, '0.0.0.0')

  return {
    url: `http://${expectedHost}`,
    pairingCode,
    stop: (): void => {
      tokens.clear()
      server.close()
    }
  }
}
