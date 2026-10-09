/** The slice of Electron's `app` the single-instance guard uses, so the guard
 * can be tested against a stand-in without mocking the electron module. */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  exit(exitCode?: number): void
  on(event: 'second-instance', listener: () => void): unknown
}

/**
 * One running app per userData profile. The first launch takes the lock and
 * is told about later launches (`onSecondInstance`, which brings its window
 * forward). A later launch exits on the spot and returns false.
 *
 * app.exit(), not app.quit(): Electron doesn't document that quit() before
 * 'ready' keeps app.whenReady() from resolving, and if it did resolve, the
 * losing instance would open the databases and spawn a second playback
 * engine before going away. (On Electron 39 a two-launch experiment showed
 * whenReady not running after either call, so this is a guarantee rather than
 * a fix for something observed.) exit() also skips before-quit/will-quit,
 * which is right here: the losing instance has nothing to save or shut down.
 * index.ts checks the return value at the top of its whenReady handler too.
 */
export function claimSingleInstance(app: SingleInstanceApp, onSecondInstance: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
    return false
  }
  app.on('second-instance', onSecondInstance)
  return true
}
