// No self-owned bottom border — App.tsx's Frame wraps this together with ProjectMenu
// in one row and owns the border there instead, so it spans the full row width under
// both rather than stopping partway. A standalone reuse of Titlebar elsewhere would
// need to supply its own border.
export function Titlebar({
  rifffCount,
  stemCount
}: {
  rifffCount: number
  stemCount: number
}): React.JSX.Element {
  return (
    <div
      style={{
        height: 38,
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>rifff arranger</span>
        <span style={{ color: 'var(--ra-text-4)' }}>|</span>
        <span style={{ color: 'var(--ra-text-2)' }}>untitled sketch 04</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
        {rifffCount} rifffs · {stemCount} stems imported
      </div>
    </div>
  )
}
