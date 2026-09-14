// src/renderer/src/audio/yamnetWorker.ts
//
// Runs YAMNet inference off the main thread -- model loading and each
// inference call happen here, never in the renderer's own thread, so a
// first-time scan of a large library doesn't block the UI (design spec §7).
// Deliberately does NOT decode audio or resample itself: the caller
// (yamnetClient.ts) hands this worker already-decoded, already-16kHz-mono
// PCM, reusing the exact same Web-Audio-decode path stemFeaturesCache.ts's
// own getStemFeatures already uses rather than adding a second decode path.
//
// Message protocol (both directions are plain structured-clone objects,
// not classes):
//   In:  { type: 'init', modelBytes: Uint8Array }
//        { type: 'infer', requestId: number, pcm: Float32Array }
//   Out: { type: 'ready' }
//        { type: 'result', requestId: number, embedding: number[] }
//        { type: 'error', requestId: number | null, message: string }

import * as ort from 'onnxruntime-web'

ort.env.wasm.wasmPaths = '/onnxruntime/'

let session: ort.InferenceSession | null = null

interface InitMessage {
  type: 'init'
  modelBytes: Uint8Array
}

interface InferMessage {
  type: 'infer'
  requestId: number
  pcm: Float32Array
}

type InMessage = InitMessage | InferMessage

/** YAMNet's own per-frame embedding output (output_1, shape [numFrames,
 * 1024]) mean-pooled across frames into one fixed-length vector per stem.
 * Frame count varies with clip length; the embedding dimension (1024) is
 * fixed regardless. */
function meanPoolEmbedding(data: Float32Array, numFrames: number, embeddingDim: number): number[] {
  const pooled = new Array<number>(embeddingDim).fill(0)
  if (numFrames === 0) return pooled
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * embeddingDim
    for (let d = 0; d < embeddingDim; d++) pooled[d] += data[offset + d]
  }
  for (let d = 0; d < embeddingDim; d++) pooled[d] /= numFrames
  return pooled
}

async function handleInit(modelBytes: Uint8Array): Promise<void> {
  session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['wasm']
  })
  postMessage({ type: 'ready' })
}

async function handleInfer(requestId: number, pcm: Float32Array): Promise<void> {
  if (!session) throw new Error('yamnetWorker: infer requested before init completed')
  const input = new ort.Tensor('float32', pcm, [pcm.length])
  const outputs = await session.run({ waveform: input })
  const embeddingOutput = outputs.output_1
  const embeddingDim = 1024
  const numFrames = embeddingOutput.dims[0]
  const embedding = meanPoolEmbedding(embeddingOutput.data as Float32Array, numFrames, embeddingDim)
  postMessage({ type: 'result', requestId, embedding })
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const msg = event.data
  if (msg.type === 'init') {
    handleInit(msg.modelBytes).catch((err: unknown) => {
      postMessage({
        type: 'error',
        requestId: null,
        message: err instanceof Error ? err.message : String(err)
      })
    })
  } else if (msg.type === 'infer') {
    handleInfer(msg.requestId, msg.pcm).catch((err: unknown) => {
      postMessage({
        type: 'error',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err)
      })
    })
  }
}
