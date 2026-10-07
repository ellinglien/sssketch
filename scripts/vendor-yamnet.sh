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
# Pinned to one commit of the Hugging Face repo, not `main`: a later push
# there can never change what ships. Fallback if this URL ever goes away:
# mirror the same file (same hash) as a GitHub release asset on this repo and
# point MODEL_URL at that instead -- the hash check below stays as it is.
MODEL_URL="https://huggingface.co/andrelgomes/yamnet-onnx/resolve/8a03a1572569685c42fdbef54ff36435dbaaf689/yamnet.onnx"
# sha256 of that exact file (16093603 bytes), checked 2026-10-07 against the
# copy vendored 2026-09-14.
MODEL_SHA256="1510041dce24a2e9e84ec546807ac408ae496da6d1ed41bc3ccba649623f8e19"

# curl -f only fails on an HTTP error status -- it would NOT fail if Hugging
# Face ever served something unexpected but still 200 OK (e.g. a Git-LFS
# pointer text file, the classic gotcha for a wrong/blob-form URL), or a
# different file. This runs unattended in CI before every release, so a
# silent bad fetch would ship a broken model with no build-time error, only a
# confusing runtime failure much later when onnxruntime-web tries to load it.
# So the download goes to a temp file and only replaces the model once its
# sha256 matches; anything else fails the build here, loudly.
mkdir -p "$OUT_DIR"
TMP_FILE="$OUT_DIR/yamnet.onnx.download"
trap 'rm -f "$TMP_FILE"' EXIT

echo "vendor-yamnet: downloading $MODEL_URL"
curl -fL --progress-bar "$MODEL_URL" -o "$TMP_FILE"

if ! echo "$MODEL_SHA256  $TMP_FILE" | shasum -a 256 -c -; then
  echo "vendor-yamnet: sha256 mismatch -- got $(shasum -a 256 "$TMP_FILE" | cut -d' ' -f1), expected $MODEL_SHA256 ($(wc -c < "$TMP_FILE" | tr -d ' ') bytes); not the pinned model (a truncated download, a Git-LFS pointer file, or a changed upstream), so it was not installed" >&2
  exit 1
fi

mv -f "$TMP_FILE" "$OUT_DIR/yamnet.onnx"
echo "vendor-yamnet: wrote $OUT_DIR/yamnet.onnx ($(du -h "$OUT_DIR/yamnet.onnx" | cut -f1))"
