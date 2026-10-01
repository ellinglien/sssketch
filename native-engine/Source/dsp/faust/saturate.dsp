// saturate.dsp -- gentle tape-style saturation on the master, before the glue (Elling,
// 2026-10-01), written from Faust primitives only (GPL-2.0-or-later). Its Web Audio twin, used
// when this cannot load, is masterChain.ts's WaveShaperNode on the same curve.
//
//   curve   an asymmetric tanh: (tanh(DRIVE x + BIAS) - tanh(BIAS)) / slope, the slope at 0
//           divided out so small signals pass at unity (level-matched: only peaks are bent).
//           The bias tips it a little, for some even harmonics besides tanh's odd ones.
//   DC      the asymmetry leaves a program-dependent offset: a one-pole DC blocker (~5 Hz)
//   drive   adjustable (Engine.setSaturation); 0.9 by default (Elling, 2026-10-01: "a little
//           too strong" at 1.8), measured in spike/engine-check saturation
//   makeup  +0.5 dB at a drive of 1.8, in proportion to the drive squared, so a dense mix comes
//           out about as loud as it went in (only its peaks bent)
declare name "saturate";
declare author "ell.ing/radio";
declare license "GPL-2.0-or-later";
declare latency_samples "0";

SR = min(192000, max(1, fconstant(int fSamplingFreq, <math.h>)));
PI = 3.141592653589793;
// the drive, set by Engine.setSaturation (0..1 -> 0..1.8: 1 is the drive it was built at, 0.5,
// the default, half of it), glided over ~20 ms so a slider cannot click; 0 is an exact
// pass-through (below)
DRIVE = hslider("drive", 0.9, 0, 1.8, 0.001) : smooth;
smooth = *(1 - c) : + ~ *(c) with { c = exp(-1 / (0.02 * SR)); };
// makeup in proportion to the drive squared: +0.5 dB at 1.8, where it level-matched a dense mix
MAKEUP = pow(10, 0.5 * (DRIVE / 1.8) * (DRIVE / 1.8) / 20);
BIAS = 0.1;

th(u) = (exp(2 * v) - 1) / (exp(2 * v) + 1) with { v = max(-20, min(20, u)); };
slope = max(DRIVE, 1e-6) * (1 - th(BIAS) * th(BIAS));
shape(x) = (th(DRIVE * x + BIAS) - th(BIAS)) / slope * MAKEUP;
// y = x - x[n-1] + R y[n-1], R for a ~5 Hz corner
R = exp(-2 * PI * 5 / SR);
dcblock = _ <: _, mem : - : + ~ *(R);

// below a drive of 0.001 a channel passes untouched, DC blocker and all: exact unity, through the
// same node (so the same latency, 0)
chan(x) = select2(DRIVE < 0.001, x : shape : dcblock, x);
process = chan, chan;
