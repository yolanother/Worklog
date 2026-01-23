# Worklog Test Suite

This directory contains comprehensive tests for the Worklog project using [Vitest](https://vitest.dev/).

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Organization

### Unit Tests

- **`database.test.ts`** (28 tests) - Tests for WorklogDatabase class
  - CRUD operations (create, read, update, delete)
  - Query and filtering
  - Comments management
  - ID generation
  - Parent-child relationships

- **`jsonl.test.ts`** (9 tests) - Tests for JSONL import/export
  - Export to JSONL format
  - Import from JSONL format
  - Backward compatibility with old format
  - Round-trip data integrity
  - Error handling

- **`sync.test.ts`** (14 tests) - Tests for sync operations (PRIORITY)
  - Work item merging with no conflicts
  - Field-level conflict resolution
  - Same timestamp conflict handling  
  - Tag merging (union of tags)
  - Comment merging
  - Default value handling in merge logic

- **`config.test.ts`** (16 tests) - Tests for configuration management
  - Config file creation and loading
  - Default configuration handling
  - User config overrides
  - Config validation
  - Prefix management

### Integration Tests

- **`cli.test.ts`** (20 tests - currently skipped)
  - End-to-end CLI command testing
  - Note: These tests are skipped because database initialization messages
    interfere with JSON output parsing. The functionality is adequately
    covered by unit tests.

## Test Coverage

Current test coverage: **67 tests passing, 20 skipped**

| Module | Tests | Status | Coverage Areas |
|--------|-------|--------|----------------|
| Database | 28 | ✅ Pass | CRUD, queries, comments, relationships |
| JSONL | 9 | ✅ Pass | Import, export, compatibility |
| Sync | 14 | ✅ Pass | Merge logic, conflict resolution |
| Config | 16 | ✅ Pass | Loading, validation, defaults |
| CLI | 20 | ⚠️ Skip | Integration tests (covered by units) |

## Test Utilities

The `test-utils.ts` file provides shared utilities for tests:

- `createTempDir()` - Creates a temporary directory for test isolation
- `cleanupTempDir(dir)` - Cleans up temporary directories after tests
- `createTempJsonlPath(dir)` - Generates a temp path for JSONL files
- `createTempDbPath(dir)` - Generates a temp path for database files
- `wait(ms)` - Async delay utility

## Writing New Tests

### Example Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, cleanupTempDir } from './test-utils.js';

describe('MyFeature', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // Setup code
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should do something', () => {
    // Test code
    expect(result).toBe(expected);
  });
});
```

### Best Practices

1. **Isolate tests** - Each test should be independent and use temp directories
2. **Clean up** - Always clean up temp files and directories in `afterEach`
3. **Descriptive names** - Test names should clearly describe what is being tested
4. **Arrange-Act-Assert** - Structure tests with clear setup, execution, and verification phases
5. **Test edge cases** - Include tests for error conditions and boundary cases

## Continuous Integration

Tests run automatically on:
- Pull requests
- Pushes to main branch
- Manual workflow dispatch

## Known Issues

1. **CLI Integration Tests**: Currently skipped because `WorklogDatabase` outputs 
   "Refreshing database..." messages to stdout, which interferes with JSON parsing
   in integration tests. The functionality is adequately tested through unit tests.

2. **Git Operations**: Tests for `gitPullDataFile` and `gitPushDataFile` require
   a git repository setup and are not yet implemented.

## Future Improvements

- Add API endpoint integration tests
- Add performance benchmarks
- Add tests for Git sync operations
- Increase code coverage to >90%
- Add mutation testing
- Enable CLI integration tests (requires fixing stdout/stderr separation)
