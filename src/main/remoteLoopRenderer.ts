// src/main/remoteLoopRenderer.ts
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { EngineProject } from '@shared/buildEngineProject'
import { phoneLoopFingerprint, phoneLoopProject } from '@shared/phoneLoop'
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'

/** A Discover loop is 1, 2, 4 or 8 bars, set by the longest resolved stem.
 * This ceiling is not expected to bind; it exists so a malformed
 * loopLengthBars cannot ask the engine for a gigabyte. 32 bars at 120bpm is
 * 64 seconds, which is 11.3 MB at 44100/2/16. */
export const PHONE_LOOP_MAX_BARS = 32

/** NOT nativeExport's ten minutes. A full arrangement export can legitimately
 * take that long; somebody standing in another room holding a phone cannot.
 * Ten minutes here would be a hang, not a timeout. */
export const PHONE_LOOP_RENDER_TIMEOUT_MS = 30_000

export interface RenderedLoop {
  /** 16 hex characters. The only thing about the loop that ever leaves the
   * Mac -- the phone compares it against what it is playing. */
  id: string
  bytes: Buffer
}

export interface RemoteLoopRenderer {
  /** The id of the loop currently held, or null. Injected into GET
   * /api/state's answer as `loopId`. */
  currentLoopId(): string | null
  /** Replace the held loop with what Discover is previewing, or clear it. */
  setLoop(project: EngineProject | null): void
  /** The held loop's wav bytes, rendering if they are not cached. Null when
   * nothing is held. Rejects when the render fails twice. */
  wav(): Promise<RenderedLoop | null>
  stop(): void
}

interface EngineSession {
  handle: EngineHandle
  client: EngineClient
}

/** The 16-character id the phone sees, derived from the project as the phone
 * will actually hear it. See phoneLoopFingerprint for the two properties that
 * make this stable across Discover's constant rebuilds. */
export function loopIdFor(phoneProject: EngineProject): string {
  return createHash('sha256').update(phoneLoopFingerprint(phoneProject)).digest('hex').slice(0, 16)
}

async function openEngine(binaryPathOverride?: string): Promise<EngineSession> {
  const handle = await spawnEngine(binaryPathOverride ? { binaryPathOverride } : {})
  const client = new EngineClient()
  await client.connect(handle.port)
  return { handle, client }
}

/**
 * The phone remote's own render engine and its one-loop cache.
 *
 * ONE WARM ENGINE, held for as long as the phone remote is switched on.
 * Measured from real CI logs, nativeExport.test.ts's render tests take
 * 1.2-3.7s each and every one of them SPAWNS a fresh engine; a few bars of
 * offline render is far faster than realtime, so the spawn is essentially the
 * whole number. Spawning per roll would put one to three seconds between
 * tapping and hearing, which would ruin the roll/keep loop this exists for.
 *
 * It is a SEPARATE engine from playbackEngineLifecycle.ts's, which is busy
 * playing -- a render-export on that one would clobber whatever is loaded, as
 * its own doc comment says. Four other modules (nativeExport,
 * exportToolkitAudio, exportAudioMaterialization, bakeOffset) already spawn
 * their own engine alongside it, so this is a pattern, not a new idea.
 *
 * The spawn is kicked off here and NOT awaited: READINESS_TIMEOUT_MS is 45s
 * for documented cold-start reasons, and the gear menu must not sit on it.
 */
export function createRemoteLoopRenderer(
  options: { binaryPathOverride?: string } = {}
): RemoteLoopRenderer {
  const dir = join(app.getPath('temp'), 'sssketch-phone-loop')
  // Sweep anything a previous crash left behind.
  rmSync(dir, { recursive: true, force: true })

  let held: { id: string; project: EngineProject } | null = null
  let cached: RenderedLoop | null = null
  let inFlight: { id: string; promise: Promise<Buffer> } | null = null
  let session: Promise<EngineSession> | null = null
  let stopped = false

  function engine(): Promise<EngineSession> {
    if (session === null) {
      const opening = openEngine(options.binaryPathOverride)
      session = opening
      // Reset on failure so the next render tries again rather than awaiting
      // a permanently rejected promise. The local `opening` is what is
      // returned and what is stored -- attaching the catch to `session`
      // directly would still be fine, but this makes it impossible to
      // accidentally store the catch's own (resolved) promise instead.
      void opening.catch(() => {
        if (session === opening) session = null
      })
    }
    return session
  }

  function dropEngine(): void {
    const dying = session
    session = null
    if (dying === null) return
    void dying
      .then(({ handle, client }) => {
        client.disconnect()
        handle.stop()
      })
      .catch(() => {})
  }

  async function renderOnce(id: string, project: EngineProject): Promise<Buffer> {
    const { client } = await engine()
    mkdirSync(dir, { recursive: true })
    const outputPath = join(dir, `${id}.wav`)
    const durationBars = Math.min(PHONE_LOOP_MAX_BARS, Math.max(1, project.loopLengthBars))
    try {
      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath, durationBars },
        'render-export-result',
        PHONE_LOOP_RENDER_TIMEOUT_MS
      )) as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'unknown error')
      return readFileSync(outputPath)
    } finally {
      // The cache holds BYTES, not a path. Nothing this route serves is ever
      // read off disk, and no temp file outlives the render that made it --
      // a failed render's partial file goes the same way.
      rmSync(outputPath, { force: true })
    }
  }

  async function wav(): Promise<RenderedLoop | null> {
    const loop = held
    if (loop === null || stopped) return null
    if (cached !== null && cached.id === loop.id) return cached
    if (inFlight !== null && inFlight.id === loop.id) {
      return { id: loop.id, bytes: await inFlight.promise }
    }
    const promise = (async (): Promise<Buffer> => {
      try {
        return await renderOnce(loop.id, loop.project)
      } catch (first) {
        // One retry, with a fresh engine. The realistic failure is a held
        // engine that died or a socket that closed under us. A second
        // failure is answered as 503 by the route; it does not retry in a
        // loop and it does not take the remote server down.
        console.error('remoteLoopRenderer: render failed, respawning once:', first)
        dropEngine()
        return await renderOnce(loop.id, loop.project)
      }
    })()
    inFlight = { id: loop.id, promise }
    try {
      const bytes = await promise
      const rendered: RenderedLoop = { id: loop.id, bytes }
      if (!stopped) cached = rendered
      return rendered
    } finally {
      if (inFlight !== null && inFlight.promise === promise) inFlight = null
    }
  }

  // Warm it up now, so the first roll he listens to is not the one that pays
  // for the spawn.
  void engine().catch((error) => {
    console.error('remoteLoopRenderer: engine spawn failed:', error)
  })

  return {
    currentLoopId: (): string | null => held?.id ?? null,
    setLoop: (project: EngineProject | null): void => {
      if (project === null) {
        held = null
        cached = null
        return
      }
      const forPhone = phoneLoopProject(project)
      const id = loopIdFor(forPhone)
      // Discover rebuilds its preview project constantly, with a fresh
      // groupId every time. An unchanged loop must not invalidate the cache.
      if (held !== null && held.id === id) return
      held = { id, project: forPhone }
      cached = null
    },
    wav,
    stop: (): void => {
      stopped = true
      held = null
      cached = null
      inFlight = null
      dropEngine()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
