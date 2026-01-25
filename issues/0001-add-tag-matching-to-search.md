Title: Add tag matching to --search for `next`
Priority: low

Description:
- Problem: The `next` command's `--search`/filtering currently only checks work item title/description and other fields but does not match against `item.tags`.
- Proposed change: Include tags in `applyFilters` so a search term also checks `item.tags`. This will allow users to find work items by tag using `wl next --search foo`.
- Implementation notes: I can implement this by updating `src/commands/next.ts` (or the shared `applyFilters` helper) to check `item.tags` (array) and match any tag containing the search term (case-insensitive). No DB schema changes required.

Acceptance criteria:
- `wl next --search <tag>` returns items whose tags contain `<tag>`.
- Unit tests added/updated demonstrating tag matches.

Files to change:
- `src/commands/next.ts` or the shared filter helper
- `tests/cli/issue-status.test.ts` or a new unit test covering tag matching
