/**
 * The first-run welcome tour's copy and anchors.
 *
 * Plain data, in shared rather than next to TourOverlay.tsx, for the same
 * reason coachLines.ts/coachScript.ts live here: copy is the part of a UI
 * that quietly goes stale, and the only way to hold it to the app's own
 * rules (lowercase, no emoji, no exclamation marks -- tokens.css) is to put
 * it somewhere a unit test can reach without mounting React. See
 * ./tourSteps.test.ts.
 *
 * This is the APP's voice, not sssketchy's. His lines live in coachScript.ts
 * and never mix with these.
 */

export interface TourStep {
  /** CSS selector for the element to spotlight -- looked up fresh on every
   * step change/resize/scroll rather than passed as a ref, since targets
   * live in several different, unrelated components (Shelf, ProjectMenu,
   * Titlebar, Ruler, a timeline clip) with no shared parent worth threading
   * refs through.
   *
   * Every one of these must be MOUNTED for the whole tour, not just present
   * somewhere in the app: App.tsx's startTour forces arranger mode 'normal'
   * and mapView off, and imports+places a demo rifff, precisely so the
   * timeline, the ruler and a clip all exist while the tour runs. */
  selector: string
  title: string
  body: string
}

/**
 * Ordered the way a new user actually meets the app, not the order the steps
 * were written:
 *
 * 1. get audio in -- nothing else is reachable without it.
 * 2-3. the gear menu, which is the fastest path to a finished track:
 *      auto-arrange (which then hands over to sssketchy, who teaches
 *      sections/tension/risers himself, so this step only points at the
 *      door) and tidy up (where a stem's role is actually confirmed). Both
 *      live behind the same button, so they sit next to each other and the
 *      spotlight stays put across the pair.
 * 4. the map -- the second view of the arrangement, and undiscoverable
 *    otherwise.
 * 5-7. the fiddly manual things, last: clips, zoom, modes.
 *
 * Seven is the ceiling. A first-run tour that enumerates every feature
 * teaches nothing -- risers, the sound toolkit and the phrase report are
 * deliberately NOT here; they are contextual and introduce themselves.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    selector: '[data-tour-id="tour-import"]',
    title: 'getting audio in',
    body: 'drag a rifff folder onto the shelf, or click import to browse Endlesss directly.'
  },
  // These two share one anchor ON PURPOSE, and it is not a mistake to fix by
  // inventing a second attribute: auto-arrange and tidy up are both entries
  // in the ONE gear menu (App.tsx's ProjectMenu), and that menu is closed
  // while the tour runs, so its items have no DOM element of their own to
  // point at. The gear button is the only thing on screen either step can
  // honestly highlight -- hence also why they are adjacent, so the spotlight
  // sits still across the pair instead of jumping away and back.
  {
    selector: '[data-tour-id="tour-tidy"]',
    title: 'building an arrangement',
    body: 'auto-arrange is in this menu; it can build a whole track for you, or walk you through making one.'
  },
  {
    selector: '[data-tour-id="tour-tidy"]',
    title: 'labeling stems',
    body: 'tidy up is where you say what each stem is, for this sketch or your whole library.'
  },
  {
    selector: '[data-tour-id="tour-map"]',
    title: 'the map',
    body: 'this button swaps the timeline for the map: rows and sections, one cell per pass of the loop.'
  },
  // One step, not the two it used to be ("the timeline" and "muting clips"),
  // which spotlighted the same clip back to back -- the second was a step that
  // moved nothing on screen. Anchored on the clip's waveform body rather than
  // on its name bar (RifffBlockRow's own [data-rifff-clip]) because that is
  // where both the crop handles and the right-click-to-mute target actually
  // are; the drag-to-move handle is the name bar immediately above it, inside
  // the same clip.
  {
    selector: '[data-tour-id="tour-mute"]',
    title: 'clips',
    body: 'drag a clip to move it, drag its edges to crop, right-click to mute it.'
  },
  {
    selector: '[data-tour-id="tour-zoom"]',
    title: 'zooming in',
    body: 'hold cmd and scroll to zoom the timeline in and out.'
  },
  {
    selector: '[data-tour-id="tour-mode"]',
    title: 'arrange, sketch, automation',
    body: 'this button cycles modes: arrange is the timeline, sketch is a rough layout, automation draws curves.'
  }
]
