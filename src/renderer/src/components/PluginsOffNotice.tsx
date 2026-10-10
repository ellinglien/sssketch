import { useEffect, useState, useSyncExternalStore } from 'react'
import { featureEnabled, projectUsesPlugins } from '@shared/features'
import { useAppFeatures } from '../state/appFeatures'
import { useAppSelector } from '../state/StoreContext'
import {
  pluginsHeldStatus,
  projectOpenedCount,
  subscribeProjectOpened,
  subscribePluginsHeld
} from '../state/pendingPluginStates'

/** Same window as StemsUnavailableIndicator: long enough to read twice, short enough that it
 * never becomes furniture. */
const VISIBLE_MS = 14_000

/** A small, non-blocking pill, once per opened project: the project has add-on plugins, and the
 * advanced features switch has plugins off, so they are not heard (StoreContext loads none).
 * The project keeps them -- its slots and saved settings are written back as they were -- so
 * this only says why it sounds different and where the switch is.
 *
 * Keyed on the project-opened count (StoreContext's restoreState), not on the slots, so an edit
 * never brings it back; it waits for main's answer on the switch, so a project restored at
 * startup still gets it. Same look as StemsUnavailableIndicator, stacked below it (TopRightNotices). */
export function PluginsOffNotice(): React.JSX.Element | null {
  const openCount = useSyncExternalStore(subscribeProjectOpened, projectOpenedCount)
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  const appFeatures = useAppFeatures()
  const [dismissedCount, setDismissedCount] = useState(0)

  const show =
    openCount > dismissedCount &&
    appFeatures !== null &&
    !featureEnabled('plugins', appFeatures) &&
    projectUsesPlugins(masterChain, channelPlugins)

  useEffect(() => {
    if (!show) return
    const timer = setTimeout(() => setDismissedCount(openCount), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [show, openCount])

  if (!show) return null

  return (
    <button
      onClick={() => setDismissedCount(openCount)}
      title="plugins are off"
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        fontFamily: 'inherit',
        textAlign: 'left',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        color: 'var(--ra-text-3)',
        cursor: 'pointer'
      }}
    >
      this project uses plugins · turn on advanced features to hear them
    </button>
  )
}

/** While plugins are switched off but still loaded ('held': their settings couldn't be read back,
 * so they were left in the engine rather than lost): says so, and whether it is still trying. Stays
 * up as long as that lasts -- turning advanced features back on ends it, keeping the plugins as
 * they are. Stacked below PluginsOffNotice (TopRightNotices). */
export function PluginsHeldNotice(): React.JSX.Element | null {
  const status = useSyncExternalStore(subscribePluginsHeld, pluginsHeldStatus)
  if (status === 'none') return null
  return (
    <div
      role="status"
      title="plugins still loaded"
      style={{
        pointerEvents: 'auto',
        padding: '5px 10px',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        color: 'var(--ra-text-3)'
      }}
    >
      {status === 'retrying'
        ? "plugins still loaded · couldn't read their settings yet · retrying"
        : "plugins still loaded · couldn't read their settings · turn advanced features on to keep them"}
    </div>
  )
}
