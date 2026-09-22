# zita-rev1 (vendored, unmodified)

These five files are a **verbatim, unmodified copy** of the standalone C++ port of Fons
Adriaensen's *zita-rev1* reverb algorithm:

- Upstream: <https://github.com/PelleJuul/zita-rev1> (`source/`), a straight extraction of the
  DSP core from Fons Adriaensen's original zita-rev1 (<https://kokkinizita.linuxaudio.org/>).
- Vendored at: 2026-09-22, from `master`.
- Files: `global.h`, `pareq.h`, `pareq.cpp`, `reverb.h`, `reverb.cpp`.
  (`reverb.h` includes `pareq.h`, which includes `global.h` — the brief's two files don't
  compile on their own, so their two dependencies come along with them.)

## Licence

Copyright (C) 2003-2017 Fons Adriaensen <fons@linuxaudio.org>

Every file carries its own GPL header verbatim: *"either version 3 of the License, or (at your
option) any later version."* sssketch itself is GPL-3.0-or-later (see the repo `LICENSE`), so
linking this in is compatible. **Do not strip or reformat those headers**, and do not reformat
the bodies either — keeping them byte-identical to upstream is what makes "unmodified copy"
checkable (`md5` against a fresh download).

## How sssketch uses it

Only `native-engine/Source/ReverbBus.cpp` includes `reverb.h`, behind a pimpl, so the vendored
global-namespace `Reverb`/`Pareq`/`Delay` class names never leak into the rest of the engine
(`sssketch::` namespace) or collide with `juce::Reverb`. See `ReverbBus.h` for the parameter
mapping (sssketch's normalised room/damping/pre-delay onto zita's `set_rtmid`/`set_fdamp`/
`set_delay`) and for why the bus runs fully wet (`set_opmix(1)`), with the dry signal staying
on the channel path.

`CMakeLists.txt` compiles these four translation units with `-w`, overriding the project's own
`-Wall -Wextra` — those flags are deliberately scoped to sssketch's own code (see the comment
above `target_compile_options` there), and third-party code we refuse to modify shouldn't be
generating warnings we can't act on.
