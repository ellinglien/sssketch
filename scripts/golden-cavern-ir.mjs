// scripts/golden-cavern-ir.mjs -- the cavern reverb's golden impulse, rendered by the WEB's own
// code: ell.ing/radio's src/audio/noise.ts reverbImpulse, bundled with esbuild (its `@shared`
// alias pointed at this repo's src/shared, as the radio's own tsconfig does) and run in Node.
// CavernReverbTests compares the native twin (CavernReverb.cpp) against it.
//
//   node scripts/golden-cavern-ir.mjs            # radio checked out at ../ell.ing/radio
//   RADIO_DIR=/path/to/radio node scripts/golden-cavern-ir.mjs
//
// Writes native-engine/test/golden/cavern-ir.f32 (little-endian float32, planar: L then R, the
// first FRAMES samples AFTER the pre-delay, at 48 kHz) and cavern-ir.json (what it is, plus the
// whole impulse's length and mean square, for the normalisation check). Regenerate after
// changing REVERB_IR (src/shared/radioSound.ts) or noise.ts.

import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RADIO = process.env.RADIO_DIR
  ? resolve(process.env.RADIO_DIR)
  : resolve(ROOT, '..', 'ell.ing', 'radio')
const OUT = join(ROOT, 'native-engine', 'test', 'golden')
const SAMPLE_RATE = 48000
const FRAMES = 8192

const tmp = mkdtempSync(join(tmpdir(), 'cavern-ir-'))
try {
  const bundle = join(tmp, 'noise.mjs')
  await build({
    entryPoints: [join(RADIO, 'src', 'audio', 'noise.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundle,
    alias: { '@shared': join(ROOT, 'src', 'shared') },
    logLevel: 'warning'
  })
  const { reverbImpulse, REVERB_IR } = await import(pathToFileURL(bundle).href)
  const ir = reverbImpulse(SAMPLE_RATE)
  const pre = Math.round(REVERB_IR.preDelaySec * SAMPLE_RATE)

  const out = new Float32Array(2 * FRAMES)
  out.set(ir[0].subarray(pre, pre + FRAMES), 0)
  out.set(ir[1].subarray(pre, pre + FRAMES), FRAMES)
  writeFileSync(join(OUT, 'cavern-ir.f32'), Buffer.from(out.buffer))

  // mean square over both channels and every sample, pre-delay included: what Web Audio's
  // ConvolverNode normalisation takes the root of
  let sum = 0
  for (const ch of ir) for (const v of ch) sum += v * v
  const radioCommit = (() => {
    try {
      return execFileSync('git', ['-C', RADIO, 'rev-parse', '--short', 'HEAD']).toString().trim()
    } catch {
      return 'unknown'
    }
  })()
  const manifest = {
    note: 'written by sssketch scripts/golden-cavern-ir.mjs from ell.ing/radio src/audio/noise.ts reverbImpulse; little-endian float32, planar (L then R)',
    radioCommit,
    sampleRate: SAMPLE_RATE,
    frames: FRAMES,
    offset: pre,
    length: ir[0].length,
    meanSquare: sum / (ir.length * ir[0].length)
  }
  writeFileSync(join(OUT, 'cavern-ir.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    `cavern-ir: ${FRAMES} frames from sample ${pre} of ${ir[0].length} at ${SAMPLE_RATE} Hz (radio ${radioCommit})`
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
