import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { createEngineStopper } from './engineStop'
import { EngineClient, encodeMessage } from './engineClient'
import { spawnEngine, type EngineHandle } from './engineProcess'

// The real compiled engine, as in engineProcess.test.ts (same override, same reasoning).
const realBinaryPath =
  process.env.SSSKETCH_ENGINE_BINARY ??
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
  )
const noBridgeBinaryPath = '/no/such/bridge/binary'

type Reply = { token: unknown; stopped: unknown }

/** A fake client whose replies the test releases by hand. */
function fakeClient(): {
  client: Pick<EngineClient, 'sendAndAwaitType'>
  sent: number[]
  answer: (index: number, reply: Reply) => void
  fail: (index: number, err: Error) => void
} {
  const pending: { resolve: (p: unknown) => void; reject: (e: Error) => void }[] = []
  const sent: number[] = []
  const client: Pick<EngineClient, 'sendAndAwaitType'> = {
    sendAndAwaitType: (_type, payload) =>
      new Promise((resolve, reject) => {
        sent.push((payload as { token: number }).token)
        pending.push({ resolve, reject })
      })
  }
  return {
    client,
    sent,
    answer: (i, reply) => pending[i].resolve(reply),
    fail: (i, err) => pending[i].reject(err)
  }
}

describe('createEngineStopper', () => {
  it('resolves at once with no engine running', async () => {
    await expect(createEngineStopper(() => undefined).stop()).resolves.toBeUndefined()
  })

  it('shares one request between concurrent callers, then starts a fresh one', async () => {
    const fake = fakeClient()
    const stopper = createEngineStopper(() => fake.client)
    const a = stopper.stop()
    const b = stopper.stop()
    expect(fake.sent).toEqual([1])
    fake.answer(0, { token: 1, stopped: true })
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined])

    const c = stopper.stop()
    expect(fake.sent).toEqual([1, 2])
    fake.answer(1, { token: 2, stopped: true })
    await expect(c).resolves.toBeUndefined()
  })

  it('rejects a stop the engine reports superseded by a newer play', async () => {
    const fake = fakeClient()
    const stopper = createEngineStopper(() => fake.client)
    const a = stopper.stop()
    fake.answer(0, { token: 1, stopped: false })
    await expect(a).rejects.toThrow(/superseded/)
  })

  it('after supersede(), the next stop sends its own request', async () => {
    const fake = fakeClient()
    const stopper = createEngineStopper(() => fake.client)
    const a = stopper.stop()
    stopper.supersede()
    const b = stopper.stop()
    expect(fake.sent).toEqual([1, 2])
    fake.answer(0, { token: 1, stopped: false })
    fake.answer(1, { token: 2, stopped: true })
    await expect(a).rejects.toThrow()
    await expect(b).resolves.toBeUndefined()
  })

  it('rejects, and frees the slot, when the engine does not answer', async () => {
    const fake = fakeClient()
    const stopper = createEngineStopper(() => fake.client)
    const a = stopper.stop()
    fake.fail(0, new Error('timed out waiting for "transport-stopped" after 2000ms'))
    await expect(a).rejects.toThrow(/timed out/)
    void stopper.stop()
    expect(fake.sent).toEqual([1, 2])
  })
})

describe('createEngineStopper over the wire', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  })

  // Answers every stop late: the first only after the second has arrived, and
  // the first's reply is sent first. The second waiter must not take it.
  it("a late reply to an earlier stop does not satisfy the next one's waiter", async () => {
    const port = await new Promise<number>((resolve) => {
      const tokens: number[] = []
      server = createServer((socket: Socket) => {
        let buf = Buffer.alloc(0)
        socket.on('data', (chunk) => {
          buf = Buffer.concat([buf, chunk])
          while (buf.length >= 8) {
            const len = buf.readUInt32LE(4)
            if (buf.length < 8 + len) break
            const msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'))
            buf = buf.subarray(8 + len)
            if (msg.type !== 'stop') continue
            tokens.push(msg.payload.token)
            if (tokens.length === 2) {
              // The first stop was superseded (stopped=false); then the second completes.
              for (const [token, stopped] of [
                [tokens[0], false],
                [tokens[1], true]
              ]) {
                socket.write(
                  encodeMessage(
                    JSON.stringify({ type: 'transport-stopped', payload: { token, stopped } })
                  )
                )
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
    const client = new EngineClient()
    await client.connect(port)
    try {
      const stopper = createEngineStopper(() => client, 2000)
      const first = stopper.stop()
      stopper.supersede()
      const second = stopper.stop()
      await expect(first).rejects.toThrow(/superseded/)
      await expect(second).resolves.toBeUndefined()
    } finally {
      client.disconnect()
    }
  })
})

describe('createEngineStopper against the real engine', () => {
  let handle: EngineHandle | undefined
  afterEach(() => {
    handle?.stop()
    handle = undefined
  })

  // An idle engine (nothing loaded, never played) must answer each stop well inside the
  // timeout, whether or not this machine's audio device is calling back: with callbacks the
  // Stop applies on the next one, without them the engine acknowledges silence itself.
  it('confirms a stop, and a second one, well inside the timeout', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: noBridgeBinaryPath
    })
    const client = new EngineClient()
    await client.connect(handle.port)
    try {
      const stopper = createEngineStopper(() => client, 1500)
      const started = Date.now()
      await stopper.stop()
      await stopper.stop()
      expect(Date.now() - started).toBeLessThan(1500)
    } finally {
      client.disconnect()
    }
  }, 30000)

  it('answers a stop that a play superseded with stopped=false, not silence', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: noBridgeBinaryPath
    })
    const client = new EngineClient()
    await client.connect(handle.port)
    try {
      const stopper = createEngineStopper(() => client, 1500)
      // Play, then stop, then play again before the first stop can be acknowledged: the
      // engine's play handler answers every pending stop as superseded. Sent back to back
      // on one socket, so the engine reads them in this order before its 2 ms ack poll.
      client.send('play', { fromPos: 0 })
      const stopped = stopper.stop()
      client.send('play', { fromPos: 0 })
      stopper.supersede()
      const outcome = await stopped.then(
        () => 'silent',
        (err: Error) => err.message
      )
      // Either is correct engine behaviour: the second play can land after the ack poll ran.
      expect(['silent', 'native engine stop was superseded by a newer play']).toContain(outcome)
      await stopper.stop()
    } finally {
      client.disconnect()
    }
  }, 30000)
})
