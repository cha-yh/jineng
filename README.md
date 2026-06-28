# Jineng

Terminal UI and CLI tools for starting, stopping, inspecting, and tailing local development servers.

The name `jineng` is written to sound similar to the Korean word "진행" (`jinhaeng`), meaning
"progress".

## Install

```sh
pnpm install
pnpm link --global
```

## Usage

Create a user config, edit it for your projects, then run:

```sh
jineng init
jineng config path
jineng
```

Jineng reads config in this order:

1. `--config /path/to/config.json`
2. `JINENG_CONFIG=/path/to/config.json`
3. `~/.jineng/config.json`
4. the packaged `config.example.json`

CLI commands:

```sh
jineng init
jineng init --force
jineng config path
jineng --config ./config.json ls
jineng ls
jineng start <id>
jineng stop <id>
jineng restart <id>
jineng daemon status
```

Runtime state, daemon pid/socket files, and logs are stored under `~/.jineng`.

The packaged example config is intentionally generic. Replace the example `cwd` and `command`
values in your user config before using the TUI for day-to-day work. If you change the active config
while the daemon is running, restart it with `jineng daemon stop`; the next command will start it
again with the new config.

## Config

```json
{
  "entries": [
    {
      "id": "web-app",
      "label": "Web App",
      "cwd": "~/projects/web-app",
      "command": "npm run dev",
      "options": {
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

## Task Entries

Use top-level `tasks[]` for commands that are useful in the TUI but are not development servers.
Task entries do not require `cwd`, and they are shown below the server list in the HUD.

```json
{
  "tasks": [
    {
      "id": "login",
      "label": "Login",
      "command": "echo 'replace this command'",
      "statusCommand": "exit 1"
    }
  ]
}
```

When `statusCommand` exits successfully, the task is shown as active. A non-zero exit code is shown
as inactive.

## License

MIT
