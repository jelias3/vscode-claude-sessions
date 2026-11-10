"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Where Claude Code keeps its configuration, when nothing else names it.
const DEFAULT_CONFIG_FOLDER = ".claude";
const STATE_FOLDER = "statusline-state";

/** Turn a path a person typed into one the file system takes. */
function expand(value) {
  return path.resolve(String(value).trim().replace(/^~/, os.homedir()));
}

/**
 * Find the directory the status writer fills.
 *
 * The setting wins. The configuration directory supplies the rest.
 */
function stateDirectory(setting, configSetting) {
  if (setting && String(setting).trim()) {
    return expand(setting);
  }
  return path.join(configDirectory(configSetting), STATE_FOLDER);
}

/**
 * Find the Claude Code configuration directory, which holds the roster.
 *
 * The setting wins. The variable CLAUDE_CONFIG_DIR, which names that same
 * directory, comes next. The usual place comes last, because the editor
 * server does not always read the shell profile that sets the variable.
 */
function configDirectory(setting) {
  if (setting && String(setting).trim()) {
    return expand(setting);
  }
  const fromEnvironment = process.env.CLAUDE_CONFIG_DIR;
  if (fromEnvironment && fromEnvironment.trim()) {
    return expand(fromEnvironment);
  }
  return path.join(os.homedir(), DEFAULT_CONFIG_FOLDER);
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
