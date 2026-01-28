Worklog doctor: detect and report referential integrity issues (cycles, missing parents, dangling refs) so automation and CI can fail fast.
Worklog data can contain referential problems (dependency cycles, missing parents, dangling references) that break automation and CI. `worklog doctor` will detect and report these integrity issues so maintainers can fix them before they cause sync or workflow failures.

Users
- Maintainers and SREs: run checks in CI to prevent data-corrupting changes from entering main workflows.
- Developers/agents: run locally to validate worklog data before creating new workflow automation (e.g. `worklog land`, `worklog ready`).

Example user stories
- As a maintainer, I want `worklog doctor --json` in CI to fail the build if cycles or dangling refs exist so we don’t ship broken automation.
- As a developer, I want `worklog doctor` to produce clear, human-readable diagnostics I can act on locally.

Success criteria
- Detects and reports: cycles in dependency graph, missing parent references, dangling dependency edges, and malformed item ids; output contains enough detail (item ids and paths) to fix the issue.
- Exit behavior: exits non-zero when any integrity issue is found; exits zero when no issues are found.
- Output formats: human-friendly text by default and a stable `--json` NDJSON/JSON output suitable for CI automation (fields: `id`, `type`, `severity`, `message`, `path`, `cycle_path` where relevant).
- Non-destructive default: running `worklog doctor` without `--fix` must never modify data.
- Tests: unit tests cover detection logic and JSON output schema; an integration test verifies exit codes for example data files.

Constraints
- Non-destructive by default; any auto-fix behaviour must be opt-in via `--fix` and `--dry-run` modes (not in scope for initial delivery).
- Must operate on current persisted worklog data formats (see `.worklog/worklog-data.jsonl`) and reuse dependency edges produced by `Feature: Dependency tracking + ready` (WL-0MKRPG5CY0592TOI).
- CLI must be consistent with existing command patterns (subcommand under `worklog` with standard `--json` flag and `--scope`/`--ids` filters).
- Performance: run reasonably fast for typical repo sizes (tens to low hundreds of items); escalate design for much larger datasets later.

Existing state
- Parent epic: `Add bd-equivalent workflow commands` (WL-0MKRJK13H1VCHLPZ) contains `worklog doctor` as a child (WL-0MKRPG64S04PL1A6).
- Dependency tracking (WL-0MKRPG5CY0592TOI) has been implemented/completed and persists typed edges; doctor can read these edges.
- `plan/insights/diff style commands` (WL-0MKRPG5R11842LYQ) requests similar graph analysis functionality and is a related/overlapping area.
- Repository stores work items in `.worklog/worklog-data.jsonl`; `sync.log` contains real-world examples of integrity issues encountered.

Desired change
- Implement a new CLI command `worklog doctor` with the following minimal surface:
  - `worklog doctor [--json] [--scope <all|workspace|ids>] [--ids <id,id,...>]`
  - Human-readable output by default, `--json` emits stable machine-friendly JSON.
  - Exit code: `0` when no issues; non-zero when issues found.
  - Detectors implemented:
    - Missing parent: item.parentId refers to nonexistent id.
    - Dangling dependency: dependency edge references nonexistent item id.
    - Cycle detection: find and report cycles with the cycle path (list of ids forming the cycle).
    - Malformed ids and duplicate ids (if format rules exist).
  - Unit and integration tests + example fixture files demonstrating each failure mode.

Related work
- WL-0MKRJK13H1VCHLPZ — Add bd-equivalent workflow commands (parent epic)
- WL-0MKRPG5CY0592TOI — Feature: Dependency tracking + ready — provides persistent dependency edges used by doctor (completed)
- WL-0MKRPG5R11842LYQ — Feature: plan/insights/diff style commands — related graph analysis features (cycles/critical-path)
- `.worklog/worklog-data.jsonl` — authoritative store; examples of issue records and edge shapes
- `.worklog/logs/sync.log` — real-world sync/conflict examples useful for test fixtures

Suggested next step
- Review this intake draft; after approval I will run the five review passes (completeness, capture fidelity, related-work & traceability, risks & assumptions, polish & handoff) and then update WL-0MKRPG64S04PL1A6 with the final brief.

Example JSON output (informative)
```json
{
  "id": "WL-0MKRPG64S04PL1A6",
  "type": "missing-parent",
  "severity": "error",
  "message": "parentId WL-XXXXX not found",
  "path": ["items", 123]
}
```

Risks & assumptions
- Risk: False positives may cause CI failures; Mitigation: include severity levels and allow `--fail-on=severity` control.
- Risk: Large datasets may slow the analysis; Mitigation: add `--scope` and streaming JSON output.
- Assumption: dependency edges are stored in the worklog data in predictable shapes (parentId and dependency edges).