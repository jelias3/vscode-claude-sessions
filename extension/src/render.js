"use strict";

// The color of the idle notice. It matches color code 215 in the terminal
// writer, which paints the five-hour session usage the same orange.
const NOTICE_COLOR = "#ffaf5f";

/** Write an age in seconds as a short span, for a tooltip. */
function age(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 90) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

module.exports = { NOTICE_COLOR, age };
