// @ts-nocheck
const fs = require("fs");
const net = require("net");
const { HOME_DIR, SOCKET, PID_FILE } = require("../core/paths");
const { loadConfig, findEntry, findRunnable } = require("../core/config");
const { Supervisor } = require("./supervisor");

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function ensureHomeDir() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

function checkExistingDaemon() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  if (!Number.isFinite(pid)) return;
  try {
    process.kill(pid, 0);
    log(`another daemon is already running (pid ${pid}); exiting`);
    process.exit(1);
  } catch {
    // stale pid file
  }
}

function clearArtifacts() {
  try {
    fs.unlinkSync(SOCKET);
  } catch {}
  try {
    fs.unlinkSync(PID_FILE);
  } catch {}
}

function resolveInstance(cfg, supervisor, id) {
  if (!id) return null;
  const at = id.indexOf("@");
  if (at < 0) return findRunnable(cfg, id);
  const entryId = id.slice(0, at);
  const label = id.slice(at + 1);
  const baseEntry = findEntry(cfg, entryId);
  if (!baseEntry) return null;
  const list = supervisor._worktreeStore[entryId] || [];
  const wt = list.find((w) => w.label === label);
  if (!wt) return null;
  const useScript = !!baseEntry.worktreePortScript;
  const inst = {
    ...baseEntry,
    id,
    entryId,
    cwd: wt.cwd,
    env: { ...(baseEntry.env || {}) },
    worktree: {
      label: wt.label,
      port: useScript ? null : wt.port,
      portScript: useScript ? baseEntry.worktreePortScript : null,
    },
  };
  if (!useScript) {
    inst.env.PORT = String(wt.port);
    if (baseEntry.options && baseEntry.options.port) {
      inst._portOverride = String(wt.port);
    }
  }
  return inst;
}

function handle(req, supervisor) {
  try {
    switch (req.op) {
      case "ping":
        return { ok: true, pong: true, pid: process.pid };
      case "shutdown":
        setImmediate(() => process.kill(process.pid, "SIGTERM"));
        return { ok: true };
    }

    const cfg = loadConfig();
    switch (req.op) {
      case "list": {
        const expanded = supervisor.expandEntries(cfg.entries);
        const tasks = (cfg.tasks || []).map((task) => ({ ...task, type: "task" }));
        return {
          ok: true,
          entries: supervisor.listStatuses(expanded),
          tasks: supervisor.listStatuses(tasks),
        };
      }
      case "start": {
        const e = resolveInstance(cfg, supervisor, req.id);
        if (!e) return { ok: false, error: `unknown entry: ${req.id}` };
        return supervisor.start(e);
      }
      case "statusCheck": {
        const e = resolveInstance(cfg, supervisor, req.id);
        if (!e) return { ok: false, error: `unknown entry: ${req.id}` };
        if (!e.statusCommand) return { ok: false, error: `no statusCommand: ${req.id}` };
        return { ok: true, check: supervisor.statusCheckFor(e) };
      }
      case "stop":
        return supervisor.stop(req.id);
      case "worktreeDiscover": {
        const e = findEntry(cfg, req.id);
        if (!e) return { ok: false, error: `unknown entry: ${req.id}` };
        return supervisor.discoverWorktrees(e.cwd);
      }
      case "worktreeAdd": {
        const e = findEntry(cfg, req.id);
        if (!e) return { ok: false, error: `unknown entry: ${req.id}` };
        return supervisor.addWorktree(e.id, e, req.cwd, req.label);
      }
      case "worktreeRemove": {
        return supervisor.removeWorktree(req.id);
      }
      case "setOption": {
        const at = req.id.indexOf("@");
        const entryId = at < 0 ? req.id : req.id.slice(0, at);
        const e = findEntry(cfg, entryId);
        if (!e || !e.options || !e.options[req.key]) {
          return { ok: false, error: `no such option: ${req.id}.${req.key}` };
        }
        const spec = e.options[req.key];
        const v = req.value;
        if (spec.allowCustom) {
          if (v === undefined || v === null || String(v).trim() === "") {
            return { ok: false, error: "value cannot be empty" };
          }
        } else {
          const allowed = spec.values || [];
          if (!allowed.includes(v)) {
            return { ok: false, error: `value must be one of ${allowed.join(", ")}` };
          }
        }
        return supervisor.setOption(entryId, req.key, v);
      }
      default:
        return { ok: false, error: `unknown op: ${req.op}` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function createServer(supervisor) {
  return net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let req;
        try {
          req = JSON.parse(line);
        } catch (e) {
          socket.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n");
          continue;
        }
        const reply = handle(req, supervisor);
        socket.write(JSON.stringify(reply) + "\n");
      }
    });
    socket.on("error", () => {});
  });
}

function start(options = {}) {
  const supervisor = options.supervisor || new Supervisor();
  const exit = options.exit || process.exit;
  const registerSignals = options.registerSignals !== false;

  ensureHomeDir();
  checkExistingDaemon();
  try {
    fs.unlinkSync(SOCKET);
  } catch {}

  fs.writeFileSync(PID_FILE, String(process.pid));

  const server = createServer(supervisor);

  server.listen(SOCKET, () => {
    try {
      fs.chmodSync(SOCKET, 0o600);
    } catch {}
    log(`daemon listening on ${SOCKET} (pid ${process.pid})`);
  });

  const shutdown = (sig) => {
    log(`received ${sig}, daemon exiting (children kept alive — will reattach on next start)`);
    server.close(() => {
      clearArtifacts();
      exit(0);
    });
    setTimeout(() => {
      clearArtifacts();
      exit(0);
    }, 2000).unref();
  };
  if (registerSignals) {
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
  return { server, supervisor, shutdown };
}

if (require.main === module) {
  start();
}

module.exports = {
  log,
  ensureHomeDir,
  checkExistingDaemon,
  clearArtifacts,
  resolveInstance,
  handle,
  createServer,
  start,
};

export {};
