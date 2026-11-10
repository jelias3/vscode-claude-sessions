"use strict";

const vscode = require("vscode");
const attach = require("./src/attach");
const describe = require("./src/describe");
const diagnose = require("./src/diagnose");
const render = require("./src/render");
const roster = require("./src/roster");
const state = require("./src/state");
const tmux = require("./src/tmux");
const tree = require("./src/tree");

let item = null;
let box = null;
let timer = null;
// The records the last read found. The item and the box both draw from it.
let lastLive = [];
// The status each live session held on the last read, by session identifier.
// A session that moves from busy to anything else has finished a turn.
let lastStatus = new Map();
let readOnce = false;
// The notice the item shows, and the moment it stops showing it.
let notice = { text: "", until: 0 };

/** Read the settings of this extension in one object. */
function settings() {
  const config = vscode.workspace.getConfiguration("claudeStatus");
  const configured = state.configDirectory(config.get("configDirectory"));
  return {
    config: configured,
    directory: state.stateDirectory(config.get("stateDirectory"), configured),
    roster: roster.rosterDirectory(configured),
    noticeSeconds: config.get("noticeSeconds", 10),
    pollSeconds: config.get("pollSeconds", 2),
  };
}

/** Read the sessions that have not ended, which both displays list. */
function liveRecords(option) {
  return roster.readRecords(option.roster).filter((record) => roster.liveness(record).live !== false);
}

/** Give the item its text, its color and its tooltip, then show it. */
function paint(text, color, tooltip) {
  item.text = text;
  item.tooltip = tooltip;
  item.color = color;
  item.show();
}

/** Write the line the status bar holds when a session finishes a turn. */
function noticeText(record) {
  const where = describe.whereIs(record);
  return `$(bell) ${describe.shortName(describe.nameOf(record), 24)} idle${where ? "  " + where : ""}`;
}

/**
 * Raise a notice for each session that left the busy state.
 *
 * The first read sets the starting point and raises nothing. Without that
 * guard every session already idle would announce itself at startup.
 */
function noticeFromStatus(live, option, now) {
  const current = new Map();
  for (const record of live) {
    current.set(record.sessionId, record.status || "idle");
  }
  if (readOnce) {
    for (const [id, status] of current) {
      if (lastStatus.get(id) === "busy" && status !== "busy") {
        const record = live.find((one) => one.sessionId === id);
        notice = { text: noticeText(record), until: now + option.noticeSeconds * 1000 };
      }
    }
  }
  lastStatus = current;
  readOnce = true;
}

/** Write the tooltip that lists every live session. */
function rosterTooltip(live, now) {
  const rows = live.map((record) => {
    const place = describe.whereIs(record);
    return `${describe.stateAge(record, now)}  ${describe.nameOf(record)}${place ? "  " + place : ""}`;
  });
  rows.push("", "Click to open the list and go to a session.");
  return rows.join("\n");
}

/** Draw the status bar item from the records the last read found. */
function refreshRoster(live, option, now) {
  if (!live.length) {
    lastStatus = new Map();
    readOnce = false;
    paint("$(server) no Claude session", undefined, `No live session in ${option.roster}`);
    return;
  }

  noticeFromStatus(live, option, now);
  if (notice.until > now) {
    paint(notice.text, render.NOTICE_COLOR, rosterTooltip(live, now));
    return;
  }

  const count = roster.tally(live);
  const parts = [];
  if (count.busy) {
    parts.push(`${count.busy} busy`);
  }
  if (count.idle) {
    parts.push(`${count.idle} idle`);
  }
  paint(`$(server) ${parts.join(", ")}`, undefined, rosterTooltip(live, now));
}

/** Run the read, and never let one failure stop the timer. */
function safeRefresh() {
  const now = Date.now();
  try {
    const option = settings();
    tmux.refreshNames(now);
    lastLive = liveRecords(option);
    refreshRoster(lastLive, option, now);
  } catch (error) {
    item.text = "$(server) Claude roster failed";
    item.tooltip = String(error && error.stack ? error.stack : error);
    item.show();
  }
  // The box reads the same records, so one failure there must not hide the item.
  try {
    if (box) {
      box.refresh(now);
    }
  } catch (error) {
    // A box that will not draw is no reason to stop the item or the timer.
  }
}

/** Start the timer, and replace one that already runs. */
function startTimer() {
  if (timer) {
    clearInterval(timer);
  }
  const seconds = Math.max(1, settings().pollSeconds);
  timer = setInterval(safeRefresh, seconds * 1000);
}

/** Go to one session, and say so when nothing here can reach it. */
async function goTo(record) {
  if (!record || !record.sessionId) {
    return { went: "missing", message: "No session was given." };
  }
  const result = await attach.goTo(vscode, record);
  if (result.message) {
    vscode.window.showInformationMessage(result.message);
  }
  return result;
}

/** Open the list of live sessions, and go to the one the user picks. */
async function showRoster() {
  const option = settings();
  const now = Date.now();
  await tmux.refreshNames(now);

  const rows = liveRecords(option)
    .sort((a, b) => {
      const busy = Number(b.status === "busy") - Number(a.status === "busy");
      return busy || (b.statusUpdatedAt || 0) - (a.statusUpdatedAt || 0);
    })
    .map((record) => {
      const life = roster.liveness(record);
      const place = describe.whereIs(record);
      return {
        label: `${record.status === "busy" ? "$(circle-filled)" : "$(circle-outline)"} ${describe.nameOf(record)}`,
        description: `${describe.stateAge(record, now)}${place ? "   " + place : ""}`,
        detail: life.here ? record.cwd : `${record.cwd}   (${life.reason})`,
        record,
      };
    });

  if (!rows.length) {
    vscode.window.showInformationMessage(`No Claude session is running. The roster is ${option.roster}.`);
    return;
  }

  const picked = await vscode.window.showQuickPick(rows, {
    title: "The Claude sessions running now",
    placeHolder: "Go to the terminal tab that runs a session",
  });
  if (picked) {
    await goTo(picked.record);
  }
}

/**
 * Open a tab for every session with none here, which is the login ritual.
 *
 * It runs when the user asks for it. Nothing attaches by itself when the
 * window opens, because tabs appearing unasked would be a surprise.
 */
async function attachAll() {
  const option = settings();
  await tmux.refreshNames(Date.now());
  const here = liveRecords(option).filter((record) => roster.liveness(record).here);
  if (!here.length) {
    vscode.window.showInformationMessage("No Claude session runs on this machine.");
    return { attached: [], already: [], skipped: [] };
  }

  const result = await attach.attachAll(vscode, here);
  const parts = [];
  if (result.attached.length) {
    parts.push(`opened ${result.attached.length}`);
  }
  if (result.already.length) {
    parts.push(`${result.already.length} already here`);
  }
  if (result.skipped.length) {
    parts.push(`${result.skipped.length} out of reach`);
  }
  vscode.window.showInformationMessage(`Claude sessions: ${parts.join(", ")}.`);
  return result;
}

/** Write the report that shows what the extension can see. */
async function writeReport() {
  const result = await diagnose.report(vscode, settings(), Date.now());
  const document = await vscode.workspace.openTextDocument({ content: `${result.text}\n\nSaved to ${result.where}\n` });
  await vscode.window.showTextDocument(document, { preview: false });
}

function activate(context) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = "claudeStatus.showRoster";
  context.subscriptions.push(item);

  box = new tree.SessionTree(vscode, () => lastLive);
  context.subscriptions.push(box);
  context.subscriptions.push(vscode.window.createTreeView("claudeStatus.sessions", { treeDataProvider: box }));

  context.subscriptions.push(vscode.commands.registerCommand("claudeStatus.showRoster", showRoster));
  context.subscriptions.push(vscode.commands.registerCommand("claudeStatus.writeReport", writeReport));
  context.subscriptions.push(vscode.commands.registerCommand("claudeStatus.goTo", goTo));
  context.subscriptions.push(vscode.commands.registerCommand("claudeStatus.attachAll", attachAll));
  context.subscriptions.push(vscode.commands.registerCommand("claudeStatus.refresh", safeRefresh));

  // A tab the user closed must not be reused, so drop it when it goes.
  context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => attach.forget(terminal)));
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("claudeStatus")) {
        startTimer();
        safeRefresh();
      }
    })
  );
  safeRefresh();
  startTimer();
}

function deactivate() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  box = null;
  attach.forgetAll();
}

module.exports = { activate, attachAll, deactivate, goTo, refresh: safeRefresh, showRoster, tree: () => box };
