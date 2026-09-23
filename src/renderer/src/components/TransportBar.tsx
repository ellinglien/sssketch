import { useEffect, useRef, useState } from 'react'
import { traitMatchBarLabel } from '@shared/traitBar'
import { useAppState, useDispatch, usePos, usePlaying } from '../state/StoreContext'
import { positionLabel, elapsedLabel } from '@shared/visuals'
import { loopLengthBars } from '../state/selectors'
import { stopActivePreview } from '../audio/previewLoop'
import { MasterChainPanel } from './MasterChainPanel'
import { ContextMenu } from './ContextMenu'
import { AudioDeviceModal } from './AudioDeviceModal'
import { KeyGesturesModal } from './KeyGesturesModal'

// Persisted per-machine (same pattern as LoreLibraryBrowser's own
// loreUsername), not part of the project file -- selectedInputDevice/
// availableInputDevices are deliberately excluded from PersistedProject
// (see state/serialize.ts), since a device name is a fact about the machine
// running the app, not the arrangement itself. Restored once devices are
// actually fetched (only then do we know whether the stored name is
// still a real, currently-available device) -- see this component's own
// fetchAndRestoreInputDevices, triggered on mount and again any time
// selectedInputDevice reads back as null (e.g. after loading a project,
// which resets it since it isn't part of the saved file), not just when
// the dropdown happens to receive focus.
const INPUT_DEVICE_STORAGE_KEY = 'sssketch:selectedInputDevice'

function loadStoredInputDevice(): string | null {
  try {
    return localStorage.getItem(INPUT_DEVICE_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeSelectedInputDevice(device: string | null): void {
  try {
    if (device) localStorage.setItem(INPUT_DEVICE_STORAGE_KEY, device)
    else localStorage.removeItem(INPUT_DEVICE_STORAGE_KEY)
  } catch {
    // localStorage unavailable (e.g. private mode) -- the setting just
    // won't survive a restart, not worth surfacing as an error.
  }
}

// Deliberately NOT persisted across launches (unlike selectedInputDevice) --
// see fetchOutputDevices's own doc comment for why an output
// device is never auto-applied from a remembered name. component-local
// state rather than global reducer state either way, since nothing outside
// this settings menu needs to read which output device is active.

// A plain triangle-body + pendulum-arm silhouette, monochrome via
// currentColor -- matches this app's existing convention of drawing
// transport glyphs directly (▶/■ elsewhere in this same file) rather than
// pulling in an icon library, and its "no emoji in chrome" design-system
// rule (CLAUDE.md).
function MetronomeIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M5 14 L8 2 L11 14 Z" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="8" y1="12" x2="11" y2="4" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="9.7" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Simplified 6-tooth cog silhouette, same hand-drawn-glyph/no-icon-library
// convention as MetronomeIcon above -- outer ring + hole drawn as strokes,
// teeth as small rects rotated around the same center. (The "tidy" button
// this used to sit next to moved up to App.tsx's own ProjectMenu, in the
// top row -- see that component's tidy button for tidy-up/tidy-view.)
function SettingsGearIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4" />
      <circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none" />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <rect
          key={deg}
          x="6.1"
          y="0.4"
          width="1.8"
          height="2"
          fill="currentColor"
          stroke="none"
          transform={`rotate(${deg} 7 7)`}
        />
      ))}
    </svg>
  )
}

// Plain filled circle, same hand-drawn-glyph convention as MetronomeIcon --
// a record-button dot. Drawn as SVG geometry (not a CSS border-radius div)
// since this design system otherwise forbids border-radius everywhere else
// (tokens.css); a circle glyph representing recording state is the one
// legitimate exception, same category as the waveform/playhead colors this
// system reserves color for, so it's drawn deliberately rather than via the
// banned CSS shortcut.
//
// dim and pulse are separate booleans, not one -- dim reflects whether
// gated recording is armed at all (on vs off), while pulse additionally
// requires transport to actually be playing. Per direct feedback, sitting
// armed-but-paused shouldn't pulse -- the pulse means "actively listening
// right now," which can only be true while the transport is moving through
// the loop region (see GatedLoopRecorder's own gate, which only ever
// writes samples during real playback).
function RecDotIcon({ dim, pulse }: { dim: boolean; pulse: boolean }): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <circle
        cx="5"
        cy="5"
        r="5"
        fill="var(--ra-recording-live)"
        opacity={dim ? 0.35 : 1}
        style={pulse ? { animation: 'ra-rec-pulse 1.4s ease-in-out infinite' } : undefined}
      />
      <style>{`
        @keyframes ra-rec-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
      `}</style>
    </svg>
  )
}

// Hand-drawn SVG glyphs -- no icon library, monochrome via currentColor,
// same convention as DiscoverPanel.tsx's own DiceIcon/StarIcon/
// LockGlyph etc. Direct request, 2026-09-16: "check for any other
// buttons in the interface that might be replaced with icons." These four
// sit in the same transport toolbar row as this file's own already-icon
// MetronomeIcon/SettingsGearIcon/RecDotIcon -- the strongest icon/text
// crowding signal found in the whole app.
function ChainLinkIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <rect x="1.5" y="5" width="7" height="6" rx="3" />
      <rect x="7.5" y="5" width="7" height="6" rx="3" />
    </svg>
  )
}

/** A drawn automation curve: a straight-segment polyline through square
 * breakpoints -- deliberately the same shape AutomationLane.tsx actually
 * draws (a polyline, 5px squares, sharp corners per tokens.css), rather
 * than the smooth S-curve with round dots this icon used to show back when
 * the button toggled the old fade/volume envelope. */
function AutomationIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M1 12 L5 4 L10 4 L15 11" strokeWidth="1.3" />
      <rect x="3.5" y="2.5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="8.5" y="2.5" width="3" height="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

function SlidersIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M3 13 V3" />
      <path d="M8 13 V3" />
      <path d="M13 13 V3" />
      <circle cx="3" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="13" cy="4.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PlusMicIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="1.5" width="4" height="7" rx="2" />
      <path d="M4 8 a4 4 0 0 0 8 0" />
      <path d="M8 12 V14.5" />
      <path d="M12.5 1 V5" />
      <path d="M10.5 3 H14.5" />
    </svg>
  )
}

export function TransportBar({
  onEnableGatedRecording,
  onDisableGatedRecording,
  onStop,
  onShowWelcome,
  onOpenEndlesss,
  onStartTour,
  discoverConsented,
  toggleDiscoverConsent,
  traitMatchBar,
  cycleTraitMatchBar
}: {
  onEnableGatedRecording: () => void
  onDisableGatedRecording: () => void
  // Separate from a plain STOP dispatch -- App.tsx's handleStop also checks
  // for an uncommitted gated-recording pass first (see its own doc
  // comment), which needs state this component doesn't have direct access
  // to construct itself.
  onStop: () => void
  /** Settings menu's "show welcome screen" entry -- see App.tsx's
   * showWelcomeAgain for what "re-enable" actually does (clears the
   * persisted opt-out AND reopens it now). */
  onShowWelcome: () => void
  /** Settings menu's "log into endlesss" entry, shown only when logged out
   * -- opens the same library browser the onboarding modal's own "log into
   * endlesss" button does, rather than duplicating a login form here. */
  onOpenEndlesss: () => void
  /** Settings menu's "take the tour" entry -- a deliberate replay, always
   * present regardless of whether the tour has already been seen (unlike
   * OnboardingModal's own tour link, which disappears once tourSeen is
   * true -- see App.tsx's replayTour for the confirm-if-existing-content
   * guard this shares with the welcome modal's own onStartTour). */
  onStartTour: () => void
  /** Whether Elling has opted into Discover's whole-library background
   * scan (DiscoverPanel.tsx's own one-time consent prompt) -- App.tsx
   * loads this once on mount via `getDiscoverSettings`, same as
   * DiscoverPanel.tsx's own `settings` state, so this menu's label stays
   * in sync without this component polling settings itself. */
  discoverConsented: boolean
  /** Settings menu's revoke/re-enable entry -- flips consentedToLibraryScan
   * and persists via `setDiscoverSettings`, mirrored in App.tsx. */
  toggleDiscoverConsent: () => Promise<void>
  /** How strict Discover's trait kinds are (DiscoverSettings.traitMatchBar)
   * and the menu entry that steps it -- direct request, 2026-09-22. */
  traitMatchBar: number
  cycleTraitMatchBar: () => Promise<void>
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const automationMode = state.mode === 'automation'
  const pos = usePos()
  const playing = usePlaying()
  const [masterChainPanelOpen, setMasterChainPanelOpen] = useState(false)
  const [settingsMenu, setSettingsMenu] = useState<{ x: number; y: number } | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  // The settings menu's "audio…" entry -- replaces the two dropdowns that
  // used to sit directly in the transport bar (see AudioDeviceModal.tsx's
  // own doc comment).
  const [audioModalOpen, setAudioModalOpen] = useState(false)
  // The app's own shortcut/gesture reference -- see KeyGesturesModal.tsx
  // for why it exists at all.
  const [keysModalOpen, setKeysModalOpen] = useState(false)
  // Fetched fresh each time the settings menu opens (see the trigger
  // button below) rather than kept live -- the menu is only open for a
  // few seconds at most, and this avoids a persistent poll/subscription
  // just for a label two clicks deep.
  const [endlesssStatus, setEndlesssStatus] = useState<{
    loggedIn: boolean
    username?: string
  } | null>(null)

  // Discover's background classify scan (stemAutoClassifyScheduler.ts) has
  // no progress UI of its own -- direct request, 2026-09-15 ("any way to
  // show the progress of the discovery scan? maybe in the gear menu where
  // the option is"), after the existing bottom-right extraction-scan bar
  // (DiscoverLibraryScan.tsx) turned out to be nearly invisible in
  // practice. Same fetch-on-open convention as endlesssStatus above, not a
  // live poll -- classification only advances a little between one menu
  // open and the next anyway (BUSY_DELAY_MS=1000/IDLE_DELAY_MS=30000, see
  // that scheduler's own doc comment), so a snapshot fetched right as the
  // menu opens is accurate enough for a number glanced at occasionally.
  const [classifyProgress, setClassifyProgress] = useState<{
    classified: number
    eligible: number
  } | null>(null)

  // Output device: component-local (unlike selectedInputDevice, nothing
  // outside this settings menu needs to read it) -- see
  // OUTPUT_DEVICE_STORAGE_KEY's own doc comment.
  const [availableOutputDevices, setAvailableOutputDevices] = useState<string[]>([])
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string | null>(null)
  const fetchingOutputDevicesRef = useRef(false)

  // Buffer size: same component-local, never-auto-applied-on-mount posture
  // as selectedOutputDevice above, for the same reason -- a numeric size
  // doesn't carry output device's "silently wrong direction" risk, but
  // there's still no value in persisting it across launches when the
  // modal's own fetch-on-open already shows the engine's real current
  // value every time. Null only until that first fetch resolves.
  const [bufferSize, setBufferSize] = useState<number | null>(null)
  function fetchBufferSize(): void {
    void window.rifffApi.engineGetBufferSize().then((size) => {
      if (size !== null) setBufferSize(size)
    })
  }

  // Unlike a name merely being *listed*, there's no way to confirm a device
  // is actually the one physically in use right now (headphones unplugged
  // but still enumerated, a stale Bluetooth pairing, etc.) -- auto-applying
  // a stored name on every launch previously did exactly that: silently
  // rerouted the engine's real output away from the speakers to a device
  // that was valid-but-wrong, with nothing in the UI to show it had
  // happened. Caught for real (native output device selection had just
  // shipped, untested against real hardware) when it made an otherwise
  // working project go completely silent, surviving both a renderer reload
  // and a full quit/relaunch since the bad value lived in localStorage.
  // Mirrors input's own already-established rule now: fetch the list for
  // display, but only ever actually switch on an explicit user pick in the
  // modal (see onChangeOutput below) -- never ambient, never on mount.
  function fetchOutputDevices(): void {
    if (fetchingOutputDevicesRef.current) return
    fetchingOutputDevicesRef.current = true
    void window.rifffApi
      .engineListOutputDevices()
      .then((devices) => {
        setAvailableOutputDevices(devices)
      })
      .catch((err) => {
        console.error('TransportBar: failed to list output devices:', err)
      })
      .finally(() => {
        fetchingOutputDevicesRef.current = false
      })
  }

  const availableInputDevices = state.availableInputDevices
  const selectedInputDevice = state.selectedInputDevice
  const isAnyChannelArmed = state.armedChannelId !== null
  // Guards the input-device dropdown's lazy fetch against firing twice --
  // availableInputDevices.length === 0 alone isn't enough, since React
  // state hasn't updated yet if the dropdown is focused a second time
  // before the first fetch resolves. Same "ref set synchronously before an
  // async call starts" idiom LoreLibraryBrowser.tsx's own handleLoadMore
  // uses for the identical class of problem.
  const fetchingInputDevicesRef = useRef(false)

  // Shared by the mount/reset effect and the dropdown's own onFocus below --
  // see INPUT_DEVICE_STORAGE_KEY's doc comment for why this needs to run on
  // more than just focus.
  function fetchAndRestoreInputDevices(): void {
    if (fetchingInputDevicesRef.current) return
    fetchingInputDevicesRef.current = true
    void window.rifffApi
      .engineListInputDevices()
      .then((devices) => {
        dispatch({ type: 'SET_AVAILABLE_INPUT_DEVICES', devices })
        // Restore the last-picked device once we actually know it's still
        // real -- only meaningful while selectedInputDevice reads as null,
        // and only if it's genuinely present in this fetch's device list (a
        // loopback driver from a previous session might not be installed/
        // running anymore).
        const stored = loadStoredInputDevice()
        if (stored && devices.includes(stored)) {
          dispatch({ type: 'SET_SELECTED_INPUT_DEVICE', device: stored })
        }
      })
      .catch((err) => {
        console.error('TransportBar: failed to list input devices:', err)
      })
      .finally(() => {
        fetchingInputDevicesRef.current = false
      })
  }

  // Runs on mount, and again any time selectedInputDevice reads back as
  // null after having been something else -- notably right after loading a
  // project, which resets it to null (it's excluded from PersistedProject,
  // see state/serialize.ts). Without this, the stored device only ever got
  // restored once the dropdown happened to receive focus, which read as
  // "doesn't remember the input method" for anyone who armed a recording
  // without ever clicking into the dropdown first.
  useEffect(() => {
    if (selectedInputDevice === null) fetchAndRestoreInputDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchAndRestoreInputDevices is stable in spirit (closes over dispatch, which useDispatch guarantees is stable) and deliberately excluded to avoid re-running on every render; the intent is "re-fire only when selectedInputDevice transitions to null"
  }, [selectedInputDevice])

  // Runs once on mount -- unlike the input-device restore above, there's no
  // "reset to null after loading a project" case to also react to, since
  // selectedOutputDevice is local component state, never touched by
  // project load/serialize at all.
  useEffect(() => {
    fetchOutputDevices()
  }, [])

  // Opens the native folder picker and, unless cancelled, repoints where
  // every future sketch save/duplicate/list lands -- same pickFolder +
  // setLibraryRoot pair ProjectLibraryBrowser.tsx's own "change location…"
  // uses, just reachable from the settings menu too without opening that
  // whole modal first.
  async function handleChangeSaveLocation(): Promise<void> {
    try {
      const newRoot = await window.rifffApi.pickFolder()
      if (!newRoot) return
      await window.rifffApi.setLibraryRoot(newRoot)
    } catch (err) {
      console.error('TransportBar: handleChangeSaveLocation() failed:', err)
    }
  }

  // Same pickFolder + setRiffLibraryRoot pair LibraryBrowser.tsx's own
  // warehouse-unavailable fallback used to offer inline -- moved here so
  // it's reachable without having to hit that unavailable state first.
  // Points the riff library at a different OUROVEON/LORE sync target than
  // sssketch's own self-built one; see riffLibraryStore.ts for what "riff
  // library root" means.
  async function handleChangeRiffLibraryLocation(): Promise<void> {
    try {
      const newRoot = await window.rifffApi.pickFolder()
      if (!newRoot) return
      await window.rifffApi.setRiffLibraryRoot(newRoot)
    } catch (err) {
      console.error('TransportBar: handleChangeRiffLibraryLocation() failed:', err)
    }
  }

  // Fetches auth status fresh right before opening -- see endlesssStatus's
  // own doc comment for why this isn't kept live instead.
  function handleOpenSettingsMenu(e: React.MouseEvent<HTMLButtonElement>): void {
    if (settingsMenu) {
      setSettingsMenu(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setSettingsMenu({ x: rect.left, y: rect.bottom + 4 })
    void window.rifffApi
      .endlesssAuthStatus()
      .then((status) =>
        setEndlesssStatus(
          status.loggedIn ? { loggedIn: true, username: status.username } : { loggedIn: false }
        )
      )
      .catch((err) => {
        console.error('TransportBar: endlesssAuthStatus() failed:', err)
        setEndlesssStatus(null)
      })
    void window.rifffApi
      .getDiscoverClassifyProgress()
      .then((progress) => setClassifyProgress(progress))
      .catch((err) => {
        console.error('TransportBar: getDiscoverClassifyProgress() failed:', err)
        setClassifyProgress(null)
      })
  }

  // Ableton Link (https://github.com/Ableton/link) status -- fetched
  // on-demand and re-polled on a slow timer, not pushed continuously by
  // the engine (a human glancing at a peer count doesn't need sub-second
  // freshness, same "fetch when relevant, not streamed" reasoning as this
  // app's own input-device list). enabled mirrors the engine's own
  // isEnabled() rather than being locally optimistic, so a failed toggle
  // (e.g. the engine isn't running yet) doesn't leave the button showing
  // a state that isn't real.
  const [linkStatus, setLinkStatus] = useState<{ enabled: boolean; numPeers: number }>({
    enabled: false,
    numPeers: 0
  })
  useEffect(() => {
    let cancelled = false
    async function poll(): Promise<void> {
      const status = await window.rifffApi.engineGetLinkStatus()
      if (!cancelled) setLinkStatus(status)
    }
    void poll()
    const id = window.setInterval(() => void poll(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  // Decoupled from state.bpm while focused: SET_TEMPO clamps to [40, 200], and a
  // controlled input that snaps back to the clamped value on every keystroke makes
  // multi-digit typing impossible (e.g. typing "1" of "120" clamps to 40 mid-type,
  // then further digits compound against that clamped value instead of "120").
  // Free-type locally, only committing (and clamping) on blur/Enter. Resynced
  // during render rather than an effect (React's "adjust state while rendering"
  // pattern) whenever state.bpm changes from elsewhere (±buttons, loading a
  // project) while the field isn't being actively edited.
  const [tempoText, setTempoText] = useState(String(state.bpm))
  const [tempoFocused, setTempoFocused] = useState(false)
  if (!tempoFocused && tempoText !== String(state.bpm)) {
    setTempoText(String(state.bpm))
  }

  function commitTempo(): void {
    setTempoFocused(false)
    const bpm = Number(tempoText)
    if (!Number.isNaN(bpm) && tempoText.trim() !== '') {
      dispatch({ type: 'SET_TEMPO', bpm })
    } else {
      setTempoText(String(state.bpm))
    }
  }

  return (
    <div
      style={{
        height: 46,
        background: 'var(--ra-bg-bar)',
        borderBottom: '1px solid var(--ra-border)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }}
    >
      <button
        onClick={() => {
          // A Shelf/SketchStrip/LORE-browser tile preview is a separate Web
          // Audio loop, entirely outside the native transport this button
          // otherwise controls — starting real playback should always win
          // (or, while playing, stopping should always kill) whatever
          // preview happens to still be looping, same as BeatPicker already
          // does the moment it opens.
          stopActivePreview()
          // Play and Stop merged into one button, per direct feedback --
          // clicking while playing now fully stops (resets pos to 0) rather
          // than pausing in place, so there's one obvious toggle instead of
          // two adjacent buttons doing similar things. Stopping goes through
          // onStop (not a direct dispatch) so App.tsx can check for an
          // uncommitted gated-recording pass first -- see its own doc
          // comment on handleStop.
          if (playing) {
            onStop()
          } else {
            dispatch({ type: 'PLAY' })
          }
        }}
        aria-label={playing ? 'Stop' : 'Play'}
        style={{
          width: 22,
          height: 22,
          borderRadius: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--ra-border-strong)',
          background: playing ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
          color: playing ? 'var(--ra-play-on-ink)' : 'var(--ra-text)',
          fontSize: 11
        }}
      >
        {playing ? '■' : '▶'}
      </button>

      <button
        onClick={() =>
          state.gatedRecordingEnabled ? onDisableGatedRecording() : onEnableGatedRecording()
        }
        // Enabling needs a loop region selected first (see App.tsx's own
        // enableGatedRecording, which otherwise just alerts and no-ops) --
        // disabled rather than silently doing nothing on click, so the
        // button itself communicates "you need a loop region first" before
        // a click ever happens. Always enabled while recording mode is
        // already on, regardless of loop region, so it can still be
        // clicked to disable.
        disabled={!state.gatedRecordingEnabled && !state.loopRegion}
        aria-label={
          state.gatedRecordingEnabled ? 'Disable gated recording' : 'Enable gated recording'
        }
        title={
          state.gatedRecordingEnabled
            ? 'recording mode: on'
            : state.loopRegion
              ? 'gated recording'
              : 'needs loop region'
        }
        style={{
          width: 22,
          height: 22,
          borderRadius: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${state.gatedRecordingEnabled ? 'var(--ra-recording-live)' : 'var(--ra-border)'}`,
          background: 'var(--ra-bg-row-active)',
          opacity: !state.gatedRecordingEnabled && !state.loopRegion ? 0.35 : 1,
          cursor: !state.gatedRecordingEnabled && !state.loopRegion ? 'not-allowed' : 'pointer'
        }}
      >
        <RecDotIcon
          dim={!state.gatedRecordingEnabled}
          pulse={state.gatedRecordingEnabled && playing}
        />
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {/* Remaining time leads now -- the biggest, most attention-grabbing
            number in the row, since "how much longer" is what you actually
            watch during playback. Elapsed and the bars.beats.16th position
            are still shown, just demoted to secondary/reference info.
            Fixed character-count width (the app's monospace font makes `ch`
            exact) so digits flipping mid-playback doesn't jitter the row and
            push every button after it left/right. */}
        <span style={{ fontSize: 16, width: '7ch', display: 'inline-block' }} title="remaining">
          -{elapsedLabel(Math.max(0, loopLengthBars(state) - pos), state.bpm)}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--ra-text-3)',
            width: '7ch',
            display: 'inline-block'
          }}
          title="elapsed"
        >
          {elapsedLabel(pos, state.bpm)}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--ra-text-3)',
            width: '8ch',
            display: 'inline-block'
          }}
          title="bar.beat.16th position"
        >
          {positionLabel(pos)}
        </span>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_METRONOME' })}
          aria-label="Toggle metronome"
          title={state.metronomeEnabled ? 'metronome: on' : 'metronome: off'}
          style={{
            height: 26,
            width: 26,
            borderRadius: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: state.metronomeEnabled
              ? 'var(--ra-stretch-on-bg)'
              : 'var(--ra-bg-row-active)',
            border: `1px solid ${state.metronomeEnabled ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
            color: state.metronomeEnabled ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
          }}
        >
          <MetronomeIcon />
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 26,
          borderLeft: '1px solid var(--ra-border)',
          borderRight: '1px solid var(--ra-border)',
          padding: '0 10px'
        }}
      >
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm - 1 })}
          aria-label="Decrease tempo"
          style={{
            width: 20,
            height: 20,
            borderRadius: 0,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)'
          }}
        >
          −
        </button>
        <input
          type="number"
          value={tempoText}
          onFocus={() => setTempoFocused(true)}
          onChange={(e) => setTempoText(e.target.value)}
          onBlur={commitTempo}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Tempo (BPM)"
          style={{
            fontSize: 11,
            width: 44,
            textAlign: 'center',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            border: '1px solid var(--ra-border)',
            borderRadius: 0,
            height: 20,
            padding: 0,
            // Chromium's native spin-button UI for type="number" eats into the
            // field's own width, clipping the last digit of a 3-digit value
            // (e.g. "142") — redundant anyway since the +/- buttons already
            // cover that. MozAppearance covers Firefox's equivalent.
            WebkitAppearance: 'none',
            MozAppearance: 'textfield'
          }}
        />
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm + 1 })}
          aria-label="Increase tempo"
          style={{
            width: 20,
            height: 20,
            borderRadius: 0,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)'
          }}
        >
          +
        </button>
      </div>

      <button
        onClick={() => {
          const next = !linkStatus.enabled
          void window.rifffApi.engineSetLinkEnabled(next).then(() => {
            void window.rifffApi.engineGetLinkStatus().then(setLinkStatus)
          })
        }}
        aria-label="Toggle Ableton Link"
        data-tooltip="ableton link"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: linkStatus.enabled ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        <ChainLinkIcon />
        {linkStatus.enabled && linkStatus.numPeers > 0 ? `· ${linkStatus.numPeers}` : ''}
      </button>

      {/* Enters/leaves automation mode. This is the SAME control that used
          to toggle the old envelope-drag mode (Elling, 2026-09-22: "we can
          even replace the 'envelopes' button to be this automation
          section") -- a clip's level is drawn in its own automation lane
          now, so there is nothing else for an "envelopes" button to mean.
          Deliberately a direct on/off rather than a second cycler: Tab
          still cycles arrange -> sketch -> automation (App.tsx's
          handleCycleArrangerMode/nextArrangerMode), and this button just
          jumps straight in and back out again to whichever mode isn't
          automation, so the two can't disagree about what's showing. */}
      <button
        onClick={() =>
          dispatch({
            type: 'SET_ARRANGER_MODE',
            mode: automationMode ? 'normal' : 'automation'
          })
        }
        aria-label="Toggle automation mode"
        data-tooltip={automationMode ? 'automation: on (tab)' : 'automation: off (tab)'}
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: automationMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${automationMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: automationMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        <AutomationIcon />
      </button>

      <button
        onClick={() => setMasterChainPanelOpen((open) => !open)}
        aria-label="Toggle master chain panel"
        data-tooltip="master plugin chain"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: masterChainPanelOpen ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        <SlidersIcon />
      </button>
      {masterChainPanelOpen && <MasterChainPanel onClose={() => setMasterChainPanelOpen(false)} />}

      <button
        onClick={() => dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })}
        aria-label="add another recording channel"
        data-tooltip="add channel (/)"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)'
        }}
      >
        <PlusMicIcon />
      </button>

      <button
        ref={settingsButtonRef}
        onClick={handleOpenSettingsMenu}
        aria-label="Settings"
        title="settings"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 22,
          width: 22,
          borderRadius: 0,
          padding: 0,
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)'
        }}
      >
        <SettingsGearIcon />
      </button>
      {settingsMenu && (
        <ContextMenu
          x={settingsMenu.x}
          y={settingsMenu.y}
          ignoreRef={settingsButtonRef}
          items={[
            { label: 'show welcome screen', onClick: onShowWelcome },
            { label: 'take the tour', onClick: onStartTour },
            { label: 'change save location…', onClick: () => void handleChangeSaveLocation() },
            {
              label: 'change riff archive location…',
              onClick: () => void handleChangeRiffLibraryLocation()
            },
            {
              label: discoverConsented
                ? 'turn off discover library scan'
                : 'turn on discover library scan',
              onClick: () => void toggleDiscoverConsent()
            },
            {
              label: `discover trait match: ${traitMatchBarLabel(traitMatchBar)}`,
              onClick: () => void cycleTraitMatchBar(),
              title: 'trait match strictness'
            },
            // Disabled info row, visible only while the scan is actually
            // on -- direct request, 2026-09-15. `eligible` can very rarely
            // read slightly lower than `classified` (a stem gets
            // human-confirmed via Tidy Up AFTER the background scan
            // already classified it -- see getStemAutoClassifyProgress's
            // own doc comment), which would show a >100% fraction; not
            // worth clamping for an edge case this cosmetic.
            ...(discoverConsented
              ? [
                  {
                    label: classifyProgress
                      ? `categorized ${classifyProgress.classified} / ${classifyProgress.eligible} stems`
                      : 'categorized …',
                    onClick: () => {},
                    disabled: true,
                    title: 'classified so far'
                  }
                ]
              : []),
            { label: 'keys and gestures…', onClick: () => setKeysModalOpen(true) },
            {
              label: 'audio…',
              onClick: () => {
                // Re-scans both lists right as the modal opens -- matches
                // the old inline dropdowns' own onFocus behavior (a device
                // can be installed/started after launch, and both scans
                // are cheap enough to redo rather than trust a stale first
                // fetch).
                fetchAndRestoreInputDevices()
                fetchOutputDevices()
                fetchBufferSize()
                setAudioModalOpen(true)
              }
            },
            endlesssStatus?.loggedIn
              ? {
                  label: `log out of endlesss (${endlesssStatus.username})`,
                  onClick: () => void window.rifffApi.endlesssLogout(),
                  danger: true
                }
              : { label: 'log into endlesss', onClick: onOpenEndlesss }
          ]}
          onClose={() => setSettingsMenu(null)}
        />
      )}

      {keysModalOpen && <KeyGesturesModal onClose={() => setKeysModalOpen(false)} />}

      {audioModalOpen && (
        <AudioDeviceModal
          onClose={() => setAudioModalOpen(false)}
          availableInputDevices={availableInputDevices}
          selectedInputDevice={selectedInputDevice}
          isAnyChannelArmed={isAnyChannelArmed}
          onChangeInput={(device) => {
            dispatch({ type: 'SET_SELECTED_INPUT_DEVICE', device })
            storeSelectedInputDevice(device)
          }}
          availableOutputDevices={availableOutputDevices}
          selectedOutputDevice={selectedOutputDevice}
          onChangeOutput={(device) => {
            if (device === null) return
            void window.rifffApi.engineSetOutputDevice(device).then((result) => {
              if (result.ok) {
                setSelectedOutputDevice(device)
              } else {
                console.error('TransportBar: failed to set output device:', result.error)
              }
            })
          }}
          bufferSize={bufferSize}
          onChangeBufferSize={(size) => {
            void window.rifffApi.engineSetBufferSize(size).then((result) => {
              if (result.ok) {
                setBufferSize(size)
              } else {
                console.error('TransportBar: failed to set buffer size:', result.error)
              }
            })
          }}
        />
      )}
    </div>
  )
}
