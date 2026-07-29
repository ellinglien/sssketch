import { renderStretched } from './rubberband'
import type { StretchResolver } from '@shared/buildEngineProject'

/**
 * The real StretchResolver implementation for native export — calls the same
 * rubberband CLI wrapper the renderer's window.rifffApi.renderStretched IPC
 * handler already calls (see src/main/index.ts's 'render-stretched' handler),
 * but directly, since this runs in the main process already and doesn't need
 * to round-trip through IPC to reach itself.
 */
export const resolveStretchedForExport: StretchResolver = (stemPath, ratio) =>
  renderStretched(stemPath, ratio)
