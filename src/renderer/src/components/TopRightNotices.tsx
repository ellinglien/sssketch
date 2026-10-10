/** The column the top-right notices stack in (engine startup, stems unavailable, plugins off and
 * held, a missing re-oned copy, the re-oned cleanup, re-ones that failed, save copy). Each used
 * to sit at its own fixed `top`, one row apart, so one that wrapped onto a second line (a long
 * ReoneNotice) ran into the next. Stacked here they push each other down and close up when one
 * goes. The column itself lets clicks through; each notice takes its own (pointerEvents). */
export function TopRightNotices({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        top: 40,
        right: 10,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 5,
        pointerEvents: 'none'
      }}
    >
      {children}
    </div>
  )
}
