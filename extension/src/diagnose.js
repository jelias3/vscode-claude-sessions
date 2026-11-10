"use strict";

const fs = require("fs");
const path = require("path");

const render = require("./render");
const attach = require("./attach");
const roster = require("./roster");
const state = require("./state");
const terminals = require("./terminals");
const tmux = require("./tmux");

const REPORT_NAME = "vscode-claude-status-report.txt";

/** Write one route in a line, the way the report shows it. */
function sayRoute(route) {
  if (route.kind === "focus") {
    const tab = route.tabs.get(route.shell);
    return `focus the tab of shell ${route.shell}, named "${tab ? tab.name : "unknown"}"`;
  }
  if (route.kind === "attach") {
    return `open a terminal, and run tmux attach -d -t '${route.id}'`;
  }
  if (route.kind === "elsewhere") {
    return `nothing, because the record comes from ${route.why}`;
  }
  return `nothing, because ${route.why}`;
}

/**
 * Write what the extension can see, and say where the report went.
 *
 * One link in the jump cannot be tested outside the editor: the process
 * identifier the editor gives for a terminal must equal the one the kernel
 * gives. This report puts both numbers side by side.
 */
async function report(vscode, option, now) {
  const lines = [];
  const say = (text) => lines.push(text);

  say(`Claude status, written ${new Date(now).toLocaleString()}`);
  say("");

  const payloads = state.readPayloads(option.directory);
  say(`State directory: ${option.directory}`);
  say(`  payloads: ${payloads.length}`);
  for (const payload of payloads) {
    const model = (payload.model || {}).display_name || "unknown";
    say(`  ${payload.session_id}  ${model}  updated ${render.age(now - state.writtenAt(payload))}`);
  }
  say("");

  const records = roster.readRecords(option.roster);
  say(`Roster directory: ${option.roster}`);
  say(`  records: ${records.length}`);
  say(`  this host: ${roster.processDomain()}`);
  for (const record of records) {
    const life = roster.liveness(record);
    const target = roster.tmuxTarget(record);
    say(`  pid ${record.pid}  ${record.status}  live=${life.live}  tmux=${target ? target.target : "none"}  ${record.name || record.sessionId}`);
    if (life.reason) {
      say(`      ${life.reason}`);
    }
  }
  say("");

  say("Terminal tabs in this window:");
  const tabs = [];
  for (const terminal of vscode.window.terminals) {
    const pid = await terminals.pidOf(terminal);
    tabs.push({ name: terminal.name, pid });
    say(`  "${terminal.name}"  processId=${pid}`);
  }
  if (!tabs.length) {
    say("  none");
  }
  say("");

  say("Matching each session to a tab:");
  for (const record of records) {
    const target = roster.tmuxTarget(record);
    if (!target) {
      say(`  ${record.name || record.sessionId}: no tmux field, so no client to find`);
      continue;
    }
    const shell = await tmux.attachingShell(target.session);
    const tab = tabs.find((one) => one.pid === shell);
    say(`  ${record.name || record.sessionId}: tmux ${target.session} -> client shell ${shell || "none"} -> ${tab ? `tab "${tab.name}"` : "no tab here"}`);
  }
  say("");

  say("What a click on each row would do:");
  for (const record of records) {
    const route = await attach.routeOf(vscode, record);
    say(`  ${record.name || record.sessionId}: ${sayRoute(route)}`);
  }
  say("");
  say("A line ending in a tab name proves the editor and the kernel agree.");
  say("A shell replaced by its own tmux client cannot match, because no shell is left.");
  say("This report reads the routes and sends no tmux command, so it changes nothing.");

  const where = path.join(option.config || state.configDirectory(), REPORT_NAME);
  const text = lines.join("\n");
  try {
    fs.writeFileSync(where, `${text}\n`);
  } catch (error) {
    return { text, where: `could not write the report: ${error.message}` };
  }
  return { text, where };
}

module.exports = { report, REPORT_NAME };
