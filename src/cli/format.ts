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

function printHelp(log = console.log) {
  log(helpText());
}

module.exports = {
  STATUS_COLOR,
  printResult,
  pad,
  fmtUptime,
  helpText,
  printHelp,
};

export {};
