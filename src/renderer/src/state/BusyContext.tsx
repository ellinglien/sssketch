import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface BusyContextValue {
  message: string | null
  setBusy: (message: string | null) => void
}

const BusyContext = createContext<BusyContextValue | null>(null)

/** Wraps the whole app (see App.tsx's top-level App component) so any
 * component can trigger the blocking BusyOverlay -- for genuinely
 * user-initiated waits only (opening a project, resolving/downloading a
 * LORE riff the user explicitly asked for), never for silent background
 * work. LoreLibraryBrowser's own background stem prefetch is deliberately
 * NOT wired to this -- see its own doc comments on backgroundDownload/
 * runBackgroundSync for why that one stays silent by design. */
export function BusyProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [message, setBusy] = useState<string | null>(null)
  const value = useMemo(() => ({ message, setBusy }), [message])
  return <BusyContext.Provider value={value}>{children}</BusyContext.Provider>
}

function useBusyContext(): BusyContextValue {
  const ctx = useContext(BusyContext)
  if (!ctx) throw new Error('useBusy/useBusyMessage must be used within a BusyProvider')
  return ctx
}

/** Call with a lowercase status string (e.g. "opening project…") to show
 * the blocking overlay, or `null` to dismiss it. Always call with `null` in
 * a `finally` block so a thrown error doesn't leave the app permanently
 * blocked. */
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useBusy(): (message: string | null) => void {
  return useBusyContext().setBusy
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useBusyMessage(): string | null {
  return useBusyContext().message
}
