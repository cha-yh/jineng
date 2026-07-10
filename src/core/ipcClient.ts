// @ts-nocheck
const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  HOME_DIR,
  SOCKET,
  PID_FILE,
  DAEMON_LOG,
  DAEMON_ENTRY,
  REPO_DIR,
} = require("./paths");

function ensureHomeDir() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

function getDaemonPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  return Number.isFinite(pid) ? pid : null;
}

function daemonAlive() {
  const pid = getDaemonPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("timeout waiting for daemon"));
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function spawnDaemon() {
  ensureHomeDir();
  try {
    fs.unlinkSync(SOCKET);
  } catch {}
  const out = fs.openSync(DAEMON_LOG, "a");
  const standalone = process.env.JINENG_STANDALONE === "1";
  const args = standalone ? ["__daemon"] : [DAEMON_ENTRY];
  const cwd = standalone ? path.dirname(process.execPath) : REPO_DIR;
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", out, out],
    cwd,
  });
  child.unref();
  await waitFor(() => fs.existsSync(SOCKET) && daemonAlive(), 5000);
}

function sendOne(message) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET);
    let buf = "";
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {}
      err ? reject(err) : resolve(value);
    };
    client.on("connect", () => {
      client.write(JSON.stringify(message) + "\n");
    });
    client.on("data", (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        const line = buf.slice(0, idx);
        try {
          done(null, JSON.parse(line));
        } catch (e) {
          done(e);
        }
      }
    });
    client.on("error", (err) => done(err));
    client.on("close", () => {
      if (!settled) done(new Error("daemon closed connection without reply"));
    });
  });
}

async function request(message, options = {}) {
  const spawnIfNeeded = options.spawnIfNeeded !== false;
  if (!daemonAlive()) {
    if (!spawnIfNeeded) return { ok: false, error: "daemon not running" };
    await spawnDaemon();
  }
  return sendOne(message);
}

module.exports = { request, daemonAlive, getDaemonPid, spawnDaemon };

export {};
