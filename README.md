# Supernova EQ

EQ-only plugin based on the Voxanova equalizer surface and native EQ engine.

Supernova EQ keeps the interactive EQ, per-band dynamic compression,
per-band saturation, one global saturation stage after the EQ, spectrum metering, input
gain, output gain, presets, and native JUCE WebView bridge. The Voxanova vocal
chain rack, expandable FX stack, tune, gate, stereo, delay, reverb, peak, glue,
and face modules are intentionally not part of this plugin.

## Run The UI

```bash
npm install
npm run dev
```

## Build The UI

```bash
npm run build
```

## Build The Native Plugin

```bash
cmake -S plugin-shell -B plugin-shell/build -DJUCE_DIR="/Users/raulgomez/Documents/New project/Voxanova/.deps/JUCE"
cmake --build plugin-shell/build --config Release
```

## Sync EQ Code From Voxanova

When Voxanova receives EQ-specific changes, sync them into this repo with:

```bash
npm run sync:eq
```

To point at another Voxanova checkout:

```bash
VOXANOVA_REPO="/absolute/path/to/Voxanova" python3 tools/sync_eq_from_voxanova.py
```

The sync copies shared EQ files, then preserves the Supernova EQ-only app shell,
branding, native event names, reduced parameters, and EQ-only DSP path.
