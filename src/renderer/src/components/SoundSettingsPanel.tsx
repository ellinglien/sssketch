// src/renderer/src/components/SoundSettingsPanel.tsx -- the radio sound's settings (native radio
// sound plan, docs/superpowers/plans/2026-10-01-native-radio-sound.md, Task 13).
//
// TWO BINDINGS, ONE PANEL, built like MasterChainPanel (the same backdrop, the same box):
//   `project`  -- opened from TransportBar's sound button: this project's mixer-level sound. Every
//                 change is one SET_SOUND_SETTINGS (undoable, saved with the project).
//   `defaults` -- opened from the gear menu's "sound defaults…": the app-wide defaults a new
//                 project (and a project saved before the radio sound) starts from, read and
//                 written over sound-settings:get/:set. Changing them never touches the open
//                 project; "use these in this project" and "make this project's the default" are
//                 the only bridges, and "reset to defaults" puts everything back on.
//
// What each row shows, what is greyed out and what each control changes is soundPanelModel's
// (@shared/soundPanelModel, tested); this file only draws it.
//
// SLIDERS COMMIT ON RELEASE. A drag keeps its value here, in the slider, and the readout follows
// it; letting go dispatches ONE change. So undo gets one step per drag, and the engine is not
// reloaded per frame (StoreContext's sync effect depends on state.sound: each change there is a
// full project reload and a re-plan of the throws). Nothing is heard until the release -- there is
// no live preview path, deliberately (a load-project per frame is not acceptable, and a light
// live path for nine parameters is more than this panel is worth). A keyboard step (arrows) is a
// release of its own: one change per key press.
//
// DEV READOUTS. In a dev build only (import.meta.env.DEV, the flag perf/radioTrace.ts and
// perf/workCounters.ts use), the project panel polls the engine's master meters
// (engine-get-sound-meters) while it is open: the glue's and the limiter's gain reduction and the
// pump's duck, at the end of the engine's last block. A packaged build never asks.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  mergeSoundSettings,
  normalizeSoundSettings,
  type SoundMeters,
  type SoundSettings,
  type SoundSettingsPatch
} from '@shared/radioSound'
import {
  signedDb,
  soundPanelModel,
  type SoundChoiceControl,
  type SoundPanelRow,
  type SoundSliderControl,
  type SoundSwitchControl
} from '@shared/soundPanelModel'
import { useAppSelector, useDispatch } from '../state/StoreContext'
import { projectSoundSettings } from '../state/selectors'
import { appSoundDefaults, forgetAppSoundDefaults } from '../state/appSoundDefaults'

const DEV_READOUTS = import.meta.env.DEV && import.meta.env.MODE !== 'test'
const METER_POLL_MS = 250

/** MasterChainPanel's button, with sharp corners (tokens.css: no border-radius anywhere). */
function buttonStyle(disabled?: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: 'var(--ra-s-0) 8px',
    background: 'var(--ra-bg-row-active)',
    border: `1px solid ${disabled ? 'var(--ra-border-soft)' : 'var(--ra-border)'}`,
    borderRadius: 0,
    color: disabled ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
    cursor: disabled ? 'not-allowed' : 'pointer'
  }
}

/** DiscoverRadioMenu's chip: a selected chip is a brighter border and ink, never a colour. */
function Chip({
  label,
  on,
  disabled,
  onClick
}: {
  label: string
  on: boolean
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        fontFamily: 'inherit',
        fontSize: 9,
        padding: 'var(--ra-s-0) 8px',
        background: on ? 'var(--ra-bg-row-active)' : 'transparent',
        border: `1px solid ${on ? 'var(--ra-text)' : 'var(--ra-border)'}`,
        borderRadius: 0,
        color: on ? 'var(--ra-text)' : 'var(--ra-text-2)',
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {label}
    </button>
  )
}

const labelStyle: React.CSSProperties = {
  width: 84,
  flexShrink: 0,
  fontSize: 9,
  color: 'var(--ra-text-3)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--ra-track-eyebrow)'
}

/** A slider that keeps a drag's value to itself and commits once, on release. */
function SoundSlider({
  control,
  onCommit
}: {
  control: SoundSliderControl
  onCommit: (patch: SoundSettingsPatch) => void
}): React.JSX.Element {
  const [live, setLive] = useState<number | null>(null)
  const liveRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const value = live ?? control.value
  const fill = ((value - control.min) / (control.max - control.min)) * 100

  // The release. `control` and `onCommit` are the ones from the drag's start (a window listener
  // holds them): the patch depends only on the control's field, and onCommit only dispatches or
  // merges, so neither can be stale in a way that matters.
  function commit(): void {
    draggingRef.current = false
    const v = liveRef.current
    liveRef.current = null
    setLive(null)
    if (v !== null && v !== control.value) onCommit(control.patch(v))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12 }}>
      <span style={{ ...labelStyle, width: 72, textTransform: 'none', letterSpacing: 0 }}>
        {control.label}
      </span>
      <input
        className="sound-settings-slider"
        type="range"
        aria-label={control.label}
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        disabled={control.disabled}
        onPointerDown={() => {
          draggingRef.current = true
          // whichever ends the drag first, once; the other listener goes with it
          const ended = new AbortController()
          const release = (): void => {
            ended.abort()
            commit()
          }
          window.addEventListener('pointerup', release, { signal: ended.signal })
          window.addEventListener('pointercancel', release, { signal: ended.signal })
        }}
        onChange={(e) => {
          const v = Number(e.target.value)
          liveRef.current = v
          setLive(v)
          // not a drag (the keyboard): every step is its own release
          if (!draggingRef.current) commit()
        }}
        style={{
          flex: 1,
          minWidth: 0,
          opacity: control.disabled ? 0.3 : 1,
          cursor: control.disabled ? 'not-allowed' : 'pointer',
          background: `linear-gradient(to right, var(--ra-stretch-on) ${fill}%, var(--ra-border) ${fill}%)`
        }}
      />
      <span
        style={{
          width: 86,
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 9,
          color: control.disabled ? 'var(--ra-text-4)' : 'var(--ra-text)'
        }}
      >
        {control.readout(value)}
      </span>
    </div>
  )
}

function Row({
  row,
  onCommit
}: {
  row: SoundPanelRow
  onCommit: (patch: SoundSettingsPatch) => void
}): React.JSX.Element {
  const chips = row.controls.filter(
    (c): c is SoundSwitchControl | SoundChoiceControl => c.kind !== 'slider'
  )
  const sliders = row.controls.filter((c): c is SoundSliderControl => c.kind === 'slider')
  return (
    <div
      role="group"
      aria-label={row.label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 0',
        borderTop: '1px solid var(--ra-border-soft)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, color: row.greyed ? 'var(--ra-text-4)' : labelStyle.color }}>
          {row.label}
        </span>
        {chips.map((c) =>
          c.kind === 'switch' ? (
            <span key={c.id} style={{ display: 'flex', gap: 4 }}>
              <Chip
                label="on"
                on={c.on}
                disabled={c.disabled}
                onClick={() => !c.on && onCommit(c.patch(true))}
              />
              <Chip
                label="off"
                on={!c.on}
                disabled={c.disabled}
                onClick={() => c.on && onCommit(c.patch(false))}
              />
            </span>
          ) : (
            <span key={c.id} style={{ display: 'flex', gap: 4 }}>
              {c.options.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  on={c.value === o.value}
                  disabled={c.disabled}
                  onClick={() => c.value !== o.value && onCommit(c.patch(o.value))}
                />
              ))}
            </span>
          )
        )}
        {row.hint && (
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--ra-text-3)' }}>
            {row.hint}
          </span>
        )}
      </div>
      {sliders.map((c) => (
        <SoundSlider key={c.id} control={c} onCommit={onCommit} />
      ))}
    </div>
  )
}

/** The engine's master meters, polled while mounted (dev builds only; see the file comment). */
function DevReadouts(): React.JSX.Element {
  const [meters, setMeters] = useState<SoundMeters | null>(null)
  useEffect(() => {
    let alive = true
    const poll = (): void => {
      void window.rifffApi.engineGetSoundMeters().then((m) => {
        if (alive) setMeters(m)
      })
    }
    poll()
    const id = setInterval(poll, METER_POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  const read = (db: number | undefined): string => (db === undefined ? '…' : signedDb(db))
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        paddingTop: 6,
        borderTop: '1px solid var(--ra-border-soft)',
        fontSize: 9,
        color: 'var(--ra-text-3)'
      }}
    >
      <span>dev</span>
      <span>glue {read(meters?.glueGrDb)}</span>
      <span>pump {read(meters?.pumpDuckDb)}</span>
      <span>limiter {read(meters?.limiterGrDb)}</span>
    </div>
  )
}

const sameSettings = (a: SoundSettings, b: SoundSettings): boolean =>
  JSON.stringify(normalizeSoundSettings(a)) === JSON.stringify(normalizeSoundSettings(b))

export function SoundSettingsPanel({
  mode,
  onClose
}: {
  mode: 'project' | 'defaults'
  onClose: () => void
}): React.JSX.Element {
  const dispatch = useDispatch()
  const projectSound = useAppSelector((s) => s.sound)
  const project = useMemo(() => projectSoundSettings({ sound: projectSound }), [projectSound])

  // The app-wide defaults (mode `defaults` only): fetched as the panel opens, then kept here as
  // the truth while it is open -- each change is written straight back.
  const [defaults, setDefaults] = useState<SoundSettings | null>(null)
  const defaultsRef = useRef<SoundSettings | null>(null)
  useEffect(() => {
    if (mode !== 'defaults') return
    let alive = true
    void window.rifffApi
      .getSoundSettings()
      .catch(() => undefined)
      .then((s) => {
        if (!alive || defaultsRef.current !== null) return
        const next = normalizeSoundSettings(s)
        defaultsRef.current = next
        setDefaults(next)
      })
    return () => {
      alive = false
    }
  }, [mode])

  /** Write the app-wide defaults, then make the renderer's memo of them fetch again (Task 2's
   * review: forgetAppSoundDefaults), so the next new project and appSoundDefaultsNow() see them. */
  function saveDefaults(next: SoundSettings): void {
    defaultsRef.current = next
    setDefaults(next)
    void window.rifffApi
      .setSoundSettings(next)
      .then(() => {
        forgetAppSoundDefaults()
        void appSoundDefaults()
      })
      .catch((err: unknown) =>
        console.error('SoundSettingsPanel: could not save the sound defaults:', err)
      )
  }

  const shown = mode === 'project' ? project : defaults
  const rows = useMemo(() => (shown ? soundPanelModel(shown) : []), [shown])

  function commit(patch: SoundSettingsPatch): void {
    if (mode === 'project') {
      dispatch({ type: 'SET_SOUND_SETTINGS', settings: patch })
      return
    }
    const base = defaultsRef.current
    if (base) saveDefaults(mergeSoundSettings(base, patch))
  }

  const projectIsDefault = defaults !== null && sameSettings(defaults, project)

  // The backdrop closes the panel on a click that STARTED on it: a slider drag let go over the
  // backdrop also ends in a click there (on the common ancestor), and must not close it.
  const downOnBackdropRef = useRef(false)

  return (
    <div
      onPointerDown={(e) => {
        downOnBackdropRef.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdropRef.current) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-anchored)',
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {/* MasterChainPanel-style box; the range input's look is ClusterStemsBrowser's slider
          (a plain <style> tag, sharp corners, the thumb in the toggle-on ink). */}
      <style>{`
        .sound-settings-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 2px;
          outline: none;
        }
        .sound-settings-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 10px;
          height: 10px;
          background: var(--ra-stretch-on);
          border: 1px solid var(--ra-stretch-on);
        }
      `}</style>
      <div
        role="dialog"
        aria-label={mode === 'project' ? 'sound' : 'sound defaults'}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 10,
          width: 360,
          maxHeight: '85vh',
          overflowY: 'auto',
          fontSize: 11
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4
          }}
        >
          <span style={{ color: 'var(--ra-text-2)' }}>
            {mode === 'project' ? 'sound' : 'sound defaults'}
          </span>
          <button
            onClick={onClose}
            aria-label={mode === 'project' ? 'close sound panel' : 'close sound defaults'}
            style={buttonStyle()}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: 9, color: 'var(--ra-text-3)', margin: '0 0 6px' }}>
          {mode === 'project'
            ? 'this project. saved with it; exports follow it.'
            : 'new projects, and projects saved before these existed, start from these. the open project is not changed.'}
        </p>

        {shown === null ? (
          <div style={{ fontSize: 9, color: 'var(--ra-text-3)', padding: '6px 0' }}>…</div>
        ) : (
          rows.map((row) => <Row key={row.stage} row={row} onCommit={commit} />)
        )}

        {mode === 'defaults' && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              paddingTop: 8,
              borderTop: '1px solid var(--ra-border-soft)'
            }}
          >
            <button
              disabled={defaults === null || projectIsDefault}
              onClick={() => {
                if (defaults) dispatch({ type: 'SET_SOUND_SETTINGS', settings: defaults })
              }}
              style={buttonStyle(defaults === null || projectIsDefault)}
            >
              use these in this project
            </button>
            <button
              disabled={defaults === null || projectIsDefault}
              onClick={() => saveDefaults(normalizeSoundSettings(project))}
              style={buttonStyle(defaults === null || projectIsDefault)}
            >
              make this project&apos;s the default
            </button>
            <button
              disabled={defaults === null}
              onClick={() => saveDefaults(normalizeSoundSettings(undefined))}
              style={buttonStyle(defaults === null)}
            >
              reset to defaults
            </button>
          </div>
        )}

        {mode === 'project' && DEV_READOUTS && <DevReadouts />}
      </div>
    </div>
  )
}
