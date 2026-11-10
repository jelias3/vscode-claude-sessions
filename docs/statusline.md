# The terminal status line, which is extra

`statusline/claude_status_writer.py` draws one line under the prompt of each Claude Code
session:

```
Opus 5 1M  Context █░░░░░ 18%  5hr Session Usage ▋░░░░░ 11%  refreshes at 3:50 PM
```

**The extension does not need this.** The box in the Explorer reads the session records, which
Claude Code writes by itself. The writer stores a second file per session, and only the report
command reads it.

## Wire it in

Claude Code runs one command on every status update, and it sends one JSON object on standard
input. Add this to `settings.json` in your Claude Code configuration directory, which is
`~/.claude/` unless `CLAUDE_CONFIG_DIR` says otherwise:

```json
"statusLine": {
  "type": "command",
  "command": "/full/path/to/statusline/claude_status_writer.py",
  "refreshInterval": 2
}
```

Claude Code picks the block up without a restart. Delete the block to remove the writer.

The script needs Python 3 and nothing else. Make it executable first.

## What it does

It reads the object, adds a timestamp, and writes it to
`<configuration directory>/statusline-state/<session>.json`. It writes to a temporary name
and renames, so no reader ever sees half a file. It then prints the line above.

The two bars each hold six cells, and a cell fills in eighths. A bar therefore resolves 48
steps, which is near 2% a step. The characters are the unicode block elements, from `▏`
through `█`, with `░` for an empty cell. Every monospace font carries that range.

Two rounding rules keep a bar honest. Any percent above zero fills at least one eighth, so a
quota that has started never reads as empty. A percent below 100 leaves at least one eighth
empty, so only a full quota reads as full.

Three colors separate the parts. The model is light blue, `Context` is purple, and
`5hr Session Usage` is orange. The writer paints them with the 256 color codes 117, 141 and
215, which a terminal renders.

## What the payload holds

`tools/check_payload.py` prints a stored payload. Measured under Claude Code 2.1.311:

| field | example | note |
|---|---|---|
| `model.display_name` | `Opus 5 (1M context)` | |
| `context_window.used_percentage` | `19` | out of `context_window_size` |
| `rate_limits.five_hour.used_percentage` | `10` | it moves while you work |
| `rate_limits.five_hour.resets_at` | `1794261000` | epoch seconds, not a date |
| `rate_limits.seven_day` | absent | this account reports no weekly quota |
| `cost.total_cost_usd` | `5.20` | a real figure on a subscription |
| `prompt_cache.expires_at` | `1794250923` | epoch seconds |
| `effort.level`, `thinking.enabled`, `fast_mode` | `high`, `true`, `false` | |
| `workspace.current_dir`, `session_id` | | paths and identity |

The display drops the weekly quota, because this account has none. It drops the cost by
choice. An item with no number prints two dashes, never a zero, because a number that never
moves is worse than no number.

## It costs no tokens

Claude Code builds the payload out of state it already holds, then runs the writer as a
separate process. No request reaches the model, and the line never enters the conversation.
