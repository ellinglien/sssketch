// src/renderer/src/components/LoopLines.tsx
//
// Vertical loop markers over a tiled waveform. One component, so the
// arrange view and Discover cannot drift apart (Elling, 2026-09-29: "the
// loop points should be displayed clearly, like in arrange.. lines between
// each loop"). Monochrome and non-interactive.

/** `restart`: the stem starting over -- arrange's long-standing line.
 * `loopTop`: the whole loop wrapping -- a step stronger, because that is
 * where changes land. */
const LINE_COLOR: Record<'restart' | 'loopTop', string> = {
  restart: 'color-mix(in srgb, var(--ra-text) 35%, transparent)',
  loopTop: 'color-mix(in srgb, var(--ra-text) 70%, transparent)'
}

export function LoopLines({
  lefts,
  kind
}: {
  /** CSS `left` values -- `'40px'` or `'12.5%'`. */
  lefts: readonly string[]
  kind: 'restart' | 'loopTop'
}): React.JSX.Element {
  return (
    <>
      {lefts.map((left, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left,
            width: 1,
            background: LINE_COLOR[kind],
            pointerEvents: 'none'
          }}
        />
      ))}
    </>
  )
}
