#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const inputVersion = args.find((arg) => !arg.startsWith("--"));

function usage() {
  console.log([
    "usage: pnpm release -- <version> [--github] [--skip-tests] [--no-git] [--dry-run]",
    "",
    "examples:",
    "  pnpm release -- 0.2.0",
    "  pnpm release -- v0.2.0 --github",
  ].join("\n"));
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNpmPack(args) {
  run("npm", ["pack", ...args], {
    env: {
      ...process.env,
      npm_config_cache: process.env.npm_config_cache || join(tmpdir(), "jineng-npm-cache"),
    },
  });
}

function output(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function requireGitClean() {
  if (!existsSync(".git")) return false;
  const status = output("git", ["status", "--porcelain"]);
  if (status == null) return false;
  if (status !== "") {
    console.error("release aborted: git working tree is not clean");
    process.exit(1);
  }
  return true;
}

function packageArchiveName(name, version) {
  const normalizedName = name.startsWith("@") ? name.slice(1).replace("/", "-") : name;
  return `${normalizedName}-${version}.tgz`;
}

if (!inputVersion || flags.has("--help") || flags.has("-h")) {
  usage();
  process.exit(inputVersion ? 0 : 1);
}

const version = inputVersion.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`invalid version: ${inputVersion}`);
  usage();
  process.exit(1);
}

const tag = `v${version}`;
const dryRun = flags.has("--dry-run");
const useGit = !flags.has("--no-git");
const useGithub = flags.has("--github");
const skipTests = flags.has("--skip-tests");

const originalPackageJson = readFileSync("package.json", "utf8");
let restorePackageOnExit = false;
process.on("exit", () => {
  if (restorePackageOnExit) {
    writeFileSync("package.json", originalPackageJson);
  }
});

const pkg = JSON.parse(originalPackageJson);
const previousVersion = pkg.version;
pkg.version = version;

console.log(`release ${previousVersion} -> ${version}`);

let gitAvailable = false;
if (useGit && !dryRun) {
  gitAvailable = requireGitClean();
}

writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
restorePackageOnExit = dryRun;

if (!skipTests) {
  run("pnpm", ["run", "check"]);
  run("pnpm", ["test"]);
}

runNpmPack(["--dry-run"]);

if (dryRun) {
  restorePackageOnExit = false;
  writeFileSync("package.json", originalPackageJson);
  console.log("dry run complete; package.json was not changed");
  process.exit(0);
}

if (gitAvailable) {
  run("git", ["add", "package.json"]);
  run("git", ["commit", "-m", `Release ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", tag]);
  console.log(`created git commit and tag ${tag}`);
} else if (useGit) {
  console.log("git repository not detected; skipped commit and tag");
}

if (useGithub) {
  const archive = packageArchiveName(pkg.name, version);
  runNpmPack([]);
  const notes = `Release ${tag}`;
  run("gh", [
    "release",
    "create",
    tag,
    archive,
    "--title",
    tag,
    "--notes",
    notes,
  ]);
  console.log(`created GitHub release ${tag} with ${archive}`);
} else {
  console.log("next steps:");
  console.log(`  git push origin main ${tag}`);
  console.log("  GitHub Actions will create the release from the pushed tag.");
}
