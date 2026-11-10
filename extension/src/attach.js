"use strict";

const describe = require("./describe");
const roster = require("./roster");
const terminals = require("./terminals");
const tmux = require("./tmux");

// The terminal this extension opened for a session, by session identifier.
// It is the reuse guard and the second click guard at once. A second click
// finds the terminal here, so no click can open a second tab for a session.
const opened = new Map();

/** Drop a terminal the user closed, so the next click opens a fresh one. */
function forget(terminal) {
  for (const [id, held] of opened) {
    if (held === terminal) {
      opened.delete(id);
    }
  }
}

/** Drop every terminal, which the extension does when it shuts down. */
function forgetAll() {
  opened.clear();
}

/** Read the process behind every terminal tab of this window. */
async function tabsByPid(vscode) {
  const tabs = new Map();
  for (const terminal of vscode.window.terminals) {
    const pid = await terminals.pidOf(terminal);
    if (pid) {
      tabs.set(pid, terminal);
    }
  }
  return tabs;
}

/**
 * Open a terminal for one session, and attach it there.
 *
 * The line takes the session from any other client. tmux 2.7 has no
 * `window-size` option, so a shared window shrinks to the smallest client.
 * Taking leaves the view at the size of the terminal in front of the user.
 *
 * The shell stays alive behind the client, which two later clicks need. It
 * carries the client, so the client's parent names this tab. It also holds a
 * failed attach on screen, where an empty terminal would say nothing.
 */
async function openAndAttach(vscode, record, id, clients) {
  const line = `tmux attach -d -t '${id}'`;
  const held = opened.get(record.sessionId);
  if (held) {
    held.show(false);
    // A held terminal already running a client would read the line as
    // keystrokes, and send them to whatever runs inside it. So the line goes
    // only to a tab whose process is known, and carries no client.
    const heldPid = await terminals.pidOf(held);
    if (!heldPid) {
      return { went: "held", message: "The editor did not name the process of that tab, so nothing was sent." };
    }
    if (clients.some((one) => one.shell === heldPid)) {
      return { went: "held", message: "That tab already runs a tmux client, so nothing was sent." };
    }
    held.sendText(line);
    return { went: "reused", terminal: held, line };
  }
  const terminal = vscode.window.createTerminal({ name: describe.shortName(describe.nameOf(record), 20) });
  opened.set(record.sessionId, terminal);
  terminal.show(false);
  terminal.sendText(line);
  return { went: "attached", terminal, line };
}

/**
 * Decide how to reach one session, and change nothing.
 *
 * Four routes, in order: a tab of this window already holds the tmux
 * session, the tmux session runs with no tab here, the session runs outside
 * tmux, or nothing here can reach it. The report prints this decision, and
 * `goTo` acts on it, so both agree by construction.
 */
async function routeOf(vscode, record) {
  const life = roster.liveness(record);
  if (!life.here) {
    // Another login node holds this one. A tmux session of the same name
    // can run here as well, and attaching it would open the wrong session.
    return { kind: "elsewhere", why: life.reason || "another login node" };
  }

  const tabs = await tabsByPid(vscode);
  const target = roster.tmuxTarget(record);
  if (!target) {
    // No tmux, so the session runs under the shell of a tab directly.
    const shell = tmux.ancestorIn(record.pid, new Set(tabs.keys()));
    if (shell) {
      return { kind: "focus", shell, tabs };
    }
    return { kind: "none", why: "it runs outside tmux, and no tab here holds it", tabs };
  }

  const clients = await tmux.clientShells();
  const here = clients.find((one) => one.session === target.session && tabs.has(one.shell));
  if (here) {
    return { kind: "focus", shell: here.shell, tabs, clients };
  }

  const id = await tmux.sessionId(target.session);
  if (!id) {
    return { kind: "none", why: `tmux here reports no session ${target.session}`, tabs, clients };
  }
  return { kind: "attach", id, tabs, clients };
}

/** Go to one session, by the route `routeOf` chose. */
async function goTo(vscode, record) {
  const name = describe.nameOf(record);
  const route = await routeOf(vscode, record);

  if (route.kind === "elsewhere") {
    return { went: "elsewhere", message: `${name} runs on another login node. Nothing here can reach it.` };
  }
  if (route.kind === "focus") {
    route.tabs.get(route.shell).show(false);
    return { went: "focused", shell: route.shell };
  }
  if (route.kind === "none") {
    return { went: "missing", message: `${name} is out of reach, because ${route.why}.` };
  }
  return await openAndAttach(vscode, record, route.id, route.clients);
}

/**
 * Open a tab for every live session that has none here.
 *
 * This is the login ritual in one command. It runs when the user asks, and
 * never by itself, because opening tabs unasked would be a surprise.
 */
async function attachAll(vscode, records) {
  const result = { attached: [], already: [], skipped: [] };
  for (const record of records) {
    const went = await goTo(vscode, record);
    const name = describe.nameOf(record);
    if (went.went === "attached" || went.went === "reused") {
      result.attached.push(name);
    } else if (went.went === "focused" || went.went === "held") {
      result.already.push(name);
    } else {
      result.skipped.push(name);
    }
  }
  return result;
}

module.exports = { attachAll, forget, forgetAll, goTo, opened, routeOf };
