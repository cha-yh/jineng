// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { LOGS_DIR } = require("../core/paths");

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function logFileFor(id) {
  const safe = String(id).replace(/[\\/]/g, "_");
  return path.join(LOGS_DIR, `${safe}.log`);
}

module.exports = { ensureLogsDir, logFileFor };

export {};
