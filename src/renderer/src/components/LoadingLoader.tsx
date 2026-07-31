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

  useEffect(() => {
    if (!containerRef.current) return
    let anim: AnimationItem | null = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: loaderData
    })
    return () => {
      anim?.destroy()
      anim = null
    }
  }, [])

  return <div ref={containerRef} style={{ width: size, height: size }} />
}
