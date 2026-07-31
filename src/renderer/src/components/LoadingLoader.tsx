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
  // dev ONLY — mount, cleanup, mount again — to surface exactly this class
  // of bug; production builds run the effect once. lottie-web's SVG
  // renderer doesn't reliably survive a destroy() immediately followed by a
  // fresh loadAnimation() on the same DOM node in the same synchronous
  // flush: the surviving instance renders its first frame once and then
  // never ticks again, which reads as a fully frozen spinner (not a slow
  // one — confirmed by direct observation, ruling out the earlier, wrong
  // "just too fast to notice" theory that setSpeed(3) was chasing).
  // Skipping the throwaway first invocation avoids the destroy+recreate
  // race entirely. Gated on DEV so production — which never double-invokes
  // — doesn't skip its only real invocation and end up never animating at
  // all.
  const skippedPhantomRunRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return
    if (import.meta.env.DEV && !skippedPhantomRunRef.current) {
      skippedPhantomRunRef.current = true
      return undefined
    }
    let anim: AnimationItem | null = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: loaderData
    })
    // The source file's own full morph cycle is 90 frames at 30fps (3
    // seconds) — BeatPicker's loading state (decode + an STFT pass) often
    // resolves well before that, so speed it up for visible motion even in
    // a short loading window.
    anim.setSpeed(3)
    return () => {
      anim?.destroy()
      anim = null
    }
  }, [])

  return <div ref={containerRef} style={{ width: size, height: size }} />
}
