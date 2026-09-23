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
 */
function waitFor(condition: () => boolean, timeoutMs = 2000, intervalMs = 5): Promise<void> {
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
// "subscribe-me" message, it sends four position-update pushes with a short delay
// between each, so tests can assert ordering and that unsubscribing stops delivery.
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
          if (parsed.type === 'subscribe-me') {
            // Three pushes close together, then a fourth after a much longer gap —
            // tests unsubscribe in that gap and assert the fourth is never delivered.
            const pushes: { pos: number; delayMs: number }[] = [
              { pos: 0.1, delayMs: 20 },
              { pos: 0.2, delayMs: 40 },
              { pos: 0.3, delayMs: 60 },
              { pos: 0.4, delayMs: 150 }
            ]
            for (const { pos, delayMs } of pushes) {
              setTimeout(() => {
                socket.write(
                  encodeMessage(JSON.stringify({ type: 'position-update', payload: { pos } }))
                )
              }, delayMs)
            }
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

    // The server sends pushes at 20/40/60ms, then a fourth at 150ms. Poll for the
    // first three to actually land rather than sleeping a fixed duration — under a
    // full parallel suite, real socket I/O can lag well past any fixed guess at
    // "surely long enough," which is exactly what made this test intermittently
    // fail (the assertion running before the third push had arrived).
    await waitFor(() => received.length >= 3)
    // Unsubscribe immediately, synchronously, with nothing else awaited in
    // between the condition above resolving and this call — Node's run-to-
    // completion semantics guarantee no other socket data (e.g. the fourth push)
    // is processed in that gap, so this can't race the fourth push's delivery.
    unsubscribe()
    expect(received).toEqual([{ pos: 0.1 }, { pos: 0.2 }, { pos: 0.3 }])

    // The fourth push was scheduled 150ms after the server received
    // 'subscribe-me'; wait comfortably past that, then confirm the listener was
    // never called again. This one genuinely has no positive condition to poll
    // for (it's an absence check) — but unlike the wait above, its timing can't
    // cause a false failure: unsubscribe() already removed the callback, so no
    // matter how delayed the fourth push's delivery is, it cannot add to
    // `received` after this point.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(received.length).toBe(3)

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
})
