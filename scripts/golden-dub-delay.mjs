// scripts/golden-dub-delay.mjs -- the dub echo's golden output, rendered by the WEB's own code in
// the browser it plays in: ell.ing/radio's src/audio/dubDelay.ts buildDubDelay (the stereo
// ping-pong, its DelayNodes, BiquadFilterNodes and feedback GainNodes) in headless Chrome's
// OfflineAudioContext, its time and feedback set with its own set(), as Engine.throwDelay does,
// from throwDelaySec. Native radio sound plan, Task 10: DubDelayBusTests runs the same input
// through the native DubDelayCore and matches this.
//
//   node scripts/golden-dub-delay.mjs               # radio checked out at ../ell.ing/radio
//
// The browser harness (the radio's vite, headless Chrome, the clean-checkout rule, cleanup) is
// scripts/goldenChrome.mjs.
//
// The input (dub-delay.in.f32, written here too): two stereo bursts of seeded noise (mulberry32,
// L and R different), 2048 frames each under a Hann window, peak about 0.5 -- burst A from frame
// 0, burst B for the retime case. Played at each case's rate (the same samples, frame for frame).
// The cases (each written planar L then R, one after another, into dub-delay.out.f32):
//   a  48 kHz, 120 bpm dotted eighth (0.375 s, a whole number of frames), feedback 0.6, burst A
//   b  44.1 kHz, 123 bpm quarter (0.4878... s: a fractional delay, the line interpolates),
//      feedback 0.45, burst A
//   c  48 kHz, 120 bpm dotted eighth at feedback 0.6 with burst A; then, while it rings, at frame
//      57600 (1.2 s) set() again to 97 bpm quarter at feedback 0.5, and burst B from that frame:
//      a throw that retimes the echo under the first one's tail, as the web does
// Regenerate after changing dubDelay.ts, throwDelaySec, or the DUB_* numbers
// (src/shared/radioSound.ts).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GOLDEN, renderInRadioChrome } from './goldenChrome.mjs'

const BURST = 2048
const B_AT = 57600

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// [A.L, A.R, B.L, B.R], each BURST frames
const input = new Float32Array(4 * BURST)
{
  const rnd = mulberry32(0xd0b)
  for (let k = 0; k < 4; k++)
    for (let i = 0; i < BURST; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (BURST - 1))
      input[k * BURST + i] = (rnd() * 2 - 1) * hann * 0.5
    }
}

const CASES = [
  { name: 'a', sampleRate: 48000, frames: 76800, bpm: 120, timing: 'dotted-eighth', feedback: 0.6 },
  { name: 'b', sampleRate: 44100, frames: 70560, bpm: 123, timing: 'quarter', feedback: 0.45 },
  {
    name: 'c',
    sampleRate: 48000,
    frames: 105600,
    bpm: 120,
    timing: 'dotted-eighth',
    feedback: 0.6,
    retime: { atFrame: B_AT, bpm: 97, timing: 'quarter', feedback: 0.5 }
  }
]

const PAGE = `
import { buildDubDelay, throwDelaySec } from '/src/audio/dubDelay.ts'
const CASES = ${JSON.stringify(CASES)}
const BURST = ${BURST}
const render = async (c, input) => {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: c.frames, sampleRate: c.sampleRate })
  const reverb = new GainNode(ctx) // the 0.15 feed to the room goes nowhere here
  const dub = buildDubDelay(ctx, ctx.destination, reverb)
  const delays = [throwDelaySec(c.bpm, c.timing)]
  dub.set(0, delays[0], c.feedback)
  const buffer = ctx.createBuffer(2, c.frames, c.sampleRate)
  buffer.getChannelData(0).set(input.subarray(0, BURST), 0)
  buffer.getChannelData(1).set(input.subarray(BURST, 2 * BURST), 0)
  if (c.retime) {
    delays.push(throwDelaySec(c.retime.bpm, c.retime.timing))
    dub.set(c.retime.atFrame / c.sampleRate, delays[1], c.retime.feedback)
    buffer.getChannelData(0).set(input.subarray(2 * BURST, 3 * BURST), c.retime.atFrame)
    buffer.getChannelData(1).set(input.subarray(3 * BURST, 4 * BURST), c.retime.atFrame)
  }
  const src = new AudioBufferSourceNode(ctx, { buffer })
  src.connect(dub.input)
  src.start(0)
  const out = await ctx.startRendering()
  const all = new Float32Array(2 * c.frames)
  all.set(out.getChannelData(0), 0)
  all.set(out.getChannelData(1), c.frames)
  return { all, delays }
}
try {
  const input = new Float32Array(await (await fetch('/__golden/input.f32')).arrayBuffer())
  const parts = [], delays = []
  for (const c of CASES) {
    const r = await render(c, input)
    parts.push(r.all)
    delays.push(r.delays)
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const body = new Float32Array(total)
  let at = 0
  for (const p of parts) { body.set(p, at); at += p.length }
  await fetch('/__golden/result?ua=' + encodeURIComponent(navigator.userAgent) + '&delays=' + encodeURIComponent(JSON.stringify(delays)), { method: 'POST', body: body.buffer })
} catch (e) {
  await fetch('/__golden/error', { method: 'POST', body: String((e && e.stack) || e) })
}
`

const inputBytes = Buffer.from(input.buffer)
await renderInRadioChrome({
  tag: 'dub',
  page: PAGE,
  inputs: { 'input.f32': inputBytes },
  onResult: async (body, params, radioCommit) => {
    const expected = CASES.reduce((n, c) => n + 2 * c.frames, 0) * 4
    if (body.length !== expected) throw new Error(`unexpected result size ${body.length}`)
    const delays = JSON.parse(params.get('delays'))
    writeFileSync(join(GOLDEN, 'dub-delay.in.f32'), inputBytes)
    writeFileSync(join(GOLDEN, 'dub-delay.out.f32'), body)
    const meta = {
      note:
        'written by sssketch scripts/golden-dub-delay.mjs: dub-delay.in.f32 (bursts A and B, each ' +
        `${BURST} frames, planar L then R: A.L, A.R, B.L, B.R) through ell.ing/radio src/audio/dubDelay.ts ` +
        'buildDubDelay, set() from throwDelaySec, in headless Chrome OfflineAudioContext; ' +
        'little-endian float32, each case planar (L then R), the cases one after another',
      burstFrames: BURST,
      cases: CASES.map((c, k) => ({ ...c, delaySec: delays[k] })),
      radioCommit,
      userAgent: params.get('ua')
    }
    writeFileSync(join(GOLDEN, 'dub-delay.json'), JSON.stringify(meta, null, 2) + '\n')
    console.log(
      `wrote dub-delay.in.f32, dub-delay.out.f32 (${body.length} bytes) and dub-delay.json`
    )
    console.log(params.get('ua'))
  }
})
