# sssketch

The idea behind sssketch is to simplify the process of exporting rifffs from [Endlesss](https://endlesss.fm/), making arrangements, and exporting files that are easy to deal with in a full DAW.

For the moment it's a desktop app for macOS built on Electron and with a real-time native
audio engine (JUCE) running underneath for playback and (basic) plugin hosting.

**Status:** early beta. Expect rough edges — see [Known issues](#known-issues) below.

This app isn't affiliated with or endorsed by Endlesss or Hablab London. Use at your own risk.

## Getting your audio in

Two ways to bring stems into a project:

- **Drag and drop** — drag a collection of stems directly into a project library (from Endlesss or ... wherever, though Endlesss audio is the only audio we've been testing with.)
- **Log into Endlesss** — click "import" and sign in with your Endlesss account to
  browse your shared feed or private jams directly.

## The basic ideas

- **tidy up** — this idea is to semi-automatically group similar-sounding stems onto shared buses, using audio analysis so an arrangement doesn't turn into dozens of overlapping tracks. The machine guesses and the user approves or tells it to try another go.
- **re-one tool** - when you import a rifff or a collection of rifffs, you'll be presented with a screen to find the beginning of the loop. For short ones, find the first downbeat. For longer ones, find the beginning of the looped phrase. sssketch will 'rotate' the audio within the app without affecting the downloaded audio.
- **sketch and arranger modes** — sketch is the default mode, and it's meant to be a simple linear arrangement view for sequencing a collection of rifffs. you can change the number of bars by right-clicking and dragging on the riff(s) (to select multiple rifffs, hold cmd or shift.) the idea is to sketch out a flow before switching to the full "arranger" mode to fine-tune it a bit more.
- **tempo** - the first rifff you drag into the project will set the tempo
- **Various DAW exports** — writes real app project files for Ableton Live 12 and REAPER, with the tidied bus groupings mapped onto tracks and colors. You can also export stems of the tidied buses too.

## Installing

Grab the latest `.dmg` for your Mac from the [Releases page](../../releases/latest):

- **sssketch-X.Y.Z.dmg** — Apple Silicon (M1/M2/M3/M4)
- **sssketch-X.Y.Z-x64.dmg** — Intel

Not sure which you have? Apple menu → About This Mac — it lists the chip.

Drag `sssketch.app` from the `.dmg` into Applications to install. The app is signed and
notarized, so Gatekeeper should open it normally after you approve opening an app downloaded from the internet.

**Uninstalling:** drag `sssketch.app` to the Trash. Your saved sketches live in `~/Music/sssketch` (or wherever you chose on first launch) and
aren't touched; delete that folder too if you want them gone. App preferences and caches live
in `~/Library/Application Support/sssketch`.

## Running from source

Requires [Node.js](https://nodejs.org/) and [CMake](https://cmake.org/) (`brew install cmake`).

```bash
npm install
npm run dev
```

The audio engine is a separate native build (JUCE/C++) and isn't part of `npm run dev`:

```bash
cd native-engine
cmake -B build
cmake --build build
```

sssketch needs the engine built at least once before it can play any audio. After that,
`npm run dev` alone is enough for day-to-day work on the Electron/React side. The engine
doesn't hot-reload — after changing anything under `native-engine/`, rebuild it, then fully
quit and relaunch the app; a renderer reload alone won't pick up the new engine binary.

Tempo stretching needs the `rubberband` CLI (`brew install rubberband`) in dev mode. Packaged
release builds have it bundled.

### Other useful commands

```bash
npm run typecheck    # tsc, node + web configs
npm run lint          # eslint
npm test              # vitest (TypeScript/shared logic)
```

## Known issues

- Audio recording feels buggy as hell. I just wanted to see if I could add it really, but right now it's not very fun to use yet.
- Not all plugins will work, and they definitely won't stick in any exports beyond stem and mix audio. Best to use them sparingly until you can use a full DAW.

[open an issue](../../issues) if you hit something.

## Acknowledgments

I love [Endlesss](https://endlesss.fm/)! When I first downloaded it to my phone in 2020 it changed my relationship with music for the better, instantly connected me with a world of amazing people, and finally made me think of myself as a musician. Thank you to Tim Exile and the Endlesss team
for building it, and thank you to Imogen Heap and Hablab London for resuscitating it after the bankruptcy and closure.

sssketch would not exist without [OUROVEON](https://github.com/OUROcorp/OUROVEON), an
open-source toolkit for the Endlesss ecosystem developed by ishani. There is no published API for Endlesss and ishani and the OUROVEON team reverse-engineered the backend. sssketch's Endlesss integration leaned on it completely. sssketch can even open an existing OUROVEON/LORE-synced `warehouse.db3`
directly if you have one.

**Shared Features**

- **Audio Engine**
  - Real-time playback, device I/O, and VST3/AU plugin hosting via [JUCE](https://juce.com/)
  - Tempo sync with other apps/devices via [Ableton Link](https://github.com/Ableton/link)
  - Stem time-stretching via [Rubberband](https://breakfastquay.com/rubberband/)

- **App Shell**
  - Desktop app shell via [Electron](https://www.electronjs.org/)
  - UI built with [React](https://react.dev/)
  - Local riff library database via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
  - Ableton Live project export via [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)
  - Build, packaging, and auto-update tooling via [electron-vite](https://electron-vite.org/),
    [electron-builder](https://www.electron.build/), and
    [electron-updater](https://www.electron.build/auto-update)

## License

[GPL-3.0-or-later](LICENSE).

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
