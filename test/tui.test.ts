// @ts-nocheck
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { afterEach, before, describe, it } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const src = (...parts) => path.join(ROOT, "src", ...parts);
const originalLoad = Module._load;
const fakeChalk = createFakeChalk();

before(() => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "chalk") return fakeChalk;
    return originalLoad.call(this, request, parent, isMain);
  };
});

afterEach(() => {
  resetState();
  restoreStdout();
  restoreProcessExit();
  restoreSetTimeout();
});

function createFakeChalk() {
  const color = (s) => String(s);
  color.bold = color;
  color.underline = color;
  return {
    bold: color,
    cyan: color,
    dim: color,
    gray: color,
    green: color,
    magenta: color,
    red: color,
    white: color,
    yellow: color,
  };
}

function fresh(relativePath) {
  const file = src(...relativePath.split("/"));
  delete require.cache[require.resolve(file)];
  return require(file);
}

function stateModule() {
  return require(src("core/state.js"));
}

function resetState() {
  const state = stateModule();
  delete require.cache[require.resolve(src("core/state.js"))];
  const freshState = require(src("core/state.js"));
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, freshState);
}

let stdoutWrites = [];
let stdoutPatched = false;
let originalStdoutWrite;
let originalColumns;
let originalRows;

function captureStdout({ columns = 80, rows = 30 } = {}) {
  if (!stdoutPatched) {
    originalStdoutWrite = process.stdout.write;
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
    process.stdout.write = (chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    };
    stdoutPatched = true;
  }
  stdoutWrites = [];
  process.stdout.columns = columns;
  process.stdout.rows = rows;
  return stdoutWrites;
}

function restoreStdout() {
  if (!stdoutPatched) return;
  process.stdout.write = originalStdoutWrite;
  process.stdout.columns = originalColumns;
  process.stdout.rows = originalRows;
  stdoutWrites = [];
  stdoutPatched = false;
}

let exitPatched = false;
let originalExit;

function captureExit() {
  if (exitPatched) return;
  originalExit = process.exit;
  process.exit = (code) => {
    const err = new Error(`exit ${code}`);
    err.code = code;
    throw err;
  };
  exitPatched = true;
}

function restoreProcessExit() {
  if (!exitPatched) return;
  process.exit = originalExit;
  exitPatched = false;
}

let timeoutPatched = false;
let originalSetTimeout;
let originalClearTimeout;
let scheduled = [];

function captureTimers() {
  if (!timeoutPatched) {
    originalSetTimeout = global.setTimeout;
    originalClearTimeout = global.clearTimeout;
    timeoutPatched = true;
  }
  scheduled = [];
  global.setTimeout = (fn, ms) => {
    const handle = { fn, ms, cleared: false };
    scheduled.push(handle);
    return handle;
  };
  global.clearTimeout = (handle) => {
    if (handle) handle.cleared = true;
  };
  return scheduled;
}

function restoreSetTimeout() {
  if (!timeoutPatched) return;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
  scheduled = [];
  timeoutPatched = false;
}

function injectModule(file, exports) {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

function loadController({ requestImpl, configImpl, renderImpl } = {}) {
  const controllerPath = src("tui/controller.js");
  delete require.cache[require.resolve(controllerPath)];
  injectModule(src("core/ipcClient.js"), { request: requestImpl || (async () => ({ ok: true, entries: [] })) });
  injectModule(src("core/config.js"), { loadConfig: configImpl || (() => ({ entries: [] })) });
  injectModule(src("tui/views/renderer.js"), { render: renderImpl || (() => {}) });
  return require(controllerPath)._test;
}

function sampleEntry(overrides = {}) {
  return {
    id: "app",
    entryId: "app",
    label: "App",
    status: "stopped",
    pid: null,
    startedAt: null,
    branch: "feature/demo",
    ports: [],
    options: null,
    optionValues: {},
    cwd: "/repo",
    command: "npm run dev",
    ...overrides,
  };
}

describe("tui utils", () => {
  it("formats text by visual width", () => {
    const { pad, truncate, visualWidth } = fresh("tui/utils/text.js");
    assert.equal(visualWidth("abc"), 3);
    assert.equal(visualWidth("가a"), 3);
    assert.equal(visualWidth("\x1b[31mred\x1b[0m"), 3);
    assert.equal(pad("가", 4), "가  ");
    assert.equal(truncate("abcdef", 4), "abc…");
    assert.equal(truncate("abc", 4), "abc");
    assert.equal(truncate("", 4), "");
  });

  it("selects and formats entries", () => {
    const entries = fresh("tui/utils/entries.js");
    const state = {
      cursor: 1,
      viewMode: "main",
      detailEntryId: "detail",
	      entries: [
	        sampleEntry({ id: "hidden" }),
	        sampleEntry({ id: "first" }),
	        sampleEntry({ id: "detail", worktree: { label: "branch-a" } }),
	      ],
	      tasks: [
	        sampleEntry({ id: "task", type: "task" }),
	      ],
	    };
	    assert.deepEqual(entries.visibleEntries(state).map((e) => e.id), ["hidden", "first", "detail", "task"]);
	    assert.equal(entries.totalMenuItems(state), 4);
    assert.equal(entries.selectedEntry(state).id, "first");
    assert.equal(entries.detailEntry(state).id, "detail");
    assert.equal(entries.targetEntry(state).id, "first");
    assert.equal(entries.displayId(state.entries[2]), "wt@branch-a");
    assert.equal(entries.displayId(state.entries[1]), "first");
    assert.equal(entries.compactBranch(null), null);
    assert.equal(entries.compactBranch("main"), "main");
    assert.equal(entries.compactBranch("feature/team/demo"), "../team/demo");
    assert.equal(entries.formatPortsForEntry({ ports: [] }), null);
    assert.equal(
      entries.formatPortsForEntry({
        ports: [5173, 9229, 3000],
        optionValues: { port: "3000", inspect: "9229", bad: "x" },
      }),
      "3000/5173/inspect:9229",
    );
    state.viewMode = "detail";
    assert.equal(entries.targetEntry(state).id, "detail");
  });

  it("handles log files, time, terminal constants, and detail actions", () => {
    const logs = fresh("tui/utils/logs.js");
    const terminal = fresh("tui/utils/terminal.js");
    const time = fresh("tui/utils/time.js");
    const { detailActions } = fresh("tui/views/actions.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jineng-logs-"));
    const file = path.join(dir, "app.log");
    fs.writeFileSync(file, "one\ntwo\nthree\nfour\n");
    assert.deepEqual(logs.readTailLines(file, 1000, 2), ["four", ""]);
    assert.deepEqual(logs.readTailLines(file, 8, 3), ["four", ""]);
    assert.deepEqual(logs.readPreviewLines(file, 20, 2), ["three", "four"]);
    assert.equal(logs.stripCtrl("\x1b[31mred\x1bc!"), "red!");
    assert.ok(logs.logPathFor("app").endsWith(path.join(".jineng", "logs", "app.log")));
    assert.equal(time.fmtClock(new Date("2026-01-01T03:04:05")), "03:04:05");
    assert.equal(time.fmtUptime(3_661_000), "01:01:01");
    assert.equal(terminal.CURSOR_HOME, "\x1b[H");
    assert.ok(terminal.ENTER_ALT_SCREEN.includes("1049h"));
    assert.deepEqual(detailActions(sampleEntry()).map((a) => a.key), ["s", "R", "w"]);
    assert.deepEqual(detailActions(sampleEntry({ type: "task" })).map((a) => a.key), ["s", "R"]);
    assert.deepEqual(
      detailActions(sampleEntry({ status: "running", options: { host: {} }, worktree: { label: "wt" } })).map(
        (a) => a.key,
      ),
      ["x", "R", "o", "d"],
    );
  });
});

describe("tui renderer", () => {
  it("renders main, detail, sub-flow, and log views", () => {
    const state = stateModule();
    const { render, _test } = fresh("tui/views/renderer.js");
    captureStdout({ columns: 70, rows: 12 });
    Object.assign(state, {
      loading: false,
      lastRefresh: new Date("2026-01-01T03:04:05"),
	      entries: [
	        sampleEntry({ id: "app", status: "running", startedAt: Date.now() - 1000, ports: [3000] }),
	      ],
	      tasks: [
	        sampleEntry({ id: "login", label: "Login", type: "task", statusCheck: { state: "active", ok: true, text: "ok" } }),
	      ],
	      viewMode: "main",
	    });
    render();
    assert.match(stdoutWrites.at(-1), /Jineng/);
    assert.match(stdoutWrites.at(-1), /app/);
    assert.match(stdoutWrites.at(-1), /TASKS/);
    assert.match(stdoutWrites.at(-1), /login/);
    assert.equal(_test.statusCheckCell({ state: "active" }), "● active");
    assert.equal(_test.statusCheckCell({ state: "inactive" }), "○ inactive");
    assert.equal(_test.statusCheckCell(null), "—");
    state.viewMode = "detail";
    state.detailEntryId = "app";
    state.detailLogPreview = ["\x1b[31mready"];
    render();
    assert.match(stdoutWrites.at(-1), /Actions/);
    assert.match(stdoutWrites.at(-1), /ready/);
    state.viewMode = "optionSelect";
    state.optEntryId = "app";
    state.optKey = "port";
    state.optValues = ["3000", "__CUSTOM__"];
    state.optIndex = 1;
    render();
    assert.match(stdoutWrites.at(-1), /manual input/);
    state.detailEntryId = null;
    state.viewMode = "worktreeSelect";
    state.wtEntryId = "app";
    state.wtList = [{ label: "wt", subCwd: "/repo-wt", exists: false }];
    render();
    assert.match(stdoutWrites.at(-1), /Select worktree/);
    state.viewMode = "log";
    state.logEntryId = "app";
    state.logLines = ["--- start", "warn here", "error here", "http://localhost"];
    state.logScroll = 1;
    state.logClearConfirm = true;
    render();
    assert.match(stdoutWrites.at(-1), /Enter to clear log/);
    assert.equal(_test.compactStatusDot("crashed"), "●");
    assert.equal(_test.compactStatusDot("other"), "○");
    assert.equal(_test.statusCell("other"), "other");
    assert.equal(_test.colorizeLogLine("warn"), "warn");
    assert.equal(_test.colorizeLogLine("http://x.test"), "http://x.test");
    assert.equal(_test.padMin("abcdef", 3), "abcdef  ");
  });

  it("renders error, loading, missing detail, option input, and empty log states", () => {
    const state = stateModule();
    const { render, _test } = fresh("tui/views/renderer.js");
    captureStdout({ columns: 40, rows: 8 });
    Object.assign(state, { loading: true, entries: [], viewMode: "main" });
    render();
    assert.match(stdoutWrites.at(-1), /Loading/);
    Object.assign(state, { loading: false, error: "boom" });
    render();
    assert.match(stdoutWrites.at(-1), /boom/);
    state.error = null;
    state.viewMode = "detail";
    state.detailEntryId = "missing";
    render();
    assert.match(stdoutWrites.at(-1), /entry not found/);
    state.entries = [sampleEntry({ id: "app", options: { host: {} }, optionValues: { host: "local" } })];
    state.viewMode = "optionKeySelect";
    state.detailEntryId = null;
    state.optEntryId = "app";
    state.optKeys = ["host"];
    render();
    assert.match(stdoutWrites.at(-1), /Select option/);
    state.viewMode = "optionInput";
    state.optKey = "port";
    state.inputBuffer = "30";
    state.inputError = "bad";
    render();
    assert.match(stdoutWrites.at(-1), /bad/);
    state.viewMode = "log";
    state.logEntryId = "app";
    state.logLines = [];
    state.logError = null;
    render();
    assert.match(stdoutWrites.at(-1), /no log output/);
    state.logError = "missing";
    render();
    assert.match(stdoutWrites.at(-1), /missing/);
    state.viewMode = "main";
    state.entries = Array.from({ length: 8 }, (_, i) => sampleEntry({ id: `app-${i}` }));
    state.cursor = 7;
    state.hudScrollOffset = 0;
    _test.layoutMain(7);
    assert.ok(state.hudScrollOffset > 0);
    state.cursor = 0;
    _test.layoutMain(7);
    assert.equal(state.hudScrollOffset, 0);
  });
});

describe("tui controller", () => {
  it("refreshes state and handles request errors", async () => {
    const calls = [];
    const state = stateModule();
    const test = loadController({
	      requestImpl: async (msg) => {
	        calls.push(msg);
	        return {
	          ok: true,
	          entries: [sampleEntry({ id: "app", command: null })],
	          tasks: [sampleEntry({ id: "login", type: "task", command: null })],
	        };
	      },
	      configImpl: () => ({
	        entries: [{ id: "app", command: "npm run dev" }],
	        tasks: [{ id: "login", command: "echo login" }],
	      }),
	    });
    Object.assign(state, { loading: true, cursor: 10, viewMode: "detail", detailEntryId: "gone", detailCursor: 9 });
    await test.refresh();
	    assert.equal(calls[0].op, "list");
	    assert.equal(state.entries[0].command, "npm run dev");
	    assert.equal(state.tasks[0].command, "echo login");
	    assert.equal(state.cursor, 1);
    assert.equal(state.viewMode, "main");
    const bad = loadController({ requestImpl: async () => ({ ok: false, error: "bad" }) });
    await bad.refresh();
    assert.equal(state.error, "bad");
    const thrown = loadController({ requestImpl: async () => { throw new Error("offline"); } });
    await thrown.refresh();
    assert.equal(state.error, "offline");
  });

  it("updates detail, log, option, and worktree states", async () => {
    const requests = [];
    const state = stateModule();
    const test = loadController({
      requestImpl: async (msg) => {
        requests.push(msg);
        if (msg.op === "list") return { ok: true, entries: state.entries };
        if (msg.op === "worktreeDiscover") {
          return { ok: true, worktrees: [{ label: "primary", subCwd: "/repo", isPrimary: true }, { label: "wt", subCwd: "/repo-wt", exists: true }] };
        }
        if (msg.op === "worktreeAdd") return { ok: true, instanceId: "app@wt", port: 4000 };
        if (msg.op === "worktreeRemove") return { ok: true };
        return { ok: true, pid: 123 };
      },
    });
	    Object.assign(state, {
	      loading: false,
	      viewMode: "main",
	      entries: [sampleEntry({ id: "app", options: { port: { values: ["3000"], allowCustom: true } } })],
	    });
    test.moveCursor(1);
    assert.equal(state.cursor, 0);
    await test.actionMainEnter();
    assert.equal(state.viewMode, "detail");
    test.moveDetailCursor(1);
    assert.equal(state.detailCursor, 1);
    test.enterLogView();
    assert.equal(state.viewMode, "log");
    test.exitLogView();
    assert.equal(state.viewMode, "detail");
    test.enterOptionFlow();
    assert.equal(state.viewMode, "optionSelect");
    test.moveOpt(1);
    await test.confirmValueSelect();
    assert.equal(state.viewMode, "optionInput");
    test.handleInputKey("3");
    test.handleInputKey("0");
    await test.confirmInput();
    assert.equal(requests.some((r) => r.op === "setOption" && r.value === "30"), true);
    state.viewMode = "detail";
    await test.enterWorktreeSelect();
    assert.equal(state.wtList.length, 1);
    await test.confirmWorktreeAdd();
    assert.equal(requests.some((r) => r.op === "worktreeAdd"), true);
    state.entries = [sampleEntry({ id: "app@wt", entryId: "app", worktree: { label: "wt" } })];
    state.viewMode = "detail";
    state.detailEntryId = "app@wt";
	    await test.removeWorktreeInstance();
	    assert.equal(requests.some((r) => r.op === "worktreeRemove"), true);

	    state.viewMode = "main";
	    state.entries = [sampleEntry({ id: "app" })];
	    state.tasks = [sampleEntry({ id: "login", type: "task" })];
	    state.cursor = 1;
	    await test.actionMainEnter();
	    assert.equal(requests.some((r) => r.op === "start" && r.id === "login"), true);
	    assert.equal(state.viewMode, "main");
	  });

  it("handles key routing, validation, flashes, timers, and quit", async () => {
    const state = stateModule();
    const requests = [];
    const timers = captureTimers();
    const test = loadController({
      requestImpl: async (msg) => {
        requests.push(msg);
        if (msg.op === "list") return { ok: true, entries: state.entries };
        return { ok: false, error: "nope" };
      },
    });
    Object.assign(state, {
      entries: [sampleEntry({ id: "app", options: { port: { values: ["3000"] } } })],
      viewMode: "main",
    });
    test.setFlash("ok", "saved");
    assert.deepEqual(state.flash, { tone: "ok", text: "saved" });
    assert.equal(timers.at(-1).ms, 2500);
    timers.at(-1).fn();
    assert.equal(state.flash, null);
    test.scheduleRefresh();
    assert.equal(timers.at(-1).ms, 1000);
    test.handleKey(Buffer.from("\x1b[<64;1;1M"));
    assert.equal(state.hudScrollOffset, 0);
    test.handleKey(Buffer.from("\x1b[<65;1;1M"));
    assert.equal(state.hudScrollOffset, 3);
    test.handleKey(Buffer.from("\r"));
    assert.equal(state.viewMode, "detail");
    test.handleDetailKey("o");
    assert.equal(state.viewMode, "optionSelect");
    await test.confirmValueSelect();
    assert.equal(requests.some((r) => r.op === "setOption"), true);
    state.viewMode = "optionInput";
    state.inputBuffer = "";
    await test.confirmInput();
    assert.equal(state.inputError, "value cannot be empty");
    state.inputBuffer = "abc";
    await test.confirmInput();
    assert.equal(state.inputError, "must be a number");
    test.handleInputKey("\b");
    assert.equal(state.inputBuffer, "ab");
    state.viewMode = "log";
    state.logLines = ["a", "b", "c"];
    test.handleLogKey("c");
    assert.equal(state.logClearConfirm, true);
    test.handleLogKey("x");
    assert.equal(state.logClearConfirm, false);
    test.handleLogKey("\x1b[A");
    assert.equal(state.logScroll, 1);
    test.handleLogKey("r");
    assert.equal(state.logScroll, 0);
    captureStdout();
    captureExit();
    process.stdin.setRawMode = () => {};
    process.stdin.pause = () => {};
    assert.throws(() => test.handleKey(Buffer.from("\x03")), /exit 0/);
    assert.equal(state.exiting, true);
  });

  it("covers controller guard and error branches", async () => {
    captureStdout();
    const state = stateModule();
    const requests = [];
    let mode = "ok";
    const timers = captureTimers();
    const test = loadController({
      requestImpl: async (msg) => {
        requests.push(msg);
        if (msg.op === "list") return { ok: true, entries: state.entries };
        if (msg.op === "worktreeDiscover") {
          if (mode === "discover-bad") return { ok: false, error: "discover failed" };
          if (mode === "discover-throw") throw new Error("discover exploded");
          return { ok: true, worktrees: [{ label: "wt", subCwd: "/repo-wt", exists: true }] };
        }
        if (msg.op === "worktreeAdd") {
          if (mode === "add-bad") return { ok: false, error: "add failed" };
          return { ok: true, instanceId: "app@wt", port: null };
        }
        if (msg.op === "start") return { ok: false, error: "start failed" };
        if (msg.op === "worktreeRemove") return { ok: false, error: "remove failed" };
        if (msg.op === "setOption") return { ok: false, error: "set failed" };
        return { ok: true };
      },
      configImpl: () => {
        throw new Error("bad config");
      },
    });

    assert.equal(test.commandIndex().size, 0);
    test.loadDetailLogPreview();
    assert.deepEqual(state.detailLogPreview, []);
    test.loadLogLines();
    assert.deepEqual(state.logLines, []);
    test.moveCursor(1);
    await test.actionStart();
    await test.actionStop();
    await test.actionRestart();
    await test.actionMainEnter();
    test.runDetailSelected();
    test.enterLogView();
    test.clearLog();

    state.logEntryId = "missing-log";
    test.loadLogLines();
    assert.match(state.logError, /log file not created/);
    test.clearLog();
    assert.ok(state.logError);

    state.entries = [sampleEntry({ id: "app" })];
    state.cursor = 0;
    state.viewMode = "main";
    test.enterOptionFlow();
    state.entries[0].options = {};
    test.enterOptionFlow();
    state.entries[0].options = { host: { values: ["local"] }, port: { values: ["3000"] } };
    test.enterOptionFlow();
    assert.equal(state.viewMode, "optionKeySelect");
    test.handleOptionKeyListKey("\x1b[A");
    test.handleOptionKeyListKey("\x1b[B");
    test.handleOptionKeyListKey("\r");
    assert.equal(state.viewMode, "optionSelect");
    state.optKeys = ["host", "port"];
    test.backFromValueSelect();
    assert.equal(state.viewMode, "optionKeySelect");
    test.handleOptionKeyListKey("\x1b");
    assert.equal(state.viewMode, "main");

    state.viewMode = "main";
    state.entries[0].worktree = { label: "wt" };
    await test.enterWorktreeSelect();
    state.entries[0].worktree = null;
    mode = "discover-bad";
    await test.enterWorktreeSelect();
    assert.equal(state.wtError, "discover failed");
    mode = "discover-throw";
    await test.enterWorktreeSelect();
    assert.equal(state.wtError, "discover exploded");
    test.moveWt(1);
    await test.confirmWorktreeAdd();
    mode = "add-bad";
    state.wtList = [{ label: "wt", subCwd: "/repo-wt" }];
    state.wtIndex = 0;
    await test.confirmWorktreeAdd();
    assert.match(state.flash.text, /add failed/);
    mode = "ok";
    await test.confirmWorktreeAdd();
    assert.match(state.flash.text, /start failed/);

    state.entries = [sampleEntry({ id: "app" })];
    state.viewMode = "main";
    await test.removeWorktreeInstance();
    assert.match(state.flash.text, /not a worktree/);
    state.entries = [sampleEntry({ id: "app@wt", worktree: { label: "wt" } })];
    await test.removeWorktreeInstance();
    assert.match(state.flash.text, /remove failed/);

    state.viewMode = "detail";
    state.detailEntryId = "app@wt";
    state.entries[0].status = "running";
    test.handleDetailKey("x");
    await test.actionRestart();
    assert.ok(timers.some((timer) => timer.ms === 400));
    test.handleDetailKey("w");
    test.handleDetailKey("d");
    test.handleDetailKey("\x1b[C");

    for (const viewMode of ["log", "optionSelect", "optionKeySelect", "optionInput", "worktreeSelect", "detail"]) {
      state.viewMode = viewMode;
      captureExit();
      assert.throws(() => test.handleKey(Buffer.from("\x03")), /exit 0/);
      restoreProcessExit();
      state.exiting = false;
    }
    state.viewMode = "main";
    captureExit();
    assert.throws(() => test.handleKey(Buffer.from("q")), /exit 0/);
  });
});

export {};
