// @ts-nocheck
const fs = require("fs");
const path = require("path");
const os = require("os");
const { CONFIG_FILE, EXAMPLE_CONFIG_FILE } = require("./paths");

function expandHome(file) {
  if (!file || typeof file !== "string") return file;
  if (file === "~") return os.homedir();
  if (file.startsWith("~/")) return path.join(os.homedir(), file.slice(2));
  return file;
}

function resolveConfigPath(explicitPath = null) {
  if (explicitPath) return path.resolve(expandHome(explicitPath));
  if (process.env.JINENG_CONFIG) return path.resolve(expandHome(process.env.JINENG_CONFIG));
  if (fs.existsSync(CONFIG_FILE)) return CONFIG_FILE;
  return EXAMPLE_CONFIG_FILE;
}

function defaultConfigPath() {
  return CONFIG_FILE;
}

function exampleConfigPath() {
  return EXAMPLE_CONFIG_FILE;
}

function loadConfig(explicitPath = null) {
  const file = resolveConfigPath(explicitPath);
  const raw = fs.readFileSync(file, "utf8");
  const cfg = JSON.parse(raw);
  if (!Array.isArray(cfg.entries)) {
    throw new Error(`${file}: entries[] required`);
  }
  if (cfg.tasks !== undefined && !Array.isArray(cfg.tasks)) {
    throw new Error(`${file}: tasks[] must be an array`);
  }
  for (const e of cfg.entries) {
    if (!e.id || !e.cwd || !e.command) {
      throw new Error(`${file}: entry missing id/cwd/command: ${JSON.stringify(e)}`);
    }
    e.cwd = expandHome(e.cwd);
  }
  for (const t of cfg.tasks || []) {
    if (!t.id || !t.command) {
      throw new Error(`${file}: task missing id/command: ${JSON.stringify(t)}`);
    }
  }
  cfg._path = file;
  return cfg;
}

function initConfig({ force = false, targetPath = CONFIG_FILE } = {}) {
  const target = path.resolve(expandHome(targetPath));
  if (fs.existsSync(target) && !force) {
    return { ok: false, reason: "exists", path: target };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(EXAMPLE_CONFIG_FILE, target);
  return { ok: true, path: target };
}

function findEntry(cfg, id) {
  return cfg.entries.find((e) => e.id === id);
}

function findTask(cfg, id) {
  const task = (cfg.tasks || []).find((t) => t.id === id);
  return task ? { ...task, type: "task" } : null;
}

function findRunnable(cfg, id) {
  return findEntry(cfg, id) || findTask(cfg, id);
}

module.exports = {
  expandHome,
  resolveConfigPath,
  defaultConfigPath,
  exampleConfigPath,
  loadConfig,
  initConfig,
  findEntry,
  findTask,
  findRunnable,
};

export {};
