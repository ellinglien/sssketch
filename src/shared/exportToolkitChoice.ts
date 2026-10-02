// src/shared/exportToolkitChoice.ts
import type { AppState } from '../renderer/src/state/store'
import { timelineStemPans } from './buildEngineProject'
import { projectUsesToolkit, type ToolkitExportMode } from './toolkit'

/** What the DAW-export picker offers (ExportFormatPicker): whether to show the bake/automation
 * choice at all, and which side it starts on.
 *
 * Offered when a clip's toolkit does something, a riser exists (projectUsesToolkit), or the radio
 * sound's per-row panning puts a placed stem off centre (timelineStemPans) -- bake renders the
 * pan, automation writes it as the stem's track pan.
 *
 * The default is `bake`, as it always was, UNLESS pan is the only per-stem stage in the project
 * (no clip has a filter, a send or a volume curve; risers don't count, they are audio in both
 * modes). Then it is `automation` (native radio sound plan, Task 4 review): panning is on by
 * default, so baking would render about two thirds of the stems, each a full render from bar 0,
 * and hand over processed files for what a track pan says. Bake can still be chosen. */
export function exportToolkitChoice(
  state: Pick<
    AppState,
    'rifffs' | 'sound' | 'stemFilters' | 'stemSends' | 'stemAutomation' | 'risers'
  >
): { offer: boolean; defaultMode: ToolkitExportMode } {
  const clipToolkit = projectUsesToolkit({ ...state, risers: {} })
  const panned = timelineStemPans(state).size > 0
  return {
    offer: projectUsesToolkit(state) || panned,
    defaultMode: panned && !clipToolkit ? 'automation' : 'bake'
  }
}
