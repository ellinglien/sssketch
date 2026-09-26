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

Three real things this had to get right, found by actually running this
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
  3. Homebrew is winding down Intel macOS bottles, and it does it one
     formula at a time, silently, via *bottle rebuilds*: the source
     version stays put, but the formula gets re-bottled (`rebuild: N` in
     the JSON API) for arm64 and Linux only, and the JSON API then only
     ever reports that newest rebuild's files. mpg123 1.33.7 hit exactly
     this on 2026-09-26 -- rebuild 1 has no x86_64 macOS bottle at all,
     while rebuild 0 of the same 1.33.7 still sits in GHCR with its
     `sonoma` bottle intact. So a missing platform tag in the JSON API is
     NOT the same as "no Intel bottle exists": `bottle_url_for_platform`
     below falls back through earlier *rebuilds of the same version*
     (same sources, same ABI -- never an earlier version, which could
     change a dylib's compatibility version out from under its
     dependents). If even rebuild 0 has no Intel bottle, that IS the end
     of the line for that dependency and this fails loudly rather than
     quietly shipping something broken -- see the error message.

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
import urllib.error
import urllib.request

PLATFORM_TAG = "sonoma"  # x86_64 macOS -- the newest tag Homebrew ever built Intel bottles for
GHCR_REPO = "https://ghcr.io/v2/homebrew/core"


def brew_json(formula):
    with urllib.request.urlopen(f"https://formulae.brew.sh/api/formula/{formula}.json") as r:
        return json.load(r)


def ghcr_token(formula):
    url = f"https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/{formula}:pull"
    with urllib.request.urlopen(url) as r:
        return json.load(r)["token"]


def ghcr_manifest(formula, tag, token):
    """The OCI image index for one bottle tag -- one `manifests` entry per
    platform, each annotated with the blob digest of that platform's bottle."""
    req = urllib.request.Request(
        f"{GHCR_REPO}/{formula}/manifests/{tag}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.oci.image.index.v1+json",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def base_bottle_tag(data):
    """Homebrew's GHCR tag for a formula's current *source* version, with no
    rebuild suffix: `<version>` normally, `<version>_<revision>` when the
    formula itself carries a Homebrew revision."""
    version = data["versions"]["stable"]
    revision = data.get("revision", 0)
    return f"{version}_{revision}" if revision else version


def bottle_url_for_platform(formula, data, token):
    """The download URL for this formula's PLATFORM_TAG bottle, or None.

    Prefers whatever the JSON API reports (always the newest rebuild). When
    that rebuild dropped the platform -- see docstring point 3 -- walks back
    through earlier rebuilds of the SAME version, newest first, and uses the
    last one that still has it."""
    files = data["bottle"]["stable"]["files"]
    if PLATFORM_TAG in files:
        return files[PLATFORM_TAG]["url"], None

    base_tag = base_bottle_tag(data)
    rebuild = data["bottle"]["stable"].get("rebuild", 0)
    # Newest earlier rebuild first, then the original (suffix-less) bottle.
    candidates = [f"{base_tag}-{n}" for n in range(rebuild - 1, 0, -1)] + [base_tag]
    for tag in candidates:
        try:
            index = ghcr_manifest(formula, tag, token)
        except urllib.error.HTTPError:
            continue
        for entry in index.get("manifests", []):
            annotations = entry.get("annotations", {})
            # e.g. "1.33.7.sonoma" on rebuild 0, "1.33.7.sonoma.2" on rebuild 2
            ref = annotations.get("org.opencontainers.image.ref.name", "")
            prefix = f"{base_tag}.{PLATFORM_TAG}"
            if ref != prefix and not ref.startswith(f"{prefix}."):
                continue
            digest = annotations.get("sh.brew.bottle.digest")
            if digest:
                return f"{GHCR_REPO}/{formula}/blobs/sha256:{digest}", tag
    return None, None


def fetch_bottle(formula, root):
    data = brew_json(formula)
    token = ghcr_token(formula)
    url, fallback_tag = bottle_url_for_platform(formula, data, token)
    if url is None:
        raise RuntimeError(
            f"{formula} has no '{PLATFORM_TAG}' bottle in its current build, nor in any earlier "
            f"rebuild of {base_bottle_tag(data)} -- available in the current build: "
            f"{list(data['bottle']['stable']['files'].keys())}. Homebrew has stopped publishing "
            f"Intel macOS bottles for this formula entirely, so the x64 release leg can no longer "
            f"be produced this way. That is a product decision, not a bug to work around: either "
            f"drop the Intel target, or vendor rubberband from source/upstream binaries instead."
        )
    if fallback_tag:
        print(
            f"  {formula}: current bottle has no {PLATFORM_TAG}; falling back to the same "
            f"version's earlier rebuild {fallback_tag}",
            file=sys.stderr,
        )
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
