import type { StretchResolver } from '@shared/buildEngineProject'
export const resolveStretchedForPlayback: StretchResolver = (stemPath, ratio) =>
  window.rifffApi.renderStretched(stemPath, ratio)
