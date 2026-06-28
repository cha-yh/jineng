// @ts-nocheck
const fs = require("fs");
const path = require("path");

function findGitDir(cwd) {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    const candidate = path.join(dir, ".git");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

function gitBranchFor(cwd) {
  try {
    const gitPath = findGitDir(cwd);
    if (!gitPath) return null;
    const stat = fs.statSync(gitPath);
    let headPath;
    if (stat.isDirectory()) {
      headPath = path.join(gitPath, "HEAD");
    } else if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, "utf8").trim();
      const m = content.match(/^gitdir:\s*(.+)$/);
      if (!m) return null;
      const actualGitDir = path.isAbsolute(m[1]) ? m[1] : path.resolve(path.dirname(gitPath), m[1]);
      headPath = path.join(actualGitDir, "HEAD");
    } else {
      return null;
    }
    const head = fs.readFileSync(headPath, "utf8").trim();
    const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (refMatch) return refMatch[1];
    return head.slice(0, 7);
  } catch {
    return null;
  }
}

function gitRootOf(cwd) {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    const candidate = path.join(dir, ".git");
    if (fs.existsSync(candidate)) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function findWorktreeRoot(cwd) {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

module.exports = { gitBranchFor, gitRootOf, findWorktreeRoot };

export {};
