"use strict";

const describe = require("./describe");
const roster = require("./roster");

/**
 * The rows of the Explorer box, one per live Claude session.
 *
 * The box redraws from the same read the status bar already does. It fires a
 * redraw only when the rows changed, so an unchanged roster costs one string
 * compare and the box never flickers.
 */
class SessionTree {
  constructor(vscode, readRows) {
    this.vscode = vscode;
    this.readRows = readRows;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.rows = [];
    this.signature = "";
  }

  /** Read the roster again, and redraw only if a row changed. */
  refresh(now) {
    this.rows = this.readRows();
    const signature = this.rows
      .map((record) => [record.sessionId, record.status, describe.stateAge(record, now), describe.whereIs(record)].join("|"))
      .join("\n");
    if (signature !== this.signature) {
      this.signature = signature;
      this.emitter.fire();
    }
  }

  getChildren() {
    return this.rows;
  }

  getTreeItem(record) {
    const vscode = this.vscode;
    const busy = record.status === "busy";
    const life = roster.liveness(record);
    const where = describe.whereIs(record);
    const item = new vscode.TreeItem(describe.nameOf(record), vscode.TreeItemCollapsibleState.None);
    item.description = `${describe.stateAge(record)}${where ? "   " + where : ""}`;
    item.iconPath = new vscode.ThemeIcon(busy ? "circle-filled" : "circle-outline");
    item.tooltip = [
      `${describe.nameOf(record)} is ${busy ? "busy" : "idle"}.`,
      `Folder: ${record.cwd || "unknown"}`,
      where ? `Window: ${where}` : "This session runs outside tmux.",
      life.here ? "" : `This record comes from ${life.reason}.`,
      "",
      life.here ? "Click to go to this session." : "Nothing here can reach it.",
    ]
      .filter((line) => line !== "")
      .join("\n");
    item.command = { command: "claudeStatus.goTo", title: "Go to this session", arguments: [record] };
    item.contextValue = life.here ? "claudeSession" : "claudeSessionElsewhere";
    return item;
  }

  dispose() {
    this.emitter.dispose();
  }
}

module.exports = { SessionTree };
