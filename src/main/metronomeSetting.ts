// src/main/metronomeSetting.ts -- the metronome's on/off and volume, as the playback engine
// should have them. Pure: index.ts hands it the engine client's send.
//
// Neither is part of the project the engine is re-sent after a crash
// (playbackEngineLifecycle.ts's respawn re-sends only the last load-project), and the renderer
// sends them only when they change, so a respawned engine used to play the click at its own
// defaults (off, or on at the engine's default volume) until the next change.

export type EngineSend = (type: string, payload: unknown) => void

export interface MetronomeSetting {
  /** Records the setting and sends it to the engine now. */
  apply(send: EngineSend, enabled: boolean, volume: number): void
  /** Sends the last applied setting to a freshly respawned engine; nothing if none yet. */
  resend(send: EngineSend): void
}

export function createMetronomeSetting(): MetronomeSetting {
  let last: { enabled: boolean; volume: number } | null = null
  return {
    apply(send, enabled, volume) {
      last = { enabled, volume }
      send('set-metronome', last)
    },
    resend(send) {
      if (last) send('set-metronome', last)
    }
  }
}
