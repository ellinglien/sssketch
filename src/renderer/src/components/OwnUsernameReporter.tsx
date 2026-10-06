import { useEffect } from 'react'
import {
  RIFF_LIBRARY_USERNAME_CHANGED_EVENT,
  isLoggedOutEvent,
  resolveOwnUsernameReport
} from '../audio/riffLibraryUsername'

/** Tells main who "me" is (report-own-username), first thing at mount and
 * again on every change -- so a startup rebuild knows whose stems to index
 * first (faster startup plan, docs/superpowers/plans/2026-10-06-faster-
 * startup.md), and the background passes rank them first. Renders nothing;
 * mounted once at the top of App, for the whole session (it used to ride on
 * StartupGate).
 *
 * A failed session lookup reports 'unknown', which main ignores: only a
 * name, a typed empty username, or a logout (announceEndlesssLoggedOut)
 * replace or clear the name it saved (@shared/ownUsernameReport). */
export function OwnUsernameReporter(): null {
  useEffect(() => {
    const report = (afterLogout: boolean): void => {
      void resolveOwnUsernameReport(afterLogout)
        .then((r) => window.rifffApi.reportOwnUsername(r))
        .catch((err) => console.error('OwnUsernameReporter: reportOwnUsername failed:', err))
    }
    const onChange = (event: Event): void => report(isLoggedOutEvent(event))
    report(false)
    window.addEventListener(RIFF_LIBRARY_USERNAME_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(RIFF_LIBRARY_USERNAME_CHANGED_EVENT, onChange)
  }, [])
  return null
}
