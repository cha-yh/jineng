// @ts-nocheck
const path = require("path");
const os = require("os");

const HOME_DIR = path.join(os.homedir(), ".jineng");
const SOCKET = path.join(HOME_DIR, "daemon.sock");
const PID_FILE = path.join(HOME_DIR, "daemon.pid");
const DAEMON_LOG = path.join(HOME_DIR, "daemon.log");
const LOGS_DIR = path.join(HOME_DIR, "logs");

const REPO_DIR = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(HOME_DIR, "config.json");
const EXAMPLE_CONFIG_FILE = path.join(REPO_DIR, "config.example.json");
const DAEMON_ENTRY = path.join(REPO_DIR, "daemon", "index.js");

module.exports = {
  HOME_DIR,
  SOCKET,
  PID_FILE,
  DAEMON_LOG,
  LOGS_DIR,
  REPO_DIR,
  CONFIG_FILE,
  EXAMPLE_CONFIG_FILE,
  DAEMON_ENTRY,
};

export {};
