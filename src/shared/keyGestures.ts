/**
 * Every keyboard shortcut and mouse gesture in the app, as data.
 *
 * This list exists because a copy pass cut every tooltip in the renderer
 * down to two or three words (2026-09-23), and a good number of gestures --
 * option+drag to stretch, ctrl+right-click to solo, the whole ruler -- had
 * no documentation anywhere else. They live here now, and the settings
 * menu's "keys and gestures…" entry renders them.
 *
 * Plain data, in shared rather than next to the modal, for the same reason
 * tourSteps.ts and coachScript.ts are: copy goes stale silently, and the
 * only way to hold it to the app's own rules (lowercase, no emoji, no
 * exclamation marks -- tokens.css) is to put it somewhere a unit test can
 * reach without mounting React. See ./keyGestures.test.ts.
 *
 * This is the APP's voice, not sssketchy's -- his lines live in
 * coachScript.ts and never mix with these.
 *
 * Every line below was checked against a real handler rather than against
 * the tooltip it replaced, because two of the tooltips were already wrong
 * about their own behaviour by the time they were cut. Where the handler
 * turned out to be narrower than the tooltip claimed (option+drag stretches
 * a ONE-SHOT's edge, not every clip's; escape closes a riser's own sweep
 * lane, not one opened by the transport bar's automation toggle), the
 * narrower thing is what is written here.
 */

export interface KeyGesture {
  /** The key or the gesture itself, e.g. `cmd+s` or `option+drag an edge`. */
  keys: string
  /** What it does, as a phrase that completes "this…". No trailing period. */
  does: string
}

export interface KeyGestureGroup {
  /** Rendered as an eyebrow above its rows. */
  area: string
  gestures: readonly KeyGesture[]
}

export const KEY_GESTURES: readonly KeyGestureGroup[] = [
  {
    area: 'transport and timeline',
    gestures: [
      { keys: 'space', does: 'play or pause' },
      { keys: 'tab', does: 'cycle the arrange, sketch and map views' },
      { keys: 'cmd+s', does: 'save' },
      { keys: 'cmd+z', does: 'undo' },
      { keys: 'cmd+shift+z', does: 'redo' },
      { keys: 'cmd+0', does: 'back to the default zoom' },
      { keys: 'cmd+scroll', does: 'zoom the timeline' },
      { keys: 'cmd+drag empty space', does: 'pan the view' },
      { keys: 'click empty space', does: 'move the playhead' },
      // The ruler owns four of its own gestures and they are all
      // modifier-free, so they need saying together rather than folded in
      // among the timeline's.
      { keys: 'ruler: click', does: 'move the playhead' },
      { keys: 'ruler: drag', does: 'set a loop region' },
      { keys: 'ruler: cmd+drag', does: 'move the playhead instead' },
      { keys: 'ruler: drag an edge', does: 'move the loop start or end' },
      { keys: 'ruler: double-click', does: 'clear the loop region' },
      { keys: '/', does: 'add a recording channel' },
      { keys: '\\', does: 'start a gated pass, or lock in the one running' }
    ]
  },
  {
    area: 'clips',
    gestures: [
      { keys: 'drag', does: 'move a clip' },
      { keys: 'cmd+drag', does: 'drop a copy instead of moving' },
      { keys: 'drag an edge', does: 'trim the loop length' },
      { keys: 'option+drag an edge', does: 'stretch a one-shot rather than trim it' },
      { keys: 'click', does: 'move the playhead there' },
      { keys: 'drag across a clip', does: 'select a region' },
      { keys: 'delete, with a region selected', does: 'mute it, or unmute an already muted one' },
      { keys: 'esc', does: 'drop the region selection' },
      { keys: 'delete, with a clip selected', does: 'take it off the timeline' },
      { keys: 'right-click a stem', does: 'mute that stem' },
      { keys: 'right-click a collapsed clip', does: 'mute the whole group' },
      { keys: 'ctrl+right-click', does: 'solo the group' },
      { keys: 'double-click a waveform', does: 'reset that stem to its starting volume' },
      { keys: 'click the name bar', does: 'expand or collapse' },
      { keys: 'double-click the name bar', does: 'loop this clip and record into it' },
      { keys: 'right-click the name bar', does: 'copy, duplicate, ungroup, delete' }
    ]
  },
  {
    area: 'the shelf and the sketch strip',
    gestures: [
      { keys: 'click', does: 'preview a tile' },
      { keys: 'shift-click', does: 'select a range' },
      { keys: 'cmd-click', does: 'add one to the selection, or take it out' },
      { keys: 'drag', does: 'place it, or reorder it in the strip' },
      { keys: 'delete', does: 'remove the selected tiles from the shelf' },
      { keys: 'right-click a shelf tile', does: 'seed discover with its stems' },
      { keys: 'right-click and drag a bar count', does: 'change a strip tile length' },
      { keys: 'ctrl+right-click', does: 'solo the group' }
    ]
  },
  {
    area: 'dials',
    gestures: [
      { keys: 'drag', does: 'change the value' },
      { keys: 'scroll', does: 'change the value' },
      { keys: 'arrow keys', does: 'nudge by one' },
      { keys: 'shift+arrow keys', does: 'jump by ten' },
      { keys: 'double-click', does: 'back to the default' }
    ]
  },
  {
    area: 'discover',
    gestures: [
      { keys: 'click a match meter', does: 'open the reclassify picker' },
      { keys: 'esc', does: 'drop the kinds you were about to add' }
    ]
  },
  {
    area: 'risers and automation',
    gestures: [
      { keys: 'right-click empty space', does: 'add a riser, then drag its length' },
      { keys: 'esc while drawing', does: 'abandon the riser' },
      { keys: 'drag', does: 'move a riser' },
      { keys: 'drag an edge', does: 'resize a riser' },
      { keys: 'double-click a riser name', does: 'rename it' },
      { keys: 'right-click a riser', does: 'offer to remove it' },
      { keys: 'esc', does: 'close a riser sweep lane' },
      { keys: 'right-click a lane', does: 'clear it, same as the x' },
      { keys: 'option+drag in a lane', does: 'draw off the grid' }
    ]
  },
  {
    area: 'guided flows',
    gestures: [
      { keys: 'beat picker: click a beat', does: 'set the loop start there' },
      { keys: 'beat picker: space', does: 'start it playing, then mark the downbeat' },
      { keys: 'beat picker: left and right', does: 'previous or next riff in the batch' },
      { keys: 'beat picker: esc', does: 'close it' },
      { keys: 'tidy up: up and down', does: 'move between rows' },
      { keys: 'tidy up: 1 to 8', does: 'give the focused row that role' },
      { keys: 'tidy up: esc', does: 'close it' },
      { keys: 'click a waveform thumbnail', does: 'preview from that point' },
      { keys: 'drag across the grid', does: 'paint sections on and off' }
    ]
  }
]
