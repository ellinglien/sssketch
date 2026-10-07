// build/packagedAppCheck.js
//
// What a packaged macOS sssketch.app must hold, checked by build/afterPack.js
// right after packing -- before signing, notarizing or publishing -- so a
// release that would ship without one of these fails in CI instead of
// reaching anyone. Both gaps it guards against shipped for real (share-
// readiness audit, docs/superpowers/specs/2026-10-07-share-readiness-audit.md):
//   - B3: no release up to 1.4.0 had the YAMNet model; release.yml never ran
//     scripts/vendor-yamnet.sh, and the app degrades silently without it.
//   - B2: app.asar was 488 MB in 1.4.0 because electron-builder.yml's `files`
//     let the whole repo in; the app itself is ~20 MB.
// CommonJS, dependency-free, next to afterPack.js, which require()s it.
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_LIMITS = {
  // ~21 MB today (out/ plus production node_modules); 60 MB leaves room to
  // grow and still catches the repo being bundled again.
  maxAsarBytes: 60 * 1024 * 1024,
  // Same floor as scripts/vendor-yamnet.sh (the real file is ~16 MB).
  minYamnetBytes: 10 * 1024 * 1024
}

function sizeOf(p) {
  try {
    return fs.statSync(p).size
  } catch {
    return null
  }
}

/** Problems with the packaged app at `appPath` (the .app bundle), as
 * readable lines; empty when it's complete. */
function packagedAppProblems(appPath, limits = {}) {
  const { maxAsarBytes, minYamnetBytes } = { ...DEFAULT_LIMITS, ...limits }
  const res = path.join(appPath, 'Contents', 'Resources')
  const problems = []
  const required = [
    'native-engine/sssketch-engine.app/Contents/MacOS/sssketch-engine',
    'native-engine-bridge/sssketch-bridge.app/Contents/MacOS/sssketch-bridge',
    'rubberband/bin/rubberband',
    'demo-rifff'
  ]
  for (const rel of required) {
    if (!fs.existsSync(path.join(res, rel))) problems.push(`missing Resources/${rel}`)
  }
  const yamnet = sizeOf(path.join(res, 'yamnet', 'yamnet.onnx'))
  if (yamnet === null) {
    problems.push('missing Resources/yamnet/yamnet.onnx (run scripts/vendor-yamnet.sh)')
  } else if (yamnet < minYamnetBytes) {
    problems.push(`Resources/yamnet/yamnet.onnx is only ${yamnet} bytes (truncated download?)`)
  }
  const asar = sizeOf(path.join(res, 'app.asar'))
  if (asar === null) {
    problems.push('missing Resources/app.asar')
  } else if (asar > maxAsarBytes) {
    problems.push(
      `Resources/app.asar is ${asar} bytes, over ${maxAsarBytes}: something outside the app ` +
        "got bundled (check electron-builder.yml's files allowlist)"
    )
  }
  if (fs.existsSync(path.join(res, 'app.asar.unpacked', 'resources'))) {
    problems.push(
      'Resources/app.asar.unpacked/resources exists: resources/ ships through extraResources, ' +
        'not unpacked from the asar'
    )
  }
  return problems
}

module.exports = { packagedAppProblems, DEFAULT_LIMITS }
