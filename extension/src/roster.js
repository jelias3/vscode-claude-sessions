"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROSTER_FOLDER = "sessions";

let domain = null;

/** Find the directory that holds one record per running session. */
function rosterDirectory(configDirectory) {
  return path.join(configDirectory, ROSTER_FOLDER);
}

/**
 * Read the process domain of this host, the way a session record writes it.
 *
 * The record pairs the machine with the process namespace it ran in. A
 * process identifier only means something inside that pair.
 */
function processDomain() {
  if (domain !== null) {
    return domain;
  }
  try {
    const machine = fs.readFileSync("/etc/machine-id", "utf8").trim();
    const namespace = fs.readlinkSync("/proc/self/ns/pid");
    domain = `linux:${machine}:${namespace}`;
  } catch (error) {
    domain = "";
  }
  return domain;
}

/**
 * Read the start time the kernel holds for one process.
 *
 * A record stores this beside the process identifier. The pair defeats a
 * reused identifier, which a bare test for the process would not.
 */
function processStart(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    return fields[19]; // the start time, field 22 of the whole record
  } catch (error) {
    return "";
  }
}

/** Read every session record, and drop the ones that will not parse. */
function readRecords(directory) {
  let files = [];
  try {
    files = fs.readdirSync(directory);
  } catch (error) {
    return [];
  }
  const records = [];
  for (const name of files) {
    if (!name.endsWith(".json") || name.startsWith(".")) {
      continue;
    }
    try {
      const record = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
      if (record && record.pid) {
        records.push(record);
      }
    } catch (error) {
      continue;
    }
  }
  return records;
}

/**
 * Decide whether a session is still running.
 *
 * The record field updatedAt moves only when the status changes, so an age
 * cannot answer this. A session quiet for an hour is still a live session.
 * The kernel answers it instead, on this host alone.
 */
function liveness(record) {
  const here = processDomain();
  if (!here || record.pidDomain !== here) {
    return { live: null, here: false, reason: "another login node" };
  }
  const start = processStart(record.pid);
  if (!start) {
    return { live: false, here: true, reason: "the process has ended" };
  }
  if (record.procStart && String(record.procStart) !== start) {
    return { live: false, here: true, reason: "the identifier belongs to another process" };
  }
  return { live: true, here: true, reason: "" };
}

/** Split the tmux field, which reads session, then window, then pane. */
function tmuxTarget(record) {
  const raw = String((record || {}).tmux || "");
  const match = raw.match(/^([^:]+):(@[^.]+)\.(%.+)$/);
  if (!match) {
    return null;
  }
  return { target: raw, session: match[1], window: match[2], pane: match[3] };
}

/** Write a span in words, for a row of the list. */
function span(milliseconds) {
  const minutes = Math.round(Math.max(0, milliseconds) / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 90) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** Count how many live sessions are busy, and how many wait. */
function tally(records) {
  let busy = 0;
  let idle = 0;
  for (const record of records) {
    if (record.status === "busy") {
      busy += 1;
    } else {
      idle += 1;
    }
  }
  return { busy, idle, total: records.length };
}

module.exports = {
  liveness,
  processDomain,
  processStart,
  readRecords,
  rosterDirectory,
  span,
  tally,
  tmuxTarget,
};
