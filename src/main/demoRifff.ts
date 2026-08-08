import { join } from 'node:path'
import { app } from 'electron'
import { importRifff } from './importRifff'
import type { Rifff } from '@shared/types'

/** Mirrors engineProcess.ts's own defaultBinaryPath() dev-vs-packaged
 * branch: packaged mode reads the extraResources copy (see
 * electron-builder.yml), dev mode reads straight out of the repo. */
function demoRifffDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'demo-rifff')
  }
  return join(app.getAppPath(), 'resources', 'demo-rifff')
}

/** Imports the small bundled demo rifff used by the onboarding tour --
 * goes through the real importRifff() pathway (folder scan + WAV parsing),
 * not a hand-built Rifff object, so the tour exercises the same code path
 * a real import does. */
export function importDemoRifff(): Rifff | null {
  return importRifff([demoRifffDir()])
}
