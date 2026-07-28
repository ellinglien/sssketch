const PPB = 24
const BARS = 32
const LANE_HEADER_WIDTH = 212

export function Ruler(): React.JSX.Element {
  const bars = Array.from({ length: BARS }, (_, i) => i + 1)
  return (
    <div
      style={{
        height: 24,
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)',
        display: 'flex'
      }}
    >
      <div style={{ width: LANE_HEADER_WIDTH, flexShrink: 0 }} />
      <div style={{ position: 'relative', width: BARS * PPB }}>
        {bars.map((bar) => (
          <div
            key={bar}
            style={{
              position: 'absolute',
              left: (bar - 1) * PPB,
              top: 0,
              bottom: 0,
              borderLeft: `1px solid ${(bar - 1) % 4 === 0 ? 'var(--ra-border)' : 'var(--ra-grid-minor)'}`
            }}
          >
            {(bar - 1) % 8 === 0 && (
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', paddingLeft: 3 }}>{bar}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export { PPB, BARS, LANE_HEADER_WIDTH }
