// src/shared/exportToolkitChoice.ts
import type { AppState } from '../renderer/src/state/store'
import { timelineStemPans } from './buildEngineProject'
import { normalizeSoundSettings } from './radioSound'
import { projectUsesToolkit, type ToolkitExportMode } from './toolkit'
import { timelineThrowPlan } from './timelineThrows'

/** What the DAW-export picker offers (ExportFormatPicker): whether to show the bake/automation
 * choice at all, and which side it starts on.
 *
 * Offered when a clip's toolkit does something, a riser exists (projectUsesToolkit), the radio
 * sound's per-row panning puts a placed stem off centre (timelineStemPans) -- bake renders the
 * pan, automation writes it as the stem's track pan -- or the timeline's planned dub throws
 * (timelineThrowPlan, Task 12) throw on some clip: bake renders each throwing clip with its echo,
 * automation has no echo (neither DAW session has the bus), which the picker says.
 *
 * The default is `bake`, as it always was, UNLESS pan is the only per-stem stage in the project
 * (no clip has a filter, a send or a volume curve; risers don't count, they are audio in both
 * modes). Then it is `automation` (native radio sound plan, Task 4 review): panning is on by
 * default, so baking would render about two thirds of the stems, each a full render from bar 0,
 * and hand over processed files for what a track pan says. Bake can still be chosen.
 *
 * Throws do NOT move the default (Task 12, conservative, flagged for Elling): throws are on by
 * default too, and a bake default would bring back the two-thirds-of-the-stems render the line
 * above avoids. A default DAW export of a throwing project is therefore dry of throws; bake
 * carries them. */
export function exportToolkitChoice(state: AppState): {
  offer: boolean
  defaultMode: ToolkitExportMode
} {
  const clipToolkit = projectUsesToolkit({ ...state, risers: {} })
  const panned = timelineStemPans(state).size > 0
  const throws = (timelineThrowPlan(state)?.throws.length ?? 0) > 0
  return {
    offer: projectUsesToolkit(state) || panned || throws,
    defaultMode: panned && !clipToolkit ? 'automation' : 'bake'
  }
}

/** Whether a DAW export leaves some of the project's mastering behind (native radio sound plan,
 * Task 14; the D1/D2 ruling): the session's stems carry each row's own stages (pan, filter,
 * sends, throws), never the master's -- the headroom trim and limiter, glue, tone, saturation and
 * the pump's duck -- since the DAW has its own master and each stem would be limited on its own.
 * True when the project has any of those on, so the picker (ExportFormatPicker) can say the
 * mastering is left to the DAW. A project with no sound settings has none to leave. Glue, tone
 * and saturation only ever run with mastering, so mastering or the pump decides it. */
export function dawExportLeavesMastering(state: AppState): boolean {
  if (state.sound === undefined) return false
  const s = normalizeSoundSettings(state.sound)
  return s.mastering.on || s.pump.on
}
