#!/usr/bin/env node
import { builtinModules } from "node:module";
import { createRequire } from "node:module";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);
const distDir = join(root, "dist");
const seaDir = join(distDir, "sea");
const outDir = join(distDir, "bin");
const entry = join(distDir, "src", "cli", "index.js");
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function output(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function normalize(file) {
  return realpathSync(file);
}

function isRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../");
}

function tryFile(base) {
  if (existsSync(base) && extname(base)) return normalize(base);
  for (const ext of [".js", ".json"]) {
    if (existsSync(base + ext)) return normalize(base + ext);
  }
  if (existsSync(base) && existsSync(join(base, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
    if (pkg.main) {
      const mainFile = tryFile(join(base, pkg.main));
      if (mainFile) return mainFile;
    }
  }
  if (existsSync(join(base, "index.js"))) return normalize(join(base, "index.js"));
  if (existsSync(join(base, "index.json"))) return normalize(join(base, "index.json"));
  return null;
}

function resolveModule(parent, spec) {
  if (builtins.has(spec)) return null;
  if (isRelative(spec)) {
    const file = tryFile(resolve(dirname(parent), spec));
    if (!file) throw new Error(`cannot resolve ${spec} from ${parent}`);
    return file;
  }
  return normalize(nodeRequire.resolve(spec, { paths: [dirname(parent)] }));
}

function findRequires(source) {
  const out = [];
  const re = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = re.exec(source))) out.push(match[1]);
  return out;
}

function collect(file, modules = new Map()) {
  file = normalize(file);
  if (modules.has(file)) return modules;
  const source = readFileSync(file, "utf8");
  modules.set(file, { file, source });
  if (extname(file) === ".json") return modules;
  for (const spec of findRequires(source)) {
    const resolved = resolveModule(file, spec);
    if (resolved) collect(resolved, modules);
  }
  return modules;
}

function makeBundle(entryFile, bundleFile) {
  const modules = collect(entryFile);
  const ids = new Map([...modules.keys()].map((file, index) => [file, index]));
  const records = [...modules.values()].map(({ file, source }) => {
    const id = ids.get(file);
    const dir = dirname(file);
    if (extname(file) === ".json") {
      return `${JSON.stringify(id)}: [${JSON.stringify(file)}, ${JSON.stringify(dir)}, function(require, module) { module.exports = JSON.parse(${JSON.stringify(source)}); }]`;
    }
    return `${JSON.stringify(id)}: [${JSON.stringify(file)}, ${JSON.stringify(dir)}, function(require, module, exports, __filename, __dirname) {\n${source}\n}]`;
  });

  const resolverEntries = [...modules.keys()].map((file) => {
    const source = readFileSync(file, "utf8");
    const entries = [];
    for (const spec of findRequires(source)) {
      const resolved = resolveModule(file, spec);
      if (resolved) entries.push([spec, ids.get(resolved)]);
    }
    return [ids.get(file), entries];
  });

  const bundle = `#!/usr/bin/env node
process.env.JINENG_STANDALONE = "1";
const nativeRequire = require;
const modules = {
${records.join(",\n")}
};
const resolvers = new Map(${JSON.stringify(resolverEntries)});
const cache = new Map();
function __require(id) {
  if (cache.has(id)) return cache.get(id).exports;
  const record = modules[id];
  if (!record) return nativeRequire(id);
  const [filename, dir, factory] = record;
  const module = { exports: {} };
  cache.set(id, module);
  const localRequire = (spec) => {
    const map = resolvers.get(id) || [];
    const hit = map.find(([name]) => name === spec);
    if (hit) return __require(hit[1]);
    return nativeRequire(spec);
  };
  factory(localRequire, module, module.exports, filename, dir);
  return module.exports;
}
const entryModule = __require(${JSON.stringify(ids.get(normalize(entryFile)))});
if (entryModule && typeof entryModule.run === "function") {
  entryModule.run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
`;
  writeFileSync(bundleFile, bundle);
}

function platformName() {
  const platform = process.platform;
  const arch = process.arch;
  if (!["darwin", "linux"].includes(platform)) {
    throw new Error(`unsupported platform for binary build: ${platform}`);
  }
  if (!["arm64", "x64"].includes(arch)) {
    throw new Error(`unsupported architecture for binary build: ${arch}`);
  }
  return `${platform}-${arch}`;
}

function postjectArgs(binary, blob) {
  const args = [
    binary,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (process.platform === "darwin") {
    args.push("--macho-segment-name", "NODE_SEA");
  }
  return args;
}

run("npm", ["run", "build"]);
rmSync(seaDir, { recursive: true, force: true });
mkdirSync(seaDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const bundleFile = join(seaDir, "jineng.bundle.cjs");
const blobFile = join(seaDir, "jineng.blob");
const seaConfigFile = join(seaDir, "sea-config.json");
const binaryFile = join(outDir, `jineng-${platformName()}`);

makeBundle(entry, bundleFile);
writeFileSync(
  seaConfigFile,
  `${JSON.stringify({ main: bundleFile, output: blobFile, disableExperimentalSEAWarning: true }, null, 2)}\n`,
);

run(process.execPath, ["--experimental-sea-config", seaConfigFile]);
copyFileSync(process.execPath, binaryFile);
chmodSync(binaryFile, 0o755);

if (process.platform === "darwin") {
  run("codesign", ["--remove-signature", binaryFile]);
}

const postjectBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");
run(postjectBin, postjectArgs(binaryFile, blobFile));

if (process.platform === "darwin") {
  run("codesign", ["--sign", "-", binaryFile]);
}

const checksum = output("shasum", ["-a", "256", binaryFile]).split(/\s+/)[0];
const checksumFile = join(outDir, `jineng-${platformName()}.sha256`);
writeFileSync(checksumFile, `${checksum}  ${binaryFile.split("/").pop()}\n`);
console.log(`created ${binaryFile}`);
