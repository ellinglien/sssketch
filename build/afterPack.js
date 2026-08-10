// build/afterPack.js
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

// Signs the nested sssketch-engine.app/sssketch-bridge.app bundles (the
// native JUCE audio engine + its x86_64 plugin-scan bridge, copied into the
// outer Electron app's Resources/ dir -- see electron-builder.yml's
// extraResources) and the vendored rubberband binary/dylibs with their own
// Developer ID signature. Gatekeeper and notarization both require every
// nested executable/bundle to carry a valid signature of its own -- see
// docs/superpowers/specs/2026-08-01-signed-notarized-auto-update-design.md's
// "Code signing + entitlements" section for the full rationale, including why
// the engine needs com.apple.security.cs.disable-library-validation (loading
// third-party VST3 plugins at runtime) that the outer app's own entitlements
// don't have.
//
// Runs as electron-builder's afterPack hook -- NOT afterSign. This ordering
// is load-bearing, found the hard way (a real "sssketch is damaged and can't
// be opened" Gatekeeper rejection on a fully notarized v1.1.4 build):
// electron-builder's own signing (macPackager's doSignAfterPack, which also
// runs notarization immediately afterward when `mac.notarize: true`) walks
// the ENTIRE Contents tree via @electron/osx-sign and re-signs every nested
// .app/.framework it finds, unconditionally, BEFORE the afterSign hook ever
// runs. So signing these bundles in afterSign made two things true at once:
// (1) electron-builder's own pass had already sealed the outer .app's
// resource manifest against the PRE-afterSign (unsigned) bytes of these
// files, so re-signing them here changed their bytes and invalidated that
// seal -- `codesign --verify --deep --strict` and Gatekeeper's own spctl
// assessment both failed with "a sealed resource is missing or invalid",
// even though `xcrun stapler validate` and notarsubmission both succeeded
// (they don't re-verify the outer seal against current on-disk bytes the
// way a real launch does); (2) electron-builder's own pass had ALSO already
// re-signed these bundles once already, with entitlementsInherit's generic
// entitlements (no disable-library-validation), before this hook could give
// them their correct ones.
//
// Running in afterPack (before electron-builder's own sign+notarize step)
// fixes half of this -- these bundles get their correct identity and
// entitlements before the outer app is sealed, so the outer manifest is
// computed against their FINAL bytes. But electron-builder's own signing
// pass would still unconditionally re-sign (and re-break) them afterward,
// since it walks and force-signs everything under Contents regardless of
// whether this hook already touched it -- that's what mac.signIgnore in
// electron-builder.yml is for: it tells electron-builder's own pass to
// leave these exact paths alone entirely, so this hook's signature is the
// only one that ever gets applied to them.
//
// CSC_NAME must be the exact Developer ID Application identity string (e.g.
// "Elling Lien (TEAMID)", NOT prefixed with "Developer ID Application:" --
// electron-builder's own CSC_NAME resolution rejects that prefix) -- set as
// an env var alongside electron-builder's own CSC_LINK/CSC_KEY_PASSWORD
// signing vars.
//
// Skips gracefully (not an error) when CSC_NAME isn't set, so an unsigned
// local `--dir` build doesn't require signing credentials that don't exist
// yet.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const identity = process.env.CSC_NAME
  if (!identity) {
    console.log('afterPack: CSC_NAME not set, skipping engine signing (unsigned/local build)')
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // entitlements.engine.plist carries com.apple.security.cs.disable-
  // library-validation -- required for loading third-party VST3 plugins
  // (unsigned by us, arbitrary vendor code) at runtime; hardened runtime
  // blocks loading unsigned/differently-signed code without it. Not
  // present in entitlements.mac.plist (the OUTER app's own entitlements)
  // because the outer Electron process never loads plugin code itself,
  // only this nested engine process does.
  //
  // The plist itself must stay comment-free: codesign's AMFI entitlements
  // parser doesn't reliably handle XML comments (`<!-- -->`) inside an
  // entitlements plist, even though they're valid XML/plist syntax
  // elsewhere -- a real `AMFIUnserializeXML: syntax error` from a comment
  // that was here once, not a hypothetical concern.
  const entitlementsPath = path.join(__dirname, 'entitlements.engine.plist')

  const bundlesToSign = [
    path.join(appPath, 'Contents/Resources/native-engine/sssketch-engine.app'),
    path.join(appPath, 'Contents/Resources/native-engine-bridge/sssketch-bridge.app')
  ]

  for (const bundlePath of bundlesToSign) {
    // The bridge bundle is a genuinely new build target introduced
    // alongside the x86_64 plugin bridge feature -- skip signing it
    // gracefully if it wasn't built for this particular packaging run,
    // same "optional/degradable" philosophy as engineProcess.ts's own
    // existsSync check before passing --bridge-binary.
    if (!fs.existsSync(bundlePath)) {
      console.log(`afterPack: ${bundlePath} not found, skipping (not built this run)`)
      continue
    }
    console.log(`afterPack: signing nested bundle at ${bundlePath}`)
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
        bundlePath
      ],
      { stdio: 'inherit' }
    )
  }

  // The vendored rubberband binary + its dylibs (see
  // scripts/vendor-rubberband.sh) are plain Mach-O files, not .app bundles
  // -- no entitlements needed (no plugin hosting, just a CLI reading/
  // writing files), but each one still needs its own valid signature for
  // notarization, same as every other executable/dylib nested inside the
  // signed outer app. vendor-rubberband.sh ad-hoc-signs these already (for
  // an unsigned local run); this replaces that with the real identity.
  const rubberbandDir = path.join(appPath, 'Contents/Resources/rubberband')
  if (fs.existsSync(rubberbandDir)) {
    const binPath = path.join(rubberbandDir, 'bin/rubberband')
    const libDir = path.join(rubberbandDir, 'lib')
    const filesToSign = [binPath, ...fs.readdirSync(libDir).map((name) => path.join(libDir, name))]
    for (const filePath of filesToSign) {
      console.log(`afterPack: signing vendored file at ${filePath}`)
      execFileSync(
        'codesign',
        ['--force', '--options', 'runtime', '--sign', identity, filePath],
        { stdio: 'inherit' }
      )
    }
  } else {
    console.log(`afterPack: ${rubberbandDir} not found, skipping (not vendored this run)`)
  }
}
