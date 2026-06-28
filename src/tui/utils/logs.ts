// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { LOGS_DIR } = require("../../core/paths");

const CTRL_RE = /\x1b(?:c|\[[?0-9;]*[ -/]*[@-~]|\][^\x07]*\x07|[@-Z\\-_])/g;
const LOOSE_CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function logPathFor(id) {
  return path.join(LOGS_DIR, `${id}.log`);
}

function stripCtrl(s) {
  return String(s).replace(CTRL_RE, "").replace(LOOSE_CTRL_RE, "");
}

function readTailLines(file, maxBytes, maxLines) {
  const stat = fs.statSync(file);
  if (stat.size > maxBytes) {
    const fd = fs.openSync(file, "r");
    try {
      const start = stat.size - maxBytes;
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, start);
      const text = buf.toString("utf8");
      const firstNewline = text.indexOf("\n");
      const clean = firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
      return clean.split("\n").slice(-maxLines);
    } finally {
      fs.closeSync(fd);
    }
  }
  return fs.readFileSync(file, "utf8").split("\n").slice(-maxLines);
}

function readPreviewLines(file, maxBytes, maxLines) {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const len = stat.size - start;
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8").split("\n").filter((line) => line.length > 0).slice(-maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  logPathFor,
  readPreviewLines,
  readTailLines,
  stripCtrl,
};

export {};
