// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const ROOT = path.resolve(__dirname, "..");

function resetDaemonModules(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const key of Object.keys(require.cache)) {
    if (
      key.startsWith(path.join(ROOT, "src", "daemon")) ||
      key.startsWith(path.join(ROOT, "src", "core"))
    ) {
      delete require.cache[key];
    }
  }
}

function withHome(t) {
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  const oldPath = process.env.PATH;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-test-"));
  resetDaemonModules(home);
  t.after(() => {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserProfile;
    process.env.PATH = oldPath;
    resetDaemonModules(oldHome || os.homedir());
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));
}

function makeGitRepo(root, branch = "main") {
  const git = path.join(root, ".git");
  fs.mkdirSync(path.join(git, "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(git, "HEAD"), `ref: refs/heads/${branch}\n`);
}

function freshDaemonModule(relativePath) {
  const file = path.join(ROOT, "src", "daemon", relativePath);
  delete require.cache[require.resolve(file)];
  return require(file);
}

test("daemon logs creates directory and sanitizes ids", (t) => {
  const home = withHome(t);
  const { HOME_DIR, LOGS_DIR } = require("../src/core/paths");
  const { ensureLogsDir, logFileFor } = require("../src/daemon/logs");

  assert.equal(HOME_DIR, path.join(home, ".jineng"));
  ensureLogsDir();
  assert.equal(fs.existsSync(LOGS_DIR), true);
  assert.equal(logFileFor("foo/bar\\baz"), path.join(LOGS_DIR, "foo_bar_baz.log"));
});

test("daemon store persists JSON stores and falls back on invalid files", (t) => {
  withHome(t);
  const { HOME_DIR } = require("../src/core/paths");
  const store = require("../src/daemon/store");

  assert.deepEqual(store.loadWorktrees(), {});
  assert.deepEqual(store.loadOptionStore(), {});
  assert.deepEqual(store.loadInstances(), {});

  store.saveWorktrees({ app: [{ label: "feat", cwd: "/tmp/app", port: 3000 }] });
  store.saveOptionStore({ app: { host: "localhost" } });
  store.saveInstances({ app: { pid: 123, startedAt: 1 } });
  assert.equal(store.loadWorktrees().app[0].label, "feat");
  assert.equal(store.loadOptionStore().app.host, "localhost");
  assert.equal(store.loadInstances().app.pid, 123);

  fs.writeFileSync(path.join(HOME_DIR, "worktrees.json"), "{");
  assert.deepEqual(store.loadWorktrees(), {});
});

test("core config resolves user, env, explicit, and example config paths", (t) => {
  const home = withHome(t);
  const oldConfig = process.env.JINENG_CONFIG;
  delete process.env.JINENG_CONFIG;
  const config = require("../src/core/config");
  const { CONFIG_FILE, EXAMPLE_CONFIG_FILE } = require("../src/core/paths");
  t.after(() => {
    if (oldConfig === undefined) delete process.env.JINENG_CONFIG;
    else process.env.JINENG_CONFIG = oldConfig;
  });

  assert.equal(config.defaultConfigPath(), path.join(home, ".jineng", "config.json"));
  assert.equal(config.exampleConfigPath(), EXAMPLE_CONFIG_FILE);
  assert.equal(config.resolveConfigPath(), EXAMPLE_CONFIG_FILE);
  assert.equal(config.expandHome("~/x"), path.join(home, "x"));

  const init = config.initConfig();
  assert.deepEqual(init, { ok: true, path: CONFIG_FILE });
  assert.equal(config.initConfig().ok, false);
  assert.equal(config.resolveConfigPath(), CONFIG_FILE);
  assert.equal(config.loadConfig().entries[0].id, "web-app");

  const explicit = path.join(home, "custom.json");
  fs.writeFileSync(explicit, JSON.stringify({ entries: [{ id: "api", cwd: "~/api", command: "npm run dev" }] }));
  assert.equal(config.resolveConfigPath(explicit), explicit);
  assert.equal(config.loadConfig(explicit).entries[0].id, "api");
  assert.equal(config.loadConfig(explicit).entries[0].cwd, path.join(home, "api"));

  const envConfig = path.join(home, "env.json");
  fs.writeFileSync(envConfig, JSON.stringify({ entries: [], tasks: [{ id: "task", command: "echo ok" }] }));
  process.env.JINENG_CONFIG = envConfig;
  assert.equal(config.resolveConfigPath(), envConfig);
  assert.equal(config.loadConfig().tasks[0].id, "task");

  fs.writeFileSync(envConfig, JSON.stringify({ entries: [{ id: "bad" }] }));
  assert.throws(() => config.loadConfig(), /entry missing id\/cwd\/command/);
});

test("daemon package manager detects package manager state", (t) => {
  withHome(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-pkg-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "packages", "app");
  fs.mkdirSync(app, { recursive: true });
  const pm = require("../src/daemon/packageManager");

  assert.equal(pm.detectPkgInfo(app), null);
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
  assert.deepEqual(pm.detectPkgInfo(app), { pm: "pnpm", dir: root });
  assert.equal(pm.nodeModulesPresent(app), false);
  fs.mkdirSync(path.join(app, "node_modules"));
  assert.equal(pm.nodeModulesPresent(app), true);
  assert.equal(pm.installCommandFor("pnpm"), "pnpm install");
  assert.equal(pm.installCommandFor("yarn"), "yarn install");
  assert.equal(pm.installCommandFor("npm"), "npm install");
  assert.equal(pm.installCommandFor("bun"), "bun install");
  assert.equal(pm.installCommandFor("missing"), null);
});

test("daemon node runtime resolves nvm, fnm, and missing versions", (t) => {
  const home = withHome(t);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-node-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const runtime = require("../src/daemon/nodeRuntime");

  const nvmBin = path.join(home, ".nvm", "versions", "node", "v20.1.0", "bin");
  fs.mkdirSync(nvmBin, { recursive: true });
  assert.deepEqual(runtime.resolveNodeBin({ cwd: project, nodeVersion: "20.1.0" }), {
    bin: nvmBin,
    version: "20.1.0",
    source: "nvm",
  });

  fs.writeFileSync(path.join(project, ".node-version"), "v22.0.0\n");
  const fnmBin = path.join(home, ".local/share/fnm/node-versions/v22.0.0/installation/bin");
  fs.mkdirSync(fnmBin, { recursive: true });
  const found = runtime.resolveNodeBin({ cwd: path.join(project, "nested") });
  assert.equal(found.bin, fnmBin);
  assert.equal(path.basename(found.hint), ".node-version");

  assert.equal(runtime.resolveNodeBin({ cwd: project, nodeVersion: "99.0.0" }).error, "node v99.0.0 not installed");
});

test("daemon git utils read branches, gitdir files, and missing repos", (t) => {
  withHome(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = require("../src/daemon/gitUtils");

  makeGitRepo(root, "feature/test");
  assert.equal(git.gitBranchFor(path.join(root, "src")), "feature/test");
  assert.equal(git.gitRootOf(path.join(root, "src")), root);
  assert.equal(git.findWorktreeRoot(path.join(root, "src")), root);

  const actualGit = path.join(root, "actual.git");
  const worktree = path.join(root, "linked");
  fs.mkdirSync(actualGit);
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${actualGit}\n`);
  fs.writeFileSync(path.join(actualGit, "HEAD"), "abcdef123456\n");
  assert.equal(git.gitBranchFor(worktree), "abcdef1");
  assert.equal(git.gitBranchFor(os.tmpdir()), null);
});

test("daemon worktree helpers build, migrate, discover, and add instances", (t) => {
  withHome(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-wt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const wtRoot = path.join(root, "feature-one");
  fs.mkdirSync(path.join(wtRoot, "app"), { recursive: true });
  makeGitRepo(wtRoot, "feature/one");
  const worktrees = require("../src/daemon/worktrees");
  const entry = {
    id: "app",
    cwd: path.join(root, "app"),
    command: "npm run dev",
    env: { BASE: "1" },
    options: { port: { values: ["3000"], default: "3000" } },
  };

  const inst = worktrees.buildWorktreeInstance(entry, {
    label: "feature-one",
    cwd: path.join(wtRoot, "app"),
    port: 3456,
  });
  assert.equal(inst.id, "app@feature-one");
  assert.equal(inst.env.PORT, "3456");
  assert.equal(inst._portOverride, "3456");

  const store = { app: [{ label: "old", cwd: path.join(wtRoot, "app"), port: 3456 }] };
  const instances = { "app@old": { pid: 1 } };
  assert.deepEqual(worktrees.migrateWorktreeLabels(store, instances), {
    storeChanged: true,
    instancesChanged: true,
  });
  assert.equal(store.app[0].label, "feature-one");
  assert.deepEqual(instances["app@feature-one"], { pid: 1 });

  const scriptPortEntry = { ...entry, worktreePortScript: "echo 3000" };
  const added = worktrees.addWorktreeToStore({}, "app", scriptPortEntry, path.join(wtRoot, "app"), "bad label!", new Set());
  assert.equal(added.ok, true);
  assert.equal(added.label, "bad-label");
  assert.equal(added.port, null);
  assert.equal(added.portScript, "echo 3000");
  assert.equal(worktrees.addWorktreeToStore({ app: [{ label: "x", cwd: wtRoot }] }, "app", entry, wtRoot, "y", new Set()).ok, false);
  assert.equal(worktrees.addWorktreeToStore({}, "app", entry, path.join(root, "missing"), "x", new Set()).ok, false);
  assert.equal(worktrees.discoverWorktrees(path.join(root, "app")).ok, false);
});

test("daemon worktree discovery parses git worktree porcelain output", (t) => {
  withHome(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-wt-parse-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "packages", "app");
  fs.mkdirSync(app, { recursive: true });
  makeGitRepo(root, "main");

  const linked = path.join(root, "..", "feature-linked");
  fs.mkdirSync(path.join(linked, "packages", "app"), { recursive: true });
  const oldExecSync = childProcess.execSync;
  childProcess.execSync = () => [
    `worktree ${root}`,
    "HEAD abc",
    "branch refs/heads/main",
    `worktree ${linked}`,
    "HEAD def",
    "detached",
    "",
  ].join("\n");
  t.after(() => {
    childProcess.execSync = oldExecSync;
  });
  const worktrees = freshDaemonModule("worktrees.js");

  const reply = worktrees.discoverWorktrees(app);
  assert.equal(reply.ok, true);
  assert.equal(reply.worktrees.length, 2);
  assert.equal(reply.worktrees[0].isPrimary, true);
  assert.equal(reply.worktrees[1].detached, true);
  assert.equal(reply.worktrees[1].exists, true);
});

test("daemon ports reports free-port attempts and inspects current process tree", (t) => {
  withHome(t);
  const ports = require("../src/daemon/ports");

  const picked = ports.pickFreePort(new Set());
  if (picked.ok) {
    assert.equal(Number.isInteger(picked.port), true);
  } else {
    assert.equal(picked.error, "could not pick a free port");
  }
  const found = ports.portsForPidTree(process.pid);
  assert.equal(Array.isArray(found), true);
});

test("daemon ports parses lsof and process tree output", (t) => {
  withHome(t);
  const oldExecSync = childProcess.execSync;
  const oldSpawnSync = childProcess.spawnSync;
  childProcess.execSync = (cmd) => {
    if (String(cmd).startsWith("lsof")) return "p10\nn*:3000\np11\nn127.0.0.1:3001\n";
    if (String(cmd).startsWith("ps")) return "10 1\n11 10\n12 11\n";
    throw new Error(`unexpected command: ${cmd}`);
  };
  childProcess.spawnSync = () => ({ stdout: "4567\n" });
  t.after(() => {
    childProcess.execSync = oldExecSync;
    childProcess.spawnSync = oldSpawnSync;
  });
  const ports = freshDaemonModule("ports.js");

  assert.deepEqual(ports.portsForPidTree(10), [3000, 3001]);
  assert.deepEqual(ports.pickFreePort(new Set([4567])), { ok: false, error: "could not pick a free port" });
  assert.deepEqual(ports.pickFreePort(new Set()), { ok: true, port: 4567 });
});

test("daemon process utils inspect pids, spawn commands, and handle bad pids", async (t) => {
  withHome(t);
  const procUtils = require("../src/daemon/processUtils");

  assert.equal(procUtils.pidAlive(process.pid), true);
  assert.equal(procUtils.pidAlive(99999999), false);
  assert.equal(procUtils.signalGroupByPid(99999999, "SIGTERM"), false);

  const child = procUtils.spawnViaShell("node -e \"process.stdout.write('ok')\"", null, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  assert.equal(stdout, "ok");

  const shellChild = procUtils.spawnViaShell("printf shell", "sh -c", {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let shellStdout = "";
  shellChild.stdout.on("data", (chunk) => {
    shellStdout += chunk;
  });
  const [shellCode] = await once(shellChild, "exit");
  assert.equal(shellCode, 0);
  assert.equal(shellStdout, "shell");
});

test("daemon index handles IPC operations without starting on require", (t) => {
  withHome(t);
  const daemon = require("../src/daemon/index");
  const { CONFIG_FILE } = require("../src/core/paths");
	  const cfg = {
	    entries: [
      {
        id: "web-app",
        cwd: ".",
        command: "npm run dev",
        options: {
          host: { values: ["localhost", "0.0.0.0"], default: "localhost" },
          custom: { allowCustom: true },
        },
	      },
      {
        id: "webview",
        cwd: ".",
        command: "npm run dev",
        options: {
          host: { values: ["local"], default: "local" },
        },
        worktreePortScript: ".scripts/find-port.sh",
      },
      {
        id: "figma-ast",
        cwd: ".",
        command: "bun dev",
        options: {
          port: { values: ["3333"] },
        },
      },
	      { id: "script-port", cwd: ".", command: "npm run dev", worktreePortScript: "echo 3333" },
	    ],
	    tasks: [
	      { id: "login", command: "echo login", statusCommand: "echo status" },
	    ],
	  };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg));
  const supervisor = {
    _worktreeStore: {
      "web-app": [{ label: "feat", cwd: "/tmp/app-feat", port: 4444 }],
      "webview": [{ label: "feat", cwd: "/tmp/web-feat", port: 4444 }],
      "script-port": [{ label: "feat", cwd: "/tmp/script-feat", port: 5555 }],
    },
    expandEntries: (entries) => entries,
    listStatuses: (entries) => entries.map((e) => ({ id: e.id })),
    start: (entry) => ({ ok: true, id: entry.id, env: entry.env, worktree: entry.worktree }),
    stop: (id) => ({ ok: true, id }),
    discoverWorktrees: (cwd) => ({ ok: true, cwd }),
    addWorktree: (id, entry, cwd, label) => ({ ok: true, id, cwd, label }),
    removeWorktree: (id) => ({ ok: true, id }),
    setOption: (id, key, value) => ({ ok: true, id, key, value }),
    statusCheckFor: (entry) => ({ state: "active", ok: true, text: "{", fullText: "{\n  \"Account\": \"1\"\n}" }),
  };

  assert.equal(daemon.resolveInstance(cfg, supervisor, null), null);
	  assert.equal(daemon.resolveInstance(cfg, supervisor, "missing"), null);
	  assert.equal(daemon.resolveInstance(cfg, supervisor, "web-app@missing"), null);
	  assert.equal(daemon.resolveInstance(cfg, supervisor, "login").type, "task");
	  assert.equal(daemon.resolveInstance(cfg, supervisor, "web-app@feat").env.PORT, "4444");
  assert.equal(daemon.resolveInstance(cfg, supervisor, "script-port@feat").worktree.portScript, "echo 3333");

  assert.equal(daemon.handle({ op: "ping" }, supervisor).pong, true);
  const oldKill = process.kill;
  let killed = null;
  process.kill = (pid, signal) => {
    killed = { pid, signal };
    return true;
  };
  process.env.JINENG_CONFIG = path.join(path.dirname(CONFIG_FILE), "missing.json");
  assert.equal(daemon.handle({ op: "shutdown" }, supervisor).ok, true);
  return new Promise((resolve) => {
    setImmediate(() => {
      process.kill = oldKill;
      assert.deepEqual(killed, { pid: process.pid, signal: "SIGTERM" });
      delete process.env.JINENG_CONFIG;
      resolve();
    });
  }).then(() => {
  delete process.env.JINENG_CONFIG;
	  const listReply = daemon.handle({ op: "list" }, supervisor);
	  assert.equal(listReply.entries.length, 4);
	  assert.equal(listReply.tasks.length, 1);
	  assert.equal(daemon.handle({ op: "start", id: "webview@feat" }, supervisor).worktree.portScript, ".scripts/find-port.sh");
	  assert.equal(daemon.handle({ op: "start", id: "login" }, supervisor).id, "login");
  assert.deepEqual(daemon.handle({ op: "statusCheck", id: "login" }, supervisor).check.fullText, "{\n  \"Account\": \"1\"\n}");
  assert.equal(daemon.handle({ op: "statusCheck", id: "missing" }, supervisor).ok, false);
  assert.deepEqual(daemon.handle({ op: "stop", id: "webview" }, supervisor), { ok: true, id: "webview" });
  assert.equal(daemon.handle({ op: "worktreeDiscover", id: "webview" }, supervisor).ok, true);
  assert.equal(daemon.handle({ op: "worktreeAdd", id: "webview", cwd: "/x", label: "x" }, supervisor).ok, true);
  assert.deepEqual(daemon.handle({ op: "worktreeRemove", id: "webview@feat" }, supervisor), { ok: true, id: "webview@feat" });
  assert.equal(daemon.handle({ op: "setOption", id: "webview", key: "host", value: "local" }, supervisor).ok, true);
  assert.equal(daemon.handle({ op: "setOption", id: "webview", key: "host", value: "bad" }, supervisor).ok, false);
  assert.equal(daemon.handle({ op: "setOption", id: "figma-ast", key: "port", value: "" }, supervisor).ok, false);
  assert.equal(daemon.handle({ op: "setOption", id: "missing", key: "x", value: "y" }, supervisor).ok, false);
  assert.equal(daemon.handle({ op: "start", id: "missing" }, supervisor).ok, false);
  assert.equal(daemon.handle({ op: "worktreeDiscover", id: "missing" }, supervisor).ok, false);
  assert.equal(daemon.handle({ op: "worktreeAdd", id: "missing", cwd: "/x", label: "x" }, supervisor).ok, false);
  assert.equal(daemon.handle({ op: "unknown" }, supervisor).ok, false);
  });
});

test("daemon index server handles JSON lines on a socket", async (t) => {
  withHome(t);
  const daemon = require("../src/daemon/index");
  const supervisor = {
    _worktreeStore: {},
    expandEntries: (entries) => entries,
    listStatuses: () => [{ id: "listed" }],
  };
  const server = daemon.createServer(supervisor);
  const socket = new EventEmitter();
  let received = "";
  socket.write = (chunk) => {
    received += chunk;
  };
  server.emit("connection", socket);
  socket.emit("data", Buffer.from("{bad json\n"));
  socket.emit("data", Buffer.from(JSON.stringify({ op: "list" }) + "\n"));

  const replies = received.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(replies[0].ok, false);
  assert.equal(replies[0].error, "bad json");
  assert.deepEqual(replies[1].entries, [{ id: "listed" }]);
  socket.emit("error", new Error("ignored"));
});

test("daemon supervisor manages records, options, statuses, and worktree removal", (t) => {
  withHome(t);
  const { Supervisor } = require("../src/daemon/supervisor");
  const supervisor = new Supervisor();
  t.after(() => {
    if (supervisor._watcherTimer) clearInterval(supervisor._watcherTimer);
  });

  assert.deepEqual(supervisor.optionsFor({ id: "plain" }), {});
  assert.deepEqual(
    supervisor.optionsFor({
      id: "app",
      options: {
        host: { values: ["localhost", "0.0.0.0"], default: "localhost" },
        port: { allowCustom: true, default: "3000" },
      },
    }),
    { host: "localhost", port: "3000" },
  );
  assert.deepEqual(supervisor.setOption("app", "host", "0.0.0.0"), { ok: true });

  const entry = {
    id: "app",
    label: "App",
    cwd: os.tmpdir(),
    command: "echo {host}",
    options: { host: { values: ["localhost"], default: "localhost" } },
    env: { A: "B" },
  };
  assert.equal(supervisor._buildCommand(entry), "echo localhost");
  assert.equal(supervisor.expandEntries([{ id: "task", type: "task", command: "echo ok" }]).length, 1);
  assert.deepEqual(supervisor.statusOf("missing"), { id: "missing", status: "stopped", pid: null, startedAt: null });

  const record = supervisor._newRecord(entry, { pid: 99999999, once: () => {} }, null, "running");
  supervisor.records.set("app", record);
  assert.equal(supervisor.statusOf("app").pid, 99999999);
  assert.equal(supervisor.stop("missing").ok, false);
  assert.equal(supervisor.stop("app").ok, false);
  assert.equal(supervisor.listStatuses([entry])[0].label, "App");

  const oldExecSync = childProcess.execSync;
  childProcess.execSync = (cmd) => {
    if (cmd === "status ok") return "arn:aws:iam::1:user/test\nsecond line\n";
    throw Object.assign(new Error("not logged in"), { stderr: "expired\nmore" });
  };
  try {
    assert.deepEqual(supervisor.statusCheckFor({ id: "task", type: "task", command: "run", statusCommand: "status ok" }), {
      state: "active",
      ok: true,
      text: "arn:aws:iam::1:user/test",
      fullText: "arn:aws:iam::1:user/test\nsecond line",
    });
    assert.deepEqual(supervisor.statusCheckFor({ id: "task", type: "task", command: "run", statusCommand: "status bad" }), {
      state: "inactive",
      ok: false,
      text: "expired",
      fullText: "expired\nmore",
    });
    assert.equal(supervisor.statusCheckFor({ id: "task", type: "task", command: "run" }), null);
  } finally {
    childProcess.execSync = oldExecSync;
  }

  supervisor._worktreeStore = { app: [{ label: "feat", cwd: os.tmpdir(), port: 3001 }] };
  assert.equal(supervisor.expandEntries([entry]).length, 2);
  assert.equal(supervisor.removeWorktree("app").ok, false);
  assert.equal(supervisor.removeWorktree("app@missing").ok, false);
  supervisor.records.set("app@feat", supervisor._newRecord(entry, { pid: process.pid }, null, "running"));
  assert.equal(supervisor.removeWorktree("app@feat").ok, false);
  supervisor.records.delete("app@feat");
  assert.equal(supervisor.removeWorktree("app@feat").ok, true);
  assert.deepEqual(supervisor.discoverWorktrees(os.tmpdir()).ok, false);
  assert.deepEqual(supervisor.addWorktree("app", entry, path.join(os.tmpdir(), "missing"), "x").ok, false);
});

test("daemon supervisor adopts existing instances and saves only active records", (t) => {
  withHome(t);
  const store = require("../src/daemon/store");
  store.saveInstances({
    alive: { pid: process.pid, pgid: process.pid, startedAt: 123, paused: true },
    dead: { pid: 99999999, startedAt: 1 },
  });
  const { Supervisor } = require("../src/daemon/supervisor");
  const supervisor = new Supervisor();
  t.after(() => {
    if (supervisor._watcherTimer) clearInterval(supervisor._watcherTimer);
  });

  assert.equal(supervisor.statusOf("alive").status, "paused");
  assert.equal(supervisor.statusOf("alive").adopted, true);
  supervisor.records.set("crashed", { proc: { pid: 1 }, status: "crashed" });
  supervisor._saveInstances();
  const saved = store.loadInstances();
  assert.equal(saved.alive.pid, process.pid);
  assert.equal(saved.crashed, undefined);
});

test("daemon supervisor observes successful and failed child commands", async (t) => {
  withHome(t);
  const { Supervisor } = require("../src/daemon/supervisor");
  const supervisor = new Supervisor();
  t.after(() => {
    for (const id of supervisor.records.keys()) supervisor.stop(id);
    if (supervisor._watcherTimer) clearInterval(supervisor._watcherTimer);
  });

  let reply = supervisor.start({
    id: "quick",
    cwd: os.tmpdir(),
    command: "node -e \"process.exit(0)\"",
  });
  assert.equal(reply.ok, true);
  let record = supervisor.records.get("quick");
  await once(record.proc, "exit");
  assert.equal(record.status, "stopped");

  reply = supervisor.start({
    id: "bad",
    cwd: os.tmpdir(),
    command: "node -e \"process.exit(2)\"",
  });
  assert.equal(reply.ok, true);
  record = supervisor.records.get("bad");
  await once(record.proc, "exit");
  assert.equal(record.status, "crashed");
  assert.equal(record.exitCode, 2);
});

test("daemon supervisor handles failed install phase", async (t) => {
  const home = withHome(t);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-install-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 9\n");
  fs.chmodSync(path.join(bin, "pnpm"), 0o755);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  fs.writeFileSync(path.join(project, "package.json"), "{}");
  fs.writeFileSync(path.join(project, "pnpm-lock.yaml"), "");
  const { Supervisor } = require("../src/daemon/supervisor");
  const supervisor = new Supervisor();
  t.after(() => {
    if (supervisor._watcherTimer) clearInterval(supervisor._watcherTimer);
  });

  const reply = supervisor.start({
    id: "install-fail",
    cwd: project,
    command: "node -e \"process.exit(0)\"",
  });
  assert.equal(reply.status, "installing");
  const record = supervisor.records.get("install-fail");
  await once(record.proc, "exit");
  assert.equal(record.status, "crashed");
  assert.equal(record.exitCode, 9);
});

test("daemon index filesystem helpers create and clear artifacts", (t) => {
  withHome(t);
  const daemon = require("../src/daemon/index");
  const { HOME_DIR, SOCKET, PID_FILE } = require("../src/core/paths");

  daemon.ensureHomeDir();
  assert.equal(fs.existsSync(HOME_DIR), true);
  fs.writeFileSync(SOCKET, "");
  fs.writeFileSync(PID_FILE, "not-a-pid");
  daemon.checkExistingDaemon();
  daemon.clearArtifacts();
  assert.equal(fs.existsSync(SOCKET), false);
  assert.equal(fs.existsSync(PID_FILE), false);
});

export {};
