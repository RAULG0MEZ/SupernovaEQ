# Supernova EQ Native Plugin

JUCE/C++20 native shell for the Supernova EQ plugin.

The native DSP path is intentionally EQ-only:

```text
input gain -> EQ -> saturation -> output gain
```

Per-band dynamic EQ compression and per-band saturation are handled inside the
EQ band engine copied from Voxanova.

## Build

```bash
npm run build
cmake -S plugin-shell -B plugin-shell/build -DJUCE_DIR="/Users/raulgomez/Documents/New project/Voxanova/.deps/JUCE"
cmake --build plugin-shell/build --config Release
```

Formats enabled by default: AU, VST3, and Standalone.
