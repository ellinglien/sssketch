// src/renderer/src/perf/radioTrace.ts
//
// TEMPORARY INSTRUMENTATION -- 2026-09-28. DELETE THIS FILE, and every
// radioTrace* call site in DiscoverPanel.tsx, once the radio stem-change
// latency numbers are in. It exists only to answer "which step of the
// change chain owns the time", after four prefetch fixes that were each
// correct and none of which was the cause.
//
// Shape follows src/renderer/src/perf/workCounters.ts: dev-only, off under
// vitest, a no-op in a packaged build, and the timing reads live in HERE
// rather than at the call sites -- DiscoverPanel is a component and
// react-compiler's purity rule rejects performance.now()/Date.now() inside
// a component-defined function (see pickForSlot's own comment on that).
//
// One line per change, so a paste is one line per change:
//
//   [radio-trace #3 wrap-due] late 0.104bar/107ms · commit +0.4 · render
//   +1.2 · resolved +38.1 · raf +7.0 · assembled +0.2 · built +2.4 ·
//   remote +0.9 · sent#12 +0.4 · acked +3.8 · chain 54.4ms · past
//   boundary 161.4ms
//
// `late` is the 30Hz detection floor: how far past the boundary the
// position tick that noticed it already was. `chain` is everything after
// detection, up to engineLoadProject's own resolve (which is main having
// written the socket, NOT the engine having acted -- the engine's own half
// is its `[radio-engine]` stderr line, paired by the `sent#N` number).

const enabled = import.meta.env.DEV && import.meta.env.MODE !== 'test'

/** How long a trace stays open collecting marks. Comfortably longer than
 * a warm chain and comfortably shorter than radio's fastest interval (3
 * bars, ~6s at 120bpm), so two changes can never share a line. */
const TRACE_WINDOW_MS = 1500

const BEATS_PER_BAR = 4

interface OpenTrace {
  seq: number
  label: string
  t0: number
  lateMs: number
  lateBars: number
  marks: Array<{ step: string; at: number }>
  timer: ReturnType<typeof setTimeout>
}

let lastTickAtMs = 0
let lastTickPos = 0
let seq = 0
let pushSeq = 0
let open: OpenTrace | null = null

/** Every position-update tick, before anything decides anything -- this is
 * the arrival time a change detected on this tick is measured from. */
export function radioTraceTick(pos: number): void {
  if (!enabled) return
  lastTickAtMs = performance.now()
  lastTickPos = pos
}

/** A change is committing NOW, for the boundary at `boundaryBars`. */
export function radioTraceBegin(boundaryBars: number, bpm: number, label: string): void {
  if (!enabled) return
  if (open) flush('superseded')
  const msPerBar = bpm > 0 ? (60 / bpm) * BEATS_PER_BAR * 1000 : 0
  const lateBars = Math.max(0, lastTickPos - boundaryBars)
  seq += 1
  open = {
    seq,
    label,
    t0: lastTickAtMs,
    lateBars,
    lateMs: lateBars * msPerBar,
    marks: [],
    timer: setTimeout(() => flush('window'), TRACE_WINDOW_MS)
  }
}

export function radioTraceMark(step: string): void {
  if (!enabled || !open) return
  open.marks.push({ step, at: performance.now() })
}

/** A load-project is going out. Numbered globally so the engine's own
 * per-load-project counter lines up with it. */
export function radioTraceMarkPush(): void {
  if (!enabled) return
  pushSeq += 1
  if (!open) {
    console.log(`[radio-trace] push #${pushSeq} outside any change`)
    return
  }
  open.marks.push({ step: `sent#${pushSeq}`, at: performance.now() })
}

function flush(reason: string): void {
  const t = open
  if (!t) return
  open = null
  clearTimeout(t.timer)
  let prev = t.t0
  const steps = t.marks.map(({ step, at }) => {
    const line = `${step} +${(at - prev).toFixed(1)}`
    prev = at
    return line
  })
  const chainMs = prev - t.t0
  console.log(
    `[radio-trace #${t.seq} ${t.label}] late ${t.lateBars.toFixed(3)}bar/${t.lateMs.toFixed(0)}ms` +
      (steps.length > 0 ? ` · ${steps.join(' · ')}` : ' · (no marks)') +
      ` · chain ${chainMs.toFixed(1)}ms · past boundary ${(t.lateMs + chainMs).toFixed(1)}ms` +
      (reason === 'superseded' ? ' · SUPERSEDED' : '')
  )
}

// --- the scheduled swap (2026-09-29) ---
//
// A staged change spans a whole lap -- seconds -- so it cannot ride the
// 1500ms open-trace window above: by the time the engine says it landed,
// that window has long since flushed. These are their own lines, paired by
// the token the renderer minted, and they are the measurement that says
// whether the staged path is actually doing the job:
//
//   [radio-stage #4 filter in] sent 2.51bar into an 8bar lap · 5.49 bars to
//   the wrap
//   [radio-stage #4] staged
//   [radio-stage #4] APPLIED via wrap at 0.0000bar · deferrals 0 · 10986ms
//   after the push
//
// `via wrap` with `atBars` exactly the loop start is the whole feature
// working. Anything else -- `immediate`, `deadline`, a `cancelled`, or no
// stage line at all for a change -- is a change that is still landing the
// old way, and the reason is printed with it.

const stageSentAtMs = new Map<number, number>()

export function radioTraceStageSent(
  token: number,
  label: string,
  pos: number,
  loopBars: number
): void {
  if (!enabled) return
  stageSentAtMs.set(token, performance.now())
  console.log(
    `[radio-stage #${token} ${label}] sent ${pos.toFixed(2)}bar into a ${loopBars}bar lap · ` +
      `${(loopBars - pos).toFixed(2)} bars to the wrap`
  )
}

export function radioTraceStageResult(token: number, status: string, reason?: string): void {
  if (!enabled) return
  console.log(`[radio-stage #${token}] ${status}${reason ? ` (${reason})` : ''}`)
  if (status === 'cancelled' || status === 'error') stageSentAtMs.delete(token)
}

export function radioTraceStageApplied(
  token: number,
  via: string,
  atBars: number,
  deferrals: number
): void {
  if (!enabled) return
  const sentAt = stageSentAtMs.get(token)
  stageSentAtMs.delete(token)
  console.log(
    `[radio-stage #${token}] APPLIED via ${via} at ${atBars.toFixed(4)}bar · ` +
      `deferrals ${deferrals}` +
      (sentAt !== undefined ? ` · ${(performance.now() - sentAt).toFixed(0)}ms after the push` : '')
  )
}

/** A change that could have been staged and will now land the old way.
 * The one line to grep for when a measurement says some changes are still
 * late -- it names which, and why. */
export function radioTraceStageFallback(token: number | null, reason: string): void {
  if (!enabled) return
  console.log(
    `[radio-stage${token === null ? '' : ` #${token}`}] withdrawn (${reason})` +
      ' -- this change falls back to load-project'
  )
  if (token !== null) stageSentAtMs.delete(token)
}

// Why the scheduled swap is NOT staging right now, logged only when the
// answer changes. Added 2026-09-29 after two changes were staged at 15.99
// of a 16-bar lap -- too late for that wrap -- with no line saying what had
// held them for the fifteen bars before. One word per gate, so a paste
// reads as a timeline:
//
//   [radio-gate] 0.04bar gesture:bloom
//   [radio-gate] 0.06bar no-pending
//   [radio-gate] 3.20bar not-this-lap
//   [radio-gate] 15.99bar decide
let lastGate = ''

export function radioTraceStageGate(gate: string, pos: number): void {
  if (!enabled) return
  if (gate === lastGate) return
  lastGate = gate
  console.log(`[radio-gate] ${pos.toFixed(2)}bar ${gate}`)
}
