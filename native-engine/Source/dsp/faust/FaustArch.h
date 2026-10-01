// FaustArch.h -- sssketch's own minimal Faust architecture: the three base classes Faust's
// generated C++ derives from or calls (dsp, UI, Meta), in namespace sssketch::faust. Written here
// rather than taken from Faust's stock headers (faust/dsp/dsp.h, faust/gui/UI.h, faust/gui/meta.h),
// which carry GRAME's own licence terms; see LICENSES.md. Only what the generated code for our
// .dsp files uses is declared: no soundfiles, no polyphony, no remote control.
//
// arch.cpp (the -a file scripts/build-faust-cpp.mjs hands the compiler) includes this before
// Faust's <<includeclass>>, so every generated/<name>.h is self-contained. The standard headers
// the generated class includes are included here first, outside the namespace, which makes the
// generated class's own #include lines (inside it) no-ops.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <math.h>

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif

namespace sssketch::faust
{

/** The math functions the generated code calls (it is compiled with `-fm arch`, which names them
 *  fast_<fn>f and leaves their definitions to the architecture). The web's wasm imports the same
 *  functions from JavaScript's Math (faustProcessor.js), which works in double precision: so here
 *  each one widens to double, calls the double libm, and rounds once to float, as the web does.
 *  The float libm (expf, powf, ...) differs in the last bit often enough that the reverb's
 *  feedback carried it to ~2e-5 from the web's output. floor and fabs are exact either way; fmod
 *  and remainder follow the web's JS (`a % b`, `a - round(a / b) * b`), and rint its Math.round
 *  (half up, not half to even). */
inline float fast_expf(float x) { return (float) std::exp((double) x); }
inline float fast_exp2f(float x) { return (float) std::exp2((double) x); }
inline float fast_exp10f(float x) { return (float) std::pow(10.0, (double) x); }
inline float fast_logf(float x) { return (float) std::log((double) x); }
inline float fast_log2f(float x) { return (float) std::log2((double) x); }
inline float fast_log10f(float x) { return (float) std::log10((double) x); }
inline float fast_powf(float x, float y) { return (float) std::pow((double) x, (double) y); }
inline float fast_sqrtf(float x) { return (float) std::sqrt((double) x); }
inline float fast_sinf(float x) { return (float) std::sin((double) x); }
inline float fast_cosf(float x) { return (float) std::cos((double) x); }
inline float fast_tanf(float x) { return (float) std::tan((double) x); }
inline float fast_asinf(float x) { return (float) std::asin((double) x); }
inline float fast_acosf(float x) { return (float) std::acos((double) x); }
inline float fast_atanf(float x) { return (float) std::atan((double) x); }
inline float fast_atan2f(float y, float x) { return (float) std::atan2((double) y, (double) x); }
inline float fast_sinhf(float x) { return (float) std::sinh((double) x); }
inline float fast_coshf(float x) { return (float) std::cosh((double) x); }
inline float fast_tanhf(float x) { return (float) std::tanh((double) x); }
inline float fast_floorf(float x) { return std::floor(x); }
inline float fast_ceilf(float x) { return std::ceil(x); }
inline float fast_fabsf(float x) { return std::fabs(x); }
inline float fast_fmodf(float x, float y) { return (float) std::fmod((double) x, (double) y); }
inline float fast_remainderf(float x, float y) { return (float) ((double) x - std::floor((double) x / (double) y + 0.5) * (double) y); }
inline float fast_rintf(float x) { return (float) std::floor((double) x + 0.5); }

/** The DSP's `declare key "value";` lines (name, licence, latency_samples, ...). */
struct Meta
{
    virtual ~Meta() = default;
    virtual void declare(const char* key, const char* value) = 0;
};

/** The DSP's parameters (sliders) and meters (bargraphs), each a zone (a FAUSTFLOAT in the DSP
 *  object) under a label, nested in boxes. Every callback is a no-op unless overridden. */
struct UI
{
    virtual ~UI() = default;
    virtual void openTabBox(const char*) {}
    virtual void openHorizontalBox(const char*) {}
    virtual void openVerticalBox(const char*) {}
    virtual void closeBox() {}
    virtual void addButton(const char*, FAUSTFLOAT*) {}
    virtual void addCheckButton(const char*, FAUSTFLOAT*) {}
    virtual void addVerticalSlider(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addHorizontalSlider(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addNumEntry(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addHorizontalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addVerticalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void declare(FAUSTFLOAT*, const char*, const char*) {}
};

/** A generated DSP. compute() never allocates; construct and init() it off the audio thread. */
class dsp
{
public:
    virtual ~dsp() = default;
    virtual int getNumInputs() = 0;
    virtual int getNumOutputs() = 0;
    virtual void buildUserInterface(UI*) = 0;
    virtual int getSampleRate() = 0;
    virtual void init(int sampleRate) = 0;
    virtual void instanceInit(int sampleRate) = 0;
    virtual void instanceConstants(int sampleRate) = 0;
    virtual void instanceResetUserInterface() = 0;
    virtual void instanceClear() = 0;
    virtual dsp* clone() = 0;
    virtual void metadata(Meta*) = 0;
    virtual void compute(int count, FAUSTFLOAT** inputs, FAUSTFLOAT** outputs) = 0;
};

} // namespace sssketch::faust
