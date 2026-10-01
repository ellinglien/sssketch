// reverb.dsp -- a smooth, cavernous room (phase C), written from Faust primitives only (no
// library functions), so the generated code carries this repo's licence, GPL-2.0-or-later.
// Not the default: the engine plays the convolver (noise.ts REVERB_IR) unless faustReverb or
// ?dev&reverb=faust. Aimed at that convolver (Elling, 2026-10-01: "smoother", "more cavernous").
//
// Per side (L and R are separate networks, decorrelated by their lengths; 5% crossfeed, so a
// row panned right keeps its room mostly on the right, as the post-pan send intends):
//   pre-delay   30 ms
//   diffusion   six short Schroeder allpasses (g 0.6): the onset is already dense
//   FDN         sixteen lines (prime lengths, 1031-2767 samples at 48 kHz, times SIZE) mixed by
//               an orthonormal 16x16 Hadamard matrix; each line's delay swings a few samples
//               with its own slow sine (0.11-0.97 Hz, linear-interpolated fractional
//               delay), which smears the modes a fixed network rings on
//   absorption  in each line Jot's one-pole: a gain for the low-frequency T60, a pole that
//               shortens the highs' (T60 at Nyquist = HF_RATIO x T60 at DC), so the tail
//               darkens as it decays
declare name "reverb";
declare author "ell.ing/radio";
declare license "GPL-2.0-or-later";
declare latency_samples "0";

PI = 3.141592653589793;
SR = min(192000, max(1, fconstant(int fSamplingFreq, <math.h>)));
T60 = hslider("t60 [unit:s]", 5.0, 0.5, 12, 0.01);        // at low frequencies
HF_RATIO = hslider("hf ratio", 0.38, 0.05, 1, 0.001);       // T60 at Nyquist / T60 at DC
DEPTH = hslider("mod depth [unit:samples]", 12, 0, 16, 0.1);
OUT = hslider("level", 0.3, 0, 2, 0.001);
SIZE = hslider("size", 2.2, 0.5, 3, 0.01);                  // scales the FDN lines
CROSS = 0.05;

len(n) = max(1, int(n * SR / 48000)); // a length in samples at 48 kHz, at the running rate
wrap(x) = x - floor(x);
phasor(hz) = (+(hz / SR) : wrap) ~ _;
lfo(hz, ph) = sin(2 * PI * (phasor(hz) + ph));

// Schroeder allpass: v = x + g v[n-N]; y = v[n-N] - g v
ap(n, g) = (+ ~ (@(len(n) - 1) : *(g))) <: @(len(n)), *(g) : -;
DIFF = hslider("diffusion", 0.7, 0, 0.85, 0.01);
diffuse(a, b, c, d, e, f) = ap(a, DIFF) : ap(b, DIFF) : ap(c, DIFF) : ap(d, DIFF) : ap(e, DIFF) : ap(f, DIFF);

// a line: fractional delay (n - 1 samples: the feedback adds one) swinging +-DEPTH, then Jot's
// absorbent one-pole for this length
line(n0, hz, ph) = fdelay : absorb
with {
  n = n0 * SIZE;
  d = max(0, len(n) - 1 - DEPTH - 1 + DEPTH * lfo(hz, ph));
  fdelay = _ <: @(int(d)), @(int(d) + 1) : *(1 - (d - int(d))), *(d - int(d)) :> _;
  g = pow(10, -3 * len(n) / (T60 * SR));
  b = (log(10) / 4) * log10(g) * (1 - 1 / (HF_RATIO * HF_RATIO));
  absorb = *(g * (1 - b)) : + ~ *(b);
};

// orthonormal 8x8 Hadamard (a fast Walsh-Hadamard transform over 1/sqrt 8)
h8(a, b, c, d, e, f, g, h) =
  (p0 + q0) * s, (p1 + q1) * s, (p2 + q2) * s, (p3 + q3) * s,
  (p0 - q0) * s, (p1 - q1) * s, (p2 - q2) * s, (p3 - q3) * s
with {
  s = 1 / sqrt(8);
  p0 = (a + b) + (c + d); p1 = (a - b) + (c - d); p2 = (a + b) - (c + d); p3 = (a - b) - (c - d);
  q0 = (e + f) + (g + h); q1 = (e - f) + (g - h); q2 = (e + f) - (g + h); q3 = (e - f) - (g - h);
};

// orthonormal 16x16 Hadamard: two 8x8s, then a butterfly over 1/sqrt 2
bfly16(a0, a1, a2, a3, a4, a5, a6, a7, b0, b1, b2, b3, b4, b5, b6, b7) = (a0 + b0) * r, (a1 + b1) * r, (a2 + b2) * r, (a3 + b3) * r, (a4 + b4) * r, (a5 + b5) * r, (a6 + b6) * r, (a7 + b7) * r, (a0 - b0) * r, (a1 - b1) * r, (a2 - b2) * r, (a3 - b3) * r, (a4 - b4) * r, (a5 - b5) * r, (a6 - b6) * r, (a7 - b7) * r
with { r = 1 / sqrt(2); };
h16 = (h8, h8) : bfly16;

fdn(n1, n2, n3, n4, n5, n6, n7, n8, n9, n10, n11, n12, n13, n14, n15, n16, ph) = (inject : lines) ~ h16 : out
with {
  inject(f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, x) = f1 + x, f2 + x, f3 + x, f4 + x, f5 + x, f6 + x, f7 + x, f8 + x, f9 + x, f10 + x, f11 + x, f12 + x, f13 + x, f14 + x, f15 + x, f16 + x;
  lines = line(n1, 0.11, ph + 0.0), line(n2, 0.167, ph + 0.0625), line(n3, 0.225, ph + 0.125), line(n4, 0.282, ph + 0.1875), line(n5, 0.339, ph + 0.25), line(n6, 0.397, ph + 0.3125), line(n7, 0.454, ph + 0.375), line(n8, 0.511, ph + 0.4375), line(n9, 0.569, ph + 0.5), line(n10, 0.626, ph + 0.5625), line(n11, 0.683, ph + 0.625), line(n12, 0.741, ph + 0.6875), line(n13, 0.798, ph + 0.75), line(n14, 0.855, ph + 0.8125), line(n15, 0.913, ph + 0.875), line(n16, 0.97, ph + 0.9375);
  out(o1, o2, o3, o4, o5, o6, o7, o8, o9, o10, o11, o12, o13, o14, o15, o16) = (o1 - o2 + o3 - o4 + o5 - o6 + o7 - o8 + o9 - o10 + o11 - o12 + o13 - o14 + o15 - o16) / 4;
};

predelay = int(0.03 * SR);

process(l, r) =
  ((l + CROSS * r) @ predelay : diffuse(142, 107, 379, 277, 211, 163) : fdn(1031, 1151, 1259, 1367, 1481, 1597, 1709, 1823, 1931, 2039, 2153, 2267, 2377, 2503, 2609, 2719, 0)) * OUT,
  ((r + CROSS * l) @ predelay : diffuse(151, 113, 397, 283, 227, 179) : fdn(1061, 1171, 1279, 1399, 1511, 1619, 1733, 1847, 1973, 2081, 2203, 2311, 2423, 2531, 2647, 2767, 0.05)) * OUT;
