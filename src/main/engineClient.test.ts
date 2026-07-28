import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { EngineClient, encodeMessage, MAGIC_NUMBER } from './engineClient'

let server: Server | undefined

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
})
