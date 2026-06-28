# Repository Guidelines

## Project Structure & Module Organization

Jineng is a Node.js/TypeScript CLI and terminal UI for managing local development servers.

- `src/cli/`: CLI entrypoint, command routing, and output formatting.
- `src/core/`: shared config, paths, state, and daemon IPC helpers.
- `src/daemon/`: background daemon, process supervision, logs, ports, worktree support, and runtime detection.
- `src/tui/`: terminal UI controller, renderer, views, and TUI utilities.
- `src/config.example.json`: packaged example config. Do not put personal or company-specific config here.
- `test/`: Node test runner suites for CLI, daemon, and TUI behavior.
- `dist/`: generated build output. Do not edit by hand.

Runtime files are stored under `~/.jineng`, including user config, logs, daemon pid/socket files, and instance state.

## Build, Test, and Development Commands

- `npm run build`: removes `dist`, compiles TypeScript, and copies `config.example.json`.
- `npm run check`: runs TypeScript type checking without emitting files.
- `npm test`: builds and runs all tests in `dist/test`.
- `npm run test:daemon`: runs daemon tests with single-test concurrency.
- `npm run test:coverage`: runs the full test suite with Node coverage.
- `npm run jineng`: runs the local launcher.

For local use, run `jineng init` to create `~/.jineng/config.json`, then edit that file for your projects.

## Coding Style & Naming Conventions

Use CommonJS-style modules in TypeScript files to match the current codebase. Keep changes focused and avoid unrelated refactors. Prefer clear function names such as `loadConfig`, `spawnDaemon`, and `statusCheckFor`. Keep JSON examples generic and portable. Do not commit personal paths, private service names, or machine-specific config.

There is no formatter configured. Preserve the surrounding style, use two-space indentation in JSON, and keep comments short and useful.

## Testing Guidelines

Tests use Node’s built-in test runner with `node:test` and `node:assert/strict`. Add or update tests when changing CLI routing, config loading, daemon lifecycle, process supervision, or TUI behavior. Test files should live in `test/` and follow the existing `*.test.ts` naming pattern.

Run `npm test` before handing off changes. Use `npm run test:coverage` when touching shared behavior or broad control flow.

## Commit & Pull Request Guidelines

This checkout does not include Git history, so no repository-specific commit convention is available. Use concise, imperative commit messages, for example `Add user config initialization` or `Fix daemon shutdown without config`.

Pull requests should include a short summary, testing performed, and any config or migration notes. For TUI changes, include screenshots or terminal output when behavior changes visibly.

## Security & Configuration Tips

Keep real config in `~/.jineng/config.json` or pass it with `--config` / `JINENG_CONFIG`. The packaged example must remain safe for public distribution. Avoid committing credentials, absolute personal paths, internal hostnames, or cloud account commands.
