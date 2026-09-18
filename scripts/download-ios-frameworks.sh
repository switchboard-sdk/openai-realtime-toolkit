#!/usr/bin/env bash
#
# Downloads the Switchboard SDK + extension xcframeworks for iOS.
#
# Invoked automatically by OpenAIRealtimeToolkit.podspec's `prepare_command` during
# `pod install`, so consumers never run it by hand. Pulls the prebuilt
# xcframeworks (which include the C++ headers OpenAIRealtimeToolkit compiles against) from
# Switchboard's public S3 bucket — we host nothing. The downloaded binaries are
# git-ignored and re-fetched on a clean checkout.
#
# Layout produced (matches the podspec's vendored_frameworks / search paths):
#   ios/Frameworks/<Package>/ios/include/...           (C++ headers)
#   ios/Frameworks/<Package>/ios/<Package>.xcframework (binary)
set -euo pipefail

SDK_VERSION="3.2.7"
BASE_URL="https://switchboard-sdk-public.s3.amazonaws.com/builds/release/${SDK_VERSION}/ios"

PACKAGES=(SwitchboardSDK SwitchboardSileroVAD SwitchboardSmartTurn SwitchboardOnnx SwitchboardOpenAI)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORKS_DIR="${SCRIPT_DIR}/../ios/Frameworks"

mkdir -p "${FRAMEWORKS_DIR}"

for pkg in "${PACKAGES[@]}"; do
  dest="${FRAMEWORKS_DIR}/${pkg}/ios"
  stamp="${dest}/.switchboard-version"
  # The stamp makes the skip version-aware: bumping SDK_VERSION re-downloads
  # instead of leaving a stale xcframework in place.
  if [ -d "${dest}/${pkg}.xcframework" ] && [ "$(cat "${stamp}" 2>/dev/null)" = "${SDK_VERSION}" ]; then
    echo "✓ ${pkg} ${SDK_VERSION} already present — skipping"
    continue
  fi

  echo "↓ Downloading ${pkg} (${SDK_VERSION})"
  rm -rf "${dest}"
  mkdir -p "${dest}"
  tmp_zip="${dest}/${pkg}.zip"
  curl -fsSL "${BASE_URL}/${pkg}-ios-${SDK_VERSION}.zip" -o "${tmp_zip}"

  echo "  Extracting ${pkg}"
  unzip -oq "${tmp_zip}" -d "${dest}"
  rm -f "${tmp_zip}"
  echo "${SDK_VERSION}" > "${stamp}"
done

echo "✓ Switchboard iOS frameworks ready in ios/Frameworks/"
