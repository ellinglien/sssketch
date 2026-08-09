import { riffCircleColor } from '../theme/riffCircleColor'

/** One riff's preview circle -- shared between the shared-feed and
 * private-jams tabs so both get the same click/pulse/imported-badge
 * behavior for free rather than reimplementing it twice. `playing` drives
 * the fade-in/out brightness pulse (reuses RifffBlockRow.tsx's own
 * `ra-rec-pulse` keyframe by name -- duplicate `@keyframes` declarations
 * with identical rules are harmless, so this file mounts its own copy via
 * <style> rather than depending on that component happening to have
 * mounted first). onClick receives the raw MouseEvent (not just a plain
 * callback) so the CALLER can read shiftKey/metaKey/ctrlKey for
 * shift/cmd-click multi-select -- see EndlesssLibraryBrowser's own
 * handleRiffClick, mirroring LoreLibraryBrowser.tsx's identical pattern. A
 * plain click toggles: selecting the already-selected riff calls onClick
 * with the same riffCID again, and the caller turns that into a deselect. */
export function RiffCircle({
  title,
  selected,
  multiSelected,
  playing,
  fullyCached,
  imported,
  ownerFraction,
  favorited,
  onClick,
  onContextMenu
}: {
  title: string
  selected: boolean
  /** In the batch (shift/cmd-click) selection but NOT the anchor -- gets
   * its own, weaker ring than `selected`'s. See handleRiffClick. */
  multiSelected: boolean
  playing: boolean
  fullyCached: boolean
  imported: boolean
  /** 0-1, drives brightness the same way LORE's own riff circles do -- see
   * riffCircleColor. Endlesss-direct listings don't always have this at
   * list time (only the shared-feed path does, since its listing response
   * embeds full stem docs; the private-jam path fills it in progressively
   * as riffs get resolved/prefetched -- see jamOwnerFractions). */
  ownerFraction: number
  /** Right-click toggled, persisted independently of source (see
   * riffFavourites.ts) -- overrides the ownerFraction grayscale fill with
   * solid purple when true. */
  favorited: boolean
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div style={{ position: 'relative', width: 18, height: 18 }}>
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={title}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          // Same cue hierarchy as LoreLibraryBrowser's own riff circles:
          // anchor selection ring, then batch-selection ring, then "not
          // everything's downloaded yet" (dashed), else a plain solid
          // border -- see downloadMissingStemsFor, already wired to fetch
          // whatever's missing the moment a riff is selected, so showing
          // the circle before it's fully cached is safe.
          border: selected
            ? '2px solid var(--ra-playhead)'
            : multiSelected
              ? '2px solid var(--ra-stretch-on)'
              : fullyCached
                ? '1px solid var(--ra-border)'
                : '1px dashed var(--ra-text-3)',
          padding: 0,
          background: favorited ? 'var(--ra-recording-live)' : riffCircleColor(ownerFraction),
          cursor: 'pointer',
          animation: playing ? 'ra-rec-pulse 1.4s ease-in-out infinite' : undefined
        }}
      />
      {imported && (
        <span
          title="already imported"
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--ra-stretch-on)',
            border: '1px solid var(--ra-bg-bar)',
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  )
}
