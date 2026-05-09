import React from "react";
import { resetOnAltClick, resetOnDoubleClick } from "./controlReset.js";
import { handleWheelValue } from "./wheelControl.js";

// Minimalist elegant knob — arc track only, no 3D body
const { useState, useRef } = React;

function Knob({ value, onChange, min = 0, max = 100, step, size = 48, label, unit = '', color = 'var(--accent)', format, defaultValue, disabled = false }) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ y: 0, val: 0 });

  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Left-to-right top sweep. This keeps every knob visually moving in one
  // readable direction instead of returning to the same side of the dial.
  const startAngle = 180;
  const sweepAngle = 180;
  const angle = startAngle + norm * sweepAngle;

  const onPointerDown = (e) => {
    if (resetOnAltClick(e, defaultValue !== undefined ? () => onChange(defaultValue) : null)) return;
    if (disabled) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    startRef.current = { y: e.clientY, val: value };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    const dy = startRef.current.y - e.clientY;
    const range = max - min;
    const sensitivity = e.shiftKey ? 0.2 : 1;
    onChange(Math.max(min, Math.min(max, startRef.current.val + (dy / 180) * range * sensitivity)));
  };
  const onPointerUp = (e) => {
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {
      // Pointer capture can already be gone after cancellation.
    }
  };
  const onDoubleClick = (event) => {
    resetOnDoubleClick(event, defaultValue !== undefined ? () => onChange(defaultValue) : null);
  };
  const onWheel = (e) => {
    if (disabled) return;
    handleWheelValue(e, value, { min, max, step }, onChange);
  };

  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  const toXY = (deg) => {
    const rad = deg * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [tx1, ty1] = toXY(startAngle);
  const [fx2, fy2] = toXY(startAngle + sweepAngle);
  const [px2, py2] = toXY(angle);
  const largeArc = norm * sweepAngle > 180 ? 1 : 0;

  const tickAngle = angle * Math.PI / 180;

  const display = format ? format(value) : `${value >= 0 && unit !== '%' ? '' : ''}${typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value}${unit}`;

  return (
    <div className={`knob-wrap${disabled ? ' disabled' : ''}`} onWheel={onWheel}>
      <svg
        width={size}
        height={size}
        className={`knob-svg-ctrl${dragging ? ' dragging' : ''}`}
        style={{ cursor: disabled ? 'default' : 'ns-resize', display: 'block' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      >
        {/* Track bg */}
        <path
          d={`M ${tx1} ${ty1} A ${r} ${r} 0 0 1 ${fx2} ${fy2}`}
          fill="none"
          stroke="var(--line-soft)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Progress arc */}
        {norm > 0.004 && (
          <path
            d={`M ${tx1} ${ty1} A ${r} ${r} 0 ${largeArc} 1 ${px2} ${py2}`}
            fill="none"
            stroke={disabled ? 'var(--ink-5)' : color}
            strokeWidth="2"
            strokeLinecap="round"
            style={{ filter: disabled ? 'none' : `drop-shadow(0 0 3px ${color}50)` }}
          />
        )}
        {/* Center circle — flat */}
        <circle cx={cx} cy={cy} r={size * 0.24} fill="var(--panel-soft)" stroke="var(--line-soft)" strokeWidth="0.5" />
        {/* Tick indicator line */}
        <line
          x1={cx + (size * 0.06) * Math.cos(tickAngle)}
          y1={cy + (size * 0.06) * Math.sin(tickAngle)}
          x2={cx + (size * 0.20) * Math.cos(tickAngle)}
          y2={cy + (size * 0.20) * Math.sin(tickAngle)}
          stroke={disabled ? 'var(--ink-4)' : color}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {dragging && <circle cx={cx} cy={cy} r={size / 2 - 1} fill="none" stroke={color} strokeWidth="0.5" opacity="0.18" />}
      </svg>
      {label && <div className="knob-label">{label}</div>}
      <div className="knob-value">{display}</div>
    </div>
  );
}

export { Knob };
