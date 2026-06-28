// @ts-nocheck
const chalk = require("chalk");

const STATUS_COLOR = {
  running: chalk.green,
  stopped: chalk.gray,
  crashed: chalk.red,
  paused: chalk.yellow,
};

function printResult(verb, id, reply, log = console.log, setExitCode = (code) => {
  process.exitCode = code;
}) {
  if (reply.ok) {
    const extra = reply.pid ? ` (pid ${reply.pid})` : "";
    log(chalk.green(`${verb} ${id}: ok`) + extra);
  } else {
    log(chalk.red(`${verb} ${id}: ${reply.error}`));
    setExitCode(1);
  }
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function helpText() {
  return [
    "usage:",
    "  jineng init                  create ~/.jineng/config.json",
    "  jineng init --force          overwrite ~/.jineng/config.json",
    "  jineng --config <path> ...   use a custom config file",
    "  jineng config path           print the active config path",
    "  jineng config help           explain config fields",
    "  jineng                       launch TUI",
    "  jineng ls                    list entries",
    "  jineng start <id>            start an entry",
    "  jineng stop <id>             stop an entry",
    "  jineng restart <id>          stop + start",
    "  jineng opts <id>             show options for an entry",
    "  jineng opt <id> <key> <val>  set an option value",
    "  jineng ping                  ping the daemon",
    "  jineng daemon start|stop|status",
  ].join("\n");
}

function configHelpText() {
  return [
    "Jineng config help",
    "",
    "Config path order:",
    "  1. --config /path/to/config.json",
    "  2. JINENG_CONFIG=/path/to/config.json",
    "  3. ~/.jineng/config.json",
    "  4. packaged config.example.json",
    "",
    "Top-level fields:",
    "  entries[]  Long-running development servers shown in the main HUD.",
    "  tasks[]    One-shot commands shown below servers in the HUD.",
    "",
    "Entry fields:",
    "  id                  Required. Stable CLI/TUI id, for example web-app.",
    "  label               Optional display name.",
    "  cwd                 Required. Working directory. ~/... is expanded.",
    "  command             Required. Shell command. Supports {optionKey} placeholders.",
    "  env                 Optional object of environment variables.",
    "  shell               Optional shell wrapper, for example \"zsh -ic\" or \"sh -lc\".",
    "  nodeVersion         Optional Node version resolved from nvm/fnm.",
    "  options             Optional map of configurable command values.",
    "  worktreePortScript  Optional command used to compute PORT for worktree instances.",
    "",
    "Option fields:",
    "  values[]     Allowed values shown in the TUI and CLI.",
    "  default      Initial value when no saved value exists.",
    "  allowCustom  true allows values outside values[].",
    "",
    "Task fields:",
    "  id               Required. Stable CLI/TUI id.",
    "  label            Optional display name.",
    "  command          Required. Command to run when selected or started.",
    "  env              Optional object of environment variables.",
    "  shell            Optional shell wrapper.",
    "  statusCommand    Optional command used to show active/inactive status.",
    "  statusTimeoutMs  Optional timeout for statusCommand. Defaults to 3000.",
    "",
    "Example:",
    "  {",
    "    \"entries\": [{",
    "      \"id\": \"web-app\",",
    "      \"cwd\": \"~/projects/web-app\",",
    "      \"command\": \"HOST={host} PORT={port} npm run dev\",",
    "      \"options\": {",
    "        \"host\": { \"values\": [\"localhost\"], \"default\": \"localhost\" },",
    "        \"port\": { \"values\": [\"3000\"], \"default\": \"3000\", \"allowCustom\": true }",
    "      }",
    "    }],",
    "    \"tasks\": [{",
    "      \"id\": \"login\",",
    "      \"command\": \"echo login\",",
    "      \"statusCommand\": \"echo ok\"",
    "    }]",
    "  }",
  ].join("\n");
}

function printHelp(log = console.log) {
  log(helpText());
}

module.exports = {
  STATUS_COLOR,
  printResult,
  pad,
  fmtUptime,
  helpText,
  configHelpText,
  printHelp,
};

export {};
