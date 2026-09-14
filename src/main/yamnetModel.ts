// src/main/yamnetModel.ts
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { app } from 'electron'

/** Mirrors demoRifff.ts's own demoRifffDir() dev-vs-packaged branch exactly:
 * packaged mode reads the extraResources copy (see electron-builder.yml),
 * dev mode reads straight out of the repo's own resources/ (vendored by
 * scripts/vendor-yamnet.sh -- gitignored, run once locally before `npm run
 * dev` for embedding work to function; every other feature in this app
 * works fine without it, this only affects Plan B2's own embedding path). */
function yamnetModelPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'yamnet', 'yamnet.onnx')
  }
  return join(app.getAppPath(), 'resources', 'yamnet', 'yamnet.onnx')
}

/** Reads the vendored YAMNet ONNX model's raw bytes -- returned to the
 * renderer over IPC (get-yamnet-model) for onnxruntime-web's
 * InferenceSession.create() to consume directly (it accepts a Uint8Array,
 * not just a URL). Returns null (not a throw) when the model hasn't been
 * vendored yet (e.g. a fresh dev checkout that hasn't run
 * scripts/vendor-yamnet.sh) -- the renderer-side embedding path treats a
 * null model the same as "extraction unavailable," which the design's own
 * layered-fallback shape already handles gracefully (falls back to Plan
 * B1's centroid classifier). */
export function readYamnetModelBytes(): Uint8Array | null {
  const path = yamnetModelPath()
  if (!existsSync(path)) return null
  return readFileSync(path)
}
