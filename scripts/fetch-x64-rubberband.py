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
