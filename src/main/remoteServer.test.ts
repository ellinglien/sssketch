import { createServer, request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  REMOTE_NOTHING_HERE_NOTICE,
  REMOTE_PAGE_HTML,
  REMOTE_WRONG_ADDRESS_NOTICE
} from './remotePage'
import { startRemoteServer, type RemoteServerHandle } from './remoteServer'

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
 * machine, so a test may never take it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

let handle: RemoteServerHandle | null = null

async function start(): Promise<{ port: number; pairingCode: string }> {
  const port = await freePort()
  handle = startRemoteServer({
    portOverride: port,
    lanAddress: '127.0.0.1',
    getState: () => ({
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
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
  return { port, pairingCode: handle.pairingCode }
}

afterEach(() => {
  handle?.stop()
  handle = null
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
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
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
    const res = await send(port, '/', { accept: NAVIGATION, host: '192.168.3.1:7373' })
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
    const res = await send(port, '/api/state', { accept: '*/*', host: '192.168.3.1:7373' })
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
