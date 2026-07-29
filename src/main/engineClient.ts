import { Socket } from 'node:net'

// Confirmed against JUCE 8.0.4's actual InterprocessConnection::sendMessage /
// readNextMessage (modules/juce_events/interprocess/juce_InterprocessConnection.cpp):
// an 8-byte header (uint32 magic number, uint32 payload length, both
// little-endian on this platform via ByteOrder::swapIfBigEndian) followed by
// exactly that many raw payload bytes. The magic number is
// InterprocessConnection's compiled-in default (0xf2b49e2c) — none of this
// codebase's C++ IpcConnection/IpcServer/TestClient classes override it.
export const MAGIC_NUMBER = 0xf2b49e2c

export function encodeMessage(jsonText: string): Buffer {
  const payload = Buffer.from(jsonText, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt32LE(MAGIC_NUMBER, 0)
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

interface IncomingMessage {
  type: string
  payload?: unknown
}

/**
 * A minimal client for the native engine's JSON-over-socket IPC protocol,
 * speaking InterprocessConnection's real wire framing directly (see
 * MAGIC_NUMBER above) — no JUCE involved on this side, just a Node TCP
 * socket. Used by the main process to drive one-shot export operations;
 * NOT used for live playback (out of scope for this phase, see the plan's
 * scope-boundary note).
 */
export class EngineClient {
  private socket: Socket | null = null
  private recvBuf = Buffer.alloc(0)
  private pendingWaiters: {
    type: string
    resolve: (payload: unknown) => void
    reject: (err: Error) => void
  }[] = []
  private subscribers = new Map<string, Set<(payload: unknown) => void>>()

  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      const onError = (err: Error): void => reject(err)
      socket.once('error', onError)
      socket.connect(port, '127.0.0.1', () => {
        socket.off('error', onError)
        socket.on('error', (err) => this.failAllWaiters(err))
        socket.on('data', (chunk) => this.onData(chunk))
        this.socket = socket
        resolve()
      })
    })
  }

  disconnect(): void {
    this.socket?.destroy()
    this.socket = null
  }

  private onData(chunk: Buffer): void {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk])
    for (;;) {
      if (this.recvBuf.length < 8) return
      const magic = this.recvBuf.readUInt32LE(0)
      const len = this.recvBuf.readUInt32LE(4)
      if (magic !== MAGIC_NUMBER) {
        this.failAllWaiters(new Error('engine sent a malformed message (bad magic number)'))
        // The stream is desynced from this point on — there's no way to know where
        // the next real header starts, so keeping the socket open would just mean
        // silently accumulating garbage onto recvBuf forever. Tear it down instead
        // of leaving a corrupted connection lingering.
        this.socket?.destroy()
        this.socket = null
        return
      }
      if (this.recvBuf.length < 8 + len) return // wait for the rest of this message
      const payloadText = this.recvBuf.subarray(8, 8 + len).toString('utf8')
      this.recvBuf = this.recvBuf.subarray(8 + len)
      this.handleMessage(payloadText)
    }
  }

  private handleMessage(payloadText: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(payloadText)
    } catch (err) {
      // Malformed JSON from the engine — ignore rather than crash the client.
      console.error('EngineClient: received unparseable JSON from the engine', err, payloadText)
      return
    }
    // JSON.parse succeeds (with no exception) for non-object top-level values too —
    // `null`, numbers, strings, arrays. The `as IncomingMessage` cast used to happen
    // right after JSON.parse and gave no runtime protection: a literal `null`
    // payload would sail through as `msg`, and the very next line's `msg.type`
    // would throw a TypeError synchronously inside the 'data' handler, which is
    // uncaught and can crash the whole Electron main process. Validate the actual
    // shape before trusting it.
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      console.error('EngineClient: received a message with an unexpected shape', payloadText)
      return
    }
    const msg = parsed as IncomingMessage

    // Persistent subscribers (client.on) and one-shot waiters (sendAndAwaitType) are
    // independent: a message type could theoretically have both at once, and both
    // must fire. Deliberately not an if/else off the waiter check below.
    const subs = this.subscribers.get(msg.type)
    if (subs) {
      for (const cb of subs) cb(msg.payload)
    }

    const waiterIdx = this.pendingWaiters.findIndex((w) => w.type === msg.type)
    if (waiterIdx === -1) return // not something anyone's waiting for (e.g. a stray position-update)
    const [waiter] = this.pendingWaiters.splice(waiterIdx, 1)
    waiter.resolve(msg.payload)
  }

  private failAllWaiters(err: Error): void {
    for (const waiter of this.pendingWaiters) waiter.reject(err)
    this.pendingWaiters = []
  }

  /** Subscribes to every message of the given type, indefinitely, until
   * unsubscribed — for the engine's own pushed events (position-update, and
   * this phase's new engine-restarted signal), which arrive repeatedly and
   * unprompted, unlike sendAndAwaitType's one-shot request/response messages.
   * Returns an unsubscribe function. */
  on(type: string, callback: (payload: unknown) => void): () => void {
    let set = this.subscribers.get(type)
    if (!set) {
      set = new Set()
      this.subscribers.set(type, set)
    }
    set.add(callback)
    return () => {
      set!.delete(callback)
      if (set!.size === 0) this.subscribers.delete(type)
    }
  }

  send(type: string, payload?: unknown): void {
    if (!this.socket) throw new Error('EngineClient: not connected')
    const text = JSON.stringify(payload === undefined ? { type } : { type, payload })
    this.socket.write(encodeMessage(text))
  }

  /** Sends a message and waits for the first reply of the given response type
   * — sufficient for this phase's one-shot request/response messages
   * (render-export -> render-export-result). Does not attempt to correlate
   * multiple concurrent requests of the same type; this client is used for
   * one export at a time, matching engineProcess.ts's one-process-per-export
   * design. */
  sendAndAwaitType(
    type: string,
    payload: unknown,
    responseType: string,
    timeoutMs = 30000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingWaiters = this.pendingWaiters.filter((w) => w.resolve !== resolve)
        reject(new Error(`timed out waiting for "${responseType}" after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pendingWaiters.push({
        type: responseType,
        resolve: (payload) => {
          clearTimeout(timer)
          resolve(payload)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
      this.send(type, payload)
    })
  }
}
