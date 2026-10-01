// glue.dsp -- the glue compressor for ell.ing/radio's master chain (phase C), written from Faust
// primitives only (no library functions) so the generated code carries this repo's licence,
// GPL-2.0-or-later. Replaces the DynamicsCompressorNode glue stage.
//
//   detector  stereo-linked: the louder channel's level, in dB (the image never shifts)
//   curve     a soft knee: no reduction below threshold - knee/2, the full ratio above
//             threshold + knee/2, a quadratic blend between (the usual soft-knee computer)
//   envelope  on the reduction itself, in dB, two of them, the deeper one wins:
//               fast  attack 30 ms, release 250 ms (the spec's glue times)
//               slow  attack 400 ms, release 1.5 s
//             A short burst only charges the fast one, so it lets go in 250 ms; under steady
//             compression the slow one holds the floor, so the release stays slow and the
//             level does not pump. Program-dependent release, for two one-poles.
//   output    no look-ahead (no latency) and no makeup: unity below the knee, as the old
//             stage's trim made the DynamicsCompressor
declare name "glue";
declare author "ell.ing/radio";
declare license "GPL-2.0-or-later";
declare latency_samples "0";

SR = min(192000, max(1, fconstant(int fSamplingFreq, <math.h>)));

threshold = hslider("threshold [unit:dB]", -14, -40, 0, 0.1);
ratio = hslider("ratio", 2, 1, 10, 0.01);
knee = hslider("knee [unit:dB]", 6, 0, 24, 0.1);

coef(sec) = exp(-1 / (sec * SR));
// a one-pole on the reduction (<= 0 dB): toward more reduction at the attack rate, back at the release rate
env(att, rel) = (follow ~ _)
with {
  follow(prev, x) = select2(x < prev, x + (prev - x) * coef(rel), x + (prev - x) * coef(att));
};

curve(x) = select2(over > knee / 2, select2(over > -knee / 2, 0, soft), hard)
with {
  over = x - threshold;
  slope = 1 / ratio - 1;
  hard = slope * over;
  soft = slope * (over + knee / 2) * (over + knee / 2) / (2 * max(knee, 1e-6));
};

level(l, r) = 20 * log10(max(max(abs(l), abs(r)), 1e-6));
reduction(l, r) = level(l, r) : curve <: env(0.03, 0.25), env(0.4, 1.5) : min;
meter(gr) = attach(gr, gr : hbargraph("gr [unit:dB]", -24, 0));

process(l, r) = l * g, r * g
with {
  g = pow(10, meter(reduction(l, r)) / 20);
};
