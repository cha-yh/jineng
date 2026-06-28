// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { createCommands } = require("../src/cli/commands");
const { CliError } = require("../src/cli/errors");
const {
  STATUS_COLOR,
  printResult,
  pad,
  fmtUptime,
  helpText,
  configHelpText,
  printHelp,
} = require("../src/cli/format");
const { run, defaultDeps } = require("../src/cli/index");

function makeDeps(overrides = {}) {
  const logs = [];
  const exitCodes = [];
  const requests = [];
  const replies = overrides.replies ? [...overrides.replies] : [];
  const deps = {
    request: async (message) => {
      requests.push(message);
      if (overrides.request) return overrides.request(message);
      return replies.shift() || { ok: true };
    },
    daemonAlive: () => false,
    getDaemonPid: () => 1234,
    spawnDaemon: async () => {},
    initConfig: () => ({ ok: true, path: "/tmp/jineng/config.json" }),
    resolveConfigPath: () => "/tmp/jineng/config.json",
    defaultConfigPath: () => "/tmp/jineng/config.json",
    log: (line) => logs.push(line),
    setExitCode: (code) => exitCodes.push(code),
    now: () => 10_000,
    sleep: async (ms) => logs.push(`sleep ${ms}`),
    startTui: async () => logs.push("tui"),
    ...overrides,
  };
  deps.logs = logs;
  deps.exitCodes = exitCodes;
  deps.requests = requests;
  return deps;
}

function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;]*m/g, "");
}

test("format helpers render stable CLI text", () => {
  assert.equal(typeof STATUS_COLOR.running("x"), "string");
  assert.equal(pad("a", 3), "a  ");
  assert.equal(pad("abcd", 3), "abcd");
  assert.equal(fmtUptime(3_661_000), "01:01:01");
  assert.match(helpText(), /jineng daemon start\|stop\|status/);
  assert.match(helpText(), /jineng config help/);
  assert.match(configHelpText(), /entries\[\]/);
  assert.match(configHelpText(), /tasks\[\]/);
  assert.match(configHelpText(), /worktreePortScript/);
  assert.match(configHelpText(), /statusTimeoutMs/);
  assert.match(configHelpText(), /allowCustom/);

  const logs = [];
  printHelp((line) => logs.push(line));
  assert.equal(logs[0], helpText());

  const exitCodes = [];
  printResult("start", "api", { ok: true, pid: 55 }, (line) => logs.push(line));
  printResult(
    "start",
    "api",
    { ok: false, error: "bad" },
    (line) => logs.push(line),
    (code) => exitCodes.push(code),
  );
  assert.match(stripAnsi(logs.at(-2)), /start api: ok \(pid 55\)/);
  assert.match(stripAnsi(logs.at(-1)), /start api: bad/);
  assert.deepEqual(exitCodes, [1]);
});

test("default exit-code callbacks are covered without injected setters", async () => {
  const oldExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const logs = [];
    printResult("stop", "api", { ok: false, error: "nope" }, (line) => logs.push(line));
    assert.equal(process.exitCode, 1);
    assert.match(stripAnsi(logs[0]), /stop api: nope/);

    process.exitCode = undefined;
    const deps = makeDeps({
      setExitCode: undefined,
      sleep: undefined,
      replies: [
        { ok: false, error: "not running" },
        { ok: true, pid: 101 },
        { ok: false, error: "bad value" },
      ],
    });
    await createCommands(deps).cmdRestart("api");
    await createCommands(deps).cmdSetOption("api", "host", "bad");
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = oldExitCode;
  }
});

test("cmdList prints empty, rows, unknown colors, and request errors", async () => {
  const deps = makeDeps({
    replies: [
      { ok: true, entries: [] },
      {
        ok: true,
        entries: [
          { id: "api", status: "running", pid: 10, startedAt: 4_000, label: "API" },
          { id: "web", status: "installing", pid: null, startedAt: null, label: "" },
        ],
      },
      { ok: false, error: "nope" },
    ],
  });
  const commands = createCommands(deps);

  await commands.cmdList();
  assert.equal(deps.logs[0], "(no entries)");

  await commands.cmdList();
  assert.match(stripAnsi(deps.logs[1]), /ID\s+STATUS\s+PID\s+UPTIME\s+LABEL/);
  assert.match(stripAnsi(deps.logs[2]), /api\s+running\s+10\s+00:00:06\s+API/);
  assert.match(stripAnsi(deps.logs[3]), /web\s+installing\s+—\s+—/);

  await assert.rejects(commands.cmdList(), /nope/);
});

test("lifecycle commands validate input and set exit code on failure", async () => {
  const deps = makeDeps({
    replies: [
      { ok: true, pid: 22 },
      { ok: false, error: "already running" },
    ],
  });
  const commands = createCommands(deps);

  await assert.rejects(commands.cmdLifecycle("start"), /usage: jineng start <id>/);
  await commands.cmdLifecycle("start", "api");
  await commands.cmdLifecycle("start", "api");

  assert.deepEqual(deps.requests, [
    { op: "start", id: "api" },
    { op: "start", id: "api" },
  ]);
  assert.match(stripAnsi(deps.logs[0]), /start api: ok \(pid 22\)/);
  assert.match(stripAnsi(deps.logs[1]), /start api: already running/);
  assert.deepEqual(deps.exitCodes, [1]);
});

test("option commands cover validation, empty specs, choices, custom values, and failures", async () => {
  const deps = makeDeps({
    replies: [
      { ok: false, error: "list failed" },
      { ok: true, entries: [] },
      { ok: true, entries: [{ id: "api", options: null, optionValues: {} }] },
      {
        ok: true,
        entries: [
          {
            id: "web",
            options: {
              host: { values: ["localhost", "0.0.0.0"] },
              port: { values: ["3000"], allowCustom: true },
              mode: {},
            },
            optionValues: { host: "localhost", mode: null },
          },
        ],
      },
      { ok: true },
      { ok: false, error: "bad value" },
    ],
  });
  const commands = createCommands(deps);

  await assert.rejects(commands.cmdOptions(), /usage: jineng opts <id>/);
  await assert.rejects(commands.cmdOptions("api"), /list failed/);
  await assert.rejects(commands.cmdOptions("missing"), /unknown entry: missing/);
  await commands.cmdOptions("api");
  await commands.cmdOptions("web");
  await assert.rejects(commands.cmdSetOption("web", "host"), /usage: jineng opt/);
  await commands.cmdSetOption("web", "host", "localhost");
  await commands.cmdSetOption("web", "host", "bad");

  assert.match(stripAnsi(deps.logs[0]), /\(api has no options\)/);
  assert.match(stripAnsi(deps.logs[1]), /web options:/);
  assert.match(stripAnsi(deps.logs[2]), /host = localhost\s+allowed: localhost \| 0.0.0.0/);
  assert.match(stripAnsi(deps.logs[3]), /port = —\s+allowed: 3000 \| <custom>/);
  assert.match(stripAnsi(deps.logs[4]), /mode = —\s+allowed:/);
  assert.match(stripAnsi(deps.logs[5]), /web host=localhost: ok/);
  assert.match(stripAnsi(deps.logs[6]), /web host=bad: bad value/);
  assert.deepEqual(deps.exitCodes, [1]);
});

test("restart command handles usage, stop failure, not-running, and start failure", async () => {
  const deps = makeDeps({
    replies: [
      { ok: false, error: "permission denied" },
      { ok: false, error: "not running" },
      { ok: true, pid: 99 },
      { ok: true },
      { ok: false, error: "start failed" },
    ],
  });
  const commands = createCommands(deps);

  await assert.rejects(commands.cmdRestart(), /usage: jineng restart <id>/);
  await commands.cmdRestart("api");
  await commands.cmdRestart("api");
  await commands.cmdRestart("api");

  assert.deepEqual(deps.requests, [
    { op: "stop", id: "api" },
    { op: "stop", id: "api" },
    { op: "start", id: "api" },
    { op: "stop", id: "api" },
    { op: "start", id: "api" },
  ]);
  assert.equal(deps.logs.filter((line) => line === "sleep 400").length, 2);
  assert.match(stripAnsi(deps.logs[0]), /restart api: permission denied/);
  assert.match(stripAnsi(deps.logs[2]), /restart api: ok \(pid 99\)/);
  assert.match(stripAnsi(deps.logs[4]), /restart api: start failed/);
  assert.deepEqual(deps.exitCodes, [1, 1]);
});

test("daemon command covers status, start, stop, and usage branches", async () => {
  let alive = false;
  let pid = 700;
  let spawned = 0;
  const deps = makeDeps({
    daemonAlive: () => alive,
    getDaemonPid: () => pid,
    spawnDaemon: async () => {
      spawned += 1;
      alive = true;
      pid = 701;
    },
    replies: [{ ok: true }],
  });
  const commands = createCommands(deps);

  await commands.cmdDaemon("status");
  await commands.cmdDaemon("start");
  await commands.cmdDaemon("status");
  await commands.cmdDaemon("start");
  alive = false;
  await commands.cmdDaemon("stop");
  alive = true;
  await commands.cmdDaemon("stop");
  await assert.rejects(commands.cmdDaemon("bad"), /usage: jineng daemon/);

  const text = deps.logs.map(stripAnsi).join("\n");
  assert.match(text, /not running/);
  assert.match(text, /started \(pid 701\)/);
  assert.match(text, /running \(pid 701\)/);
  assert.match(text, /already running \(pid 701\)/);
  assert.match(text, /stopping…/);
  assert.equal(spawned, 1);
  assert.deepEqual(deps.requests, [{ op: "shutdown" }]);
});

test("ping command prints raw JSON", async () => {
  const deps = makeDeps({ replies: [{ ok: true, pong: true, pid: 1 }] });
  await createCommands(deps).cmdPing();
  assert.equal(deps.logs[0], JSON.stringify({ ok: true, pong: true, pid: 1 }));
});

test("run routes every public verb and aliases", async () => {
  const oldConfig = process.env.JINENG_CONFIG;
  const calls = [];
  const deps = makeDeps({
    request: async (message) => {
      calls.push(message);
      if (message.op === "list") return { ok: true, entries: [] };
      return { ok: true };
    },
  });

  try {
    await run([], deps);
    await run(["ls"], deps);
    await run(["start", "api"], deps);
    await run(["stop", "api"], deps);
    await run(["restart", "api"], deps);
    await run(["opts", "api"], {
      ...deps,
      request: async () => ({ ok: true, entries: [{ id: "api", options: null }] }),
    });
    await run(["options", "api"], {
      ...deps,
      request: async () => ({ ok: true, entries: [{ id: "api", options: null }] }),
    });
    await run(["opt", "api", "host", "localhost"], deps);
    await run(["set-option", "api", "host", "localhost"], deps);
    await run(["daemon", "status"], deps);
    await run(["init"], deps);
    await run(["init", "--force"], {
      ...deps,
      initConfig: ({ force }) => ({ ok: force, path: "/tmp/jineng/config.json" }),
    });
    await run(["config", "path"], deps);
    await run(["config", "help"], deps);
    await run(["config", "--help"], deps);
    await assert.rejects(run(["config"], deps), /usage: jineng config path\|help/);
    await run(["--config", "/tmp/custom.json", "ping"], deps);
    assert.equal(process.env.JINENG_CONFIG, "/tmp/custom.json");
    await run(["ping"], deps);
    await run(["help"], deps);
    await run(["-h"], deps);
    await run(["--help"], deps);
    await assert.rejects(run(["--config"], deps), /usage: jineng --config/);
    await assert.rejects(run(["wat"], deps), CliError);
  } finally {
    if (oldConfig === undefined) delete process.env.JINENG_CONFIG;
    else process.env.JINENG_CONFIG = oldConfig;
  }

  assert.equal(deps.logs[0], "tui");
  assert.ok(deps.logs.some((line) => /usage:/.test(line)));
  assert.ok(deps.logs.some((line) => /created \/tmp\/jineng\/config\.json/.test(stripAnsi(line))));
  assert.ok(deps.logs.some((line) => /\/tmp\/jineng\/config\.json/.test(stripAnsi(line))));
  assert.ok(deps.logs.some((line) => /Jineng config help/.test(stripAnsi(line))));
  assert.ok(calls.some((message) => message.op === "ping"));
});

test("defaultDeps exposes production dependencies", () => {
  const deps = defaultDeps();
  assert.equal(typeof deps.request, "function");
  assert.equal(typeof deps.daemonAlive, "function");
  assert.equal(typeof deps.getDaemonPid, "function");
  assert.equal(typeof deps.spawnDaemon, "function");
  assert.equal(typeof deps.startTui, "function");
});

export {};
