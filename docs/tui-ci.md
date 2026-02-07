# TUI CI and Headless Testing

This guide covers running TUI tests in headless environments, including GitHub Actions and Docker.

## Required Dependencies

- Node.js 20
- npm
- bash (for test runner script)

## Run TUI Tests Locally

```bash
npm run test:tui
```

## Run TUI Tests in Docker

```bash
docker build -f Dockerfile.tui-tests -t worklog-tui-tests .
docker run --rm worklog-tui-tests
```

## GitHub Actions

The workflow runs on every pull request and executes the headless TUI test runner:

```
.github/workflows/tui-tests.yml
```
