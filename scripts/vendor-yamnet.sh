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
# rubberband, this time for a ~14MB model file rather than a licensing
# concern.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/resources/yamnet"
MODEL_URL="https://huggingface.co/andrelgomes/yamnet-onnx/resolve/main/yamnet.onnx"

mkdir -p "$OUT_DIR"
echo "vendor-yamnet: downloading $MODEL_URL"
curl -fL --progress-bar "$MODEL_URL" -o "$OUT_DIR/yamnet.onnx"
echo "vendor-yamnet: wrote $OUT_DIR/yamnet.onnx ($(du -h "$OUT_DIR/yamnet.onnx" | cut -f1))"
