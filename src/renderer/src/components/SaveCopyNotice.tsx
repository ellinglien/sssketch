import { dismissSaveCopyNotice, useSaveCopyNotice } from '../state/saveCopyNotice'

/** Says which file you're in after "save as a new version" or "save a copy to a file…"
 * (state/saveCopyNotice.ts). One row below ReoneNotice, styled like the other notices; it
 * goes by itself after a few seconds, or on a click. */
export function SaveCopyNotice(): React.JSX.Element | null {
  const line = useSaveCopyNotice()
  if (line === null) return null
  return (
    <button
      role="status"
      onClick={dismissSaveCopyNotice}
      title="dismiss"
      style={{
        position: 'fixed',
        top: 240,
        right: 10,
        zIndex: 2000,
        maxWidth: 420,
        padding: '5px 10px',
        fontFamily: 'inherit',
        textAlign: 'left',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        color: 'var(--ra-text-2)',
        cursor: 'pointer'
      }}
    >
      {line}
    </button>
  )
}
