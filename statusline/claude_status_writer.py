#!/usr/bin/env python3
"""Write the Claude Code status payload to a file, and print one terminal line.

Claude Code runs this script as its `statusLine` command. It sends one JSON object on
standard input, holding the model, the context window, the quotas and the cost. This script
stores that object under the Claude Code configuration directory, so the VS Code extension
can read it. It then prints a single line for the terminal status bar.

The script must never fail. A crash here would empty the terminal status bar, so every step
sits inside a try block and the script always prints something.
"""

import datetime
import json
import os
import sys
import time
from pathlib import Path

# Delete a stored payload after this many seconds without an update.
STALE_SECONDS = 24 * 60 * 60


def config_dir() -> Path:
    """Return the Claude Code configuration directory.

    The variable `CLAUDE_CONFIG_DIR` names it. This script sits three levels inside that
    directory, so the parents give a fallback when the variable is unset.
    """
    from_env = os.environ.get("CLAUDE_CONFIG_DIR")
    if from_env:
        return Path(from_env)
    return Path(__file__).resolve().parents[2]


def state_dir() -> Path:
    path = config_dir() / "statusline-state"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_payload(payload: dict, directory: Path) -> None:
    """Store the payload under the session identifier, through a temporary name.

    The extension polls this directory. A rename is atomic on one file system, so the
    extension never reads a half-written file.
    """
    session = str(payload.get("session_id") or "unknown")
    session = "".join(c for c in session if c.isalnum() or c in "-_")
    final = directory / f"{session}.json"
    temp = directory / f".{session}.{os.getpid()}.tmp"
    temp.write_text(json.dumps(payload, separators=(",", ":")))
    os.replace(temp, final)


def prune(directory: Path) -> None:
    """Delete payloads of sessions that stopped writing."""
    cutoff = time.time() - STALE_SECONDS
    for path in directory.glob("*.json"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


# Terminal colors, as 256 color codes. The VS Code extension uses the same three.
COLOR_MODEL = 117  # light blue
COLOR_CONTEXT = 141  # purple
COLOR_SESSION = 215  # orange
RESET = "\u001b[0m"


def paint(text: str, color: int) -> str:
    """Wrap text in one 256 color code, and close the code after it."""
    return f"\u001b[38;5;{color}m{text}{RESET}"


# The eighth steps of a bar cell, from one eighth to seven eighths.
PARTIAL_CELLS = "\u258f\u258e\u258d\u258c\u258b\u258a\u2589"
FULL_CELL = "\u2588"
EMPTY_CELL = "\u2591"


def bar(value, cells: int = 8) -> str:
    """Draw a bar that fills up, one cell per eight steps.

    Any percent above zero fills at least one eighth, so a quota that has
    started never reads as empty. A percent below 100 leaves at least one
    eighth empty, so only a full quota reads as full.
    """
    if value is None:
        return EMPTY_CELL * cells
    pct = max(0.0, min(100.0, float(value)))
    steps = pct / 100.0 * cells * 8
    if pct > 0:
        steps = max(steps, 1)
    if pct < 100:
        steps = min(steps, cells * 8 - 1)
    full, rest = divmod(int(steps), 8)
    drawn = FULL_CELL * full + (PARTIAL_CELLS[rest - 1] if rest else "")
    return drawn + EMPTY_CELL * (cells - len(drawn))


def percent(value) -> str:
    if value is None:
        return "--"
    return f"{round(float(value))}%"


def reset_clock(resets_at) -> str:
    """Write the clock time of the next five-hour window.

    The payload gives the reset as epoch seconds, or as a date string.
    """
    if resets_at is None:
        return ""
    try:
        if isinstance(resets_at, (int, float)):
            seconds = float(resets_at)
            if seconds > 1e11:
                seconds = seconds / 1000.0
            when = datetime.datetime.fromtimestamp(seconds)
        else:
            text = str(resets_at).replace("Z", "+00:00")
            when = datetime.datetime.fromisoformat(text).astimezone()
    except Exception:
        return ""
    if when.timestamp() <= time.time():
        return "refreshes soon"
    return f"refreshes at {when.strftime('%-I:%M %p')}"


def terminal_line(payload: dict) -> str:
    """Build the one line the terminal status bar shows."""
    parts = []
    model = (payload.get("model") or {}).get("display_name")
    if model:
        parts.append(paint(model, COLOR_MODEL))

    window = payload.get("context_window") or {}
    used = window.get("used_percentage")
    if used is not None:
        parts.append(paint(f"Context {bar(used, 6)} {percent(used)}", COLOR_CONTEXT))

    limits = payload.get("rate_limits") or {}
    five_hour = limits.get("five_hour") or {}
    if five_hour:
        share = five_hour.get("used_percentage")
        clock = reset_clock(five_hour.get("resets_at"))
        label = f"5hr Session Usage {bar(share, 6)} {percent(share)}"
        if clock:
            label = f"{label}  {clock}"
        parts.append(paint(label, COLOR_SESSION))

    return "  ".join(parts) if parts else "claude"


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except Exception:
        print("claude")
        return

    try:
        payload["written_at_ms"] = int(time.time() * 1000)
        directory = state_dir()
        write_payload(payload, directory)
        prune(directory)
    except Exception as error:
        # Keep the failure visible in the one place the user is already looking.
        print(f"claude (status writer failed: {error})")
        return

    try:
        print(terminal_line(payload))
    except Exception:
        print("claude")


if __name__ == "__main__":
    main()
