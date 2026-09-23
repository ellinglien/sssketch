/**
 * The two doors into the riff library, and which half each one opens on.
 *
 * The library browser used to be one door (the shelf's `import` button) with a
 * browse/discover tab pair inside its header. Direct request, 2026-09-23: "i
 * think they should be distinct buttons instead of tabs" -- so the shelf now
 * has one button per half and the tabs are gone. What survived that change is
 * exactly one piece of real logic -- which door maps to which half, and what
 * the header should then call the half it is showing -- which lives here
 * rather than inline in Shelf.tsx/App.tsx so it can be tested without mounting
 * React (this codebase doesn't unit-test components; see CLAUDE.md).
 *
 * Note the deliberate name mismatch: the modes are still `browse`/`discover`
 * internally (LibraryBrowser's own state, unchanged -- seeding Discover from a
 * browsed riff still flips it), but the door and the header both say `import`,
 * because that is the word the app's author uses for it and the word on the
 * button the user pressed to get there. `libraryModeLabel` is the one place
 * that translation happens.
 */

/** LibraryBrowser's own internal state: which half is on screen. */
export type LibraryMode = 'browse' | 'discover'

/** A door into that browser -- one shelf button each. */
export type LibraryEntryPoint = 'import' | 'discover'

export interface LibraryEntryPointDef {
  id: LibraryEntryPoint
  /** The shelf button's own copy. Lowercase, like all UI copy here. */
  label: string
  /** Hover copy. Two or three words, the rule every tooltip in this app
   * follows -- see global.css's own note on tooltip length. */
  tooltip: string
  /** The half of the browser this door opens on. */
  mode: LibraryMode
}

/**
 * In shelf order, left to right: import first (nothing else is reachable
 * without audio), discover second.
 */
export const LIBRARY_ENTRY_POINTS: readonly LibraryEntryPointDef[] = [
  { id: 'import', label: 'import', tooltip: 'browse your jams', mode: 'browse' },
  { id: 'discover', label: 'discover', tooltip: 'build a loop', mode: 'discover' }
]

/** Which half of the browser a given door opens on. */
export function libraryModeForEntryPoint(entry: LibraryEntryPoint): LibraryMode {
  return entry === 'discover' ? 'discover' : 'browse'
}

/**
 * What the browser's header eyebrow calls the half it is currently showing.
 *
 * With the tab pair gone, this eyebrow is the only thing on screen that says
 * which half you are in, so it has to agree with the button you pressed --
 * hence `browse` reading back out as "import".
 */
export function libraryModeLabel(mode: LibraryMode): string {
  return mode === 'discover' ? 'discover' : 'import'
}
