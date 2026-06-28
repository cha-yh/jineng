// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { HOME_DIR } = require("../core/paths");

const OPTIONS_FILE = path.join(HOME_DIR, "options.json");
const INSTANCES_FILE = path.join(HOME_DIR, "instances.json");
const WORKTREES_FILE = path.join(HOME_DIR, "worktrees.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch {}
}

function loadWorktrees() {
  return readJson(WORKTREES_FILE, {});
}

function saveWorktrees(obj) {
  writeJson(WORKTREES_FILE, obj);
}

function loadOptionStore() {
  return readJson(OPTIONS_FILE, {});
}

function saveOptionStore(store) {
  writeJson(OPTIONS_FILE, store);
}

function loadInstances() {
  return readJson(INSTANCES_FILE, {});
}

function saveInstances(obj) {
  writeJson(INSTANCES_FILE, obj);
}

module.exports = {
  loadWorktrees,
  saveWorktrees,
  loadOptionStore,
  saveOptionStore,
  loadInstances,
  saveInstances,
};

export {};
