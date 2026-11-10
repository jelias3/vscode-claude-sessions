# Claude Code sessions in VS Code

A box in the Explorer lists every Claude Code session running on this machine. One click goes
to the terminal that runs a session. When no terminal here holds it, the click opens one and
attaches its tmux session.

```
Claude sessions
  ● writing-the-parser          busy 2m    tmux 0
  ○ reading-the-logs            idle 14m   tmux 1
```

A filled circle marks a busy session, and a hollow circle marks an idle one. An item in the
status bar counts them, as `1 busy, 1 idle`, for a window with the Explorer closed.

## It runs on Linux only

The extension asks the kernel which sessions are alive. It reads `/proc` and
`/etc/machine-id`, and neither exists on macOS or on Windows outside the Linux subsystem.

On those systems the box still lists the sessions, because Claude Code writes the records
anyway. Every row reads as a session on another machine, and every click says that nothing
here can reach it. So the extension is of no use there, and it breaks nothing either.

It works the same on a laptop and over a remote connection. A remote window runs it on the
remote machine, which is where the sessions are.

## Install it

Take `claude-code-tools.claude-status-<version>.vsix` from the releases page, then either:

- open the extensions panel, choose `Install from VSIX` in its menu, and pick the file, or
- run `code --install-extension claude-code-tools.claude-status-<version>.vsix`.

Reload the window afterwards, with `Developer: Reload Window`.

**There is nothing to configure.** The extension reads the session records Claude Code writes
by itself, in `~/.claude/sessions/`. A session appears in the box a moment after it starts.

To remove it, run `code --uninstall-extension claude-code-tools.claude-status`.

## What it needs

| it needs | why |
|---|---|
| Linux | the liveness test reads `/proc` |
| VS Code 1.75 or later | the extension interface it uses |
| Claude Code, which writes session records | the box reads nothing without them |
| tmux, for the attach route alone | the rest works without it |

**The session record is an internal file of Claude Code.** No documentation describes it, and
a later version may change it or drop it. These versions were measured: 2.1.309 and 2.1.311.
Run the report command below to see what your own version writes.

## Going to a session

A click takes the shortest route that works. Four cases, in this order:

| case | what the extension does |
|---|---|
| a terminal of this window holds the tmux session | bring that terminal to the front |
| the tmux session runs, and no terminal here holds it | open one, and run `tmux attach -d -t '$1'` |
| the session runs outside tmux | walk up its process chain to the terminal, and show it |
| nothing matches | say where the session is, and change nothing |

Case one needs no tmux command. The tmux client of a session runs under a shell, and in the
editor that shell is a terminal. The two match by process identifier.

Case two attaches by session identifier, never by name. tmux matches a name by prefix, so
`-t 1` can reach a session called `10`. An identifier such as `$1` names one session alone.

**The line carries `-d`, which takes the session from any other client.** A terminal elsewhere
showing that session goes blank. tmux 2.7 has no `window-size` option, so it shrinks a shared
window to the smallest client. Taking the session gives a better result than sharing it.
Change the line in `extension/src/attach.js` if your tmux is newer and you would rather share.

The new client runs under the shell of the terminal the extension opened. Case one therefore
takes over on every later click, so the two routes agree by construction.

**One terminal per session.** The extension holds the terminal it opened. A second click shows
that terminal again rather than opening another. Closing it drops the record, so the next
click opens a fresh one.

The command `Claude status: open a tab for every session` does the whole round at once. It
opens a terminal for every session with none here. Nothing attaches by itself when the window
opens, because terminals appearing unasked would be a surprise.

## The commands

| command | what it does |
|---|---|
| `Claude status: show the live Claude sessions` | the same list, as a pick list |
| `Claude status: open a tab for every session` | attach every session with no terminal here |
| `Claude status: read the roster again` | read now, rather than waiting for the next read |
| `Claude status: report what it can see` | write the report described below |

## The settings

| setting | default | holds |
|---|---|---|
| `claudeStatus.configDirectory` | empty | the Claude Code configuration directory |
| `claudeStatus.stateDirectory` | empty | the directory the optional writer fills |
| `claudeStatus.pollSeconds` | 2 | seconds between two reads |
| `claudeStatus.noticeSeconds` | 10 | how long the idle notice stays |

An empty configuration directory means the variable `CLAUDE_CONFIG_DIR` decides, and then
`~/.claude`. Set it when your editor does not read the shell profile that exports the
variable.

## When it shows nothing

Run `Claude status: report what it can see`. It opens a report and saves a copy to
`<configuration directory>/vscode-claude-status-report.txt`.

The report names the directory it read, every record it found and every terminal in the
window. It then gives the route a click on each row would take. It sends no tmux command, so running it changes
nothing.

Three answers cover almost every empty box. The configuration directory is wrong, so the
report names a directory with no records in it. The records are there but read as dead, which
means your Claude Code writes a different record. Or the sessions run on another machine than
the editor server.

## How a session reads as live

A record holds a process identifier, and the field `updatedAt` moves only when the status
changes. So an age cannot say whether a session lives, and a quiet session is still a live
one.

The kernel answers instead. The record keeps the process identifier and the start time the
kernel holds, and both must match `/proc`. The pair defeats an identifier the kernel has given
to some later process.

That test needs the machine the session runs on. A record names its machine and its process
namespace, which the extension compares against its own. A record from another machine reads
as unknown rather than live or dead, and it reaches no route.

A session that leaves the busy state turns the status bar item into a notice for ten seconds.
Nothing covers the editor. The item holds one notice at a time, so two sessions finishing
together show the second one alone.

## Build it, and test it

```bash
tools/build_vsix.sh                 # the file lands in build/
<node> tools/test_extension.js      # 52 checks, with a stub for the editor
```

The build needs `bash`, `zip` and `python3`, and it reaches no network. A `.vsix` file is a
zip holding the extension, a manifest and a table of content types, and the script writes all
three.

The test needs the copy of Node.js that VS Code ships, under
`~/.vscode-server/cli/servers/*/server/node` on a remote machine. It measures the liveness
test, the idle notice, the rows of the box and all four routes. The routes that need tmux skip
themselves when no tmux session is running.

## The terminal status line, which is extra

`statusline/claude_status_writer.py` draws the model and two bars under the prompt of each
Claude Code session. The extension does not need it, and nothing but the report reads what it
stores. `docs/statusline.md` says how to wire it in.

## More

`docs/design.md` records why each part works the way it does.

Licensed under the MIT license.
