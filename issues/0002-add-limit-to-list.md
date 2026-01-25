Title: Add --limit/--page option to `wl list`
Priority: low

Description:
- Problem: `wl list` can return a large number of items; there is no built-in pagination or limiting.
- Proposed change: Add `--limit` and optionally `--page` flags to `wl list` and apply slicing in `src/commands/list.ts` (after filtering and sorting) to cap results.
- Implementation notes: Add CLI flags via the commander interface in `src/commands/list.ts`, parse numbers, and slice the array of results. Consider also supporting `--page` to skip `(page-1)*limit` items.

Acceptance criteria:
- `wl list --limit N` returns at most N items.
- `wl list --limit N --page P` returns items for page P given limit N.
- Unit tests added to cover basic pagination behavior.

Files to change:
- `src/commands/list.ts`
- Tests: `tests/cli/issue-status.test.ts` or a new test file
