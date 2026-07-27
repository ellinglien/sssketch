export function Shelf(): React.JSX.Element {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="ra-eyebrow">shelf</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-4)' }}>
          drag one down into the arrangement · stems land linked and pre-aligned
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div
          style={{
            flex: 1,
            minWidth: 150,
            height: 78,
            border: '1px dashed var(--ra-border-strong)',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: 'var(--ra-text-3)',
            textAlign: 'center'
          }}
        >
          <div>drop rifff folders, or stems straight from endlesss</div>
          <div>copied into your rifff library</div>
        </div>
      </div>
    </div>
  )
}
