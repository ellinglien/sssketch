/** A small "still working" indicator, used wherever the app needs a generic
 * loading state (BeatPicker's re-one loading state, BusyOverlay). Four bars
 * bouncing in sequence — plain CSS background-position animation, no
 * animation library or SVG, matching the previous single-dot-orbit
 * spinner's own "nothing that can desync from a StrictMode double-invoke"
 * rationale (see git history for that spinner's account of why lottie-web
 * was cut loose — this one inherits the same reasoning, just a different
 * shape).
 *
 * `size` is interpreted as the loader's overall width; height and bar
 * thickness scale proportionally off the reference 60×9px/3px design, so
 * existing call sites (size=64, size=40) keep working unchanged. */
export function LoadingLoader({ size = 64 }: { size?: number }): React.JSX.Element {
  const height = Math.max(2, Math.round(size * (9 / 60)))
  const barThickness = Math.max(1, Math.round(size * (3 / 60)))
  const bar = 'no-repeat linear-gradient(var(--ra-text-2) 0 0)'
  return (
    <div
      style={{
        height,
        width: size,
        background: `${bar}, ${bar}, ${bar}, ${bar}`,
        backgroundSize: `26% ${barThickness}px`,
        animation: 'ra-loader-bounce 1s infinite'
      }}
    >
      <style>{`
        @keyframes ra-loader-bounce {
          0%, 70%, 100% { background-position: calc(0*100%/3) 50%, calc(1*100%/3) 50%, calc(2*100%/3) 50%, calc(3*100%/3) 50%; }
          23.33% { background-position: calc(0*100%/3) 0, calc(1*100%/3) 100%, calc(2*100%/3) 0, calc(3*100%/3) 100%; }
          46.67% { background-position: calc(1*100%/3) 0, calc(0*100%/3) 100%, calc(3*100%/3) 0, calc(2*100%/3) 100%; }
          69.99% { background-position: calc(1*100%/3) 50%, calc(0*100%/3) 50%, calc(3*100%/3) 50%, calc(2*100%/3) 50%; }
        }
      `}</style>
    </div>
  )
}
