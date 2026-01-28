Feature: Full-text search (SQLite FTS) — WL-0MKRPG61W1NKGY78

Brief summary
- Add an FTS5-backed full-text search index and a `worklog search` CLI so contributors can run fast, ranked queries (title, description, comments, tags) with immediate index visibility after writes.

Problem statement
- Developers and maintainers need fast, relevant full-text search over work items (title, description, comments, tags) so they can find and triage issues reliably at scale. Current listing and filtering are limited and do not support relevance ranking, snippets, or fast text queries.

Users
- Repository contributors and maintainers who search work items to triage, plan, and debug. Example user stories:
  - As a contributor, I want to run `worklog search "database corruption"` and see the most relevant items (with snippets) so I can find prior discussions quickly.
  - As a release engineer, I want to filter search results by `--status open --tags cli` and export JSON for automation so I can programmatically build reports.
  - As a maintainer, I want the search index to reflect writes immediately so newly created/updated items are discoverable in the next command.

Chosen approach (capture fidelity)
- SQLite FTS5 is the target engine (user confirmed). Index all text fields plus tags (title, description, comments, tags, other text fields). CLI defaults: human-friendly output with snippets and filters; `--json` for machine consumption.

Success criteria
- Search returns ranked, relevant results for common queries (top-10 relevance) with snippet highlights matching query terms.
- Index updates synchronously on write: create/update/delete operations are visible to subsequent searches within 1 second.
- CLI usability: `worklog search <query>` supports `--status`, `--parent`, `--tags`, `--json`, `--limit` and returns human-friendly output by default; `--json` returns structured results.
- Performance: median query latency <100ms on datasets up to ~5,000 items in CI/dev environment; include a small benchmark job in CI.
- Tests & CI: unit tests for indexing/querying, integration fixtures covering index correctness and consistency across create/update/delete, and a perf benchmark.

Constraints
- Requires SQLite with FTS5 enabled; the CLI must detect and fail fast with a clear message if FTS5 is unavailable.
- Keep index consistent with the canonical store (SQLite DB or `.worklog/worklog-data.jsonl` import flow). Prefer DB-backed storage and transactional updates.
- Implement synchronous updates with minimal write latency (FTS virtual table + triggers or application-managed transactions that update FTS in the same transaction).

Existing state & traceability
- Work item: WL-0MKRPG61W1NKGY78 (Feature: Full-text search).  
- Parent epic: WL-0MKRJK13H1VCHLPZ — Epic: Add bd-equivalent workflow commands.  
- Related infra: WL-0MKRRZ2DN0898F / WL-0MKRSO1KD1NWWYBP — Persist Worklog DB across executions; these inform DB choice/lifecycle.  
- Source data: `.worklog/worklog-data.jsonl` — use for initial backfill and test fixtures.  
- Docs: update `CLI.md` with `worklog search` usage and examples.

Desired change (high level)
- Add FTS5 virtual table `worklog_fts` that indexes title, description, comment bodies, tags and other text fields; include per-document metadata (work item id, status, parentId) to support filtering and ranking.
- Keep index in sync synchronously on write via triggers or application-managed transactions; provide `--rebuild-index` admin flag to backfill or rebuild.
- Implement `worklog search` supporting: phrase queries, prefix search, bm25 ranking, snippet extraction, filters `--status/--parent/--tags`, `--limit`, and `--json` output.
- Provide migration/bootstrap: create FTS table on first run and backfill from `.worklog/worklog-data.jsonl` or current DB.

Example SQL (developer handoff)
```
-- Create a simple FTS5 table tying back to the canonical items table
CREATE VIRTUAL TABLE IF NOT EXISTS worklog_fts USING fts5(
  title, description, comments, tags, itemId UNINDEXED, status UNINDEXED, parentId UNINDEXED,
  tokenize = 'porter'
);

-- Example ranked query with snippet
SELECT itemId, bm25(worklog_fts) AS rank,
  snippet(worklog_fts, '<b>', '</b>', '...', -1, 64) AS snippet
FROM worklog_fts
WHERE worklog_fts MATCH '"database corruption" OR database*'
ORDER BY rank
LIMIT 10;
```

Related work (links/ids)
- WL-0MKRPG61W1NKGY78 — this item.  
- WL-0MKRJK13H1VCHLPZ — parent epic.  
- WL-0MKRRZ2DN0898F / WL-0MKRSO1KD1NWWYBP — DB persistence work (relevant).  
- `.worklog/worklog-data.jsonl` — backfill and fixtures.  
- `CLI.md` — update after implementation.

Risks & mitigations
- FTS5 unavailable in some SQLite builds — Mitigation: detect early, emit a clear error message and document runtime requirements; create a follow-up fallback task if adoption is required.
- Noisy/irrelevant results — Mitigation: tune tokenization, add field weighting, provide examples in docs, and expose `--limit` and filter flags for deterministic results.
- Index corruption or schema drift during upgrades — Mitigation: provide `--rebuild-index`, export/backups before migration, and include migration scripts in the PR.
- Write latency on very large datasets — Mitigation: measure with CI benchmark; keep transactional updates fast; evaluate async updates as follow-up if necessary.

Polish & handoff
- Update `CLI.md` with usage examples and the SQL snippet above. Include a short dev guide in the PR describing bootstrap steps, `--rebuild-index`, and how to run the perf benchmark.  
- Final one-line headline for work item body: "FTS5-backed full-text search + `worklog search` CLI: fast, ranked queries over title, description, comments and tags with synchronous indexing."

Suggested next steps (conservative)
1) Merge this intake draft into the work item description (after your approval).  
2) Create a small spike branch: add FTS5 table + backfill script + prototype `worklog search --json` and run local perf tests.  
3) If FTS5 is absent in some environments, open a follow-up work item to add an application-level fallback.
