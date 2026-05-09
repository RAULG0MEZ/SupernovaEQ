function isAltResetClick(event) {
  return Boolean(event?.altKey && (event.button === undefined || event.button === 0));
}

function resetOnAltClick(event, onReset) {
  if (!isAltResetClick(event) || typeof onReset !== "function") return false;

  event.preventDefault();
  event.stopPropagation();
  onReset();
  return true;
}

function resetOnDoubleClick(event, onReset) {
  if (typeof onReset !== "function") return false;

  event.preventDefault();
  event.stopPropagation();
  onReset();
  return true;
}

export { isAltResetClick, resetOnAltClick, resetOnDoubleClick };
