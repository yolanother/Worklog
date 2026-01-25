Title: Investigate intermittent timeouts in init and status CLI tests
Priority: medium

Description:
- Problem: Two CLI tests occasionally time out at the default 5000ms test timeout causing CI failures:
  * `tests/cli/init.test.ts` — `should sync remote work items on init in new checkout` timed out at 5000ms. Re-running with a 20s timeout passed.
  * `tests/cli/status.test.ts` — `should show correct counts in database summary` timed out at 5000ms. Re-running with a 20s timeout passed.
- Observed behavior: Both tests passed when re-run individually with `npx vitest run <testfile>` and `--testTimeout` increased to 20000ms. This suggests the tests are slow under full-suite execution or occasionally contend for resources, rather than failing deterministically.

Investigation tasks (medium priority):
1. Run the full test suite with verbose logging and collect timings to identify slow steps (e.g., DB initialization, network operations, plugin loading).
2. Inspect the test implementations:
   - `tests/cli/init.test.ts` around the `should sync remote work items on init in new checkout` test — look for file system operations, network calls, or long-running subprocesses.
   - `tests/cli/status.test.ts` around `should show correct counts in database summary` — look for expensive DB queries or large fixture setup.
3. Improve reliability:
   - Where applicable, stub or mock long-running external dependencies (e.g., remote sync) and speed up setup/teardown.
   - Ensure asynchronous operations are awaited properly and that there are no hidden sleeps or retries.
   - If tests legitimately need more time, add local-per-test timeout increases instead of a global change.
4. Add a CI job that runs the test suite under nominal resources to reproduce slow behavior.

Details to include when working on this issue:
- Exact failing stack/traces and test locations (file and line numbers).
- Test run timings (per-test and overall) for the failing tests when run alone and in the full suite.
- Any dependencies that the tests spin up (databases, external scripts, plugin directories).

Files referenced:
- `tests/cli/init.test.ts`
- `tests/cli/status.test.ts`
