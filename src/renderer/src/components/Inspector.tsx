export function Inspector(): React.JSX.Element {
  return (
    <div
      style={{
        width: 308,
        flexShrink: 0,
        background: 'var(--ra-bg-bar)',
        borderLeft: '1px solid var(--ra-border)'
      }}
    >
      <div style={{ padding: '12px 14px' }}>
        <span className="ra-eyebrow">inspector</span>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--ra-text-3)' }}>
          select a rifff block to inspect it
        </div>
      </div>
    </div>
  )
}
