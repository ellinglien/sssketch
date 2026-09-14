#!/usr/bin/env bash
# scripts/vendor-yamnet.sh
#
# Downloads the YAMNet ONNX model into resources/yamnet/, so electron-builder
# can ship it as an extraResource (see electron-builder.yml) the same way
# scripts/vendor-rubberband.sh already vendors the rubberband binary.
#
# There is no single official Google-published ONNX export of YAMNet (the
# official distribution is TF-Hub/TFJS format) -- this fetches a real,
# verified tf2onnx conversion of Google's official YAMNet (AudioSet, 521
# classes), Apache-2.0 licensed, from andrelgomes/yamnet-onnx on Hugging
# Face (verified directly 2026-09-14: MobileNetV1 backbone, ~3.7M params,
# 16kHz native input, waveform in -> [521 class scores, 1024-dim
# embeddings, 64-dim log-mel] out per frame -- this app only uses the
# 1024-dim embedding output).
#
# Not run as part of `npm run dev`/`npm test` -- only in CI's release
# workflow and by hand for local packaged-build testing, same as
# vendor-rubberband.sh. Gitignored (resources/yamnet/), not committed --
# same "not committing binaries to a now-public repo" reasoning as
# rubberband, this time for a ~16MB model file rather than a licensing
# concern.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/resources/yamnet"
MODEL_URL="https://huggingface.co/andrelgomes/yamnet-onnx/resolve/main/yamnet.onnx"

# A real, non-truncated download of this exact file is ~16MB (verified
# 2026-09-14: content-length 16093603 bytes). curl -f only fails on an HTTP
# error status -- it would NOT fail if Hugging Face ever served something
# unexpected but still 200 OK (e.g. a Git-LFS pointer text file, the classic
# gotcha for a wrong/blob-form URL -- a few hundred bytes of plaintext, not
# the real binary). This runs unattended in CI before every release, so a
# silent bad fetch here would ship a broken model with no build-time error,
# only a confusing runtime failure much later when onnxruntime-web tries to
# load it -- fail loudly here instead, immediately, with a clear message.
MIN_EXPECTED_BYTES=$((10 * 1024 * 1024))

mkdir -p "$OUT_DIR"
echo "vendor-yamnet: downloading $MODEL_URL"
curl -fL --progress-bar "$MODEL_URL" -o "$OUT_DIR/yamnet.onnx"

actual_bytes=$(wc -c < "$OUT_DIR/yamnet.onnx" | tr -d ' ')
if [ "$actual_bytes" -lt "$MIN_EXPECTED_BYTES" ]; then
  echo "vendor-yamnet: downloaded file is only $actual_bytes bytes, expected at least $MIN_EXPECTED_BYTES -- this looks like a truncated download or an unexpected response (e.g. a Git-LFS pointer file) rather than the real model; removing it" >&2
  rm -f "$OUT_DIR/yamnet.onnx"
  exit 1
fi

echo "vendor-yamnet: wrote $OUT_DIR/yamnet.onnx ($(du -h "$OUT_DIR/yamnet.onnx" | cut -f1))"
