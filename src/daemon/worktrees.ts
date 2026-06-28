// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { gitRootOf, findWorktreeRoot } = require("./gitUtils");
const { pickFreePort } = require("./ports");

function sanitizeLabel(s) {
  if (!s) return "";
  return String(s).replace(/[^a-zA-Z0-9._\-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function buildWorktreeInstance(entry, wt) {
  const useScript = !!entry.worktreePortScript;
  const inst = {
    ...entry,
    id: `${entry.id}@${wt.label}`,
    entryId: entry.id,
    cwd: wt.cwd,
    env: { ...(entry.env || {}) },
    worktree: {
      label: wt.label,
      port: useScript ? null : wt.port,
      portScript: useScript ? entry.worktreePortScript : null,
    },
  };
  if (!useScript) {
    inst.env.PORT = String(wt.port);
    if (entry.options && entry.options.port) {
      inst._portOverride = String(wt.port);
    }
  }
  return inst;
}

function migrateWorktreeLabels(worktreeStore, instances) {
  const renames = {};
  let storeChanged = false;
  for (const [entryId, list] of Object.entries(worktreeStore)) {
    const used = new Set(list.map((w) => w.label));
    for (const wt of list) {
      const root = findWorktreeRoot(wt.cwd);
      if (!root) continue;
      const next = sanitizeLabel(path.basename(root));
      if (!next || next === wt.label) continue;
      if (used.has(next)) continue;
      used.delete(wt.label);
      used.add(next);
      renames[`${entryId}@${wt.label}`] = `${entryId}@${next}`;
      wt.label = next;
      storeChanged = true;
    }
  }

  let instancesChanged = false;
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (instances[oldKey]) {
      instances[newKey] = instances[oldKey];
      delete instances[oldKey];
      instancesChanged = true;
    }
  }

  return { storeChanged, instancesChanged };
}

function discoverWorktrees(cwd) {
  const repoRoot = gitRootOf(cwd);
  if (!repoRoot) return { ok: false, error: "not a git repo" };
  let out;
  try {
    out = execSync(`git -C "${repoRoot}" worktree list --porcelain`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    return { ok: false, error: `git worktree list failed: ${e.message}` };
  }
  const trees = [];
  let cur = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) trees.push(cur);
      cur = { path: line.slice(9).trim() };
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, "").trim();
    } else if (line === "detached" && cur) {
      cur.detached = true;
    } else if (line.startsWith("HEAD ") && cur) {
      cur.head = line.slice(5).trim();
    }
  }
  if (cur) trees.push(cur);
  const rel = path.relative(repoRoot, path.resolve(cwd));
  const augmented = trees.map((t) => {
    const subCwd = path.join(t.path, rel);
    const exists = fs.existsSync(subCwd);
    const label =
      path.basename(t.path) ||
      t.branch ||
      (t.detached ? (t.head || "detached").slice(0, 7) : "wt");
    return { ...t, subCwd, label, exists, isPrimary: path.resolve(t.path) === repoRoot };
  });
  return { ok: true, worktrees: augmented, repoRoot, rel };
}

function addWorktreeToStore(worktreeStore, entryId, entry, subCwd, label, usedPorts) {
  if (!fs.existsSync(subCwd)) {
    return { ok: false, error: `cwd does not exist: ${subCwd}` };
  }
  if (!worktreeStore[entryId]) worktreeStore[entryId] = [];
  const list = worktreeStore[entryId];
  if (list.some((w) => path.resolve(w.cwd) === path.resolve(subCwd))) {
    return { ok: false, error: "this worktree is already added" };
  }
  const safeLabel = sanitizeLabel(label) || `wt${list.length + 1}`;
  if (list.some((w) => w.label === safeLabel)) {
    return { ok: false, error: `label '${safeLabel}' already in use` };
  }
  let port = null;
  if (entry.worktreePortScript) {
    port = null;
  } else {
    const portResult = pickFreePort(usedPorts);
    if (!portResult.ok) return { ok: false, error: portResult.error };
    port = portResult.port;
  }
  list.push({ label: safeLabel, cwd: subCwd, port });
  return {
    ok: true,
    instanceId: `${entryId}@${safeLabel}`,
    cwd: subCwd,
    port,
    portScript: entry.worktreePortScript || null,
    label: safeLabel,
  };
}

module.exports = {
  buildWorktreeInstance,
  migrateWorktreeLabels,
  discoverWorktrees,
  addWorktreeToStore,
};

export {};
