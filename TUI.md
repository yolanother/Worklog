Worklog TUI
=============

This document describes the interactive terminal UI shipped as the `wl tui` (or `worklog tui`) command.

Overview
--------

- The TUI presents a tree view of work items on the left and a details pane on the right.
- It can show all items, or be limited to in-progress items via `--in-progress`.
- The details pane uses the same human formatter as the CLI so what you see in the TUI matches `wl show --format full`.

Controls
--------

- Arrow Up / Down — move selection
- Right / Enter — expand node
- Left — collapse node (or collapse parent)
- Space — toggle expand/collapse
- Mouse — click to select and scroll
- q / Esc / Ctrl-C — quit

Usage
-----

Install dependencies and run from source:

```
npm install
npm run cli -- tui
```

Options
-------

- `--in-progress` — show only items with status `in-progress`.
- `--prefix <prefix>` — use a different project prefix.

Notes
-----

- The TUI uses `blessed` for rendering. For a smoother TypeScript developer experience install the types: `npm install -D @types/blessed`.
- The TUI is intentionally lightweight: it renders items from the current database snapshot. If you want live updates across processes, run a background sync or re-open the TUI.
