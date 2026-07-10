# Jineng

Manage local development servers with a terminal UI, CLI, and background daemon.

Jineng helps you start, stop, inspect, and tail multiple local development processes from one
terminal screen. The name is written to sound similar to the Korean word "진행" (`jinhaeng`),
meaning "progress".

It is built for developers who juggle many repositories, or who keep several Git worktrees active
inside the same repository. Instead of remembering and retyping each dev-server command whenever a
terminal session or TUI closes, Jineng runs managed commands through a background daemon and lets you
control them from a single CLI or TUI. The daemon can keep child processes running independently of
the UI and reattach to living processes on the next start, which makes long-running local workflows
less repetitive.

## Features

- Terminal UI for local server status, actions, details, and logs.
- CLI commands for listing, starting, stopping, restarting, and configuring entries.
- Background daemon that keeps managed processes alive independently of the UI.
- Per-entry logs under `~/.jineng/logs`.
- Configurable command options with `{placeholder}` substitution.
- Git worktree instances with per-worktree ports.
- Task entries for useful one-off or status-checked commands.
- Automatic Node runtime selection from `nodeVersion`, `.nvmrc`, or `.node-version`.
- Automatic install step when a package lockfile exists but `node_modules` is missing.

## Install

If you already have Node.js and npm installed, use the npm package. This is the smaller install
because it does not bundle a Node runtime:

```sh
npm install -g https://github.com/cha-yh/jineng/releases/download/v0.1.2/jineng-0.1.2.tgz
```

If you want to use Jineng without installing Node.js first, use the standalone binary. It bundles a
Node runtime, so the download is larger, but the installed `jineng` command runs without a separate
Node dependency.

Install the latest standalone binary for macOS arm64 or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/cha-yh/jineng/ebf40fa/install.sh | bash
```

Install a specific version:

```sh
curl -fsSL https://raw.githubusercontent.com/cha-yh/jineng/ebf40fa/install.sh | bash -s 0.1.2
```

The installer downloads the matching macOS arm64 or Linux binary from GitHub Releases, verifies the
published SHA256 checksum, and installs it to `~/.local/bin/jineng`.

You can also download the npm package archive from the GitHub Releases page, or install from the
repository root when developing locally.

From the repository root:

```sh
pnpm install
pnpm link --global
```

You can also run it without linking:

```sh
pnpm jineng
```

The executable builds `dist/` on first run when needed.

## Quick Start

Create a user config, edit it for your projects, then launch the TUI:

```sh
jineng init
jineng config path
jineng
```

The packaged example config is intentionally generic. Replace the example `cwd` and `command`
values before using Jineng day to day.

## CLI

```sh
jineng                         # launch the TUI
jineng init                    # create ~/.jineng/config.json
jineng init --force            # overwrite the user config from the example
jineng config path             # print the active config path
jineng config help             # explain every supported config field
jineng ls                      # list configured entries and statuses
jineng start <id>              # start an entry
jineng stop <id>               # stop an entry
jineng restart <id>            # stop then start an entry
jineng opts <id>               # show configurable options for an entry
jineng opt <id> <key> <value>  # set an option value
jineng ping                    # ping the daemon
jineng daemon start            # start the daemon
jineng daemon stop             # stop the daemon, managed children stay alive
jineng daemon status           # show daemon status
```

Use a specific config for any command:

```sh
jineng --config ./config.json ls
JINENG_CONFIG=./config.json jineng
```

## Config Resolution

Jineng reads config in this order:

1. `--config /path/to/config.json`
2. `JINENG_CONFIG=/path/to/config.json`
3. `~/.jineng/config.json`
4. packaged `src/config.example.json`

If you change the active config while the daemon is running, restart the daemon:

```sh
jineng daemon stop
```

The next command starts it again with the new config.

## AI Agent Setup

AI coding agents can configure Jineng without project-specific prior knowledge. Ask the agent to run:

```sh
jineng init
jineng config help
jineng config path
```

The agent can read `jineng config help` to understand every supported config field, then edit the
file printed by `jineng config path`. Keep real project commands in the user config, not in
`src/config.example.json`.

## Server Entries

Use `entries[]` for long-running development servers.

```json
{
  "entries": [
    {
      "id": "web-app",
      "label": "Web App",
      "cwd": "~/projects/web-app",
      "command": "HOST={host} PORT={port} npm run dev",
      "options": {
        "host": {
          "values": ["localhost", "0.0.0.0"],
          "default": "localhost"
        },
        "port": {
          "values": ["3000"],
          "default": "3000",
          "allowCustom": true
        }
      }
    }
  ]
}
```

Entry fields:

- `id`: stable command id used by the CLI and TUI.
- `label`: optional display name.
- `cwd`: working directory. `~/...` is expanded.
- `command`: shell command to run. `{key}` placeholders are replaced from `options`.
- `env`: optional environment variables.
- `shell`: optional shell wrapper, for example `sh -lc`.
- `nodeVersion`: optional Node version resolved from nvm or fnm.
- `worktreePortScript`: optional command used to compute `PORT` for worktree instances.

## Task Entries

Use top-level `tasks[]` for commands that are useful in the TUI but are not development servers.
Task entries do not require `cwd`.

```json
{
  "tasks": [
    {
      "id": "login",
      "label": "Login",
      "command": "echo 'replace this command'",
      "statusCommand": "exit 1",
      "statusTimeoutMs": 3000
    }
  ]
}
```

When `statusCommand` exits successfully, the task is shown as active. A non-zero exit code is shown
as inactive.

## Runtime State

Runtime files are stored under `~/.jineng`:

- `config.json`: user config created by `jineng init`.
- `daemon.pid`: daemon pid file.
- `daemon.sock`: local daemon socket.
- `daemon.log`: daemon stdout/stderr.
- `logs/<id>.log`: per-entry process logs.
- `instances.json`: running process metadata used for daemon reattach.
- `options.json`: saved option values.
- `worktrees.json`: saved worktree instances.

Stopping the daemon does not stop managed child processes. The next daemon start reattaches to
living processes when possible.

## Development

```sh
pnpm install
pnpm run build
pnpm run check
pnpm test
pnpm run test:daemon
pnpm run test:coverage
pnpm run test:coverage:daemon
```

Build output is written to `dist/`. The package includes `dist/src` and `src/jineng`.

## Release

Releases are versioned with git tags such as `v0.2.0`. Pushing a `v*.*.*` tag runs the GitHub
Release workflow, verifies the package, creates an npm-style `.tgz` archive, and attaches it to the
GitHub Release.

For maintainers:

```sh
pnpm release -- 0.2.0
git push origin main v0.2.0
```

The release command updates `package.json`, runs checks and tests, creates a release commit, and
creates an annotated tag. To create the GitHub Release directly from a local machine with the GitHub
CLI, run:

```sh
pnpm release -- 0.2.0 --github
```

Useful variants:

```sh
pnpm release -- 0.2.0 --dry-run --no-git
pnpm release -- 0.2.0 --skip-tests
```

## License

MIT
