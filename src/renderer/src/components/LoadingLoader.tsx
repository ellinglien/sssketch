import { useEffect, useRef } from 'react'
// The "light" build, not the default `lottie-web` entry point — the full
// build includes After Effects expression support, which evaluates via
// `eval`/`new Function`, violating this app's CSP (script-src 'self', no
// unsafe-eval — see index.html). This animation doesn't use expressions, so
// the light build (SVG renderer, no expressions engine) covers it with no
// eval anywhere in the bundle.
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light'
import loaderData from '../assets/loading-loader.json'

/** A small looping shape-morph animation, used wherever the app needs a
 * generic "still working" indicator (currently just BeatPicker's re-one
 * loading state) — plain lottie-web, not react-lottie or similar, since the
 * whole API surface needed here is "mount it, loop it, tear it down." */
export function LoadingLoader({ size = 64 }: { size?: number }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  // React StrictMode (main.tsx) deliberately double-invokes every effect in
  // dev — mount, cleanup, mount again, synchronously, before the browser
  // paints — to surface exactly this class of bug: lottie-web's SVG
  // renderer doesn't reliably survive a destroy() immediately followed by a
  // fresh loadAnimation() on the same DOM node in the same synchronous
  // flush, and the surviving instance renders its first frame once and then
  // never ticks again (confirmed by direct observation: fully frozen, not
  // slow — ruling out the earlier "just too fast to notice" theory that
  // setSpeed(3) alone was chasing).
  //
  // An earlier fix tried to skip exactly the first of two invocations, but
  // that's fragile — it assumes StrictMode fires exactly twice and nothing
  // else ever remounts this component, and if that assumption is off by
  // one, it can eat the ONLY real invocation and never animate at all.
  // Deferring the actual loadAnimation() call to a macrotask sidesteps the
  // whole race instead of trying to count invocations: whichever
  // invocation's cleanup runs before its own timer fires never creates
  // anything, so a synchronous StrictMode phantom mount+cleanup cancels
  // itself out cleanly, however many times it happens to fire — while a
  // real, lasting mount's timer survives to actually create the animation,
  // in both dev and production alike (no import.meta.env.DEV branching
  // needed).
  useEffect(() => {
    if (!containerRef.current) return
    let anim: AnimationItem | null = null
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled || !containerRef.current) return
      anim = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: loaderData
      })
      // The source file's own full morph cycle is 90 frames at 30fps (3
      // seconds) — BeatPicker's loading state (decode + an STFT pass) often
      // resolves well before that, so speed it up for visible motion even
      // in a short loading window.
      anim.setSpeed(3)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      anim?.destroy()
      anim = null
    }
  }, [])

  return <div ref={containerRef} style={{ width: size, height: size }} />
}
