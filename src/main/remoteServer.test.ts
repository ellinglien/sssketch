import { createServer, request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  REMOTE_NOTHING_HERE_NOTICE,
  REMOTE_PAGE_HTML,
  REMOTE_WRONG_ADDRESS_NOTICE
} from './remotePage'
import { startRemoteServer, type RemoteServerHandle } from './remoteServer'
import type { RemoteCommand } from '@shared/remoteState'

/** Every command the server forwarded, in order, for the whole of one
 * test. Cleared in afterEach. */
const commands: RemoteCommand[] = []

/** Why this file exists (2026-09-26).
 *
 * Reported: the phone remote is a WHITE SCREEN on his iPhone after
 * 817ef53. It was not the page -- the page renders with no errors in
 * Chromium, in WKWebView and in Safari on an iOS 26 simulator, in every
 * state (fresh, stale token, paired with no slots, paired with slots,
 * discover closed, qr link). It was this server: every refusal answered
 * `{}` with a json content type, and a browser draws that as a blank white
 * page with two characters in the corner. His phone's tab still pointed at
 * the address the Mac advertised before f1fcc9b (the bridge address, which
 * the new ranking excludes); the server binds 0.0.0.0, so that address
 * still connected, and the Host guard refused it into a void.
 *
 * These tests run the REAL server on a real socket. Nothing about the bug
 * survives being mocked -- it was entirely in what went out over the wire.
 */

/** A port nothing else is on. REMOTE_PORT is fixed in the product and is
 * very likely already held by a copy of the app on the developer's own
 * machine, so a test may never take it.
 *
 * Why this is not `listen(0)` (2026-09-26): it was, and this file was the
 * flakiest thing in the suite -- a whole run of `13 failed | 2851 passed`
 * traced back here. An ephemeral probe closes the port BEFORE the real
 * server binds it, and every vitest worker draws from the same OS range,
 * so two workers routinely got handed the same number in that window. The
 * loser's listen fails with EADDRINUSE, `onServerError` fires instead of
 * `listening`, and every request in the file then gets ECONNREFUSED -- one
 * race surfacing as a dozen unrelated-looking assertion failures.
 *
 * So worker N only ever takes ports from its own 200-wide block. Two
 * workers cannot collide by construction, which leaves only an unrelated
 * process already holding one -- and since nothing else draws from this
 * block, probing for that is safe: no one can take the port between the
 * probe closing and the server binding. */
const WORKER_PORT_BASE = 20000 + (Number(process.env.VITEST_WORKER_ID ?? '1') % 40) * 200
let nextPortOffset = 0

function probeBindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.on('error', () => resolve(false))
    // 0.0.0.0, matching the real server. A port free on 127.0.0.1 can still
    // be held on 0.0.0.0 by something else, so probing loopback proved the
    // wrong thing.
    probe.listen(port, '0.0.0.0', () => {
      probe.close(() => resolve(true))
    })
  })
}

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const port = WORKER_PORT_BASE + (nextPortOffset % 200)
    nextPortOffset += 1
    if (await probeBindable(port)) return port
  }
  throw new Error(`no free port in ${WORKER_PORT_BASE}..${WORKER_PORT_BASE + 199}`)
}

let handle: RemoteServerHandle | null = null

/** The addresses the test machine "has", so the Host guard is testing a
 * fixed network rather than whatever the developer's laptop is plugged
 * into. Loopback is always allowed and is deliberately NOT in here. */
const OUR_ADDRESSES = ['192.168.1.40', '100.66.121.12']

async function start(): Promise<{ port: number; pairingCode: string }> {
  const port = await freePort()
  handle = startRemoteServer({
    portOverride: port,
    lanAddress: '192.168.1.40',
    localAddressesOverride: () => OUR_ADDRESSES,
    getState: () => ({
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
      loopBars: 0,
      slots: [],
      loopId: null
    }),
    loopWav: () => Promise.resolve(null),
    onCommand: (command) => {
      commands.push(command)
    },
    onPairingChanged: () => {},
    onServerError: (error) => {
      throw error
    }
  })
  return { port, pairingCode: handle.pairingCode }
}

afterEach(() => {
  handle?.stop()
  handle = null
  commands.length = 0
})

/** What Safari sends when a person navigates to a url, near enough. */
const NAVIGATION = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

interface RawResponse {
  status: number
  contentType: string
  body: string
}

/** A request over node:http rather than fetch, because the Host header is
 * the whole point of half of these tests and fetch() refuses to set it --
 * Host is a forbidden header name and undici drops it without saying so. */
function send(
  port: number,
  path: string,
  headers: Record<string, string>,
  method = 'GET',
  body?: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    // agent: false -- a fresh socket per request. The default global agent
    // keeps sockets alive, and a pooled socket to a server that has since
    // been closed (the switching-address test below closes one) comes back
    // as ECONNRESET instead of as whatever the new server answered.
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        text += chunk
      })
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers['content-type'] ?? ''),
          body: text
        })
      )
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('the remote server serving its page', () => {
  it('serves the remote to a phone at the address it is serving', async () => {
    const { port } = await start()
    const res = await send(port, '/', { accept: NAVIGATION })
    expect(res.status).toBe(200)
    expect(res.body).toBe(REMOTE_PAGE_HTML)
  })
})

describe('a refusal a phone navigated into', () => {
  it('is a readable page, not a white screen, when the address is wrong', async () => {
    const { port } = await start()
    // The exact shape of his bug: a tab still pointing at an address the
    // Mac used to advertise. It connects -- the listen is 0.0.0.0 -- and
    // the Host guard refuses it.
    const res = await send(port, '/', { accept: NAVIGATION, host: `192.168.9.9:${port}` })
    expect(res.status).toBe(403)
    expect(res.contentType).toContain('text/html')
    expect(res.body).toContain(REMOTE_WRONG_ADDRESS_NOTICE)
    expect(res.body).not.toBe('{}')
  })

  it('is a readable page for a path that is not the remote', async () => {
    const { port } = await start()
    const res = await send(port, '/api/state', { accept: NAVIGATION })
    expect(res.status).toBe(401)
    expect(res.contentType).toContain('text/html')
    expect(res.body).toContain(REMOTE_NOTHING_HERE_NOTICE)
  })

  it('still tells a navigation nothing about which routes are real', async () => {
    const { port } = await start()
    const paths = ['/api/state', '/api/loop', '/api/roll', '/nonsense', '/index.html']
    const answers: string[] = []
    for (const path of paths) {
      const res = await send(port, path, { accept: NAVIGATION })
      answers.push(`${res.status} ${res.body}`)
    }
    expect(new Set(answers).size).toBe(1)
  })
})

/** THE SECOND HALF OF HIS 2026-09-26 REPORT. The guard used to be built
 * from the ONE address the desktop advertised, so reaching the server by
 * any other address of the same machine answered 403 -- a blank page, then
 * a readable refusal, but a refusal either way. Over Tailscale that is the
 * only way in, so the feature could not work on his network at all.
 *
 * Widened to every current address of this machine. The rebinding property
 * it exists for is unchanged, and the reasoning is in isAllowedHost's own
 * comment: the allow-list is IP literals, rebinding needs a name. */
describe('the host guard after the widening', () => {
  it('accepts the tailnet address as well as the advertised wifi one', async () => {
    const { port } = await start()
    for (const address of OUR_ADDRESSES) {
      const res = await send(port, '/', { accept: NAVIGATION, host: `${address}:${port}` })
      expect(res.status).toBe(200)
      expect(res.body).toBe(REMOTE_PAGE_HTML)
    }
  })

  it('still refuses a name, which is the whole of dns rebinding', async () => {
    const { port } = await start()
    for (const name of ['evil.example.com', `evil.example.com:${port}`, `sssketch.local:${port}`]) {
      const res = await send(port, '/', { accept: NAVIGATION, host: name })
      expect(res.status).toBe(403)
    }
  })

  it('still refuses an address that is not ours', async () => {
    const { port } = await start()
    const res = await send(port, '/', { accept: NAVIGATION, host: `192.168.9.9:${port}` })
    expect(res.status).toBe(403)
  })
})

describe('switching address', () => {
  it('rebinds the same port and reports the new address, url and code', async () => {
    // What set-phone-remote-address does in main: stop the http server and
    // start another on the same fixed port, keeping the render engine. If
    // the port could not be retaken immediately this would be a 45-second
    // feature instead of an instant one, so it is worth a real socket.
    const { port, pairingCode } = await start()
    const first = handle
    expect(first?.address).toBe('192.168.1.40')
    expect(first?.url).toBe(`http://192.168.1.40:${port}`)

    const paired = await send(
      port,
      '/api/pair',
      { 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ code: pairingCode })
    )
    const { token: staleToken } = JSON.parse(paired.body) as { token: string }

    first?.stop()
    handle = startRemoteServer({
      portOverride: port,
      lanAddress: '100.66.121.12',
      localAddressesOverride: () => OUR_ADDRESSES,
      getState: () => ({
        discoverOpen: true,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null,
        loopBars: 0,
        slots: [],
        loopId: null
      }),
      loopWav: () => Promise.resolve(null),
      onCommand: () => {},
      onPairingChanged: () => {},
      onServerError: (error) => {
        throw error
      }
    })

    expect(handle.address).toBe('100.66.121.12')
    expect(handle.url).toBe(`http://100.66.121.12:${port}`)

    // A new server is a new pairing code and an empty token set: a token
    // issued by the old one is worth nothing here. This is why the modal
    // redraws its qr from the status it gets back rather than keeping the
    // one it was already showing.
    const stale = await send(port, '/api/state', { authorization: `Bearer ${staleToken}` }, 'GET')
    expect(stale.status).toBe(401)

    const res = await send(port, '/', { accept: NAVIGATION, host: `100.66.121.12:${port}` })
    expect(res.status).toBe(200)
    expect(res.body).toBe(REMOTE_PAGE_HTML)
  })
})

describe("a refusal of the page's own fetch", () => {
  it('is still the empty object the page knows how to read', async () => {
    const { port } = await start()
    // fetch() with no Accept of its own. The page reads a 401 here and
    // calls show(false), which is the whole of how a stale token finds its
    // way back to the pairing form -- an html body would break that.
    const res = await send(port, '/api/state', {
      accept: '*/*',
      authorization: 'Bearer not-a-real-token'
    })
    expect(res.status).toBe(401)
    expect(res.contentType).toContain('application/json')
    expect(res.body).toBe('{}')
  })

  it('is still the empty object when the host is wrong', async () => {
    const { port } = await start()
    const res = await send(port, '/api/state', { accept: '*/*', host: `192.168.9.9:${port}` })
    expect(res.status).toBe(403)
    expect(res.contentType).toContain('application/json')
    expect(res.body).toBe('{}')
  })
})

describe('pairing over the wire', () => {
  it('hands out a token for the right code and nothing for a wrong one', async () => {
    const { port, pairingCode } = await start()
    const json = { 'content-type': 'application/json' }

    const wrong = await send(port, '/api/pair', json, 'POST', JSON.stringify({ code: 'ZZZZ' }))
    expect(wrong.status).toBe(401)

    const right = await send(port, '/api/pair', json, 'POST', JSON.stringify({ code: pairingCode }))
    expect(right.status).toBe(200)
    const { token } = JSON.parse(right.body) as { token: string }

    const state = await send(port, '/api/state', { authorization: `Bearer ${token}` })
    expect(state.status).toBe(200)
  })
})

/** The eighth route, 2026-09-27. One route with an enumerated action, not
 * five near-identical routes -- and parseRemoteSlotAction is the only thing
 * that decides whether an action is an action at all. */
describe('the slot action route', () => {
  async function pairedToken(port: number, pairingCode: string): Promise<string> {
    const res = await send(
      port,
      '/api/pair',
      { host: `192.168.1.40:${port}`, 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ code: pairingCode })
    )
    return JSON.parse(res.body).token as string
  }

  it('forwards each of the five actions verbatim', async () => {
    const { port, pairingCode } = await start()
    const token = await pairedToken(port, pairingCode)
    for (const action of ['mute', 'similar', 'adjacent', 'random', 'duplicate']) {
      const res = await send(
        port,
        '/api/slot-action',
        {
          host: `192.168.1.40:${port}`,
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        'POST',
        JSON.stringify({ slotId: 'slot-7', action })
      )
      expect(res.status).toBe(200)
    }
    expect(commands).toEqual([
      { kind: 'slot-action', slotId: 'slot-7', action: 'mute' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'similar' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'adjacent' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'random' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'duplicate' }
    ])
  })

  it('refuses an action it does not know, and forwards nothing', async () => {
    const { port, pairingCode } = await start()
    const token = await pairedToken(port, pairingCode)
    const res = await send(
      port,
      '/api/slot-action',
      {
        host: `192.168.1.40:${port}`,
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      'POST',
      JSON.stringify({ slotId: 'slot-7', action: 'delete-everything' })
    )
    expect(res.status).toBe(400)
    expect(commands).toEqual([])
  })

  it('refuses an empty slot id', async () => {
    const { port, pairingCode } = await start()
    const token = await pairedToken(port, pairingCode)
    const res = await send(
      port,
      '/api/slot-action',
      {
        host: `192.168.1.40:${port}`,
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      'POST',
      JSON.stringify({ slotId: '', action: 'mute' })
    )
    expect(res.status).toBe(400)
    expect(commands).toEqual([])
  })

  it('tells an unpaired caller nothing about the route existing', async () => {
    const { port } = await start()
    const res = await send(
      port,
      '/api/slot-action',
      { host: `192.168.1.40:${port}`, 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ slotId: 'slot-7', action: 'mute' })
    )
    expect(res.status).toBe(401)
    expect(commands).toEqual([])
  })
})
