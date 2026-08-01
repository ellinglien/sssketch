// build/afterSign.js
const { execFileSync } = require('node:child_process')
const path = require('node:path')

// Signs the nested sssketch-engine.app bundle (the native JUCE audio engine,
// copied into the outer Electron app's Resources/ dir -- see
// electron-builder.yml's extraResources) with its own entitlements. Gatekeeper
// and notarization both require every nested executable/bundle to carry a
// valid Developer ID signature of its own -- see
// docs/superpowers/specs/2026-08-01-signed-notarized-auto-update-design.md's
// "Code signing + entitlements" section for the full rationale, including why
// the engine needs com.apple.security.cs.disable-library-validation (loading
// third-party VST3 plugins at runtime) that the outer app's own entitlements
// don't have.
//
// Runs as electron-builder's afterSign hook. CSC_NAME must be the exact
// Developer ID Application identity string (e.g. "Developer ID Application:
// Elling Lien (TEAMID)") -- set as an env var alongside electron-builder's
// own CSC_LINK/CSC_KEY_PASSWORD signing vars.
//
// Skips gracefully (not an error) when CSC_NAME isn't set, so an unsigned
// local `--dir` build doesn't require signing credentials that don't exist
// yet.
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const identity = process.env.CSC_NAME
  if (!identity) {
    console.log('afterSign: CSC_NAME not set, skipping engine signing (unsigned/local build)')
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const enginePath = path.join(appPath, 'Contents/Resources/native-engine/sssketch-engine.app')
  const entitlementsPath = path.join(__dirname, 'entitlements.engine.plist')

  console.log(`afterSign: signing nested engine bundle at ${enginePath}`)
  execFileSync(
    'codesign',
    [
      '--deep',
      '--force',
      '--options',
      'runtime',
      '--entitlements',
      entitlementsPath,
      '--sign',
      identity,
      enginePath
    ],
    { stdio: 'inherit' }
  )
}
