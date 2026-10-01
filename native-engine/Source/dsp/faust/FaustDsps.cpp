// native-engine/Source/dsp/faust/FaustDsps.cpp -- the one translation unit that includes the
// generated Faust C++ (generated/*.h, scripts/build-faust-cpp.mjs). Listed in CMakeLists.txt's
// vendored sources: compiled with -w (generated code, not edited by hand) and with
// -ffp-contract=off, so no a*b+c is fused into an FMA -- the web's wasm never fuses, and the
// golden vectors (FaustStageTests) compare against it.
#include "../../FaustStage.h"
#include "generated/glue.h"
#include "generated/pump.h"
#include "generated/reverb.h"
#include "generated/saturate.h"
#include "generated/truepeak.h"

namespace sssketch
{
    std::unique_ptr<faust::dsp> makeFaustDsp(FaustDspKind kind)
    {
        switch (kind)
        {
            case FaustDspKind::saturate: return std::make_unique<faust::SaturateDsp>();
            case FaustDspKind::glue: return std::make_unique<faust::GlueDsp>();
            case FaustDspKind::pump: return std::make_unique<faust::PumpDsp>();
            case FaustDspKind::truepeak: return std::make_unique<faust::TruepeakDsp>();
            case FaustDspKind::reverb: return std::make_unique<faust::ReverbDsp>();
        }
        return nullptr;
    }

    const char* faustDspName(FaustDspKind kind)
    {
        switch (kind)
        {
            case FaustDspKind::saturate: return "saturate";
            case FaustDspKind::glue: return "glue";
            case FaustDspKind::pump: return "pump";
            case FaustDspKind::truepeak: return "truepeak";
            case FaustDspKind::reverb: return "reverb";
        }
        return "";
    }
}
