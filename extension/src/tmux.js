"use strict";

const { execFile } = require("child_process");
const fs = require("fs");

// How long a window name stays good. A name rarely changes, so a call on
// every tick would be waste.
const NAME_AGE_MS = 30000;
const CALL_TIMEOUT_MS = 2000;

let names = new Map(); // "session:@window.%pane" to the window name
let namesReadAt = 0;
let reading = false;

/** Run one tmux command, and hand back its lines. */
function run(args) {
  return new Promise((resolve) => {
    // The editor server does not join a tmux session, so TMUX must go. With
    // it set, tmux refuses a command that would nest one session in another.
    const environment = Object.assign({}, process.env);
    delete environment.TMUX;
    execFile("tmux", args, { timeout: CALL_TIMEOUT_MS, env: environment }, (error, out) => {
      resolve(error ? [] : String(out).split("\n").filter(Boolean));
    });
  });
}

/** Read the window name of every pane, and hold the result for a while. */
async function refreshNames(now) {
  if (reading || (now || Date.now()) - namesReadAt < NAME_AGE_MS) {
    return;
  }
  reading = true;
  try {
    const lines = await run(["list-panes", "-a", "-F", "#{session_name}:#{window_id}.#{pane_id}\t#{window_name}"]);
    if (lines.length) {
      const fresh = new Map();
      for (const line of lines) {
        const [target, name] = line.split("\t");
        fresh.set(target, name || "");
      }
      names = fresh;
    }
    namesReadAt = Date.now();
  } finally {
    reading = false;
  }
}

/** Read the window name held for one pane, or an empty string. */
function windowName(target) {
  return names.get(target) || "";
}

/** Read the parent process of one process, which the kernel holds. */
function parentOf(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    return Number(fields[1]); // the parent, field four of the whole record
  } catch (error) {
    return 0;
  }
}

/**
 * Read every tmux client, as the session it holds and the shell that ran it.
 *
 * A tmux client runs under the shell that started it. In the editor that
 * shell is a terminal tab, so its process identifier names the tab.
 */
async function clientShells() {
  const lines = await run(["list-clients", "-F", "#{client_pid}\t#{client_session}"]);
  const clients = [];
  for (const line of lines) {
    const [clientPid, session] = line.split("\t");
    const parent = parentOf(Number(clientPid));
    if (parent > 1) {
      clients.push({ session, shell: parent });
    }
  }
  return clients;
}

/** Find the shell that attached one tmux session, or zero. */
async function attachingShell(sessionName) {
  const found = (await clientShells()).find((one) => one.session === sessionName);
  return found ? found.shell : 0;
}

/**
 * Find the identifier tmux holds for a session of one name.
 *
 * An identifier such as `$1` names one session and no other. A name goes
 * through prefix matching, where `1` can reach a session called `10`, so
 * every command this extension sends uses the identifier.
 *
 * This reads tmux on every call. A name is cached because it rarely changes,
 * and a session list changes whenever the user starts or ends a session.
 */
async function sessionId(sessionName) {
  const lines = await run(["list-sessions", "-F", "#{session_name}\t#{session_id}"]);
  for (const line of lines) {
    const [name, id] = line.split("\t");
    if (name === sessionName) {
      return id || "";
    }
  }
  return "";
}

/**
 * Walk up the process chain from one process, and stop at a known one.
 *
 * A Claude session outside tmux runs under the shell of a terminal tab, with
 * a step or two between. The walk finds that shell. A session inside tmux
 * cannot use this, because its chain ends at the tmux server.
 */
function ancestorIn(pid, known, maxDepth) {
  const limit = maxDepth || 12;
  let current = Number(pid) || 0;
  for (let step = 0; step < limit && current > 1; step += 1) {
    if (known.has(current)) {
      return current;
    }
    current = parentOf(current);
  }
  return 0;
}

module.exports = { ancestorIn, attachingShell, clientShells, parentOf, refreshNames, sessionId, windowName };
