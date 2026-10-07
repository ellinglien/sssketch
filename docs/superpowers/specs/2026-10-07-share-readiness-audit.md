# Share-readiness audit (2026-10-07)

Elling's ask: "make sure it doesn't have elling stuff baked into it and it's possible for others to
use it fully". This is an audit only. No code was changed. The fix plan is at the end.

## How this was checked

- Case-insensitive greps of `src/`, `native-engine/Source/`, `scripts/`, `build/`, `resources/`,
  `.github/`, `electron-builder.yml`, `package.json` and `README.md`. The terms were `elling`,
  `ellinglien`, `nickel`, `ell.ing`, `/Users/nickel`, `/Volumes`, `bananepoep`, `seasickcookie`,
  `band<hex>` jam ids, hardcoded URLs, `fetch(`, POST requests, telemetry and crash-reporter names.
  Comment-only hits were then separated from code.
- **The shipped v1.4.0 release was downloaded and unpacked** (`sssketch-1.4.0-arm64.zip`). Its
  `app.asar` was listed and extracted, and the update feed `latest-mac.yml` was read.
- **Fresh-profile check (main process):** a throwaway vitest file pointed `app.getPath` at an empty
  temp directory, with no LORE archive, no Endlesss session and no username. It then ran the startup
  path:
  - `loadOwnUsername`
  - `riffLibraryRootPath`, `openOwnRiffLibraryDb` and `candidateDbsForRiff`
  - `listJams`
  - `whenTableCountsSeeded`, then `prewarmDiscoverCandidateCaches` with `ownUsername: () => null`
  - `getDiscoverCandidates` and `loadDiscoverSettings`
  - `readYamnetModelBytes`

  Results:
  - Everything ran without error, with zero `console.error` calls.
  - `onUsable` fired, so the startup gate opens.
  - The own library was created at `~/Music/sssketch/library/cache/common/warehouse.db3`.
  - Jams: 0. Candidates: `[]`. Consent: false.

  The file was deleted after the run and is not committed.
- **Not possible here:** clicking through the GUI, real audio, a real Endlesss login, a real phone, or
  an Intel Mac. Every UI claim below is traced from code, not seen. Each is marked as such where it
  matters.

---

## Findings

### Blockers

#### B1. A stranger who isn't logged in becomes "elling"

**Where:**
- `src/shared/riffLibraryTypes.ts:9` (`RIFF_LIBRARY_USERNAME = 'elling'`)
- `src/renderer/src/components/LibraryBrowser.tsx:78-103` (`loadStoredRiffLibraryUsername` falls back
  to it)
- `LibraryBrowser.tsx:452-456` (`riffLibraryUsername`: if nothing was typed and there is no session,
  the value is `storedUsername`, which is `'elling'`)
- `LibraryBrowser.tsx:2242` (the "your username" box is bound to it)
- `LibraryBrowser.tsx:2538` (passed to Discover as `currentUsername`)
- `src/main/riffLibraryStore.ts:658` and `riffLibraryTypes.ts:228` (`computeOwnerFraction` defaults
  its `targetUser` to `'elling'`)

**What happens:** someone with a LORE archive (or just the import browser open) and no Endlesss login
gets all of the following:
- **The username box reads `elling`.** It leaks his handle and tells the person nothing.
- **"only my jams" starts ON** (`LibraryBrowser.tsx:130-149`). It hides every jam where the archive
  says none of the riffs are elling's (`jamMightBeMine`, `jamOwnership.ts`). A LORE archive records
  authorship for every riff (0 blank of 372k on his). So for a stranger the sidebar comes up nearly
  empty: only jams that Elling himself played in survive.
- **Ownership brightness and "only mine"** score riffs against elling's stems.
- **Discover starts with the `mine` filter ON** (`DiscoverPanel.tsx:667`,
  `DEFAULT_GLOBAL_MODIFIERS = ['mine']`). `hasUsername` is true because `'elling'` is not blank
  (`DiscoverPanel.tsx:1092`, `discoverSlotModifier.ts:45`), so every roll is restricted to Elling's
  stems. On a stranger's archive that means **empty rolls**. If the archive does hold Elling's stems,
  they get his stems presented as "theirs". Radio draws from the same pool.
- **Main and renderer disagree.** `riffLibraryUsername.ts` (background own-first priority, the startup
  own index, `ownUsername.json`) deliberately ignores the fallback and resolves no username. The
  renderer's Discover and browser use `'elling'`. Two different "me"s in one app.

**Fix:**
- Delete the `'elling'` default. "No username" becomes `''` / `null` everywhere.
- Make `loadStoredRiffLibraryUsername` return `''`.
- Give `computeOwnerFraction` no default, so an absent user scores 0.
- With no username:
  - the box shows its placeholder;
  - "only my jams" and `mine` are inert (already true when `hasUsername` is false);
  - a one-line hint says "log into endlesss or type your endlesss username to see your own jams
    first".
- Have the renderer read its "me" from one resolver (`riffLibraryUsername.ts`), so it can't drift from
  main again.
- Existing installs: Elling's machine has the key stored, or a session, so nothing changes for him.
  An install that never stored a key and had been silently running as `elling` will now run as
  nobody, which is correct.
- Tests: `riffLibraryTypes.test.ts` expects the default and needs updating.

#### B2. The shipped app is about 3x bigger than it should be, because the repo is in the bundle

**Where:** `electron-builder.yml:6-14`. `files:` is a short blocklist on top of electron-builder's
include-everything default, and `asarUnpack: resources/**`.

**Measured in v1.4.0** (`app.asar` is 488 MB; each zip is about 285-295 MB):

| In `app.asar` | Size | Needed at runtime? |
|---|---|---|
| `native-engine/` (whole CMake build dir incl. JUCE `_deps`, sources, tests) | 177 MB | no (the engine ships via `extraResources`) |
| `node_modules/onnxruntime-web` | 136 MB | no (vite already bundles the wasm into `out/renderer/assets/ort-wasm-simd-threaded-*.wasm`) |
| `native-engine-bridge/` (build dir) | 128 MB | no (ships via `extraResources`) |
| `docs/` (226 files of specs/plans) | 10 MB | no |
| `fixtures/` (six of his 2020 stems) | 10 MB | no |
| `scripts/`, `CLAUDE.md`, `AI_DISCLOSURE.md`, `vitest.config.ts` | small | no |
| `out/` (the actual app) | 16 MB | **yes** |

On top of that, `resources/**` is unpacked into `app.asar.unpacked/resources` (18 MB) *and* copied
again by `extraResources` (`demo-rifff`, `rubberband`), so it ships twice.

**Why it matters:**
- Strangers download about 3x what they need.
- Every auto-update re-downloads it all.
- The bundle carries the agent handoff (`CLAUDE.md`) and every design doc, including notes about his
  library sizes, home network addresses and named jam-mates.
- All of it is already public on GitHub, so nothing new leaks. But none of it belongs in the app.

**Fix:**
- Switch `files:` to an allowlist: `out/**`, `package.json`, `resources/icon.png`.
- Move `onnxruntime-web` to `devDependencies`. Main never imports it; vite bundles it for the
  renderer.
- Drop `asarUnpack: resources/**`. Everything there is read from `process.resourcesPath` when
  packaged (`demoRifff.ts:13`, `yamnetModel.ts:15`, `rubberband.ts:35`). `build/afterPack.js:123`
  signs only `Contents/Resources/rubberband`, so the unpacked duplicate is just an extra unsigned-by-
  afterPack copy.
- Keep `better-sqlite3` unpacked (builder does that automatically for `.node`).
- Verify by listing a fresh `npm run build:mac` asar. Expect roughly 20-30 MB.

#### B3. Every shipped build is missing the YAMNet model, so Discover's similarity runs degraded for everyone except Elling

**Where:**
- `electron-builder.yml:30` copies `resources/yamnet`, and its comment says `scripts/vendor-yamnet.sh`
  runs in CI "same as rubberband".
- It doesn't. `.github/workflows/release.yml` vendors rubberband (line 150) and has no yamnet step.
- Confirmed in the v1.4.0 zip: there is no `Contents/Resources/yamnet/yamnet.onnx`.
- `src/main/yamnetModel.ts:13-41` returns `null`, and `yamnetClient.ts:92` throws "model bytes
  unavailable".

**Why it matters:**
- Elling's dev build has the model, so he has never seen this.
- Every tester gets no embeddings and no zero-shot. The fallback is graceful, so nothing announces it.
- Likely, but not verified: `stemAnalysisNeeds.ts` keeps reporting `embedding: true` for every stem
  because no row is ever written. If so, each consented library pass decodes stems that can never
  finish, which wastes CPU on a large library.

**Fix:**
- Add a "Vendor YAMNet" step to `release.yml` after "Vendor rubberband":
  `bash scripts/vendor-yamnet.sh`. It downloads from Hugging Face with a size check.
- Add a CI assertion that `dist/**/Contents/Resources/yamnet/yamnet.onnx` exists before publish.
- Separately, record "model unavailable" so the scan doesn't re-queue embeddings forever (follow-up,
  small).

### Should-fix

#### S1. "fetch hearts" and "radio hearts key…" are Elling-only features shown to everyone

**Where:**
- `src/shared/radioHearts.ts:11` (`https://ell.ing/radio/api/hearts.json`, a private bearer key)
- The Discover buttons at `DiscoverPanel.tsx:~13397` and `~13909`
- The settings item at `TransportBar.tsx:1053`

**Why it matters:** the hearts are visitors' hearts on *his* web radio, built from *his* stems. A
stranger has no key and can't get one. The button returns "no key". This is dead UI that points at
his server. It's harmless otherwise: no request is made without a key, and the key is stored
encrypted (`radioHeartsKeyStore.ts`).

**Fix:**
- Show the Discover button only when a key is stored (`radioHeartsKeyStatus`).
- Move "radio hearts key…" behind an alt/option-click on the settings menu, or into an "advanced"
  sub-list.
- Keep the code.

#### S2. Discover's source dial defaults to 95% "your own recordings", which is his taste and library shape

**Where:** `src/shared/discoverSlotModifier.ts:51-57`. `DEFAULT_SOURCE_LEAN = 95`, and the comment
quotes Elling: "95% own sounds".

**Why it matters:** most Endlesss users' libraries are mostly built-in instrument stems. At 95, most
rolls hunt the few audio-in stems, and the same handful repeats. It falls back to Endlesss only when a
kind has *no* recordings.

**Fix:** default to 50, the dial's documented half-and-half, for new installs. Saved settings keep
their value. Or derive the starting point from the library's actual share (heavier). Question for
Elling: Q3.

#### S3. Plugin scan only looks in system `/Library`, not `~/Library`

**Where:** `src/main/pluginScan.ts:32-33`. Only `/Library/Audio/Plug-Ins/{VST3,Components}`.

**Why it matters:** many plugins (and most free ones) install per-user into
`~/Library/Audio/Plug-Ins/...`. Those never show up, so it isn't "possible to use fully". It works on
Elling's machine because his plugins are system-wide.

**Fix:**
- Scan both roots and de-dupe by bundle id.
- `listVst3Candidates`/`listAuCandidates` take a list of directories.
- Add `pluginScan.test.ts` cases with a temp home.

#### S4. Logging in starts a full download of the account's Shared Feed and own jam, with no prompt

**Where:**
- `LibraryBrowser.tsx:897-938` auto-syncs `shared:<username>` and the own private jam on login.
- `riffLibrarySync.ts:193-216` (`downloadMissingStemsFor`) downloads every stem's audio into
  `~/Music/sssketch/library`.

**Why it matters:** for an active Endlesss user that can be gigabytes of downloads to the Music
folder. It is intentional for Elling. A stranger should be told once.

**Fix:**
- A one-time notice on first login: "sssketch will download your shared feed and your own jam to
  ~/Music/sssketch/library (this can be large). [start] [not now]".
- Remember the answer.
- Keep auto-sync as the default after a yes.

#### S5. Logging in with a username that differs from Endlesss's own spelling breaks "me"

**Where:**
- `endlesssApi.ts:206-258`: the session's `username` is *whatever was typed*.
- It's then used for the shared-feed URL (`endlesssApi.ts:678`), the membership view (`:793`), the
  own-jam match (`LibraryBrowser.tsx:622`, case-insensitive), and "me" everywhere else
  (case-sensitive against `Riffs.UserName`, per `discoverArtist.ts`'s note).

**Why it matters:** if Endlesss accepts an email or a differently-cased name at login (unverified),
the person's own stems never count as theirs. Elling always types his exact handle.

**Fix:**
- After login, read the canonical username from the account's profile doc (`user_appdata$<id>/Profile`
  or the login response, if it carries one) and store that.
- Needs one real login with an email or odd casing to confirm what the server accepts. Question for
  Elling: Q4.

#### S6. Discover and radio on an empty library: no explanation

**Where:** fresh profile check: `getDiscoverCandidates` returns `[]`, and nothing errors.
`DiscoverPanel.tsx` has the consent card (`:13543`) but no "your library is empty" state that I
could find.

**Why it matters:** someone who only drags in stems or loop folders has nothing in the riff library.
Loop folders and drag-and-drop feed the timeline, not Discover. Discover and radio then roll nothing
and say nothing. **Not verified in the GUI.**

**Fix:**
- When the riff library has zero riffs, show one line where the slots would be: "discover rolls from
  your riff library. log into endlesss to sync your jams, or point sssketch at a LORE archive (gear
  → change riff archive location…)".
- Do the same in the radio start prompt.

#### S7. Pointing at a LORE archive is easy to get wrong

**Where:**
- `TransportBar.tsx:526-534` saves whatever folder was picked.
- `riffLibraryStore.ts:154` then expects `<root>/cache/common/warehouse.db3`.

**Why it matters:**
- Picking the `common` folder itself, or the parent of the LORE root, gives "riff archive not found".
  Nothing says which level to pick.
- There's no "back to sssketch's own library" option short of navigating to
  `~/Music/sssketch/library`.

**Fix:**
- On pick, look for `warehouse.db3` at `root`, `root/cache/common`, and the two parent levels.
  Snap to the right root, or refuse with "no warehouse.db3 in that folder".
- Add a "use sssketch's own library" item.

#### S8. README doesn't tell a newcomer what they need, or what the app does with the network

**Where:** `README.md`.

**What's missing:**
- What you need:
  - Endlesss account optional but central: without one, Discover/radio/import are empty unless you
    have LORE;
  - LORE optional;
  - macOS 12 or later (Electron 39's floor), either chip.
- Where data goes: `~/Music/sssketch/projects`, `~/Music/sssketch/library` (can get large),
  `~/Library/Application Support/sssketch`. Uninstall currently mentions only the first and the
  last.
- What Discover, radio and the phone remote are. None of the three is mentioned.
- The "your username" setting: why it matters (own-first ordering, "only mine").
- A short privacy section. See "Privacy" below for what's true today.
- The phone remote's network caveats:
  - same Wi-Fi;
  - macOS asks to allow incoming connections;
  - some routers isolate clients, in which case a VPN like Tailscale works.

**Fix:**
- Add "what you need", "where your stuff lives", "discover & radio", "phone remote" and "privacy"
  sections. Keep them short.
- The onboarding modal could add one line: "no endlesss account? you can still drag stems in".

#### S9. The Ableton template still carries one of his clip names

**Where:** `src/main/ableton/template.xml`. Its canonical track holds `8 - elling - Saturator -
166.304BPM - 2021-08-26-09-04` in `EffectiveName`, `MemorizedFirstClipName`, the clip `Name` and the
`RelativePath`/`Path` (`/Users/user/Downloads/...`). `buildAlsXml.ts` overwrites
`EffectiveName`/`UserName` (`:894`) and the file refs (`:733`, `:862`, `:1159`), but never touches
`MemorizedFirstClipName`.

**Why it matters:** an exported `.als` probably carries his clip name in a field Ableton shows when
re-memorising. This is likely, not verified with a real export.

**Fix:** blank the template's leftover names and path. Set `MemorizedFirstClipName` alongside the
track name. Add a test asserting that no `elling` appears in a built `.als`.

#### S10. macOS permission strings are boilerplate, and one asks for the camera

**Where:** `electron-builder.yml:115-118`. "Application requests access to the device's camera."
Nothing in the app uses the camera.

**Why it matters:** a stranger's first prompt reads like a template, and a camera string looks
suspicious.

**Fix:**
- Remove `NSCameraUsageDescription`.
- Mic: "sssketch records from your audio input when you arm recording."
- Documents/Downloads: "to import stems and save sketches where you choose."

#### S11. The phone remote's pairing code uses `Math.random`

**Where:** `remoteServer.ts:262` (`newPairingCode(Math.random)`). The session token correctly uses
`randomBytes` (`:333`).

**Why it matters:** low. Five tries against 32^4 codes with a lockout is the real protection. But a
crypto source costs nothing.

**Fix:** `newPairingCode(() => crypto.randomInt(0, 2**32) / 2**32)` or similar.

### Fine as is (checked, no change needed)

- **Author/app identity:**
  - `package.json` `"author": "Elling Lien"`;
  - `appId: com.ellinglien.sssketch` (`electron-builder.yml:1`, `index.ts:665`);
  - `publish: github ellinglien/sssketch`;
  - `app-update.yml` (`owner: ellinglien`).

  This is author credit and the real update feed. Keep it.
- **Update feed:** v1.4.0's `latest-mac.yml` lists both `-arm64` and `-x64` zips and dmgs. The arch
  race is fixed.
- **Update check privacy:**
  - packaged builds only;
  - asks before downloading (`autoDownload = false`);
  - checks at launch and every 4 h (`index.ts:2366-2382`);
  - sends GitHub an ordinary request (IP and user agent), with no id.

  Disclose it in the README (S8). A toggle is optional.
- **No telemetry:**
  - no crash reporter, Sentry or analytics;
  - no log upload;
  - nothing writes a log file (`full.log` in the repo root is a local test artefact, gitignored).
- **Outbound network, complete list:**
  - `api.endlesss.fm` / `data.endlesss.fm` (only with a login; read-only, except the login POST and
    a read-only bulk `_all_docs` POST);
  - stem CDN downloads for stems the user's own library references;
  - GitHub (update check);
  - `ell.ing/radio/api/hearts.json` (only with a key, only on click).
- **Credentials:**
  - the Endlesss session is in `safeStorage`, encrypted, and the typed password is never stored
    (`endlesssApi.ts:46-80`);
  - the hearts key is encrypted the same way;
  - no API keys or tokens in source. The beta push also history-scanned the repo.
- **Default riff library root** is sssketch's own (`~/Music/sssketch/library`), not his LORE path
  (`riffLibraryStore.ts:118-127`). The old "defaults to Elling's historical path" note in memory is
  out of date.
- **Fresh profile:** startup with no username, no archive and no login runs clean, and the gate
  opens. With no username, `prewarmDiscoverCandidateCaches` skips the own-only stage
  (`discoverCandidates.ts:721`), and on a big archive the gate then waits for the full walk, as
  before faster startup. That's slower, not broken.
- **Background scans:**
  - The whole-library scan and the overnight classify scan are consent-gated
    (`consentedToLibraryScan`, default false).
  - The placed-stems scan is local-only.
  - Artist "analyse overnight" is user-initiated.
  - Nothing analysed leaves the machine. The consent card could say so in five words; fold that into
    S8.
- **Classifier and training data:** nothing of his ships.
  - `busCentroids.json` is built per user in userData from their own db.
  - `resources/` holds only `icon.png`, `demo-rifff`, `rubberband` and `yamnet`.
  - No centroids, index or labels are bundled.
- **The demo rifff** (`resources/demo-rifff/`, two of his own 2023 stems, named `... - elling -
  ...`) is used only by the onboarding tour (`demoRifff.ts`), never added to the library. It's his
  own music, offered as the demo, so it's fine *if he's happy to distribute it*. See Q2.
- **Phone remote:**
  - off by default and never persisted on;
  - binds `0.0.0.0:7373` only while on;
  - 4-char code, 5-try lockout, `randomBytes` token;
  - no route takes or returns a filesystem path;
  - audio stays on the Mac except the current loop's stems, which go to the paired phone.

  Works for anyone on a normal LAN. Docs only (S8). Fix the code source per S11.
- **Radio defaults** (`DEFAULT_RADIO_SETTINGS`, `radioSchedule.ts:1170`), faves dial 0, radio view
  `simple`, chaos 75: design taste, not tied to his library. Fine.
- **Intel vs Apple Silicon:**
  - both legs build in CI with Release engines;
  - rubberband is vendored per arch;
  - the `better-sqlite3` prebuilds include `darwin-x64` and `darwin-arm64`;
  - the README names both dmgs.

  Not run on a real Intel Mac in this audit.
- **Comments that name Elling, his library sizes, his machine (`nickelm2.local`) or his Tailscale
  address:** comments only. The repo is GPL and public. Leave them.
- **Test fixtures:** `'elling'` (60+ uses) and jam-mates `bananepoep`, `seasickcookie` and `tpj`, in
  `src/**/*.test.ts` and one plan doc. Real people's public Endlesss handles. Harmless, but see Q5.
- **Legacy plugin allowlist paths** (`runFullScan.ts:18-24`, `StoreContext.tsx:175-180`): a
  migration for old saves. They only match plugins actually installed. Fine.
- **`native-engine/Source/Main.cpp:70-75`:** `--scan-report` spike mode only.
- **Golden-vector scripts** (`scripts/goldenChrome.mjs`, `golden-cavern-ir.mjs`) assume the private
  `../ell.ing/radio` repo. That's dev-only. Users are unaffected. Contributors can't regenerate
  goldens, but CI skips that check by design.
- **Radio guide text** mentioning ell.ing/radio and hearts: the hearts lines are `only: 'web'`. The
  ell.ing/radio mention is a plain pointer to his public site. Fine.

---

## First-run traces (from code)

| Situation | What works | What's empty or broken |
|---|---|---|
| **Fresh install, no LORE, no login** | Drag-and-drop import, loop folders, the tour (demo rifff), arranging, tidy up on a sketch, export (mix/stems/Ableton/REAPER), plugins (system-wide only, S3), recording | Import browser: no jams; the username box says `elling` (B1). Discover/radio: nothing to roll, no explanation (S6). Consent card still shown; harmless. Similarity degraded in shipped builds (B3) |
| **Logged into Endlesss, no LORE** | Own riff-sync db works: Shared Feed and own jam auto-sync on login and download audio (S4), membership jams listed, "me" = the typed login name. Discover/radio work on synced stems, `mine` scoped to them | Big silent download (S4). "me" breaks if the typed name isn't the canonical handle (S5) |
| **Own LORE archive at another path** | gear → "change riff archive location…" → archive opens read-only beside the own db; keep/discovered writes go to the own db | Not logged in: everything keyed to `elling` (B1): sidebar near-empty, Discover `mine` rolls empty. Easy to pick the wrong folder level (S7) |
| **Intel** | Dedicated x64 build, x64 rubberband, x64 sqlite prebuild, feed lists x64 | Not verified on hardware here |
| **Phone remote** | Off by default; works on a normal LAN | Needs docs: same Wi-Fi, firewall prompt, client-isolating routers (S8) |
| **Gated on his data?** | Nothing gates on his jams, favourites, `busCentroids` or labels. Nothing of his library ships | The only identity leaks are the `'elling'` fallback (B1), the demo stems by design, and the Ableton template's clip name (S9) |

---

## Questions for Elling

1. **Hearts:** hide them for anyone without a key (my proposal, S1), or remove them from the desktop
   app entirely?
2. **Demo rifff:** OK to keep shipping your two 2023 stems as the tour's demo?
3. **Source dial default:** 50/50 for new installs (S2), or keep 95 because it's how you want sssketch
   to feel?
4. **Endlesss login:** do you know whether it accepts an email or a differently-cased username? If
   you can log in once with your email, that settles S5.
5. **Jam-mates' handles in tests and docs** (bananepoep, seasickcookie, tpj): fine to leave in a
   public repo, or swap for made-up names?
6. **Update check:** disclose it only (README), or also add a settings toggle?

---

## Fix plan

Tasks are independent unless noted. Each runs the usual way: TDD where the logic is pure, then
typecheck, lint, and the full vitest run.

### Task 1: one "me", no default identity (B1)

- Delete `RIFF_LIBRARY_USERNAME`. Make `computeOwnerFraction`'s `targetUser` required, so a blank
  user scores 0. Update `riffLibraryTypes.test.ts`.
- `LibraryBrowser.tsx`:
  - `loadStoredRiffLibraryUsername` returns `''`;
  - the username box shows its placeholder;
  - with no username, the "only my jams" toggle is hidden or inert, plus a one-line hint to log in or
    type a name.
- Have the renderer read "me" from `riffLibraryUsername.ts`'s rule (typed, else session, else none),
  shared by LibraryBrowser and Discover, so main and renderer can't disagree.
- Pure test: the username resolver with nothing stored and no session gives `''`. Discover's
  `slotRollOptions` then gives `onlyOwnStems: false`.
- Grep afterwards: no `'elling'` in non-test `src/`.
- **Size:** about half a day.

### Task 2: package only the app (B2) and ship YAMNet (B3)

- `electron-builder.yml`:
  - `files:` becomes an allowlist (`out/**`, `package.json`, `resources/icon.png`, `LICENSE`);
  - remove `asarUnpack: resources/**`;
  - fix the yamnet comment.
- `package.json`: move `onnxruntime-web` to `devDependencies`. Confirm the renderer still loads the
  bundled wasm.
- `release.yml`: add a "Vendor YAMNet" step. Add a pre-publish assertion that `yamnet.onnx`,
  `rubberband` and both engine apps exist in the built `.app`, and that `app.asar` is under 60 MB.
- `rubberband.ts`, `demoRifff.ts` and `yamnetModel.ts` already read `process.resourcesPath`, not
  `app.asar.unpacked`. That was checked; nothing else to move.
- Verify locally with `npm run build:mac` and an `asar list`. A real tagged release then confirms CI.
  Watch the first download size.
- Follow-up in the same task: record "embedding model unavailable" so the library scan doesn't
  re-queue embeddings every pass.
- **Size:** half a day to a day, including one CI release run.

### Task 3: hide the Elling-only bits (S1, S9, S10, S11)

- Hearts button: shown only with a stored key. Settings item: moved behind an advanced/option-click
  entry, per Q1.
- `template.xml`: blank the leftover clip name and path. `buildAlsXml.ts` sets
  `MemorizedFirstClipName`. Add a test that no `elling` appears in a built `.als`.
- `electron-builder.yml`: drop the camera string and write plain mic/documents/downloads strings.
- `remoteAuth`/`remoteServer`: a crypto source for the pairing code.
- **Size:** two to three hours.

### Task 4: first-run paths for strangers (S3, S4, S6, S7, S2)

- Plugin scan covers `~/Library/Audio/Plug-Ins/{VST3,Components}` too, with tests.
- A one-time "download your shared feed?" prompt on first login, remembered.
- Empty-library line in Discover and the radio start prompt.
- The LORE picker snaps to the folder that holds `cache/common/warehouse.db3`, refuses one without
  it, and gains "use sssketch's own library".
- Source dial default per Q3, for new installs only (saved settings untouched).
- S5 (canonical username after login) once Q4 is answered.
- **Size:** about a day.

### Task 5: README and onboarding (S8)

- Sections:
  - what you need;
  - where your stuff lives (all three folders, including the possibly large riff library, in
    uninstall too);
  - discover & radio;
  - phone remote (same Wi-Fi, firewall prompt, router isolation and the Tailscale workaround);
  - privacy (the network list above; no telemetry; analysis stays local).
- Consent card: add "nothing leaves your computer".
- Onboarding: one line for people without an Endlesss account.
- **Size:** two to three hours.

### Task 6: stranger walkthrough (Elling, or a friend)

Do this on a fresh macOS user account (cleanest: no userData, no localStorage, no session), with the
next release:
1. Install the dmg and check the size.
2. Tour.
3. Drag stems.
4. Discover empty state.
5. Log in and see the prompt.
6. Point at a LORE copy.
7. Check the username box is blank.
8. Plugins installed under the home Library.
9. Phone remote.

Ideally one pass on an Intel Mac.

**Size:** one to two hours of his time.

**Total:** roughly 3-4 agent-days of work, plus one release and Elling's walkthrough. Tasks 1 and 2
alone clear the blockers, in about a day and a half.
