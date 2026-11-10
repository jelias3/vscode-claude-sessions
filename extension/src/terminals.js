"use strict";

// How long to wait for the editor to name the process behind a tab.
const PID_TIMEOUT_MS = 2000;

/**
 * Read the process behind one terminal tab, and give up after a wait.
 *
 * The editor answers this with a promise. A tab left over from a closed
 * window can leave that promise open, and one stuck tab must not hold up
 * the whole search.
 */
function pidOf(terminal, timeoutMs) {
  const limit = timeoutMs || PID_TIMEOUT_MS;
  const waited = new Promise((resolve) => setTimeout(() => resolve(0), limit));
  return Promise.race([Promise.resolve(terminal.processId).catch(() => 0), waited]);
}

module.exports = { PID_TIMEOUT_MS, pidOf };
