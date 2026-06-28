// @ts-nocheck
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { ensureLogsDir, logFileFor } = require("./logs");
const { pidAlive, signalGroupByPid, spawnViaShell } = require("./processUtils");
const {
  loadWorktrees,
  saveWorktrees,
  loadOptionStore,
  saveOptionStore,
  loadInstances,
  saveInstances,
} = require("./store");
const { gitBranchFor } = require("./gitUtils");
const { portsForPidTree } = require("./ports");
const { resolveNodeBin } = require("./nodeRuntime");
const {
  detectPkgInfo,
  nodeModulesPresent,
  installCommandFor,
} = require("./packageManager");
const {
  buildWorktreeInstance,
  migrateWorktreeLabels,
  discoverWorktrees,
  addWorktreeToStore,
} = require("./worktrees");

class Supervisor {
  constructor() {
    this.records = new Map();
    this._optionStore = loadOptionStore();
    this._worktreeStore = loadWorktrees();
    this._migrateWorktreeLabels();
    ensureLogsDir();
    this._adoptExisting();
    this._startWatcher();
  }

  _migrateWorktreeLabels() {
    const instances = loadInstances();
    const result = migrateWorktreeLabels(this._worktreeStore, instances);
    if (result.storeChanged) saveWorktrees(this._worktreeStore);
    if (result.instancesChanged) saveInstances(instances);
  }

  worktreeInstances(entry) {
    if (entry.type === "task") return [];
    const list = this._worktreeStore[entry.id] || [];
    return list.map((wt) => buildWorktreeInstance(entry, wt));
  }

  expandEntries(configEntries) {
    const out = [];
    for (const e of configEntries) {
      out.push(e);
      out.push(...this.worktreeInstances(e));
    }
    return out;
  }

  discoverWorktrees(cwd) {
    if (!cwd) return { ok: false, error: "cwd required" };
    return discoverWorktrees(cwd);
  }

  addWorktree(entryId, entry, subCwd, label) {
    const reply = addWorktreeToStore(
      this._worktreeStore,
      entryId,
      entry,
      subCwd,
      label,
      this._collectUsedPorts(),
    );
    if (reply.ok) saveWorktrees(this._worktreeStore);
    return reply;
  }

  removeWorktree(instanceId) {
    const at = instanceId.indexOf("@");
    if (at < 0) return { ok: false, error: "not a worktree instance" };
    const entryId = instanceId.slice(0, at);
    const label = instanceId.slice(at + 1);
    const list = this._worktreeStore[entryId];
    if (!list) return { ok: false, error: "no worktrees for entry" };
    const idx = list.findIndex((w) => w.label === label);
    if (idx < 0) return { ok: false, error: "worktree not found" };
    const record = this.records.get(instanceId);
    if (record && this._isActiveRecord(record)) {
      return { ok: false, error: "stop the instance before removing it" };
    }
    list.splice(idx, 1);
    if (list.length === 0) delete this._worktreeStore[entryId];
    this.records.delete(instanceId);
    saveWorktrees(this._worktreeStore);
    return { ok: true };
  }

  _collectUsedPorts() {
    const used = new Set();
    for (const list of Object.values(this._worktreeStore)) {
      for (const w of list) used.add(w.port);
    }
    return used;
  }

  _isActiveRecord(record) {
    return (
      (record.proc || record.adopted) &&
      (record.status === "running" ||
        record.status === "paused" ||
        record.status === "installing")
    );
  }

  _adoptExisting() {
    const saved = loadInstances();
    for (const [id, meta] of Object.entries(saved)) {
      if (!meta || !meta.pid || !pidAlive(meta.pid)) continue;
      this.records.set(id, {
        proc: null,
        adopted: true,
        adoptedPid: meta.pid,
        adoptedPgid: meta.pgid || meta.pid,
        startedAt: meta.startedAt || Date.now(),
        status: meta.paused ? "paused" : "running",
        exitCode: null,
        signal: null,
        stopRequested: false,
        logFd: null,
      });
    }
    this._saveInstances();
  }

  _startWatcher() {
    if (this._watcherTimer) return;
    this._watcherTimer = setInterval(() => {
      let changed = false;
      for (const [id, r] of this.records) {
        if (r.adopted && r.adoptedPid && !pidAlive(r.adoptedPid)) {
          r.status = "stopped";
          r.exitCode = null;
          r.signal = null;
          r.adopted = false;
          r.adoptedPid = null;
          r.adoptedPgid = null;
          changed = true;
          try {
            fs.appendFileSync(
              logFileFor(id),
              `--- adopted process exited (detected via poll) at ${new Date().toISOString()} ---\n`,
            );
          } catch {}
          continue;
        }
        const live =
          (r.proc && r.proc.pid) ||
          (r.adopted && r.adoptedPid && pidAlive(r.adoptedPid));
        if (!live && this._isActiveRecord(r)) {
          r.status = "stopped";
          changed = true;
          try {
            fs.appendFileSync(
              logFileFor(id),
              `--- zombie record cleared (no live process) at ${new Date().toISOString()} ---\n`,
            );
          } catch {}
        }
      }
      if (changed) this._saveInstances();
    }, 2000);
    if (this._watcherTimer.unref) this._watcherTimer.unref();
  }

  _saveInstances() {
    const obj = {};
    for (const [id, r] of this.records) {
      const pid = r.adopted ? r.adoptedPid : r.proc?.pid;
      if (!pid) continue;
      if (r.status !== "running" && r.status !== "paused") continue;
      obj[id] = {
        pid,
        pgid: r.adopted ? r.adoptedPgid : pid,
        startedAt: r.startedAt,
        paused: r.status === "paused",
      };
    }
    saveInstances(obj);
  }

  optionsFor(entry) {
    const result = {};
    if (!entry.options) return result;
    const storeKey = entry.entryId || entry.id;
    for (const k of Object.keys(entry.options)) {
      const spec = entry.options[k];
      const stored = this._optionStore[storeKey]?.[k];
      const acceptStored =
        stored !== undefined && (spec.allowCustom || spec.values?.includes(stored));
      if (acceptStored) result[k] = stored;
      else result[k] = spec.default ?? spec.values?.[0];
    }
    if (entry._portOverride && result.port !== undefined) {
      result.port = entry._portOverride;
    }
    return result;
  }

  setOption(id, key, value) {
    if (!this._optionStore[id]) this._optionStore[id] = {};
    this._optionStore[id][key] = value;
    saveOptionStore(this._optionStore);
    return { ok: true };
  }

  statusOf(id) {
    const r = this.records.get(id);
    if (!r) return { id, status: "stopped", pid: null, startedAt: null };
    return {
      id,
      status: r.status,
      pid: r.adopted ? r.adoptedPid : (r.proc?.pid ?? null),
      adopted: !!r.adopted,
      startedAt: r.startedAt,
      exitCode: r.exitCode ?? null,
      signal: r.signal ?? null,
    };
  }

  listStatuses(entries) {
    return entries.map((e) => {
      const s = this.statusOf(e.id);
      const running = s.status === "running" || s.status === "paused" || s.status === "installing";
      const cwd = e.cwd || process.cwd();
      return {
        ...s,
        label: e.label || e.id,
        type: e.type || "server",
        branch: e.type === "task" ? null : gitBranchFor(cwd),
        ports: running ? portsForPidTree(s.pid) : [],
        statusCheck: this.statusCheckFor(e),
        options: e.options || null,
        optionValues: this.optionsFor(e),
        entryId: e.entryId || e.id,
        worktree: e.worktree || null,
        cwd: e.cwd || null,
        env: e.env || null,
        command: e.command || null,
        statusCommand: e.statusCommand || null,
        shell: e.shell || null,
      };
    });
  }

  statusCheckFor(entry) {
    if (!entry.statusCommand) return null;
    try {
      const output = childProcess.execSync(entry.statusCommand, {
        cwd: entry.cwd || process.cwd(),
        env: { ...process.env, ...(entry.env || {}) },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: entry.statusTimeoutMs || 3000,
        shell: true,
      });
      const text = String(output || "").trim().split(/\r?\n/)[0] || "";
      return { state: "active", ok: true, text };
    } catch (e) {
      const stderr = String(e.stderr || "").trim().split(/\r?\n/)[0];
      const message = stderr || e.message || "inactive";
      return { state: "inactive", ok: false, text: message };
    }
  }

  start(entry) {
    const existing = this.records.get(entry.id);
    if (existing && this._isActiveRecord(existing)) {
      const pid = existing.adopted ? existing.adoptedPid : existing.proc?.pid;
      return { ok: false, error: "already running", pid };
    }
    const file = logFileFor(entry.id);
    const env = { ...process.env, ...(entry.env || {}) };
    const nodeBin = resolveNodeBin(entry);
    if (nodeBin && nodeBin.bin) {
      env.PATH = nodeBin.bin + path.delimiter + (env.PATH || "");
    }

    const cwd = entry.cwd || process.cwd();
    const pkgInfo = entry.type === "task" ? null : detectPkgInfo(cwd);
    const cwdHasPkgJson = fs.existsSync(path.join(cwd, "package.json"));
    const needsInstall =
      pkgInfo && cwdHasPkgJson && !nodeModulesPresent(cwd);
    if (needsInstall) {
      return this._installThenStart(entry, env, nodeBin, pkgInfo, file);
    }

    const record = this._newRecord(entry, null, null, "running");
    this.records.set(entry.id, record);
    return this._spawnDev(entry, record, env, nodeBin);
  }

  _installThenStart(entry, env, nodeBin, pkgInfo, file) {
    const installCmd = installCommandFor(pkgInfo.pm);
    fs.appendFileSync(
      file,
      `\n--- install ${new Date().toISOString()} :: ${installCmd}  (cwd=${pkgInfo.dir}) ---\n`,
    );
    this._appendNodeBinLog(file, nodeBin);

    const out = fs.openSync(file, "a");
    const proc = spawnViaShell(installCmd, entry.shell, {
      cwd: pkgInfo.dir,
      env,
      stdio: ["ignore", out, out],
      detached: true,
    });
    const record = this._newRecord(entry, proc, out, "installing");
    this.records.set(entry.id, record);
    proc.on("exit", (code, signal) => {
      try {
        fs.appendFileSync(
          file,
          `--- install exit code=${code} signal=${signal} at ${new Date().toISOString()} ---\n`,
        );
      } catch {}
      try { fs.closeSync(out); } catch {}
      if (record.stopRequested) {
        record.proc = null;
        record.status = "stopped";
        this._saveInstances();
        return;
      }
      if (code !== 0) {
        record.proc = null;
        record.exitCode = code;
        record.status = "crashed";
        this._saveInstances();
        return;
      }
      record.proc = null;
      this._spawnDev(entry, record, env, nodeBin);
    });
    proc.on("error", (err) => {
      record.status = "crashed";
      record.proc = null;
      try { fs.appendFileSync(file, `--- install error: ${err.message} ---\n`); } catch {}
      this._saveInstances();
    });
    this._saveInstances();
    return { ok: true, pid: proc.pid, status: "installing" };
  }

  _newRecord(entry, proc, out, status) {
    return {
      proc,
      entry,
      adopted: false,
      adoptedPid: null,
      adoptedPgid: null,
      status,
      startedAt: Date.now(),
      exitCode: null,
      signal: null,
      logFd: out,
      stopRequested: false,
    };
  }

  _spawnDev(entry, record, env, nodeBin) {
    const file = logFileFor(entry.id);
    const command = this._buildCommand(entry);
    fs.appendFileSync(file, `\n--- start ${new Date().toISOString()} :: ${command} ---\n`);
    this._appendNodeBinLog(file, nodeBin);
    this._appendWorktreeLog(file, entry);

    const out = fs.openSync(file, "a");
    const proc = spawnViaShell(command, entry.shell, {
      cwd: entry.cwd || process.cwd(),
      env,
      stdio: ["ignore", out, out],
      detached: true,
    });
    record.proc = proc;
    record.logFd = out;
    record.status = "running";
    record.startedAt = Date.now();
    record.exitCode = null;
    record.signal = null;
    proc.on("exit", (code, signal) => {
      record.exitCode = code;
      record.signal = signal;
      record.proc = null;
      const userStopped =
        record.stopRequested ||
        signal === "SIGTERM" ||
        signal === "SIGKILL" ||
        code === 143 ||
        code === 137;
      record.status = userStopped || code === 0 ? "stopped" : "crashed";
      try {
        fs.appendFileSync(
          file,
          `--- exit code=${code} signal=${signal} at ${new Date().toISOString()} ---\n`,
        );
      } catch {}
      try { fs.closeSync(out); } catch {}
      this._saveInstances();
    });
    proc.on("error", (err) => {
      record.status = "crashed";
      record.proc = null;
      try { fs.appendFileSync(file, `--- error: ${err.message} ---\n`); } catch {}
      this._saveInstances();
    });
    this._saveInstances();
    return { ok: true, pid: proc.pid };
  }

  _buildCommand(entry) {
    const optValues = this.optionsFor(entry);
    let command = entry.command.replace(/\{(\w+)\}/g, (_, k) => optValues[k] ?? `{${k}}`);
    if (entry.worktree && entry.worktree.portScript) {
      command = `PORT=$(${entry.worktree.portScript}) ${command}`;
    }
    return command;
  }

  _appendNodeBinLog(file, nodeBin) {
    if (nodeBin && nodeBin.bin) {
      const src = nodeBin.hint ? path.basename(nodeBin.hint) : "entry.nodeVersion";
      fs.appendFileSync(
        file,
        `--- using node v${nodeBin.version} from ${src} (PATH prepended: ${nodeBin.bin}) ---\n`,
      );
    } else if (nodeBin && nodeBin.error) {
      fs.appendFileSync(file, `--- WARN: ${nodeBin.error}; falling back to default node ---\n`);
    }
  }

  _appendWorktreeLog(file, entry) {
    if (!entry.worktree) return;
    const portInfo = entry.worktree.portScript
      ? `PORT=$(${entry.worktree.portScript})`
      : `PORT=${entry.worktree.port}`;
    fs.appendFileSync(
      file,
      `--- worktree instance: ${portInfo} cwd=${entry.cwd} ---\n`,
    );
  }

  _pidForRecord(r) {
    return r.adopted ? r.adoptedPid : r.proc?.pid;
  }

  stop(id) {
    const r = this.records.get(id);
    if (!r) return { ok: false, error: "not running" };
    const pid = this._pidForRecord(r);
    if (!pid) return { ok: false, error: "not running" };
    r.stopRequested = true;
    if (r.status === "paused") signalGroupByPid(pid, "SIGCONT");
    if (!signalGroupByPid(pid, "SIGTERM")) {
      return { ok: false, error: "SIGTERM failed" };
    }
    const grace = setTimeout(() => {
      if (pidAlive(pid)) signalGroupByPid(pid, "SIGKILL");
    }, 5000);
    if (grace.unref) grace.unref();
    if (r.proc) r.proc.once("exit", () => clearTimeout(grace));
    return { ok: true };
  }

  shutdownAll() {
    for (const id of this.records.keys()) this.stop(id);
  }
}

module.exports = { Supervisor, logFileFor };

export {};
