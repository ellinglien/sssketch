/// <reference lib="webworker" />
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
//        { type: 'result', requestId: number, embedding: number[], topClassIndex: number | null }
//        { type: 'error', requestId: number | null, message: string }
//
// Imports from 'onnxruntime-web/wasm' specifically, NOT the bare
// 'onnxruntime-web' package entry -- verified directly (2026-09-14, real
// `electron-vite build` runs) that the bare entry's own source has a
// hardcoded `new URL("ort-wasm-simd-threaded.jsep.wasm", import.meta.url)`
// reference (the WebGPU/WebNN-interop variant, ~28MB) that Vite's asset
// bundler picks up unconditionally regardless of the `executionProviders`
// this worker actually requests -- this app only ever uses the plain
// `wasm` CPU backend, which has no JS-interop need at all. The `/wasm`
// subpath's own bundle references only the plain
// ort-wasm-simd-threaded.wasm (~14MB) instead. Also: no manual
// `ort.env.wasm.wasmPaths` override is set here -- Vite's own `new
// URL(..., import.meta.url)` handling resolves and bundles the correct
// WASM asset automatically (confirmed via the same build runs: identical
// output with or without a wasmPaths override), so a hand-vendored static
// copy under a public/ directory is unnecessary and was removed.
import * as ort from 'onnxruntime-web/wasm'

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
export function meanPoolEmbedding(
  data: Float32Array,
  numFrames: number,
  embeddingDim: number
): number[] {
  const pooled = new Array<number>(embeddingDim).fill(0)
  if (numFrames === 0) return pooled
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * embeddingDim
    for (let d = 0; d < embeddingDim; d++) pooled[d] += data[offset + d]
  }
  for (let d = 0; d < embeddingDim; d++) pooled[d] /= numFrames
  return pooled
}

/** Mean-pools YAMNet's own per-frame class-score output (output_0, shape
 * [numFrames, numClasses]) across frames -- same pooling convention as
 * meanPoolEmbedding above, just argmax'd at the end instead of returned as
 * a vector, since a single "what did this clip sound like overall" class
 * guess is all Task 4's own lookup table needs. Returns null for zero
 * frames (a clip too short to produce even one analysis window -- same
 * degenerate case meanPoolEmbedding's own caller, stemEmbeddingCache.ts,
 * already treats as "extraction failed" for the embedding). */
export function topClassIndexFromScores(
  data: Float32Array,
  numFrames: number,
  numClasses: number
): number | null {
  if (numFrames === 0) return null
  const pooled = new Array<number>(numClasses).fill(0)
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * numClasses
    for (let c = 0; c < numClasses; c++) pooled[c] += data[offset + c]
  }
  let bestIndex = 0
  let bestScore = -Infinity
  for (let c = 0; c < numClasses; c++) {
    if (pooled[c] > bestScore) {
      bestScore = pooled[c]
      bestIndex = c
    }
  }
  return bestIndex
}

async function handleInit(modelBytes: Uint8Array): Promise<void> {
  session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['wasm']
  })
  postMessage({ type: 'ready' })
}

async function handleInfer(requestId: number, pcm: Float32Array): Promise<void> {
  if (!session) throw new Error('yamnetWorker: infer requested before init completed')
  try {
    const input = new ort.Tensor('float32', pcm, [pcm.length])
    const outputs = await session.run({ waveform: input })
    // outputs is a bare string-indexed map (OnnxValueMapType) -- a typo'd
    // key or a re-exported model with different output names typechecks
    // fine either way and would otherwise only fail with a cryptic
    // "Cannot read properties of undefined" deep inside meanPoolEmbedding;
    // guard explicitly so a real name mismatch is diagnosable.
    const embeddingOutput = outputs.output_1
    if (!embeddingOutput) {
      throw new Error(
        `expected output "output_1", got: ${Object.keys(outputs).join(', ') || '(none)'}`
      )
    }
    const embeddingDim = 1024
    const numFrames = embeddingOutput.dims[0]
    const embedding = meanPoolEmbedding(
      embeddingOutput.data as Float32Array,
      numFrames,
      embeddingDim
    )
    const scoresOutput = outputs.output_0
    const topClassIndex = scoresOutput
      ? topClassIndexFromScores(
          scoresOutput.data as Float32Array,
          scoresOutput.dims[0],
          scoresOutput.dims[1]
        )
      : null
    postMessage({ type: 'result', requestId, embedding, topClassIndex })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`yamnetWorker: infer failed (pcm.length=${pcm.length}): ${message}`)
  }
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
