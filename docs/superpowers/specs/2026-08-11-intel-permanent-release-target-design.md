# Intel (x86_64) as a Permanent Release Target — Design

**Status:** Drafted through the brainstorming skill with Elling, following on directly from two
prior proof points this same session: a local unsigned x86_64 cross-compile test
(`docs/superpowers/specs/2026-08-11-intel-mac-test-build-design.md`) that confirmed the full
JUCE-based `native-engine` cross-compiles cleanly to x86_64, and a separate native build/test on
a real Intel Mac mini (`docs/superpowers/2026-08-11-intel-mac-native-build-test-result.md`) that
confirmed the engine actually runs correctly on real Intel hardware — CoreAudio output binding,
offline render, and realtime playback all verified. This design is the deliberately-deferred
next step from both of those: making Intel a permanent, automated release target instead of a
one-off local test.

## Background

`release.yml` and `electron-builder.yml` currently produce one artifact per tagged release: an
arm64 DMG, built and signed on a GitHub Actions `macos-latest` (Apple Silicon) runner. Everything
in the two prior test efforts was deliberately scoped to *never touch this real pipeline* — this
design is where that changes.

One real correction surfaced during this design conversation and worth stating up front: the
local test's original two candidate approaches (cross-compile on the existing runner vs. add a
real Intel runner) were sketched *before* either proof point existed. With both now confirmed,
cross-compiling on the existing runner class is clearly the better-supported choice — no new
runner type, no dependency on GitHub continuing to offer Intel-native runners (which are already
being phased down: the macOS 14 Sonoma runner images, still x86_64-capable via `macos-13`'s
lineage in some contexts, begin deprecating this year per GitHub's own runner-images repo).

## Goal

Every tagged release produces **two** signed, notarized DMGs — `sssketch-X.Y.Z.dmg` (arm64, same
as today) and `sssketch-X.Y.Z-x64.dmg` (new) — built in parallel, with no increase in typical
release wall-clock time.

## Non-goals

- **Not removing the plugin-scan bridge feature.** Elling confirmed during this conversation that
  it doesn't actually work as intended even on the shipping arm64 app and should be removed
  entirely — but that's real, separate work (deleting `native-engine-bridge/`, its CI build
  steps, `pluginScan.ts`'s retry logic, and the "(bridged)" UI labels in three components), being
  tracked as its own follow-up brainstorm/plan, not bundled into this release-pipeline change.
- **Not fixing the engine's startup microphone-permission behavior.** The Intel Mac test surfaced
  a real finding (the engine opens an input device at startup, which can hang in a non-interactive
  context under TCC gating) — but Elling has explicitly called this non-blocking ("not really a
  bug, the agent being dramatic") since a real user just sees the normal system permission
  dialog. Out of scope here; may resurface as its own polish item later.
- **Not building a universal/fat binary.** Two separate DMGs, matching the existing one-arch-per-
  artifact pattern.
- **Not restructuring the pipeline to eliminate the duplicate-draft-release race** (see Known
  risks) — accepting it and leaning on the existing manual verification process rather than
  adding job-dependency complexity to prevent it architecturally.

## Design

### Matrix build, not two approaches merged into one

`release.yml`'s `release` job gains a `strategy.matrix.arch: [arm64, x64]`, `fail-fast: false`,
still on `runs-on: macos-latest`. Each leg is a fully independent, parallel run of the whole
pipeline (checkout → native build → test → sign → notarize → publish) — not two variants of a
shared job squeezed into one runner. This keeps total release wall-clock close to today's
single-arch time (same order of magnitude as the native-engine cross-compile itself, ~15-20 min)
at the cost of 2x GitHub-hosted macOS runner-minutes, not 2x wall-clock.

### `native-engine` builds into its normal path on every leg — no generated config needed

The local test build needed a separate `native-engine/build-x64/` directory and a
config-generation script specifically because it ran on *one machine* that also needed to keep
its normal arm64 dev build intact alongside the test artifact. CI doesn't have that constraint —
each matrix leg gets its own isolated, disposable VM. So `native-engine` just builds into its
conventional `native-engine/build` path on *every* leg: the arm64 leg builds it natively (as
today), the x64 leg cross-compiles into that same path via `-DCMAKE_OSX_ARCHITECTURES=x86_64`.
`electron-builder.yml`'s existing `extraResources` entry for the engine needs **no change** — it
already points at that conventional path, and now correctly picks up whichever arch's engine
each leg actually built there.

The native-engine build cache key needs `${{ matrix.arch }}` added so the two legs don't
collide on or corrupt each other's cache entries.

### The plugin-scan bridge: included on both legs, unconditionally

Originally planned to skip bundling the bridge on the x64 build (it's genuinely unused there —
the main engine already hosts x86_64 plugins directly without needing to bridge through
anything). Reconsidered specifically for this real pipeline: `electron-builder.yml`'s
`extraResources` entries are **required to exist** — a missing path there hard-fails packaging
(confirmed earlier this session, hit for real once). Making the bridge conditional per-arch would
mean forking `electron-builder.yml`'s config between legs, which reopens the exact "`-c` replaces
rather than merges" complexity that was just resolved in the local test work. Since the bridge is
already a small, fast, always-x86_64 build regardless of host arch, building and bundling it
identically on *both* legs is trivial and keeps a single, unmodified `electron-builder.yml`
working for both. Cost: a few harmless unused MB in the x64 package. Elling confirmed this
tradeoff is fine ("we can spare a few MB").

(This decision only applies to the permanent release pipeline. The bridge itself, and whether it
should exist in the codebase at all, is the separate follow-up noted under Non-goals.)

### Naming: `mac.defaultArch: arm64`, and drop the arch-less `artifactName` override

Real, concrete bug caught during this design (not hypothetical): `electron-builder.yml` currently
sets `dmg.artifactName: ${name}-${version}.${ext}` — a custom pattern with **no `${arch}`
placeholder at all**. Add a second arch without touching this, and both matrix legs would try to
publish a DMG named identically (`sssketch-X.Y.Z.dmg`) to the same GitHub release — a real
collision, not a cosmetic issue.

Fix: remove that custom `dmg.artifactName` override (falling back to `dmg-builder`'s own default
template, `${productName}-${version}-${arch}.${ext}`) and add `mac.defaultArch: arm64` to
`electron-builder.yml`. Traced directly in `app-builder-lib`'s `expandArtifactNamePattern`: the
arch suffix is omitted from the filename specifically when the built arch matches the *configured*
default arch. With `defaultArch: arm64` set, the arm64 leg's filename stays exactly
`sssketch-X.Y.Z.dmg` (unchanged from every prior release — no broken links, no README update
needed for the existing download pattern), and the x64 leg automatically gets
`sssketch-X.Y.Z-x64.dmg`. Same mechanism (`mac.defaultArch`) already proven correct in the local
test build's own output-*directory* naming fix — this reuses it for artifact *filename* naming,
a different call site with the same underlying logic.

### Signing generalizes without code changes

`afterPack.js` operates on `context.appOutDir` and relative `Contents/Resources/...` paths — none
of it is arm64-specific. `mac.signIgnore`'s three entries are the same relative paths. Both should
work unchanged for the x64 leg. Each leg independently signs, notarizes, and publishes — two
separate notarization submissions per release (normal; notarization is inherently per-artifact).

### Rubberband vendoring for x64: real open question, not resolved here

`scripts/vendor-rubberband.sh` (unchanged, arm64 leg) still does `brew install rubberband` then
walks/rewrites the locally-installed binary. For x64, GitHub's arm64 runners were confirmed this
session to **not** have Rosetta 2 pre-installed (checked directly against the current
`actions/runner-images` macOS 14 arm64 README — no mention of Rosetta anywhere in its exhaustively
listed installed software), so `arch -x86_64 brew install rubberband` isn't a safe assumption.
The plan is to fetch the x86_64 rubberband Homebrew bottle directly (bypassing `brew install`
entirely, which would only ever resolve to the host's arm64 bottle) and feed it into an adapted
version of the existing vendoring script's otool-walk-and-rewrite logic. The **exact mechanism**
for fetching a non-host-arch bottle (a `brew fetch --arch=x86_64`-style flag, if one reliably
exists in the runner's Homebrew version; or querying `formulae.brew.sh`'s API directly for the
correct platform-tagged bottle URL) is a genuine unknown, not asserted here with false confidence
— it needs real verification during implementation, the same way the earlier `-c` merge behavior
and `dist/mac-x64` path assumption both turned out to need actual source-tracing rather than
guessing.

### Duplicate-draft-release race: real, now more likely, accepted rather than architected away

Even with a *single* arch, `electron-builder --publish always`'s own release-creation retry logic
has already produced duplicate draft releases splitting assets across them (documented, hit for
real on v1.1.4). Two genuinely parallel matrix legs both racing to create/publish the same tagged
release makes this more likely, not less. Discussed two options — restructuring into dependent
(non-matrix) jobs so only one leg ever creates the release, vs. accepting the risk and leaning on
the manual verification process already proven this session (check `gh api .../releases` for
duplicates, consolidate assets, delete orphans, verify checksum, un-draft). Elling chose to keep
the pipeline simple and treat that verification as a required step after every release, not a
surprise to react to.

## Known risks

1. **Rubberband bottle-fetching mechanism is unverified** (see above) — the one piece of this
   design without a concretely-checked implementation path yet.
2. **Duplicate-draft-release race is more likely with two parallel publish attempts** — accepted,
   mitigated by the existing manual verification process, not architected away.
3. Everything else (native-engine cross-compile, engine runtime correctness, signing mechanism,
   `mac.defaultArch` naming behavior) has already been independently verified this session, either
   by direct source-tracing or by an actual successful run.

## Testing

No new automated tests — this is CI/build configuration, not application logic, consistent with
this project's own testing conventions for release/build-pipeline work. Verification is: a real
tagged release run, checked the same way v1.1.4/v1.1.5 were — confirm both DMGs build, sign, and
notarize successfully; download each real published asset and independently verify with
`codesign --verify --deep --strict` and `spctl -a -vvv --type execute` rather than trusting the
build log; confirm the x64 asset is genuinely `sssketch-X.Y.Z-x64.dmg` and the arm64 one is still
unsuffixed; check for and consolidate any duplicate release drafts before un-drafting.

## Follow-up (not part of this work)

- Remove the plugin-scan bridge feature entirely from the codebase (confirmed non-functional on
  the shipping arm64 app) — separate brainstorm/plan.
- Optionally revisit the engine's startup mic-permission behavior if it ever becomes a real
  problem for an actual end user (currently explicitly non-blocking).
