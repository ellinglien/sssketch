// pump.dsp -- a subtle sidechain pump from the drums (Elling, 2026-10-01), written from Faust
// primitives only (GPL-2.0-or-later). Four inputs: the pumped rows (program L, R) and the drums
// rows (key L, R); two outputs: the program, ducked a little on each kick.
//
//   key       the drums' louder side, low-passed at 150 Hz twice (the kick, not the hats, so the
//             duck lets go between kicks), its level followed fast (1 ms up, 30 ms down)
//   duck      0 below -30 dB of key, the full DEPTH at -10 dB and over, in proportion between;
//             then the duck itself moves with a 3 ms attack and a RELEASE (200 ms) back up: the
//             pump's breath
//   program   multiplied by it: a separate gain from the rows' own (the radio's duck gesture
//             multiplies with it, never overridden)
declare name "pump";
declare author "ell.ing/radio";
declare license "GPL-2.0-or-later";
declare latency_samples "0";

PI = 3.141592653589793;
SR = min(192000, max(1, fconstant(int fSamplingFreq, <math.h>)));
DEPTH = hslider("depth [unit:dB]", 4, 0, 12, 0.1);
REL = hslider("release [unit:s]", 0.2, 0.05, 1, 0.001);
ATT = 0.003;
LOW = -30;
HIGH = -10;

coef(t) = exp(-1 / (t * SR));
lp150 = *(1 - c) : + ~ *(c) with { c = exp(-2 * PI * 150 / SR); };
// a one-pole that rises at `up` and falls at `down` (seconds)
follow(up, down) = (f ~ _) with { f(prev, v) = select2(v > prev, v + (prev - v) * coef(down), v + (prev - v) * coef(up)); };
key(kl, kr) = max(abs(kl : lp150 : lp150), abs(kr : lp150 : lp150)) : follow(0.001, 0.03);
// the duck as a positive amount of dB, followed: in at ATT, back out at REL
duckDb(e) = -(DEPTH * min(1, max(0, (20 * log10(max(e, 1e-6)) - LOW) / (HIGH - LOW))) : follow(ATT, REL));
meter(d) = attach(d, d : hbargraph("duck [unit:dB]", -12, 0));

process(pl, pr, kl, kr) = pl * g, pr * g
with {
  g = pow(10, meter(duckDb(key(kl, kr))) / 20);
};
