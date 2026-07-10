// @ts-nocheck
const {
  request,
  daemonAlive,
  getDaemonPid,
  spawnDaemon,
} = require("../core/ipcClient");
const {
  initConfig,
  resolveConfigPath,
  defaultConfigPath,
} = require("../core/config");
const { createCommands } = require("./commands");
const { helpText, printHelp } = require("./format");
const { CliError } = require("./errors");

function defaultDeps() {
  return {
    request,
    daemonAlive,
    getDaemonPid,
    spawnDaemon,
    initConfig,
    resolveConfigPath,
    defaultConfigPath,
    /* node:coverage ignore next 4 */
    startTui: async () => {
      const { start } = require("../tui");
      await start();
    },
  };
}

function normalizeGlobalArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      const value = argv[i + 1];
      if (!value) throw new CliError("usage: jineng --config <path> ...");
      process.env.JINENG_CONFIG = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      process.env.JINENG_CONFIG = arg.slice("--config=".length);
      continue;
    }
    out.push(arg);
  }
  return out;
}

async function run(argv = process.argv.slice(2), deps = defaultDeps()) {
  argv = normalizeGlobalArgs(argv);
  const [verb, ...rest] = argv;
  const commands = createCommands(deps);
  switch (verb) {
    case undefined:
      await deps.startTui();
      break;
    case "ls":
      await commands.cmdList();
      break;
    case "start":
    case "stop":
      await commands.cmdLifecycle(verb, rest[0]);
      break;
    case "restart":
      await commands.cmdRestart(rest[0]);
      break;
    case "opts":
    case "options":
      await commands.cmdOptions(rest[0]);
      break;
    case "opt":
    case "set-option":
      await commands.cmdSetOption(rest[0], rest[1], rest[2]);
      break;
    case "daemon":
      await commands.cmdDaemon(rest[0]);
      break;
    case "__daemon":
      require("../daemon").start();
      break;
    case "init":
      await commands.cmdInit(rest);
      break;
    case "config":
      await commands.cmdConfig(rest);
      break;
    case "ping":
      await commands.cmdPing();
      break;
    case "-h":
    case "--help":
    case "help":
      printHelp(deps.log);
      break;
    default:
      throw new CliError(`unknown verb: ${verb}\n` + helpText());
  }
}

/* node:coverage ignore next 4 */
function die(msg) {
  console.error(msg);
  process.exit(1);
}

/* node:coverage ignore next 3 */
if (require.main === module) {
  run().catch((e) => die(e instanceof CliError ? e.message : e.stack || String(e)));
}

module.exports = { run, defaultDeps, normalizeGlobalArgs };

export {};
