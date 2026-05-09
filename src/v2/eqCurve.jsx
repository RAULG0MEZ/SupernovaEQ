import React from "react";
import { resetOnAltClick, resetOnDoubleClick } from "./controlReset.js";
import { adjustWheelValue, handleWheelValue, wheelDirection } from "./wheelControl.js";

// Interactive EQ curve — independent pre/post, draggable points with Q + comp control

const EQ_SATURATION_LABELS = ['OFF', '1073', 'TAPE', 'TUBE'];
const DEFAULT_EQ_SATURATION_AMOUNT = 20;
const DEFAULT_EQ_BELL_Q = 1;
const DEFAULT_EQ_Q = 5;
const DEFAULT_EQ_SHELF_Q = 1.3;
const DEFAULT_EQ_LOW_CUT_SLOPE = 30;
const DEFAULT_FULL_SPECTRUM_SLOPE = 8;
const FULL_SPECTRUM_TYPE = 'Full Spectrum';
const FULL_SPECTRUM_MIN_RATIO = 1.015;
const FULL_SPECTRUM_SNAP_PX = 14;
const FULL_SPECTRUM_SOFT_SNAP_PX = 8;
const FULL_SPECTRUM_JOIN_PX = 3.25;
const FULL_SPECTRUM_DETACH_PX = 17;
const EQ_MIN_FREQUENCY = 20;
const EQ_GRAPH_MIN_FREQUENCY = 10;
const EQ_MAX_FREQUENCY = 20000;
const EQ_DEFAULT_SAMPLE_RATE = 48000;
const EQ_RESPONSE_FLOOR_DB = -160;

function EQCurve({
  postPoints,
  setPostPoints,
  prePoints,
  setPrePoints,
  mode,
  setMode,
  showWaveform = true,
  scale = 12,
  scaleOpen,
  setScaleOpen,
  scaleOptions,
  setScale,
  scaleRef,
  saturation = { mode: 0, amount: 0 },
  onSaturationChange,
  detectedFrequency = 0,
  spectrumData = [],
  detectorData = [],
  graphHeight = 320,
  spectrumMaxFrequency = 20000,
  sampleRate = EQ_DEFAULT_SAMPLE_RATE
}) {
  const W = 1296;
  const targetGraphHeight = Math.max(280, Math.min(700, Number(graphHeight) || 320));
  const H = targetGraphHeight;
  const expandedControlDock = targetGraphHeight >= 560;
  const [displayScale, setDisplayScale] = React.useState(scale);
  const displayScaleRef = React.useRef(scale);
  const dockScaleProgress = expandedControlDock
    ? Math.max(0, Math.min(1, (displayScale - 12) / 18))
    : 0;
  const padL = 0, padR = 10;
  const padT = 28 + dockScaleProgress * 22;
  const padB = 58 + dockScaleProgress * 50;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const freqLabelY = H - 26;
  const dockAutoRangeDb = expandedControlDock ? 9.5 : 12;
  const svgRef = React.useRef(null);
  const gradientUid = React.useId().replace(/:/g, '');
  const [activeIdx, setActiveIdx] = React.useState(null); // selected (focus)
  const [dragMode, setDragMode] = React.useState(null);   // 'node' | 'comp' | null
  const [dragIdx, setDragIdx] = React.useState(null);
  const [dragVisualHold, setDragVisualHold] = React.useState(null);
  const dragVisualHoldRef = React.useRef(null);
  const dragRef = React.useRef({ startX: 0, startY: 0, q: DEFAULT_EQ_Q, comp: 0 });
  const [hoverPoint, setHoverPoint] = React.useState(null);
  const [typeOpen, setTypeOpen] = React.useState(false);
  const minFrequency = EQ_MIN_FREQUENCY;
  const graphMinFrequency = EQ_GRAPH_MIN_FREQUENCY;
  const maxFrequency = EQ_MAX_FREQUENCY;
  const spectrumAnalysisMaxFrequency = Math.max(graphMinFrequency, Math.min(maxFrequency, Number(spectrumMaxFrequency) || maxFrequency));
  const frequencyRangeLog = Math.log10(maxFrequency / graphMinFrequency);
  const responseSampleRate = Math.max(1000, Number(sampleRate) || EQ_DEFAULT_SAMPLE_RATE);
  const latestPointsRef = React.useRef([]);
  const nodeInfoRef = React.useRef(null);
  const setPointsRef = React.useRef(null);
  const dragCommitRef = React.useRef({ raf: 0, points: null });
  const curveCreateRef = React.useRef(null);
  const surferVisualStateRef = React.useRef({ pre: [], post: [] });
  const [surferVisualFreqs, setSurferVisualFreqs] = React.useState({ pre: [], post: [] });

  const points = mode === 'pre' ? prePoints : postPoints;
  const setPoints = mode === 'pre' ? setPrePoints : setPostPoints;
  const satMode = saturation?.mode || 0;
  const satAmount = saturation?.amount || 0;
  const saturationLabel = satMode ? EQ_SATURATION_LABELS[satMode] : 'Saturation OFF';
  const setNodeVisualHold = React.useCallback((nextHold) => {
    dragVisualHoldRef.current = nextHold;
    setDragVisualHold(nextHold);
  }, []);

  React.useEffect(() => {
    setPointsRef.current = setPoints;
  }, [setPoints]);

  const commitDragPoints = React.useCallback((nextPts) => {
    latestPointsRef.current = nextPts;
    dragCommitRef.current.points = nextPts;

    if (dragCommitRef.current.raf) return;

    dragCommitRef.current.raf = requestAnimationFrame(() => {
      const pending = dragCommitRef.current.points;
      dragCommitRef.current.raf = 0;
      dragCommitRef.current.points = null;
      if (pending && setPointsRef.current) setPointsRef.current(pending);
    });
  }, []);

  const flushDragPoints = React.useCallback(() => {
    const pending = dragCommitRef.current.points;
    if (dragCommitRef.current.raf) cancelAnimationFrame(dragCommitRef.current.raf);
    dragCommitRef.current.raf = 0;
    dragCommitRef.current.points = null;
    if (pending && setPointsRef.current) setPointsRef.current(pending);
  }, []);

  React.useEffect(() => () => {
    if (dragCommitRef.current.raf) cancelAnimationFrame(dragCommitRef.current.raf);
  }, []);

  React.useEffect(() => {
    latestPointsRef.current = points;
  }, [points]);

  React.useEffect(() => {
    let raf = 0;
    const from = displayScaleRef.current;
    const to = scale;
    const startedAt = performance.now();
    const isDockScaleExpansion = expandedControlDock && to > from && to >= 30 && from <= 12.1;
    const duration = isDockScaleExpansion ? 620 : 240;

    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextScale = from + (to - from) * eased;
      displayScaleRef.current = nextScale;
      setDisplayScale(nextScale);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else if (isDockScaleExpansion && dragVisualHoldRef.current) {
        dragVisualHoldRef.current = { ...dragVisualHoldRef.current, releaseReady: true };
      }
    };

    if (Math.abs(from - to) < 0.01) {
      displayScaleRef.current = to;
      setDisplayScale(to);
      if (isDockScaleExpansion && dragVisualHoldRef.current) {
        dragVisualHoldRef.current = { ...dragVisualHoldRef.current, releaseReady: true };
      }
      return undefined;
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [expandedControlDock, scale]);

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const DESSER_TYPE = 'Desser';
  const DESSER_FREQ_MIN = 2500;
  const DESSER_FREQ_MAX = 16000;
  const DESSER_THRESHOLD_MIN = -60;
  const DESSER_THRESHOLD_MAX = 0;
  const EQ_COMP_THRESHOLD_MIN = -60;
  const EQ_COMP_THRESHOLD_MAX = 0;
  const EQ_COMP_ATTACK_MIN = 0.1;
  const EQ_COMP_ATTACK_MAX = 200;
  const EQ_COMP_RELEASE_MIN = 5;
  const EQ_COMP_RELEASE_MAX = 1000;
  const EQ_COMP_RATIO_MIN = 1;
  const EQ_COMP_RATIO_MAX = 20;
  const FILTER_TYPES = ['Bell', 'Surfer Bell', 'Low Cut', 'High Cut', 'Low Shelf', 'High Shelf', 'Notch', 'Band Pass', FULL_SPECTRUM_TYPE];
  const CUT_TYPES = new Set(['Low Cut', 'High Cut']);
  const DYNAMIC_EQ_TYPES = new Set(['Bell', 'Surfer Bell', 'Low Shelf', 'High Shelf', 'Band Pass', FULL_SPECTRUM_TYPE]);
  const SLOPE_TYPES = new Set(['Low Cut', 'High Cut', 'Low Shelf', 'High Shelf']);
  const CUT_NODE_GAIN_DISPLAY_RATIO = 0.72;
  const WALL_SLOPE = 'wall';
  const SLOPE_OPTIONS = [6, 12, 18, 24, 36, 48];
  const CUT_SLOPE_OPTIONS = [6, 12, 18, 24, 30, 36, 48, 72, 96, WALL_SLOPE];
  const getSurfRatio = (freq) => {
    const detected = Number(detectedFrequency);
    return Number.isFinite(detected) && detected >= 55
      ? clamp(freq / detected, 0.125, 128)
      : undefined;
  };

  const getCreatedFilterType = (freq) =>
    freq < 50
      ? 'Low Cut'
      : freq <= 100
        ? 'Low Shelf'
        : freq >= 15000
          ? 'High Cut'
          : freq > 5000
            ? 'High Shelf'
            : 'Bell';

  const getBandType = (point) => point.type === DESSER_TYPE ? 'Bell' : (point.type || getCreatedFilterType(point.freq));
  const canUseFilterType = (type, targetIdx = null, pts = points) => (
    !CUT_TYPES.has(type) ||
    !pts.some((point, index) => index !== targetIdx && getBandType(point) === type)
  );
  const getSelectableFilterTypes = (targetIdx) => (
    FILTER_TYPES.filter((type) => canUseFilterType(type, targetIdx))
  );
  const getQRange = (point) => SLOPE_TYPES.has(getBandType(point)) ? [0.1, 10] : [0.1, 50];
  const getDefaultQForType = (type) => (
    type === 'Bell'
      ? DEFAULT_EQ_BELL_Q
      : type === FULL_SPECTRUM_TYPE
        ? DEFAULT_FULL_SPECTRUM_SLOPE
      : type === 'Low Shelf' || type === 'High Shelf'
        ? DEFAULT_EQ_SHELF_Q
        : DEFAULT_EQ_Q
  );
  const getDefaultSlopeForType = (type) => (
    type === 'Low Cut' ? DEFAULT_EQ_LOW_CUT_SLOPE : 12
  );
  const getPointQ = (value, type) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : getDefaultQForType(type);
  };
  const isWallSlope = (slope) => `${slope}`.toLowerCase() === WALL_SLOPE;
  const getSlopeOptions = (type) => CUT_TYPES.has(type) ? CUT_SLOPE_OPTIONS : SLOPE_OPTIONS;
  const normalizeSlope = (slope, type) => {
    if (isWallSlope(slope)) return CUT_TYPES.has(type) ? WALL_SLOPE : SLOPE_OPTIONS[SLOPE_OPTIONS.length - 1];
    const numeric = Number(slope);
    const options = getSlopeOptions(type).filter(option => option !== WALL_SLOPE);
    if (!Number.isFinite(numeric)) return getDefaultSlopeForType(type);
    return options.reduce((closest, option) => (
      Math.abs(option - numeric) < Math.abs(closest - numeric) ? option : closest
    ), options[0]);
  };
  const getSlopeIndex = (slope, type) => {
    const normalized = normalizeSlope(slope, type);
    return getSlopeOptions(type).findIndex(option => option === normalized);
  };
  const cutNodeDisplayGain = (gainDb) => clamp((Number(gainDb) || 0) * CUT_NODE_GAIN_DISPLAY_RATIO, 0, 30);
  const cutGainFromNodeDisplayGain = (nodeGain) => clamp((Number(nodeGain) || 0) / CUT_NODE_GAIN_DISPLAY_RATIO, 0, 30);
  const getNeededEqRange = (pts) => (
    pts
      .some((p) => {
        const type = getBandType(p);
        const cutGain = CUT_TYPES.has(type) ? Math.max(0, Number(p.gain) || 0) : 0;
        const gain = CUT_TYPES.has(type) ? cutNodeDisplayGain(cutGain) : Number(p.gain) || 0;
        const comp = Number(p.comp) || 0;
        return Math.abs(gain) > dockAutoRangeDb || Math.abs(comp) > dockAutoRangeDb || cutGain > 16;
      })
      ? 30
      : 12
  );
  const clampEqFrequency = (freq) => clamp(freq, minFrequency, maxFrequency);
  const getFullSpectrumFallbackRange = (freq) => {
    const center = clampEqFrequency(Number(freq) || 1000);
    const halfOctaves = 1;
    return {
      low: clampEqFrequency(center / (2 ** halfOctaves)),
      high: clampEqFrequency(center * (2 ** halfOctaves))
    };
  };
  const normalizeFullSpectrumRange = (point, centerHint = 1000) => {
    const fallback = getFullSpectrumFallbackRange(centerHint);
    let low = Number(point?.rangeLow);
    let high = Number(point?.rangeHigh);

    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0 || high <= low * FULL_SPECTRUM_MIN_RATIO) {
      low = fallback.low;
      high = fallback.high;
    }

    low = clampEqFrequency(low);
    high = clampEqFrequency(high);

    if (high <= low * FULL_SPECTRUM_MIN_RATIO) {
      const center = clampEqFrequency(Number(centerHint) || Math.sqrt(Math.max(minFrequency, low) * Math.max(minFrequency, high)));
      const halfRatio = Math.sqrt(FULL_SPECTRUM_MIN_RATIO);
      low = clamp(center / halfRatio, minFrequency, maxFrequency / FULL_SPECTRUM_MIN_RATIO);
      high = clamp(center * halfRatio, low * FULL_SPECTRUM_MIN_RATIO, maxFrequency);
    }

    const center = clampEqFrequency(Math.sqrt(low * high));
    return { low, high, center };
  };
  const getFullSpectrumRangePatch = (point, patch) => {
    const current = {
      ...point,
      rangeLow: Object.prototype.hasOwnProperty.call(patch, 'rangeLow') ? patch.rangeLow : point.rangeLow,
      rangeHigh: Object.prototype.hasOwnProperty.call(patch, 'rangeHigh') ? patch.rangeHigh : point.rangeHigh
    };
    const range = normalizeFullSpectrumRange(current, point.freq);
    return {
      rangeLow: Math.round(range.low),
      rangeHigh: Math.round(range.high),
      freq: Math.round(range.center)
    };
  };
  const shiftFullSpectrumRange = (point, targetFrequency) => {
    const range = normalizeFullSpectrumRange(point, point.freq);
    const lowOffset = Math.log(range.center / range.low);
    const highOffset = Math.log(range.high / range.center);
    const totalWidth = lowOffset + highOffset;
    const minLog = Math.log(minFrequency);
    const maxLog = Math.log(maxFrequency);

    if (totalWidth >= maxLog - minLog) {
      return {
        rangeLow: minFrequency,
        rangeHigh: maxFrequency,
        freq: Math.round(Math.sqrt(minFrequency * maxFrequency))
      };
    }

    const targetLog = Math.log(clampEqFrequency(targetFrequency));
    const centerLog = clamp(targetLog, minLog + lowOffset, maxLog - highOffset);
    const low = Math.exp(centerLog - lowOffset);
    const high = Math.exp(centerLog + highOffset);

    return {
      rangeLow: Math.round(low),
      rangeHigh: Math.round(high),
      freq: Math.round(Math.sqrt(low * high))
    };
  };
  const getSurferTrackingWindow = (freq) => {
    const anchor = clampEqFrequency(Number(freq) || 1000);
    return [
      clampEqFrequency(anchor * 0.5),
      clampEqFrequency(anchor * 1.5)
    ];
  };
  const resolveSurferTargetFrequency = (anchorFreq, detected, ratio) => {
    if (!Number.isFinite(detected) || detected < 55 || !Number.isFinite(ratio) || ratio <= 0) {
      return clampEqFrequency(anchorFreq);
    }

    const [windowLow, windowHigh] = getSurferTrackingWindow(anchorFreq);
    const tracked = clampEqFrequency(detected * ratio);
    return tracked >= windowLow && tracked <= windowHigh
      ? tracked
      : clampEqFrequency(anchorFreq);
  };
  const withBandDefaults = (point) => {
    const type = getBandType(point);
    const isDesser = type === DESSER_TYPE;
    const rawGain = clamp(Number(point.gain) || 0, -30, 30);
    const gain = isDesser ? 0 : CUT_TYPES.has(type) ? clamp(rawGain, 0, 30) : rawGain;
    const comp = clamp(Number(point.comp) || 0, -30, 30);
    const rawFreq = isDesser
      ? clamp(point.freq || 5600, DESSER_FREQ_MIN, DESSER_FREQ_MAX)
      : clampEqFrequency(point.freq || 1000);
    const q = getPointQ(point.q, type);
    const fullSpectrumRange = type === FULL_SPECTRUM_TYPE
      ? normalizeFullSpectrumRange(point, rawFreq)
      : null;
    const hasExplicitCompEnabled = Object.prototype.hasOwnProperty.call(point, 'compEnabled');
    const explicitCompEnabled = point.compEnabled === true || point.compEnabled === 'true' || Number(point.compEnabled) >= 0.5;
    const legacyCompEnabled = Math.abs(comp) > 0.05 && Math.abs(comp - gain) > 0.05;
    const saturationMode = Number(point.saturationMode ?? point.satMode);
    const safeSaturationMode = DYNAMIC_EQ_TYPES.has(type)
      ? clamp(Math.round(Number.isFinite(saturationMode) ? saturationMode : 0), 0, EQ_SATURATION_LABELS.length - 1)
      : 0;
    const saturationAmount = Number(point.saturationAmount ?? point.satAmount);
    const rangeLowSlope = Number(point.rangeLowSlope ?? point.lowSlope);
    const rangeHighSlope = Number(point.rangeHighSlope ?? point.highSlope);
    return {
      freq: fullSpectrumRange ? fullSpectrumRange.center : rawFreq,
      gain,
      q,
      comp,
      compEnabled: DYNAMIC_EQ_TYPES.has(type) && (hasExplicitCompEnabled ? explicitCompEnabled : legacyCompEnabled),
      compThreshold: Number.isFinite(point.compThreshold) ? clamp(point.compThreshold, EQ_COMP_THRESHOLD_MIN, EQ_COMP_THRESHOLD_MAX) : -18,
      compAttack: Number.isFinite(point.compAttack) ? clamp(point.compAttack, EQ_COMP_ATTACK_MIN, EQ_COMP_ATTACK_MAX) : 12,
      compRelease: Number.isFinite(point.compRelease) ? clamp(point.compRelease, EQ_COMP_RELEASE_MIN, EQ_COMP_RELEASE_MAX) : 140,
      compRatio: Number.isFinite(point.compRatio) ? clamp(point.compRatio, EQ_COMP_RATIO_MIN, EQ_COMP_RATIO_MAX) : 4,
      saturationMode: safeSaturationMode,
      saturationAmount: safeSaturationMode > 0
        ? clamp(Number.isFinite(saturationAmount) ? saturationAmount : DEFAULT_EQ_SATURATION_AMOUNT, 0, 100)
        : 0,
      slope: normalizeSlope(point.slope, type),
      type,
      on: point.on !== false,
      solo: point.solo === true || point.solo === 'true' || Number(point.solo) >= 0.5,
      placement: point.placement || 'stereo',
      deessMode: point.deessMode === 'wider' ? 'wider' : 'split',
      threshold: Number.isFinite(point.threshold) ? clamp(point.threshold, DESSER_THRESHOLD_MIN, DESSER_THRESHOLD_MAX) : -24,
      intensity: Number.isFinite(point.intensity) ? clamp(point.intensity, 0, 100) : 50,
      ...(fullSpectrumRange ? {
        rangeLow: fullSpectrumRange.low,
        rangeHigh: fullSpectrumRange.high,
        rangeLowSlope: clamp(Number.isFinite(rangeLowSlope) && rangeLowSlope > 0 ? rangeLowSlope : q, 0.1, 50),
        rangeHighSlope: clamp(Number.isFinite(rangeHighSlope) && rangeHighSlope > 0 ? rangeHighSlope : q, 0.1, 50)
      } : {}),
      ...(type === 'Surfer Bell' && Number.isFinite(point.surfRatio) && point.surfRatio > 0
        ? { surfRatio: clamp(point.surfRatio, 0.125, 128) }
        : {})
    };
  };
  const supportsBandDynamics = (point) => DYNAMIC_EQ_TYPES.has(getBandType(point));
  const supportsBandSaturation = (point) => DYNAMIC_EQ_TYPES.has(getBandType(point));
  const bandHasCompressionTarget = (point) => {
    const band = withBandDefaults(point);
    return supportsBandDynamics(band) && Math.abs((Number(band.comp) || 0) - (Number(band.gain) || 0)) > 0.05;
  };
  const bandHasDynamics = (point) => {
    const band = withBandDefaults(point);
    return band.compEnabled && bandHasCompressionTarget(band);
  };

  React.useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const detected = Number(detectedFrequency);
    const hasDetectedPitch = Number.isFinite(detected) && detected >= 55;

    const smoothFrequency = (current, target, snap) => {
      if (snap || !Number.isFinite(current) || current <= 0) return target;
      if (!Number.isFinite(target) || target <= 0) return current;

      const cents = Math.abs(1200 * Math.log2(target / current));
      if (cents < 1.2 || Math.abs(target - current) < 0.15) return target;

      return current * Math.pow(target / current, 0.18);
    };

    const buildEntries = (pts, modeKey) => {
      const previous = surferVisualStateRef.current[modeKey] || [];

      return pts.map((point, index) => {
        const band = withBandDefaults(point);
        const previousEntry = previous[index] || {};
        const anchorChanged = Math.abs((Number(previousEntry.anchor) || 0) - band.freq) > 0.5 ||
          previousEntry.type !== band.type;
        const isDraggedSurfBand = dragMode === 'node' && dragIdx === index && mode === modeKey;
        const shouldSnap = anchorChanged || isDraggedSurfBand;

        if (band.type !== 'Surfer Bell' || band.on === false) {
          return {
            type: band.type,
            anchor: band.freq,
            ratio: 0,
            freq: band.freq,
            target: band.freq,
            moving: false
          };
        }

        const explicitRatio = Number.isFinite(band.surfRatio) && band.surfRatio > 0;
        let ratio = explicitRatio ? band.surfRatio : Number(previousEntry.ratio);

        if (!explicitRatio && (!Number.isFinite(ratio) || ratio <= 0 || anchorChanged) && hasDetectedPitch) {
          ratio = clamp(band.freq / detected, 0.125, 128);
        }

        const target = isDraggedSurfBand
          ? band.freq
          : hasDetectedPitch && Number.isFinite(ratio) && ratio > 0
          ? resolveSurferTargetFrequency(band.freq, detected, ratio)
          : band.freq;
        const current = Number.isFinite(previousEntry.freq) ? previousEntry.freq : target;
        const freq = smoothFrequency(current, target, shouldSnap);
        const centsAway = Math.abs(1200 * Math.log2(target / clampEqFrequency(freq)));

        return {
          type: band.type,
          anchor: band.freq,
          ratio: Number.isFinite(ratio) ? ratio : 0,
          freq,
          target,
          moving: centsAway > 1.2
        };
      });
    };

    const tick = () => {
      const nextState = {
        pre: buildEntries(prePoints, 'pre'),
        post: buildEntries(postPoints, 'post')
      };
      const previous = surferVisualStateRef.current;
      let changed = previous.pre.length !== nextState.pre.length || previous.post.length !== nextState.post.length;
      let keepAnimating = false;

      for (const modeKey of ['pre', 'post']) {
        nextState[modeKey].forEach((entry, index) => {
          const oldFreq = previous[modeKey]?.[index]?.freq;
          if (!Number.isFinite(oldFreq) || Math.abs(oldFreq - entry.freq) > 0.05) changed = true;
          if (entry.moving) keepAnimating = true;
        });
      }

      surferVisualStateRef.current = nextState;

      if (changed) {
        setSurferVisualFreqs({
          pre: nextState.pre.map((entry) => entry.freq),
          post: nextState.post.map((entry) => entry.freq)
        });
      }

      if (!cancelled && keepAnimating) raf = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  // withBandDefaults is deterministic here; including it would restart the glide on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedFrequency, dragIdx, dragMode, mode, postPoints, prePoints]);

  React.useEffect(() => {
    if (!typeOpen) return undefined;
    const onDocPointer = (event) => {
      if (nodeInfoRef.current && !nodeInfoRef.current.contains(event.target)) setTypeOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setTypeOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [typeOpen]);

  React.useEffect(() => {
    setTypeOpen(false);
  }, [activeIdx, mode]);

  const formatFreq = (freq) => (
    freq < 1000
      ? `${Math.round(freq)} Hz`
      : `${(freq / 1000).toFixed(freq >= 10000 ? 1 : 2)} kHz`
  );
  const formatGain = (gain) => `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`;
  const formatSlope = (slope) => isWallSlope(slope) ? 'WALL' : `${slope} dB/OCT`;
  const formatThreshold = (threshold) => `${Math.round(threshold)} dB`;
  const formatIntensity = (intensity) => `${Math.round(intensity)}%`;
  const formatMs = (value) => value < 10 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`;
  const formatRatio = (value) => `${Number(value).toFixed(value < 10 ? 1 : 0)}:1`;

  const applyPointPatch = (idx, patch, options = {}) => {
    const { resort = true, updateRange = true } = options;
    if (idx === null || idx === undefined || idx < 0) return idx;
    const currentPoints = latestPointsRef.current.length ? latestPointsRef.current : points;
    if (!currentPoints[idx]) return idx;
    if (patch.type && !canUseFilterType(patch.type, idx, currentPoints)) return idx;

    const previous = withBandDefaults(currentPoints[idx]);
    const updated = withBandDefaults({ ...currentPoints[idx], ...patch });
    const patchHasComp = Object.prototype.hasOwnProperty.call(patch, 'comp');
    const patchHasGain = Object.prototype.hasOwnProperty.call(patch, 'gain');
    const patchHasType = Object.prototype.hasOwnProperty.call(patch, 'type');

    if (!supportsBandDynamics(updated)) {
      updated.comp = 0;
      updated.compEnabled = false;
    } else if (!patchHasComp && (patchHasGain || patchHasType) && !bandHasCompressionTarget(previous)) {
      updated.comp = updated.gain;
      updated.compEnabled = false;
    }

    if (!supportsBandSaturation(updated)) {
      updated.saturationMode = 0;
      updated.saturationAmount = 0;
    }

    if (updated.type === 'Surfer Bell' && (Object.prototype.hasOwnProperty.call(patch, 'freq') || Object.prototype.hasOwnProperty.call(patch, 'type'))) {
      const ratio = getSurfRatio(updated.freq);
      if (ratio) updated.surfRatio = ratio;
      else updated.surfRatio = 0;
    }
    const nextPts = [...currentPoints];
    nextPts[idx] = updated;
    if (resort) nextPts.sort((a, b) => a.freq - b.freq);
    const nextIdx = nextPts.indexOf(updated);
    const normalizedIdx = nextIdx === -1 ? idx : nextIdx;

    latestPointsRef.current = nextPts;
    setPoints(nextPts);
    setActiveIdx(normalizedIdx);
    if (updateRange) setScale?.(getNeededEqRange(nextPts));
    return normalizedIdx;
  };

  const deleteActivePoint = () => {
    if (activeIdx === null || activeIdx === undefined || points.length <= 0) return;
    const np = points.filter((_, i) => i !== activeIdx);
    latestPointsRef.current = np;
    setPoints(np);
    setActiveIdx(null);
    setDragIdx(null);
    setDragMode(null);
    setTypeOpen(false);
    setScale?.(getNeededEqRange(np));
  };

  const deleteActiveCompressor = () => {
    if (activeIdx === null || activeIdx === undefined || !points[activeIdx]) return;
    const current = withBandDefaults(points[activeIdx]);
    if (!supportsBandDynamics(current)) return;

    applyPointPatch(activeIdx, {
      comp: current.gain,
      compEnabled: false
    }, { resort: false, updateRange: true });
  };

  const resetInfoField = (field) => {
    if (activeIdx === null || activeIdx === undefined || !points[activeIdx]) return;

    const point = withBandDefaults(points[activeIdx]);
    if (field === 'freq') {
      applyPointPatch(activeIdx, { freq: point.type === DESSER_TYPE ? 5600 : 1000 }, { resort: true, updateRange: false });
    } else if (field === 'gain') {
      applyPointPatch(activeIdx, { gain: 0 }, { resort: false, updateRange: true });
    } else if (field === 'q') {
      const [minQ, maxQ] = getQRange(point);
      applyPointPatch(activeIdx, { q: clamp(getDefaultQForType(point.type), minQ, maxQ) }, { resort: false, updateRange: false });
    } else if (field === 'rangeLow' || field === 'rangeHigh') {
      applyPointPatch(activeIdx, getFullSpectrumRangePatch({ ...point, rangeLow: point.freq / 2, rangeHigh: point.freq * 2 }, {}), { resort: true, updateRange: false });
    } else if (field === 'slope') {
      applyPointPatch(activeIdx, { slope: getDefaultSlopeForType(point.type) }, { resort: false, updateRange: false });
    } else if (field === 'threshold') {
      applyPointPatch(activeIdx, { threshold: -24 }, { resort: false, updateRange: false });
    } else if (field === 'intensity') {
      applyPointPatch(activeIdx, { intensity: 50 }, { resort: false, updateRange: true });
    } else if (field === 'compThreshold') {
      applyPointPatch(activeIdx, { compThreshold: -18 }, { resort: false, updateRange: false });
    } else if (field === 'compAttack') {
      applyPointPatch(activeIdx, { compAttack: 12 }, { resort: false, updateRange: false });
    } else if (field === 'compRelease') {
      applyPointPatch(activeIdx, { compRelease: 140 }, { resort: false, updateRange: false });
    } else if (field === 'compRatio') {
      applyPointPatch(activeIdx, { compRatio: 4 }, { resort: false, updateRange: false });
    }
  };

  const onInfoDragStart = (field) => (e) => {
    if (activeIdx === null || activeIdx === undefined || !points[activeIdx]) return;
    if (resetOnAltClick(e, () => resetInfoField(field))) return;
    if (e.detail >= 2 && resetOnDoubleClick(e, () => resetInfoField(field))) return;
    e.preventDefault();
    e.stopPropagation();
    setTypeOpen(false);

    const startPoint = withBandDefaults(points[activeIdx]);
    const startX = e.clientX;
    const startY = e.clientY;
    let targetIdx = activeIdx;
    e.currentTarget.setPointerCapture?.(e.pointerId);

    const onPointerMove = (event) => {
      event.preventDefault();
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (field === 'freq') {
        const freq = Math.round(clampEqFrequency(startPoint.freq * Math.pow(2, dx / 130)));
        targetIdx = applyPointPatch(targetIdx, { freq }, { resort: true, updateRange: false });
      } else if (field === 'gain') {
        const minGain = CUT_TYPES.has(startPoint.type) ? 0 : -30;
        const gain = Number(clamp(startPoint.gain - dy / 5, minGain, 30).toFixed(1));
        targetIdx = applyPointPatch(targetIdx, { gain }, { resort: false, updateRange: true });
      } else if (field === 'q') {
        const [minQ, maxQ] = getQRange(startPoint);
        const q = Number(clamp(startPoint.q * Math.exp((dx - dy) / 120), minQ, maxQ).toFixed(2));
        targetIdx = applyPointPatch(targetIdx, { q }, { resort: false, updateRange: false });
      } else if (field === 'rangeLow') {
        const rangeLow = clampEqFrequency(startPoint.rangeLow * Math.pow(2, dx / 130));
        const snapPts = latestPointsRef.current.length ? latestPointsRef.current : points;
        const snap = getFullSpectrumSnap(rangeLow, snapPts, targetIdx, 'low');
        const snappedRangeLow = snap ? snap.freq : rangeLow;
        targetIdx = applyPointPatch(
          targetIdx,
          getFullSpectrumRangePatch(startPoint, { rangeLow: Math.min(snappedRangeLow, startPoint.rangeHigh / FULL_SPECTRUM_MIN_RATIO) }),
          { resort: true, updateRange: false }
        );
      } else if (field === 'rangeHigh') {
        const rangeHigh = clampEqFrequency(startPoint.rangeHigh * Math.pow(2, dx / 130));
        const snapPts = latestPointsRef.current.length ? latestPointsRef.current : points;
        const snap = getFullSpectrumSnap(rangeHigh, snapPts, targetIdx, 'high');
        const snappedRangeHigh = snap ? snap.freq : rangeHigh;
        targetIdx = applyPointPatch(
          targetIdx,
          getFullSpectrumRangePatch(startPoint, { rangeHigh: Math.max(snappedRangeHigh, startPoint.rangeLow * FULL_SPECTRUM_MIN_RATIO) }),
          { resort: true, updateRange: false }
        );
      } else if (field === 'slope') {
        const options = getSlopeOptions(startPoint.type);
        const startIndex = getSlopeIndex(startPoint.slope, startPoint.type);
        const stepDelta = Math.round((dx - dy) / 28);
        const slope = options[clamp(startIndex + stepDelta, 0, options.length - 1)];
        targetIdx = applyPointPatch(targetIdx, { slope }, { resort: false, updateRange: false });
      } else if (field === 'threshold') {
        const threshold = Number(clamp(startPoint.threshold - dy / 2, DESSER_THRESHOLD_MIN, DESSER_THRESHOLD_MAX).toFixed(1));
        targetIdx = applyPointPatch(targetIdx, { threshold }, { resort: false, updateRange: false });
      } else if (field === 'intensity') {
        const intensity = Math.round(clamp(startPoint.intensity - dy / 1.8, 0, 100));
        targetIdx = applyPointPatch(targetIdx, { intensity }, { resort: false, updateRange: true });
      } else if (field === 'compThreshold') {
        const compThreshold = Number(clamp(startPoint.compThreshold - dy / 2, EQ_COMP_THRESHOLD_MIN, EQ_COMP_THRESHOLD_MAX).toFixed(1));
        targetIdx = applyPointPatch(targetIdx, { compThreshold }, { resort: false, updateRange: false });
      } else if (field === 'compAttack') {
        const compAttack = Number(clamp(startPoint.compAttack * Math.exp((dx - dy) / 150), EQ_COMP_ATTACK_MIN, EQ_COMP_ATTACK_MAX).toFixed(1));
        targetIdx = applyPointPatch(targetIdx, { compAttack }, { resort: false, updateRange: false });
      } else if (field === 'compRelease') {
        const compRelease = Number(clamp(startPoint.compRelease * Math.exp((dx - dy) / 150), EQ_COMP_RELEASE_MIN, EQ_COMP_RELEASE_MAX).toFixed(1));
        targetIdx = applyPointPatch(targetIdx, { compRelease }, { resort: false, updateRange: false });
      } else if (field === 'compRatio') {
        const compRatio = Number(clamp(startPoint.compRatio * Math.exp((dx - dy) / 180), EQ_COMP_RATIO_MIN, EQ_COMP_RATIO_MAX).toFixed(1));
        targetIdx = applyPointPatch(targetIdx, { compRatio }, { resort: false, updateRange: false });
      }
    };

    const onPointerUp = () => {
      setScale?.(getNeededEqRange(latestPointsRef.current));
      window.removeEventListener('pointermove', onPointerMove);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };
  const onInfoWheel = (field) => (e) => {
    if (activeIdx === null || activeIdx === undefined || !points[activeIdx]) return;
    e.preventDefault();
    e.stopPropagation();
    setTypeOpen(false);

    const point = withBandDefaults(points[activeIdx]);
    const direction = wheelDirection(e);
    const fine = e.shiftKey || e.altKey;

    if (field === 'freq') {
      const freq = Math.round(clampEqFrequency(point.freq * Math.pow(2, direction * (fine ? 1 / 72 : 1 / 24))));
      applyPointPatch(activeIdx, { freq }, { resort: true, updateRange: false });
    } else if (field === 'gain') {
      const gain = adjustWheelValue(point.gain, { min: CUT_TYPES.has(point.type) ? 0 : -30, max: 30, step: fine ? 0.1 : 0.5, event: e });
      applyPointPatch(activeIdx, { gain }, { resort: false, updateRange: true });
    } else if (field === 'q') {
      const [minQ, maxQ] = getQRange(point);
      const q = Number(clamp(point.q * Math.exp(direction * (fine ? 0.035 : 0.12)), minQ, maxQ).toFixed(2));
      applyPointPatch(activeIdx, { q }, { resort: false, updateRange: false });
    } else if (field === 'rangeLow') {
      const rangeLow = clampEqFrequency(point.rangeLow * Math.pow(2, direction * (fine ? 1 / 96 : 1 / 32)));
      const snap = getFullSpectrumSnap(rangeLow, points, activeIdx, 'low');
      const snappedRangeLow = snap ? snap.freq : rangeLow;
      applyPointPatch(
        activeIdx,
        getFullSpectrumRangePatch(point, { rangeLow: Math.min(snappedRangeLow, point.rangeHigh / FULL_SPECTRUM_MIN_RATIO) }),
        { resort: true, updateRange: false }
      );
    } else if (field === 'rangeHigh') {
      const rangeHigh = clampEqFrequency(point.rangeHigh * Math.pow(2, direction * (fine ? 1 / 96 : 1 / 32)));
      const snap = getFullSpectrumSnap(rangeHigh, points, activeIdx, 'high');
      const snappedRangeHigh = snap ? snap.freq : rangeHigh;
      applyPointPatch(
        activeIdx,
        getFullSpectrumRangePatch(point, { rangeHigh: Math.max(snappedRangeHigh, point.rangeLow * FULL_SPECTRUM_MIN_RATIO) }),
        { resort: true, updateRange: false }
      );
    } else if (field === 'slope') {
      const options = getSlopeOptions(point.type);
      const nextIndex = clamp(getSlopeIndex(point.slope, point.type) + direction, 0, options.length - 1);
      applyPointPatch(activeIdx, { slope: options[nextIndex] }, { resort: false, updateRange: false });
    } else if (field === 'threshold') {
      const threshold = adjustWheelValue(point.threshold, { min: DESSER_THRESHOLD_MIN, max: DESSER_THRESHOLD_MAX, step: fine ? 0.1 : 1, event: e });
      applyPointPatch(activeIdx, { threshold }, { resort: false, updateRange: false });
    } else if (field === 'intensity') {
      const intensity = adjustWheelValue(point.intensity, { min: 0, max: 100, step: fine ? 1 : 5, event: e });
      applyPointPatch(activeIdx, { intensity }, { resort: false, updateRange: true });
    } else if (field === 'compThreshold') {
      const compThreshold = adjustWheelValue(point.compThreshold, { min: EQ_COMP_THRESHOLD_MIN, max: EQ_COMP_THRESHOLD_MAX, step: fine ? 0.1 : 1, event: e });
      applyPointPatch(activeIdx, { compThreshold }, { resort: false, updateRange: false });
    } else if (field === 'compAttack') {
      const compAttack = Number(clamp(point.compAttack * Math.exp(direction * (fine ? 0.025 : 0.10)), EQ_COMP_ATTACK_MIN, EQ_COMP_ATTACK_MAX).toFixed(1));
      applyPointPatch(activeIdx, { compAttack }, { resort: false, updateRange: false });
    } else if (field === 'compRelease') {
      const compRelease = Number(clamp(point.compRelease * Math.exp(direction * (fine ? 0.025 : 0.10)), EQ_COMP_RELEASE_MIN, EQ_COMP_RELEASE_MAX).toFixed(1));
      applyPointPatch(activeIdx, { compRelease }, { resort: false, updateRange: false });
    } else if (field === 'compRatio') {
      const compRatio = Number(clamp(point.compRatio * Math.exp(direction * (fine ? 0.020 : 0.08)), EQ_COMP_RATIO_MIN, EQ_COMP_RATIO_MAX).toFixed(1));
      applyPointPatch(activeIdx, { compRatio }, { resort: false, updateRange: false });
    }
  };

  const FILTER_TYPE_PATHS = {
    'Bell': 'M2 11.5 C5 11.5 5.8 4 9 4 C12.2 4 13 11.5 16 11.5',
    'Surfer Bell': 'M2 11.2 C4.4 11.2 5.5 4.8 8.2 4.8 C10.3 4.8 11.2 8.1 12.8 8.1 C14.2 8.1 14.8 6.7 16 6.7',
    'Low Cut': 'M2 12.5 C5 12.5 5.8 5 8.9 5 L16 5',
    'High Cut': 'M2 5 L9.1 5 C12.2 5 13 12.5 16 12.5',
    'Low Shelf': 'M2 11.5 C5 11.5 5.8 6.6 8.8 6.6 L16 6.6',
    'High Shelf': 'M2 6.6 L9.2 6.6 C12.2 6.6 13 11.5 16 11.5',
    'Notch': 'M2 5.2 C5.2 5.2 5.7 12.3 9 12.3 C12.3 12.3 12.8 5.2 16 5.2',
    'Band Pass': 'M2 12.2 C5.1 12.2 5.5 5.3 9 5.3 C12.5 5.3 12.9 12.2 16 12.2',
    [FULL_SPECTRUM_TYPE]: 'M2 12.4 L4.7 12.4 L4.7 4 L13.3 4 L13.3 12.4 L16 12.4',
    'Desser': 'M2 11.7 C4.6 11.7 5.2 7.2 7.1 7.2 C8.7 7.2 9.1 11.6 10.8 11.6 C12.7 11.6 13.1 5.4 16 5.4'
  };
  const getFilterTypePath = (type) => FILTER_TYPE_PATHS[type] || FILTER_TYPE_PATHS.Bell;

  const FilterTypeIcon = ({ type }) => {
    return (
      <svg className="eq-type-icon" width="20" height="16" viewBox="0 0 18 16" fill="none" aria-hidden="true">
        <path d="M2 12.8H16" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.22" />
        <path d={getFilterTypePath(type)} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

  const freqToX = (f) => {
    const clamped = clamp(Number(f) || minFrequency, graphMinFrequency, maxFrequency);
    return padL + (Math.log10(clamped / graphMinFrequency) / frequencyRangeLog) * innerW;
  };
  const xToFreq = (x) => {
    return graphMinFrequency * Math.pow(maxFrequency / graphMinFrequency, clamp((x - padL) / innerW, 0, 1));
  };
  const getFullSpectrumSnapCandidates = (pts, targetIdx) => {
    const candidates = [];

    pts.forEach((point, index) => {
      if (index === targetIdx) return;
      const band = withBandDefaults(point);
      if (band.type !== FULL_SPECTRUM_TYPE || band.on === false) return;

      candidates.push({ freq: band.rangeLow, edge: 'low' });
      candidates.push({ freq: band.rangeHigh, edge: 'high' });
    });

    return candidates;
  };
  const getFullSpectrumSnap = (freq, pts, targetIdx, movingEdge) => {
    const targetX = freqToX(freq);
    const preferredEdge = movingEdge === 'low' ? 'high' : 'low';
    let best = null;

    getFullSpectrumSnapCandidates(pts, targetIdx).forEach((candidate) => {
      const distance = Math.abs(freqToX(candidate.freq) - targetX);
      const threshold = candidate.edge === preferredEdge ? FULL_SPECTRUM_SNAP_PX : FULL_SPECTRUM_SOFT_SNAP_PX;
      if (distance > threshold) return;
      if (!best || distance < best.distance || (distance === best.distance && candidate.edge === preferredEdge)) {
        best = { ...candidate, distance, movingEdge };
      }
    });

    return best;
  };
  const snapFullSpectrumMovePatch = (point, patch, pts, targetIdx) => {
    const low = Number(patch.rangeLow);
    const high = Number(patch.rangeHigh);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return patch;

    const lowSnap = getFullSpectrumSnap(low, pts, targetIdx, 'low');
    const highSnap = getFullSpectrumSnap(high, pts, targetIdx, 'high');
    const snap = lowSnap && highSnap
      ? (lowSnap.distance <= highSnap.distance ? lowSnap : highSnap)
      : (lowSnap || highSnap);

    if (!snap) return patch;

    const ratio = snap.movingEdge === 'low' ? snap.freq / low : snap.freq / high;
    const nextLow = low * ratio;
    const nextHigh = high * ratio;

    if (nextLow < minFrequency || nextHigh > maxFrequency) return patch;
    return getFullSpectrumRangePatch(point, { rangeLow: nextLow, rangeHigh: nextHigh });
  };
  const fullSpectrumEdgeKey = (idx, edge) => `${idx}:${edge}`;
  const getFullSpectrumEdgeSlopeField = (edge) => edge === 'low' ? 'rangeLowSlope' : 'rangeHighSlope';
  const getFullSpectrumEdgeSlope = (band, edge) => {
    const slope = Number(band[getFullSpectrumEdgeSlopeField(edge)]);
    return clamp(Number.isFinite(slope) && slope > 0 ? slope : Number(band.q) || DEFAULT_FULL_SPECTRUM_SLOPE, 0.1, 50);
  };
  const getFullSpectrumJunctions = (pts) => {
    const edges = [];

    pts.forEach((point, idx) => {
      const band = withBandDefaults(point);
      if (band.type !== FULL_SPECTRUM_TYPE || band.on === false) return;

      edges.push({ idx, edge: 'low', freq: band.rangeLow, x: freqToX(band.rangeLow), slope: getFullSpectrumEdgeSlope(band, 'low') });
      edges.push({ idx, edge: 'high', freq: band.rangeHigh, x: freqToX(band.rangeHigh), slope: getFullSpectrumEdgeSlope(band, 'high') });
    });

    edges.sort((a, b) => a.x - b.x);

    const groups = [];
    edges.forEach((edge) => {
      const last = groups[groups.length - 1];
      if (last && Math.abs(edge.x - last.x) <= FULL_SPECTRUM_JOIN_PX) {
        last.edges.push(edge);
        last.x = last.edges.reduce((sum, item) => sum + item.x, 0) / last.edges.length;
      } else {
        groups.push({ x: edge.x, edges: [edge] });
      }
    });

    return groups
      .filter((group) => new Set(group.edges.map((edge) => edge.idx)).size >= 2)
      .map((group) => {
        const x = group.edges.reduce((sum, edge) => sum + edge.x, 0) / group.edges.length;
        const sortedEdges = group.edges
          .slice()
          .sort((a, b) => a.idx - b.idx || a.edge.localeCompare(b.edge));
        return {
          id: sortedEdges.map((edge) => fullSpectrumEdgeKey(edge.idx, edge.edge)).join('|'),
          x,
          freq: clampEqFrequency(xToFreq(x)),
          edges: sortedEdges
        };
      });
  };
  const fullSpectrumJunctions = getFullSpectrumJunctions(points);
  const fullSpectrumJoinedEdgeKeys = new Set(
    fullSpectrumJunctions.flatMap((junction) => junction.edges.map((edge) => fullSpectrumEdgeKey(edge.idx, edge.edge)))
  );
  const isFullSpectrumEdgeJoined = (idx, edge) => fullSpectrumJoinedEdgeKeys.has(fullSpectrumEdgeKey(idx, edge));
  const gainToYAtScale = (g, range) => padT + ((range - Math.max(-range, Math.min(range, g))) / (range * 2)) * innerH;
  const gainToCurveYAtScale = (g, range) => padT + ((range - g) / (range * 2)) * innerH;
  const gainToY = (g) => gainToYAtScale(g, displayScale);
  const gainToCurveY = (g) => gainToCurveYAtScale(g, displayScale);
  const gainMarkToY = (g) => gainToYAtScale(g, scale);
  const yToGain = (y) => scale - ((y - padT) / innerH) * (scale * 2);
  const yToGainAtScale = (y, range) => range - ((y - padT) / innerH) * (range * 2);
  const thresholdToDisplayGain = (threshold, range = displayScale) => {
    const normalized = (clamp(threshold, DESSER_THRESHOLD_MIN, DESSER_THRESHOLD_MAX) - DESSER_THRESHOLD_MIN) /
      (DESSER_THRESHOLD_MAX - DESSER_THRESHOLD_MIN);
    return normalized * range * 2 - range;
  };
  const thresholdFromY = (y, range = displayScale) => {
    const normalized = clamp((yToGainAtScale(y, range) + range) / (range * 2), 0, 1);
    return Number((DESSER_THRESHOLD_MIN + normalized * (DESSER_THRESHOLD_MAX - DESSER_THRESHOLD_MIN)).toFixed(1));
  };

  const normalizeBiquadCoefficients = (b0, b1, b2, a0, a1, a2) => {
    if (!Number.isFinite(a0) || Math.abs(a0) <= 0.000001) {
      return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
    }

    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0
    };
  };

  const filterFrequency = (frequency) => clamp(clampEqFrequency(frequency), minFrequency, responseSampleRate * 0.45);
  const responseFrequency = (frequency) => {
    const numeric = Number(frequency);
    const safeFrequency = Number.isFinite(numeric) && numeric > 0 ? numeric : graphMinFrequency;
    return clamp(safeFrequency, graphMinFrequency, responseSampleRate * 0.499);
  };

  const biquadGainDbAt = (coefficients, frequency) => {
    const omega = (2 * Math.PI * responseFrequency(frequency)) / responseSampleRate;
    const cos1 = Math.cos(omega);
    const sin1 = Math.sin(omega);
    const cos2 = Math.cos(2 * omega);
    const sin2 = Math.sin(2 * omega);
    const numRe = coefficients.b0 + coefficients.b1 * cos1 + coefficients.b2 * cos2;
    const numIm = -(coefficients.b1 * sin1 + coefficients.b2 * sin2);
    const denRe = 1 + coefficients.a1 * cos1 + coefficients.a2 * cos2;
    const denIm = -(coefficients.a1 * sin1 + coefficients.a2 * sin2);
    const denominator = denRe * denRe + denIm * denIm;
    if (denominator <= 0 || !Number.isFinite(denominator)) return 0;

    const magnitudeSquared = (numRe * numRe + numIm * numIm) / denominator;
    return Math.max(EQ_RESPONSE_FLOOR_DB, 10 * Math.log10(Math.max(magnitudeSquared, 1e-16)));
  };

  const peakingCoefficients = (frequency, q, gainDb) => {
    const freq = filterFrequency(frequency);
    const safeQ = clamp(q, 0.1, 50);
    const omega = (2 * Math.PI * freq) / responseSampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * safeQ);
    const a = 10 ** (gainDb / 40);

    return normalizeBiquadCoefficients(
      1 + alpha * a,
      -2 * cosOmega,
      1 - alpha * a,
      1 + alpha / a,
      -2 * cosOmega,
      1 - alpha / a
    );
  };

  const lowShelfCoefficients = (frequency, q, gainDb) => {
    const freq = filterFrequency(frequency);
    const slope = clamp(q, 0.1, 2);
    const omega = (2 * Math.PI * freq) / responseSampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const a = 10 ** (gainDb / 40);
    const twoSqrtAAlpha = 2 * Math.sqrt(a) * sinOmega * 0.5 *
      Math.sqrt(Math.max(0, (a + 1 / a) * (1 / slope - 1) + 2));

    return normalizeBiquadCoefficients(
      a * ((a + 1) - (a - 1) * cosOmega + twoSqrtAAlpha),
      2 * a * ((a - 1) - (a + 1) * cosOmega),
      a * ((a + 1) - (a - 1) * cosOmega - twoSqrtAAlpha),
      (a + 1) + (a - 1) * cosOmega + twoSqrtAAlpha,
      -2 * ((a - 1) + (a + 1) * cosOmega),
      (a + 1) + (a - 1) * cosOmega - twoSqrtAAlpha
    );
  };

  const highShelfCoefficients = (frequency, q, gainDb) => {
    const freq = filterFrequency(frequency);
    const slope = clamp(q, 0.1, 2);
    const omega = (2 * Math.PI * freq) / responseSampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const a = 10 ** (gainDb / 40);
    const twoSqrtAAlpha = 2 * Math.sqrt(a) * sinOmega * 0.5 *
      Math.sqrt(Math.max(0, (a + 1 / a) * (1 / slope - 1) + 2));

    return normalizeBiquadCoefficients(
      a * ((a + 1) + (a - 1) * cosOmega + twoSqrtAAlpha),
      -2 * a * ((a - 1) + (a + 1) * cosOmega),
      a * ((a + 1) + (a - 1) * cosOmega - twoSqrtAAlpha),
      (a + 1) - (a - 1) * cosOmega + twoSqrtAAlpha,
      2 * ((a - 1) - (a + 1) * cosOmega),
      (a + 1) - (a - 1) * cosOmega - twoSqrtAAlpha
    );
  };

  const lowPassCoefficients = (frequency, q = 0.7071) => {
    const freq = filterFrequency(frequency);
    const safeQ = clamp(q, 0.25, 4);
    const omega = (2 * Math.PI * freq) / responseSampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * safeQ);

    return normalizeBiquadCoefficients(
      (1 - cosOmega) * 0.5,
      1 - cosOmega,
      (1 - cosOmega) * 0.5,
      1 + alpha,
      -2 * cosOmega,
      1 - alpha
    );
  };

  const firstOrderLowPassCoefficients = (frequency) => {
    const freq = filterFrequency(frequency);
    const k = Math.tan(Math.PI * freq / responseSampleRate);

    return normalizeBiquadCoefficients(
      k,
      k,
      0,
      1 + k,
      k - 1,
      0
    );
  };

  const highPassCoefficients = (frequency, q = 0.7071) => {
    const freq = filterFrequency(frequency);
    const safeQ = clamp(q, 0.25, 4);
    const omega = (2 * Math.PI * freq) / responseSampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * safeQ);

    return normalizeBiquadCoefficients(
      (1 + cosOmega) * 0.5,
      -(1 + cosOmega),
      (1 + cosOmega) * 0.5,
      1 + alpha,
      -2 * cosOmega,
      1 - alpha
    );
  };

  const firstOrderHighPassCoefficients = (frequency) => {
    const freq = filterFrequency(frequency);
    const k = Math.tan(Math.PI * freq / responseSampleRate);

    return normalizeBiquadCoefficients(
      1,
      -1,
      0,
      1 + k,
      k - 1,
      0
    );
  };

  const notchCoefficients = (frequency, q) => {
    const freq = filterFrequency(frequency);
    const safeQ = clamp(q, 0.1, 50);
    const omega = (2 * Math.PI * freq) / responseSampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * safeQ);

    return normalizeBiquadCoefficients(1, -2 * cosOmega, 1, 1 + alpha, -2 * cosOmega, 1 - alpha);
  };

  const bandPassCoefficients = (frequency, q, gainDb) => {
    const freq = filterFrequency(frequency);
    const safeQ = clamp(q, 0.1, 50);
    const omega = (2 * Math.PI * freq) / responseSampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * safeQ);
    const gain = 10 ** (gainDb / 20);

    return normalizeBiquadCoefficients(alpha * gain, 0, -alpha * gain, 1 + alpha, -2 * cosOmega, 1 - alpha);
  };

  const getCutStageLayout = (slope) => {
    if (isWallSlope(slope)) {
      return { firstOrder: false, biquadStages: 8, stageCount: 8 };
    }

    const slopeDb = clamp(Math.round(Number(slope) || 12), 6, 96);
    const firstOrder = slopeDb % 12 === 6;
    const biquadStages = clamp(Math.floor(slopeDb / 12), 0, 8);
    return {
      firstOrder,
      biquadStages,
      stageCount: clamp(biquadStages + (firstOrder ? 1 : 0), 1, 8)
    };
  };
  const getCutStageCount = (slope) => getCutStageLayout(slope).stageCount;
  const getCutResonanceGain = (point, gainDb = point.gain) => clamp(Number(gainDb) || 0, 0, 30);
  const getCutResonanceFrequency = (point) => {
    const stages = Math.max(1, getCutStageCount(point.slope));
    const offsetOctaves = clamp(0.46 / Math.sqrt(stages), 0.13, 0.42);
    const ratio = 2 ** offsetOctaves;
    return point.type === 'Low Cut'
      ? clampEqFrequency(point.freq * ratio)
      : clampEqFrequency(point.freq / ratio);
  };
  const getCutResonanceQ = (point, gainDb = point.gain) => {
    const stages = Math.max(1, getCutStageCount(point.slope));
    const gain = getCutResonanceGain(point, gainDb);
    return clamp(0.9 + Math.sqrt(stages) * 0.82 + gain * 0.055, 0.7, 10);
  };
  const cutBaseGainDbAt = (point, freq) => {
    const layout = getCutStageLayout(point.slope);
    const isLowCut = point.type === 'Low Cut';
    const biquadCoefficients = isLowCut ? highPassCoefficients(point.freq) : lowPassCoefficients(point.freq);
    const firstOrderCoefficients = isLowCut ? firstOrderHighPassCoefficients(point.freq) : firstOrderLowPassCoefficients(point.freq);
    const biquadGain = layout.biquadStages > 0
      ? biquadGainDbAt(biquadCoefficients, freq) * layout.biquadStages
      : 0;
    const firstOrderGain = layout.firstOrder ? biquadGainDbAt(firstOrderCoefficients, freq) : 0;
    return Math.max(EQ_RESPONSE_FLOOR_DB, biquadGain + firstOrderGain);
  };
  const cutResonanceGainDbAt = (point, freq, gainDb = point.gain) => {
    const gain = getCutResonanceGain(point, gainDb);
    if (gain <= 0.01) return 0;
    return biquadGainDbAt(peakingCoefficients(getCutResonanceFrequency(point), getCutResonanceQ(point, gain), gain), freq);
  };
  const getFullSpectrumFadeOctaves = (point, edge = 'both') => {
    const edgeSlope = edge === 'low'
      ? point?.rangeLowSlope
      : edge === 'high'
        ? point?.rangeHighSlope
        : point?.q;
    const slope = clamp(Number(edgeSlope) || Number(point?.q) || DEFAULT_FULL_SPECTRUM_SLOPE, 0.1, 50);
    return clamp(0.82 / Math.sqrt(slope), 0.025, 1.35);
  };
  const getFullSpectrumShape = (point) => {
    const range = normalizeFullSpectrumRange(point, point.freq);
    const lowFadeOctaves = getFullSpectrumFadeOctaves(point, 'low');
    const highFadeOctaves = getFullSpectrumFadeOctaves(point, 'high');
    const lowFadeFactor = 2 ** lowFadeOctaves;
    const highFadeFactor = 2 ** highFadeOctaves;
    return {
      ...range,
      fadeOctaves: Math.max(lowFadeOctaves, highFadeOctaves),
      lowFadeOctaves,
      highFadeOctaves,
      lowFadeStart: clampEqFrequency(range.low / lowFadeFactor),
      highFadeEnd: clampEqFrequency(range.high * highFadeFactor)
    };
  };
  const fullSpectrumWeightAt = (point, freq) => {
    const shape = getFullSpectrumShape(point);
    const logFreq = Math.log10(clampEqFrequency(freq));
    const logLow = Math.log10(shape.low);
    const logHigh = Math.log10(shape.high);
    const smoothUnit = (value) => {
      const t = clamp(value, 0, 1);
      return t * t * (3 - 2 * t);
    };

    if (logFreq >= logLow && logFreq <= logHigh) return 1;

    if (logFreq < logLow) {
      const logStart = Math.log10(shape.lowFadeStart);
      if (logLow <= logStart) return logFreq >= logLow ? 1 : 0;
      return smoothUnit((logFreq - logStart) / (logLow - logStart));
    }

    const logEnd = Math.log10(shape.highFadeEnd);
    if (logEnd <= logHigh) return logFreq <= logHigh ? 1 : 0;
    return smoothUnit((logEnd - logFreq) / (logEnd - logHigh));
  };
  const fullSpectrumGainDbAt = (point, freq, gainDb = point.gain) => {
    return gainDb * fullSpectrumWeightAt(point, freq);
  };
  const fullSpectrumStackGainAt = (pts, freq) => {
    let weightedGain = 0;
    let totalWeight = 0;

    pts.forEach((point) => {
      if (point.on === false) return;
      const band = withBandDefaults(point);
      if (band.type !== FULL_SPECTRUM_TYPE) return;

      const weight = fullSpectrumWeightAt(band, freq);
      if (weight <= 0) return;

      weightedGain += weight * band.gain;
      totalWeight += weight;
    });

    if (totalWeight <= 0) return 0;
    return weightedGain / Math.max(1, totalWeight);
  };

  const bandShapeGainAt = (point, freq) => {
    const p = withBandDefaults(point);
    const q = clamp(p.q || DEFAULT_EQ_Q, ...getQRange(p));

    switch (p.type) {
      case FULL_SPECTRUM_TYPE:
        return fullSpectrumGainDbAt(p, freq);
      case 'Low Shelf':
        return biquadGainDbAt(lowShelfCoefficients(p.freq, q, p.gain), freq);
      case 'High Shelf':
        return biquadGainDbAt(highShelfCoefficients(p.freq, q, p.gain), freq);
      case 'Notch':
        return biquadGainDbAt(notchCoefficients(p.freq, q), freq);
      case 'Band Pass':
        return biquadGainDbAt(bandPassCoefficients(p.freq, q, p.gain), freq);
      case 'Low Cut': {
        const gainDb = cutBaseGainDbAt(p, freq) + cutResonanceGainDbAt(p, freq);
        return Math.max(EQ_RESPONSE_FLOOR_DB, gainDb);
      }
      case 'High Cut': {
        const gainDb = cutBaseGainDbAt(p, freq) + cutResonanceGainDbAt(p, freq);
        return Math.max(EQ_RESPONSE_FLOOR_DB, gainDb);
      }
      case DESSER_TYPE: {
        const slopeFactor = p.deessMode === 'wider' ? 1.15 : 4.7;
        const highBand = 1 / (1 + (p.freq / clampEqFrequency(freq)) ** (slopeFactor * 2));
        const thresholdDrive = 0.5 + Math.abs(p.threshold) / 120;
        const amountDb = 1.2 + (p.intensity / 100) * 16;
        return -amountDb * thresholdDrive * highBand;
      }
      case 'Bell':
        return biquadGainDbAt(peakingCoefficients(p.freq, q, p.gain), freq);
      case 'Surfer Bell':
        return biquadGainDbAt(peakingCoefficients(p.freq, clamp(q * 0.58, 0.1, 50), p.gain), freq);
      default:
        return biquadGainDbAt(peakingCoefficients(p.freq, q, p.gain), freq);
    }
  };
  const bandGainAt = (point, freq) => point.on === false ? 0 : bandShapeGainAt(point, freq);
  const nodeGainAt = (point) => {
    const p = withBandDefaults(point);
    if (p.type === DESSER_TYPE) return thresholdToDisplayGain(p.threshold);
    return CUT_TYPES.has(p.type) ? cutNodeDisplayGain(getCutResonanceGain(p)) : bandShapeGainAt(p, p.freq);
  };
  const cutLinkGainAt = (point) => {
    const p = withBandDefaults(point);
    if (!CUT_TYPES.has(p.type)) return nodeGainAt(p);

    const cutoffGain = bandShapeGainAt(p, p.freq);
    const resonanceGain = bandShapeGainAt(p, getCutResonanceFrequency(p));
    return clamp(Math.max(cutoffGain, resonanceGain, nodeGainAt(p) * 0.94), -30, 30);
  };
  const gainFromNodeGain = (point, nodeGain) => {
    const p = withBandDefaults(point);
    if (p.type === DESSER_TYPE) return 0;
    if (CUT_TYPES.has(p.type)) return cutGainFromNodeDisplayGain(nodeGain);
    if (p.type === 'Low Shelf' || p.type === 'High Shelf') return nodeGain * 2;
    if (p.type === 'Notch') return Math.abs(nodeGain);
    return nodeGain;
  };

  const getDisplayPoints = (pts, modeKey) => (
    pts.map((point, index) => {
      const band = withBandDefaults(point);
      const visualFreq = surferVisualFreqs[modeKey]?.[index];

      if (band.type !== 'Surfer Bell' || !Number.isFinite(visualFreq)) return band;

      return {
        ...band,
        anchorFreq: band.freq,
        freq: clampEqFrequency(visualFreq),
        isSurfing: Math.abs(clampEqFrequency(visualFreq) - band.freq) > 0.5
      };
    })
  );

  const preDisplayPoints = getDisplayPoints(prePoints, 'pre');
  const postDisplayPoints = getDisplayPoints(postPoints, 'post');
  const displayPoints = mode === 'pre' ? preDisplayPoints : postDisplayPoints;

  // Full Spectrum bands behave like adjacent multiband zones: their crossfades blend instead of stacking.
  const totalGain = (pts, f) => (
    fullSpectrumStackGainAt(pts, f) +
    pts.reduce((acc, p) => (
      getBandType(p) === FULL_SPECTRUM_TYPE ? acc : acc + bandGainAt(p, f)
    ), 0)
  );
  const cutIsolationWeight = (cutGain) => {
    const attenuation = Math.abs(Math.min(0, cutGain));
    if (attenuation <= 0.65) return 1;
    if (attenuation >= 5.0) return 0;
    const t = clamp((attenuation - 0.65) / 4.35, 0, 1);
    return 1 - t * t * (3 - 2 * t);
  };
  const totalDisplayGain = (pts, f) => {
    let cutGain = 0;
    let tonalGain = 0;
    let strongestCutGain = 0;

    pts.forEach((point) => {
      if (point.on === false) return;
      const band = withBandDefaults(point);
      if (band.type === FULL_SPECTRUM_TYPE) return;

      const gain = bandShapeGainAt(band, f);

      if (CUT_TYPES.has(band.type)) {
        cutGain += gain;
        strongestCutGain = Math.min(strongestCutGain, gain);
        return;
      }

      tonalGain += gain;
    });

    tonalGain += fullSpectrumStackGainAt(pts, f);
    return cutGain + tonalGain * cutIsolationWeight(strongestCutGain);
  };
  const buildFrequencySamples = (pts, samples = 420) => {
    const frequencies = [];
    const addFrequency = (freq) => {
      const clamped = clamp(Number(freq) || minFrequency, graphMinFrequency, maxFrequency);
      frequencies.push(clamped);
    };

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      addFrequency(graphMinFrequency * Math.pow(maxFrequency / graphMinFrequency, t));
    }

    pts.forEach((point) => {
      const band = withBandDefaults(point);
      if (band.on === false) return;

      if (band.type === FULL_SPECTRUM_TYPE) {
        const shape = getFullSpectrumShape(band);
        addFrequency(shape.lowFadeStart);
        addFrequency(shape.low);
        addFrequency(shape.center);
        addFrequency(shape.high);
        addFrequency(shape.highFadeEnd);
        return;
      }

      if (!CUT_TYPES.has(band.type)) return;

      [0.45, 0.62, 0.78, 0.90, 0.96, 0.985, 0.997, 1, 1.003, 1.015, 1.04, 1.11, 1.28, 1.62]
        .forEach((ratio) => addFrequency(band.freq * ratio));
      const resonanceFrequency = getCutResonanceFrequency(band);
      const resonanceSpread = 2 ** clamp(0.52 / getCutResonanceQ(band), 0.045, 0.28);
      addFrequency(resonanceFrequency / resonanceSpread);
      addFrequency(resonanceFrequency);
      addFrequency(resonanceFrequency * resonanceSpread);
    });

    return frequencies
      .sort((a, b) => a - b)
      .filter((freq, index, list) => index === 0 || Math.abs(freqToX(freq) - freqToX(list[index - 1])) > 0.12);
  };
  const buildFloorClippedPath = (samplePoints) => {
    const floorY = padT + innerH - 0.5;
    let path = '';
    let drawing = false;
    let previous = null;

    const format = (value) => (Math.round(value * 100) / 100).toString();
    const appendMove = (point) => {
      path += `${path ? ' ' : ''}M ${format(point.x)} ${format(point.y)}`;
      drawing = true;
    };
    const appendLine = (point) => {
      path += ` L ${format(point.x)} ${format(point.y)}`;
    };
    const floorIntersection = (from, to) => {
      const t = (floorY - from.y) / (to.y - from.y || 1);
      return {
        x: from.x + (to.x - from.x) * clamp(t, 0, 1),
        y: floorY
      };
    };

    samplePoints.forEach((point) => {
      const current = {
        x: point.x,
        y: Math.min(point.y, floorY)
      };
      const visible = point.y < floorY - 0.1;

      if (visible) {
        if (!drawing) {
          if (previous && previous.y > floorY) appendMove(floorIntersection(previous, point));
          else appendMove(current);
        }
        appendLine(current);
      } else if (drawing) {
        if (previous) appendLine(floorIntersection(previous, point));
        drawing = false;
      }

      previous = point;
    });

    return path;
  };

  // Build smooth curve sampled across freq range
  const buildSampledCurve = (pts) => {
    const hasCut = pts.some((p) => p.on !== false && CUT_TYPES.has(getBandType(p)));
    const frequencies = buildFrequencySamples(pts, hasCut ? 520 : 260);
    const samplePoints = frequencies.map((f) => {
      const g = hasCut ? totalDisplayGain(pts, f) : totalGain(pts, f);
      return {
        x: freqToX(f),
        y: hasCut ? gainToCurveY(g) : gainToY(g)
      };
    });

    if (hasCut) return buildFloorClippedPath(samplePoints);

    return samplePoints.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  };

  // Build per-band curve (filled)
  const buildBandCurve = (pts, idx) => {
    if (!pts[idx]) return { line: '', fill: '', isCut: false };
    const p = withBandDefaults(pts[idx]);
    const isCut = CUT_TYPES.has(p.type);
    const frequencies = buildFrequencySamples([p], isCut ? 440 : 180);
    const samplePoints = frequencies.map((f) => {
      const g = bandShapeGainAt(p, f);
      return {
        x: freqToX(f),
        y: isCut ? gainToCurveY(g) : gainToY(g)
      };
    });
    const line = isCut
      ? buildFloorClippedPath(samplePoints)
      : samplePoints.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const baseY = gainToY(0);
    const fill = isCut ? '' : `${line} L ${padL + innerW} ${baseY} L ${padL} ${baseY} Z`;
    return { line, fill, isCut };
  };

  const buildCompMirrorCurve = (point, includeMuted = false) => {
    const source = withBandDefaults(point);
    const mirrorGain = clamp(Number(source.comp) || 0, -scale, scale);
    const hasTarget = Math.abs(mirrorGain - (Number(source.gain) || 0)) > 0.05;
    if ((!includeMuted && !bandHasDynamics(source)) || !hasTarget) {
      return { line: '', fill: '', active: false };
    }

    const mirrorPoint = { ...source, gain: mirrorGain };
    const samples = 200;
    const sourcePts = [];
    const mirrorPts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const lf = Math.log10(graphMinFrequency) + t * frequencyRangeLog;
      const f = Math.pow(10, lf);
      const x = padL + t * innerW;
      sourcePts.push({ x, y: gainToY(bandShapeGainAt(source, f)) });
      mirrorPts.push({ x, y: gainToY(bandShapeGainAt(mirrorPoint, f)) });
    }

    const line = mirrorPts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    const fill = `${line} ${sourcePts.slice().reverse().map((pt) => `L ${pt.x} ${pt.y}`).join(' ')} Z`;
    return { line, fill, active: true };
  };

  const buildCompMotionCurve = (point, engagement) => {
    const source = withBandDefaults(point);
    const amount = clamp(Number(engagement) || 0, 0, 1);
    if (!bandHasDynamics(source) || amount <= 0.003) {
      return { line: '', fill: '', active: false, cx: 0, cy: 0 };
    }

    const liveGain = source.gain + (source.comp - source.gain) * amount;
    const livePoint = { ...source, gain: liveGain };
    const samples = 200;
    const sourcePts = [];
    const livePts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const lf = Math.log10(graphMinFrequency) + t * frequencyRangeLog;
      const f = Math.pow(10, lf);
      const x = padL + t * innerW;
      sourcePts.push({ x, y: gainToY(bandShapeGainAt(source, f)) });
      livePts.push({ x, y: gainToY(bandShapeGainAt(livePoint, f)) });
    }

    const line = livePts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    const fill = `${line} ${sourcePts.slice().reverse().map((pt) => `L ${pt.x} ${pt.y}`).join(' ')} Z`;
    return {
      line,
      fill,
      active: true,
      cx: freqToX(livePoint.freq),
      cy: gainToY(nodeGainAt(livePoint))
    };
  };

  const getGraphPointer = (e) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const sy = (e.clientY - rect.top) * (H / rect.height);
    if (sx < padL || sx > padL + innerW || sy < padT || sy > padT + innerH) return null;
    return { sx, sy };
  };
  const getNodeIndexAtGraphPoint = (sx, sy, radius = 20) => {
    const hitRadius = radius;
    return points.findIndex((point, index) => {
      const sourceBand = withBandDefaults(point);
      const visualBand = displayPoints[index] ? withBandDefaults(displayPoints[index]) : sourceBand;
      const liveX = freqToX(visualBand.freq);
      const liveY = gainToY(nodeGainAt(visualBand));

      if (Math.hypot(sx - liveX, sy - liveY) <= hitRadius) return true;

      const isSurfing = sourceBand.type === 'Surfer Bell' && Math.abs(visualBand.freq - sourceBand.freq) > 0.5;
      if (!isSurfing) return false;

      const anchorX = freqToX(sourceBand.freq);
      const anchorY = gainToY(nodeGainAt(sourceBand));
      return Math.hypot(sx - anchorX, sy - anchorY) <= hitRadius;
    });
  };
  const canCreateBandFromCurvePoint = (sx, sy, sourceIdx = null) => {
    if (getNodeIndexAtGraphPoint(sx, sy, 12) >= 0) return false;

    const freq = clampEqFrequency(xToFreq(sx));
    const type = getCreatedFilterType(freq);
    if (!canUseFilterType(type, null, points)) return false;

    const hasCut = displayPoints.some((p) => p.on !== false && CUT_TYPES.has(getBandType(p)));
    const totalY = gainToY(hasCut ? totalDisplayGain(displayPoints, freq) : totalGain(displayPoints, freq));
    if (Math.abs(sy - totalY) <= 24) return true;

    if (sourceIdx === null || sourceIdx === undefined || !displayPoints[sourceIdx]) return false;
    const sourceBand = withBandDefaults(displayPoints[sourceIdx]);
    if (CUT_TYPES.has(sourceBand.type)) return false;

    const bandY = gainToY(bandShapeGainAt(sourceBand, freq));
    return Math.abs(sy - bandY) <= 24;
  };
  const armCurveBandCreate = (event, sx, sy, sourceIdx = null) => {
    curveCreateRef.current = {
      sourceIdx,
      sx,
      sy,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId
    };
  };
  const blocksBackgroundCreate = (target) => Boolean(
    target.closest?.('.eq-scale-wrap, .eq-node-hit, .eq-surf-ghost-hit, .eq-comp-arrow, .eq-band-fill, .eq-band-line, .eq-full-range-hit, .eq-full-junction-hit, .eq-full-junction-detach')
  );
  const createBandAtGraphPoint = (sx, sy, { startDrag = false, event = null } = {}) => {
    const f = clampEqFrequency(xToFreq(sx));
    const type = getCreatedFilterType(f);
    if (!canUseFilterType(type, null, points)) {
      const existingIdx = points.findIndex((point) => getBandType(point) === type);
      if (existingIdx >= 0) setActiveIdx(existingIdx);
      return;
    }
    const q = getDefaultQForType(type);
    const slope = getDefaultSlopeForType(type);
    const g = gainFromNodeGain({ freq: f, type, q, slope }, yToGain(sy));
    const created = withBandDefaults({
      freq: Math.round(f),
      gain: Number(clamp(g, -30, 30).toFixed(1)),
      q,
      comp: Number(clamp(g, -30, 30).toFixed(1)),
      compEnabled: false,
      type,
      slope,
      on: true,
      placement: 'stereo',
      ...(type === 'Surfer Bell' && getSurfRatio(f) ? { surfRatio: getSurfRatio(f) } : {})
    });
    const newPts = [...points, created];
    newPts.sort((a, b) => a.freq - b.freq);
    latestPointsRef.current = newPts;
    setPoints(newPts);
    const newIdx = newPts.findIndex(p => p === created);
    setActiveIdx(newIdx);
    setScale?.(getNeededEqRange(newPts));
    if (startDrag) {
      setDragIdx(newIdx);
      setDragMode('node');
      if (Number.isFinite(event?.pointerId)) event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const onSvgPointerDown = (e) => {
    if (e.target.closest?.('.eq-scale-wrap')) return;
    const pointer = getGraphPointer(e);
    if (!pointer) return;

    if (Math.abs(pointer.sy - baseY) <= 8 && !blocksBackgroundCreate(e.target)) {
      createBandAtGraphPoint(pointer.sx, baseY, { startDrag: true, event: e });
      return;
    }

    const nearNodeIdx = getNodeIndexAtGraphPoint(pointer.sx, pointer.sy);
    if (nearNodeIdx >= 0) {
      setActiveIdx(nearNodeIdx);
      return;
    }

    if (blocksBackgroundCreate(e.target)) return;
    if (canCreateBandFromCurvePoint(pointer.sx, pointer.sy)) {
      armCurveBandCreate(e, pointer.sx, pointer.sy);
      setTypeOpen(false);
      return;
    }
    if (Math.abs(pointer.sy - baseY) > 8) return;

    createBandAtGraphPoint(pointer.sx, baseY, { startDrag: true, event: e });
  };
  const onSvgDoubleClick = (e) => {
    if (blocksBackgroundCreate(e.target)) return;
    const pointer = getGraphPointer(e);
    if (!pointer) return;

    const nearNodeIdx = getNodeIndexAtGraphPoint(pointer.sx, pointer.sy);
    if (nearNodeIdx >= 0) {
      setActiveIdx(nearNodeIdx);
      return;
    }

    e.preventDefault();
    createBandAtGraphPoint(pointer.sx, pointer.sy);
  };
  const onBandSelectDown = (idx) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    const pointer = getGraphPointer(e);
    if (pointer && Math.abs(pointer.sy - baseY) <= 8) {
      createBandAtGraphPoint(pointer.sx, baseY, { startDrag: true, event: e });
      return;
    }
    if (pointer && canCreateBandFromCurvePoint(pointer.sx, pointer.sy, idx)) {
      armCurveBandCreate(e, pointer.sx, pointer.sy, idx);
      setActiveIdx(idx);
      setTypeOpen(false);
      return;
    }

    setActiveIdx(idx);
    setTypeOpen(false);
  };
  const onFullRangeHandleDown = (idx, edge) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveIdx(idx);
    setDragIdx(idx);
    setDragMode(edge === 'low' ? 'rangeLow' : 'rangeHigh');
    setTypeOpen(false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const applyFullSpectrumJunctionEdit = (sourcePts, junction, edgeFrequency, { slopeMultiplier = 1, startSlopes = null } = {}) => {
    const nextPts = [...sourcePts];
    const touched = new Set();

    junction.edges.forEach((junctionEdge) => {
      const point = nextPts[junctionEdge.idx];
      if (!point) return;
      const current = withBandDefaults(point);
      if (current.type !== FULL_SPECTRUM_TYPE) return;

      const patch = junctionEdge.edge === 'low'
        ? { rangeLow: Math.min(edgeFrequency, current.rangeHigh / FULL_SPECTRUM_MIN_RATIO) }
        : { rangeHigh: Math.max(edgeFrequency, current.rangeLow * FULL_SPECTRUM_MIN_RATIO) };
      const updated = {
        ...point,
        ...getFullSpectrumRangePatch(current, patch)
      };
      const slopeField = getFullSpectrumEdgeSlopeField(junctionEdge.edge);
      const slopeKey = fullSpectrumEdgeKey(junctionEdge.idx, junctionEdge.edge);
      const startSlope = startSlopes?.[slopeKey] ?? getFullSpectrumEdgeSlope(current, junctionEdge.edge);
      if (Number.isFinite(slopeMultiplier) && Math.abs(slopeMultiplier - 1) > 0.0001) {
        updated[slopeField] = Number(clamp(startSlope * slopeMultiplier, 0.1, 50).toFixed(2));
      }

      const updatedBand = withBandDefaults(updated);
      nextPts[junctionEdge.idx] = updatedBand;
      touched.add(updatedBand);
    });

    nextPts.sort((a, b) => a.freq - b.freq);
    return { nextPts, touched };
  };
  const commitFullSpectrumJunctionEdit = (junction, edgeFrequency, options = {}) => {
    const sourcePts = latestPointsRef.current.length ? latestPointsRef.current : points;
    const { nextPts, touched } = applyFullSpectrumJunctionEdit(sourcePts, junction, edgeFrequency, options);
    const selectedIdx = nextPts.findIndex((point) => touched.has(point));

    latestPointsRef.current = nextPts;
    setPoints(nextPts);
    setActiveIdx(selectedIdx >= 0 ? selectedIdx : junction.edges[0]?.idx ?? null);
    return nextPts;
  };
  const onFullSpectrumJunctionDown = (junction) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startSlopes = {};
    junction.edges.forEach((edge) => {
      startSlopes[fullSpectrumEdgeKey(edge.idx, edge.edge)] = edge.slope;
    });
    setActiveIdx(junction.edges[0]?.idx ?? null);
    setDragIdx(junction.edges[0]?.idx ?? null);
    setDragMode('fullJunction');
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      junction,
      startSlopes
    };
    setTypeOpen(false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onFullSpectrumJunctionWheel = (junction) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const multiplier = Math.exp(-e.deltaY / (e.shiftKey || e.altKey ? 540 : 220));
    const startSlopes = {};
    junction.edges.forEach((edge) => {
      startSlopes[fullSpectrumEdgeKey(edge.idx, edge.edge)] = edge.slope;
    });
    commitFullSpectrumJunctionEdit(junction, junction.freq, { slopeMultiplier: multiplier, startSlopes });
  };
  const detachFullSpectrumJunction = (junction) => {
    const sourcePts = latestPointsRef.current.length ? latestPointsRef.current : points;
    const nextPts = [...sourcePts];
    const boundaryX = freqToX(junction.freq);
    const highEdges = junction.edges.filter((edge) => edge.edge === 'high');
    const lowEdges = junction.edges.filter((edge) => edge.edge === 'low');
    const touched = new Set();
    const moveEdge = (junctionEdge, x) => {
      const point = nextPts[junctionEdge.idx];
      if (!point) return;
      const current = withBandDefaults(point);
      if (current.type !== FULL_SPECTRUM_TYPE) return;

      const targetFreq = clampEqFrequency(xToFreq(clamp(x, padL, padL + innerW)));
      const patch = junctionEdge.edge === 'low'
        ? { rangeLow: Math.min(targetFreq, current.rangeHigh / FULL_SPECTRUM_MIN_RATIO) }
        : { rangeHigh: Math.max(targetFreq, current.rangeLow * FULL_SPECTRUM_MIN_RATIO) };
      const updatedBand = withBandDefaults({
        ...point,
        ...getFullSpectrumRangePatch(current, patch)
      });
      nextPts[junctionEdge.idx] = updatedBand;
      touched.add(updatedBand);
    };

    highEdges.forEach((edge, index) => moveEdge(edge, boundaryX - FULL_SPECTRUM_DETACH_PX * (index + 1)));
    lowEdges.forEach((edge, index) => moveEdge(edge, boundaryX + FULL_SPECTRUM_DETACH_PX * (index + 1)));

    nextPts.sort((a, b) => a.freq - b.freq);
    latestPointsRef.current = nextPts;
    setPoints(nextPts);
    setActiveIdx(nextPts.findIndex((point) => touched.has(point)));
    setScale?.(getNeededEqRange(nextPts));
  };
  const onFullSpectrumJunctionDetach = (junction) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    detachFullSpectrumJunction(junction);
  };

  const onNodeDown = (idx) => (e) => {
    e.stopPropagation();
    setActiveIdx(idx);
    setDragIdx(idx);
    setDragMode('node');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onSurferGhostDown = (idx, liveFrequency) => (e) => {
    e.stopPropagation();
    e.preventDefault();

    const currentPoints = latestPointsRef.current.length ? latestPointsRef.current : points;
    const sourcePoint = currentPoints[idx];
    if (!sourcePoint) return;

    const frozenFrequency = clampEqFrequency(liveFrequency);
    const frozen = withBandDefaults({
      ...sourcePoint,
      freq: frozenFrequency,
      type: 'Surfer Bell'
    });
    const ratio = getSurfRatio(frozenFrequency);
    if (ratio) frozen.surfRatio = ratio;
    else frozen.surfRatio = 0;

    const nextPts = [...currentPoints];
    nextPts[idx] = frozen;
    nextPts.sort((a, b) => a.freq - b.freq);
    const nextIdx = nextPts.indexOf(frozen);
    const normalizedIdx = nextIdx === -1 ? idx : nextIdx;

    latestPointsRef.current = nextPts;
    setPoints(nextPts);
    setActiveIdx(normalizedIdx);
    setDragIdx(normalizedIdx);
    setDragMode('node');
    setTypeOpen(false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onCompDown = (idx, direction) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    const currentPoints = latestPointsRef.current.length ? latestPointsRef.current : points;
    if (!currentPoints[idx]) return;
    const current = withBandDefaults(currentPoints[idx]);
    if (!current || !supportsBandDynamics(current)) return;

    const arrowDirection = direction >= 0 ? 1 : -1;
    let dragComp = Number(current.comp) || 0;
    if (!bandHasCompressionTarget(current)) {
      const next = [...currentPoints];
      const baseGain = Number(current.gain) || 0;
      const initialStep = Math.max(1.2, Math.min(6, Math.abs(baseGain) * 0.45 || 2.5));
      dragComp = Number(clamp(baseGain + arrowDirection * initialStep, -30, 30).toFixed(1));
      next[idx] = withBandDefaults({
        ...currentPoints[idx],
        comp: dragComp,
        compEnabled: Math.abs(dragComp - baseGain) > 0.05
      });
      latestPointsRef.current = next;
      setPoints(next);
      if (Math.abs(dragComp) > scale) setScale?.(30);
    } else if (!current.compEnabled) {
      const next = [...currentPoints];
      next[idx] = withBandDefaults({
        ...currentPoints[idx],
        compEnabled: true
      });
      latestPointsRef.current = next;
      setPoints(next);
    }

    setActiveIdx(idx);
    setDragIdx(idx);
    setDragMode('comp');
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      q: current.q || DEFAULT_EQ_Q, comp: dragComp,
      direction: arrowDirection,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onNodeWheel = (idx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const np = [...points];
    const p = withBandDefaults(np[idx]);
    if (p.type === DESSER_TYPE) {
      p.intensity = Math.round(clamp(p.intensity + (e.deltaY < 0 ? 4 : -4), 0, 100));
    } else if (CUT_TYPES.has(p.type)) {
      const options = getSlopeOptions(p.type);
      const currentIndex = getSlopeIndex(p.slope, p.type);
      const nextIndex = clamp(currentIndex + (e.deltaY < 0 ? 1 : -1), 0, options.length - 1);
      p.slope = options[nextIndex];
    } else {
      p.q = clamp((p.q || DEFAULT_EQ_Q) * Math.exp(-e.deltaY / 200), ...getQRange(p));
      if (p.type === FULL_SPECTRUM_TYPE) {
        p.rangeLowSlope = p.q;
        p.rangeHighSlope = p.q;
      }
    }
    np[idx] = p;
    setPoints(np);
    setActiveIdx(idx);
  };
  const onCompWheel = (idx) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const currentPoints = latestPointsRef.current.length ? latestPointsRef.current : points;
    if (!currentPoints[idx]) return;
    const current = withBandDefaults(currentPoints[idx]);
    if (!supportsBandDynamics(current)) return;

    const baseGain = Number(current.gain) || 0;
    const currentComp = bandHasCompressionTarget(current) ? Number(current.comp) || 0 : baseGain;
    const comp = adjustWheelValue(currentComp, { min: -30, max: 30, step: e.shiftKey || e.altKey ? 0.1 : 0.5, event: e });
    applyPointPatch(idx, {
      comp,
      compEnabled: Math.abs(comp - baseGain) > 0.05
    }, { resort: false, updateRange: true });
  };
  const onNodeContext = (idx) => (e) => {
    e.preventDefault();
    if (points.length <= 0) return;
    const np = points.filter((_, i) => i !== idx);
    setPoints(np);
    if (activeIdx === idx) setActiveIdx(null);
  };

  const onMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const sy = (e.clientY - rect.top) * (H / rect.height);
    const inGraph = sx >= padL && sx <= padL + innerW && sy >= padT && sy <= padT + innerH;
    const overExistingNode = Boolean(e.target.closest?.('.eq-node-hit, .eq-surf-ghost-hit, .eq-comp-arrow, .eq-full-range-hit, .eq-full-junction-hit, .eq-full-junction-detach'));
    setHoverPoint(inGraph && !overExistingNode ? { x: clamp(sx, padL, padL + innerW), y: clamp(sy, padT, padT + innerH) } : null);
    const pendingCurveCreate = curveCreateRef.current;
    if (pendingCurveCreate && dragIdx === null && dragMode === null) {
      const movedPx = Math.hypot(e.clientX - pendingCurveCreate.clientX, e.clientY - pendingCurveCreate.clientY);
      if (movedPx >= 4) {
        curveCreateRef.current = null;
        createBandAtGraphPoint(
          clamp(sx, padL, padL + innerW),
          clamp(sy, padT, padT + innerH),
          { startDrag: true, event: e }
        );
      }
      return;
    }
    if (dragIdx === null || dragMode === null) return;
    const heldDragVisual = dragVisualHoldRef.current;
    if (dragMode === 'node' && heldDragVisual && heldDragVisual.idx === dragIdx) {
      if (!heldDragVisual.releaseReady) return;
      setNodeVisualHold(null);
    }

    const sourcePoints = latestPointsRef.current.length ? latestPointsRef.current : points;
    const newPts = [...sourcePoints];
    if (dragMode === 'fullJunction') {
      const junction = dragRef.current.junction;
      if (!junction) return;
      const dy = e.clientY - dragRef.current.startY;
      const slopeMultiplier = Math.abs(dy) > 2 ? Math.exp(-dy / 175) : 1;
      const { nextPts, touched } = applyFullSpectrumJunctionEdit(sourcePoints, junction, clampEqFrequency(xToFreq(sx)), {
        slopeMultiplier,
        startSlopes: dragRef.current.startSlopes
      });
      const nextIdx = nextPts.findIndex((point) => touched.has(point));

      commitDragPoints(nextPts);
      if (nextIdx !== -1) {
        setDragIdx(nextIdx);
        setActiveIdx(nextIdx);
      }
      return;
    }
    if (!newPts[dragIdx]) return;
    const p = { ...newPts[dragIdx] };

    if (dragMode === 'rangeLow' || dragMode === 'rangeHigh') {
      const current = withBandDefaults(p);
      if (current.type !== FULL_SPECTRUM_TYPE) return;

      const edgeFrequency = clampEqFrequency(xToFreq(sx));
      const snappedEdge = getFullSpectrumSnap(edgeFrequency, sourcePoints, dragIdx, dragMode === 'rangeLow' ? 'low' : 'high');
      const snappedEdgeFrequency = snappedEdge ? snappedEdge.freq : edgeFrequency;
      const patch = dragMode === 'rangeLow'
        ? getFullSpectrumRangePatch(current, {
          rangeLow: Math.min(snappedEdgeFrequency, current.rangeHigh / FULL_SPECTRUM_MIN_RATIO)
        })
        : getFullSpectrumRangePatch(current, {
          rangeHigh: Math.max(snappedEdgeFrequency, current.rangeLow * FULL_SPECTRUM_MIN_RATIO)
        });

      Object.assign(p, patch);
      newPts[dragIdx] = p;
      newPts.sort((a, b) => a.freq - b.freq);
      const newIdx = newPts.findIndex(pp => pp === p);
      commitDragPoints(newPts);
      if (newIdx !== -1) {
        setDragIdx(newIdx);
        setActiveIdx(newIdx);
      }
    } else if (dragMode === 'node') {
      const current = withBandDefaults(p);
      if (current.type === DESSER_TYPE) {
        p.freq = Math.round(clamp(xToFreq(sx), DESSER_FREQ_MIN, DESSER_FREQ_MAX));
        p.type = current.type;
        p.slope = current.slope;
        p.on = current.on;
        p.placement = current.placement;
        p.gain = 0;
        p.q = current.q;
        p.comp = current.comp;
        p.deessMode = current.deessMode;
        p.threshold = thresholdFromY(sy);
        p.intensity = current.intensity;
        newPts[dragIdx] = p;
        newPts.sort((a, b) => a.freq - b.freq);
        const newIdx = newPts.findIndex(pp => pp === p);
        commitDragPoints(newPts);
        if (newIdx !== -1) {
          setDragIdx(newIdx);
          setActiveIdx(newIdx);
        }
        return;
      }
      const rawNodeGainAtTwelve = yToGainAtScale(sy, 12);
      const shouldExpandForRange = scale > 12 || Math.abs(rawNodeGainAtTwelve) > 12;
      const shouldExpandForDock = scale <= 12 && Math.abs(rawNodeGainAtTwelve) > dockAutoRangeDb;
      const shouldExpand = (shouldExpandForRange || shouldExpandForDock);
      const nextRange = shouldExpand ? 30 : scale;
      const nodeGain = shouldExpandForRange
        ? yToGainAtScale(sy, 30)
        : shouldExpandForDock
          ? rawNodeGainAtTwelve
          : yToGain(sy);
      p.freq = clampEqFrequency(xToFreq(sx));
      p.type = current.type;
      p.slope = current.slope;
      p.on = current.on;
      p.placement = current.placement;
      if (current.type === FULL_SPECTRUM_TYPE) {
        const movedPatch = shiftFullSpectrumRange(current, p.freq);
        Object.assign(p, snapFullSpectrumMovePatch(current, movedPatch, sourcePoints, dragIdx));
      }
      p.gain = Number(clamp(gainFromNodeGain(current, nodeGain), CUT_TYPES.has(current.type) ? 0 : -30, 30).toFixed(1));
      if (!bandHasCompressionTarget(current) && supportsBandDynamics(p)) {
        p.comp = p.gain;
        p.compEnabled = false;
      }
      if (current.type === 'Surfer Bell') {
        const ratio = getSurfRatio(p.freq);
        if (ratio) p.surfRatio = ratio;
        else p.surfRatio = 0;
      }
      newPts[dragIdx] = p;
      newPts.sort((a, b) => a.freq - b.freq);
      const newIdx = newPts.findIndex(pp => pp === p);
      const holdDockVisual = shouldExpandForDock && nextRange === 30 && scale !== 30 && newIdx !== -1
        ? {
          idx: newIdx,
          x: clamp(sx, padL, padL + innerW),
          y: clamp(sy, padT, padT + innerH),
          releaseReady: false
        }
        : null;
      commitDragPoints(newPts);
      if (nextRange !== scale) {
        setScale?.(nextRange);
      }
      if (newIdx !== -1) {
        setDragIdx(newIdx);
        setActiveIdx(newIdx);
        if (holdDockVisual) setNodeVisualHold(holdDockVisual);
      }
    } else if (dragMode === 'comp') {
      const current = withBandDefaults(p);
      if (!supportsBandDynamics(current)) return;
      const signedComp = clamp(yToGain(sy), -scale, scale);
      p.comp = Number(signedComp.toFixed(1));
      p.compEnabled = Math.abs(p.comp - (Number(current.gain) || 0)) > 0.05;
      newPts[dragIdx] = p;
      commitDragPoints(newPts);
    }
  };

  const onUp = () => {
    curveCreateRef.current = null;
    setNodeVisualHold(null);
    flushDragPoints();
    if (dragIdx !== null && (dragMode === 'node' || dragMode === 'fullJunction')) {
      setScale?.(getNeededEqRange(latestPointsRef.current));
    }
    setDragIdx(null);
    setDragMode(null);
  };

  const baseY = gainToY(0);
  const activeFillId = mode === 'pre' ? 'preFill' : 'postFill';
  const activeColor = mode === 'pre' ? 'var(--curve-pre)' : 'var(--curve-post)';
  const soloDimColor = 'var(--ink-4)';
  const hasSoloedBand = points.some((point) => withBandDefaults(point).solo);
  const isBandSoloDimmed = (idx, fallbackPoint = null) => {
    if (!hasSoloedBand) return false;
    const source = points[idx] || fallbackPoint;
    return source ? !withBandDefaults(source).solo : false;
  };
  const activeHasCut = displayPoints.some((p) => p.on !== false && CUT_TYPES.has(getBandType(p)));
  const activeFillFocusY = (() => {
    const selectedBand = activeIdx !== null && activeIdx !== undefined && displayPoints[activeIdx]
      ? withBandDefaults(displayPoints[activeIdx])
      : null;
    if (selectedBand && !CUT_TYPES.has(selectedBand.type)) return gainToY(nodeGainAt(selectedBand));
    if (activeHasCut) return padT + innerH;

    const strongestBandY = displayPoints
      .map((point) => withBandDefaults(point))
      .filter((point) => !CUT_TYPES.has(point.type))
      .map((point) => gainToY(nodeGainAt(point)))
      .reduce((strongest, y) => (
        Math.abs(y - baseY) > Math.abs(strongest - baseY) ? y : strongest
      ), baseY - 1);

    return Math.abs(strongestBandY - baseY) < 1 ? baseY - 1 : strongestBandY;
  })();

  const bandColor = (idx = null, fallbackPoint = null) => (
    isBandSoloDimmed(idx, fallbackPoint) ? soloDimColor : activeColor
  );
  const bandFillId = (idx) => `${gradientUid}-eq-band-fill-${mode}-${idx}`;
  const compMirrorFillId = (idx) => `${gradientUid}-eq-comp-fill-${mode}-${idx}`;
  const spectrumFillId = `${gradientUid}-eq-spectrum-fill-${mode}`;
  const graphClipId = `${gradientUid}-eq-graph-clip-${mode}`;
  const centerGlowId = `${gradientUid}-eq-center-glow-${mode}`;
  const gridOvalGradientId = `${gradientUid}-eq-grid-oval-${mode}`;
  const gridOvalMaskId = `${gradientUid}-eq-grid-mask-${mode}`;

  const gainMarks = React.useMemo(() => {
    const step = scale <= 3 ? 1 : scale <= 6 ? 2 : scale <= 12 ? 3 : 6;
    const marks = [];
    for (let g = -scale; g <= scale; g += step) marks.push(g);
    return marks;
  }, [scale]);
  const dbLabelMarks = React.useMemo(() => {
    const step = scale >= 30 ? 10 : scale <= 3 ? 1 : 3;
    const marks = [];
    for (let g = -scale; g < scale; g += step) {
      const rounded = Math.round(g * 10) / 10;
      if (Math.abs(rounded) <= scale) marks.push(rounded);
    }
    if (!marks.includes(0)) marks.push(0);
    return marks.sort((a, b) => b - a);
  }, [scale]);

  const freqMarks = React.useMemo(() => {
    const candidates = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const marks = candidates.filter((value) => value <= maxFrequency);
    const roundedMax = Math.round(maxFrequency);
    if (!marks.includes(roundedMax)) marks.push(roundedMax);
    return marks.sort((a, b) => a - b);
  }, [maxFrequency]);
  const metricFreqMarks = React.useMemo(() => {
    const marks = new Set();
    const decadeMin = Math.floor(Math.log10(graphMinFrequency));
    const decadeMax = Math.floor(Math.log10(maxFrequency));
    const decades = new Set();
    for (let exp = decadeMin; exp <= decadeMax; exp += 1) {
      decades.add(Math.pow(10, exp));
    }

    decades.forEach((decade) => {
      for (let coef = 1; coef <= 9; coef += 1) {
        const value = Math.round(coef * decade);
        if (value < graphMinFrequency || value > maxFrequency) continue;
        marks.add(value);
      }
    });

    marks.add(graphMinFrequency);
    marks.add(minFrequency);
    marks.add(Math.round(maxFrequency));
    return Array.from(marks).sort((a, b) => a - b);
  }, [graphMinFrequency, maxFrequency, minFrequency]);
  const majorFreqMarks = React.useMemo(() => {
    const marks = [graphMinFrequency, minFrequency, 100, 1000, 10000, maxFrequency];
    const roundedMax = Math.round(maxFrequency);
    if (!marks.includes(roundedMax)) marks.push(roundedMax);
    return new Set(marks.filter((value) => value >= graphMinFrequency && value <= maxFrequency));
  }, [graphMinFrequency, maxFrequency, minFrequency]);
  const dbAxisX = padL + innerW - 32;
  const formatDbLabel = (value) => {
    const rounded = Math.round(value * 10) / 10;
    const label = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
    return rounded > 0 ? `+${label}` : label;
  };
  const isDarkMode = document.body?.dataset?.mode === 'dark';
  const spectrumRgb = isDarkMode ? '214,218,228' : '38,49,64';
  const spectrumStroke = `rgba(${spectrumRgb},${isDarkMode ? 0.42 : 0.34})`;
  const eqGridStroke = (alpha, tone = 'minor') => {
    if (!isDarkMode) {
      const rgb = tone === 'zero' ? '31,48,70' : '68,86,108';
      return `rgba(${rgb},${alpha})`;
    }

    const lift =
      tone === 'zero'
        ? alpha * 1.62 + 0.03
        : tone === 'major'
          ? alpha * 1.95 + 0.022
          : alpha * 1.85 + 0.018;

    return `rgba(242,247,255,${Math.min(lift, 0.42)})`;
  };

  const inputSpectrum = React.useMemo(() => (
    Array.isArray(spectrumData)
      ? spectrumData.map((value) => clamp(Number(value) || 0, 0, 1))
      : []
  ), [spectrumData]);
  const inputDetectorDbs = React.useMemo(() => (
    Array.isArray(detectorData)
      ? detectorData.map((value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? clamp(numeric, -120, 24) : -120;
      })
      : []
  ), [detectorData]);

  const spectrumShape = React.useMemo(() => {
    if (inputSpectrum.length < 2 || inputSpectrum.every((value) => value <= 0.002)) {
      return { line: '', fill: '' };
    }

    const baselineY = padT + innerH * 0.92;
    const topY = padT + innerH * 0.16;
    const format = (value) => (Math.round(value * 100) / 100).toString();
    const pointAt = (points, index) => points[clamp(index, 0, points.length - 1)];
    const displaySampleCount = Math.min(720, Math.max(384, inputSpectrum.length * 2));
    const linearValueAt = (sourceIndex) => {
      const lower = clamp(Math.floor(sourceIndex), 0, inputSpectrum.length - 1);
      const upper = clamp(lower + 1, 0, inputSpectrum.length - 1);
      const mix = clamp(sourceIndex - lower, 0, 1);
      return inputSpectrum[lower] + (inputSpectrum[upper] - inputSpectrum[lower]) * mix;
    };
    const smoothedValueAt = (sourceIndex) => {
      const radius = 2.75;
      const start = Math.max(0, Math.floor(sourceIndex - radius * 2.4));
      const end = Math.min(inputSpectrum.length - 1, Math.ceil(sourceIndex + radius * 2.4));
      let weighted = 0;
      let weightTotal = 0;

      for (let sampleIndex = start; sampleIndex <= end; sampleIndex += 1) {
        const distance = sampleIndex - sourceIndex;
        const weight = Math.exp(-(distance * distance) / (2 * radius * radius));
        weighted += inputSpectrum[sampleIndex] * weight;
        weightTotal += weight;
      }

      const averaged = weightTotal > 0 ? weighted / weightTotal : linearValueAt(sourceIndex);
      return linearValueAt(sourceIndex) * 0.24 + averaged * 0.76;
    };
    const smoothPath = (points) => {
      if (points.length < 2) return '';
      let path = `M ${format(points[0].x)} ${format(points[0].y)}`;

      for (let index = 0; index < points.length - 1; index += 1) {
        const p0 = pointAt(points, index - 1);
        const p1 = pointAt(points, index);
        const p2 = pointAt(points, index + 1);
        const p3 = pointAt(points, index + 2);
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        const cp1x = clamp(p1.x + (p2.x - p0.x) / 6, p1.x, p2.x);
        const cp1y = clamp(p1.y + (p2.y - p0.y) / 6, minY, maxY);
        const cp2x = clamp(p2.x - (p3.x - p1.x) / 6, p1.x, p2.x);
        const cp2y = clamp(p2.y - (p3.y - p1.y) / 6, minY, maxY);
        path += ` C ${format(cp1x)} ${format(cp1y)} ${format(cp2x)} ${format(cp2y)} ${format(p2.x)} ${format(p2.y)}`;
      }

      return path;
    };

    const points = Array.from({ length: displaySampleCount }, (_, index) => {
      const t = displaySampleCount <= 1 ? 0 : index / (displaySampleCount - 1);
      const sourceIndex = t * (inputSpectrum.length - 1);
      const smoothed = smoothedValueAt(sourceIndex);
      const frequency = graphMinFrequency * Math.pow(spectrumAnalysisMaxFrequency / graphMinFrequency, t);
      const x = padL + (Math.log10(frequency / graphMinFrequency) / frequencyRangeLog) * innerW;
      const shaped = Math.pow(clamp((smoothed - 0.018) / 0.982, 0, 1), 0.94) * 0.88;
      return {
        x,
        y: baselineY - shaped * (baselineY - topY)
      };
    });

    const line = smoothPath(points);
    const lastX = points[points.length - 1]?.x ?? padL + innerW;
    return {
      line,
      fill: `${line} L ${lastX} ${baselineY} L ${padL} ${baselineY} Z`
    };
  }, [graphMinFrequency, inputSpectrum, innerH, innerW, frequencyRangeLog, padT, spectrumAnalysisMaxFrequency]);

  const cycleSaturation = () => {
    const nextMode = (satMode + 1) % EQ_SATURATION_LABELS.length;
    onSaturationChange?.({
      mode: nextMode,
      amount: nextMode === 0 ? 0 : (satAmount || DEFAULT_EQ_SATURATION_AMOUNT)
    });
  };
  const resetSaturation = () => {
    onSaturationChange?.({ mode: 0, amount: 0 });
  };
  const setSaturationAmount = (event) => {
    onSaturationChange?.({
      mode: satMode || 1,
      amount: Number(event.target.value)
    });
  };
  const activeBand = activeIdx !== null && activeIdx !== undefined && points[activeIdx]
    ? withBandDefaults(points[activeIdx])
    : null;
  const activeDisplayBand = activeIdx !== null && activeIdx !== undefined && displayPoints[activeIdx]
    ? withBandDefaults(displayPoints[activeIdx])
    : activeBand;
  const activeBandIsDesser = activeBand?.type === DESSER_TYPE;
  const activeBandIsFullSpectrum = activeBand?.type === FULL_SPECTRUM_TYPE;
  const activeBandSupportsComp = Boolean(activeBand && supportsBandDynamics(activeBand));
  const activeBandHasCompTarget = Boolean(
    activeBandSupportsComp &&
    Math.abs((Number(activeBand.comp) || 0) - (Number(activeBand.gain) || 0)) > 0.05
  );
  const activeBandHasComp = Boolean(activeBand && bandHasDynamics(activeBand));
  const activeBandCompPanelVisible = activeBandSupportsComp && activeBandHasCompTarget && activeBandHasComp;
  const activeBandDynamicsMode = activeBandCompPanelVisible && (Number(activeBand.comp) || 0) > (Number(activeBand.gain) || 0) ? 'EXP' : 'COMP';
  const activeBandSupportsSat = Boolean(activeBand && supportsBandSaturation(activeBand));
  const activeBandSatMode = activeBandSupportsSat ? clamp(Math.round(Number(activeBand.saturationMode) || 0), 0, EQ_SATURATION_LABELS.length - 1) : 0;
  const activeBandSatAmount = activeBandSupportsSat ? clamp(Number(activeBand.saturationAmount) || 0, 0, 100) : 0;
  const activeBandSatLabel = activeBandSatMode ? EQ_SATURATION_LABELS[activeBandSatMode] : 'SAT OFF';
  const cycleActiveBandSaturation = () => {
    if (!activeBandSupportsSat) return;
    const nextMode = (activeBandSatMode + 1) % EQ_SATURATION_LABELS.length;
    applyPointPatch(activeIdx, {
      saturationMode: nextMode,
      saturationAmount: nextMode === 0 ? 0 : (activeBandSatAmount || DEFAULT_EQ_SATURATION_AMOUNT)
    }, { resort: false, updateRange: false });
  };
  const resetActiveBandSaturation = () => {
    if (!activeBandSupportsSat) return;
    applyPointPatch(activeIdx, { saturationMode: 0, saturationAmount: 0 }, { resort: false, updateRange: false });
  };
  const setActiveBandSaturationAmount = (event) => {
    if (!activeBandSupportsSat) return;
    applyPointPatch(activeIdx, {
      saturationMode: activeBandSatMode || 1,
      saturationAmount: Number(event.target.value)
    }, { resort: false, updateRange: false });
  };
  const spectrumValueToDb = (value) => clamp(Number(value) || 0, 0, 1) * 60 - 66;
  const detectorDbAt = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= inputDetectorDbs.length) return undefined;
    const value = inputDetectorDbs[index];
    return Number.isFinite(value) ? value : undefined;
  };
  const thresholdKneeEngagement = (levelDb, thresholdDb, kneeDb = 6) => {
    if (levelDb <= thresholdDb - kneeDb * 0.5) return 0;
    if (levelDb >= thresholdDb + kneeDb * 0.5) return 1;
    const t = clamp((levelDb - thresholdDb + kneeDb * 0.5) / kneeDb, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const getBandSpectrumPeak = (band, visualBand = band) => {
    if (!band || inputSpectrum.length < 2) return 0;

    const frequency = clampEqFrequency(visualBand?.freq || band.freq);
    const centerT = frequencyRangeLog === 0 ? 0.5 : (Math.log10(frequency / graphMinFrequency) / frequencyRangeLog);
    const q = clamp(band.q || DEFAULT_EQ_Q, 0.1, 50);
    const rangeLowT = band.type === FULL_SPECTRUM_TYPE
      ? Math.log10(clampEqFrequency(band.rangeLow) / graphMinFrequency) / frequencyRangeLog
      : 0;
    const rangeHighT = band.type === FULL_SPECTRUM_TYPE
      ? Math.log10(clampEqFrequency(band.rangeHigh) / graphMinFrequency) / frequencyRangeLog
      : 1;
    const windowWidth = band.type === 'Low Shelf' || band.type === 'High Shelf'
      ? 0.22
      : clamp(0.018 + 0.11 / Math.sqrt(q), 0.018, 0.16);
    let peak = 0;

    inputSpectrum.forEach((value, index) => {
      const sampleT = inputSpectrum.length <= 1 ? 0 : index / (inputSpectrum.length - 1);
      const sampleFrequency = graphMinFrequency * Math.pow(spectrumAnalysisMaxFrequency / graphMinFrequency, sampleT);
      const t = Math.log10(sampleFrequency / graphMinFrequency) / frequencyRangeLog;
      let weight = 0;
      if (band.type === 'Low Shelf') {
        weight = t <= centerT ? 1 : Math.max(0, 1 - (t - centerT) / windowWidth) ** 2;
      } else if (band.type === 'High Shelf') {
        weight = t >= centerT ? 1 : Math.max(0, 1 - (centerT - t) / windowWidth) ** 2;
      } else if (band.type === FULL_SPECTRUM_TYPE) {
        if (t >= rangeLowT && t <= rangeHighT) {
          weight = 1;
        } else {
          const edgeDistance = t < rangeLowT ? rangeLowT - t : t - rangeHighT;
          weight = Math.max(0, 1 - edgeDistance / 0.035) ** 2;
        }
      } else {
        const distance = Math.abs(t - centerT);
        if (distance > windowWidth) return;
        weight = (1 - distance / windowWidth) ** 2;
      }
      peak = Math.max(peak, value * weight);
    });

    return peak;
  };
  const getBandDetectorDb = (band, visualBand = band, index = undefined) => {
    const detectorDb = detectorDbAt(index);
    return Number.isFinite(detectorDb) ? detectorDb : spectrumValueToDb(getBandSpectrumPeak(band, visualBand));
  };
  const getBandDynamicEngagement = (band, visualBand = band, detectorDbOverride = undefined) => {
    if (!bandHasDynamics(band)) return 0;

    const dynamicRangeDb = Math.abs((Number(band.comp) || 0) - (Number(band.gain) || 0));
    if (dynamicRangeDb <= 0.05) return 0;

    const detectorDb = Number.isFinite(detectorDbOverride)
      ? detectorDbOverride
      : getBandDetectorDb(band, visualBand);
    const overDb = Math.max(0, detectorDb - (Number(band.compThreshold) || -18));
    const ratio = clamp(Number(band.compRatio) || 4, EQ_COMP_RATIO_MIN, EQ_COMP_RATIO_MAX);
    const ratioMoveDb = overDb * (1 - 1 / ratio);
    const ratioEngagement = clamp(ratioMoveDb / dynamicRangeDb, 0, 1);
    return clamp(thresholdKneeEngagement(detectorDb, Number(band.compThreshold) || -18) * ratioEngagement, 0, 1);
  };
  const activeBandDetectorDb = activeBandCompPanelVisible
    ? getBandDetectorDb(activeBand, activeDisplayBand, activeIdx)
    : -120;
  const withVisualDynamicGain = (visualPoint, sourcePoint = visualPoint, detectorDbOverride = undefined) => {
    const visualBand = withBandDefaults(visualPoint);
    const sourceBand = withBandDefaults(sourcePoint);
    const amount = getBandDynamicEngagement(sourceBand, visualBand, detectorDbOverride);
    if (amount <= 0.003) return visualBand;

    return {
      ...visualBand,
      gain: sourceBand.gain + (sourceBand.comp - sourceBand.gain) * amount
    };
  };
  const preDynamicDisplayPoints = preDisplayPoints.map((point, index) => (
    withVisualDynamicGain(point, prePoints[index] || point, mode === 'pre' ? detectorDbAt(index) : undefined)
  ));
  const postDynamicDisplayPoints = postDisplayPoints.map((point, index) => (
    withVisualDynamicGain(point, postPoints[index] || point, mode === 'post' ? detectorDbAt(index) : undefined)
  ));
  const dynamicDisplayPoints = mode === 'pre' ? preDynamicDisplayPoints : postDynamicDisplayPoints;
  const postCurve = buildSampledCurve(postDynamicDisplayPoints);
  const preCurve = buildSampledCurve(preDynamicDisplayPoints);
  const activeCurve = mode === 'pre' ? preCurve : postCurve;
  const activeCurveFill = activeHasCut ? '' : `${activeCurve} L ${padL + innerW} ${baseY} L ${padL} ${baseY} Z`;
  const compInputFill = activeBandCompPanelVisible
    ? `${Math.round(clamp((activeBandDetectorDb - EQ_COMP_THRESHOLD_MIN) / (EQ_COMP_THRESHOLD_MAX - EQ_COMP_THRESHOLD_MIN), 0, 1) * 100)}%`
    : '0%';
  const setActiveCompThreshold = (event) => {
    if (!activeBandCompPanelVisible) return;
    const compThreshold = Number(clamp(Number(event.target.value), EQ_COMP_THRESHOLD_MIN, EQ_COMP_THRESHOLD_MAX).toFixed(1));
    applyPointPatch(activeIdx, { compThreshold }, { resort: false, updateRange: false });
  };
  const toggleActiveComp = () => {
    if (!activeBandCompPanelVisible) return;
    applyPointPatch(activeIdx, { compEnabled: !activeBand.compEnabled }, { resort: false, updateRange: false });
  };
  const toggleActiveMute = () => {
    if (activeIdx === null || activeIdx === undefined) return;
    const currentPoints = latestPointsRef.current.length ? latestPointsRef.current : points;
    if (!currentPoints[activeIdx]) return;

    const current = withBandDefaults(currentPoints[activeIdx]);
    const nextOn = current.on === false;
    applyPointPatch(activeIdx, {
      on: nextOn,
      solo: nextOn ? current.solo : false
    }, { resort: false, updateRange: true });
  };
  const toggleActiveSolo = () => {
    if (activeIdx === null || activeIdx === undefined) return;
    const currentPoints = latestPointsRef.current.length ? latestPointsRef.current : points;
    if (!currentPoints[activeIdx]) return;

    const nextSolo = !withBandDefaults(currentPoints[activeIdx]).solo;
    const nextPts = currentPoints.map((point, index) => withBandDefaults({
      ...point,
      solo: index === activeIdx ? nextSolo : false
    }));

    latestPointsRef.current = nextPts;
    setPoints(nextPts);
    if (nextSolo) {
      const clearSolo = (list) => list.map((point) => withBandDefaults({ ...point, solo: false }));
      if (mode === 'pre') setPostPoints(clearSolo(postPoints));
      else setPrePoints(clearSolo(prePoints));
    }
    setActiveIdx(activeIdx);
  };
  const eqGridCenterX = padL + innerW * 0.5;
  const eqGridCenterY = padT + innerH * 0.5;
  const eqGridOvalRadius = innerH * 0.64;
  const eqGridOvalScale = Math.max(1, (innerW / innerH) * 0.70);
  const hoverPreview = (() => {
    if (!hoverPoint || dragIdx !== null || dragMode !== null || typeOpen) return null;
    const nearCenterLine = Math.abs(hoverPoint.y - baseY) <= 8;

    const isNearExistingNode = points.some((point, index) => {
      const sourceBand = withBandDefaults(point);
      const visualBand = displayPoints[index] ? withBandDefaults(displayPoints[index]) : sourceBand;
      const liveX = freqToX(visualBand.freq);
      const liveY = gainToY(nodeGainAt(visualBand));
      const liveDistance = Math.hypot(hoverPoint.x - liveX, hoverPoint.y - liveY);

      if (liveDistance <= 20) return true;

      const isSurfing = sourceBand.type === 'Surfer Bell' && Math.abs(visualBand.freq - sourceBand.freq) > 0.5;
      if (!isSurfing) return false;

      const anchorX = freqToX(sourceBand.freq);
      const anchorY = gainToY(nodeGainAt(sourceBand));
      return Math.hypot(hoverPoint.x - anchorX, hoverPoint.y - anchorY) <= 20;
    });
    if (isNearExistingNode && !nearCenterLine) return null;

    const freq = clampEqFrequency(xToFreq(hoverPoint.x));
    const type = getCreatedFilterType(freq);
    const totalY = nearCenterLine ? baseY : gainToY(activeHasCut ? totalDisplayGain(displayPoints, freq) : totalGain(displayPoints, freq));
    const nearTotalCurve = nearCenterLine || Math.abs(hoverPoint.y - totalY) < 20;

    if (!nearTotalCurve) return null;

    const hasAnyBand = prePoints.length > 0 || postPoints.length > 0;
    const showIcon = !hasAnyBand && canUseFilterType(type, null, points);

    return {
      freq,
      type,
      showIcon,
      x: freqToX(freq),
      y: totalY,
      iconX: clamp(freqToX(freq) - 18, padL + 6, padL + innerW - 42),
      iconY: Math.max(padT + 4, totalY - 42),
    };
  })();

  return (
    <div className="eq-container">
      <div className="eq-toolbar">
        <div className="seg">
          <button
            className={`seg-btn${mode === 'pre' ? ' active pre' : ''}`}
            onClick={(event) => {
              if (resetOnAltClick(event, () => { setMode('pre'); setActiveIdx(null); })) return;
              setMode('pre');
              setActiveIdx(null);
            }}
            onDoubleClick={(event) => resetOnDoubleClick(event, () => { setMode('pre'); setActiveIdx(null); })}
          >PRE COMP</button>
          <button
            className={`seg-btn${mode === 'post' ? ' active post' : ''}`}
            onClick={(event) => {
              if (resetOnAltClick(event, () => { setMode('pre'); setActiveIdx(null); })) return;
              setMode('post');
              setActiveIdx(null);
            }}
            onDoubleClick={(event) => resetOnDoubleClick(event, () => { setMode('pre'); setActiveIdx(null); })}
          >POST COMP</button>
        </div>
        <div className={`eq-sat${satMode ? ` active mode-${satMode}` : ''}`}>
          <button
            type="button"
            className="eq-sat-btn"
            aria-pressed={satMode > 0}
            title={satMode ? `Saturation ${EQ_SATURATION_LABELS[satMode]}` : saturationLabel}
            onClick={(event) => {
              if (resetOnAltClick(event, resetSaturation)) return;
              cycleSaturation();
            }}
            onDoubleClick={(event) => resetOnDoubleClick(event, resetSaturation)}
          >
            <svg className="eq-sat-icon" width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2.2 10.1h2.2c1.1 0 1.7-.9 2.2-3.1.5-2.1 1.1-3.1 2.2-3.1H11.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.4 4.2h2.1M9.5 9.8h2.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
            </svg>
            <span>{saturationLabel}</span>
          </button>
          {satMode > 0 && (
            <input
              className="eq-sat-slider"
              type="range"
              min="0"
              max="100"
              value={satAmount}
              onChange={setSaturationAmount}
              onPointerDown={(event) => resetOnAltClick(event, resetSaturation)}
              onDoubleClick={(event) => resetOnDoubleClick(event, resetSaturation)}
              onWheel={(event) => handleWheelValue(event, satAmount, { min: 0, max: 100, step: 1 }, (amount) => {
                onSaturationChange?.({ mode: satMode || 1, amount });
              })}
              aria-label="Saturation amount"
              style={{ '--sat-fill': `${satAmount}%` }}
            />
          )}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="eq-svg"
        style={{ height: `${H}px` }}
        onPointerDown={onSvgPointerDown}
        onDoubleClick={onSvgDoubleClick}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { onUp(); setHoverPoint(null); }}
      >
        <defs>
          <linearGradient id="postFill" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={activeFillFocusY} y2={baseY}>
            <stop offset="0%" stopColor="var(--curve-post)" stopOpacity="0.20" />
            <stop offset="58%" stopColor="var(--curve-post)" stopOpacity="0.055" />
            <stop offset="100%" stopColor="var(--curve-post)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="preFill" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={activeFillFocusY} y2={baseY}>
            <stop offset="0%" stopColor="var(--curve-pre)" stopOpacity="0.17" />
            <stop offset="58%" stopColor="var(--curve-pre)" stopOpacity="0.045" />
            <stop offset="100%" stopColor="var(--curve-pre)" stopOpacity="0" />
          </linearGradient>
          {displayPoints.map((point, i) => {
            const band = withBandDefaults(point);
            if (CUT_TYPES.has(band.type)) return null;

            const source = withBandDefaults(points[i] || point);
            const color = bandColor(i, point);
            const isActive = activeIdx === i;
            const isMuted = source.on === false;
            const isSoloDimmed = isBandSoloDimmed(i, point);
            const fillColor = isMuted || isSoloDimmed ? soloDimColor : color;
            const x = freqToX(band.freq);
            const y = gainToY(nodeGainAt(band));
            const fillTopOpacity = isMuted
              ? (isActive ? 0.09 : 0.052)
              : isSoloDimmed
                ? (isActive ? 0.075 : 0.040)
                : isActive ? 0.255 : 0.145;
            const fillMidOpacity = isMuted
              ? (isActive ? 0.032 : 0.020)
              : isSoloDimmed
                ? (isActive ? 0.026 : 0.016)
                : isActive ? 0.095 : 0.052;
            const fillEndOpacity = isMuted || isSoloDimmed ? 0.006 : isActive ? 0.018 : 0.010;

            return (
              <linearGradient key={`band-fill-${i}`} id={bandFillId(i)} gradientUnits="userSpaceOnUse" x1={x} x2={x} y1={y} y2={baseY}>
                <stop offset="0%" stopColor={fillColor} stopOpacity={fillTopOpacity} />
                <stop offset="52%" stopColor={fillColor} stopOpacity={fillMidOpacity} />
                <stop offset="100%" stopColor={fillColor} stopOpacity={fillEndOpacity} />
              </linearGradient>
            );
          })}
          {displayPoints.map((point, i) => {
            const source = withBandDefaults(point);
            const mirrorGain = clamp(Number(source.comp) || 0, -scale, scale);
            if (!bandHasDynamics(source)) return null;

            const mirrorPoint = { ...source, gain: mirrorGain };
            const x = freqToX(mirrorPoint.freq);
            const y = gainToY(nodeGainAt(mirrorPoint));
            const isActive = activeIdx === i;
            const isSoloDimmed = isBandSoloDimmed(i, point);
            const compColor = isSoloDimmed ? soloDimColor : 'var(--warm)';

            return (
              <linearGradient key={`comp-fill-${i}`} id={compMirrorFillId(i)} gradientUnits="userSpaceOnUse" x1={x} x2={x} y1={y} y2={baseY}>
                <stop offset="0%" stopColor={compColor} stopOpacity={isSoloDimmed ? (isActive ? 0.080 : 0.042) : isActive ? 0.230 : 0.125} />
                <stop offset="52%" stopColor={compColor} stopOpacity={isSoloDimmed ? (isActive ? 0.030 : 0.016) : isActive ? 0.085 : 0.045} />
                <stop offset="100%" stopColor={compColor} stopOpacity={isSoloDimmed ? 0.006 : isActive ? 0.016 : 0.009} />
              </linearGradient>
            );
          })}
          <linearGradient id={spectrumFillId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={`rgb(${spectrumRgb})`} stopOpacity={isDarkMode ? 0.16 : 0.11} />
            <stop offset="68%" stopColor={`rgb(${spectrumRgb})`} stopOpacity={isDarkMode ? 0.055 : 0.04} />
            <stop offset="100%" stopColor={`rgb(${spectrumRgb})`} stopOpacity="0" />
          </linearGradient>
          <filter id="curveGlow" x="-5%" y="-50%" width="110%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient
            id={centerGlowId}
            gradientUnits="userSpaceOnUse"
            x1={padL}
            x2={padL}
            y1={baseY - innerH * 0.24}
            y2={baseY + innerH * 0.24}
          >
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
            <stop offset="33%" stopColor="var(--accent)" stopOpacity={isDarkMode ? 0.018 : 0.014} />
            <stop offset="50%" stopColor="var(--accent-soft)" stopOpacity={isDarkMode ? 0.072 : 0.052} />
            <stop offset="67%" stopColor="var(--accent)" stopOpacity={isDarkMode ? 0.018 : 0.014} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <clipPath id={graphClipId}>
            <rect x={padL} y={padT} width={innerW} height={innerH} />
          </clipPath>
          <radialGradient
            id={gridOvalGradientId}
            gradientUnits="userSpaceOnUse"
            cx={eqGridCenterX}
            cy={eqGridCenterY}
            r={eqGridOvalRadius}
            gradientTransform={`translate(${eqGridCenterX} ${eqGridCenterY}) scale(${eqGridOvalScale} 1) translate(${-eqGridCenterX} ${-eqGridCenterY})`}
          >
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="38%" stopColor="white" stopOpacity="0.96" />
            <stop offset="68%" stopColor="white" stopOpacity="0.48" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id={gridOvalMaskId} maskUnits="userSpaceOnUse" x={padL} y={padT} width={innerW} height={innerH}>
            <rect x={padL} y={padT} width={innerW} height={innerH} fill={`url(#${gridOvalGradientId})`} />
          </mask>
        </defs>

        {/* Background hit-zone for adding nodes */}
        <rect x={padL} y={padT} width={innerW} height={innerH} fill="transparent" className="eq-bg-hit" />
        <g clipPath={`url(#${graphClipId})`} pointerEvents="none">
          <rect x={padL} y={padT} width={innerW} height={innerH} fill={`url(#${centerGlowId})`} />
        </g>

        {/* Grid */}
        <g mask={`url(#${gridOvalMaskId})`}>
          {metricFreqMarks.map(f => {
            const x = freqToX(f);
            const isMajor = majorFreqMarks.has(f);
            const isLabeled = freqMarks.includes(f);
            const hover = hoverPoint ? Math.max(0, 1 - Math.abs(x - hoverPoint.x) / (innerW * 0.16)) ** 1.8 : 0;
            const lift = hover * 1.2;
            const alpha = (isMajor ? 0.150 : isLabeled ? 0.105 : 0.068) + hover * (isMajor ? 0.050 : 0.034);
            const strokeWidth = (isMajor ? 0.82 : isLabeled ? 0.62 : 0.44) + hover * 0.10;

            return (
              <line
                key={f}
                x1={x}
                y1={padT - lift}
                x2={x}
                y2={padT + innerH + lift}
                className="eq-bg-hit"
                stroke={eqGridStroke(alpha, isMajor ? 'major' : 'minor')}
                strokeWidth={strokeWidth}
              />
            );
          })}
          {gainMarks.map(g => {
            const y = gainMarkToY(g);
            const isZero = g === 0;
            const hover = hoverPoint ? Math.max(0, 1 - Math.abs(y - hoverPoint.y) / (innerH * 0.18)) ** 1.8 : 0;
            const push = hover * 1.4;
            const alpha = (isZero ? 0.210 : 0.074) + hover * (isZero ? 0.052 : 0.034);

            return (
              <line
                key={g}
                x1={padL - push}
                y1={y}
                x2={padL + innerW + push}
                y2={y}
                className="eq-bg-hit"
                stroke={eqGridStroke(alpha, isZero ? 'zero' : 'minor')}
                strokeWidth={(isZero ? 0.92 : 0.50) + hover * 0.09}
              />
            );
          })}
        </g>

        {dbLabelMarks.map(g => {
          const y = gainMarkToY(g);
          const isZero = g === 0;
          const labelX = padL + innerW - 8;

          return (
            <g key={`db-${g}`} className="eq-bg-hit">
              <text
                x={labelX}
                y={y + 3}
                textAnchor="end"
                className={`eq-db-label eq-db-scale-label${isZero ? ' zero' : ''}`}
                style={{ fill: activeColor, opacity: isZero ? 0.95 : 0.76 }}
              >
                {formatDbLabel(g)}
              </text>
            </g>
          );
        })}
        <g clipPath={`url(#${graphClipId})`}>
          {showWaveform && spectrumShape.fill && (
            <>
              <path d={spectrumShape.fill} className="eq-bg-hit" fill={`url(#${spectrumFillId})`} />
              <path d={spectrumShape.line} fill="none" className="eq-bg-hit" stroke={spectrumStroke}
                    strokeWidth="1.05" strokeLinejoin="round" strokeLinecap="round"
                    shapeRendering="geometricPrecision" />
            </>
          )}

          {displayPoints.map((p, i) => {
            const band = withBandDefaults(p);
            if (band.type !== FULL_SPECTRUM_TYPE) return null;

            const source = withBandDefaults(points[i] || p);
            const isActive = activeIdx === i;
            const isMuted = source.on === false;
            const isSoloDimmed = isBandSoloDimmed(i, p);
            const color = isMuted || isSoloDimmed ? soloDimColor : bandColor(i, p);
            const x1 = freqToX(band.rangeLow);
            const x2 = freqToX(band.rangeHigh);
            const detectorDb = detectorDbAt(i);
            const isDynamic = bandHasDynamics(source) && getBandDynamicEngagement(source, band, detectorDb) > 0.003;
            const opacity = isMuted
              ? (isActive ? 0.075 : 0.045)
              : isSoloDimmed
                ? (isActive ? 0.060 : 0.035)
                : isDynamic
                  ? (isActive ? 0.190 : 0.115)
                  : (isActive ? 0.150 : 0.075);

            return (
              <g key={`full-spectrum-zone-${i}`}>
                <rect
                  x={Math.min(x1, x2)}
                  y={padT}
                  width={Math.max(1, Math.abs(x2 - x1))}
                  height={innerH}
                  className="eq-band-fill eq-full-spectrum-zone"
                  fill={color}
                  opacity={opacity}
                  pointerEvents="visiblePainted"
                  style={{ cursor: 'pointer' }}
                  onPointerDown={onBandSelectDown(i)}
                  onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                />
                <line x1={x1} y1={padT} x2={x1} y2={padT + innerH} stroke={color} strokeWidth={isActive ? 1.05 : 0.75} opacity={isActive ? 0.46 : 0.24} pointerEvents="none" />
                <line x1={x2} y1={padT} x2={x2} y2={padT + innerH} stroke={color} strokeWidth={isActive ? 1.05 : 0.75} opacity={isActive ? 0.46 : 0.24} pointerEvents="none" />
              </g>
            );
          })}

          {/* Per-band individual curves with fills (active mode only) */}
          {displayPoints.map((p, i) => {
            const { line, fill, isCut } = buildBandCurve(dynamicDisplayPoints, i);
            const color = bandColor(i, p);
            const isActive = activeIdx === i;
            const source = withBandDefaults(points[i] || p);
            const isMuted = source.on === false;
            const isSoloDimmed = isBandSoloDimmed(i, p);
            const curveColor = isMuted || isSoloDimmed ? soloDimColor : color;
            const detectorDb = detectorDbAt(i);
            const isDynamic = bandHasDynamics(source) && getBandDynamicEngagement(source, withBandDefaults(p), detectorDb) > 0.003;
            const curveOpacity = isMuted
              ? (isActive ? 0.32 : 0.20)
              : isSoloDimmed
                ? (isActive ? 0.44 : 0.24)
                : isDynamic ? (isActive ? 0.95 : 0.58) : (isActive ? 0.7 : 0.35);
            return (
              <g key={`band-${i}`}>
                {!isCut && fill && (
                  <path
                    d={fill}
                    className="eq-band-fill"
                    fill={`url(#${bandFillId(i)})`}
                    pointerEvents="visiblePainted"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={onBandSelectDown(i)}
                    onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  />
                )}
                <path d={line} fill="none" stroke={curveColor}
                      className="eq-band-line"
                      strokeWidth={isDynamic ? (isActive ? 1.65 : 1.15) : (isActive ? 1.1 : 0.8)}
                      strokeDasharray={isActive ? '0' : '2 3'}
                      opacity={curveOpacity}
                      pointerEvents="visibleStroke"
                      style={{ cursor: 'pointer' }}
                      onPointerDown={onBandSelectDown(i)}
                      onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }} />
              </g>
            );
          })}
          {displayPoints.map((p, i) => {
            const source = withBandDefaults(points[i] || p);
            const visualBand = withBandDefaults(p);
            const isActive = activeIdx === i;
            const isSoloDimmed = isBandSoloDimmed(i, p);
            const includeMuted = isActive && activeBandCompPanelVisible;
            const pointHasDynamics = bandHasDynamics(source);
            const mirror = buildCompMirrorCurve(visualBand, includeMuted);
            if (!mirror.active) return null;
            const detectorDb = detectorDbAt(i);
            const motion = buildCompMotionCurve(visualBand, getBandDynamicEngagement(source, visualBand, detectorDb));
            const compColor = isSoloDimmed ? soloDimColor : 'var(--warm)';
            const motionColor = isSoloDimmed ? soloDimColor : activeColor;
            return (
              <g key={`comp-mirror-${i}`} pointerEvents="none">
                <path d={mirror.fill} fill={`url(#${compMirrorFillId(i)})`} opacity={isSoloDimmed ? (isActive ? 0.20 : 0.12) : pointHasDynamics ? (isActive ? 0.44 : 0.26) : 0.20} />
                <path
                  d={mirror.line}
                  fill="none"
                  stroke={compColor}
                  strokeWidth={isActive ? 1.1 : 0.85}
                  strokeDasharray={pointHasDynamics ? '3.5 4.5' : '2.5 5'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={isSoloDimmed ? (isActive ? 0.36 : 0.20) : pointHasDynamics ? (isActive ? 0.70 : 0.42) : 0.34}
                />
                {motion.active && (
                  <>
                    <path d={motion.fill} fill={motionColor} opacity={isSoloDimmed ? (isActive ? 0.13 : 0.07) : isActive ? 0.30 : 0.16} />
                    <path
                      d={motion.line}
                      fill="none"
                      stroke={motionColor}
                      strokeWidth={isActive ? 1.7 : 1.15}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={isSoloDimmed ? (isActive ? 0.42 : 0.22) : isActive ? 0.96 : 0.56}
                    />
                    {isActive && (
                      <circle cx={motion.cx} cy={motion.cy} r="3.1" fill={compColor} stroke="var(--panel)" strokeWidth="0.8" opacity={isSoloDimmed ? 0.54 : 0.98} />
                    )}
                  </>
                )}
              </g>
            );
          })}

          {/* Active total curve */}
          {activeCurveFill && !hasSoloedBand && <path d={activeCurveFill} fill={`url(#${activeFillId})`} pointerEvents="none" />}
          <path d={activeCurve} fill="none" stroke={hasSoloedBand ? soloDimColor : activeColor}
                strokeWidth="2.35"
                strokeLinejoin="round" strokeLinecap="round"
                opacity={hasSoloedBand ? 0.24 : 0.96}
                pointerEvents="none" />
        </g>

        {hoverPreview && (
          <g className="eq-hover-preview" pointerEvents="none">
            <circle cx={hoverPreview.x} cy={hoverPreview.y} r="13" fill={activeColor} opacity="0.08" />
            <circle cx={hoverPreview.x} cy={hoverPreview.y} r="6" fill="var(--panel)" stroke={activeColor}
                    strokeWidth="1.35" opacity="0.94"
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.12))' }} />
            <circle cx={hoverPreview.x} cy={hoverPreview.y} r="2" fill={activeColor} opacity="0.82" />
            {hoverPreview.showIcon && (
              <g transform={`translate(${hoverPreview.iconX} ${hoverPreview.iconY})`}
                 style={{ filter: 'drop-shadow(0 4px 10px rgba(20,30,55,0.08))' }}>
                <rect x="0" y="0" width="36" height="26" rx="13"
                      fill="var(--panel)" stroke={activeColor} strokeWidth="0.65" opacity="0.96" />
                <path d="M11 18.3H25" stroke={activeColor} strokeWidth="0.7" strokeLinecap="round" opacity="0.24" />
                <path d={getFilterTypePath(hoverPreview.type)}
                      transform="translate(9 5)"
                      fill="none" stroke={activeColor} strokeWidth="1.35"
                      strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        )}

        {/* Freq labels */}
        {freqMarks.map(f => {
          const isMin = f === graphMinFrequency;
          const isMax = f === maxFrequency;
          return (
            <text
              key={f}
              x={isMin ? padL + 3 : isMax ? padL + innerW - 3 : freqToX(f)}
              y={freqLabelY}
              textAnchor={isMin ? 'start' : isMax ? 'end' : 'middle'}
              className="eq-label-text"
            >
              {f < 1000 ? f : (f / 1000) + 'k'}
            </text>
          );
        })}

        {/* Scale selector replaces the topmost dB label at the top of the axis. */}
        <foreignObject x={dbAxisX - 24} y={padT - 11} width="60" height="22"
                       style={{ overflow: 'visible' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" className="eq-scale-wrap" ref={scaleRef}
               style={{ position: 'relative' }}>
            <button
              className="eq-scale-btn"
              onClick={(event) => {
                if (resetOnAltClick(event, () => { setScale?.(12); setScaleOpen(false); })) return;
                setScaleOpen(o => !o);
              }}
              onDoubleClick={(event) => resetOnDoubleClick(event, () => { setScale?.(12); setScaleOpen(false); })}
            >
              <span>{scale} dB</span>
              <svg width="8" height="8" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>
            </button>
            {scaleOpen && (
              <div className="eq-scale-menu">
                {scaleOptions.map(s => (
                  <button key={s} className={`eq-scale-item${s === scale ? ' active' : ''}`}
                    onClick={() => { setScale(s); setScaleOpen(false); }}>{s} dB</button>
                ))}
              </div>
            )}
          </div>
        </foreignObject>


        {/* Nodes */}
        {points.map((p, i) => {
          const sourceBand = withBandDefaults(p);
          const visualBand = displayPoints[i] || sourceBand;
          const isActive = activeIdx === i;
          const isDragging = dragIdx === i;
          const heldNodeVisual = isDragging && dragMode === 'node' && dragVisualHold?.idx === i
            ? dragVisualHold
            : null;
          const isMuted = sourceBand.on === false;
          const isSoloDimmed = isBandSoloDimmed(i, p);
          const nodeColor = isMuted || isSoloDimmed ? soloDimColor : (mode === 'pre' ? 'var(--eq-node-pre, var(--warm))' : 'var(--eq-node-post, var(--accent))');
          const nodeFill = isMuted || isSoloDimmed ? 'var(--eq-node-muted-fill)' : 'var(--eq-node-fill)';
          const lowPriorityNode = isMuted || isSoloDimmed;
          const isSurfing = sourceBand.type === 'Surfer Bell' && Math.abs(visualBand.freq - sourceBand.freq) > 0.5;
          const isSurferBell = sourceBand.type === 'Surfer Bell';
          const editSurfAnchor = isSurferBell && isDragging;
          const band = withBandDefaults(editSurfAnchor ? sourceBand : visualBand);
          const liveX = freqToX(visualBand.freq);
          const liveY = gainToY(nodeGainAt(visualBand));
          const anchorX = freqToX(sourceBand.freq);
          const anchorY = gainToY(nodeGainAt(sourceBand));
          const x = heldNodeVisual ? heldNodeVisual.x : editSurfAnchor ? anchorX : liveX;
          const y = heldNodeVisual ? heldNodeVisual.y : editSurfAnchor ? anchorY : liveY;
          const isCutBand = CUT_TYPES.has(band.type);
          const cutCurveY = isCutBand
            ? clamp(gainToCurveY(cutLinkGainAt(band)), padT, padT + innerH)
            : y;
          const isDesser = band.type === DESSER_TYPE;
          const showCompArrow = isActive && supportsBandDynamics(band);
          const compGain = clamp(Number(band.comp) || 0, -scale, scale);
          const isCompDragging = isDragging && dragMode === 'comp';
          const hasCompControl = showCompArrow && (bandHasDynamics(band) || isCompDragging);
          const compPoint = hasCompControl ? { ...band, gain: compGain } : null;
          const compY = compPoint ? gainToY(nodeGainAt(compPoint)) : y;
          const compDistanceFromNode = Math.abs(compY - y);
          const compArrowBlend = clamp((compDistanceFromNode - 12) / 34, 0, 1);
          const compArrowGap = 29 + (9 - 29) * compArrowBlend;
          const isFullSpectrum = band.type === FULL_SPECTRUM_TYPE;
          const rangeLowX = isFullSpectrum ? freqToX(band.rangeLow) : x;
          const rangeHighX = isFullSpectrum ? freqToX(band.rangeHigh) : x;
          const showRangeHandles = isFullSpectrum && isActive;
          const lowEdgeJoined = isFullSpectrumEdgeJoined(i, 'low');
          const highEdgeJoined = isFullSpectrumEdgeJoined(i, 'high');
          const keepClearOfNode = (value, fallbackSign) => {
            const minClearance = 23;
            const delta = value - y;
            if (Math.abs(delta) >= minClearance) return value;
            return y + (delta === 0 ? fallbackSign : Math.sign(delta)) * minClearance;
          };
          const arrowTopY = keepClearOfNode(compY - compArrowGap, -1);
          const arrowBottomY = keepClearOfNode(compY + compArrowGap, 1);
          const topArrowPath = 'M 0 -3.6 L 3.6 3 L -3.6 3 Z';
          const bottomArrowPath = 'M 0 3.6 L 3.6 -3 L -3.6 -3 Z';

          return (
            <g key={i}>
              {isSurfing && !isDesser && (
                <g className="eq-surf-link">
                  <line x1={anchorX} y1={anchorY} x2={liveX} y2={liveY}
                        pointerEvents="none"
                        stroke={nodeColor} strokeWidth="1.05" strokeDasharray="4 5" opacity={lowPriorityNode ? 0.18 : editSurfAnchor ? 0.46 : 0.34} />
                  <circle cx={anchorX} cy={anchorY} r={editSurfAnchor ? 9.2 : 7.4}
                          pointerEvents="none"
                          fill={nodeColor} opacity={lowPriorityNode ? 0.10 : editSurfAnchor ? 0.22 : 0.16} />
                  <circle cx={anchorX} cy={anchorY} r={editSurfAnchor ? 5.8 : 5.1}
                          pointerEvents="none"
                          fill={nodeFill} stroke={nodeColor}
                          strokeWidth={editSurfAnchor ? 1.7 : 1.45}
                          strokeDasharray="2.2 2.6" opacity={lowPriorityNode ? 0.54 : 0.96}
                          style={{ color: nodeColor, filter: 'drop-shadow(0 0 5px currentColor)' }} />
                  <circle cx={anchorX} cy={anchorY} r="1.8" fill="var(--eq-node-ring)" opacity={lowPriorityNode ? 0.46 : 0.95} pointerEvents="none" />
                  <circle className="eq-surf-ghost-hit" cx={anchorX} cy={anchorY} r="15"
                          fill="transparent" style={{ cursor: 'grab' }}
                          onPointerDown={onSurferGhostDown(i, visualBand.freq)}
                          onContextMenu={onNodeContext(i)} />
                  {editSurfAnchor && (
                    <circle cx={liveX} cy={liveY} r="3.4" fill={nodeFill} stroke={nodeColor} strokeWidth="0.8" opacity={lowPriorityNode ? 0.42 : 0.78} pointerEvents="none" />
                  )}
                </g>
              )}

              {isCutBand && (
                <g className="eq-cut-link" pointerEvents="none">
                  <line
                    x1={x}
                    y1={y}
                    x2={x}
                    y2={cutCurveY}
                    stroke={nodeColor}
                    strokeWidth={isActive ? 1.15 : 0.85}
                    strokeDasharray={Math.abs(cutCurveY - y) > 7 ? '3 4' : '0'}
                    opacity={lowPriorityNode ? 0.16 : isActive ? 0.54 : 0.34}
                  />
                  <circle
                    cx={x}
                    cy={cutCurveY}
                    r={isActive ? 2.7 : 2.1}
                    fill={nodeColor}
                    opacity={lowPriorityNode ? 0.20 : isActive ? 0.66 : 0.42}
                  />
                </g>
              )}

              {/* Subtle glow when active */}
              {(isActive || isDragging) && <circle cx={x} cy={y} r="11" fill={nodeColor} opacity={lowPriorityNode ? 0.04 : 0.08} />}
              {isSurfing && !isDesser && <circle cx={x} cy={y} r={isActive ? 10 : 8}
                                                fill="none" stroke={nodeColor} strokeWidth="0.75"
                                                opacity={lowPriorityNode ? 0.16 : isActive ? 0.42 : 0.25} />}
              {isFullSpectrum && (
                <g className="eq-full-range-edges">
                  <line x1={rangeLowX} y1={padT + 2} x2={rangeLowX} y2={padT + innerH - 2}
                        stroke={nodeColor} strokeWidth={showRangeHandles ? 1.2 : 0.8}
                        strokeDasharray={showRangeHandles ? '0' : '2.5 4'}
                        opacity={lowPriorityNode ? 0.16 : showRangeHandles ? 0.62 : 0.30}
                        pointerEvents="none" />
                  <line x1={rangeHighX} y1={padT + 2} x2={rangeHighX} y2={padT + innerH - 2}
                        stroke={nodeColor} strokeWidth={showRangeHandles ? 1.2 : 0.8}
                        strokeDasharray={showRangeHandles ? '0' : '2.5 4'}
                        opacity={lowPriorityNode ? 0.16 : showRangeHandles ? 0.62 : 0.30}
                        pointerEvents="none" />
                  {showRangeHandles && (
                    <>
                      {!lowEdgeJoined && (
                        <>
                          <rect className="eq-full-range-hit" x={rangeLowX - 7} y={padT} width="14" height={innerH}
                                fill="transparent" style={{ cursor: 'ew-resize' }}
                                onPointerDown={onFullRangeHandleDown(i, 'low')}
                                onContextMenu={onNodeContext(i)} />
                          <circle cx={rangeLowX} cy={y} r="4.1" fill={nodeFill} stroke={nodeColor} strokeWidth="1.15"
                                  opacity={lowPriorityNode ? 0.54 : 0.96} pointerEvents="none" />
                        </>
                      )}
                      {!highEdgeJoined && (
                        <>
                          <rect className="eq-full-range-hit" x={rangeHighX - 7} y={padT} width="14" height={innerH}
                                fill="transparent" style={{ cursor: 'ew-resize' }}
                                onPointerDown={onFullRangeHandleDown(i, 'high')}
                                onContextMenu={onNodeContext(i)} />
                          <circle cx={rangeHighX} cy={y} r="4.1" fill={nodeFill} stroke={nodeColor} strokeWidth="1.15"
                                  opacity={lowPriorityNode ? 0.54 : 0.96} pointerEvents="none" />
                        </>
                      )}
                    </>
                  )}
                </g>
              )}

              {/* Main node */}
              <circle
                cx={x}
                cy={y}
                r={isActive ? 5.8 : 4.9}
                fill={nodeFill}
                stroke={nodeColor}
                strokeWidth={isActive ? 1.7 : 1.25}
                opacity={isMuted ? 0.62 : isSoloDimmed ? (isActive ? 0.68 : 0.46) : isActive ? 1 : 0.94}
                style={{ color: nodeColor, filter: isActive ? 'drop-shadow(0 0 5px currentColor) drop-shadow(0 1px 3px rgba(0,0,0,0.22))' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.16))' }}
              />
              <circle
                cx={x - 1.2}
                cy={y - 1.35}
                r={isActive ? 1.35 : 1.05}
                fill="var(--eq-node-ring)"
                opacity={lowPriorityNode ? 0.22 : 0.64}
                pointerEvents="none"
              />
              {!isSurferBell && (
                <circle className="eq-node-hit" cx={x} cy={y} r="16" fill="transparent" style={{ cursor: 'grab' }}
                        onPointerDown={onNodeDown(i)} onContextMenu={onNodeContext(i)}
                        onWheel={(e) => onNodeWheel(i, e)} />
              )}
              {isSurferBell && !isSurfing && (
                <circle className="eq-node-hit" cx={x} cy={y} r="16" fill="transparent" style={{ cursor: 'grab' }}
                        onPointerDown={onSurferGhostDown(i, visualBand.freq)} onContextMenu={onNodeContext(i)}
                        onWheel={(e) => onNodeWheel(i, e)} />
              )}
              {showCompArrow && (
                <>
                  <g
                    className="eq-comp-arrow top"
                    transform={`translate(${x} ${arrowTopY})`}
                    style={{ cursor: 'ns-resize' }}
                    onPointerDown={onCompDown(i, 1)}
                    onWheel={onCompWheel(i)}
                    onContextMenu={onNodeContext(i)}
                  >
                    <path d={topArrowPath} fill={nodeColor} opacity={lowPriorityNode ? 0.18 : 0.52} />
                    <circle r="8.5" fill="transparent" />
                  </g>
                  <g
                    className="eq-comp-arrow bottom"
                    transform={`translate(${x} ${arrowBottomY})`}
                    style={{ cursor: 'ns-resize' }}
                    onPointerDown={onCompDown(i, -1)}
                    onWheel={onCompWheel(i)}
                    onContextMenu={onNodeContext(i)}
                  >
                    <path d={bottomArrowPath} fill={nodeColor} opacity={lowPriorityNode ? 0.18 : 0.52} />
                    <circle r="8.5" fill="transparent" />
                  </g>
                </>
              )}

            </g>
          );
        })}
        {fullSpectrumJunctions.map((junction) => {
          const x = freqToX(junction.freq);
          const junctionGain = activeHasCut
            ? totalDisplayGain(dynamicDisplayPoints, junction.freq)
            : totalGain(dynamicDisplayPoints, junction.freq);
          const y = clamp(activeHasCut ? gainToCurveY(junctionGain) : gainToY(junctionGain), padT + 5, padT + innerH - 5);
          const isActive = junction.edges.some((edge) => edge.idx === activeIdx);
          const color = isActive ? activeColor : 'var(--ink-3)';
          const detachY = Math.max(padT + 12, y - 25);
          const avgSlope = junction.edges.reduce((sum, edge) => sum + edge.slope, 0) / Math.max(1, junction.edges.length);
          const slopeOpacity = clamp((avgSlope - 0.1) / 18, 0.28, 0.86);

          return (
            <g key={`full-junction-${junction.id}`} className={`eq-full-junction${isActive ? ' active' : ''}`}>
              <line
                x1={x}
                y1={padT + 1}
                x2={x}
                y2={padT + innerH - 1}
                stroke={color}
                strokeWidth={isActive ? 1.35 : 1}
                opacity={isActive ? 0.54 : 0.32}
                pointerEvents="none"
              />
              <path
                d={`M ${x - 16} ${y + 12} C ${x - 9} ${y + 7} ${x + 9} ${y + 7} ${x + 16} ${y + 12}`}
                fill="none"
                stroke={color}
                strokeWidth={isActive ? 1.25 : 1}
                strokeLinecap="round"
                opacity={slopeOpacity}
                pointerEvents="none"
              />
              <line
                x1={x}
                y1={detachY + 8}
                x2={x}
                y2={y - 8}
                stroke={color}
                strokeWidth="0.8"
                opacity={isActive ? 0.46 : 0.24}
                pointerEvents="none"
              />
              <circle
                className="eq-full-junction-core"
                cx={x}
                cy={y}
                r={isActive ? 6.4 : 5.7}
                fill="var(--eq-node-fill)"
                stroke={color}
                strokeWidth={isActive ? 1.8 : 1.35}
                opacity={isActive ? 1 : 0.92}
                pointerEvents="none"
                style={{ color, filter: isActive ? 'drop-shadow(0 0 5px currentColor) drop-shadow(0 1px 3px rgba(0,0,0,0.24))' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.18))' }}
              />
              <circle
                cx={x - 1.2}
                cy={y - 1.35}
                r="1.25"
                fill="var(--eq-node-ring)"
                opacity="0.62"
                pointerEvents="none"
              />
              <circle
                className="eq-full-junction-hit"
                cx={x}
                cy={y}
                r="18"
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onPointerDown={onFullSpectrumJunctionDown(junction)}
                onWheel={onFullSpectrumJunctionWheel(junction)}
              >
                <title>Arrastra horizontal para mover la union. Arrastra vertical o usa la rueda para cambiar la curva.</title>
              </circle>
              <g
                className="eq-full-junction-detach"
                transform={`translate(${x} ${detachY})`}
                style={{ cursor: 'pointer' }}
                onPointerDown={onFullSpectrumJunctionDetach(junction)}
              >
                <circle r="7.6" fill="var(--panel)" stroke={color} strokeWidth="1" opacity="0.96" />
                <path d="M -2.7 -2.7 L 2.7 2.7 M 2.7 -2.7 L -2.7 2.7"
                      stroke={color} strokeWidth="1.3" strokeLinecap="round" />
                <circle r="13" fill="transparent" />
              </g>
            </g>
          );
        })}
      </svg>

      {activeBand && (
        <div className={`eq-node-info${activeBandIsDesser ? ' has-desser' : ''}${activeBandIsFullSpectrum ? ' has-full-spectrum' : ''}${activeBandCompPanelVisible ? ' has-comp' : ''}`} ref={nodeInfoRef}>
          <div className="eq-node-actions" aria-label="Band quick actions">
            <button
              type="button"
              className={`eq-solo-btn${activeBand.solo ? ' active' : ''}`}
              aria-pressed={activeBand.solo}
              aria-label="Solo band"
              title="Solo band"
              onClick={toggleActiveSolo}
            >
              S
            </button>
            <button
              type="button"
              className={`eq-mute-btn${activeBand.on === false ? ' muted' : ''}`}
              aria-pressed={activeBand.on === false}
              aria-label={activeBand.on === false ? 'Unmute band' : 'Mute band'}
              title={activeBand.on === false ? 'Unmute band' : 'Mute band'}
              onClick={toggleActiveMute}
            >
              M
            </button>
          </div>
          <button type="button" className="eq-info-pair eq-info-drag freq" onPointerDown={onInfoDragStart('freq')} onWheel={onInfoWheel('freq')} aria-label="Frequency">
            <b>F</b>{formatFreq(activeBand.type === 'Surfer Bell' ? activeDisplayBand.freq : activeBand.freq)}
          </button>
          {activeBandIsDesser ? (
            <>
              <button type="button" className="eq-info-pair eq-info-drag threshold" onPointerDown={onInfoDragStart('threshold')} onWheel={onInfoWheel('threshold')} aria-label="Desser threshold">
                <b>THR</b>{formatThreshold(activeBand.threshold)}
              </button>
              <button type="button" className="eq-info-pair eq-info-drag intensity" onPointerDown={onInfoDragStart('intensity')} onWheel={onInfoWheel('intensity')} aria-label="Desser intensity">
                <b>INT</b>{formatIntensity(activeBand.intensity)}
              </button>
              <div className="eq-desser-mode" aria-label="Desser mode">
                {[
                  ['split', 'Split'],
                  ['wider', 'Wider']
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={activeBand.deessMode === value ? 'active' : ''}
                    onClick={(event) => {
                      if (resetOnAltClick(event, () => applyPointPatch(activeIdx, { deessMode: 'split' }, { resort: false, updateRange: true }))) return;
                      applyPointPatch(activeIdx, { deessMode: value }, { resort: false, updateRange: true });
                    }}
                    onDoubleClick={(event) => resetOnDoubleClick(event, () => applyPointPatch(activeIdx, { deessMode: 'split' }, { resort: false, updateRange: true }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button type="button" className="eq-info-pair eq-info-drag gain" onPointerDown={onInfoDragStart('gain')} onWheel={onInfoWheel('gain')} aria-label="Gain">
                <b>G</b>{formatGain(activeBand.gain)}
              </button>
              {CUT_TYPES.has(activeBand.type) ? (
                <button type="button" className="eq-info-pair eq-info-drag slope" onPointerDown={onInfoDragStart('slope')} onWheel={onInfoWheel('slope')} aria-label="Cut slope">
                  <b>S</b>{formatSlope(activeBand.slope)}
                </button>
              ) : activeBandIsFullSpectrum ? (
                <>
                  <button type="button" className="eq-info-pair eq-info-drag range-low" onPointerDown={onInfoDragStart('rangeLow')} onWheel={onInfoWheel('rangeLow')} aria-label="Full spectrum low frequency">
                    <b>L</b>{formatFreq(activeBand.rangeLow)}
                  </button>
                  <button type="button" className="eq-info-pair eq-info-drag range-high" onPointerDown={onInfoDragStart('rangeHigh')} onWheel={onInfoWheel('rangeHigh')} aria-label="Full spectrum high frequency">
                    <b>H</b>{formatFreq(activeBand.rangeHigh)}
                  </button>
                  <button type="button" className="eq-info-pair eq-info-drag q" onPointerDown={onInfoDragStart('q')} onWheel={onInfoWheel('q')} aria-label="Full spectrum slope">
                    <b>S</b>{activeBand.q.toFixed(1)}
                  </button>
                </>
              ) : (
                <button type="button" className="eq-info-pair eq-info-drag q" onPointerDown={onInfoDragStart('q')} onWheel={onInfoWheel('q')} aria-label="Q">
                  <b>Q</b>{activeBand.q.toFixed(2)}
                </button>
              )}
            </>
          )}
          <div className={`eq-type-control${typeOpen ? ' open' : ''}`}>
            <button
              type="button"
              className="eq-type-btn"
              aria-label="Band type"
              aria-expanded={typeOpen}
              onClick={(e) => {
                e.stopPropagation();
                setTypeOpen(open => !open);
              }}
            >
              <FilterTypeIcon type={activeBand.type} />
              <span className="eq-type-value">{activeBand.type}</span>
            </button>
            {typeOpen && (
              <div className="eq-type-menu">
                {getSelectableFilterTypes(activeIdx).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`eq-type-item${activeBand.type === type ? ' active' : ''}`}
                    onClick={() => {
                      const [minQ, maxQ] = getQRange({ ...activeBand, type });
                      const nextIsDesser = type === DESSER_TYPE;
                      const typeChanged = activeBand.type !== type;
                      const nextSupportsDynamics = supportsBandDynamics({ ...activeBand, type });
                      const nextQ = clamp(typeChanged ? getDefaultQForType(type) : activeBand.q, minQ, maxQ);
                      const nextFullSpectrumRange = type === FULL_SPECTRUM_TYPE
                        ? getFullSpectrumRangePatch({ ...activeBand, type, q: nextQ }, {})
                        : {};
                      applyPointPatch(activeIdx, {
                        type,
                        gain: nextIsDesser || CUT_TYPES.has(type) ? 0 : activeBand.gain,
                        q: nextQ,
                        slope: typeChanged ? getDefaultSlopeForType(type) : normalizeSlope(activeBand.slope, type),
                        threshold: activeBand.threshold,
                        intensity: activeBand.intensity,
                        deessMode: activeBand.deessMode,
                        comp: nextSupportsDynamics ? activeBand.comp : 0,
                        compEnabled: nextSupportsDynamics ? activeBand.compEnabled : false,
                        compThreshold: activeBand.compThreshold,
                        compAttack: activeBand.compAttack,
                        compRelease: activeBand.compRelease,
                        compRatio: activeBand.compRatio,
                        saturationMode: nextSupportsDynamics ? activeBand.saturationMode : 0,
                        saturationAmount: nextSupportsDynamics ? activeBand.saturationAmount : 0,
                        ...nextFullSpectrumRange
                      }, { resort: false, updateRange: true });
                      setTypeOpen(false);
                    }}
                  >
                    <FilterTypeIcon type={type} />
                    <span className="eq-type-value">{type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {activeBandSupportsSat && (
            <div className={`eq-band-sat${activeBandSatMode ? ` active mode-${activeBandSatMode}` : ''}`}>
              <button
                type="button"
                className="eq-band-sat-btn"
                aria-pressed={activeBandSatMode > 0}
                title={activeBandSatMode ? `Band saturation ${EQ_SATURATION_LABELS[activeBandSatMode]}` : activeBandSatLabel}
                onClick={(event) => {
                  if (resetOnAltClick(event, resetActiveBandSaturation)) return;
                  cycleActiveBandSaturation();
                }}
                onDoubleClick={(event) => resetOnDoubleClick(event, resetActiveBandSaturation)}
              >
                <svg className="eq-sat-icon" width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2.2 10.1h2.2c1.1 0 1.7-.9 2.2-3.1.5-2.1 1.1-3.1 2.2-3.1H11.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2.4 4.2h2.1M9.5 9.8h2.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
                </svg>
                <span>{activeBandSatLabel}</span>
              </button>
              {activeBandSatMode > 0 && (
                <input
                  className="eq-band-sat-slider"
                  type="range"
                  min="0"
                  max="100"
                  value={activeBandSatAmount}
                  onChange={setActiveBandSaturationAmount}
                  onPointerDown={(event) => resetOnAltClick(event, resetActiveBandSaturation)}
                  onDoubleClick={(event) => resetOnDoubleClick(event, resetActiveBandSaturation)}
                  onWheel={(event) => handleWheelValue(event, activeBandSatAmount, { min: 0, max: 100, step: 1 }, (saturationAmount) => {
                    applyPointPatch(activeIdx, { saturationMode: activeBandSatMode || 1, saturationAmount }, { resort: false, updateRange: false });
                  })}
                  aria-label="Band saturation amount"
                  style={{ '--band-sat-fill': `${activeBandSatAmount}%` }}
                />
              )}
            </div>
          )}
          <button type="button" className="eq-node-delete" onClick={deleteActivePoint} disabled={points.length <= 0} aria-label="Eliminar banda completa" title="Eliminar banda completa">
            <span aria-hidden="true" style={{ display: 'inline-block', transform: 'translateY(-0.5px)' }}>
              ×
            </span>
          </button>
          {activeBandCompPanelVisible && (
            <div
              className={`eq-comp-panel ${activeBandDynamicsMode.toLowerCase()}${activeBandHasComp ? '' : ' muted'}`}
              style={{ '--eq-comp-audio-fill': compInputFill }}
            >
              <button
                type="button"
                className="eq-comp-tab"
                aria-pressed={activeBandHasComp}
                title={activeBandHasComp ? 'Mute band compression' : 'Enable band compression'}
                onClick={toggleActiveComp}
              >
                {activeBandHasComp ? activeBandDynamicsMode : 'OFF'}
              </button>
              <label className="eq-comp-fader" aria-label="EQ dynamics threshold">
                <span>THR</span>
                <span className="eq-comp-meter">
                  <span className="eq-comp-meter-fill" />
                  <input
                    type="range"
                    min={EQ_COMP_THRESHOLD_MIN}
                    max={EQ_COMP_THRESHOLD_MAX}
                    step="0.1"
                    value={activeBand.compThreshold}
                    onChange={setActiveCompThreshold}
                    onPointerDown={(event) => resetOnAltClick(event, () => resetInfoField('compThreshold'))}
                    onDoubleClick={(event) => resetOnDoubleClick(event, () => resetInfoField('compThreshold'))}
                    onWheel={(event) => handleWheelValue(event, activeBand.compThreshold, { min: EQ_COMP_THRESHOLD_MIN, max: EQ_COMP_THRESHOLD_MAX, step: 0.5 }, (compThreshold) => {
                      applyPointPatch(activeIdx, { compThreshold }, { resort: false, updateRange: false });
                    })}
                  />
                </span>
                <b>{formatThreshold(activeBand.compThreshold)}</b>
              </label>
              <button type="button" className="eq-info-pair eq-info-drag comp-attack" onPointerDown={onInfoDragStart('compAttack')} onWheel={onInfoWheel('compAttack')} aria-label="EQ dynamics attack">
                <b>ATK</b>{formatMs(activeBand.compAttack)}
              </button>
              <button type="button" className="eq-info-pair eq-info-drag comp-release" onPointerDown={onInfoDragStart('compRelease')} onWheel={onInfoWheel('compRelease')} aria-label="EQ dynamics release">
                <b>REL</b>{formatMs(activeBand.compRelease)}
              </button>
              <button type="button" className="eq-info-pair eq-info-drag comp-ratio" onPointerDown={onInfoDragStart('compRatio')} onWheel={onInfoWheel('compRatio')} aria-label="EQ dynamics ratio">
                <b>RTO</b>{formatRatio(activeBand.compRatio)}
              </button>
              <button type="button" className="eq-comp-delete" onClick={deleteActiveCompressor} aria-label="Eliminar solo compresor" title="Eliminar solo compresor">
                <span aria-hidden="true" style={{ display: 'inline-block', transform: 'translateY(-0.5px)' }}>
                  ×
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { EQCurve };
