"use strict";

// Run the extension outside VS Code, against the records on disk.
// A stub stands in for the editor, so this needs no editor and no install.
//
//   <server>/node tools/test_extension.js

const Module = require("module");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const EXTENSION = path.resolve(__dirname, "..", "extension");
// The Claude Code configuration directory of whoever runs this test.
const CONFIG_DIR = (process.env.CLAUDE_CONFIG_DIR || "").trim() || path.join(os.homedir(), ".claude");

const made = [];
const terminalsMade = [];
const closeListeners = [];
const fired = { count: 0 };
// The test changes these, to point the extension at a directory of its own.
const configValues = { stateDirectory: "", pollSeconds: 2, noticeSeconds: 10 };

const stub = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  ThemeIcon: class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  },
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  EventEmitter: class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (listener) => {
        this.listeners.push(listener);
        return { dispose() {} };
      };
    }
    fire(value) {
      fired.count += 1;
      for (const listener of this.listeners) {
        listener(value);
      }
    }
    dispose() {}
  },
  window: {
    terminals: [],
    createStatusBarItem(alignment, priority) {
      const item = { alignment, priority, shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
      made.push(item);
      return item;
    },
    createTreeView(id, options) {
      return { id, options, dispose() {} };
    },
    createTerminal(options) {
      const terminal = {
        name: options.name,
        sent: [],
        shows: 0,
        // The editor names a real process for a tab. A tab of this stub
        // takes a number no tmux client runs under.
        processId: Promise.resolve(900000 + terminalsMade.length),
        sendText(text) { this.sent.push(text); },
        show() { this.shows += 1; },
        dispose() {},
      };
      terminalsMade.push(terminal);
      stub.window.terminals = stub.window.terminals.concat([terminal]);
      return terminal;
    },
    onDidCloseTerminal(listener) {
      closeListeners.push(listener);
      return { dispose() {} };
    },
    showInformationMessage(text) {
      stub.window.lastMessage = text;
      return Promise.resolve(undefined);
    },
    showQuickPick() {
      return Promise.resolve(undefined);
    },
    lastMessage: "",
  },
  commands: {
    registerCommand(name) {
      return { name, dispose() {} };
    },
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
    getConfiguration() {
      return { get: (key, fallback) => (configValues[key] === undefined ? fallback : configValues[key]) };
    },
    onDidChangeConfiguration() {
      return { dispose() {} };
    },
  },
};

const load = Module._load;
Module._load = function (request, parent, isMain) {
  return request === "vscode" ? stub : load(request, parent, isMain);
};

const attach = require(path.join(EXTENSION, "src", "attach"));
const render = require(path.join(EXTENSION, "src", "render"));
const roster = require(path.join(EXTENSION, "src", "roster"));
const state = require(path.join(EXTENSION, "src", "state"));
const tmuxModule = require(path.join(EXTENSION, "src", "tmux"));
const extension = require(path.join(EXTENSION, "extension"));

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  pass  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${name}: ${error.message}`);
  }
}

function record(fields) {
  return Object.assign(
    {
      pid: process.pid,
      sessionId: "test-session",
      name: "a test session",
      cwd: "/shared/folder",
      status: "idle",
      statusUpdatedAt: Date.now(),
      updatedAt: Date.now(),
      pidDomain: roster.processDomain(),
      procStart: roster.processStart(process.pid),
    },
    fields
  );
}

console.log("the age of a record");
check("a fresh record reads in seconds", () => assert.strictEqual(render.age(3000), "3s ago"));
check("an old record reads in minutes", () => assert.strictEqual(render.age(600000), "10m ago"));
check("a very old record reads in hours", () => assert.strictEqual(render.age(7200000), "2h ago"));

console.log("the live state directory, which the report reads");
const directory = state.stateDirectory("");
const payloads = state.readPayloads(directory);
console.log(`  directory: ${directory}`);
console.log(`  payloads:  ${payloads.length}`);
check("at least one payload is readable", () => assert.ok(payloads.length > 0));
check("a payload carries the time it was written", () => assert.ok(state.writtenAt(payloads[0]) > 0));

console.log("the roster");
check("the tmux field splits into session, window and pane", () => {
  const parsed = roster.tmuxTarget({ tmux: "1:@1.%1" });
  assert.deepStrictEqual([parsed.session, parsed.window, parsed.pane], ["1", "@1", "%1"]);
});
check("a record with no tmux field gives nothing", () => assert.strictEqual(roster.tmuxTarget({}), null));
check("this process reads as live", () => assert.strictEqual(roster.liveness(record({})).live, true));
check("a wrong start time reads as another process", () => {
  const life = roster.liveness(record({ procStart: "1" }));
  assert.strictEqual(life.live, false);
  assert.ok(life.reason.includes("another process"));
});
check("a record from another host reads as unknown", () => {
  assert.strictEqual(roster.liveness({ pid: 1, pidDomain: "linux:other:pid:[1]" }).live, null);
});
check("the tally counts both states", () => {
  assert.deepStrictEqual(roster.tally([{ status: "busy" }, { status: "idle" }, { status: "idle" }]), { busy: 1, idle: 2, total: 3 });
});

console.log("the walk up the process chain");
const chain = [];
let climb = process.ppid;
for (let step = 0; step < 4 && climb > 1; step += 1) {
  chain.push(climb);
  climb = tmuxModule.parentOf(climb);
}
check("the walk finds an ancestor of this process", () => assert.ok(chain.includes(tmuxModule.ancestorIn(process.pid, new Set(chain)))));
check("the walk gives nothing when no ancestor is known", () => assert.strictEqual(tmuxModule.ancestorIn(process.pid, new Set([987654])), 0));
check("the walk stops at the depth it is given", () => assert.strictEqual(tmuxModule.ancestorIn(process.pid, new Set([chain[2]]), 1), 0));

console.log("the one status bar item, and the idle notice");
const home = path.resolve(__dirname, "..", ".test-config");
const sessions = path.join(home, "sessions");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(sessions, { recursive: true });

function writeRecord(id, name, status, pid) {
  fs.writeFileSync(
    path.join(sessions, `${pid}.json`),
    JSON.stringify(record({ pid, sessionId: id, name, status, procStart: roster.processStart(pid), tmux: "0:@0.%0" }))
  );
}

const beforeHome = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = home;
configValues.stateDirectory = path.join(home, "statusline-state");
made.length = 0;
extension.activate({ subscriptions: [] });
const rosterItem = () => made[0];

check("the extension builds one status bar item", () => assert.strictEqual(made.length, 1));

writeRecord("live-one", "a working session", "busy", process.pid);
writeRecord("dead-one", "a session that ended", "busy", 999999);
extension.refresh();
check("the first read raises no notice", () => assert.ok(rosterItem().text.startsWith("$(server)")));
check("a record whose process ended is dropped", () => assert.strictEqual(rosterItem().text, "$(server) 1 busy"));
check("no model name reaches the status bar", () => assert.ok(!/Opus|Sonnet|Haiku/.test(rosterItem().text)));
check("no bar reaches the status bar", () => assert.ok(!/[█▏▎▍▌▋▊▉░]/.test(rosterItem().text)));

console.log("the box in the Explorer");
const box = extension.tree();
check("the box lists the live session only", () => {
  const rows = box.getChildren();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].sessionId, "live-one");
});
check("a row carries the name, the state and the window", () => {
  const row = box.getTreeItem(box.getChildren()[0]);
  assert.strictEqual(row.label, "a working session");
  assert.ok(row.description.startsWith("busy"));
  assert.ok(row.description.includes("tmux 0"));
});
check("a row clicks through to one command", () => {
  const row = box.getTreeItem(box.getChildren()[0]);
  assert.strictEqual(row.command.command, "claudeStatus.goTo");
  assert.strictEqual(row.command.arguments[0].sessionId, "live-one");
});
check("a busy row takes the filled circle", () => assert.strictEqual(box.getTreeItem(box.getChildren()[0]).iconPath.id, "circle-filled"));
check("the tooltip names no model", () => assert.ok(!/Opus|Sonnet|Haiku/.test(box.getTreeItem(box.getChildren()[0]).tooltip)));
const firedBefore = fired.count;
extension.refresh();
check("an unchanged roster does not redraw the box", () => assert.strictEqual(fired.count, firedBefore));
writeRecord("live-one", "a working session", "idle", process.pid);
extension.refresh();
check("a changed roster redraws the box once", () => assert.strictEqual(fired.count, firedBefore + 1));
check("an idle row takes the hollow circle", () => assert.strictEqual(box.getTreeItem(box.getChildren()[0]).iconPath.id, "circle-outline"));

console.log("the idle notice");
check("a session that leaves busy raises the notice", () => assert.ok(rosterItem().text.startsWith("$(bell)")));
check("the notice names the session", () => assert.ok(rosterItem().text.includes("a working session")));
check("the notice is orange", () => assert.strictEqual(rosterItem().color, render.NOTICE_COLOR));

extension.refresh();
check("the notice holds for its whole time", () => assert.ok(rosterItem().text.startsWith("$(bell)")));

// The holding time is fixed when a notice fires, so a second notice has to
// fire for a shorter one to apply.
writeRecord("live-one", "a working session", "busy", process.pid);
extension.refresh();
configValues.noticeSeconds = 0.05;
writeRecord("live-one", "a working session", "idle", process.pid);
extension.refresh();
check("a second notice fires on the next turn", () => assert.ok(rosterItem().text.startsWith("$(bell)")));

Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
extension.refresh();
check("the notice gives way to the count", () => assert.strictEqual(rosterItem().text, "$(server) 1 idle"));
configValues.noticeSeconds = 10;

fs.rmSync(path.join(sessions, `${process.pid}.json`));
extension.refresh();
check("an empty roster still says the extension runs", () => {
  assert.strictEqual(rosterItem().text, "$(server) no Claude session");
  assert.strictEqual(rosterItem().shown, true);
});
check("an empty roster empties the box", () => assert.strictEqual(box.getChildren().length, 0));

extension.deactivate();
fs.rmSync(home, { recursive: true, force: true });
if (beforeHome === undefined) {
  delete process.env.CLAUDE_CONFIG_DIR;
} else {
  process.env.CLAUDE_CONFIG_DIR = beforeHome;
}

console.log("the four routes a click can take");
process.env.CLAUDE_CONFIG_DIR = CONFIG_DIR;
configValues.stateDirectory = "";
made.length = 0;
terminalsMade.length = 0;
closeListeners.length = 0;
stub.window.terminals = [];
extension.activate({ subscriptions: [] });

(async () => {
  // A record from another machine must reach no tmux and open no tab.
  const far = record({ sessionId: "far-one", name: "a far session", pidDomain: "linux:other:pid:[1]", tmux: "0:@0.%0" });
  const farRoute = await attach.routeOf(stub, far);
  const farWent = await extension.goTo(far);
  check("another machine gives no route", () => assert.strictEqual(farRoute.kind, "elsewhere"));
  check("another machine opens no terminal", () => assert.strictEqual(attach.opened.size, 0));
  check("another machine says where the session is", () => assert.ok(farWent.message.includes("another machine")));

  // A session outside tmux is reached by walking up to the tab that runs it.
  const ancestor = chain[chain.length - 1];
  stub.window.terminals = [{ name: "a shell", processId: Promise.resolve(ancestor), show() { this.shown = true; } }];
  const bare = record({ sessionId: "bare-one", name: "a session outside tmux" });
  const bareRoute = await attach.routeOf(stub, bare);
  check("a session outside tmux routes to the walk", () => {
    assert.strictEqual(bareRoute.kind, "focus");
    assert.strictEqual(bareRoute.shell, ancestor);
  });
  await extension.goTo(bare);
  check("the walk brings that tab to the front", () => assert.strictEqual(stub.window.terminals[0].shown, true));

  // A live tmux session with no tab in this window must open one and attach.
  const live = roster
    .readRecords(roster.rosterDirectory(CONFIG_DIR))
    .filter((one) => roster.liveness(one).live && roster.tmuxTarget(one));
  if (!live.length) {
    console.log("  skipped the tmux routes, no live tmux session on this host");
    return finish();
  }
  const target = roster.tmuxTarget(live[0]);
  const id = await tmuxModule.sessionId(target.session);
  const shell = await tmuxModule.attachingShell(target.session);
  if (!id || !shell) {
    console.log("  skipped the tmux routes, tmux does not answer here");
    return finish();
  }

  // No tab of this window holds it, so the click opens one.
  stub.window.terminals = [];
  const went = await extension.goTo(live[0]);
  check("a tmux session with no tab here opens one terminal", () => {
    assert.strictEqual(went.went, "attached");
    assert.strictEqual(terminalsMade.length, 1);
  });
  check("the terminal takes the name of the session", () => assert.strictEqual(terminalsMade[0].name.slice(0, 8), (live[0].name || "").slice(0, 8)));
  check("it attaches by identifier, and takes the session", () => assert.deepStrictEqual(terminalsMade[0].sent, [`tmux attach -d -t '${id}'`]));
  check("the identifier is the one tmux holds", () => assert.ok(/^\$\d+$/.test(id)));

  const again = await extension.goTo(live[0]);
  check("a second click reuses that terminal", () => {
    assert.strictEqual(again.went, "reused");
    assert.strictEqual(terminalsMade.length, 1);
  });

  // Closing the tab must drop it, so the next click opens a fresh one.
  for (const listener of closeListeners) {
    listener(terminalsMade[0]);
  }
  check("closing the tab drops it from the reuse map", () => assert.strictEqual(attach.opened.size, 0));

  // A tab whose process the editor never names must take no line. The line
  // would otherwise reach whatever runs inside it, as keystrokes.
  const stuck = { name: "a stuck tab", sent: [], processId: new Promise(() => {}), show() { this.shown = true; } };
  attach.opened.set(live[0].sessionId, stuck);
  stub.window.terminals = [];
  const stuckWent = await extension.goTo(live[0]);
  check("a tab with no readable process takes no line", () => {
    assert.strictEqual(stuckWent.went, "held");
    assert.strictEqual(stuck.sent.length, 0);
  });
  check("the stuck tab still comes to the front", () => assert.strictEqual(stuck.shown, true));
  attach.opened.clear();

  // A tab of this window that holds the client is focused, not re-attached.
  const held = { name: "the holding tab", processId: Promise.resolve(shell), show() { this.shown = true; } };
  stub.window.terminals = [held];
  const focused = await extension.goTo(live[0]);
  check("a tmux session held by a tab here is focused", () => assert.strictEqual(focused.went, "focused"));
  check("focusing brings that tab to the front", () => assert.strictEqual(held.shown, true));
  check("focusing opens no second terminal", () => assert.strictEqual(terminalsMade.length, 1));

  // The one command, with every session already in a tab.
  const all = await extension.attachAll();
  check("attaching everything skips the sessions already here", () => assert.ok(all.already.length >= 1));

  console.log(`  routed ${live[0].name} to tmux ${target.session}, identifier ${id}, shell ${shell}`);
  finish();
})();

function finish() {
  extension.deactivate();
  console.log(failures ? `\n${failures} failures` : "\nevery check passed");
  process.exit(failures ? 1 : 0);
}
