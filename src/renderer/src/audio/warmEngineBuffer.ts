import {
  stretchRatioForStem,
  STRETCH_RATIO_EPSILON,
  type StretchResolver
} from '@shared/buildEngineProject'

/** Warms the NATIVE ENGINE's own decoded-buffer cache for the exact file a
 * later `load-project` will name, a whole change-interval before it is
 * needed.
 *
 * Why (2026-09-28). Elling, listening to radio: "strange.. it doesn't seem
 * to preload still.. it always takes a second for the new stem to play
 * after the loop ends" -- reported after two renderer-side prefetch fixes
 * had already landed and failed to move it. They failed because the
 * remaining cost is behind the IPC boundary: PlaybackEngine::setProject
 * reads, decodes and loop-sews every stem it is handed, synchronously, and
 * the new one is by definition the one that was never read before. There
 * was no way to tell the engine about a stem except by handing it a whole
 * project containing it, so that read always happened at the instant the
 * change committed.
 *
 * The one thing this function has to get right is WHICH file. `setProject`
 * loads `EngineStem.resolvedPath`, which is the rubberband-stretched file
 * whenever the stem's own native tempo differs from the project's -- so
 * warming `stem.path` for a stem that will be stretched warms a file
 * nothing ever loads and changes nothing at all. That is the exact shape of
 * the two attempts that did not work, which is why the ratio comes from
 * `stretchRatioForStem` and the pair handed to `preload` comes from the
 * resolver, rather than either being written out again here.
 *
 * Deliberately never rejects, and nothing awaits it in anger: a preload is
 * a hint. A failure leaves the engine exactly as cold as it is today --
 * `setProject` still loads every stem itself -- and must never be able to
 * delay the change it was meant to help. */
export async function warmEngineBuffer(
  stem: { path: string; durationSec: number; barLength: number },
  bpm: number,
  resolveStretched: StretchResolver,
  preload: (path: string, durationSec: number) => void
): Promise<void> {
  if (!stem.path) return
  try {
    const ratio = stretchRatioForStem(stem.durationSec, stem.barLength, bpm)
    if (Math.abs(ratio - 1) < STRETCH_RATIO_EPSILON) {
      // Exactly what buildEngineProject skips, so this skips it too: no
      // stretch is resolved, and resolvedPath stays the stem's own file.
      preload(stem.path, stem.durationSec)
      return
    }
    // Through the caller's resolver (the memoised one, in practice) rather
    // than a fresh render: by the time radio gets here that stretch has
    // usually already been warmed, so this is a settled promise and the
    // preload goes out immediately.
    const resolved = await resolveStretched(stem.path, ratio)
    preload(resolved.path, resolved.durationSec)
  } catch {
    // buildEngineProject catches a failed stretch per stem and falls back to
    // native-tempo playback for that one stem -- so on this path the native
    // file IS what setProject will ask for, and is the one worth warming.
    // Wrapped in its own try so a dead IPC channel here is still not an
    // error anyone needs to hear about.
    try {
      preload(stem.path, stem.durationSec)
    } catch {
      /* a preload is a hint; there is nothing useful to do with a failure */
    }
  }
}
