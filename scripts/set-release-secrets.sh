#!/usr/bin/env bash
# One-time setup: pushes the six secrets release.yml needs for signed,
# notarized builds (see docs/superpowers/specs/2026-08-01-signed-notarized-
# auto-update-design.md). Fill in each value below, then run this script
# once from the repo root (`bash scripts/set-release-secrets.sh`). Not
# invoked by CI or any other script -- purely a copy-paste-once helper so
# the exact `gh secret set` calls don't need to be reconstructed by hand.
#
# Safe to commit: contains no real secret values, only placeholders. Don't
# fill in real values here and commit them -- edit a local copy, or just
# run the `gh secret set` lines directly in a terminal instead.
set -euo pipefail

# --- 1. CSC_LINK: base64-encoded .p12 certificate ---
# Export your Developer ID Application cert from Keychain Access as a .p12
# (right-click the cert -> Export "Developer ID Application: ..."), pick a
# password for it (that password is CSC_KEY_PASSWORD below), then:
#   base64 -i /path/to/cert.p12 | pbcopy
CSC_LINK="PASTE_BASE64_P12_HERE"

# --- 2. CSC_KEY_PASSWORD: the password you set when exporting the .p12 ---
CSC_KEY_PASSWORD="PASTE_P12_EXPORT_PASSWORD_HERE"

# --- 3. CSC_NAME: the exact identity string, e.g. ---
#   "Developer ID Application: Elling Lien (ABCDE12345)"
# Find it via: security find-identity -v -p codesigning
CSC_NAME="PASTE_EXACT_IDENTITY_STRING_HERE"

# --- 4. APPLE_ID: your Apple ID email ---
APPLE_ID="PASTE_APPLE_ID_EMAIL_HERE"

# --- 5. APPLE_APP_SPECIFIC_PASSWORD: from appleid.apple.com ---
# Sign-In and Security -> App-Specific Passwords -> generate one
APPLE_APP_SPECIFIC_PASSWORD="PASTE_APP_SPECIFIC_PASSWORD_HERE"

# --- 6. APPLE_TEAM_ID: from developer.apple.com/account (Membership tab) ---
APPLE_TEAM_ID="PASTE_TEAM_ID_HERE"

for name in CSC_LINK CSC_KEY_PASSWORD CSC_NAME APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  value="${!name}"
  if [[ "$value" == PASTE_* ]]; then
    echo "Skipping $name -- still a placeholder, fill it in above first." >&2
    continue
  fi
  echo "Setting $name..."
  gh secret set "$name" --body "$value"
done

echo "Done. Verify with: gh secret list"
