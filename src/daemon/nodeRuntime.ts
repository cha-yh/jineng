// @ts-nocheck
const fs = require("fs");
const os = require("os");
const path = require("path");

function findVersionFile(cwd) {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    for (const name of [".nvmrc", ".node-version"]) {
      const f = path.join(dir, name);
      if (fs.existsSync(f)) return f;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function tryNvm(version) {
  const bin = path.join(os.homedir(), ".nvm", "versions", "node", "v" + version, "bin");
  if (fs.existsSync(bin)) return { bin, version, source: "nvm" };
  return null;
}

function tryFnm(version) {
  const bin = path.join(
    os.homedir(),
    ".local/share/fnm/node-versions",
    "v" + version,
    "installation/bin",
  );
  if (fs.existsSync(bin)) return { bin, version, source: "fnm" };
  return null;
}

function resolveNodeBin(entry) {
  const explicit = entry.nodeVersion;
  if (explicit) {
    return tryNvm(explicit) || tryFnm(explicit) || { error: `node v${explicit} not installed` };
  }
  if (!entry.cwd) return null;
  const file = findVersionFile(entry.cwd);
  if (!file) return null;
  const ver = fs.readFileSync(file, "utf8").trim().replace(/^v/, "");
  if (!ver) return null;
  const found = tryNvm(ver) || tryFnm(ver);
  if (found) return { ...found, hint: file };
  return { error: `node v${ver} (from ${path.basename(file)}) not installed via nvm/fnm` };
}

module.exports = { resolveNodeBin };

export {};
