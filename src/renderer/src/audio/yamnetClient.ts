// src/renderer/src/audio/yamnetClient.ts
//
// Lazily creates and owns the single yamnetWorker.ts instance for this
// renderer process, and wraps its message protocol in a promise-based
// request/response API. Model bytes are fetched via IPC (get-yamnet-model,
// main-process yamnetModel.ts) exactly once, the first time inference is
// actually requested -- not eagerly at module load, so a session that never
// touches an embedding-consuming screen never pays the model-load cost at
// all.

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null
let nextRequestId = 0
const pending = new Map<
  number,
  { resolve: (embedding: number[]) => void; reject: (err: Error) => void }
>()

interface ReadyMessage {
  type: 'ready'
}
interface ResultMessage {
  type: 'result'
  requestId: number
  embedding: number[]
}
interface ErrorMessage {
  type: 'error'
  requestId: number | null
  message: string
}
type OutMessage = ReadyMessage | ResultMessage | ErrorMessage

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./yamnetWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<OutMessage>) => {
    const msg = event.data
    if (msg.type === 'result') {
      pending.get(msg.requestId)?.resolve(msg.embedding)
      pending.delete(msg.requestId)
    } else if (msg.type === 'error') {
      if (msg.requestId !== null) {
        pending.get(msg.requestId)?.reject(new Error(msg.message))
        pending.delete(msg.requestId)
      }
    }
  }
  // A genuine worker crash (uncaught native/WASM exception, OOM, forcible
  // termination) never posts a message back for whatever request was in
  // flight -- without this, that request's own pending entry would hang
  // forever instead of resolving null like every other failure mode this
  // module documents (2026-09-14 code quality review). Also resets
  // worker/readyPromise so the NEXT call gets a fresh worker instead of
  // staying permanently stuck on a dead one for the rest of the renderer
  // process's lifetime -- guarded by identity (`worker === w`) so a crash
  // event for an OLD, already-replaced worker instance can't clobber a
  // newer one that's since taken over.
  w.onerror = (event: ErrorEvent) => {
    const err = new Error(`yamnetClient: worker crashed: ${event.message}`)
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    if (worker === w) {
      worker = null
      readyPromise = null
    }
  }
  worker = w
  return w
}

/** Resolves once the model has loaded in the worker and is ready to run
 * inference -- idempotent, safe to call repeatedly (returns the same
 * in-flight/settled promise). Returns null (never throws) when the model
 * bytes aren't available at all (readYamnetModelBytes returned null, e.g.
 * a dev checkout that hasn't run scripts/vendor-yamnet.sh) -- a caller
 * treats this the same as "extraction unavailable right now" and falls
 * back to Plan B1's classifier, exactly like a stem that simply hasn't
 * been extracted yet. */
function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    const modelBytes = await window.rifffApi.getYamnetModel()
    if (!modelBytes) throw new Error('yamnetClient: model bytes unavailable')
    getWorker().postMessage({ type: 'init', modelBytes }, [modelBytes.buffer])
    await new Promise<void>((resolve, reject) => {
      const w = getWorker()
      const onMessage = (event: MessageEvent<OutMessage>): void => {
        if (event.data.type === 'ready') {
          w.removeEventListener('message', onMessage)
          resolve()
        } else if (event.data.type === 'error' && event.data.requestId === null) {
          w.removeEventListener('message', onMessage)
          reject(new Error(event.data.message))
        }
      }
      w.addEventListener('message', onMessage)
    })
  })().catch((err: unknown) => {
    // Un-caches the rejection (2026-09-14 code quality review) -- without
    // this, one transient failure (e.g. a one-off IPC hiccup fetching
    // model bytes) would permanently disable YAMNet for the rest of the
    // renderer process's lifetime, since every future call would just
    // replay this same cached rejection instead of trying again.
    readyPromise = null
    throw err instanceof Error ? err : new Error(String(err))
  })
  return readyPromise
}

/** Runs YAMNet inference on one stem's already-decoded, already-16kHz-mono
 * PCM and returns its mean-pooled 1024-dim embedding. Returns null (never
 * throws) on ANY failure -- model unavailable, worker error, malformed
 * input -- since every caller in this plan treats "no embedding" as a
 * normal, expected fallback case (Plan B1's classifier), not an error
 * condition worth surfacing. */
export async function extractEmbedding(pcm: Float32Array): Promise<number[] | null> {
  try {
    await ensureReady()
  } catch (err) {
    console.error('yamnetClient: model failed to load', err)
    return null
  }
  return new Promise<number[] | null>((resolve) => {
    const requestId = nextRequestId++
    pending.set(requestId, {
      resolve: (embedding) => resolve(embedding),
      reject: (err) => {
        console.error('yamnetClient: inference failed', err)
        resolve(null)
      }
    })
    const pcmCopy = pcm.slice()
    try {
      getWorker().postMessage({ type: 'infer', requestId, pcm: pcmCopy }, [pcmCopy.buffer])
    } catch (err) {
      // A synchronous postMessage throw (2026-09-14 code quality review)
      // would otherwise both leak this pending entry forever AND violate
      // this function's own "never throws" contract, since the Promise
      // executor here only takes a `resolve` param -- an uncaught throw
      // inside it auto-rejects the promise this function returns.
      console.error('yamnetClient: failed to post infer message', err)
      pending.delete(requestId)
      resolve(null)
    }
  })
}
