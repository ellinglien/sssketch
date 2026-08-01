/** A small "still working" indicator, used wherever the app needs a generic
 * loading state (currently just BeatPicker's re-one loading state).
 *
 * Previously a lottie-web shape-morph animation. Replaced after three
 * separate fix attempts (StrictMode-skip, then macrotask-deferred creation,
 * then confirming the deferred version's transformed output was correct)
 * all failed to resolve a real-world "frozen on one frame" report — rather
 * than attempt a fourth blind fix with no way to inspect the running app,
 * cut lottie-web loose entirely for a plain CSS spinner: a single dot
 * orbiting the container, no animation library, no SVG renderer, nothing
 * that can desync from a StrictMode double-invoke since there's no
 * imperative mount/teardown lifecycle to race in the first place. */
export function LoadingLoader({ size = 64 }: { size?: number }): React.JSX.Element {
  const dotSize = Math.max(4, Math.round(size * 0.14))
  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        animation: 'ra-spin 0.9s linear infinite'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: dotSize,
          height: dotSize,
          marginLeft: -dotSize / 2,
          borderRadius: '50%',
          background: 'var(--ra-text-2)'
        }}
      />
      <style>{`
        @keyframes ra-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
