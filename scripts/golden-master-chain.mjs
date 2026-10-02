// scripts/golden-master-chain.mjs -- the master chain's golden output, rendered by the WEB's own
// code in the browser it plays in: ell.ing/radio's src/audio/masterChain.ts buildMasterChain with
// its Faust glue and true-peak limiter (src/audio/faustNode.ts, the committed .wasm through
// faustProcessor.js as an AudioWorklet), in headless Chrome's OfflineAudioContext. Native radio
// sound plan, Tasks 7 and 8: MasterGlueToneTests runs the same input through the native
// MasterStage (headroom -> HP 25 -> glue -> width -> shelves -> limiter) and matches this within
// 1e-5; MasterSaturationTests does the same with the saturation on (-> saturate.dsp before the
// glue).
//
//   node scripts/golden-master-chain.mjs            # radio checked out at ../ell.ing/radio
//   RADIO_DIR=/path/to/radio CHROME=/path/to/chrome node scripts/golden-master-chain.mjs
//
// The radio checkout must be clean (`git status --porcelain` empty), so the commit recorded in
// master-chain.json is what was rendered; GOLDEN_ALLOW_DIRTY=1 renders anyway, and records the
// commit as `git describe --always --dirty` (ending -dirty).
//
// What it covers: the web chain exactly as the radio builds it (input -> level -> headroom -4 dB
// -> master filter, parked open -> HP 25 Hz -> [saturate.dsp] -> glue.dsp -> width -> low shelf
// -> high shelf -> truepeak.dsp -> wet), every parameter at the web's default, and no reverb (the
// input goes straight into the chain). Rendered twice, in one page:
//   master-chain.out.f32           the saturation left out (`saturate: false`; Task 7)
//   master-chain-saturate.out.f32  the saturation in (Task 8), its Faust stage put in and its
//                                  drive set as Engine.loadFaust does: saturationDrive of the
//                                  listener's default amount, DEFAULT_SATURATION (0.5 -> 0.9)
// The biquads are Chrome's own BiquadFilterNode, the mid/side sums its own GainNodes.
//
// The input is the Faust goldens' programme.f32 (ell.ing/radio scripts/golden-vectors.mjs: 2 s
// at 48 kHz of seeded sine-and-noise bursts from -36 to +6 dBFS), read from
// native-engine/test/golden/. Writes each .out.f32 (little-endian float32, planar: L then R)
// with its .json (what it is, the Chrome version, the radio commit). Nothing is added to or
// changed in the radio repo. Regenerate after changing masterChain.ts, MASTERING,
// FAUST_DEFAULTS or the saturation maps (src/shared/radioSound.ts), the radio's
// DEFAULT_SATURATION, saturate.dsp, glue.dsp or truepeak.dsp (after the radio's own
// build-faust.mjs and golden-vectors.mjs).
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RADIO = process.env.RADIO_DIR
  ? resolve(process.env.RADIO_DIR)
  : resolve(ROOT, '..', 'ell.ing', 'radio')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const GOLDEN = join(ROOT, 'native-engine', 'test', 'golden')
const PORT = Number(process.env.GOLDEN_PORT ?? 5198)
const SAMPLE_RATE = 48000
const FRAMES = 2 * SAMPLE_RATE

const git = (...args) =>
  execFileSync('git', ['-C', RADIO, ...args])
    .toString()
    .trim()
const dirty = git('status', '--porcelain')
if (dirty && process.env.GOLDEN_ALLOW_DIRTY !== '1') {
  console.error(
    `${RADIO} has uncommitted changes, so the golden would not match any commit:\n${dirty}\n` +
      'commit or stash them, or set GOLDEN_ALLOW_DIRTY=1 to render anyway (recorded as -dirty)'
  )
  process.exit(1)
}
const radioCommit = git('describe', '--always', '--dirty')

const programme = readFileSync(join(GOLDEN, 'programme.f32'))
if (programme.length !== 2 * FRAMES * 4) throw new Error('programme.f32: unexpected size')

// The page, as a virtual module: the radio's own modules, imported by their paths in its root.
const PAGE = `
import { buildMasterChain, saturationDrive } from '/src/audio/masterChain.ts'
import { createFaustNode, GLUE, SATURATE, TRUEPEAK, latencySamples } from '/src/audio/faustNode.ts'
import { DEFAULT_SATURATION } from '/src/audio/defaults.ts'
const SR = ${SAMPLE_RATE}, FRAMES = ${FRAMES}
const render = async (prog, saturate) => {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: FRAMES, sampleRate: SR })
  const chain = buildMasterChain(ctx, ctx.destination, { saturate })
  // as Engine.loadFaust puts them in: the saturation (when on) first, its drive set from the
  // listener's default amount; the glue and limiter with no parameter set (their .dsp defaults)
  if (saturate) {
    const f = await createFaustNode(ctx, SATURATE)
    chain.useStage('saturate', f.node, latencySamples(SATURATE.meta) / SR)
    f.setParam('/saturate/drive', saturationDrive(DEFAULT_SATURATION))
  }
  for (const [stage, dsp] of [['glue', GLUE], ['limiter', TRUEPEAK]]) {
    const f = await createFaustNode(ctx, dsp)
    chain.useStage(stage, f.node, latencySamples(dsp.meta) / SR)
  }
  const buffer = ctx.createBuffer(2, FRAMES, SR)
  buffer.copyToChannel(prog.subarray(0, FRAMES), 0)
  buffer.copyToChannel(prog.subarray(FRAMES), 1)
  const src = new AudioBufferSourceNode(ctx, { buffer })
  src.connect(chain.input)
  src.start(0)
  const out = await ctx.startRendering()
  const all = new Float32Array(2 * FRAMES)
  all.set(out.getChannelData(0), 0)
  all.set(out.getChannelData(1), FRAMES)
  return all
}
try {
  const prog = new Float32Array(await (await fetch('/__golden/programme.f32')).arrayBuffer())
  const both = new Float32Array(4 * FRAMES)
  both.set(await render(prog, false), 0)
  both.set(await render(prog, true), 2 * FRAMES)
  const drive = saturationDrive(DEFAULT_SATURATION)
  await fetch('/__golden/result?ua=' + encodeURIComponent(navigator.userAgent) + '&drive=' + drive, { method: 'POST', body: both.buffer })
} catch (e) {
  await fetch('/__golden/error', { method: 'POST', body: String((e && e.stack) || e) })
}
`

const { createServer } = await import(
  pathToFileURL(join(RADIO, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href
)

let chrome
let server
let finishing = false
const userDir = mkdtempSync(join(tmpdir(), 'golden-master-'))
/** Every exit goes through here: Chrome killed, vite closed, the temp profile removed. */
const finish = async (code) => {
  if (finishing) return
  finishing = true
  // kill Chrome and wait for it to be gone (a few seconds at most), so its profile is no
  // longer being written when it is removed below
  if (
    chrome &&
    chrome.exitCode === null &&
    chrome.signalCode === null &&
    chrome.pid !== undefined
  ) {
    const gone = new Promise((ok) => chrome.once('exit', ok))
    chrome.kill()
    await Promise.race([gone, new Promise((ok) => setTimeout(ok, 5000))])
  }
  try {
    await server?.close()
  } catch (e) {
    console.error('closing vite:', e)
  }
  // a straggling Chrome helper may still touch it: retry, then say so
  try {
    rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (e) {
    console.error(`could not remove ${userDir}:`, e)
  }
  process.exit(code)
}
process.on('SIGINT', () => void finish(130))
process.on('SIGTERM', () => void finish(143))
process.on('uncaughtException', (e) => {
  console.error(e)
  void finish(1)
})
process.on('unhandledRejection', (e) => {
  console.error(e)
  void finish(1)
})

const readBody = (req) =>
  new Promise((ok) => {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => ok(Buffer.concat(parts)))
  })

try {
  server = await createServer({
    root: RADIO,
    configFile: join(RADIO, 'vite.config.ts'),
    logLevel: 'warn',
    server: { port: PORT, strictPort: true },
    plugins: [
      {
        name: 'golden-master-chain',
        resolveId: (id) => (id === 'virtual:golden-master' ? '\0golden-master' : undefined),
        load: (id) => (id === '\0golden-master' ? PAGE : undefined),
        configureServer(s) {
          s.middlewares.use('/__golden', async (req, res) => {
            const url = new URL(req.url ?? '/', 'http://x')
            if (url.pathname === '/page') {
              res.setHeader('content-type', 'text/html')
              // the module through vite's /@id/ route, under whatever base the radio's config sets
              const base = s.config.base.endsWith('/') ? s.config.base : s.config.base + '/'
              res.end(
                `<!doctype html><script type="module" src="${base}@id/__x00__golden-master"></script>`
              )
            } else if (url.pathname === '/programme.f32') {
              res.setHeader('content-type', 'application/octet-stream')
              res.end(programme)
            } else if (url.pathname === '/result') {
              const body = await readBody(req)
              res.end('ok')
              if (body.length !== 4 * FRAMES * 4) {
                console.error(`unexpected result size ${body.length}`)
                return finish(1)
              }
              const drive = Number(url.searchParams.get('drive'))
              const tail =
                'glue.dsp (-14 dB, 2:1, knee 6), width (side +2 dB shelf at 250 Hz), low shelf +1 dB at 100 Hz, high shelf +1 dB at 10 kHz, truepeak.dsp (-1 dBTP)'
              const outputs = [
                {
                  name: 'master-chain',
                  how: 'buildMasterChain (saturate: false) with its Faust glue and truepeak stages, every parameter at its default',
                  chain: `headroom -4 dB, HP 25 Hz, ${tail}`
                },
                {
                  name: 'master-chain-saturate',
                  how:
                    'buildMasterChain (saturate: true) with its Faust saturate (drive set as Engine.loadFaust ' +
                    'does, saturationDrive(DEFAULT_SATURATION)), glue and truepeak stages, every other parameter at its default',
                  chain: `headroom -4 dB, HP 25 Hz, saturate.dsp (drive ${drive}), ${tail}`
                }
              ]
              outputs.forEach(({ name, how, chain }, k) => {
                const bytes = body.subarray(k * 2 * FRAMES * 4, (k + 1) * 2 * FRAMES * 4)
                const out = new Float32Array(bytes.buffer, bytes.byteOffset, 2 * FRAMES)
                let peak = 0
                for (const v of out) peak = Math.max(peak, Math.abs(v))
                writeFileSync(join(GOLDEN, `${name}.out.f32`), bytes)
                const meta = {
                  note:
                    'written by sssketch scripts/golden-master-chain.mjs: programme.f32 through ell.ing/radio ' +
                    `src/audio/masterChain.ts ${how}, in headless Chrome ` +
                    'OfflineAudioContext; little-endian float32, planar (L then R)',
                  input: 'programme.f32',
                  chain,
                  radioCommit,
                  userAgent: url.searchParams.get('ua'),
                  sampleRate: SAMPLE_RATE,
                  frames: FRAMES
                }
                writeFileSync(join(GOLDEN, `${name}.json`), JSON.stringify(meta, null, 2) + '\n')
                console.log(`wrote ${name}.out.f32 (peak ${peak.toFixed(4)}) and ${name}.json`)
              })
              console.log(url.searchParams.get('ua'))
              return finish(0)
            } else if (url.pathname === '/error') {
              console.error((await readBody(req)).toString())
              res.end('ok')
              return finish(1)
            } else {
              res.statusCode = 404
              res.end()
            }
          })
        }
      }
    ]
  })
  await server.listen()
} catch (e) {
  console.error('vite:', e)
  await finish(1)
}
chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--mute-audio',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDir}`,
    `http://localhost:${PORT}/__golden/page`
  ],
  { stdio: 'ignore' }
)
chrome.on('error', (e) => {
  console.error(`could not start Chrome (${CHROME}; set CHROME=...):`, e.message)
  void finish(1)
})
chrome.on('exit', (code) => {
  if (!finishing) {
    console.error(`Chrome exited (${code}) before the page reported back`)
    void finish(1)
  }
})
setTimeout(() => {
  console.error('timed out')
  void finish(1)
}, 120000)
