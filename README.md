# sssketch

sssketch turns [Endlesss](https://endlesss.fm/) stem exports ("rifffs") into a real arrangement:
drop them onto a timeline, trim and offset them against each other, group similar-sounding
stems together automatically, and export the whole thing as an Ableton Live project you can
keep mixing in a proper DAW.

It's a desktop app for macOS (Apple Silicon), built on Electron with a real-time audio engine
running underneath for playback and plugin hosting.

**Status:** early beta. Expect rough edges — see [Known issues](#known-issues) below.

## Getting your audio in

Two ways to bring stems into a project:

- **Drag and drop** — any rifff export folder (or its loose stem files) onto the shelf.
- **Log into Endlesss** — click "import" in the shelf, sign in with your Endlesss account, and
  browse your shared feed or private jams directly. No separate export step needed.

## The basics

- **rifff** — a single Endlesss jam moment: up to 8 stems (drum, bass, mic, etc.) that were
  playing together.
- **tidy up** — automatically groups similar-sounding stems onto shared buses (by real audio
  analysis, not just instrument labels), so an arrangement doesn't turn into 30 overlapping
  tracks.
- **sketch mode** — a simplified, linear view of the arrangement for quickly laying out a rough
  structure before switching back to the full timeline ("arranger" mode) to fine-tune it.
- **Ableton export** — writes a real `.als` project file, with your bus groupings mapped onto
  Ableton tracks and colors. Requires Ableton Live 12 or later — the exported project file's
  format isn't backward-compatible with older versions.

## Installing

**[Download sssketch 1.0.0 for macOS (Apple Silicon)](https://github.com/ellinglien/sssketch/releases/download/v1.0.0/sssketch-1.0.0.dmg)**
— or see the [Releases](../../releases) page for other versions.

Drag `sssketch.app` from the `.dmg` into Applications to install.

No signed release build yet, so macOS Gatekeeper will refuse to open it — on current macOS this
usually shows up as **"sssketch" is damaged and can't be opened**, not the older, friendlier
"unidentified developer" prompt, and right-clicking → Open doesn't fix it. The app isn't actually
damaged; it just isn't notarized. Clear the quarantine flag from Terminal instead:

```bash
xattr -cr /Applications/sssketch.app
```

Then open it normally. You only need to do this once per install.

**Uninstalling:** drag `sssketch.app` to the Trash — nothing else is installed system-wide. Your
saved sketches live in `~/Music/sssketch` (or wherever you chose on first launch) and aren't
touched; delete that folder too if
you want them gone. App preferences/caches live in `~/Library/Application Support/sssketch`.

## Running from source

Requires [Node.js](https://nodejs.org/) and [CMake](https://cmake.org/) (`brew install cmake`).

```bash
npm install
npm run dev
```

The audio engine is a separate native build (JUCE/C++), not part of `npm run dev`:

```bash
cd native-engine
cmake -B build
cmake --build build
```

sssketch needs the engine built at least once before it'll play any audio; after that,
`npm run dev` alone is enough for day-to-day work on the Electron/React side. If you change
anything under `native-engine/`, rebuild it and fully quit and relaunch the app — a renderer
reload alone won't pick up the new engine binary.

Tempo stretching needs the `rubberband` CLI (`brew install rubberband`) in dev mode — packaged
release builds bundle it, so end users don't need this.

### Other useful commands

```bash
npm run typecheck    # tsc, node + web configs
npm run lint          # eslint
npm test              # vitest (TypeScript/shared logic)
```

## Known issues

None tracked right now — [open an issue](../../issues) if you hit something.

## License

[GPL-3.0-or-later](LICENSE).

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
