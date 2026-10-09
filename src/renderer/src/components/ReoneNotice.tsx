import { dismissReoneNotice, useReoneNotice } from '../state/reoneNotice'

/** Riffs a re-one couldn't reach: a batch import's other riffs whose bake failed, or a riff's
 * late-downloaded stems that couldn't be baked to its rotation (state/reoneNotice.ts). A
 * persistent pill, one line per failure, until clicked away. One row below ReonedCopiesNotice,
 * styled like the other notices. */
export function ReoneNotice(): React.JSX.Element | null {
  const lines = useReoneNotice()
  if (lines.length === 0) return null
  return (
    <button
      role="status"
      onClick={dismissReoneNotice}
      title="dismiss"
      style={{
        position: 'fixed',
        top: 212,
        right: 10,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        maxWidth: 420,
        padding: '5px 10px',
        fontFamily: 'inherit',
        textAlign: 'left',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        color: 'var(--ra-text-3)',
        cursor: 'pointer'
      }}
    >
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </button>
  )
}
