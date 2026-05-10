import React from "react";
import {
  booleanParameters,
  defaultValues,
  EQ_FILTER_TYPES,
  PLUGIN_HEIGHT,
  PLUGIN_WIDTH
} from "./pluginContract.js";
import { hasNativeBackend, sendNativeEditorSize, sendNativeEqBands, sendNativeParameter } from "./nativeBridge.js";

import { useTweaks, TweaksPanel, TweakSection, TweakSelect } from "./v2/tweaksPanel.jsx";
import { EQCurve } from "./v2/eqCurve.jsx";
import { resetOnAltClick, resetOnDoubleClick } from "./v2/controlReset.js";
import { handleWheelValue } from "./v2/wheelControl.js";

const { useState, useEffect, useRef, useCallback, useMemo } = React;

const booleanParameterSet = new Set(booleanParameters);
const FULL_SPECTRUM_TYPE = "Full Spectrum";
const FULL_SPECTRUM_MIN_RATIO = 1.015;
const eqFilterTypeSet = new Set(EQ_FILTER_TYPES);
const eqDynamicTypeSet = new Set(["Bell", "Surfer Bell", "Low Shelf", "High Shelf", "Band Pass", FULL_SPECTRUM_TYPE]);
const eqCutTypeSet = new Set(["Low Cut", "High Cut"]);
const supernovaParameterIds = [
  "inputGain",
  "outputGain",
  "saturationMode",
  "saturationAmount"
];
const EMPTY_EQ_POINTS = [];

const REAL_EQ_SOURCE_HEIGHT = 351;
const REAL_EQ_SOURCE_Y = 82;
const DEFAULT_SPECTRUM_MAX_FREQUENCY = 20000;
const EQ_ONLY_GRAPH_HEIGHT = 652;
const EQ_ONLY_REAL_EQ_HEIGHT = 690;

const TWEAK_DEFAULTS = {
  theme: "real-noir",
  showWaveform: true,
  signalActive: true
};

const THEMES = [
  { id: "midnight", label: "Midnight", mode: "dark", accent: "oklch(68% 0.16 248)",
    swatch: "linear-gradient(135deg, oklch(22% 0.014 268) 0%, oklch(40% 0.14 248) 100%)" },
  { id: "plum", label: "Plum", mode: "dark", accent: "oklch(72% 0.18 320)",
    swatch: "linear-gradient(135deg, oklch(20% 0.024 310) 0%, oklch(46% 0.18 320) 100%)" },
  { id: "forest", label: "Forest", mode: "dark", accent: "oklch(72% 0.16 165)",
    swatch: "linear-gradient(135deg, oklch(20% 0.020 168) 0%, oklch(46% 0.14 165) 100%)" },
  { id: "obsidian", label: "Obsidian", mode: "dark", accent: "oklch(92% 0 0)",
    swatch: "linear-gradient(135deg, oklch(15% 0 0) 0%, oklch(50% 0 0) 100%)" },
  { id: "real", label: "Real", mode: "dark", accent: "oklch(82% 0.045 96)",
    swatch: "linear-gradient(135deg, oklch(12% 0.004 96) 0%, oklch(42% 0.006 96) 52%, oklch(18% 0.004 96) 100%)" },
  { id: "real-noir", label: "Real Noir", mode: "dark", accent: "oklch(82% 0.030 112)",
    swatch: "linear-gradient(135deg, oklch(4% 0.002 112) 0%, oklch(18% 0.004 112) 48%, oklch(7% 0.002 112) 100%)" }
];

const THEME_BY_ID = Object.fromEntries(THEMES.map((theme) => [theme.id, theme]));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getEqOnlyLayoutStyle() {
  const eqScale = EQ_ONLY_REAL_EQ_HEIGHT / REAL_EQ_SOURCE_HEIGHT;

  return {
    "--eq-graph-height": `${EQ_ONLY_GRAPH_HEIGHT}px`,
    "--eq-section-pad-top": "10px",
    "--eq-section-pad-bottom": "2px",
    "--real-eq-height": `${EQ_ONLY_REAL_EQ_HEIGHT}px`,
    "--real-rack-height": "0px",
    "--real-eq-bg-height": `${(PLUGIN_HEIGHT * eqScale).toFixed(3)}px`,
    "--real-eq-bg-y": `${(-REAL_EQ_SOURCE_Y * eqScale).toFixed(3)}px`,
    "--real-rack-bg-height": "0px",
    "--real-rack-bg-y": "0px"
  };
}

function defaultEqQForType(type) {
  if (type === "Bell") return 1;
  if (type === FULL_SPECTRUM_TYPE) return 8;
  return type === "Low Shelf" || type === "High Shelf" ? 1.3 : 5;
}

function defaultEqSlopeForType(type) {
  return type === "Low Cut" ? 30 : 12;
}

function normalizeEqSlope(value, type = "Bell") {
  if (String(value).toLowerCase() === "wall") return "wall";
  const numeric = Number(value);
  return clamp(Math.round(Number.isFinite(numeric) && numeric > 0 ? numeric : defaultEqSlopeForType(type)), 6, 96);
}

function fullSpectrumFallbackRange(freq) {
  const center = clamp(Number(freq) || 1000, 20, 20000);
  return {
    low: clamp(center / 2, 20, 20000),
    high: clamp(center * 2, 20, 20000)
  };
}

function normalizeFullSpectrumRange(point, freq) {
  const fallback = fullSpectrumFallbackRange(freq);
  let low = Number(point?.rangeLow);
  let high = Number(point?.rangeHigh);

  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0 || high <= low * FULL_SPECTRUM_MIN_RATIO) {
    low = fallback.low;
    high = fallback.high;
  }

  low = clamp(low, 20, 20000);
  high = clamp(high, 20, 20000);

  if (high <= low * FULL_SPECTRUM_MIN_RATIO) {
    const center = clamp(Number(freq) || Math.sqrt(Math.max(20, low) * Math.max(20, high)), 20, 20000);
    const halfRatio = Math.sqrt(FULL_SPECTRUM_MIN_RATIO);
    low = clamp(center / halfRatio, 20, 20000 / FULL_SPECTRUM_MIN_RATIO);
    high = clamp(center * halfRatio, low * FULL_SPECTRUM_MIN_RATIO, 20000);
  }

  return { low, high, center: clamp(Math.sqrt(low * high), 20, 20000) };
}

function normalizeEqPoint(point) {
  const type = point?.type || "Bell";
  if (type === "Desser") return null;

  const safeType = eqFilterTypeSet.has(type) ? type : "Bell";
  const rawGain = clamp(Number(point?.gain) || 0, -30, 30);
  const gain = eqCutTypeSet.has(safeType) ? clamp(rawGain, 0, 30) : rawGain;
  const comp = clamp(Number(point?.comp) || 0, -30, 30);
  const hasExplicitCompEnabled = Object.prototype.hasOwnProperty.call(point || {}, "compEnabled");
  const explicitCompEnabled = point?.compEnabled === true || point?.compEnabled === "true" || Number(point?.compEnabled) >= 0.5;
  const legacyCompEnabled = Math.abs(comp) > 0.05 && Math.abs(comp - gain) > 0.05;
  const safeFreq = clamp(Math.round(Number(point?.freq) || 1000), 20, 20000);
  const q = Number(point?.q);
  const fullSpectrumRange = safeType === FULL_SPECTRUM_TYPE ? normalizeFullSpectrumRange(point, safeFreq) : null;
  const saturationMode = Number(point?.saturationMode ?? point?.satMode);
  const saturationAmount = Number(point?.saturationAmount ?? point?.satAmount);
  const rangeLowSlope = Number(point?.rangeLowSlope ?? point?.lowSlope);
  const rangeHighSlope = Number(point?.rangeHighSlope ?? point?.highSlope);
  const safeSaturationMode = eqDynamicTypeSet.has(safeType)
    ? clamp(Math.round(Number.isFinite(saturationMode) ? saturationMode : 0), 0, 3)
    : 0;

  return {
    type: safeType,
    freq: fullSpectrumRange ? Math.round(fullSpectrumRange.center) : safeFreq,
    gain,
    q: clamp(Number.isFinite(q) && q > 0 ? q : defaultEqQForType(safeType), 0.1, 50),
    slope: normalizeEqSlope(point?.slope, safeType),
    threshold: clamp(Number(point?.threshold) || -24, -60, 0),
    intensity: clamp(Number(point?.intensity) || 50, 0, 100),
    deessMode: point?.deessMode === "wider" ? "wider" : "split",
    on: point?.on !== false,
    solo: point?.solo === true || point?.solo === "true" || Number(point?.solo) >= 0.5,
    placement: point?.placement || "stereo",
    comp,
    compEnabled: eqDynamicTypeSet.has(safeType) && (hasExplicitCompEnabled ? explicitCompEnabled : legacyCompEnabled),
    compThreshold: clamp(Number.isFinite(Number(point?.compThreshold)) ? Number(point.compThreshold) : -18, -60, 0),
    compAttack: clamp(Number.isFinite(Number(point?.compAttack)) ? Number(point.compAttack) : 12, 0.1, 200),
    compRelease: clamp(Number.isFinite(Number(point?.compRelease)) ? Number(point.compRelease) : 140, 5, 1000),
    compRatio: clamp(Number.isFinite(Number(point?.compRatio)) ? Number(point.compRatio) : 4, 1, 20),
    saturationMode: safeSaturationMode,
    saturationAmount: safeSaturationMode > 0
      ? clamp(Number.isFinite(saturationAmount) ? saturationAmount : 20, 0, 100)
      : 0,
    ...(fullSpectrumRange ? {
      rangeLow: Math.round(fullSpectrumRange.low),
      rangeHigh: Math.round(fullSpectrumRange.high),
      rangeLowSlope: clamp(Number.isFinite(rangeLowSlope) && rangeLowSlope > 0 ? rangeLowSlope : defaultEqQForType(safeType), 0.1, 50),
      rangeHighSlope: clamp(Number.isFinite(rangeHighSlope) && rangeHighSlope > 0 ? rangeHighSlope : defaultEqQForType(safeType), 0.1, 50)
    } : {}),
    ...(safeType === "Surfer Bell" && Number.isFinite(Number(point?.surfRatio)) && Number(point.surfRatio) > 0
      ? { surfRatio: Number(point.surfRatio) }
      : {})
  };
}

function normalizeEqPoints(points) {
  return Array.isArray(points)
    ? points.map(normalizeEqPoint).filter(Boolean).sort((a, b) => a.freq - b.freq)
    : [];
}

function eqBandsFromPayload(payload) {
  let raw = payload?.eqBands;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }

  if (!raw || typeof raw !== "object") return null;

  return {
    bands: normalizeEqPoints(raw.bands || raw.eq || raw.pre)
  };
}

function updateValuesFromPayload(current, payload) {
  let changed = false;
  const next = { ...current };

  Object.keys(defaultValues).forEach((id) => {
    if (typeof payload[id] !== "number") return;
    changed = true;
    next[id] = booleanParameterSet.has(id) ? payload[id] >= 0.5 : payload[id];
  });

  return changed ? next : current;
}

const makeEmptySpectrum = () => Array.from({ length: 256 }, () => 0);
const makeEmptyEqDetectorDb = () => Array.from({ length: 128 }, () => -120);

const emptyMeters = {
  inputLevel: 0,
  outputLevel: 0,
  visualSilence: true,
  inputSpectrum: makeEmptySpectrum(),
  preCompSpectrum: makeEmptySpectrum(),
  postCompSpectrum: makeEmptySpectrum(),
  preEqDetectorDb: makeEmptyEqDetectorDb(),
  postEqDetectorDb: makeEmptyEqDetectorDb(),
  tuneFrequency: 0,
  spectrumMaxFrequency: DEFAULT_SPECTRUM_MAX_FREQUENCY,
  sampleRate: 48000
};

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function fadeMeterValue(value, factor = 0.72, floor = 0.0008) {
  const next = numberOrZero(value) * factor;
  return Math.abs(next) <= floor ? 0 : next;
}

function fadeMeterArray(values, fallbackLength = 0, factor = 0.72, floor = 0.0008) {
  const source = Array.isArray(values) ? values : Array.from({ length: fallbackLength }, () => 0);
  return source.map((value) => fadeMeterValue(value, factor, floor));
}

function fadeDetectorDbArray(values, fallbackLength = 0, factor = 0.76) {
  const source = Array.isArray(values) ? values : Array.from({ length: fallbackLength }, () => -120);
  return source.map((value) => {
    const next = -120 + (numberOrZero(value) + 120) * factor;
    return next <= -119.5 ? -120 : next;
  });
}

function metersFromPayload(current, payload) {
  const arrayFromPayload = (id) => (
    Array.isArray(payload[id]) ? payload[id].map(numberOrZero) : current[id]
  );
  const safeSpectrumMaxFrequency = Math.min(20000, Math.max(20, numberOrZero(payload.spectrumMaxFrequency) || current.spectrumMaxFrequency));
  const safeSampleRate = numberOrZero(payload.sampleRate) >= 1000 ? numberOrZero(payload.sampleRate) : current.sampleRate;
  const visualSilence = payload.visualSilence === true || payload.visualSilence === 1;
  const meterStale = payload.meterStale === true || payload.meterStale === 1;

  if (visualSilence) {
    return {
      inputLevel: fadeMeterValue(current.inputLevel, 0.62, 0.002),
      outputLevel: fadeMeterValue(current.outputLevel, 0.62, 0.002),
      visualSilence: true,
      inputSpectrum: meterStale ? fadeMeterArray(current.inputSpectrum, 256, 0.92, 0.0008) : arrayFromPayload("inputSpectrum"),
      preCompSpectrum: meterStale ? fadeMeterArray(current.preCompSpectrum, 256, 0.92, 0.0008) : arrayFromPayload("preCompSpectrum"),
      postCompSpectrum: meterStale ? fadeMeterArray(current.postCompSpectrum, 256, 0.92, 0.0008) : arrayFromPayload("postCompSpectrum"),
      preEqDetectorDb: meterStale ? fadeDetectorDbArray(current.preEqDetectorDb, 128) : arrayFromPayload("preEqDetectorDb"),
      postEqDetectorDb: meterStale ? fadeDetectorDbArray(current.postEqDetectorDb, 128) : arrayFromPayload("postEqDetectorDb"),
      tuneFrequency: fadeMeterValue(current.tuneFrequency, 0.62, 0.5),
      spectrumMaxFrequency: safeSpectrumMaxFrequency,
      sampleRate: safeSampleRate
    };
  }

  return {
    inputLevel: Math.max(numberOrZero(payload.inputL), numberOrZero(payload.inputR)),
    outputLevel: Math.max(numberOrZero(payload.outputL), numberOrZero(payload.outputR)),
    visualSilence,
    inputSpectrum: arrayFromPayload("inputSpectrum"),
    preCompSpectrum: arrayFromPayload("preCompSpectrum"),
    postCompSpectrum: arrayFromPayload("postCompSpectrum"),
    preEqDetectorDb: arrayFromPayload("preEqDetectorDb"),
    postEqDetectorDb: arrayFromPayload("postEqDetectorDb"),
    tuneFrequency: numberOrZero(payload.tuneFrequency),
    spectrumMaxFrequency: safeSpectrumMaxFrequency,
    sampleRate: safeSampleRate
  };
}

function resolveThemeId(id) {
  if (THEME_BY_ID[id]) return id;
  if (id === "lavender") return "real-noir";
  if (id === "dark") return "midnight";
  return "real-noir";
}

function ThemeMenu({ themeId, onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="theme-menu" ref={ref} role="menu">
      <div className="theme-menu-section">
        <div className="theme-menu-label">Night</div>
        <div className="theme-grid">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`theme-swatch${themeId === theme.id ? " active" : ""}`}
              style={{ background: theme.swatch }}
              onClick={() => onSelect(theme.id)}
              title={theme.label}
              aria-label={`Theme: ${theme.label}`}
            >
              <span className="theme-swatch-dot" style={{ background: theme.accent }} />
              <span className="theme-swatch-name">{theme.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function useUserPresets() {
  const [presets, setPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("supernova-eq-user-presets") || "[]");
    } catch {
      return [];
    }
  });

  const savePreset = useCallback((name, data) => {
    const preset = { id: Date.now().toString(), name, savedAt: Date.now(), ...data };
    setPresets((current) => {
      const next = [...current, preset];
      localStorage.setItem("supernova-eq-user-presets", JSON.stringify(next));
      return next;
    });
  }, []);

  const deletePreset = useCallback((id) => {
    setPresets((current) => {
      const next = current.filter((preset) => preset.id !== id);
      localStorage.setItem("supernova-eq-user-presets", JSON.stringify(next));
      return next;
    });
  }, []);

  return { presets, savePreset, deletePreset };
}

function SavePresetModal({ onSave, onClose }) {
  const [name, setName] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  };

  return (
    <div className="plugin-info-backdrop" onMouseDown={onClose}>
      <section className="save-preset-modal" role="dialog" aria-modal="true" aria-label="Save preset" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="plugin-info-close" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <div className="save-preset-title">Save Preset</div>
        <form onSubmit={handleSubmit} className="save-preset-form">
          <input
            ref={inputRef}
            className="save-preset-input"
            type="text"
            placeholder="Preset name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={48}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="save-preset-actions">
            <button type="button" className="save-preset-btn cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="save-preset-btn confirm" disabled={!name.trim()}>Save</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PresetMenu({ onDefault, onClose, userPresets, onDeleteUserPreset, onSelectUserPreset }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="preset-menu" ref={ref} role="menu">
      {userPresets.length > 0 && (
        <div className="preset-menu-section">
          <div className="preset-menu-label">My Presets</div>
          <div className="preset-menu-options preset-menu-options-user">
            {userPresets.map((preset) => (
              <div key={preset.id} className="preset-menu-user-row">
                <button
                  type="button"
                  className="preset-menu-option preset-menu-option-user"
                  onClick={() => {
                    onSelectUserPreset(preset);
                    onClose();
                  }}
                >
                  <span>{preset.name}</span>
                </button>
                <button
                  type="button"
                  className="preset-menu-delete"
                  aria-label={`Delete preset ${preset.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteUserPreset(preset.id);
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                    <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="preset-menu-section">
        <div className="preset-menu-label">Factory</div>
        <div className="preset-menu-options">
          <button
            type="button"
            className="preset-menu-option active"
            onClick={() => {
              onDefault();
              onClose();
            }}
          >
            <span>Default</span>
            <span className="preset-menu-dot" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginInfoModal({ nativeOnline, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="plugin-info-backdrop" onMouseDown={onClose}>
      <section className="plugin-info-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="plugin-info-close" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <div className="plugin-info-title">Supernova EQ</div>
        <div className="plugin-info-sub">Equalizer · {nativeOnline ? "Native" : "Browser"}</div>
        <div className="plugin-info-grid">
          <span>Format</span><strong>AU · VST3</strong>
          <span>Engine</span><strong>Dynamic EQ · Saturation</strong>
          <span>Build</span><strong>2026.05</strong>
          <span>State</span><strong>{nativeOnline ? "Connected" : "Preview"}</strong>
        </div>
      </section>
    </div>
  );
}

function FooterLevelMeter({ active, level = 0 }) {
  const [displayLevel, setDisplayLevel] = useState(0);

  useEffect(() => {
    const target = active ? Math.max(0, Math.min(1, Number(level) || 0)) : 0;
    if (target <= 0.002) {
      setDisplayLevel(0);
      return;
    }

    setDisplayLevel((previous) => Math.max(target, previous * 0.62 + target * 0.38));
  }, [active, level]);

  const segments = 28;
  const litSegments = displayLevel > 0.002 ? Math.ceil(displayLevel * segments) : 0;

  return (
    <div className="footer-meter" aria-hidden="true">
      {Array.from({ length: segments }).map((_, index) => {
        const lit = active && index < litSegments;
        const hot = index >= segments - 2;
        const warm = index >= segments - 6;
        return <span key={index} className={`footer-meter-seg${warm ? " warm" : ""}${hot ? " hot" : ""}${lit ? " on" : ""}`} />;
      })}
    </div>
  );
}

function FooterGainSlider({ label, value, onChange, defaultValue = 0 }) {
  const min = -24;
  const max = 24;
  const safeValue = clamp(Number(value) || 0, min, max);
  const pct = ((safeValue - min) / (max - min)) * 100;

  const onPointerDown = (event) => {
    if (resetOnAltClick(event, () => onChange(defaultValue))) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);

    const update = (moveEvent) => {
      const rect = target.getBoundingClientRect();
      const next = min + clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1) * (max - min);
      onChange(Number(next.toFixed(1)));
    };

    update(event);
    const move = (moveEvent) => update(moveEvent);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="rev-slider footer-gain-control">
      <div
        className="rev-slider-track"
        onPointerDown={onPointerDown}
        onDoubleClick={(event) => resetOnDoubleClick(event, () => onChange(defaultValue))}
        role="slider"
        aria-label={`${label} gain`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={safeValue}
        onWheel={(event) => handleWheelValue(event, safeValue, { min, max, step: 0.1 }, onChange)}
      >
        <div className="rev-slider-fill" style={{ width: `${pct}%` }} />
        <div className="rev-slider-handle" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

function FooterGainControl({ label, value, onChange, active, level = 0, output = false, defaultValue = 0 }) {
  const gainText = `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`;
  const slider = <FooterGainSlider label={label} value={value} onChange={onChange} defaultValue={defaultValue} />;
  const meter = <FooterLevelMeter active={active} level={level} />;

  return (
    <div className={`footer-channel${output ? " output" : " input"}`}>
      <span className="footer-channel-name">{label}</span>
      {output ? slider : meter}
      {output ? meter : slider}
      <span className="footer-gain-value">{gainText}</span>
    </div>
  );
}

function getPluginFrameRect() {
  const frame = document.querySelector(".plugin-frame");
  return frame?.getBoundingClientRect?.() || {
    width: window.innerWidth || PLUGIN_WIDTH,
    height: window.innerHeight || PLUGIN_HEIGHT
  };
}

function getScaleForPluginRect(rect) {
  const frameWidth = Math.max(0, rect?.width || PLUGIN_WIDTH);
  const frameHeight = Math.max(0, rect?.height || PLUGIN_HEIGHT);
  const minScale = hasNativeBackend() ? 0.5 : 0.25;
  return clamp(Math.min(frameWidth / PLUGIN_WIDTH, frameHeight / PLUGIN_HEIGHT), minScale, 2);
}

function useLockedPluginViewport() {
  useEffect(() => {
    let raf = 0;
    let observer = null;

    const syncViewport = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        const nextScale = getScaleForPluginRect(getPluginFrameRect());
        document.documentElement.style.setProperty("--plugin-ui-scale", nextScale.toFixed(4));
      });
    };

    const frame = document.querySelector(".plugin-frame");
    if (frame && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(syncViewport);
      observer.observe(frame);
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", syncViewport);
    };
  }, []);
}

function EditorResizeGrip({ enabled }) {
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const lastSentRef = useRef({ scale: 0, at: 0 });

  const sendResize = useCallback((scale) => {
    const nextScale = Math.round(clamp(scale, 0.5, 2) * 100) / 100;
    const now = performance.now();
    const last = lastSentRef.current;

    if (Math.abs(nextScale - last.scale) < 0.01 && now - last.at < 90) return;

    lastSentRef.current = { scale: nextScale, at: now };
    sendNativeEditorSize(
      nextScale,
      Math.round(PLUGIN_WIDTH * nextScale),
      Math.round(PLUGIN_HEIGHT * nextScale)
    );
  }, []);

  const onPointerDown = useCallback((event) => {
    if (!enabled) return;

    event.preventDefault();
    const startScale = getScaleForPluginRect(getPluginFrameRect());
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startScale,
      latestScale: startScale
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add("is-plugin-resizing");

    const flushResize = (scale) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        sendResize(scale);
      });
    };

    const onMove = (moveEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dxScale = (moveEvent.clientX - drag.startX) / PLUGIN_WIDTH;
      const dyScale = (moveEvent.clientY - drag.startY) / PLUGIN_HEIGHT;
      const dominantDelta = Math.abs(dxScale) > Math.abs(dyScale) ? dxScale : dyScale;
      drag.latestScale = drag.startScale + dominantDelta;
      flushResize(drag.latestScale);
    };

    const onUp = () => {
      if (dragRef.current) sendResize(dragRef.current.latestScale);
      dragRef.current = null;
      document.body.classList.remove("is-plugin-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [enabled, sendResize]);

  return (
    <button
      type="button"
      className={`plugin-resize-grip${enabled ? "" : " disabled"}`}
      onPointerDown={onPointerDown}
      aria-label="Resize plugin"
      title="Resize plugin"
    >
      <span />
      <span />
      <span />
    </button>
  );
}

function App() {
  useLockedPluginViewport();
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const themeId = resolveThemeId(tweaks.theme);
  const themeMeta = THEME_BY_ID[themeId];
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [values, setValues] = useState(defaultValues);
  const [meters, setMeters] = useState(emptyMeters);
  const [nativeOnline, setNativeOnline] = useState(hasNativeBackend());
  const [nativeEqBands, setNativeEqBands] = useState(null);
  const [eqScale, setEqScale] = useState(12);
  const [eqScaleOpen, setEqScaleOpen] = useState(false);
  const [eqPoints, setEqPoints] = useState([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [ab, setAb] = useState("A");
  const abActiveSlotRef = useRef("A");
  const abSnapshotsRef = useRef({ A: null, B: null });

  const eqScaleRef = useRef(null);
  const eqTouchedRef = useRef(false);
  const eqHydratedRef = useRef(false);
  const lastSentEqJsonRef = useRef("");
  const layoutStyle = useMemo(() => getEqOnlyLayoutStyle(), []);
  const scaleOptions = [3, 6, 12, 30];
  const activeEqPointCount = eqPoints.length;

  useEffect(() => {
    if (tweaks.theme !== themeId && !THEME_BY_ID[tweaks.theme]) {
      setTweak("theme", themeId);
    }
  }, [setTweak, themeId, tweaks.theme]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.dataset.theme = themeId;
    body.dataset.theme = themeId;
    root.dataset.mode = themeMeta.mode;
    body.dataset.mode = themeMeta.mode;
  }, [themeId, themeMeta.mode]);

  useEffect(() => {
    const updateNativeStatus = () => setNativeOnline(hasNativeBackend());
    updateNativeStatus();
    const timer = window.setInterval(updateNativeStatus, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onMeterUpdate = (event) => {
      const payload = event.detail || {};
      const eqBands = eqBandsFromPayload(payload);
      if (eqBands) setNativeEqBands(eqBands);
      setMeters((current) => metersFromPayload(current, payload));
      setValues((current) => updateValuesFromPayload(current, payload));
    };

    window.addEventListener("supernovaEqMeterUpdate", onMeterUpdate);
    return () => window.removeEventListener("supernovaEqMeterUpdate", onMeterUpdate);
  }, []);

  useEffect(() => {
    const onDoc = (event) => {
      if (eqScaleRef.current && !eqScaleRef.current.contains(event.target)) setEqScaleOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!nativeEqBands) return;

    if (!eqTouchedRef.current && !eqHydratedRef.current) {
      setEqPoints(nativeEqBands.bands);
      eqHydratedRef.current = true;
    }
  }, [nativeEqBands]);

  useEffect(() => {
    if (nativeOnline && !nativeEqBands && !eqTouchedRef.current) return;

    const payload = {
      bands: normalizeEqPoints(eqPoints)
    };
    const json = JSON.stringify(payload);
    if (json === lastSentEqJsonRef.current) return;

    lastSentEqJsonRef.current = json;
    sendNativeEqBands(payload);
  }, [eqPoints, nativeEqBands, nativeOnline]);

  const setParam = useCallback((id, value) => {
    const nextValue = booleanParameterSet.has(id) ? Boolean(value) : value;
    setValues((current) => ({ ...current, [id]: nextValue }));
    sendNativeParameter(id, booleanParameterSet.has(id) ? (nextValue ? 1 : 0) : nextValue);
  }, []);

  const setEqPointsFromUi = useCallback((nextOrUpdater) => {
    eqTouchedRef.current = true;
    setEqPoints(nextOrUpdater);
  }, []);

  const ignoreEqPointUpdates = useCallback(() => {}, []);
  const keepSingleEqMode = useCallback(() => {}, []);

  const activeEqSaturation = {
    mode: values.saturationMode ?? 0,
    amount: values.saturationAmount ?? 0
  };

  const setActiveEqSaturation = useCallback((patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, "mode")) {
      setParam("saturationMode", patch.mode);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "amount")) {
      setParam("saturationAmount", patch.amount);
    }
  }, [setParam]);

  const inputGain = Number(values.inputGain) || 0;
  const outputGain = Number(values.outputGain) || 0;
  const setInputGain = useCallback((value) => setParam("inputGain", value), [setParam]);
  const setOutputGain = useCallback((value) => setParam("outputGain", value), [setParam]);

  const makeAbSnapshot = useCallback(() => ({
    values: supernovaParameterIds.reduce((snapshot, id) => {
      snapshot[id] = values[id] ?? defaultValues[id];
      return snapshot;
    }, {}),
    eqPoints: normalizeEqPoints(eqPoints)
  }), [eqPoints, values]);

  const applyAbSnapshot = useCallback((snapshot) => {
    const nextValues = { ...defaultValues, ...(snapshot?.values || {}) };
    const nextEqPoints = normalizeEqPoints(snapshot?.eqPoints || []);
    const eqPayload = { bands: nextEqPoints };

    setValues(nextValues);
    setEqPointsFromUi(nextEqPoints);
    supernovaParameterIds.forEach((id) => {
      const value = nextValues[id];
      sendNativeParameter(id, booleanParameterSet.has(id) ? (value ? 1 : 0) : value);
    });
    lastSentEqJsonRef.current = JSON.stringify(eqPayload);
    sendNativeEqBands(eqPayload);
  }, [setEqPointsFromUi]);

  const handleAbSelect = useCallback((nextSlot) => {
    if (nextSlot !== "A" && nextSlot !== "B") return;

    const currentSlot = abActiveSlotRef.current;
    if (nextSlot === currentSlot) return;

    const currentSnapshot = makeAbSnapshot();
    abSnapshotsRef.current[currentSlot] = currentSnapshot;

    if (!abSnapshotsRef.current[nextSlot]) {
      abSnapshotsRef.current[nextSlot] = currentSnapshot;
    }

    abActiveSlotRef.current = nextSlot;
    setAb(nextSlot);
    applyAbSnapshot(abSnapshotsRef.current[nextSlot]);
  }, [applyAbSnapshot, makeAbSnapshot]);

  const resetToDefault = useCallback(() => {
    setValues(defaultValues);
    setEqPointsFromUi([]);
    supernovaParameterIds.forEach((id) => {
      const value = defaultValues[id];
      sendNativeParameter(id, booleanParameterSet.has(id) ? (value ? 1 : 0) : value);
    });
    sendNativeEqBands({ bands: [] });
  }, [setEqPointsFromUi]);

  const { presets: userPresets, savePreset, deletePreset } = useUserPresets();

  const handleSavePreset = useCallback((name) => {
    savePreset(name, {
      values: supernovaParameterIds.reduce((result, id) => ({ ...result, [id]: values[id] }), {}),
      eqPoints
    });
  }, [savePreset, values, eqPoints]);

  const handleLoadUserPreset = useCallback((preset) => {
    const nextValues = { ...defaultValues, ...(preset.values || {}) };
    setValues(nextValues);
    setEqPointsFromUi(normalizeEqPoints(preset.eqPoints || preset.eqPrePoints || []));
    supernovaParameterIds.forEach((id) => {
      const value = nextValues[id];
      sendNativeParameter(id, booleanParameterSet.has(id) ? (value ? 1 : 0) : value);
    });
  }, [setEqPointsFromUi]);

  return (
    <div className="plugin-frame">
      <div
        className="plugin supernova-eq-plugin"
        style={layoutStyle}
        data-layout-focus="eq"
        data-rack-maximized="true"
        data-eq-empty={activeEqPointCount === 0 ? "true" : "false"}
      >
        <div className="real-bg" aria-hidden="true">
          <div className="real-bg-slice real-bg-header" />
          <div className="real-bg-slice real-bg-eq" />
          <div className="real-bg-slice real-bg-footer" />
        </div>

        <div className="plugin-header">
          <div className="brand">
            <button
              type="button"
              className="brand-mark"
              onClick={() => setInfoOpen(true)}
              aria-haspopup="dialog"
              aria-label="About Supernova EQ"
            >
              <span className="brand-symbol" aria-hidden="true">
                <span className="brand-symbol-core" />
              </span>
              <span className="brand-lockup">
                <span className="brand-word">Supernova</span>
                <span className="brand-eq">EQ</span>
              </span>
            </button>
            <div className="brand-sub">Equalizer · {nativeOnline ? "Native" : "Browser"}</div>
          </div>
          <div className="preset-center">
            <div className="preset-wrap">
              <div className="preset-bar-row">
                <button
                  type="button"
                  className={`preset-bar${presetOpen ? " open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={presetOpen}
                  onClick={() => setPresetOpen((open) => !open)}
                >
                  <span className="preset-name">Default</span>
                  <svg className="preset-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="preset-save-btn"
                  aria-label="Save current settings as preset"
                  title="Save preset"
                  onClick={() => {
                    setPresetOpen(false);
                    setSavePresetOpen(true);
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                    <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {presetOpen && (
                <PresetMenu
                  onDefault={resetToDefault}
                  onClose={() => setPresetOpen(false)}
                  userPresets={userPresets}
                  onDeleteUserPreset={deletePreset}
                  onSelectUserPreset={handleLoadUserPreset}
                />
              )}
            </div>
          </div>
          <div className="header-actions">
            <div className="ab-compare">
              <button className={ab === "A" ? "active" : ""} onClick={() => handleAbSelect("A")}>A</button>
              <button className={ab === "B" ? "active" : ""} onClick={() => handleAbSelect("B")}>B</button>
            </div>
            <button
              className={`icon-btn${tweaks.signalActive ? " active" : ""}`}
              onClick={(event) => {
                if (resetOnAltClick(event, () => setTweak("signalActive", TWEAK_DEFAULTS.signalActive))) return;
                setTweak("signalActive", !tweaks.signalActive);
              }}
              onDoubleClick={(event) => resetOnDoubleClick(event, () => setTweak("signalActive", TWEAK_DEFAULTS.signalActive))}
              title="Toggle signal"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7h2l1.5-3 3 6 1.5-3h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="theme-menu-wrap">
              <button
                className={`icon-btn${themeMenuOpen ? " active" : ""}`}
                title="Theme & display"
                aria-haspopup="menu"
                aria-expanded={themeMenuOpen}
                onClick={(event) => {
                  if (resetOnAltClick(event, () => {
                    setTweak("theme", TWEAK_DEFAULTS.theme);
                    setThemeMenuOpen(false);
                  })) return;
                  setThemeMenuOpen((open) => !open);
                }}
                onDoubleClick={(event) => resetOnDoubleClick(event, () => {
                  setTweak("theme", TWEAK_DEFAULTS.theme);
                  setThemeMenuOpen(false);
                })}
              >
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M2 4h10M2 7h10M2 10h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
              {themeMenuOpen && (
                <ThemeMenu
                  themeId={themeId}
                  onSelect={(id) => {
                    setTweak("theme", id);
                    setThemeMenuOpen(false);
                  }}
                  onClose={() => setThemeMenuOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        {infoOpen && <PluginInfoModal nativeOnline={nativeOnline} onClose={() => setInfoOpen(false)} />}
        {savePresetOpen && <SavePresetModal onSave={handleSavePreset} onClose={() => setSavePresetOpen(false)} />}

        <div className="eq-section">
          <EQCurve
            postPoints={EMPTY_EQ_POINTS}
            setPostPoints={ignoreEqPointUpdates}
            prePoints={eqPoints}
            setPrePoints={setEqPointsFromUi}
            mode="pre"
            setMode={keepSingleEqMode}
            showWaveform={tweaks.showWaveform && tweaks.signalActive}
            scale={eqScale}
            scaleOpen={eqScaleOpen}
            setScaleOpen={setEqScaleOpen}
            scaleOptions={scaleOptions}
            setScale={setEqScale}
            scaleRef={eqScaleRef}
            saturation={activeEqSaturation}
            onSaturationChange={setActiveEqSaturation}
            detectedFrequency={meters.tuneFrequency}
            spectrumData={meters.postCompSpectrum}
            detectorData={meters.preEqDetectorDb}
            graphHeight={EQ_ONLY_GRAPH_HEIGHT}
            spectrumMaxFrequency={Math.max(20, Math.min(20000, Number(meters.spectrumMaxFrequency) || 20000))}
            sampleRate={meters.sampleRate}
          />
        </div>

        <div className="footer-meta">
          <FooterGainControl
            label="INPUT"
            value={inputGain}
            onChange={setInputGain}
            defaultValue={defaultValues.inputGain}
            active={tweaks.signalActive}
            level={meters.inputLevel}
          />
          <FooterGainControl
            label="OUTPUT"
            value={outputGain}
            onChange={setOutputGain}
            defaultValue={defaultValues.outputGain}
            active={tweaks.signalActive}
            level={meters.outputLevel}
            output
          />
        </div>

        <TweaksPanel title="Tweaks">
          <TweakSection label="Theme" />
          <TweakSelect
            label="Palette"
            value={themeId}
            onChange={(value) => setTweak("theme", value)}
            defaultValue={TWEAK_DEFAULTS.theme}
            options={THEMES.map((theme) => ({ value: theme.id, label: `${theme.label} · Night` }))}
          />
        </TweaksPanel>
        <EditorResizeGrip enabled={nativeOnline} />
      </div>
    </div>
  );
}

export default App;
