#!/usr/bin/env python3
"""
Sync the shared Voxanova EQ implementation into Supernova EQ.

The Supernova app shell intentionally stays EQ-only. This script copies the EQ
frontend and native helper code from Voxanova, then restores the Supernova-only
pieces: branding, native event names, the EQ -> saturation processBlock, and the
reduced APVTS parameter layout.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VOXANOVA_ROOT = Path("/Users/raulgomez/Documents/New project/Voxanova")
VOXANOVA_ROOT = Path(os.environ.get("VOXANOVA_REPO", DEFAULT_VOXANOVA_ROOT)).expanduser()

SHARED_FILES = [
    "src/pluginContract.js",
    "src/v2/eqCurve.jsx",
    "src/v2/knob.jsx",
    "src/v2/controls.jsx",
    "src/v2/controlReset.js",
    "src/v2/wheelControl.js",
    "plugin-shell/source/FatTuneEngine.h",
    "plugin-shell/source/FatTuneEngine.cpp",
    "plugin-shell/source/PluginProcessor.h",
    "plugin-shell/source/PluginProcessor.cpp",
    "plugin-shell/source/PluginEditor.h",
    "plugin-shell/source/PluginEditor.cpp",
]

SHARED_DIRS = [
    "src/assets",
]

CSS_OVERRIDE_MARKER = "/* ===== Supernova EQ-only layout overrides ===== */"
PROCESS_BLOCK_SIGNATURE = "void VoxanovaAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)"
PARAM_LAYOUT_SIGNATURE = "VoxanovaAudioProcessor::APVTS::ParameterLayout VoxanovaAudioProcessor::createParameterLayout()"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def extract_function(text: str, signature: str) -> str:
    start = text.index(signature)
    brace = text.index("{", start)
    depth = 0

    for index in range(brace, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]

    raise ValueError(f"Could not find end of function: {signature}")


def replace_function(text: str, signature: str, replacement: str) -> str:
    current = extract_function(text, signature)
    return text.replace(current, replacement, 1)


def copy_file(relative_path: str) -> None:
    source = VOXANOVA_ROOT / relative_path
    target = REPO_ROOT / relative_path
    if not source.exists():
        raise FileNotFoundError(source)

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def copy_dir(relative_path: str) -> None:
    source = VOXANOVA_ROOT / relative_path
    target = REPO_ROOT / relative_path
    if not source.exists():
        raise FileNotFoundError(source)

    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def sync_styles() -> None:
    source = VOXANOVA_ROOT / "src/styles.css"
    target = REPO_ROOT / "src/styles.css"
    current = read(target)
    override = ""

    if CSS_OVERRIDE_MARKER in current:
        override = current[current.index(CSS_OVERRIDE_MARKER):].strip()

    next_css = read(source).replace(
        "/* ============ Voxanova V2 — Vocal Chain Plugin (refined) ============ */",
        "/* ============ Supernova EQ — EQ-only plugin shell ============ */",
    )

    if override:
        next_css = next_css.rstrip() + "\n\n" + override + "\n"

    write(target, next_css)


def patch_contract() -> None:
    path = REPO_ROOT / "src/pluginContract.js"
    text = read(path)
    text = text.replace(
        "  preSaturationMode: 0,\n"
        "  preSaturationAmount: 0,\n"
        "  postSaturationMode: 0,\n"
        "  postSaturationAmount: 0,",
        "  saturationMode: 0,\n"
        "  saturationAmount: 0,",
    )
    write(path, text)


def patch_processor_header() -> None:
    path = REPO_ROOT / "plugin-shell/source/PluginProcessor.h"
    text = read(path)
    text = text.replace(
        "  std::atomic<float>* preSaturationModeParam = nullptr;\n"
        "  std::atomic<float>* preSaturationAmountParam = nullptr;\n"
        "  std::atomic<float>* postSaturationModeParam = nullptr;\n"
        "  std::atomic<float>* postSaturationAmountParam = nullptr;",
        "  std::atomic<float>* saturationModeParam = nullptr;\n"
        "  std::atomic<float>* saturationAmountParam = nullptr;",
    )
    text = text.replace("  SaturationState preSaturationState;", "  SaturationState saturationState;")
    text = text.replace("  SaturationState postSaturationState;\n", "")
    write(path, text)


def patch_processor(preserved_process_block: str, preserved_param_layout: str) -> None:
    path = REPO_ROOT / "plugin-shell/source/PluginProcessor.cpp"
    text = read(path)
    text = text.replace(
        'constexpr auto preSaturationModeId = "preSaturationMode";\n'
        'constexpr auto preSaturationAmountId = "preSaturationAmount";\n'
        'constexpr auto postSaturationModeId = "postSaturationMode";\n'
        'constexpr auto postSaturationAmountId = "postSaturationAmount";',
        'constexpr auto saturationModeId = "saturationMode";\n'
        'constexpr auto saturationAmountId = "saturationAmount";',
    )
    text = text.replace(
        "  preSaturationModeParam = parameters.getRawParameterValue(preSaturationModeId);\n"
        "  preSaturationAmountParam = parameters.getRawParameterValue(preSaturationAmountId);\n"
        "  postSaturationModeParam = parameters.getRawParameterValue(postSaturationModeId);\n"
        "  postSaturationAmountParam = parameters.getRawParameterValue(postSaturationAmountId);",
        "  saturationModeParam = parameters.getRawParameterValue(saturationModeId);\n"
        "  saturationAmountParam = parameters.getRawParameterValue(saturationAmountId);",
    )
    text = replace_function(text, PROCESS_BLOCK_SIGNATURE, preserved_process_block)
    text = replace_function(text, PARAM_LAYOUT_SIGNATURE, preserved_param_layout)
    text = text.replace('return "Voxanova";', 'return "Supernova EQ";')
    text = text.replace("return 20.0;", "return 0.0;")
    text = strip_unused_vocal_chain_labels(text)
    write(path, text)


def strip_unused_vocal_chain_labels(text: str) -> str:
    constants_start = "constexpr auto glueBandMinDb"
    constants_end = "[[maybe_unused]] constexpr std::array<const char*, 10> eqFilterTypeLabels"
    if constants_start in text and constants_end in text:
        start = text.index(constants_start)
        end = text.index(constants_end, start)
        text = text[:start] + text[end:]

    label_arrays_start = "constexpr std::array<const char*, 22> reverbModeLabels"
    label_arrays_end = "juce::String dbLabel"
    if label_arrays_start in text and label_arrays_end in text:
        start = text.index(label_arrays_start)
        end = text.index(label_arrays_end, start)
        text = text[:start] + text[end:]

    label_start = "juce::String hzLabel"
    label_end = "float thresholdEngagement"
    saturation_start = "juce::String saturationModeLabel"

    if label_start in text and label_end in text and saturation_start in text:
        start = text.index(label_start)
        end = text.index(label_end, start)
        sat_start = text.index(saturation_start, start, end)
        sat_end = text.index("\n}\n", sat_start) + 3
        saturation_block = text[sat_start:sat_end]
        text = text[:start] + saturation_block + "\n" + text[end:]

    text = text.replace("\\nfloat thresholdEngagement", "\nfloat thresholdEngagement")
    return text


def patch_editor() -> None:
    path = REPO_ROOT / "plugin-shell/source/PluginEditor.cpp"
    text = read(path)
    replacements = {
        "voxanovaSetParameter": "supernovaEqSetParameter",
        "voxanovaSetEqBands": "supernovaEqSetEqBands",
        "voxanovaSetEditorSize": "supernovaEqSetEditorSize",
        "voxanovaMeterUpdate": "supernovaEqMeterUpdate",
        "__voxanovaParameterQueue": "__supernovaEqParameterQueue",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = text.replace(
        '  if (auto* preSaturationMode = audioProcessor.parameters.getRawParameterValue("preSaturationMode"))\n'
        '    payload->setProperty("preSaturationMode", preSaturationMode->load());\n\n'
        '  if (auto* preSaturationAmount = audioProcessor.parameters.getRawParameterValue("preSaturationAmount"))\n'
        '    payload->setProperty("preSaturationAmount", preSaturationAmount->load());\n\n'
        '  if (auto* postSaturationMode = audioProcessor.parameters.getRawParameterValue("postSaturationMode"))\n'
        '    payload->setProperty("postSaturationMode", postSaturationMode->load());\n\n'
        '  if (auto* postSaturationAmount = audioProcessor.parameters.getRawParameterValue("postSaturationAmount"))\n'
        '    payload->setProperty("postSaturationAmount", postSaturationAmount->load());',
        '  if (auto* saturationMode = audioProcessor.parameters.getRawParameterValue("saturationMode"))\n'
        '    payload->setProperty("saturationMode", saturationMode->load());\n\n'
        '  if (auto* saturationAmount = audioProcessor.parameters.getRawParameterValue("saturationAmount"))\n'
        '    payload->setProperty("saturationAmount", saturationAmount->load());',
    )
    write(path, text)


def main() -> None:
    if not VOXANOVA_ROOT.exists():
        raise SystemExit(f"Voxanova repo not found: {VOXANOVA_ROOT}")

    processor_path = REPO_ROOT / "plugin-shell/source/PluginProcessor.cpp"
    current_processor = read(processor_path)
    preserved_process_block = extract_function(current_processor, PROCESS_BLOCK_SIGNATURE)
    preserved_param_layout = extract_function(current_processor, PARAM_LAYOUT_SIGNATURE)

    for relative_path in SHARED_FILES:
        copy_file(relative_path)

    for relative_path in SHARED_DIRS:
        copy_dir(relative_path)

    patch_contract()
    sync_styles()
    patch_processor_header()
    patch_processor(preserved_process_block, preserved_param_layout)
    patch_editor()

    print(f"Synced Supernova EQ shared EQ code from: {VOXANOVA_ROOT}")
    print("Preserved Supernova EQ-only App.jsx, native event names, reduced parameters, and EQ -> saturation DSP path.")


if __name__ == "__main__":
    main()
