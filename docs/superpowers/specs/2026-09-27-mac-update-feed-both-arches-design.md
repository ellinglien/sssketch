# The update feed has only ever described one Mac

Date: 2026-09-27
Status: designed and implemented the same day, against the two real published feeds below.
Cannot be fully proven until the next real release -- see "What can and cannot be proven" at
the bottom for exactly what is proven now and what Elling has to watch.

## The bug

`.github/workflows/release.yml` builds macOS as a two-leg matrix (`strategy.matrix.arch:
[arm64, x64]`). Each leg independently runs

```
npx electron-builder --mac --publish always ${{ matrix.arch == 'x64' && '--x64' || '--arm64' }}
```

and each leg writes its own `dist/latest-mac.yml` describing **only its own two artifacts**,
then uploads it to the same GitHub release. Nothing merges them. The second upload wins, so the
published update feed has always described exactly one architecture -- whichever leg finished
last.

The two real feeds, fetched today from the published releases:

```yaml
# https://github.com/ellinglien/sssketch/releases/download/v1.1.22/latest-mac.yml
version: 1.1.22
files:
  - url: sssketch-1.1.22-x64-mac.zip
    ...
  - url: sssketch-1.1.22-x64.dmg
    ...
path: sssketch-1.1.22-x64-mac.zip
```

```yaml
# https://github.com/ellinglien/sssketch/releases/download/v1.3.0/latest-mac.yml
version: 1.3.0
files:
  - url: sssketch-1.3.0-mac.zip     # arm64 -- the arm64 artifacts carry no arch in their names
    ...
  - url: sssketch-1.3.0.dmg         # arm64
    ...
path: sssketch-1.3.0-mac.zip
```

v1.1.22 offered every Mac the Intel build (survivable -- Rosetta). **v1.3.0 offers every Mac,
including Intel ones, an arm64 build that cannot run on an Intel Mac at all.** That is live
right now. It is also, almost certainly, why auto-update has never been confirmed end to end
since it shipped in v1.1.17: the only machine it was ever tried on happened to match whichever
leg won that race, or it silently downloaded a package it could not launch.

## How electron-updater actually chooses, quoted

Installed versions: `electron-updater@6.8.9`, `builder-util-runtime@9.7.0`. Two functions
decide, and both key off **the file name**, never off any arch field -- the feed format has no
arch field to key off.

`node_modules/electron-updater/out/MacUpdater.js`:

```js
/** Filters update files to the appropriate architecture.
 * On arm64 Macs (including Rosetta), arm64 files are preferred when available.
 * On x64 Macs, arm64 files are excluded. */
static filterFilesForArch(files, isArm64Mac) {
    const isArm64File = (file) => file.url.pathname.includes("arm64") || file.info.url?.includes("arm64");
    if (isArm64Mac && files.some(isArm64File)) {
        return files.filter(file => isArm64Mac === isArm64File(file));
    }
    return files.filter(file => !isArm64File(file));
}
```

`node_modules/electron-updater/out/providers/Provider.js`:

```js
function findFile(files, extension, not) {
    ...
    const filteredFiles = files.filter(it => it.url.pathname.toLowerCase().endsWith(`.${extension.toLowerCase()}`));
    const result = filteredFiles.find(it => [it.url.pathname, it.info.url].some(n => n.includes(process.arch))) ?? filteredFiles.shift();
    ...
}
```

`MacUpdater.doDownloadUpdate` calls them in that order, then downloads the result:

```js
files = MacUpdater.filterFilesForArch(files, isArm64Mac)
const zipFileInfo = findFile(files, 'zip', ['pkg', 'dmg'])
```

Read literally, against our artifact names:

- **Intel Mac.** No file name contains `arm64`, so `filterFilesForArch` filters nothing out;
  both zips survive. `findFile` then matches on `process.arch`, which is `"x64"` there, and
  `sssketch-X.Y.Z-x64-mac.zip` contains `x64`. Correct, but only by the luck of the x64 leg
  already carrying its arch in the name.
- **Apple Silicon Mac.** `files.some(isArm64File)` is **false** -- our arm64 artifacts are named
  `sssketch-X.Y.Z-mac.zip` and `sssketch-X.Y.Z.dmg`, with no `arm64` anywhere -- so the arm64
  branch never runs and everything survives. `findFile` then looks for `process.arch`
  (`"arm64"`) in the names, finds nothing, and falls through to `filteredFiles.shift()`:
  **whichever zip happens to be first in the `files:` array.**

So merging the two `files:` lists is necessary but _not sufficient_. It would leave Apple
Silicon picking by array order -- correct only as long as nobody ever reorders the merge, which
is exactly the kind of invisible contract that produced this bug in the first place.

Verified, not reasoned about: driving the real installed `resolveFiles`/`filterFilesForArch`/
`findFile` with a four-entry merged feed picks the right zip for both Macs **only** once the
arm64 files carry `-arm64`. That check is now a test (`scripts/merge-mac-update-feeds.test.ts`),
run against `node_modules`' own code, with `process.arch` forced to each value so the result
does not depend on which machine runs the suite.

## The naming change this forces

`electron-builder.yml` gains one line:

```yaml
mac:
  artifactName: ${name}-${version}-${arch}.${ext}
```

Traced in `app-builder-lib/out/platformPackager.js`: `artifactPatternConfig` reads
`platformSpecificBuildOptions.artifactName` (i.e. the `mac:` section) and sets
`isUserForced: true`, and `expandArtifactNamePattern` then passes the real arch through
regardless of `defaultArch`:

```js
return this.computeArtifactName(
  pattern,
  ext,
  !isUserForced && skipDefaultArch && arch === defaultArchFromString(defaultArch) ? null : arch
)
```

That is the whole point of choosing an explicit pattern over deleting `defaultArch: arm64`:
the arch suffix stops being conditional on anything. What changes:

|           | before                       | after                                |
| --------- | ---------------------------- | ------------------------------------ |
| arm64 dmg | `sssketch-1.3.0.dmg`         | `sssketch-1.3.1-arm64.dmg`           |
| arm64 zip | `sssketch-1.3.0-mac.zip`     | `sssketch-1.3.1-arm64.zip`           |
| x64 dmg   | `sssketch-1.3.0-x64.dmg`     | `sssketch-1.3.1-x64.dmg` (unchanged) |
| x64 zip   | `sssketch-1.3.0-x64-mac.zip` | `sssketch-1.3.1-x64.zip`             |

`defaultArch: arm64` stays, but now only decides the local output directory layout
(`dist/mac` for arm64, `dist/mac-x64` for x64); its comment is rewritten to say so, because
its old stated purpose -- keeping the arm64 names unsuffixed -- is the thing being deliberately
undone.

Three consequences, stated rather than discovered later:

1. **Existing download links keep working, and the README is deliberately left alone.** GitHub
   release assets are per-tag and immutable; nothing already published is renamed or touched.
   Only releases from v1.3.1 onward use the new names. The README's install section now carries
   two _version-pinned_ links (`.../download/v1.3.0/sssketch-1.3.0.dmg` and `...-x64.dmg`,
   commit `05623aa`), and those point at assets that really exist under those names, so
   rewriting them now to names that will not exist until v1.3.1 would break the front page
   today to fix it later. They are correct until v1.3.1 ships -- at which point they are stale,
   which is what the README guard below is for.
2. **The first update across the rename does a full download, not a differential one.**
   `Provider.getBlockMapFiles` derives the _old_ version's blockmap URL by string-replacing the
   version in the _new_ file name, so from `sssketch-1.3.1-arm64.zip` it will ask for
   `sssketch-1.3.0-arm64.zip.blockmap`, which does not exist. `MacUpdater.doDownloadUpdate`
   treats that as `differentialDownloadFailed` and falls back to
   `httpExecutor.download(...)` -- a full, correct download with a logged warning. One slower
   update, once.
3. Anyone who already bookmarked `.../download/v1.3.0/sssketch-1.3.0.dmg` is unaffected; anyone
   who scripted "construct the URL for the newest version" against the old pattern is not, and
   nobody is known to have done that.

## Why a third merge job, and not one electron-builder invocation

The tidy-looking option is `npx electron-builder --mac --x64 --arm64` in a single job, which
makes electron-builder write one correct feed itself. It is not viable here, and the blocker is
structural rather than about wall time:

`electron-builder.yml`'s `extraResources` points at **one** fixed path per native binary:

```yaml
- from: native-engine/build/sssketch_engine_artefacts/sssketch-engine.app
```

and each matrix leg builds exactly one arch of that engine into that path (the x64 leg
cross-compiles with `CMAKE_OSX_ARCHITECTURES=x86_64`). A single invocation building both
Electron shells would copy the _same_ single-arch engine into both packages. That is precisely
the shell/engine architecture mismatch already documented at length on `mac.target` in
`electron-builder.yml`, which was a real shipped bug -- a correctly-fetched Electron shell for
one arch paired with the other arch's engine. Making one invocation safe would mean two
native-engine build trees, a per-arch `extraResources` swap between packaging passes
(electron-builder has no hook for that), or a universal engine build -- all of which are much
larger changes than the bug warrants, and all of which touch `native-engine/`.

Secondary, but real: it also serialises two notarisation round-trips (the long pole of the job,
several minutes each) into one job instead of running them concurrently, and it collapses the
two per-arch caches (`native-engine-${{ matrix.arch }}`, and the x64 rubberband bottle fetch)
into one leg that needs both.

So: keep the matrix exactly as it is, and add a third job that runs after both legs and fixes
the one artifact the matrix cannot produce correctly -- the feed. The `files:` entries already
carry their own `sha512` and `size`, so merging is pure text work: nothing is re-downloaded,
re-hashed, or rebuilt.

Each leg uploads its `dist/latest-mac.yml` as a **workflow artifact** (`latest-mac-yml-arm64`,
`latest-mac-yml-x64`), which is a separate namespace from release assets and so cannot collide.
Both legs still publish their own `latest-mac.yml` to the release as they do today -- there is
no electron-builder switch to suppress just that file -- and the merge job overwrites it with
`gh release upload --clobber` once both are in. The release is a draft throughout (the
`create-release` job makes it one), so no user ever sees the intermediate half-feed.

If either leg fails, `needs: release` means the merge job never runs, the workflow is red, and
the release stays a draft holding one leg's half-feed. That is the correct outcome, and it is
why the guard below also exists as a thing Elling can re-run by hand.

## The guard

The existing protection at this boundary is the `create-release` job (added 2026-08-13, after
electron-builder raced two "create release" calls and split a tag's assets across two drafts).
It prevents a _missing asset_. It has nothing to say about an asset that exists and is wrong,
which is this bug. So the merge job carries the sibling check, and it runs on the feed **as
actually published**, re-downloaded from the release rather than on the local copy:

`scripts/merge-mac-update-feeds.mjs --verify` fails the job unless all of:

- the feed parses, and every entry has a non-empty `sha512` and a positive `size`;
- every file name resolves to a known architecture. A mac artifact whose name contains neither
  `-arm64` nor `-x64` fails loudly, naming the file. **This is the specific regression guard:**
  if a future change puts the unsuffixed arm64 naming back, the release stops rather than
  shipping a feed electron-updater cannot disambiguate;
- **both** architectures are present, each with exactly one `.zip` (the file the updater
  actually downloads) and at least one `.dmg`;
- the feed's `version` matches the tag being released;
- every `files[].url` exists as a real asset on that release (this also re-covers the older
  split-drafts failure, from the other direction);
- the published bytes are identical to what the merge job produced (`diff`), so a clobber that
  silently lost the race to a straggling leg is caught too.

`--verify` takes a feed file, an expected version, and a list of asset names, so it can be run
by hand against any past or future release without running the workflow.

### And the same guard for the README's download links

The install section is now a place that goes stale on every release: it names a version and
links two specific asset filenames. A dead front-page download is the same class of quiet
failure as a half-written feed, and the release run is the one moment that knows what the real
asset names are -- so `--verify-readme` runs in its own job and fails if the README links at a
different tag, at a filename this release does not have, at only one architecture, or if its
link text and its href disagree.

Checked by **name, against the release's own asset list**, not by fetching the URLs: while the
release is still a draft -- it is, right up until Elling un-drafts it -- the public
`/releases/download/<tag>/<asset>` URL 404s for everyone, so a `curl` there would fail on a
perfectly good link.

It is a separate job from the feed merge on purpose. A red `verify-readme-links` does not mean
the build is bad and does not block un-drafting; it means the front page needs a commit, which
does not need a retag. A red `merge-update-feed` is the one that means _do not un-draft_.

The practical consequence, which is a change to the release ritual and is worth knowing before
it surprises anyone: **the README's install section should be updated to the new version and
the new filenames in the commit that gets tagged.** The check runs after the assets exist, so
it can be satisfied by a follow-up commit on master too -- it just leaves one red job on that
run.

## What can and cannot be proven before a real release

Proven now, on this machine, by `npx vitest run`:

- the merge produces a feed with both architectures, arm64 entries first, correct `path`,
  and byte-for-byte stable round-tripping of the real published v1.3.0 and v1.1.22 feeds;
- **the real installed electron-updater code** picks the arm64 zip on an Apple Silicon Mac and
  the x64 zip on an Intel Mac when fed the merged feed, with `process.arch` forced to each
  value in turn;
- the same real code picks by array order -- i.e. is not safe -- when fed a merged feed with
  today's unsuffixed arm64 names, which is the argument for the rename in executable form;
- every guard rejection fires: single-arch feed, unsuffixed name, missing asset, wrong version,
  duplicate entry, two zips for one arch; and for the README, a stale tag, a filename the
  release does not have, link text disagreeing with its href, and an install section offering
  only one architecture.

Not provable without a real release, because it needs GitHub, signing secrets, and notarisation:
that electron-builder actually emits the new names, that the workflow artifact round-trip works,
that `gh release upload --clobber` wins over both legs, and that a real Intel Mac running
v1.3.0 is offered and successfully installs the Intel v1.3.1. Those are listed as an explicit
checklist in the plan, and in the report.
