#!/usr/bin/env bash
set -euo pipefail

echo "Running TUI tests in CI mode"
VITEST_WORKER_THREADS=1 npx vitest run -c vitest.tui.config.ts
