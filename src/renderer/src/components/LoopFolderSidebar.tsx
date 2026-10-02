// src/renderer/src/components/LoopFolderSidebar.tsx
import { useState } from 'react'
import type { LinkLoopFolderRefusal, LoopFolderListing } from '@shared/loopFolderTypes'
import { ContextMenu } from './ContextMenu'
import { LoadingLoader } from './LoadingLoader'

const SMALL_BUTTON: React.CSSProperties = {
  height: 20,
  padding: '0 6px',
  fontSize: 10,
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)',
  border: '1px solid var(--ra-border)',
  borderRadius: 0,
  cursor: 'pointer'
}

/** The linked loop folders, at the top of IMPORT's jam sidebar. A folder
 * whose drive is unplugged stays listed, greyed, until it is back. Unlink
 * is on right-click, as "remove from sync" is for a jam. */
export function LoopFolderSidebar({
  folders,
  scanning,
  linkRefusal,
  selectedRootPath,
  onSelect,
  onLink,
  onRescan,
  onUnlink
}: {
  folders: LoopFolderListing[]
  scanning: boolean
  linkRefusal: LinkLoopFolderRefusal | null
  selectedRootPath: string | null
  onSelect: (rootPath: string) => void
  onLink: () => Promise<void>
  onRescan: () => Promise<void>
  onUnlink: (rootPath: string) => Promise<void>
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; rootPath: string } | null>(null)

  return (
    <div style={{ borderBottom: '1px solid var(--ra-border)', padding: '6px 0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px 4px' }}>
        <span className="ra-eyebrow" style={{ flex: 1 }}>
          loops
        </span>
        {scanning && <LoadingLoader size={10} />}
        <button onClick={() => void onLink()} data-tooltip="link a folder" style={SMALL_BUTTON}>
          + folder
        </button>
        {folders.length > 0 && (
          <button
            onClick={() => void onRescan()}
            disabled={scanning}
            data-tooltip="check for changes"
            style={{ ...SMALL_BUTTON, color: scanning ? 'var(--ra-text-4)' : 'var(--ra-text-2)' }}
          >
            rescan
          </button>
        )}
      </div>
      {linkRefusal && (
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', padding: '0 6px 4px' }}>
          {linkRefusal}
        </div>
      )}
      {folders.map((folder) => {
        const selected = folder.rootPath === selectedRootPath
        return (
          <button
            key={folder.rootPath}
            onClick={() => onSelect(folder.rootPath)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, rootPath: folder.rootPath })
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              textAlign: 'left',
              padding: '5px 6px',
              fontSize: 11,
              border: 'none',
              borderRadius: 0,
              background: selected ? 'var(--ra-bg-row-active)' : 'transparent',
              color: !folder.available
                ? 'var(--ra-text-4)'
                : selected
                  ? 'var(--ra-text)'
                  : 'var(--ra-text-2)'
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
              {folder.name}
            </span>
            {folder.available && (
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', flexShrink: 0 }}>
                {folder.loops.length}
              </span>
            )}
          </button>
        )
      })}
      {/* Inside the modal's own stacking context, like LibraryBrowser's jam
          menu -- rendered as a sibling of the modal it would sit behind it. */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[{ label: 'unlink folder', onClick: () => void onUnlink(menu.rootPath) }]}
        />
      )}
    </div>
  )
}
