# Intel (x86_64) as a Permanent Release Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tagged release produces two signed, notarized DMGs — `sssketch-X.Y.Z.dmg` (arm64,
unchanged) and `sssketch-X.Y.Z-x64.dmg` (new) — built in parallel via a CI matrix, cross-compiling
`native-engine` on the existing Apple Silicon runner class.

**Architecture:** `release.yml`'s `release` job gains `strategy.matrix.arch: [arm64, x64]`,
`fail-fast: false`. Each leg independently builds `native-engine` into its own isolated
`native-engine/build` (native on the arm64 leg, `-DCMAKE_OSX_ARCHITECTURES=x86_64` cross-compile on
the x64 leg), vendors the correct-arch `rubberband` (Homebrew on the arm64 leg, a hand-rolled
bottle-fetch-and-relocate script for x64, since GitHub's arm64 runners have no Rosetta), then signs,
notarizes, and publishes via `electron-builder --mac --publish always` with an explicit
`--arm64`/`--x64` flag. `electron-builder.yml` gains `mac.defaultArch: arm64` (so the arm64 DMG's
filename stays unsuffixed) and `mac.target[0].arch` grows to include `x64` (a real bug otherwise —
traced below).

**Tech Stack:** GitHub Actions (`macos-latest`, matrix strategy), CMake/JUCE cross-compilation,
electron-builder, Python 3 stdlib (bottle fetch script — no new dependency), existing bash tooling.

---

## Design reference

Full rationale: `docs/superpowers/specs/2026-08-11-intel-permanent-release-target-design.md`
(approved by Elling — "good to go."). This plan implements it exactly, plus one real bug found
during planning that the design doc didn't call out (see Task 3's note).

## A note on scope

This touches the **real** release pipeline (`.github/workflows/release.yml`,
`electron-builder.yml`) — unlike the earlier local x64 test build
(`scripts/build-x64-test.sh`/`scripts/generate-x64-test-config.js`), which stays untouched and
unaffected by this work. Per the design's Non-goals: **not** removing the plugin-scan bridge,
**not** fixing the engine's startup mic-permission behavior, **not** building a universal binary,
**not** restructuring around the duplicate-draft-release race (accepted risk, verified manually
after every release per Task 5).

---

### Task 1: Parameterize `scripts/vendor-rubberband.sh` to accept an optional starting-binary path

**Files:**
- Modify: `scripts/vendor-rubberband.sh:27-31`

The script currently only ever resolves its source binary from `PATH` (`command -v rubberband`).
The x64 CI leg (Task 4) will fetch and relocate an x86_64 rubberband binary to an arbitrary path
that is never on `PATH` — the script needs to accept that path directly instead.

- [ ] **Step 1: Change the source-resolution line to accept `$1` first**

Current (`scripts/vendor-rubberband.sh:27-31`):

```bash
RUBBERBAND_BIN="$(command -v rubberband || true)"
if [ -z "$RUBBERBAND_BIN" ]; then
  echo "vendor-rubberband: 'rubberband' not found on PATH -- run 'brew install rubberband' first" >&2
  exit 1
fi
```

Replace with:

```bash
# $1, if given, is an explicit path to a rubberband binary to vendor (used by
# the x64 CI leg, which fetches and relocates an x86_64 binary that's never
# on PATH -- see scripts/fetch-x64-rubberband.py). Falls back to PATH
# resolution otherwise, unchanged from before.
RUBBERBAND_BIN="${1:-$(command -v rubberband || true)}"
if [ -z "$RUBBERBAND_BIN" ]; then
  echo "vendor-rubberband: no rubberband binary given and none found on PATH -- either pass a path as \$1 (e.g. the output of scripts/fetch-x64-rubberband.py) or run 'brew install rubberband' first" >&2
  exit 1
fi
```

Nothing else in the script changes — every later reference already uses the `$RUBBERBAND_BIN`
variable, never a hardcoded `rubberband` literal, so the otool-walk-and-rewrite logic works
unchanged regardless of where the binary came from.

- [ ] **Step 2: Verify the no-arg path still works exactly as before**

Run (this repo's dev machine has a real Homebrew `rubberband` on PATH from earlier session work):

```bash
command -v rubberband
bash scripts/vendor-rubberband.sh
ls resources/rubberband/lib | wc -l
```

Expected: the script completes with its normal `vendor-rubberband: done -- N dylibs vendored to
...` message, `N` matching whatever ran before this change (no regression from parameterizing).

- [ ] **Step 3: Verify the new explicit-path argument produces an identical result**

```bash
bash scripts/vendor-rubberband.sh "$(command -v rubberband)"
ls resources/rubberband/lib | wc -l
```

Expected: same dylib count as Step 2 — proves the new `$1` codepath and the old PATH-fallback
codepath resolve to the same binary and produce the same output when given the same real path.

- [ ] **Step 4: Commit**

```bash
git add scripts/vendor-rubberband.sh
git commit -m "Allow vendor-rubberband.sh to accept an explicit binary path"
```

---

### Task 2: Create `scripts/fetch-x64-rubberband.py`

**Files:**
- Create: `scripts/fetch-x64-rubberband.py`

This is the piece the design doc explicitly flagged as unresolved ("a genuine unknown, not
asserted here with false confidence"). It's now been fully researched, built, and verified working
end-to-end against the live Homebrew bottle CDN (fetched all 9 formulae in rubberband's transitive
dependency closure, relocated every `@@HOMEBREW_PREFIX@@`/`@@HOMEBREW_CELLAR@@` placeholder, and
confirmed the result actually executes and produces mathematically correct tempo-stretch output).
This task transcribes that verified script into the real repo — no new discovery needed, only
faithful transcription and a fresh confirmation run.

- [ ] **Step 1: Write the script**

Create `scripts/fetch-x64-rubberband.py` with this exact content:

```python
#!/usr/bin/env python3
"""scripts/fetch-x64-rubberband.py

Fetches rubberband's x86_64 Homebrew bottle plus its full transitive
dependency closure directly from Homebrew's bottle CDN (GitHub Container
Registry), bypassing `brew install` entirely -- GitHub's arm64 macOS
runners have no Rosetta 2 (confirmed against the current actions/
runner-images README, which lists installed software exhaustively and
never mentions Rosetta), so `arch -x86_64 brew install rubberband` isn't
a safe assumption there, and `brew install` alone would only ever resolve
the host's own arm64 bottle regardless of any arch flag.

Two real things this had to get right, found by actually running this
against the live bottle CDN rather than guessing:
  1. A bottle's *extracted* version directory can include a Homebrew
     revision suffix (e.g. "1.2.2_1") that the JSON API's plain
     `versions.stable` string never reports (just "1.2.2") -- so the
     extracted directory name is discovered by listing what actually
     extracted, never constructed from the version string.
  2. Homebrew bottles are NOT relocated to a real path until `brew`'s own
     install step processes them -- every internal cross-formula
     reference is left as a literal, unresolvable placeholder token.
     There are two distinct forms, both real: `@@HOMEBREW_PREFIX@@/opt/
     <formula>/...` (the unversioned "current" convention) and
     `@@HOMEBREW_CELLAR@@/<formula>/<version>/...` (a versioned, direct
     form some formulae use for their own internal references --
     libvorbisenc.2.dylib's reference to libvorbis.0.dylib is exactly
     this form, not the /opt/ form). Missing either one doesn't fail at
     build time -- it only surfaces as a runtime "Symbol not found"
     dyld error, which is exactly the kind of failure that's expensive
     to debug after the fact. Both are handled here.

Usage: python3 scripts/fetch-x64-rubberband.py <output-dir>
Prints the path to the final, working, relocated rubberband binary on
stdout when done -- hand that path to scripts/vendor-rubberband.sh as
its optional starting-binary-path argument.
"""
import json
import os
import subprocess
import sys
import tarfile
import urllib.request

PLATFORM_TAG = "sonoma"  # x86_64 macOS -- matches the CI runner's own OS (macOS 14)


def brew_json(formula):
    with urllib.request.urlopen(f"https://formulae.brew.sh/api/formula/{formula}.json") as r:
        return json.load(r)


def ghcr_token(formula):
    url = f"https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/{formula}:pull"
    with urllib.request.urlopen(url) as r:
        return json.load(r)["token"]


def fetch_bottle(formula, root):
    data = brew_json(formula)
    files = data["bottle"]["stable"]["files"]
    if PLATFORM_TAG not in files:
        raise RuntimeError(
            f"{formula} has no '{PLATFORM_TAG}' bottle -- available: {list(files.keys())}"
        )
    url = files[PLATFORM_TAG]["url"]
    token = ghcr_token(formula)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    tar_path = os.path.join(root, f"{formula}.tar.gz")
    with urllib.request.urlopen(req) as resp, open(tar_path, "wb") as f:
        f.write(resp.read())
    with tarfile.open(tar_path) as t:
        t.extractall(root, filter="data")
    os.remove(tar_path)
    # Discover the real extracted version dir rather than trusting
    # versions.stable -- see module docstring, point 1.
    formula_dir = os.path.join(root, formula)
    subdirs = [d for d in os.listdir(formula_dir) if os.path.isdir(os.path.join(formula_dir, d))]
    if len(subdirs) != 1:
        raise RuntimeError(f"{formula}: expected exactly one extracted version dir, found {subdirs}")
    return os.path.join(formula, subdirs[0]), data.get("dependencies", [])


def fetch_closure(start_formula, root):
    """Breadth-first fetch of start_formula plus every runtime dependency,
    transitively. Returns {formula: extracted_relative_dir}."""
    resolved = {}
    queue = [start_formula]
    while queue:
        formula = queue.pop(0)
        if formula in resolved:
            continue
        print(f"fetching {formula} ({PLATFORM_TAG})...", file=sys.stderr)
        extracted_dir, deps = fetch_bottle(formula, root)
        resolved[formula] = extracted_dir
        link = os.path.join(root, f"{formula}-current")
        if os.path.islink(link) or os.path.exists(link):
            os.remove(link)
        os.symlink(extracted_dir, link)
        for dep in deps:
            if dep not in resolved:
                queue.append(dep)
    return resolved


def is_macho(path):
    result = subprocess.run(["file", path], capture_output=True, text=True)
    return "Mach-O" in result.stdout


def load_commands(path):
    result = subprocess.run(["otool", "-L", path], capture_output=True, text=True, check=True)
    lines = result.stdout.splitlines()[1:]  # first line is just the file's own path
    return [line.strip().split(" ")[0] for line in lines]


def relocate_placeholders(root):
    """Rewrites every @@HOMEBREW_PREFIX@@/opt/... and @@HOMEBREW_CELLAR@@/...
    load command in every Mach-O file under root to point at the real
    locally-fetched path -- see module docstring, point 2."""
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            path = os.path.join(dirpath, name)
            if os.path.islink(path) or not is_macho(path):
                continue
            changed = False
            for cmd in load_commands(path):
                real = None
                if cmd.startswith("@@HOMEBREW_PREFIX@@/opt/"):
                    rest = cmd[len("@@HOMEBREW_PREFIX@@/opt/"):]
                    formula, _, tail = rest.partition("/")
                    real = os.path.join(root, f"{formula}-current", tail)
                elif cmd.startswith("@@HOMEBREW_CELLAR@@/"):
                    real = os.path.join(root, cmd[len("@@HOMEBREW_CELLAR@@/"):])
                else:
                    continue
                if not os.path.isfile(real):
                    raise RuntimeError(f"{path} references {cmd} -> resolved to {real}, which does not exist")
                subprocess.run(["install_name_tool", "-change", cmd, real, path], check=True, capture_output=True)
                changed = True
            if changed:
                # install_name_tool invalidates any existing signature --
                # ad-hoc re-sign so the file is loadable at all; matches
                # vendor-rubberband.sh's own convention for this exact
                # situation (its own final signing pass happens later, in
                # electron-builder's real signing step).
                subprocess.run(["codesign", "--force", "--sign", "-", path], check=True, capture_output=True)


def main():
    if len(sys.argv) != 2:
        print("usage: fetch-x64-rubberband.py <output-dir>", file=sys.stderr)
        sys.exit(1)
    root = os.path.abspath(sys.argv[1])
    os.makedirs(root, exist_ok=True)

    resolved = fetch_closure("rubberband", root)
    relocate_placeholders(root)

    rubberband_bin = os.path.join(root, "rubberband-current", "bin", "rubberband")
    if not os.path.isfile(rubberband_bin):
        raise RuntimeError(f"expected {rubberband_bin} to exist after fetching {list(resolved)}")
    print(rubberband_bin)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it for real, from the actual repo location, to confirm the transcription is correct**

```bash
rm -rf /tmp/fetch-x64-rubberband-verify
python3 scripts/fetch-x64-rubberband.py /tmp/fetch-x64-rubberband-verify
```

Expected: prints `fetching rubberband (sonoma)...` followed by 8 more `fetching <formula>
(sonoma)...` lines (its dependency closure — `libsamplerate`, `libsndfile`, `flac`, `lame`,
`libogg`, `libvorbis`, `mpg123`, `opus`), zero errors from `relocate_placeholders` (a
`RuntimeError` there means a `@@HOMEBREW_*@@` placeholder resolved to a missing file — would
indicate a real bug in the transcription), and a final line printing
`/tmp/fetch-x64-rubberband-verify/rubberband-current/bin/rubberband`.

- [ ] **Step 3: Verify the fetched binary is genuinely x86_64**

```bash
file /tmp/fetch-x64-rubberband-verify/rubberband-current/bin/rubberband
```

Expected: output contains `Mach-O 64-bit executable x86_64` (not `arm64`).

- [ ] **Step 4: Clean up the verification directory**

```bash
rm -rf /tmp/fetch-x64-rubberband-verify
```

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-x64-rubberband.py
git commit -m "Add script to fetch x86_64 rubberband bottle without Rosetta"
```

---

### Task 3: Modify `electron-builder.yml` for two-arch output

**Files:**
- Modify: `electron-builder.yml:35-66`

Two changes from the approved design, plus one real bug this planning session found by tracing
`app-builder-lib`'s actual target-resolution code (`node_modules/app-builder-lib/out/targets/
targetFactory.js`'s `computeArchToTargetNamesMap`) that the design doc didn't call out:

**The bug:** `mac.target` currently pins `dmg`'s `arch` to `[arm64]` only. When electron-builder
merges this config against a CLI-requested arch that isn't in that list (i.e. `--x64`, added in
Task 4), `computeArchToTargetNamesMap` finds no matching config entry for `x64` and falls back to
`packager.defaultTarget` — traced to `ElectronFramework.js:108`, which hardcodes
`macOsDefaultTargets = ["zip", "dmg"]`. Left unfixed, the x64 leg would silently produce **both** a
zip and a dmg (while the arm64 leg, whose config entry explicitly matches, produces only a dmg) —
an inconsistent, surprise extra artifact. Fix: add `x64` to that same `arch` list so both legs
resolve through the identical explicit config entry.

- [ ] **Step 1: Add `x64` to `mac.target`'s `arch` list, add `mac.defaultArch`, remove `dmg.artifactName`**

Current (`electron-builder.yml:35-40` and `:65-66`):

```yaml
mac:
  category: public.app-category.music
  target:
    - target: dmg
      arch:
        - arm64
```

and:

```yaml
dmg:
  artifactName: ${name}-${version}.${ext}
```

Change the `mac:` block's `target` entry to:

```yaml
mac:
  category: public.app-category.music
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  # arm64 is the historical/default target -- pinning this keeps the arm64
  # DMG's filename unsuffixed (sssketch-X.Y.Z.dmg, unchanged from every
  # prior release, no broken download links) while the x64 leg
  # automatically gets sssketch-X.Y.Z-x64.dmg. Traced directly in
  # app-builder-lib's expandArtifactNamePattern: the arch suffix is
  # omitted specifically when the built arch matches this configured
  # default. See docs/superpowers/specs/2026-08-11-intel-permanent-release-target-design.md.
  defaultArch: arm64
```

And remove the `dmg:` block's `artifactName` override entirely — delete these two lines:

```yaml
dmg:
  artifactName: ${name}-${version}.${ext}
```

(`dmg-builder`'s own default template, `${productName}-${version}-${arch}.${ext}`, takes over —
this is the template that actually has an `${arch}` placeholder, which the removed override
didn't.)

- [ ] **Step 2: Confirm the resulting YAML parses and the relevant keys are present**

```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); const c = yaml.load(fs.readFileSync('electron-builder.yml', 'utf8')); console.log(JSON.stringify({ macTarget: c.mac.target, defaultArch: c.mac.defaultArch, dmg: c.dmg }, null, 2))"
```

Expected output:

```json
{
  "macTarget": [
    {
      "target": "dmg",
      "arch": [
        "arm64",
        "x64"
      ]
    }
  ],
  "defaultArch": "arm64",
  "dmg": undefined
}
```

(`js-yaml` is already a devDependency from the earlier local x64 test build work.)

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "Configure electron-builder for arm64 + x64 DMG output"
```

---

### Task 4: Modify `.github/workflows/release.yml` for the matrix build

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the matrix strategy to the `release` job**

Current (`.github/workflows/release.yml:15-18`):

```yaml
jobs:
  release:
    runs-on: macos-latest
    steps:
```

Replace with:

```yaml
jobs:
  release:
    runs-on: macos-latest
    strategy:
      fail-fast: false
      matrix:
        arch: [arm64, x64]
    steps:
```

(`fail-fast: false` per the approved design — one arch's failure shouldn't cancel the other leg
mid-build.)

- [ ] **Step 2: Make the native-engine build step arch-conditional, with `matrix.arch` in its cache key**

Current (`.github/workflows/release.yml:32-42`):

```yaml
      - name: Cache native engine build
        uses: actions/cache@v4
        with:
          path: native-engine/build
          key: native-engine-${{ runner.os }}-juce-8.0.4-${{ hashFiles('native-engine/CMakeLists.txt', 'native-engine/Source/**') }}

      - name: Build native engine
        working-directory: native-engine
        run: |
          cmake -B build
          cmake --build build --config Release
```

Replace with:

```yaml
      - name: Cache native engine build
        uses: actions/cache@v4
        with:
          path: native-engine/build
          key: native-engine-${{ runner.os }}-${{ matrix.arch }}-juce-8.0.4-${{ hashFiles('native-engine/CMakeLists.txt', 'native-engine/Source/**') }}

      # Each matrix leg gets its own isolated runner VM, so native-engine
      # builds into its normal path on every leg -- no separate build
      # directory needed the way the local x64 test build required (that
      # ran on one machine juggling both an arm64 dev build and an x64 test
      # build at once; CI legs never share a machine). The arm64 leg builds
      # natively (unchanged); the x64 leg cross-compiles via
      # CMAKE_OSX_ARCHITECTURES, already proven to produce a genuine x86_64
      # engine binary in this session's local test build.
      - name: Build native engine
        working-directory: native-engine
        run: |
          if [ "${{ matrix.arch }}" = "x64" ]; then
            cmake -B build -DCMAKE_OSX_ARCHITECTURES=x86_64
          else
            cmake -B build
          fi
          cmake --build build --config Release
```

- [ ] **Step 3: Leave the native-engine-bridge build and cache steps unchanged**

No edit needed here — confirm `.github/workflows/release.yml`'s "Cache native engine bridge build"
and "Build native engine bridge" steps still read exactly as they did before this task (bridge is
always x86_64 regardless of host arch, per its own `CMakeLists.txt`; built identically and
unconditionally on both legs per the approved design's "included on both legs, unconditionally"
decision).

- [ ] **Step 4: Leave "Install rubberband" (before Test) unchanged**

No edit needed. This step (`brew install rubberband`) runs on the CI **host**, which is always
arm64 regardless of which arch this leg is packaging for — it exists purely so
`render-parity.test.ts` has a working `rubberband` CLI to spawn during the Test step, unrelated to
what eventually gets vendored into the packaged app. Confirm it's still present, unmodified,
immediately before the existing "Typecheck" step.

- [ ] **Step 5: Make the "Vendor rubberband" step arch-conditional**

Current (`.github/workflows/release.yml:80-85`):

```yaml
      # Produces resources/rubberband/ (gitignored, rebuilt fresh per
      # release -- see scripts/vendor-rubberband.sh's own doc comment for
      # why this isn't committed) so tempo stretching works out of the box
      # for testers with no Homebrew install of their own.
      - name: Vendor rubberband
        run: bash scripts/vendor-rubberband.sh
```

Replace with:

```yaml
      # Produces resources/rubberband/ (gitignored, rebuilt fresh per
      # release -- see scripts/vendor-rubberband.sh's own doc comment for
      # why this isn't committed) so tempo stretching works out of the box
      # for testers with no Homebrew install of their own.
      #
      # arm64: vendor the same host-installed Homebrew binary as before
      # (brew install rubberband ran earlier in this job, for Test).
      # x64: GitHub's arm64 runners have no Rosetta 2 (confirmed against
      # the current actions/runner-images README), so `arch -x86_64 brew
      # install` isn't safe here -- fetch and relocate the x86_64 bottle
      # directly instead (see scripts/fetch-x64-rubberband.py's own doc
      # comment for the two real gotchas that mechanism required).
      - name: Vendor rubberband
        run: |
          if [ "${{ matrix.arch }}" = "x64" ]; then
            RUBBERBAND_BIN="$(python3 scripts/fetch-x64-rubberband.py "$RUNNER_TEMP/rubberband-x64")"
            bash scripts/vendor-rubberband.sh "$RUBBERBAND_BIN"
          else
            bash scripts/vendor-rubberband.sh
          fi
```

- [ ] **Step 6: Pass an explicit arch flag to electron-builder**

Current (`.github/workflows/release.yml:181-183`):

```yaml
          npx electron-vite build
          npx electron-builder --mac --publish always
```

Replace with:

```yaml
          npx electron-vite build
          npx electron-builder --mac --publish always ${{ matrix.arch == 'x64' && '--x64' || '--arm64' }}
```

(Previously this ran implicitly single-arch, since the job only ever ran on an arm64 host with no
explicit flag. Now that both legs run on the same arm64 host class, each must explicitly tell
electron-builder which arch's Electron shell/DMG to build — `--x64` cross-builds the x64 shell,
matching the `native-engine`/`native-engine-bridge`/rubberband arch already produced earlier in
this same job for this same leg. `${{ ... }}` is a GitHub Actions expression, substituted to a
literal `--x64` or `--arm64` string before the shell runs — not a bash conditional.)

- [ ] **Step 7: Confirm the full modified file reads correctly**

```bash
cat .github/workflows/release.yml
```

Read through it once end-to-end: `strategy.matrix.arch: [arm64, x64]` present; native-engine cache
key includes `${{ matrix.arch }}`; native-engine build is the only step with an `if`-style arch
branch inside its `run:` block (bridge, install-rubberband-for-tests, typecheck, lint, test all
unchanged); vendor-rubberband step branches on `matrix.arch`; the final publish step's
`electron-builder` invocation includes the `${{ matrix.arch == 'x64' && ... }}` expression;
signing steps (`Import signing certificate`, `Clean up signing keychain`) are completely
unmodified (per the design's "generalizes without code changes" — confirm this by inspection, not
by editing them).

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Add x64 matrix leg to the release workflow"
```

---

### Task 5: Real verification — a real tagged release run

**Files:** none (verification only)

This is CI/build configuration, not application logic — consistent with this project's own
testing conventions (see root `CLAUDE.md`'s "Testing conventions" section), there's no automated
test suite applicable here. Verification is a real release, checked the same way v1.1.4/v1.1.5
were checked earlier this session: don't trust the build log, independently verify the real
published artifacts.

- [ ] **Step 1: Confirm current version and decide the next tag**

```bash
node -e "console.log(require('./package.json').version)"
git tag --list 'v*' --sort=-v:refname | head -5
```

Pick the next patch/minor version per whatever versioning judgment call is normal for this repo
(bump `package.json`'s `version` field and commit that bump first if this repo's convention is to
tag a version-bump commit — check the last few tags' preceding commits with `git log --oneline
-5 <last-tag>` to see the established pattern before choosing).

- [ ] **Step 2: Push the tag and watch the real matrix run**

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
gh run watch --exit-status
```

(If `gh run watch` needs a specific run ID because multiple workflows fire on tag push, use `gh
run list --workflow=release.yml --limit=1` first to find it.)

Expected: **two** parallel `release` job runs in the same workflow run (one per matrix leg,
visible as `release (arm64)` and `release (x64)` in the Actions UI / `gh run view`), both
completing successfully. If either fails, read its real log via `gh run view --log-failed` — don't
guess at the cause; this is genuinely new territory (the x64 leg's rubberband-fetch step and
arch-conditional native-engine build have never run in a real CI environment before, only locally
and in the earlier one-off Intel Mac test) and a real failure here needs the same systematic
root-cause approach used throughout this session, not a speculative fix.

- [ ] **Step 3: Check for duplicate draft releases (accepted risk from the design — verify, don't assume)**

```bash
gh api repos/ellinglien/sssketch/releases --jq '.[] | select(.tag_name == "vX.Y.Z") | {id, draft, name, assets: [.assets[].name]}'
```

If more than one draft release exists for this tag (the known, accepted `electron-builder
--publish always` race, now more likely with two genuinely parallel legs both trying to
create/publish the same tagged release): identify which draft has which asset(s) via the `assets`
field above, move any assets from the "wrong" draft to the "right" one via `gh release upload
vX.Y.Z <file> --clobber` (download first with `gh release download`, if needed), then delete the
now-empty duplicate draft with `gh api -X DELETE repos/ellinglien/sssketch/releases/<id>`.

- [ ] **Step 4: Download and independently verify both real published assets**

```bash
mkdir -p /tmp/release-verify-vX.Y.Z && cd /tmp/release-verify-vX.Y.Z
gh release download vX.Y.Z --pattern '*.dmg'
ls
```

Expected: exactly two files, `sssketch-X.Y.Z.dmg` and `sssketch-X.Y.Z-x64.dmg`.

For each:

```bash
hdiutil attach sssketch-X.Y.Z.dmg -mountpoint /tmp/mnt-arm64 -nobrowse -quiet
codesign --verify --deep --strict /tmp/mnt-arm64/sssketch.app
spctl -a -vvv --type execute /tmp/mnt-arm64/sssketch.app
file /tmp/mnt-arm64/sssketch.app/Contents/Resources/native-engine/sssketch-engine.app/Contents/MacOS/sssketch-engine
hdiutil detach /tmp/mnt-arm64 -quiet

hdiutil attach sssketch-X.Y.Z-x64.dmg -mountpoint /tmp/mnt-x64 -nobrowse -quiet
codesign --verify --deep --strict /tmp/mnt-x64/sssketch.app
spctl -a -vvv --type execute /tmp/mnt-x64/sssketch.app
file /tmp/mnt-x64/sssketch.app/Contents/Resources/native-engine/sssketch-engine.app/Contents/MacOS/sssketch-engine
hdiutil detach /tmp/mnt-x64 -quiet
```

Expected for both: `codesign --verify` exits 0 silently (valid signature); `spctl -a -vvv` reports
`accepted` and `source=Notarized Developer ID`; the `file` command on the arm64 DMG's engine binary
reports `arm64`, and on the x64 DMG's engine binary reports `x86_64`.

- [ ] **Step 5: Confirm no stray zip artifact was published (the Task 3 bug fix actually held)**

```bash
gh release view vX.Y.Z --json assets --jq '.assets[].name'
```

Expected: only the two `.dmg` files (plus whatever `.blockmap`/checksum files electron-builder
normally publishes alongside a DMG) — no `.zip`. If a `.zip` is present, `mac.target[0].arch` in
`electron-builder.yml` didn't actually take effect on the x64 leg — re-check Task 3's YAML change
landed correctly before investigating further.

- [ ] **Step 6: Clean up local verification files**

```bash
rm -rf /tmp/release-verify-vX.Y.Z /tmp/mnt-arm64 /tmp/mnt-x64
```

- [ ] **Step 7: Report the real outcome**

Summarize plainly: which of the above checks passed, whether a duplicate draft was hit and how it
was resolved, and the two real asset names/sizes. No claims of success without having actually run
Steps 2-5 against a real release — this task's whole purpose is a real-hardware-adjacent check
that can't be verified by inspection alone.

---

## Self-review notes

- **Spec coverage:** every section of the approved design doc maps to a task above — matrix
  build (Task 4 Step 1), native-engine per-leg build + cache key (Task 4 Step 2), bridge
  unconditional/unchanged (Task 4 Step 3), `mac.defaultArch` + `artifactName` fix (Task 3),
  rubberband vendoring mechanism (Tasks 1 + 2 + Task 4 Step 5), signing generalizes with no code
  change (Task 4 Step 7, verified by inspection not edited), duplicate-draft-release risk accepted
  and checked manually (Task 5 Step 3), real verification methodology matching v1.1.4/v1.1.5
  (Task 5 Steps 4-5).
- **Extra beyond the design doc:** the `mac.target[0].arch` fix in Task 3 and the explicit
  `--arm64`/`--x64` CLI flag in Task 4 Step 6 aren't mentioned in the design doc's text — both are
  real, concretely-traced necessities for the design's own stated goal (two DMGs, nothing else) to
  actually work, found by tracing `app-builder-lib`'s real source during planning, the same way
  the design doc's own `dmg.artifactName` bug was found. Documented inline in both tasks with the
  trace that justifies them.
- **No placeholders:** every step has real, complete file content or a real runnable command with
  a stated expected result.
