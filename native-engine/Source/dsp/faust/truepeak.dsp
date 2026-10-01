// truepeak.dsp -- a stereo true-peak limiter for ell.ing/radio's master chain (phase C).
// Written from Faust primitives only (no library functions), so the generated code carries
// this repo's licence, GPL-2.0-or-later. (Faust's own limiter_lad_* are GPL-3.0-only, and
// sample-peak, not true-peak.)
//
//   detector  each channel's true peak: |x| and three 4x-oversampled points between samples
//             (Hann-windowed sinc, 24 taps a phase: the ITU-R BS.1770-4 Annex 2 approach with
//             twice its filter length -- measured, 12 taps let full-band noise through at
//             +0.3 dBTP, 24 hold it to -0.86, and 8x points instead of 4x change nothing);
//             the louder channel wins (linked, so the image does not shift)
//   gain      worked as the REDUCTION (1 - gain), which every delay line starts at (0 = unity,
//             so nothing fades in): what each sample needs to stay under the ceiling,
//             max-held over the lookahead and box-averaged over it -- the reduction is already
//             in place when the peak arrives (an average of values that are each >= the need
//             is >= the need), the attack a straight ramp over the lookahead -- then a one-pole
//             release back to 0
//   audio     delayed by the lookahead plus the detector's centring, to meet its gain
declare name "truepeak";
declare author "ell.ing/radio";
declare license "GPL-2.0-or-later";
// the audio delay (DELAY below): the engine delays the mastering bypass by it to match
declare latency_samples "75";

PI = 3.141592653589793;
SR = min(192000, max(1, fconstant(int fSamplingFreq, <math.h>)));
LA = 64;              // lookahead, samples: 1.33 ms at 48 kHz, 1.45 ms at 44.1
OS = 4;               // oversampling of the detector
HALF = 12;            // detector centre: the oversampled points sit between x[n-12] and x[n-11]
DELAY = LA - 1 + HALF; // 75 samples (latency_samples above)

ceilingDb = hslider("ceiling [unit:dB]", -1, -12, 0, 0.01);
releaseSec = hslider("release [unit:s]", 0.1, 0.01, 1, 0.001);
ceiling = pow(10, ceilingDb / 20);
rel = exp(-1 / (releaseSec * SR));

// Hann-windowed sinc: the tap for fraction f (0..1) at offset k (-11..12)
sinc(t) = select2(abs(t) < 1e-9, sin(PI * t) / (PI * t), 1);
hann(t) = 0.5 * (1 + cos(PI * t / 12.5));
tap(f, k) = sinc(f - k) * hann(f - k);

// the point at fraction f between x[n-12] and x[n-11]: sum over x[n-12+k], k = -11..12
interp(f, x) = par(i, 24, x @ (23 - i) * tap(f, i - 11)) :> _;
truePeak(x) = abs(x @ HALF), par(j, OS - 1, abs(interp((j + 1) / OS, x))) : maxTree(OS);

reduction(p) = max(0, 1 - ceiling / max(p, 1e-9));
maxTree(1) = _;
maxTree(n) = maxTree(n / 2), maxTree(n / 2) : max;
maxHold = _ <: par(i, LA, @(i)) : maxTree(LA);
boxAvg = _ <: par(i, LA, @(i)) :> /(LA);
// release: any new reduction at once, then decay with `rel`
release(a) = (red ~ _) with { red(prev) = max(a, prev * rel); };

gain(l, r) = max(truePeak(l), truePeak(r)) : reduction : maxHold : boxAvg : release : 1 - _;
meter(g) = attach(g, 20 * log10(max(g, 1e-6)) : hbargraph("gr [unit:dB]", -24, 0));

process(l, r) = (l @ DELAY) * g, (r @ DELAY) * g
with {
  g = meter(gain(l, r));
};
