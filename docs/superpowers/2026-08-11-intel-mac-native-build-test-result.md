# Intel Mac native build — test result (2026-08-11)

**Verdict: ✅ sssketch runs fully on real Intel silicon, indistinguishable from the arm64
build.** Confirmed both by automated verification and by Elling using the app interactively
("runs well… acts like the silicon version").

## Environment

- **Machine:** Intel Mac mini (2018), Core i7-8700B, **x86_64** (native, no Rosetta)
- **OS:** macOS 14.6.1 (23G93)
- **Toolchain:** Homebrew cmake 4.4.2, rubberband 4.0.0, node 22, AppleClang 15
- Fresh `git clone`, native build (`cmake -B build && cmake --build build --config Release`),
  then `npm run dev`. No cross-compilation and no `native-engine-bridge` (not needed on real
  Intel — the main engine hosts x86_64 plugins directly).

## What was verified

| Check | Result |
|---|---|
| Native build | Engine is a genuine `x86_64` Mach-O linking CoreAudio/AudioToolbox directly; `npm install` rebuilt better-sqlite3 for x64; esbuild/Electron all `darwin-x64` |
| Engine unit tests (`--test`) | **All unit tests passed** on Intel |
| CoreAudio **output** binding | Engine opens default output ("Mac mini Speakers" @48 kHz) and reports `serving on 127.0.0.1:<port>` |
| Audio pipeline (`--render-test`) | Offline render of the 2-stem demo rifff → real, non-silent stereo, **peak −1.9 dBFS**, correct duration |
| **Realtime** playback (`--serve` + `--test-client`) | Transport position advances via the CoreAudio callback — real-time output confirmed |
| Electron app + UI | Full Silkscreen monochrome UI renders (transport, library, inspector); `IpcConnection: client connected` — Electron↔engine IPC handshake succeeds |
| Interactive use | Elling played with the running app; behaves like the Silicon version |

CoreAudio device binding and real-time playback on Intel hardware — the one thing the arm64
cross-compile test could never prove — **works**.

## The one wrinkle: a first-launch microphone-permission prompt (not an Intel problem)

When first run in a **non-interactive (agent) context**, the engine **hung on startup** and the
app came up engine-less. Root cause (stack-sampled):

- `Transport::openDefaultDevice()` (`native-engine/Source/Transport.cpp:48`) requests an input
  channel — `initialiseWithDefaultDevices(1, 2)` — which opens the default **input** device.
- On this Mac mini (no built-in mic) the default input is a virtual "Loopback Audio" (Rogue
  Amoeba) device. Opening any input trips the macOS **microphone permission (TCC)** gate.
- The unsigned background (LSUIElement) engine binary, in a context that can't answer the
  permission dialog, blocks forever in `AudioDeviceCreateIOProcID` →
  `TellServerAboutStreamUsage` → `mach_msg` to `coreaudiod` — **before** the IPC socket binds,
  so Electron's 10 s readiness timeout fires.

**Once the mic prompt was granted interactively, the unmodified `(1, 2)` shipping binary reached
`serving` instantly — no hang.** That's exactly why the app works for a human at the machine and
only appeared broken to the agent. Isolated/confirmed via a stack sample and a diagnostic
output-only rebuild (`(0, 2)`, reverted afterward).

**Not caused by Intel silicon** — output, DSP, and realtime playback are all proven. The gate is
input-device-open + TCC. It very likely also affects a **fresh arm64** install; the dev Mac
just has the permission already granted.

## Recommendation for shipping Intel

The **engine** bundle's `Info.plist` currently has **no `NSMicrophoneUsageDescription`** (only the
Electron bundle declares one, via `electron-builder.yml`). For a signed/notarized Intel release:

1. Add `NSMicrophoneUsageDescription` to the engine's CMake `PLIST_TO_MERGE` so the first-launch
   mic prompt is clean and explained (and a proper signed app prompts instead of hanging); **and/or**
2. Don't open an input device at startup at all — go output-only until record-arm actually needs
   one — removing the mic dependency from the playback path entirely.

## Deferred next step (not started, intentional)

Make Intel a permanent CI release target — either cross-compile in `release.yml` or add a real
Intel GitHub Actions runner. Now that Intel is proven to work, that's a fresh design conversation;
fold the engine-bundle mic-permission fix above into the same effort.

## Note

The `docs/superpowers/specs/2026-08-11-intel-mac-test-build-design.md` referenced in the task is
**not** in the repo (newest committed doc is dated 2026-08-09) — it was never pushed. This work
proceeded from the task instructions directly.
