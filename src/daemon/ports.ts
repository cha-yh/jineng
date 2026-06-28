// @ts-nocheck
const { execSync } = require("child_process");

const PORT_CACHE_MS = 3000;
let portCache = { ts: 0, byPid: new Map(), procTree: new Map() };

function refreshPortCache() {
  const now = Date.now();
  if (now - portCache.ts < PORT_CACHE_MS) return;
  portCache.byPid = listAllListenPorts();
  portCache.procTree = buildProcTree();
  portCache.ts = now;
}

function listAllListenPorts() {
  const byPid = new Map();
  try {
    const out = execSync("lsof -nP -iTCP -sTCP:LISTEN -F pn", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    let curPid = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) {
        curPid = parseInt(line.slice(1), 10) || null;
      } else if (line.startsWith("n") && curPid) {
        const m = line.match(/:(\d+)$/);
        if (m) {
          const port = parseInt(m[1], 10);
          if (!byPid.has(curPid)) byPid.set(curPid, new Set());
          byPid.get(curPid).add(port);
        }
      }
    }
  } catch {}
  return byPid;
}

function buildProcTree() {
  const tree = new Map();
  try {
    const out = execSync("ps -A -o pid=,ppid=", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      const ppid = parseInt(m[2], 10);
      if (!tree.has(ppid)) tree.set(ppid, []);
      tree.get(ppid).push(pid);
    }
  } catch {}
  return tree;
}

function collectDescendants(root, tree) {
  const set = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const p = queue.shift();
    const children = tree.get(p) || [];
    for (const c of children) {
      if (!set.has(c)) {
        set.add(c);
        queue.push(c);
      }
    }
  }
  return set;
}

function portsForPidTree(rootPid) {
  if (!rootPid) return [];
  refreshPortCache();
  const descendants = collectDescendants(rootPid, portCache.procTree);
  const ports = new Set();
  for (const p of descendants) {
    const set = portCache.byPid.get(p);
    if (set) for (const port of set) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

function pickFreePort(usedSet) {
  return pickFreePortSync(usedSet || new Set());
}

function pickFreePortSync(used) {
  const max = 20;
  for (let i = 0; i < max; i++) {
    const p = tryGetFreePort();
    if (p && !used.has(p)) return { ok: true, port: p };
  }
  return { ok: false, error: "could not pick a free port" };
}

function tryGetFreePort() {
  const child = require("child_process").spawnSync(
    process.execPath,
    ["-e", `const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close(()=>{});});`],
    { encoding: "utf8", timeout: 2000 },
  );
  const port = parseInt((child.stdout || "").trim(), 10);
  return Number.isFinite(port) ? port : null;
}

module.exports = { portsForPidTree, pickFreePort };

export {};
