#!/usr/bin/env python3
"""Report what the stored Claude Code status payload actually contains.

Milestone 1 of the plan asks three questions of a live payload. Does the
five-hour quota appear, and does it move? Does the weekly quota appear? Is the
dollar cost a real number on a subscription account? This script answers all
three from the files the writer stores.

Call it twice, with a turn in between, to see whether a number moves.
"""

import json
import os
import sys
import time
from pathlib import Path


def state_directory() -> Path:
    """Find the directory the writer fills, the way the extension finds it.

    An argument wins. The variable CLAUDE_CONFIG_DIR, which names the Claude
    Code configuration directory, comes next. The usual place comes last.
    """
    if len(sys.argv) > 1:
        return Path(sys.argv[1]).expanduser()
    config = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    root = Path(config).expanduser() if config else Path.home() / ".claude"
    return root / "statusline-state"


STATE = state_directory()


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def report(path: Path) -> None:
    payload = load(path)
    age = time.time() - payload.get("written_at_ms", 0) / 1000
    print(f"file: {path.name}")
    print(f"  written: {age:.0f} s ago")
    print(f"  model: {(payload.get('model') or {}).get('display_name')}")

    window = payload.get("context_window") or {}
    print(f"  context: {window.get('used_percentage')}% of {window.get('context_window_size')}")

    limits = payload.get("rate_limits")
    if not limits:
        print("  rate_limits: absent")
    else:
        for name in ("five_hour", "seven_day", "spend_limit"):
            block = limits.get(name)
            if block is None:
                print(f"  {name}: absent")
            else:
                print(f"  {name}: {block.get('used_percentage')}% resets {block.get('resets_at')}")

    cost = payload.get("cost") or {}
    print(f"  cost: {cost.get('total_cost_usd')} usd over {cost.get('total_duration_ms')} ms")

    cache = payload.get("prompt_cache")
    if cache:
        print(f"  cache: warm={cache.get('warm')} hit_ratio={cache.get('hit_ratio')}")

    print(f"  top level keys: {sorted(payload.keys())}")


def main() -> None:
    if not STATE.is_dir():
        print(f"no state directory at {STATE}")
        sys.exit(1)
    files = sorted(STATE.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        print("no payload stored yet")
        sys.exit(1)
    for path in files:
        report(path)
        print()


if __name__ == "__main__":
    main()
