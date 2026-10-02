// src/renderer/src/components/LoopFolderPane.tsx
import type { LoopFolderListing } from '@shared/loopFolderTypes'

/** The right-hand pane for a linked loop folder. */
export function LoopFolderPane({ folder }: { folder: LoopFolderListing }): React.JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ margin: '10px 12px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--ra-text)' }}>{folder.name}</span>
          <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
            {folder.available ? `${folder.loops.length} loops` : 'unavailable'}
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--ra-text-3)', marginTop: 2 }}>
          {folder.rootPath}
        </div>
      </div>
      {!folder.available && (
        <div style={{ fontSize: 11, color: 'var(--ra-text-3)', margin: 12 }}>
          folder not found — plug its drive back in, then rescan
        </div>
      )}
    </div>
  )
}
