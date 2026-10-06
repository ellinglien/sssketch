// src/main/windowNoticeQueue.ts

// Notices for the user that the main process raises before the main window
// exists (a startup backfill runs inside app.whenReady(), well before
// createWindow()) or at any time after. A message box with no parent window
// is app-modal on macOS: Electron runs the NSAlert inline, so even the
// "async" dialog.showMessageBox blocks the main process until it is
// dismissed -- before the window has been created, that held up the whole
// startup (review of 6fd465fe, important 1). So a notice waits here until a
// window is ready to show, and is then shown on it, as a sheet that doesn't
// block. Pure: index.ts supplies the window and the dialog.

export interface WindowNoticeQueue<W> {
  /** Shows the notice on the ready window now, or holds it until one is
   * ready. A notice already waiting under the same key is not queued again. */
  post(key: string, show: (win: W) => void): void
  /** `win` has been shown: notices go to it, starting with those waiting. */
  windowReady(win: W): void
  /** `win` is closed: notices wait again, unless another window is ready. */
  windowGone(win: W): void
}

export function createWindowNoticeQueue<W>(): WindowNoticeQueue<W> {
  let ready: W | null = null
  const waiting = new Map<string, (win: W) => void>()
  return {
    post(key, show) {
      if (ready !== null) {
        show(ready)
        return
      }
      if (!waiting.has(key)) waiting.set(key, show)
    },
    windowReady(win) {
      ready = win
      const due = [...waiting.values()]
      waiting.clear()
      for (const show of due) show(win)
    },
    windowGone(win) {
      if (ready === win) ready = null
    }
  }
}
