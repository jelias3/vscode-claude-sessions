# Why each part works this way

The extension answers one question every two seconds: which Claude Code sessions are running,
and which terminal in this window holds each one. Everything below follows from that.

## Where the sessions come from

Claude Code keeps one small file per running session in `<configuration directory>/sessions/`,
named for the process identifier. A record holds the name, the working directory and the busy
or idle status. It also holds the tmux pane, the process identifier and the start time.

Nothing documents that file. It is an internal part of Claude Code, which uses it so that one
session can find another. The extension only reads it, and never writes there.

## It polls, and does not watch

A watch on a directory seems cheaper than a read every two seconds. It is not reliable on a
shared file system, which is where a remote window often keeps a home directory. A read of a
directory with a handful of small files costs almost nothing, so polling wins on both counts.

The extension reads once per tick and both displays draw from that one read. A failure in the
box therefore cannot hide the status bar item, and neither failure stops the timer.

## The kernel decides whether a session lives

The field `updatedAt` moves only when the status changes. A session that has waited an hour
for you holds an hour old record, and it is still alive. So an age cannot answer this.

The record carries a process identifier and the start time the kernel holds for it. Both must
match `/proc` for the session to read as live. The identifier alone is not enough, because the
kernel gives an identifier again once the number wraps.

That pair only means something on the machine that wrote it. So a record also names its
machine and its process namespace, and the extension compares them against its own. A record
from elsewhere reads as unknown, which is neither live nor dead.

**This is what ties the extension to Linux.** The test reads `/etc/machine-id` and
`/proc/<pid>/stat`, and the walk up a process chain reads `/proc/<pid>/stat` as well.

## Going to a session, in two halves

`routeOf` decides what a click would do and changes nothing. `goTo` acts on that decision.
The report command prints the decision, so the report and the click cannot disagree.

The decision takes four forms: focus a terminal, attach a tmux session, walk up a process
chain to a terminal, or do nothing and say why.

### Finding the terminal that already holds a session

`tmux list-clients` names the process of each client. The parent of that process is the shell
of a terminal, and the editor names the process of each terminal. So the two match by number,
with no tmux command and no guesswork.

A session outside tmux takes the same idea without tmux. The extension walks up from the
session's own process until it meets a process the editor named. The walk stops after twelve
steps.

The walk cannot serve a session inside tmux. The chain there ends at the tmux server, which
belongs to no terminal, so the client route stays for that case.

### Attaching

The extension opens a terminal, names it for the session, and sends one line. The line is
`tmux attach`, and never `exec tmux attach`. An `exec` replaces the shell the client runs
under, and the match above would then find nothing.

After the attach, the client's parent is the shell of that terminal. So the first case takes
over on every later click, and the two routes agree by construction.

The line names the session by identifier, such as `$1`, and never by name. tmux matches a
name by prefix, so `-t 1` can reach a session called `10`.

One map holds the terminal opened for each session, and it serves as every guard. A second
click finds that terminal and shows it, so no click opens a second one. Closing the terminal
drops it from the map.

A terminal already running a client reads a sent line as keystrokes. So the extension looks
for a client on that shell first, and sends nothing when it finds one. It also waits no longer
than two seconds for the editor to name a process. One stuck terminal must not hold up the
whole search.

## The box

A tree view is the only part of VS Code that gives a list which stays on screen. It redraws
every two seconds, from the read the status bar already did, and it fires the redraw only when
the content changed. An unchanged roster therefore costs one string compare.

The box lists Claude Code sessions, not tmux sessions. A tmux session with no Claude Code in
it stays invisible.

## The modules

| file | holds |
|---|---|
| `extension.js` | the timer, the settings, the commands, the status bar item |
| `src/roster.js` | the session records, and the liveness test |
| `src/state.js` | the directories, and the payloads of the optional writer |
| `src/tmux.js` | every tmux call, and the walk up a process chain |
| `src/terminals.js` | the process behind a terminal, with a timeout |
| `src/attach.js` | the route decision, and the act |
| `src/tree.js` | the box |
| `src/describe.js` | the words a row uses, shared so no copy can drift |
| `src/diagnose.js` | the report |
| `src/render.js` | the notice color, and an age in words |

No module depends on another in both directions, and only `extension.js` holds state that
lives between ticks.

## What it does not do

It names no model and draws no quota bar. The Claude Code status line already holds those,
and one number in two places is one number too many.

It attaches nothing by itself when a window opens. Terminals appearing unasked would be a
surprise, so the round runs as a command instead.

It holds one notice at a time. Two sessions finishing within ten seconds show the second one
alone, and a queue would cost more than it is worth.
