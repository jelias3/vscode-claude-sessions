"use strict";

const roster = require("./roster");
const tmux = require("./tmux");

/** Shorten a name, so one long session name cannot fill the status bar. */
function shortName(text, limit) {
  const name = String(text || "a session");
  return name.length > limit ? `${name.slice(0, limit - 1)}…` : name;
}

/** Name a session, falling back to its identifier. */
function nameOf(record) {
  return record.name || record.sessionId || "a session";
}

/** Name the tmux window a session sits in, as far as tmux will say. */
function whereIs(record) {
  const target = roster.tmuxTarget(record);
  if (!target) {
    return "";
  }
  const name = tmux.windowName(target.target);
  return name ? `tmux ${target.session}:${name}` : `tmux ${target.session}`;
}

/** Write the state of a session with the age of that state. */
function stateAge(record, now) {
  const state = record.status === "busy" ? "busy" : "idle";
  const age = roster.span((now || Date.now()) - (record.statusUpdatedAt || record.updatedAt || now || Date.now()));
  return `${state} ${age}`;
}

module.exports = { nameOf, shortName, stateAge, whereIs };
