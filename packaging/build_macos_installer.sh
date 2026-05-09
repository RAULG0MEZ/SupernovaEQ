#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: packaging/build_macos_installer.sh [--skip-build]

Builds a macOS .pkg installer for Supernova EQ.

Environment:
  SUPERNOVA_EQ_ARCHS         Architectures to build. Default: arm64
                             Example for universal: SUPERNOVA_EQ_ARCHS="arm64;x86_64"
  JUCE_DIR                   JUCE checkout. Default: <repo>/.deps/JUCE, then Voxanova's local .deps/JUCE when present.
  BUILD_DIR                  CMake build directory. Default: plugin-shell/build
  INSTALLER_SIGN_IDENTITY    Optional Developer ID Installer identity for product signing.

The installer deploys:
  /Library/Audio/Plug-Ins/Components/Supernova EQ.component
  /Library/Audio/Plug-Ins/VST3/Supernova EQ.vst3
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$PROJECT_DIR/plugin-shell"
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_BUILD=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

VERSION="$(sed -nE 's/^project\(SupernovaEQ VERSION ([^)]+)\).*/\1/p' "$PLUGIN_DIR/CMakeLists.txt" | head -n 1)"
if [[ -z "$VERSION" ]]; then
  echo "Could not read Supernova EQ version from $PLUGIN_DIR/CMakeLists.txt" >&2
  exit 1
fi

ARCHS="${SUPERNOVA_EQ_ARCHS:-arm64}"
ARCH_LABEL="${ARCHS//;/+}"
DEFAULT_JUCE_PATH="$PROJECT_DIR/.deps/JUCE"
VOXANOVA_JUCE_PATH="/Users/raulgomez/Documents/New project/Voxanova/.deps/JUCE"

if [[ -n "${JUCE_DIR:-}" ]]; then
  JUCE_PATH="$JUCE_DIR"
elif [[ -d "$DEFAULT_JUCE_PATH" ]]; then
  JUCE_PATH="$DEFAULT_JUCE_PATH"
else
  JUCE_PATH="$VOXANOVA_JUCE_PATH"
fi

BUILD_PATH="${BUILD_DIR:-$PLUGIN_DIR/build}"
RELEASE_DIR="$PROJECT_DIR/release"
WORK_DIR="$PROJECT_DIR/build/installer"
PAYLOAD_ROOT="$WORK_DIR/payload"
SCRIPTS_DIR="$WORK_DIR/scripts"
COMPONENT_PKG="$WORK_DIR/SupernovaEQ-component.pkg"
UNSIGNED_PKG="$RELEASE_DIR/SupernovaEQ-${VERSION}-macOS-${ARCH_LABEL}.pkg"
SIGNED_PKG="$RELEASE_DIR/SupernovaEQ-${VERSION}-macOS-${ARCH_LABEL}-signed.pkg"

if [[ ! -d "$JUCE_PATH" ]]; then
  echo "JUCE_DIR not found: $JUCE_PATH" >&2
  echo "Set JUCE_DIR=/absolute/path/to/JUCE and run again." >&2
  exit 1
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "Building Supernova EQ web assets..."
  (cd "$PROJECT_DIR" && npm run build)

  echo "Configuring Supernova EQ plugin (${ARCHS})..."
  cmake -S "$PLUGIN_DIR" -B "$BUILD_PATH" \
    -DJUCE_DIR="$JUCE_PATH" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="$ARCHS"

  echo "Building Supernova EQ AU/VST3..."
  cmake --build "$BUILD_PATH" --config Release
fi

AU_BUNDLE="$BUILD_PATH/SupernovaEQ_artefacts/AU/Supernova EQ.component"
VST3_BUNDLE="$BUILD_PATH/SupernovaEQ_artefacts/VST3/Supernova EQ.vst3"

if [[ ! -d "$AU_BUNDLE" ]]; then
  echo "Missing AU bundle: $AU_BUNDLE" >&2
  exit 1
fi

if [[ ! -d "$VST3_BUNDLE" ]]; then
  echo "Missing VST3 bundle: $VST3_BUNDLE" >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$PAYLOAD_ROOT/Library/Audio/Plug-Ins/Components"
mkdir -p "$PAYLOAD_ROOT/Library/Audio/Plug-Ins/VST3"
mkdir -p "$SCRIPTS_DIR" "$RELEASE_DIR"

echo "Staging plugin bundles..."
COPYFILE_DISABLE=1 ditto --norsrc "$AU_BUNDLE" "$PAYLOAD_ROOT/Library/Audio/Plug-Ins/Components/Supernova EQ.component"
COPYFILE_DISABLE=1 ditto --norsrc "$VST3_BUNDLE" "$PAYLOAD_ROOT/Library/Audio/Plug-Ins/VST3/Supernova EQ.vst3"
find "$PAYLOAD_ROOT" \( -name '._*' -o -name '.DS_Store' \) -delete
xattr -cr "$PAYLOAD_ROOT" 2>/dev/null || true

cat > "$SCRIPTS_DIR/postinstall" <<'POSTINSTALL'
#!/bin/sh
set -eu

clear_quarantine() {
  if [ -e "$1" ]; then
    /usr/bin/xattr -dr com.apple.quarantine "$1" 2>/dev/null || true
  fi
}

clear_quarantine "/Library/Audio/Plug-Ins/Components/Supernova EQ.component"
clear_quarantine "/Library/Audio/Plug-Ins/VST3/Supernova EQ.vst3"

console_user="$(/usr/bin/stat -f %Su /dev/console 2>/dev/null || true)"
if [ -n "$console_user" ] && [ "$console_user" != "root" ]; then
  user_home="$(/usr/bin/dscl . -read "/Users/$console_user" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}' || true)"
  if [ -n "$user_home" ] && [ -d "$user_home/Library/Caches/AudioUnitCache" ]; then
    /bin/rm -f "$user_home/Library/Caches/AudioUnitCache/com.apple.audiounits.cache" 2>/dev/null || true
    /bin/rm -f "$user_home/Library/Caches/AudioUnitCache/com.apple.audiounits.sandboxed.cache" 2>/dev/null || true
  fi
fi

/usr/bin/killall -9 AudioComponentRegistrar 2>/dev/null || true
exit 0
POSTINSTALL
chmod 755 "$SCRIPTS_DIR/postinstall"

echo "Creating component package..."
pkgbuild \
  --root "$PAYLOAD_ROOT" \
  --filter '(^|/)\.DS_Store$' \
  --filter '(^|/)\._.*' \
  --scripts "$SCRIPTS_DIR" \
  --identifier "com.supernova.eq.pkg" \
  --version "$VERSION" \
  --install-location "/" \
  --ownership recommended \
  "$COMPONENT_PKG"

if [[ -n "${INSTALLER_SIGN_IDENTITY:-}" ]]; then
  echo "Signing installer with: $INSTALLER_SIGN_IDENTITY"
  productbuild --package "$COMPONENT_PKG" --sign "$INSTALLER_SIGN_IDENTITY" "$SIGNED_PKG"
  echo "Installer created: $SIGNED_PKG"
else
  productbuild --package "$COMPONENT_PKG" "$UNSIGNED_PKG"
  echo "Installer created: $UNSIGNED_PKG"
fi

echo "Done."
