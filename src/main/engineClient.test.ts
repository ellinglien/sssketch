import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { EngineClient, encodeMessage, MAGIC_NUMBER } from './engineClient'

let server: Server | undefined

/**
 * Polls `condition` at a short interval until it returns true, or rejects
 * after `timeoutMs`. Used in place of a fixed sleep-then-assert wherever a
 * test needs to wait for something to arrive over the real local socket
 * below: a fixed delay either wastes time when the machine is idle, or is
 * too short under a full parallel suite's CPU contention (the actual cause
 * of a real intermittent failure here — the assertion running before the
 * awaited message had actually arrived).
 *
 * The 10000ms default matches the same helper in liveReschedule.test.ts and
 * playbackEngineLifecycle.test.ts. It was 2000 here, the odd one out and the
 * tightest poll ceiling in the repo: the only caller waits on three
 * local-socket pushes nominally 60ms apart, so 2000ms looks like a huge
 * margin right up until the whole parallel suite is contending for three
 * cores on a CI runner. Because this is a poll, a bigger ceiling costs a
 * passing run nothing at all — it only changes how patient a failing one is.
 */
function waitFor(condition: () => boolean, timeoutMs = 10000, intervalMs = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = (): void => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - start >= timeoutMs) {
        reject(new Error(`waitFor: condition not met within ${timeoutMs}ms`))
        return
      }
      setTimeout(check, intervalMs)
    }
    check()
  })
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

function startEchoServer(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket: Socket) => {
      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 8) {
          const magic = buf.readUInt32LE(0)
          const len = buf.readUInt32LE(4)
          if (magic !== MAGIC_NUMBER) return // malformed — real server would drop the connection
          if (buf.length < 8 + len) break
          const payload = buf.subarray(8, 8 + len).toString('utf8')
          buf = buf.subarray(8 + len)
          const parsed = JSON.parse(payload)
          // Echo server: for a "load-project" message, reply with a fixed
          // render-export-result so EngineClient's request/response matching
          // can be tested without a real engine process.
          if (parsed.type === 'render-export') {
            socket.write(
              encodeMessage(
                JSON.stringify({ type: 'render-export-result', payload: { success: true } })
              )
            )
          }
        }
      })
    })
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('unexpected address')
      resolve(address.port)
    })
  })
}

// The shared startEchoServer() helper above only replies to "render-export" with a
// single message, which isn't enough to exercise a repeated push subscription. This
// helper is separate and local to the push-subscription tests below: on receiving a
// "subscribe-me" message, it sends three position-update pushes with a short delay
// between each, so tests can assert ordering; on "push-again" it sends a fourth.
//
// The fourth push is on demand, NOT on a timer. It used to go out 150ms after
// subscribe-me, on the theory that the test would unsubscribe in the 60-150ms gap.
// Under a full parallel suite the event loop can stall longer than that gap, the
// third and fourth pushes then arrive together, and both reach the listener before
// waitFor's next 5ms poll -- received was [0.1, 0.2, 0.3, 0.4]. Sending it only once
// the test has unsubscribed makes the order fixed rather than a race.
function startPushServer(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket: Socket) => {
      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 8) {
          const magic = buf.readUInt32LE(0)
          const len = buf.readUInt32LE(4)
          if (magic !== MAGIC_NUMBER) return
          if (buf.length < 8 + len) break
          const payload = buf.subarray(8, 8 + len).toString('utf8')
          buf = buf.subarray(8 + len)
          const parsed = JSON.parse(payload)
          const push = (pos: number): void => {
            socket.write(
              encodeMessage(JSON.stringify({ type: 'position-update', payload: { pos } }))
            )
          }
          if (parsed.type === 'subscribe-me') {
            // Three pushes close together, each its own write.
            for (const [pos, delayMs] of [
              [0.1, 20],
              [0.2, 40],
              [0.3, 60]
            ]) {
              setTimeout(() => push(pos), delayMs)
            }
          } else if (parsed.type === 'push-again') {
            push(0.4)
          }
        }
      })
    })
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('unexpected address')
      resolve(address.port)
    })
  })
}

// Replies to "ping" with a "pong" carrying the request's own payload, but
// only when that payload asks for a reply -- a request with reply:false is
// left unanswered so its waiter times out.
function startPingServer(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket: Socket) => {
      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 8) {
          const len = buf.readUInt32LE(4)
          if (buf.length < 8 + len) break
          const parsed = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'))
          buf = buf.subarray(8 + len)
          if (parsed.type === 'ping' && parsed.payload?.reply) {
            socket.write(encodeMessage(JSON.stringify({ type: 'pong', payload: parsed.payload })))
          }
        }
      })
    })
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('unexpected address')
      resolve(address.port)
    })
  })
}

describe('encodeMessage', () => {
  it('writes an 8-byte header (magic + length, both little-endian) followed by the UTF-8 payload', () => {
    const encoded = encodeMessage('{"type":"quit"}')
    expect(encoded.readUInt32LE(0)).toBe(MAGIC_NUMBER)
    expect(encoded.readUInt32LE(4)).toBe(Buffer.byteLength('{"type":"quit"}', 'utf8'))
    expect(encoded.subarray(8).toString('utf8')).toBe('{"type":"quit"}')
  })
})

describe('EngineClient', () => {
  it('connects, sends a message, and receives a correctly-framed response', async () => {
    const port = await startEchoServer()
    const client = new EngineClient()
    await client.connect(port)
    const response = await client.sendAndAwaitType(
      'render-export',
      { outputPath: '/tmp/x.wav', durationBars: 1 },
      'render-export-result'
    )
    expect(response).toEqual({ success: true })
    client.disconnect()
  })

  it('rejects with a clear error if connection fails (nothing listening on the port)', async () => {
    const client = new EngineClient()
    await expect(client.connect(1)).rejects.toThrow() // port 1 requires root, always refused
  })

  it('reassembles a message whose header and payload arrive in separate TCP chunks', async () => {
    // The highest-risk part of onData's loop: it must not assume a single
    // 'data' event contains a whole frame. Here the server deliberately
    // splits one encoded message into two writes — header + partial payload
    // first, the rest of the payload a tick later — to prove the client
    // buffers and waits rather than mis-parsing a truncated frame.
    const encoded = encodeMessage(
      JSON.stringify({ type: 'render-export-result', payload: { success: true, split: true } })
    )
    const splitPoint = 10 // inside the header+payload, an arbitrary mid-message cut
    server = createServer((socket: Socket) => {
      socket.on('data', () => {
        socket.write(encoded.subarray(0, splitPoint))
        setTimeout(() => socket.write(encoded.subarray(splitPoint)), 10)
      })
    })
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected address')
        resolve(address.port)
      })
    })

    const client = new EngineClient()
    await client.connect(port)
    const response = await client.sendAndAwaitType('anything', {}, 'render-export-result')
    expect(response).toEqual({ success: true, split: true })
    client.disconnect()
  })

  it('parses two complete messages delivered together in a single TCP chunk', async () => {
    // The other direction of the same risk: onData's loop must keep draining
    // recvBuf after one full frame is parsed, in case a second frame is
    // already sitting right behind it in the same chunk (e.g. the OS
    // coalesced two fast writes) — not just handle the first and wait for
    // a fresh 'data' event for the second.
    const first = encodeMessage(JSON.stringify({ type: 'result-a', payload: { n: 1 } }))
    const second = encodeMessage(JSON.stringify({ type: 'result-b', payload: { n: 2 } }))
    server = createServer((socket: Socket) => {
      socket.on('data', () => {
        socket.write(Buffer.concat([first, second]))
      })
    })
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected address')
        resolve(address.port)
      })
    })

    const client = new EngineClient()
    await client.connect(port)
    const [a, b] = await Promise.all([
      client.sendAndAwaitType('trigger', {}, 'result-a'),
      client.sendAndAwaitType('unused', {}, 'result-b')
    ])
    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 2 })
    client.disconnect()
  })

  it('correlates concurrent same-type replies with a payload matcher', async () => {
    server = createServer((socket: Socket) => {
      socket.once('data', () => {
        socket.write(
          Buffer.concat([
            encodeMessage(
              JSON.stringify({ type: 'project-load-result', payload: { token: 2, success: true } })
            ),
            encodeMessage(
              JSON.stringify({ type: 'project-load-result', payload: { token: 1, success: true } })
            )
          ])
        )
      })
    })
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected address')
        resolve(address.port)
      })
    })
    const client = new EngineClient()
    await client.connect(port)
    const [one, two] = await Promise.all([
      client.sendAndAwaitType('load-project', {}, 'project-load-result', 1000, (payload) =>
        Boolean(payload && (payload as { token?: number }).token === 1)
      ),
      client.sendAndAwaitType('load-project', {}, 'project-load-result', 1000, (payload) =>
        Boolean(payload && (payload as { token?: number }).token === 2)
      )
    ])
    expect(one).toMatchObject({ token: 1 })
    expect(two).toMatchObject({ token: 2 })
    client.disconnect()
  })

  it('rejects an outstanding acknowledgement immediately on disconnect', async () => {
    server = createServer(() => undefined)
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected address')
        resolve(address.port)
      })
    })
    const client = new EngineClient()
    await client.connect(port)
    const pending = client.sendAndAwaitType('load-project', {}, 'project-load-result', 30000)
    client.disconnect()
    await expect(pending).rejects.toThrow('disconnected')
  })

  it('removes a timed-out waiter so it cannot steal a later reply of the same type', async () => {
    let requestCount = 0
    server = createServer((socket: Socket) => {
      socket.on('data', () => {
        requestCount += 1
        if (requestCount === 2) {
          socket.write(
            encodeMessage(
              JSON.stringify({ type: 'project-load-result', payload: { success: true } })
            )
          )
        }
      })
    })
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected address')
        resolve(address.port)
      })
    })
    const client = new EngineClient()
    await client.connect(port)
    await expect(
      client.sendAndAwaitType('load-project', {}, 'project-load-result', 10)
    ).rejects.toThrow('timed out')
    await expect(
      client.sendAndAwaitType('load-project', {}, 'project-load-result', 1000)
    ).resolves.toEqual({ success: true })
    client.disconnect()
  })

  it('does not crash when the engine sends a literal `null` (or otherwise malformed-shape) JSON payload', async () => {
    // JSON.parse('null') succeeds with no exception, so a naive `as IncomingMessage`
    // cast would let `null` through and the next line's `msg.type` access would
    // throw synchronously inside the 'data' handler — an uncaught exception with
    // no listener attached, capable of crashing the whole Electron main process.
    // Prove the client survives this and still services a subsequent well-formed
    // message on the same connection.
    server = createServer((socket: Socket) => {
      socket.on('data', () => {
        socket.write(encodeMessage('null'))
        socket.write(
          encodeMessage(
            JSON.stringify({ type: 'render-export-result', payload: { success: true } })
          )
        )
      })
    })
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected address')
        resolve(address.port)
      })
    })

    const client = new EngineClient()
    await client.connect(port)
    const response = await client.sendAndAwaitType('anything', {}, 'render-export-result')
    expect(response).toEqual({ success: true })
    client.disconnect()
  })

  it('delivers pushed messages to a subscribed listener, repeatedly, without consuming a one-shot waiter', async () => {
    const port = await startPushServer()
    const client = new EngineClient()
    await client.connect(port)

    const received: unknown[] = []
    const unsubscribe = client.on('position-update', (payload) => received.push(payload))

    client.send('subscribe-me')

    // The server sends pushes at 20/40/60ms. Poll for all three to actually land
    // rather than sleeping a fixed duration — under a full parallel suite, real
    // socket I/O can lag well past any fixed guess at "surely long enough".
    await waitFor(() => received.length >= 3)
    unsubscribe()
    expect(received).toEqual([{ pos: 0.1 }, { pos: 0.2 }, { pos: 0.3 }])

    // Only now ask for a fourth push (see startPushServer for why it is on demand).
    // A second listener, still subscribed, says when it has been delivered, so the
    // absence check below waits on the push itself rather than a fixed sleep.
    const after: unknown[] = []
    const unsubscribeAfter = client.on('position-update', (payload) => after.push(payload))
    client.send('push-again')
    await waitFor(() => after.length >= 1)
    expect(after).toEqual([{ pos: 0.4 }])
    expect(received.length).toBe(3)
    unsubscribeAfter()

    client.disconnect()
  })

  it("does not let a persistent subscription interfere with sendAndAwaitType's one-shot matching", async () => {
    const port = await startEchoServer()
    const client = new EngineClient()
    await client.connect(port)

    const received: unknown[] = []
    const unsubscribe = client.on('position-update', (payload) => received.push(payload))

    const response = await client.sendAndAwaitType(
      'render-export',
      { outputPath: '/tmp/x.wav', durationBars: 1 },
      'render-export-result'
    )

    expect(response).toEqual({ success: true })
    // The echo server never sends position-update, so the subscription should have
    // received nothing — it must not have swallowed or redirected the response.
    expect(received).toEqual([])

    unsubscribe()
    client.disconnect()
  })

  it('fires both a pending one-shot waiter and a persistent subscriber for the same message type', async () => {
    // A message type could theoretically have both a pending sendAndAwaitType
    // waiter AND a persistent client.on() subscriber at once; both must fire
    // independently rather than the subscriber dispatch being an `else` branch
    // of the waiter check (or vice versa).
    const port = await startEchoServer()
    const client = new EngineClient()
    await client.connect(port)

    const received: unknown[] = []
    const unsubscribe = client.on('render-export-result', (payload) => received.push(payload))

    const response = await client.sendAndAwaitType(
      'render-export',
      { outputPath: '/tmp/x.wav', durationBars: 1 },
      'render-export-result'
    )

    expect(response).toEqual({ success: true })
    expect(received).toEqual([{ success: true }])

    unsubscribe()
    client.disconnect()
  })
  it('drops a timed-out waiter, so a later request of the same type gets its own reply', async () => {
    // The waiter list stores a wrapper around the promise's resolve, so the
    // timeout's old `w.resolve !== resolve` filter never matched and the dead
    // waiter stayed first in line, swallowing the next reply of its type.
    const port = await startPingServer()
    const client = new EngineClient()
    await client.connect(port)

    await expect(client.sendAndAwaitType('ping', { reply: false }, 'pong', 30)).rejects.toThrow(
      /timed out/
    )
    await expect(
      client.sendAndAwaitType('ping', { reply: true, n: 2 }, 'pong', 2000)
    ).resolves.toEqual({
      reply: true,
      n: 2
    })

    client.disconnect()
  })
})
