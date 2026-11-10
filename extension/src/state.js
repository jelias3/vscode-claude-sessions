"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Where the status writer puts its files, when nothing else names a directory.
const DEFAULT_CONFIG_DIR = "/scratch/midway3/jelias3/claude-data";
const STATE_FOLDER = "statusline-state";

/**
 * Find the directory the status writer fills.
 *
 * The setting wins. The variable CLAUDE_CONFIG_DIR, which names the Claude
 * Code configuration directory, comes next. The default path comes last,
 * because the editor server does not always read the shell profile.
 */
function stateDirectory(setting) {
  if (setting && String(setting).trim()) {
    return path.resolve(String(setting).trim().replace(/^~/, os.homedir()));
  }
  return path.join(configDirectory(), STATE_FOLDER);
}

/** Find the Claude Code configuration directory, which holds both parts. */
function configDirectory() {
  const fromEnvironment = process.env.CLAUDE_CONFIG_DIR;
  return fromEnvironment && fromEnvironment.trim() ? fromEnvironment.trim() : DEFAULT_CONFIG_DIR;
}

/**
 * Read every stored payload in the directory.
 *
 * A read can fail while the writer renames a file, so each failure drops one
 * payload and never stops the others.
 */
function readPayloads(directory) {
  let names = [];
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    return [];
  }
  const payloads = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) {
      continue;
    }
    try {
      const text = fs.readFileSync(path.join(directory, name), "utf8");
      const payload = JSON.parse(text);
      if (payload && typeof payload === "object") {
        payload.state_file = path.join(directory, name);
        payloads.push(payload);
      }
    } catch (error) {
      continue;
    }
  }
  return payloads;
}

/** Read the time a payload was written, in milliseconds since the epoch. */
function writtenAt(payload) {
  const value = Number((payload || {}).written_at_ms);
  return Number.isFinite(value) ? value : 0;
}

module.exports = {
  configDirectory,
  readPayloads,
  stateDirectory,
  writtenAt,
};
