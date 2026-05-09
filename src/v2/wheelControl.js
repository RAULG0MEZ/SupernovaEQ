function clampWheelValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function decimalPlaces(value) {
  const text = String(value);
  if (!text.includes('.')) return 0;
  return text.split('.')[1]?.length || 0;
}

function wheelDirection(event) {
  const dominant = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  return dominant < 0 ? 1 : -1;
}

function wheelMultiplier(event) {
  if (event.metaKey || event.ctrlKey) return 5;
  if (event.shiftKey || event.altKey) return 0.2;
  return 1;
}

function wheelStep(min, max, step) {
  const numericStep = Number(step);
  if (Number.isFinite(numericStep) && numericStep > 0) return numericStep;

  const range = Math.max(0, Number(max) - Number(min));
  if (range <= 24) return 1;
  if (range <= 120) return 1;
  return range / 100;
}

function adjustWheelValue(value, { min = 0, max = 100, step, event }) {
  const amount = wheelStep(min, max, step) * wheelDirection(event) * wheelMultiplier(event);
  const places = Math.max(decimalPlaces(step || 0), amount % 1 === 0 ? 0 : 2);
  const next = clampWheelValue((Number(value) || 0) + amount, min, max);
  return Number(next.toFixed(Math.min(4, places)));
}

function handleWheelValue(event, value, options, onChange) {
  event.preventDefault();
  event.stopPropagation();
  onChange(adjustWheelValue(value, { ...options, event }));
}

export { adjustWheelValue, clampWheelValue, handleWheelValue, wheelDirection, wheelStep };
