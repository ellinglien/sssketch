/**
 * The field names the engine's `set-live-param` message understands.
 *
 * The live-param fast path exists so a DRAGGED control can reach the audio
 * thread without a whole project rebuild per frame -- see
 * docs/superpowers/specs/2026-08-04-live-param-fast-path-design.md, and
 * `updateSlotGain`'s own comment on why a rebuild per drag tick is not an
 * option. The rule this codebase settled on, twice:
 *
 * > A curve is for a gesture that must land on a beat. A live-param is for a
 * > hand on a control.
 *
 * Lives in `src/shared/` because the exact same union has to be true in
 * three places that cannot import each other -- the renderer's
 * `scheduleLiveParamSync`, the preload bridge, and the main-process IPC
 * handler -- and a fourth, hand-synced one on the engine side
 * (`IpcServer.cpp`'s `set-live-param` branch). Three of those four can at
 * least share this type rather than each spelling the union out.
 */
export type LiveParamField =
  /** Keyed by stemKey. One clip's gain, while it is being dragged. */
  | 'volume'
  /** The MASTER filter's cutoff and resonance, normalised [0,1]
   * (docs/superpowers/specs/2026-09-28-performance-mode-design.md §4A.3).
   * There is exactly one master filter, so these carry NO key -- the engine
   * ignores it and the renderer sends ''. A negative value clears the
   * override, restoring whatever the committed project last said, which is
   * the same sentinel `volume` already uses. */
  | 'masterFilterCutoff'
  | 'masterFilterResonance'

/** The key a keyless live-param field is sent with. Named rather than
 * written as a bare '' at each call site, so grepping for it finds all of
 * them. */
export const MASTER_LIVE_PARAM_KEY = ''
