import { radioGridLineAtOrAfter } from '@shared/radioSchedule'

/** How far ahead of the playhead a bar a staged change is aimed at must be, in the pace slider's
 * bar band (80+): a beat. The stage has to be built and reach the engine before its bar --
 * tens of ms warm, measured, but it also waits out any push still in flight (DiscoverPanel's
 * step (3) gate) -- and a bar the engine finds already behind it is applied at once
 * ("bar-passed"), late, wherever the playhead is. At a line every bar a stem resolving late in a
 * bar is the ordinary case, not the rare one. A beat at any tempo radio plays, as the turnaround's
 * TURNAROUND_ROLL_LATE_BARS is. */
export const RADIO_BAR_STAGE_LEAD_BARS = 0.25

/** Where an early-decided mid-loop cut is aimed (stage-project's `atBars`): the bar
 * radioChangeLandsAtBar named, or -- when that is closer than `leadBars` -- the next line of
 * the same grid that is not, or the loop top (undefined) when no line is left in the lap. A
 * deferral to the next line, never a late landing mid-bar. */
export function radioBarLandingAim(
  landsAtBar: number,
  pos: number,
  gridBars: number,
  loopBars: number,
  leadBars: number
): number | undefined {
  if (landsAtBar - pos >= leadBars) return landsAtBar
  const line = radioGridLineAtOrAfter(pos + leadBars, gridBars, loopBars)
  return line >= loopBars ? undefined : line
}
