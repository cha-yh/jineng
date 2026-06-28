// @ts-nocheck
const { spawn } = require("child_process");

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroupByPid(pid, sig) {
  try {
    process.kill(-pid, sig);
    return true;
  } catch {
    try {
      process.kill(pid, sig);
      return true;
    } catch {
      return false;
    }
  }
}

function spawnViaShell(command, shellSpec, opts) {
  if (!shellSpec) {
    return spawn(command, { shell: true, ...opts });
  }
  const parts = shellSpec.trim().split(/\s+/);
  const bin = parts[0];
  const args = parts.slice(1).concat([command]);
  return spawn(bin, args, opts);
}

module.exports = { pidAlive, signalGroupByPid, spawnViaShell };

export {};
