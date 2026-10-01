# Faust DSPs in sssketch: licences

`saturate.dsp`, `glue.dsp`, `truepeak.dsp`, `pump.dsp` and `reverb.dsp` are the single copy of the
web radio's Faust DSPs (moved here from ell.ing/radio on 2026-10-01). Both repos compile them:

| repo | compiler | output | script, drift test |
|---|---|---|---|
| sssketch | native Faust **2.88.0** (Homebrew `faust`, `brew pin`ned; `FAUST_VERSION`) | C++, `generated/*.h`, committed | `scripts/build-faust-cpp.mjs`, `scripts/buildFaustCpp.test.ts` |
| ell.ing/radio | `@grame/faustwasm` **0.18.4** (libfaust 2.88.0) | wasm + json in its `src/audio/faust/`, committed | its `scripts/build-faust.mjs`, `scripts/buildFaust.test.ts` |

## The DSPs: GPL-2.0-or-later

Each `.dsp` declares `license "GPL-2.0-or-later"` (Elling wrote them, for the public radio repo,
which is GPL-2.0-or-later). They are written from Faust primitives only: no `import(...)`, no
`stdfaust.lib`, so no Faust library function, and none of the libraries' own licences, is in them.

Faust's documentation states that the code the compiler generates is governed by the licences of
the DSP source it is generated from (and of any library functions it uses), not by the compiler's
licence. So `generated/*.h` is GPL-2.0-or-later too.

sssketch is **GPL-3.0-or-later**. The "or later" in the DSPs' licence lets their code be used
under GPL-3.0, so the engine binary, a combined work, is distributed under GPL-3.0-or-later as a
whole. The files themselves are not relicensed: each `.dsp` and each generated header keeps its
GPL-2.0-or-later notice, and ell.ing/radio (GPL-2.0-or-later) compiles the same `.dsp` files under
those terms.

## The compiler is a build tool

The Faust compiler (GPL-2.0-or-later itself, Homebrew's formula says) runs only at build time, by
hand, through `scripts/build-faust-cpp.mjs`. Nothing of it is linked or shipped; the engine builds
from the committed headers without it.

## No GRAME architecture file

Faust's stock C++ architecture headers (`faust/dsp/dsp.h`, `faust/gui/UI.h`, `faust/gui/meta.h`,
...) carry GRAME's own licence terms and are not used. The compiler is run with our own
architecture: `arch.cpp` (the `-a` file: the generated class inside `namespace sssketch::faust`)
and `FaustArch.h` (the minimal `dsp`, `UI` and `Meta` bases and the `fast_*f` math functions the
`-fm arch` option calls). `-i` would inline a `<faust/...>` include; ours has none, and
`buildFaustCpp.test.ts` fails if any GRAME architecture text appears in the output. Both files are
sssketch's own, GPL-3.0-or-later.

## What checks what, where

| check | needs | where it runs |
|---|---|---|
| hashes: each `.dsp`'s sha256 equals line 2 of `generated/<name>.h` and `dspSha256` in `test/golden/manifest.json` (`buildFaustCpp.test.ts`) | nothing | everywhere, CI included |
| drift: regenerate the C++ with the pinned `faust` and byte-compare (`buildFaustCpp.test.ts`) | `faust` 2.88.0 | locally; skipped (expected) in CI, which has no `faust` |
| bit-exact against the web: `FaustStageTests` (saturate, glue, pump, truepeak bit-identical; reverb within 5e-7) | the built engine | locally, `--test`; CI does not build the engine |
| the web's wasm against the `.dsp` here (radio `buildFaust.test.ts`, also run by its `deploy/deploy-page.sh`) | an sssketch checkout | in the radio repo |

## The golden vectors

`native-engine/test/golden/` holds a seeded input and what the web's committed wasm made of it
(ell.ing/radio `scripts/golden-vectors.mjs`). They are the web's GPL-2.0-or-later output data, used
only by `FaustStageTests`.
