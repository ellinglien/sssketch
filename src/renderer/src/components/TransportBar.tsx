import { useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePos, usePlaying } from '../state/StoreContext'
import { positionLabel, elapsedLabel } from '@shared/visuals'
import { loopLengthBars } from '../state/selectors'
import { stopActivePreview } from '../audio/previewLoop'
import { MasterChainPanel } from './MasterChainPanel'
import { ContextMenu } from './ContextMenu'

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

// A plain triangle-body + pendulum-arm silhouette, monochrome via
// currentColor -- matches this app's existing convention of drawing
// transport glyphs directly (▶/■ elsewhere in this same file) rather than
// pulling in an icon library, and its "no emoji in chrome" design-system
// rule (CLAUDE.md).
function MetronomeIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M5 14 L8 2 L11 14 Z" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="8" y1="12" x2="11" y2="4" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="9.7" cy="7" r="1" fill="currentColor" stroke="none" />
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

export function TransportBar({
  onOpenClusterStems,
  onEnableGatedRecording,
  onDisableGatedRecording,
  onStop
}: {
  onOpenClusterStems: () => void
  onEnableGatedRecording: () => void
  onDisableGatedRecording: () => void
  // Separate from a plain STOP dispatch -- App.tsx's handleStop also checks
  // for an uncommitted gated-recording pass first (see its own doc
  // comment), which needs state this component doesn't have direct access
  // to construct itself.
  onStop: () => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const pos = usePos()
  const playing = usePlaying()
  const [masterChainPanelOpen, setMasterChainPanelOpen] = useState(false)
  const [gearMenu, setGearMenu] = useState<{ x: number; y: number } | null>(null)

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
            ? 'recording mode is on -- listening for the selected loop region, press \\ to lock in the latest pass. click to disable.'
            : state.loopRegion
              ? 'enable gated recording for the selected loop region'
              : 'select a loop region first (drag on the ruler)'
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
        <span
          style={{ fontSize: 16, fontWeight: 700, width: '7ch', display: 'inline-block' }}
          title="remaining"
        >
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
            height: 22,
            width: 22,
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
            fontWeight: 700,
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
        title="Ableton Link — sync tempo with other Link-enabled apps on this network"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: linkStatus.enabled ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: linkStatus.enabled ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        link{linkStatus.enabled && linkStatus.numPeers > 0 ? ` · ${linkStatus.numPeers}` : ''}
      </button>

      <button
        onClick={() => dispatch({ type: 'TOGGLE_VOLUME_DRAG_MODE' })}
        aria-label="Toggle volume drag mode"
        title={state.volumeDragMode ? 'envelope drag: on (V)' : 'envelope drag: off (V)'}
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.volumeDragMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        envelope
      </button>

      <button
        onClick={() => setMasterChainPanelOpen((open) => !open)}
        aria-label="Toggle master chain panel"
        title="master plugin chain"
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
        fx on main
      </button>
      {masterChainPanelOpen && <MasterChainPanel onClose={() => setMasterChainPanelOpen(false)} />}

      <button
        onClick={() => dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })}
        title="add another recording channel (/)"
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
        + rec channel
      </button>

      <button
        onClick={(e) => {
          // Toggles closed if already open, rather than always re-opening/
          // repositioning -- without this, clicking the same trigger
          // button again while the menu is already open raced against
          // ContextMenu's own capture-phase outside-click dismissal (which
          // fires first, since it's on window in the capture phase and this
          // button's onClick runs in the bubble phase): the menu closed and
          // then immediately re-opened in the same click, which visually
          // read as "clicking the button again does nothing" instead of
          // the expected close. Per direct feedback.
          if (gearMenu) {
            setGearMenu(null)
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          setGearMenu({ x: rect.left, y: rect.bottom + 4 })
        }}
        aria-label="More arranger options"
        title="tidy up / tidy view"
        data-tour-id="tour-tidy"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.tidiedView ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.tidiedView ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.tidiedView ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        tidy
      </button>
      {gearMenu && (
        <ContextMenu
          x={gearMenu.x}
          y={gearMenu.y}
          items={[
            { label: 'tidy up', onClick: onOpenClusterStems },
            {
              label: state.tidiedView ? 'tidy view: on' : 'tidy view: off',
              onClick: () => dispatch({ type: 'TOGGLE_TIDIED_VIEW' })
            }
          ]}
          onClose={() => setGearMenu(null)}
        />
      )}

      <select
        value={selectedInputDevice ?? ''}
        disabled={isAnyChannelArmed}
        title={
          isAnyChannelArmed
            ? 'disarm the current recording before changing the input device'
            : undefined
        }
        onFocus={() => {
          // Re-fetches on every focus, not just while the list is still
          // empty -- a device (e.g. a loopback driver) can be
          // installed/started after the app launched, and the engine's
          // own scanForDevices() call (see Transport::
          // availableInputDeviceNames) is cheap enough to redo each
          // time rather than only ever trusting a stale first fetch.
          fetchAndRestoreInputDevices()
        }}
        onChange={(e) => {
          const device = e.target.value || null
          dispatch({ type: 'SET_SELECTED_INPUT_DEVICE', device })
          storeSelectedInputDevice(device)
        }}
        style={{
          fontFamily: 'inherit',
          fontSize: 10,
          color: 'var(--ra-text)',
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          padding: '5px 8px',
          cursor: isAnyChannelArmed ? 'not-allowed' : 'pointer'
        }}
      >
        <option value="">
          {availableInputDevices.length === 0 ? 'no input devices found' : 'select input device...'}
        </option>
        {availableInputDevices.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  )
}
