// arch.cpp -- the architecture file scripts/build-faust-cpp.mjs passes to the Faust compiler
// (-a). Faust replaces the two markers below with the generated class; everything else is ours.
// The class lands in namespace sssketch::faust, deriving from FaustArch.h's minimal bases (no
// GRAME architecture code is used; see LICENSES.md).
#include "../FaustArch.h"

namespace sssketch::faust
{
<<includeIntrinsic>>
<<includeclass>>
} // namespace sssketch::faust
