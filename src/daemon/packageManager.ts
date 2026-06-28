// @ts-nocheck
const fs = require("fs");
const path = require("path");

function detectPkgInfo(cwd) {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return { pm: "pnpm", dir };
    if (fs.existsSync(path.join(dir, "yarn.lock"))) return { pm: "yarn", dir };
    if (fs.existsSync(path.join(dir, "bun.lockb"))) return { pm: "bun", dir };
    if (fs.existsSync(path.join(dir, "package-lock.json"))) return { pm: "npm", dir };
    dir = path.dirname(dir);
  }
  return null;
}

function nodeModulesPresent(cwd) {
  return fs.existsSync(path.join(cwd, "node_modules"));
}

function installCommandFor(pm) {
  switch (pm) {
    case "pnpm": return "pnpm install";
    case "yarn": return "yarn install";
    case "npm": return "npm install";
    case "bun": return "bun install";
    default: return null;
  }
}

module.exports = { detectPkgInfo, nodeModulesPresent, installCommandFor };

export {};
