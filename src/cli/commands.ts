// @ts-nocheck
const chalk = require("chalk");
const {
  STATUS_COLOR,
  printResult,
  pad,
  fmtUptime,
  configHelpText,
} = require("./format");
const { CliError } = require("./errors");

function createCommands(deps) {
  const {
    request,
    daemonAlive,
    getDaemonPid,
    spawnDaemon,
    initConfig,
    resolveConfigPath,
    defaultConfigPath,
    log = console.log,
    setExitCode = (code) => {
      process.exitCode = code;
    },
    now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = deps;

  async function cmdList() {
    const reply = await request({ op: "list" });
    if (!reply.ok) throw new CliError(reply.error);
    const rows = reply.entries;
    if (rows.length === 0) {
      log("(no entries)");
      return;
    }
    const header = `${pad("ID", 20)} ${pad("STATUS", 9)} ${pad("PID", 7)} ${pad("UPTIME", 10)}  LABEL`;
    log(chalk.bold(header));
    for (const r of rows) {
      const color = STATUS_COLOR[r.status] || chalk.white;
      const uptime = r.startedAt ? fmtUptime(now() - r.startedAt) : "—";
      log(
        `${pad(r.id, 20)} ${color(pad(r.status, 9))} ${pad(String(r.pid ?? "—"), 7)} ${pad(uptime, 10)}  ${chalk.dim(r.label || "")}`,
      );
    }
  }

  async function cmdLifecycle(verb, id) {
    if (!id) throw new CliError(`usage: jineng ${verb} <id>`);
    const reply = await request({ op: verb, id });
    printResult(verb, id, reply, log, setExitCode);
  }

  async function cmdOptions(id) {
    if (!id) throw new CliError("usage: jineng opts <id>");
    const reply = await request({ op: "list" });
    if (!reply.ok) throw new CliError(reply.error);
    const entry = reply.entries.find((e) => e.id === id);
    if (!entry) throw new CliError(`unknown entry: ${id}`);
    const spec = entry.options || {};
    const cur = entry.optionValues || {};
    const keys = Object.keys(spec);
    if (keys.length === 0) {
      log(chalk.dim(`(${id} has no options)`));
      return;
    }
    log(chalk.bold(`${id} options:`));
    for (const k of keys) {
      const v = cur[k];
      const values = spec[k].values || [];
      const allowCustom = !!spec[k].allowCustom;
      const allowed = allowCustom ? [...values, chalk.dim("<custom>")] : values;
      const cv = v != null ? chalk.green(v) : chalk.dim("—");
      log(`  ${chalk.cyan(k)} = ${cv}   ${chalk.dim("allowed:")} ${allowed.join(chalk.dim(" | "))}`);
    }
  }

  async function cmdSetOption(id, key, value) {
    if (!id || !key || value == null) {
      throw new CliError("usage: jineng opt <id> <key> <value>");
    }
    const reply = await request({ op: "setOption", id, key, value });
    if (reply.ok) {
      log(chalk.green(`${id} ${key}=${value}: ok`));
    } else {
      log(chalk.red(`${id} ${key}=${value}: ${reply.error}`));
      setExitCode(1);
    }
  }

  async function cmdRestart(id) {
    if (!id) throw new CliError("usage: jineng restart <id>");
    const stopReply = await request({ op: "stop", id });
    if (!stopReply.ok && stopReply.error !== "not running") {
      printResult("restart", id, stopReply, log, setExitCode);
      return;
    }
    await sleep(400);
    const startReply = await request({ op: "start", id });
    printResult("restart", id, startReply, log, setExitCode);
  }

  async function cmdDaemon(sub) {
    switch (sub) {
      case "status":
        if (daemonAlive()) log(chalk.green(`running (pid ${getDaemonPid()})`));
        else log(chalk.gray("not running"));
        break;
      case "start":
        if (daemonAlive()) {
          log(chalk.gray(`already running (pid ${getDaemonPid()})`));
        } else {
          await spawnDaemon();
          log(chalk.green(`started (pid ${getDaemonPid()})`));
        }
        break;
      case "stop":
        if (!daemonAlive()) {
          log(chalk.gray("not running"));
          return;
        }
        await request({ op: "shutdown" }, { spawnIfNeeded: false });
        log(chalk.yellow("stopping…"));
        break;
      default:
        throw new CliError("usage: jineng daemon start|stop|status");
    }
  }

  async function cmdInit(args = []) {
    const force = args.includes("--force") || args.includes("-f");
    const targetPath = process.env.JINENG_CONFIG || defaultConfigPath();
    const result = initConfig({ force, targetPath });
    if (result.ok) {
      log(chalk.green(`created ${result.path}`));
      return;
    }
    log(chalk.yellow(`config already exists: ${result.path}`));
    log(chalk.dim("use `jineng init --force` to overwrite it"));
  }

  async function cmdConfig(args = []) {
    const [sub] = args;
    switch (sub) {
      case "path":
        log(resolveConfigPath());
        break;
      case "help":
      case "-h":
      case "--help":
        log(configHelpText());
        break;
      default:
        throw new CliError("usage: jineng config path|help");
    }
  }

  async function cmdPing() {
    const r = await request({ op: "ping" });
    log(JSON.stringify(r));
  }

  return {
    cmdList,
    cmdLifecycle,
    cmdOptions,
    cmdSetOption,
    cmdRestart,
    cmdDaemon,
    cmdInit,
    cmdConfig,
    cmdPing,
  };
}

module.exports = { createCommands };

export {};
