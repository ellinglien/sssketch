// src/renderer/src/audio/backgroundWorkRegistry.ts
import { createBackgroundWorkRegistry } from '@shared/backgroundWork'

/** The app-wide registry the renderer-side background scans
 * (DiscoverLibraryScan, BackgroundFeatureScan) report their progress to --
 * they render nothing themselves, so BackgroundWorkIndicator.tsx reads it
 * from here. Same one-instance-per-app shape as backgroundScanGate. */
export const backgroundWorkRegistry = createBackgroundWorkRegistry()
