# Claude Code status for VS Code

Three displays of what the Claude Code sessions on midway3 are doing. A terminal status line
holds the model and the two bars. A box in the Explorer lists the live sessions, and one click
goes to the session. A status bar item holds the count.

The plan is `/scratch/midway3/jelias3/claude-data/plans/vscode-claude-status-bar.md`.

## Parts

| path | role |
|---|---|
| `statusline/claude_status_writer.py` | runs as the Claude Code `statusLine` command, stores each payload |
| `tools/check_payload.py` | prints what a stored payload holds |
| `extension/` | the VS Code extension itself |
| `tools/test_extension.js` | runs the extension outside VS Code, against the live payloads |
| `tools/build_vsix.sh` | packs the extension into one installable file |

## What each display holds

**The terminal status line**, written by `claude_status_writer.py`, holds the model in light
blue, `Context` in purple, and `5hr Session Usage` in orange. Each bar holds six cells, and a
cell fills in eighths. Claude Code draws it under the prompt of its own session.

**The box in the Explorer**, under the file tree, gives one row per live session. A row holds
the name, the state with its age, and the tmux session. A filled circle marks a busy session
and a hollow one marks an idle session. Clicking a row goes to that session.

**The VS Code status bar** holds one item, which counts the live sessions as `1 busy, 1 idle`.
It names no model and draws no bar. The terminal line already gives those, and one number in
two places is one number too many.

Neither VS Code display names a model. Clicking the status bar item opens the same list as a
palette command, for a window with the Explorer closed.

The extension reads the roster every two seconds. It never calls the network, and it never
reaches the model, so it costs no tokens.

Three settings change its behaviour: `claudeStatus.stateDirectory`, `claudeStatus.pollSeconds`
and `claudeStatus.noticeSeconds`.

## Install it

```bash
tools/build_vsix.sh
SERVER=$(ls -dt /home/jelias3/.vscode-server/cli/servers/*/server | head -1)
"$SERVER/bin/code-server" --install-extension build/jelias3.claude-status-<version>.vsix
```

The build needs no network and no package manager. A `.vsix` is a zip holding the extension,
a manifest, and a table of content types, and the script writes all three.

An install lands in `~/.vscode-server/extensions/`, and the running window does not see it
until a reload. Reload with the command `Developer: Reload Window`.

To remove it, run the same command with `--uninstall-extension jelias3.claude-status`.

## Check it in a live window

Run `Claude status: report what it can see` from the command palette. It opens a report and
saves a copy to `claude-data/vscode-claude-status-report.txt`.

The report lists the payloads, the session records, and the terminal tabs. Each tab comes
with the process identifier the editor gives it. The report then matches every session to a
tab, which is the one link no test outside the editor can prove. A line ending in a tab name proves
the editor and the kernel agree on the number.

A last section names the route a click on each row would take. The report reads the routes and
sends no tmux command, so running it changes nothing.

## The roster

A second directory, `claude-data/sessions/`, holds one record per running session. That
directory is the roster. It lists every session, and the status directory lists only the
sessions that ran a turn lately.

**A record does not say whether its session lives.** The field `updatedAt` moves when the
status changes, and nothing else moves it, so an idle session can hold an hour old record. The
kernel settles it instead: the record keeps the process identifier and the process start time,
and both must match `/proc`. The pair defeats a reused identifier.

That test needs the host the session runs on. A record names its machine and its process
namespace, which the extension compares against its own. A record from another login node
reads as unknown rather than live or dead.

A session that leaves the busy state turns the roster item into a notice for ten seconds, in
orange. Nothing covers the editor. The first read raises no notice, and a dead record raises
none.

**The item holds one notice at a time.** Two sessions that finish within ten seconds of each
other show the second one only. Two sessions make that rare, and more would need a queue.

## Going to a session

A click takes the shortest route that works. Four cases, in this order:

| case | what the extension does |
|---|---|
| a tab of this window holds the tmux session | bring that tab to the front |
| the tmux session runs, and no tab here holds it | open a terminal, and run `tmux attach -d -t '$1'` |
| the session runs outside tmux | walk up its process chain to the tab, and bring it forward |
| nothing matches | say where the session is, and change nothing |

Case one needs no tmux command. The tmux client of a session runs under a shell, and in the
editor that shell is a terminal tab. The two match by process identifier.

Case two attaches by identifier, never by name. tmux matches a name by prefix, so `-t 1` can
reach a session called `10`. An identifier such as `$1` names one session and no other.

The line carries `-d`, which takes the session from any other client. tmux 2.7 runs here and
has no `window-size` option, so a shared window shrinks to the smallest client. Taking leaves
the session at the size of the terminal in front of you.

The new client runs under the shell of the terminal the extension opened. Case one therefore
takes over on every later click, so the two routes agree by construction.

**A record from another login node reaches nothing, by design.** A tmux session of the same
name can run on this node too, and attaching it would open the wrong session.

**One tab per session.** The extension holds the terminal it opened for a session. A second
click shows that tab again rather than opening another. Closing the tab drops it, so the next
click opens a fresh one.

The command `Claude status: open a tab for every session` runs the whole login ritual at once.
It opens a tab for each session with none here. Nothing attaches by itself when the window
opens, because tabs appearing unasked would be a surprise.

**Two sessions can share one folder.** Both of the sessions running here report the same
working directory. The roster never needs to tell them apart, because it lists every session
by name rather than choosing one.

## Check the extension without installing it

```bash
NODE=$(ls -dt /home/jelias3/.vscode-server/cli/servers/*/server/node | head -1)
$NODE tools/test_extension.js
```

A stub stands in for the editor, so this needs no install. It measures the liveness test, the
notice that a session went idle, the rows of the box, and all four routes a click can take.
The routes run against the real roster and the real tmux on this host.

## How the writer is wired in

`settings.json` in the Claude Code configuration directory holds this block:

```json
"statusLine": {
  "type": "command",
  "command": "/scratch/midway3/jelias3/claude-data/vscode-claude-status/statusline/claude_status_writer.py",
  "refreshInterval": 2
}
```

Claude Code picked the block up without a restart. It then calls the writer at least every
two seconds, and the writer stores one file per session in
`$CLAUDE_CONFIG_DIR/statusline-state/`. To remove the writer, delete that block.

The variable `CLAUDE_CONFIG_DIR` names the Claude Code configuration directory. It is
`/scratch/midway3/jelias3/claude-data` on midway3.

## What a live payload holds

Measured on 2026-11-09, under Claude Code 2.1.311.

| field | example | note |
|---|---|---|
| `model.display_name` | `Opus 5 (1M context)` | |
| `context_window.used_percentage` | `19` | out of `context_window_size`, 1,000,000 |
| `rate_limits.five_hour.used_percentage` | `10` | live, and it updates |
| `rate_limits.five_hour.resets_at` | `1794261000` | epoch seconds, not a date string |
| `rate_limits.seven_day` | absent | this account reports no weekly quota |
| `cost.total_cost_usd` | `5.20` | a real figure on a subscription |
| `prompt_cache.expires_at` | `1794250923` | epoch seconds, one hour after the last write |
| `prompt_cache.recache_tokens_if_cold` | `194660` | tokens a cold cache would re-read |
| `effort.level`, `thinking.enabled`, `fast_mode` | `high`, `true`, `false` | |
| `workspace.current_dir`, `session_name`, `transcript_path` | | used to match a session to a folder |

The cached copy in `.claude.json` is four days old and says 4%, where the live payload says
10%. So the extension reads the live payload and never that cache.
