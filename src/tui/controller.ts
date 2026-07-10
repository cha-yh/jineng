// @ts-nocheck
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const state = require("../core/state");
const { request } = require("../core/ipcClient");
const { loadConfig } = require("../core/config");
const {
  detailEntry,
  isTaskEntry,
  selectedEntry,
  targetEntry,
  totalMenuItems,
} = require("./utils/entries");
const { logPathFor, readPreviewLines, readTailLines } = require("./utils/logs");
const {
  CLEAR,
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  ENTER_ALT_SCREEN,
  HIDE_CURSOR,
  LEAVE_ALT_SCREEN,
  SHOW_CURSOR,
} = require("./utils/terminal");

const { detailActions } = require("./views/actions");
const { render } = require("./views/renderer");

const REFRESH_MS = 1000;
const FLASH_MS = 2500;
const LOG_MAX_LINES = 2000;
const LOG_MAX_BYTES = 256 * 1024;

let refreshTimer = null;
let flashTimer = null;

async function refresh() {
  try {
    const reply = await request({ op: "list" });
    if (reply.ok) {
      const cmdByid = commandIndex();
      state.entries = reply.entries.map((e) => ({
        ...e,
        command: e.command || cmdByid.get(e.entryId || e.id),
      }));
      state.tasks = (reply.tasks || []).map((e) => ({
        ...e,
        command: e.command || cmdByid.get(e.id),
      }));
      state.error = null;
      if (state.cursor >= totalMenuItems(state)) state.cursor = Math.max(0, totalMenuItems(state) - 1);
      // fall back to main when the detail entry disappears
      if (state.viewMode === "detail" && !detailEntry(state)) {
        state.viewMode = "main";
        state.detailEntryId = null;
        state.detailCursor = 0;
      }
      if (state.viewMode === "statusResult" && !detailEntry(state)) {
        exitStatusResultView();
      }
      // detail action list length may change — clamp the cursor
      const de = detailEntry(state);
      if (de) {
        const acts = detailActions(de);
        if (state.detailCursor >= acts.length) state.detailCursor = Math.max(0, acts.length - 1);
        if (state.detailCursor < 0) state.detailCursor = 0;
      }
    } else {
      state.error = reply.error;
    }
  } catch (e) {
    state.error = e.message;
  } finally {
    state.loading = false;
    state.lastRefresh = new Date();
    if (state.viewMode === "log") loadLogLines();
    if (state.viewMode === "detail") loadDetailLogPreview();
    render();
  }
}

// Read the last N non-empty lines of the entry log for the detail view's inline preview.
const DETAIL_LOG_TAIL = 3;
function loadDetailLogPreview() {
  const id = state.detailEntryId;
  if (!id) {
    state.detailLogPreview = [];
    return;
  }
  const file = logPathFor(id);
  try {
    state.detailLogPreview = readPreviewLines(file, 4096, DETAIL_LOG_TAIL);
  } catch {
    state.detailLogPreview = [];
  }
}

function loadLogLines() {
  const id = state.logEntryId;
  if (!id) return;
  const file = logPathFor(id);
  try {
    state.logLines = readTailLines(file, LOG_MAX_BYTES, LOG_MAX_LINES);
    if (state.logLines.length > 0 && state.logLines[state.logLines.length - 1] === "") {
      state.logLines.pop();
    }
    state.logError = null;
  } catch (e) {
    state.logLines = [];
    state.logError =
      e.code === "ENOENT" ? "log file not created yet — run the command first" : e.message;
  }
}

function commandIndex() {
  const m = new Map();
  try {
    const cfg = loadConfig();
    for (const e of cfg.entries) m.set(e.id, e.command);
    for (const t of cfg.tasks || []) m.set(t.id, t.command);
  } catch {}
  return m;
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (state.exiting) return;
    await refresh();
    scheduleRefresh();
  }, REFRESH_MS);
}

function setFlash(tone, text) {
  state.flash = { tone, text };
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    state.flash = null;
    render();
  }, FLASH_MS);
}

async function send(op, id) {
  const reply = await request({ op, id });
  if (reply.ok) setFlash("ok", `${op} ${id}: ok${reply.pid ? ` (pid ${reply.pid})` : ""}`);
  else setFlash("err", `${op} ${id}: ${reply.error}`);
  await refresh();
}

async function actionStart() {
  const e = targetEntry(state);
  if (!e) return;
  await send("start", e.id);
}
async function actionStop() {
  const e = targetEntry(state);
  if (!e) return;
  await send("stop", e.id);
}
async function actionRestart() {
  const e = targetEntry(state);
  if (!e) return;
  await send("stop", e.id);
  setTimeout(() => send("start", e.id), 400);
}
// Enter on main view: entry → open detail view
async function actionMainEnter() {
  const e = selectedEntry(state);
  if (!e) return;
  enterDetailView(e);
}

function actionMainOpenDetail() {
  const e = selectedEntry(state);
  if (!e) return;
  enterDetailView(e);
}

function enterDetailView(entry) {
  state.viewMode = "detail";
  state.detailEntryId = entry.id;
  state.detailCursor = 0;
  loadDetailLogPreview();
  render();
}

function exitDetailView() {
  state.viewMode = "main";
  state.detailEntryId = null;
  state.detailCursor = 0;
  state.detailLogPreview = [];
  render();
}

function moveDetailCursor(delta) {
  const e = detailEntry(state);
  if (!e) return;
  const acts = detailActions(e);
  if (acts.length === 0) return;
  state.detailCursor = (state.detailCursor + delta + acts.length) % acts.length;
  render();
}

async function showStatusCommandResult() {
  const e = detailEntry(state);
  if (!e || !isTaskEntry(e)) return;
  state.viewMode = "statusResult";
  state.statusResultEntryId = e.id;
  state.statusResultScroll = 0;
  state.statusResultText = null;
  state.statusResultError = "loading…";
  state.statusResultState = null;
  process.stdout.write(DISABLE_MOUSE);
  render();
  try {
    const reply = await request({ op: "statusCheck", id: e.id });
    if (state.viewMode !== "statusResult" || state.statusResultEntryId !== e.id) return;
    if (reply.ok) {
      const check = reply.check || null;
      state.statusResultText = check?.fullText || check?.text || "";
      state.statusResultState = check?.state || null;
      state.statusResultError = null;
    } else {
      const check = runLocalStatusCommand(e);
      state.statusResultText = check.fullText || check.text || "";
      state.statusResultState = check.state;
      state.statusResultError = check.localFallback ? null : reply.error;
    }
  } catch (err) {
    if (state.viewMode !== "statusResult" || state.statusResultEntryId !== e.id) return;
    const check = runLocalStatusCommand(e);
    state.statusResultText = check.fullText || check.text || "";
    state.statusResultState = check.state;
    state.statusResultError = check.localFallback ? null : err.message;
  }
  render();
}

function runLocalStatusCommand(entry) {
  if (!entry.statusCommand) {
    return { state: null, ok: false, text: "", fullText: "", localFallback: false };
  }
  try {
    const output = childProcess.execSync(entry.statusCommand, {
      cwd: entry.cwd || process.cwd(),
      env: { ...process.env, ...(entry.env || {}) },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: entry.statusTimeoutMs || 3000,
      shell: true,
    });
    const fullText = String(output || "").trim();
    const text = fullText.split(/\r?\n/)[0] || "";
    return { state: "active", ok: true, text, fullText, localFallback: true };
  } catch (err) {
    const fullText = String(err.stderr || "").trim() || err.message || "inactive";
    const text = fullText.split(/\r?\n/)[0] || "";
    return { state: "inactive", ok: false, text, fullText, localFallback: true };
  }
}

function exitStatusResultView() {
  state.viewMode = state.detailEntryId ? "detail" : "main";
  state.statusResultEntryId = null;
  state.statusResultScroll = 0;
  state.statusResultText = null;
  state.statusResultError = null;
  state.statusResultState = null;
  process.stdout.write(ENABLE_MOUSE);
  render();
}

function statusResultLines() {
  const e = detailEntry(state);
  if (!e) return [];
  const fullText = state.statusResultText ?? e.statusCheck?.fullText ?? e.statusCheck?.text ?? "";
  const lines = String(fullText).split(/\r?\n/);
  return lines.length === 1 && lines[0] === "" ? [] : lines;
}

function scrollStatusResult(delta) {
  const max = Math.max(0, statusResultLines().length - 1);
  state.statusResultScroll = Math.max(0, Math.min(max, state.statusResultScroll + delta));
  render();
}

const DETAIL_HANDLERS = {
  s: () => actionStart(),
  x: () => actionStop(),
  R: () => actionRestart(),
  o: () => enterOptionFlow(),
  w: () => enterWorktreeSelect(),
  d: () => removeWorktreeInstance(),
  c: () => showStatusCommandResult(),
};

function runDetailSelected() {
  const e = detailEntry(state);
  if (!e) return;
  const acts = detailActions(e);
  const sel = acts[state.detailCursor];
  if (!sel) return;
  const h = DETAIL_HANDLERS[sel.key];
  if (h) return h();
}

function moveCursor(delta) {
  const total = totalMenuItems(state);
  if (total === 0) return;
  state.cursor = (state.cursor + delta + total) % total;
  render();
}

function enterLogView() {
  const e = targetEntry(state);
  if (!e) return;
  state.viewMode = "log";
  state.logEntryId = e.id;
  state.logScroll = 0;
  state.dragStart = null;
  state.logClearConfirm = false;
  // Release mouse tracking so the user can drag-select and copy text like in a normal terminal.
  // DISABLE_MOUSE also re-enables alt-scroll (1007h) so the wheel sends arrow keys, which our
  // handleLogKey already maps to scrollLog().
  process.stdout.write(DISABLE_MOUSE);
  loadLogLines();
  render();
}

function exitLogView() {
  state.viewMode = state.detailEntryId ? "detail" : "main";
  state.logEntryId = null;
  state.logLines = [];
  state.logScroll = 0;
  state.logError = null;
  state.dragStart = null;
  state.logClearConfirm = false;
  // Re-enable mouse tracking for HUD wheel scroll and main-view interactions.
  process.stdout.write(ENABLE_MOUSE);
  render();
}

function scrollLog(delta) {
  const max = Math.max(0, state.logLines.length - 1);
  state.logScroll = Math.max(0, Math.min(max, state.logScroll + delta));
  render();
}

function clearLog() {
  const id = state.logEntryId;
  if (!id) return;
  const file = logPathFor(id);
  // The daemon spawned the child with fs.openSync(file, "a") → O_APPEND, so the child's
  // write offset jumps to the end of the file on every write. Truncating to 0 here is
  // safe even while the dev server keeps writing.
  try {
    fs.truncateSync(file, 0);
    state.logError = null;
  } catch (e) {
    state.logError = e.message;
  }
  state.logLines = [];
  state.logScroll = 0;
  render();
}

function enterOptionFlow() {
  const e = targetEntry(state);
  if (!e || !e.options) return;
  const keys = Object.keys(e.options);
  if (keys.length === 0) return;
  state.optEntryId = e.id;
  if (keys.length === 1) {
    state.optKeys = keys;
    enterValueSelect(e, keys[0]);
  } else {
    state.viewMode = "optionKeySelect";
    state.optKeys = keys;
    state.optKeyIndex = 0;
    render();
  }
}

function enterValueSelect(entry, key) {
  const spec = entry.options[key];
  const baseValues = [...(spec.values || [])];
  if (spec.allowCustom) baseValues.push("__CUSTOM__");
  state.viewMode = "optionSelect";
  state.optKey = key;
  state.optValues = baseValues;
  const current = entry.optionValues?.[key];
  const idx = baseValues.indexOf(current);
  state.optIndex = idx >= 0 ? idx : 0;
  render();
}

function enterInputMode(entry, key) {
  state.viewMode = "optionInput";
  state.optKey = key;
  state.inputBuffer = String(entry.optionValues?.[key] ?? "");
  state.inputError = null;
  render();
}

function exitOptionFlow() {
  state.viewMode = state.detailEntryId ? "detail" : "main";
  state.optEntryId = null;
  state.optKey = null;
  state.optValues = [];
  state.optIndex = 0;
  state.optKeys = [];
  state.optKeyIndex = 0;
  state.inputBuffer = "";
  state.inputError = null;
  render();
}

function backFromValueSelect() {
  if (state.optKeys.length > 1) {
    state.viewMode = "optionKeySelect";
    state.optKey = null;
    state.optValues = [];
    state.optIndex = 0;
    render();
  } else {
    exitOptionFlow();
  }
}

function moveOpt(delta) {
  if (state.optValues.length === 0) return;
  state.optIndex =
    (state.optIndex + delta + state.optValues.length) % state.optValues.length;
  render();
}

function moveOptKey(delta) {
  if (state.optKeys.length === 0) return;
  state.optKeyIndex =
    (state.optKeyIndex + delta + state.optKeys.length) % state.optKeys.length;
  render();
}

async function commitOptionValue(value) {
  const id = state.optEntryId;
  const key = state.optKey;
  const entry = state.entries.find((e) => e.id === id);
  const wasRunning = entry && (entry.status === "running" || entry.status === "paused");
  const reply = await request({ op: "setOption", id, key, value });
  if (reply.ok) {
    const note = wasRunning ? " · restart to apply" : "";
    setFlash("ok", `${id} ${key}=${value} saved${note}`);
    await refresh();
    backFromValueSelect();
  } else {
    setFlash("err", reply.error);
    render();
  }
}

async function confirmValueSelect() {
  const value = state.optValues[state.optIndex];
  if (value === "__CUSTOM__") {
    const entry = state.entries.find((e) => e.id === state.optEntryId);
    enterInputMode(entry, state.optKey);
    return;
  }
  await commitOptionValue(value);
}

async function confirmInput() {
  const val = state.inputBuffer.trim();
  if (!val) {
    state.inputError = "value cannot be empty";
    render();
    return;
  }
  if (!/^\d+$/.test(val)) {
    state.inputError = "must be a number";
    render();
    return;
  }
  await commitOptionValue(val);
}

function handleOptionKey(key) {
  if (key === "\x1b" || key === "\x1b[D") return backFromValueSelect();
  if (key === "\x1b[A" || key === "k") return moveOpt(-1);
  if (key === "\x1b[B" || key === "j") return moveOpt(1);
  if (key === "\r" || key === "\n") return void confirmValueSelect();
}

function handleOptionKeyListKey(key) {
  if (key === "\x1b" || key === "\x1b[D") return exitOptionFlow();
  if (key === "\x1b[A" || key === "k") return moveOptKey(-1);
  if (key === "\x1b[B" || key === "j") return moveOptKey(1);
  if (key === "\r" || key === "\n") {
    const entry = state.entries.find((e) => e.id === state.optEntryId);
    if (entry) enterValueSelect(entry, state.optKeys[state.optKeyIndex]);
  }
}

function handleInputKey(key) {
  if (key === "\x1b" || key === "\x1b[D") {
    const entry = state.entries.find((e) => e.id === state.optEntryId);
    if (entry) enterValueSelect(entry, state.optKey);
    return;
  }
  if (key === "\r" || key === "\n") return void confirmInput();
  if (key === "\x7f" || key === "\b") {
    state.inputBuffer = state.inputBuffer.slice(0, -1);
    state.inputError = null;
    render();
    return;
  }
  if (/^[0-9]$/.test(key)) {
    state.inputBuffer += key;
    state.inputError = null;
    render();
  }
}

async function enterWorktreeSelect() {
  const e = targetEntry(state);
  if (!e || e.worktree) return;
  state.viewMode = "worktreeSelect";
  state.wtEntryId = e.id;
  state.wtList = [];
  state.wtIndex = 0;
  state.wtError = "loading…";
  render();
  try {
    const reply = await request({ op: "worktreeDiscover", id: e.id });
    if (!reply.ok) {
      state.wtError = reply.error;
      render();
      return;
    }
    const addedCwds = new Set(
      state.entries
        .filter((en) => en.worktree && en.entryId === e.id)
        .map((en) => path.resolve(en.cwd || "")),
    );
    state.wtList = reply.worktrees.filter(
      (w) => !w.isPrimary && !addedCwds.has(path.resolve(w.subCwd)),
    );
    state.wtError = null;
    state.wtIndex = 0;
    render();
  } catch (err) {
    state.wtError = err.message;
    render();
  }
}

function exitWorktreeSelect() {
  state.viewMode = state.detailEntryId ? "detail" : "main";
  state.wtEntryId = null;
  state.wtList = [];
  state.wtIndex = 0;
  state.wtError = null;
  render();
}

function moveWt(delta) {
  if (state.wtList.length === 0) return;
  state.wtIndex = (state.wtIndex + delta + state.wtList.length) % state.wtList.length;
  render();
}

async function confirmWorktreeAdd() {
  if (state.wtList.length === 0) return;
  const wt = state.wtList[state.wtIndex];
  const entryId = state.wtEntryId;
  const reply = await request({
    op: "worktreeAdd",
    id: entryId,
    cwd: wt.subCwd,
    label: wt.label,
  });
  if (!reply.ok) {
    setFlash("err", `worktree add: ${reply.error}`);
    return;
  }
  setFlash("ok", `${reply.instanceId} added (port=${reply.port}) — starting…`);
  exitWorktreeSelect();
  await refresh();
  const startReply = await request({ op: "start", id: reply.instanceId });
  if (startReply.ok) {
    const note = startReply.status === "installing" ? " (installing deps first)" : "";
    setFlash("ok", `${reply.instanceId} start${note}`);
  } else {
    setFlash("err", `start ${reply.instanceId}: ${startReply.error}`);
  }
  await refresh();
}

function handleWorktreeKey(key) {
  if (key === "\x1b" || key === "\x1b[D") return exitWorktreeSelect();
  if (key === "\x1b[A" || key === "k") return moveWt(-1);
  if (key === "\x1b[B" || key === "j") return moveWt(1);
  if (key === "\r" || key === "\n") return void confirmWorktreeAdd();
}

async function removeWorktreeInstance() {
  const e = targetEntry(state);
  if (!e || !e.worktree) {
    setFlash("err", "not a worktree instance");
    return;
  }
  const reply = await request({ op: "worktreeRemove", id: e.id });
  if (reply.ok) {
    setFlash("ok", `${e.id} removed`);
    if (state.viewMode === "detail" && state.detailEntryId === e.id) {
      exitDetailView();
    }
  } else {
    setFlash("err", `remove ${e.id}: ${reply.error}`);
  }
  await refresh();
}

function handleLogKey(key) {
  // Two-step clear: pressing `c` arms the confirmation; Enter confirms, any other key cancels.
  if (state.logClearConfirm) {
    if (key === "\r" || key === "\n") {
      state.logClearConfirm = false;
      clearLog();
      return;
    }
    state.logClearConfirm = false;
    render();
    return;
  }
  if (key === "q" || key === "\x1b" || key === "\x1b[D") return exitLogView();
  if (key === "\x1b[A" || key === "k") return scrollLog(1);
  if (key === "\x1b[B" || key === "j") return scrollLog(-1);
  if (key === "\x1b[5~") return scrollLog(20);
  if (key === "\x1b[6~") return scrollLog(-20);
  if (key === "c") {
    state.logClearConfirm = true;
    render();
    return;
  }
  if (key === "r") {
    state.logScroll = 0;
    render();
  }
}

function handleStatusResultKey(key) {
  if (key === "q" || key === "\x1b" || key === "\x1b[D") return exitStatusResultView();
  if (key === "\x1b[A" || key === "k") return scrollStatusResult(1);
  if (key === "\x1b[B" || key === "j") return scrollStatusResult(-1);
  if (key === "\x1b[5~") return scrollStatusResult(20);
  if (key === "\x1b[6~") return scrollStatusResult(-20);
  if (key === "r") {
    state.statusResultScroll = 0;
    render();
  }
}

function handleDetailKey(key) {
  if (key === "q" || key === "\x1b" || key === "\x1b[D") return exitDetailView();
  if (key === "\x1b[A" || key === "k") return moveDetailCursor(-1);
  if (key === "\x1b[B" || key === "j") return moveDetailCursor(1);
  if (key === "\r" || key === "\n") return runDetailSelected();
  // → opens the log view
  if (key === "\x1b[C") return enterLogView();
  // direct shortcut keys
  if (key === "s") return void actionStart();
  if (key === "x") return void actionStop();
  if (key === "R") return void actionRestart();
  if (key === "o") return enterOptionFlow();
  if (key === "w") return void enterWorktreeSelect();
  if (key === "d") return void removeWorktreeInstance();
  if (key === "c") return showStatusCommandResult();
}

function handleKey(chunk) {
  const key = chunk.toString();
  // Mouse events arrive only when tracking is enabled (i.e. not in log view).
  // Log view turns mouse tracking off so the user can drag-select text.
  const mouseMatch = key.match(/^\x1b\[<(\d+);\d+;\d+[Mm]/);
  if (mouseMatch) {
    const button = parseInt(mouseMatch[1], 10);
    if (button === 64) {
      state.hudScrollOffset = Math.max(0, state.hudScrollOffset - 3);
      render();
    } else if (button === 65) {
      state.hudScrollOffset += 3;
      render();
    }
    return;
  }
  if (state.viewMode === "log") {
    if (key === "\x03") return quit();
    return handleLogKey(key);
  }
  if (state.viewMode === "statusResult") {
    if (key === "\x03") return quit();
    return handleStatusResultKey(key);
  }
  if (state.viewMode === "optionSelect") {
    if (key === "\x03") return quit();
    return handleOptionKey(key);
  }
  if (state.viewMode === "optionKeySelect") {
    if (key === "\x03") return quit();
    return handleOptionKeyListKey(key);
  }
  if (state.viewMode === "optionInput") {
    if (key === "\x03") return quit();
    return handleInputKey(key);
  }
  if (state.viewMode === "worktreeSelect") {
    if (key === "\x03") return quit();
    return handleWorktreeKey(key);
  }
  if (state.viewMode === "detail") {
    if (key === "\x03") return quit();
    return handleDetailKey(key);
  }
  // main view
  if (key === "\x03" || key === "q") return quit();
  if (key === "\x1b[A" || key === "k") return moveCursor(-1);
  if (key === "\x1b[B" || key === "j") return moveCursor(1);
  if (key === "\r" || key === "\n") return void actionMainEnter();
  if (key === "\x1b[C") return actionMainOpenDetail();
}

function quit() {
  state.exiting = true;
  if (refreshTimer) clearTimeout(refreshTimer);
  if (flashTimer) clearTimeout(flashTimer);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write(DISABLE_MOUSE + SHOW_CURSOR + LEAVE_ALT_SCREEN);
  process.exit(0);
}

async function start() {
  process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR + ENABLE_MOUSE + CLEAR);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", handleKey);
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.stdout.on("resize", render);

  await refresh();
  scheduleRefresh();
}

module.exports = {
  start,
  _test: {
    actionMainEnter,
    actionMainOpenDetail,
    actionRestart,
    actionStart,
    actionStop,
    backFromValueSelect,
    clearLog,
    commandIndex,
    commitOptionValue,
    confirmInput,
    confirmValueSelect,
    confirmWorktreeAdd,
    enterDetailView,
    enterInputMode,
    enterLogView,
    enterOptionFlow,
    enterValueSelect,
    enterWorktreeSelect,
    exitDetailView,
    exitLogView,
    exitOptionFlow,
    exitStatusResultView,
    exitWorktreeSelect,
    handleDetailKey,
    handleInputKey,
    handleKey,
    handleLogKey,
    handleOptionKey,
    handleOptionKeyListKey,
    handleStatusResultKey,
    handleWorktreeKey,
    loadDetailLogPreview,
    loadLogLines,
    moveCursor,
    moveDetailCursor,
    moveOpt,
    moveOptKey,
    moveWt,
    refresh,
    removeWorktreeInstance,
    runDetailSelected,
    scheduleRefresh,
    scrollLog,
    scrollStatusResult,
    setFlash,
    showStatusCommandResult,
    statusResultLines,
  },
};

export {};
