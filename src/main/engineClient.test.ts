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
})
