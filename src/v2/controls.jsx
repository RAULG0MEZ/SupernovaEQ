import React from "react";
import { createPortal } from "react-dom";
import { resetOnAltClick, resetOnDoubleClick } from "./controlReset.js";
import { handleWheelValue } from "./wheelControl.js";

// controls.jsx — bypass button, vfader, meters, selects, pills

const { useState: uS, useRef: uR, useEffect: uE } = React;
const SELECT_MENU_GAP = 4;
const SELECT_MENU_PAD = 8;
const SELECT_ITEM_HEIGHT = 30;
const SELECT_MENU_CHROME = 8;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ─── Bypass Button (replaces toggle) ─────────────────────────────────────────
function BypassBtn({ on, onChange, defaultValue }) {
  return (
    <button
      className={`bypass-btn ${on ? 'active' : 'bypassed'}`}
      onClick={(event) => {
        if (resetOnAltClick(event, defaultValue !== undefined ? () => onChange(defaultValue) : null)) return;
        onChange(!on);
      }}
      onDoubleClick={(event) => resetOnDoubleClick(event, defaultValue !== undefined ? () => onChange(defaultValue) : null)}
      title={on ? 'Bypass module' : 'Enable module'}
    >
      {on ? 'ON' : 'OFF'}
    </button>
  );
}

// ─── Vertical Fader ──────────────────────────────────────────────────────────
function VFader({ value, onChange, min, max, ticks = [], unit = 'dB', height = 180, color = 'var(--accent)', invert = false, label, defaultValue }) {
  const ref = uR(null);
  const [drag, setDrag] = uS(false);
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const onDown = (e) => {
    if (resetOnAltClick(e, defaultValue !== undefined ? () => onChange(defaultValue) : null)) return;
    e.preventDefault();
    setDrag(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e);
  };
  const update = (e) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let t = (e.clientY - rect.top) / rect.height;
    t = Math.max(0, Math.min(1, t));
    if (!invert) t = 1 - t;
    onChange(min + t * (max - min));
  };
  const onMove = (e) => { if (drag) update(e); };
  const onUp = (e) => {
    setDrag(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {
      // Pointer capture can already be gone after cancellation.
    }
  };

  const handleY = invert ? `${norm * 100}%` : `${(1 - norm) * 100}%`;

  return (
    <div className="vfader-col">
      {label && <div className="vfader-label">{label}</div>}
      <div className="vfader-with-ticks">
        <div className="vfader-ticks">
          {ticks.map(t => {
            const tn = Math.max(0, Math.min(1, (t - min) / (max - min)));
            const top = invert ? `${tn * 100}%` : `${(1 - tn) * 100}%`;
            return (
              <div key={t} className="vfader-tick" style={{ top }}>
                <span>{t}</span>
              </div>
            );
          })}
        </div>
        <div
          ref={ref}
          className={`vfader${drag ? ' dragging' : ''}`}
          style={{ height, '--fader-color': color }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={(e) => resetOnDoubleClick(e, defaultValue !== undefined ? () => onChange(defaultValue) : null)}
          onWheel={(e) => handleWheelValue(e, value, { min, max, step: 0.1 }, onChange)}
        >
          <div className="vfader-track" />
          <div className="vfader-fill" style={{
            [invert ? 'top' : 'bottom']: 0,
            height: `${norm * 100}%`
          }} />
          <div className="vfader-handle" style={{ top: handleY }}>
            <div className="vfader-handle-line" />
          </div>
        </div>
      </div>
      <div className="vfader-value">{value > 0 ? '+' : ''}{value.toFixed(1)} {unit}</div>
    </div>
  );
}

// ─── GR Meter (Gain Reduction — fills from top) ─────────────────────────────
function GRMeter({ reduction = 0, height = 180, active = true }) {
  const [gr, setGr] = uS(0);
  uE(() => {
    if (!active) { setGr(0); return; }
    let raf;
    const tick = () => {
      setGr(prev => {
        const target = reduction * (0.6 + Math.random() * 0.4);
        return prev * 0.72 + target * 0.28;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduction]);

  const pct = Math.min(1, gr / 30) * 100;

  return (
    <div className="gr-meter" style={{ height }} title="Gain Reduction">
      <div className="gr-fill" style={{ height: `${pct}%` }} />
      <div className="gr-label">GR</div>
    </div>
  );
}

// ─── Level Meter (fills from bottom) ────────────────────────────────────────
function LevelMeter({ active = true, intensity = 0.5, height = 180, threshold = 0.65 }) {
  const [level, setLevel] = uS(0.3);
  const [peak, setPeak] = uS(0);
  const peakTimer = uR(null);

  uE(() => {
    if (!active) { setLevel(0); setPeak(0); return; }
    let raf;
    const tick = () => {
      const target = intensity * (0.4 + Math.random() * 0.6);
      setLevel(prev => {
        const next = prev * 0.75 + target * 0.25;
        setPeak(p => {
          if (next > p) {
            clearTimeout(peakTimer.current);
            peakTimer.current = setTimeout(() => setPeak(0), 1800);
            return next;
          }
          return p;
        });
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(peakTimer.current); };
  }, [active, intensity]);

  const overThresh = level > threshold;
  return (
    <div className="level-meter" style={{ height }}>
      <div className="level-fill" style={{
        height: `${level * 100}%`,
        background: overThresh
          ? 'linear-gradient(0deg, var(--accent) 0%, var(--accent-soft) 40%, var(--warm) 100%)'
          : 'linear-gradient(0deg, var(--accent) 0%, var(--accent-soft) 100%)'
      }} />
      {/* Threshold marker */}
      <div className="level-threshold" style={{ bottom: `${threshold * 100}%` }} />
      {/* Peak hold */}
      {peak > 0.05 && (
        <div className="level-peak" style={{ bottom: `${peak * 100}%` }} />
      )}
    </div>
  );
}

// ─── Select dropdown ─────────────────────────────────────────────────────────
function Select({ value, onChange, options, floating = false, defaultValue }) {
  const [open, setOpen] = uS(false);
  const [floatingStyle, setFloatingStyle] = uS(null);
  const ref = uR(null);
  const menuRef = uR(null);

  const updateFloatingStyle = React.useCallback(() => {
    if (!floating || !ref.current) return;

    const trigger = ref.current.querySelector('.select-trigger');
    const rect = trigger?.getBoundingClientRect();
    if (!rect) return;

    const scale = clamp(
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--plugin-ui-scale')) || 1,
      0.25,
      2
    );
    const desiredHeight = (options.length * SELECT_ITEM_HEIGHT + SELECT_MENU_CHROME) * scale;
    const roomBelow = window.innerHeight - rect.bottom - SELECT_MENU_GAP - SELECT_MENU_PAD;
    const roomAbove = rect.top - SELECT_MENU_GAP - SELECT_MENU_PAD;
    const openUp = roomBelow < Math.min(desiredHeight, 180 * scale) && roomAbove > roomBelow;
    const visualMaxHeight = Math.max(
      116 * scale,
      Math.min(desiredHeight, openUp ? roomAbove : roomBelow)
    );
    const visualWidth = Math.max(rect.width, 118 * scale);
    const visualLeft = clamp(
      rect.left,
      SELECT_MENU_PAD,
      Math.max(SELECT_MENU_PAD, window.innerWidth - SELECT_MENU_PAD - visualWidth)
    );
    const visualTop = openUp
      ? clamp(rect.top - SELECT_MENU_GAP - visualMaxHeight, SELECT_MENU_PAD, window.innerHeight - SELECT_MENU_PAD - visualMaxHeight)
      : clamp(rect.bottom + SELECT_MENU_GAP, SELECT_MENU_PAD, window.innerHeight - SELECT_MENU_PAD - visualMaxHeight);

    setFloatingStyle({
      position: 'fixed',
      top: `${visualTop}px`,
      left: `${visualLeft}px`,
      right: 'auto',
      width: `${visualWidth / scale}px`,
      maxHeight: `${visualMaxHeight / scale}px`,
      overflowY: desiredHeight > visualMaxHeight ? 'auto' : 'visible',
      '--select-menu-scale': scale,
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
    });
  }, [floating, options.length, ref, setFloatingStyle]);

  uE(() => {
    const onDoc = (e) => {
      const target = e.target;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  uE(() => {
    if (!open) setFloatingStyle(null);
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || !floating) return undefined;

    updateFloatingStyle();
    window.addEventListener('resize', updateFloatingStyle);
    window.addEventListener('scroll', updateFloatingStyle, true);
    return () => {
      window.removeEventListener('resize', updateFloatingStyle);
      window.removeEventListener('scroll', updateFloatingStyle, true);
    };
  }, [floating, open, updateFloatingStyle]);

  const menu = (
    <div
      className={`select-menu${floating ? ' select-menu-floating' : ''}`}
      ref={menuRef}
      style={floating ? floatingStyle : undefined}
    >
      {options.map(o => (
        <button
          key={o}
          type="button"
          className={`select-item${o === value ? ' active' : ''}`}
          onClick={() => { onChange(o); setOpen(false); }}
        >
          {o}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`select${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="select-trigger"
        onClick={(event) => {
          if (resetOnAltClick(event, defaultValue !== undefined ? () => { onChange(defaultValue); setOpen(false); } : null)) return;
          setOpen(o => !o);
        }}
        onDoubleClick={(event) => resetOnDoubleClick(event, defaultValue !== undefined ? () => { onChange(defaultValue); setOpen(false); } : null)}
      >
        <span>{value}</span>
        <svg width="8" height="8" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (floating ? (floatingStyle ? createPortal(menu, document.body) : null) : menu)}
    </div>
  );
}

// ─── Pill group ───────────────────────────────────────────────────────────────
function PillGroup({ value, onChange, options, stretch = false, defaultValue }) {
  return (
    <div className={`pillgroup${stretch ? ' stretch' : ''}`}>
      {options.map(o => (
        <button
          key={o}
          className={`pill${o === value ? ' active' : ''}`}
          onClick={(event) => {
            if (resetOnAltClick(event, defaultValue !== undefined ? () => onChange(defaultValue) : null)) return;
            onChange(o);
          }}
          onDoubleClick={(event) => resetOnDoubleClick(event, defaultValue !== undefined ? () => onChange(defaultValue) : null)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export { BypassBtn, VFader, GRMeter, LevelMeter, Select, PillGroup };
