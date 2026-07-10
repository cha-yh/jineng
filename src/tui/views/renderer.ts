// @ts-nocheck
const chalk = require("chalk");
const { pad, truncate, visualWidth } = require("../utils/text");
const { CURSOR_HOME, ERASE_TO_EOL, ERASE_BELOW } = require("../utils/terminal");
const { fmtClock, fmtUptime } = require("../utils/time");
const { logPathFor, stripCtrl } = require("../utils/logs");
const {
  compactBranch,
  detailEntry,
  displayId,
  formatPortsForEntry,
  isTaskEntry,
  visibleEntries,
} = require("../utils/entries");
const state = require("../../core/state");
const { detailActions } = require("./actions");

const SEP = chalk.gray("─".repeat(78));

const STATUS_LABEL = {
  running: chalk.green("● running"),
  stopped: chalk.gray("○ stopped"),
  paused: chalk.yellow("⏸ paused "),
  crashed: chalk.red("✗ crashed"),
  installing: chalk.cyan("⇣ install"),
};

function padMin(s, width, minGap = 2) {
  const v = visualWidth(s);
  return v >= width ? s + " ".repeat(minGap) : s + " ".repeat(width - v);
}

function statusCell(s) {
  return STATUS_LABEL[s] || chalk.gray(s || "?");
}

function compactStatusDot(s) {
  switch (s) {
    case "running": return chalk.green("●");
    case "stopped": return chalk.white("○");
    case "paused": return chalk.yellow("●");
    case "crashed": return chalk.red("●");
    case "installing": return chalk.cyan("●");
    default: return chalk.dim("○");
  }
}

function statusCheckCell(check) {
  if (!check) return chalk.dim("—");
  if (check.state === "active") return chalk.green("● active");
  if (check.state === "inactive") return chalk.red("○ inactive");
  return chalk.dim("? unknown");
}

function statusCheckDot(check) {
  if (!check) return chalk.dim("○");
  if (check.state === "active") return chalk.green("●");
  if (check.state === "inactive") return chalk.red("○");
  return chalk.dim("○");
}

// Convert entries[] into a line array with cursor highlight applied.
// Returns: { lines, ranges } — ranges[i] = { entryIndex, startLine, endLine } describes the line range for the i-th visible entry.
function buildEntryLines(visibleEntries) {
  const lines = [];
  const ranges = [];
  const servers = visibleEntries.filter((r) => !isTaskEntry(r));
  const tasks = visibleEntries.filter((r) => isTaskEntry(r));
  const ordered = [...servers, ...tasks];
  const indexByEntry = new Map(ordered.map((entry, index) => [entry, index]));
  if (servers.length > 0) {
    const sectionStart = lines.length;
    lines.push(chalk.dim("  ENTRIES"));
    servers.forEach((r, serverIndex) => {
      const i = indexByEntry.get(r);
      const isCursor = state.viewMode === "main" && i === state.cursor;
      const arrow = isCursor ? chalk.yellow("▸") : " ";
      const dot = compactStatusDot(r.status);
      const idText = truncate(displayId(r), 27);
      const id = isCursor ? chalk.yellow.bold(idText) : chalk.white(idText);
      const idPadded = pad(id, 28);
      const bText = compactBranch(r.branch);
      const branch = bText ? chalk.cyan(bText) : chalk.dim("—");
      const portText = formatPortsForEntry(r);
      const port = padMin(portText ? chalk.magenta(portText) : chalk.dim("—"), 8);
      const start = lines.length;
      lines.push(` ${arrow} ${dot}  ${idPadded}${port}${branch}`);
      ranges[i] = { entryIndex: i, startLine: serverIndex === 0 ? sectionStart : start, endLine: lines.length - 1 };
    });
  }
  if (tasks.length > 0) {
    if (lines.length > 0) lines.push("");
    const sectionStart = lines.length;
    lines.push(chalk.dim("  TASKS"));
    tasks.forEach((r, taskIndex) => {
      const i = indexByEntry.get(r);
      const isCursor = state.viewMode === "main" && i === state.cursor;
      const arrow = isCursor ? chalk.yellow("▸") : " ";
      const idText = truncate(displayId(r), 27);
      const id = isCursor ? chalk.yellow.bold(idText) : chalk.white(idText);
      const idPadded = pad(id, 28);
      const dot = statusCheckDot(r.statusCheck);
      const start = lines.length;
      lines.push(` ${arrow} ${dot}  ${idPadded}`);
      ranges[i] = { entryIndex: i, startLine: taskIndex === 0 ? sectionStart : start, endLine: lines.length - 1 };
    });
  }
  return { lines, ranges };
}

function drawHudTop() {
  const top = [];
  top.push("");
  return top;
}

function drawBottom() {
  const lines = [];
  lines.push(SEP);
  const parts = [];
  if (state.lastRefresh) parts.push(chalk.dim(`last refresh: ${fmtClock(state.lastRefresh)}`));
  if (state.flash) {
    parts.push(state.flash.tone === "ok" ? chalk.green(state.flash.text) : chalk.red(state.flash.text));
  }
  if (parts.length > 0) lines.push("  " + parts.join("  ·  "));
  lines.push(chalk.dim("  ↑↓: move  Enter/→: detail  q: quit"));
  return lines;
}

function drawErrorOrLoading() {
  if (state.error) return [chalk.red(`  ❌ ${state.error}`)];
  if (state.loading && state.entries.length === 0) return ["  " + chalk.dim("Loading…")];
  return null;
}

function ensureCursorVisible(ranges, entriesArea) {
  // Only meaningful when the cursor sits inside the entry range.
  const vis = visibleEntries(state);
  if (state.cursor >= vis.length) return; // settings area is fixed — no scrolling needed
  const r = ranges[state.cursor];
  if (!r) return;
  if (r.startLine < state.hudScrollOffset) {
    state.hudScrollOffset = r.startLine;
  } else if (r.endLine >= state.hudScrollOffset + entriesArea) {
    state.hudScrollOffset = r.endLine - entriesArea + 1;
  }
}

function layoutMain(rows) {
  const top = drawHudTop();
  const errOrLoading = drawErrorOrLoading();
  const bottom = drawBottom();

  if (errOrLoading) {
    return [...top, ...errOrLoading, ...bottom];
  }

  const vis = visibleEntries(state);
  const { lines, ranges } = buildEntryLines(vis);
  const fixed = top.length + bottom.length;
  const entriesArea = Math.max(1, rows - fixed);
  const total = lines.length;

  let entriesPart;
  if (total <= entriesArea) {
    state.hudScrollOffset = 0;
    entriesPart = lines;
  } else {
    ensureCursorVisible(ranges, entriesArea);
    const maxOffset = total - entriesArea;
    if (state.hudScrollOffset > maxOffset) state.hudScrollOffset = maxOffset;
    if (state.hudScrollOffset < 0) state.hudScrollOffset = 0;
    const offset = state.hudScrollOffset;
    const sliced = lines.slice(offset, offset + entriesArea);
    entriesPart = [...sliced];
    if (offset > 0) entriesPart[0] = chalk.dim(`  ↑ ${offset} more above (wheel to scroll)`);
    if (offset + entriesArea < total) {
      const remaining = total - offset - entriesArea;
      entriesPart[entriesPart.length - 1] = chalk.dim(`  ↓ ${remaining} more below (wheel to scroll)`);
    }
  }
  return [...top, ...entriesPart, ...bottom];
}

function layoutWithSubFlow(subFlowLines, rows) {
  // In sub-flow (option/worktree/input): HUD entries render without cursor highlight,
  // and the bottom area is replaced by sub-flow lines. Top and sub-flow never get clipped.
  const top = drawHudTop();
  const errOrLoading = drawErrorOrLoading();
  const bottom = drawBottom();
  if (errOrLoading) {
    return [...top, ...errOrLoading, ...subFlowLines, ...bottom];
  }

  const vis = visibleEntries(state);
  const { lines } = buildEntryLines(vis); // viewMode !== "main" → no cursor highlight
  const fixed = top.length + subFlowLines.length + bottom.length;
  const entriesArea = Math.max(1, rows - fixed);
  const total = lines.length;

  let entriesPart;
  if (total <= entriesArea) {
    entriesPart = lines;
  } else {
    const maxOffset = total - entriesArea;
    if (state.hudScrollOffset > maxOffset) state.hudScrollOffset = maxOffset;
    if (state.hudScrollOffset < 0) state.hudScrollOffset = 0;
    const offset = state.hudScrollOffset;
    const sliced = lines.slice(offset, offset + entriesArea);
    entriesPart = [...sliced];
    if (offset > 0) entriesPart[0] = chalk.dim(`  ↑ ${offset} more above`);
    if (offset + entriesArea < total) {
      const remaining = total - offset - entriesArea;
      entriesPart[entriesPart.length - 1] = chalk.dim(`  ↓ ${remaining} more below`);
    }
  }
  return [...top, ...entriesPart, ...subFlowLines, ...bottom];
}

function detailEntryFromState() {
  return detailEntry(state);
}

function entryTitle(e, fallbackId = "?") {
  const section = isTaskEntry(e) ? "TASKS" : "ENTRIES";
  const name = e ? displayId(e) : fallbackId;
  return chalk.dim(section) + chalk.dim(" / ") + chalk.yellow.bold(name || "?");
}

function drawDetailHeader(e) {
  const lines = [];
  lines.push("");
  lines.push(entryTitle(e));
  lines.push(SEP);

  // Compact two-line summary for servers. Tasks use statusCommand as their status.
  const LABEL = (s) => chalk.dim(s);
  const COL1 = 28;
  const COL2 = 14;
  const id = chalk.white(displayId(e));

  if (isTaskEntry(e)) {
    lines.push(`  ${LABEL(pad("STATUS", 8))}${statusCheckCell(e.statusCheck)}`);
    lines.push(`  ${LABEL(pad("ID", 8))}${id}`);
  } else {
    const status = statusCell(e.status);
    const pid = e.pid != null ? chalk.white(String(e.pid)) : chalk.dim("—");
    const uptimeStr =
      e.status === "running" || e.status === "paused" || e.status === "installing"
        ? fmtUptime(Date.now() - e.startedAt)
        : null;
    const uptime = uptimeStr ? chalk.white(uptimeStr) : chalk.dim("—");
    const portText = formatPortsForEntry(e);
    const port = portText ? chalk.magenta(portText) : chalk.dim("—");

    lines.push(
      `  ${LABEL(pad("STATUS", 8))}${pad(status, COL1)}${LABEL(pad("PID", 6))}${pad(pid, COL2)}${LABEL("UPTIME  ")}${uptime}`,
    );
    lines.push(`  ${LABEL(pad("ID", 8))}${pad(id, COL1)}${LABEL(pad("PORT", 6))}${port}`);
  }

  // Remaining fields stay one per line — they can be long.
  const rest = [];
  if (!isTaskEntry(e)) rest.push(["BRANCH", e.branch ? chalk.cyan(e.branch) : chalk.dim("—")]);
  rest.push(["CWD", e.cwd ? chalk.dim(e.cwd) : chalk.dim("—")]);
  if (e.worktree) rest.push(["WORKTREE", chalk.cyan(e.worktree.label)]);
  rest.push(["COMMAND", e.command ? chalk.white(e.command) : chalk.dim("—")]);
  if (e.statusCommand) rest.push(["STATUS CMD", chalk.white(e.statusCommand)]);
  if (e.shell) rest.push(["SHELL", chalk.dim(e.shell)]);
  if (e.options && Object.keys(e.options).length > 0) {
    const optParts = Object.keys(e.options).map((k) => {
      const val = e.optionValues?.[k];
      return chalk.magenta(`${k}=${val ?? "?"}`);
    });
    rest.push(["OPTIONS", optParts.join("  ")]);
  }
  if (e.env && Object.keys(e.env).length > 0) {
    const envParts = Object.entries(e.env).map(([k, v]) => chalk.green(`${k}=${v}`));
    rest.push(["ENV", envParts.join("  ")]);
  }
  if (e.signal) rest.push(["SIGNAL", chalk.red(e.signal)]);

  for (const [label, value] of rest) {
    lines.push(`  ${LABEL(pad(label + ":", 10))}${value}`);
  }
  lines.push(SEP);
  return lines;
}

function drawLogPreview() {
  const lines = [];
  lines.push("  " + chalk.bold("Logs") + chalk.dim("  (last 3, live)  ") + chalk.cyan("[→ open]"));
  const preview = state.detailLogPreview || [];
  if (preview.length === 0) {
    lines.push("  " + chalk.dim("(no output yet)"));
  } else {
    const cols = process.stdout.columns || 80;
    const width = Math.max(20, cols - 2);
    for (const l of preview) {
      lines.push("  " + chalk.dim(truncate(stripCtrl(l), width)));
    }
  }
  lines.push("");
  return lines;
}

function statusResultLinesFor(e) {
  if (!e) return [];
  const fullText = state.statusResultText ?? e.statusCheck?.fullText ?? e.statusCheck?.text ?? "";
  const lines = String(fullText).split(/\r?\n/);
  return lines.length === 1 && lines[0] === "" ? [] : lines;
}

function drawStatusResultView() {
  const lines = [];
  const e = detailEntryFromState();
  const displayName = e ? displayId(e) : state.statusResultEntryId || "?";
  const statusState = state.statusResultState || e?.statusCheck?.state || null;

  lines.push("");
  lines.push(
    entryTitle(e, displayName) +
      chalk.dim(" / ") +
      chalk.bold("status command result") +
      (statusState ? chalk.dim(`  (${statusState})`) : ""),
  );
  lines.push(SEP);

  const cols = process.stdout.columns || 80;
  if (e?.statusCommand) {
    lines.push(chalk.dim(truncate(`  cmd: ${e.statusCommand}`, cols - 1)));
  } else {
    lines.push(chalk.dim("  cmd: —"));
  }
  lines.push(SEP);

  const rows = process.stdout.rows || 30;
  const reservedTop = lines.length;
  const reservedBottom = 3;
  const viewport = Math.max(5, rows - reservedTop - reservedBottom);
  const lineWidth = Math.max(20, cols - 2);
  const resultLines = statusResultLinesFor(e);

  if (state.statusResultError) {
    lines.push(chalk.red(`  ${state.statusResultError}`));
  } else if (!e?.statusCommand) {
    lines.push(chalk.dim("  (no statusCommand configured)"));
  } else if (!e.statusCheck && state.statusResultText == null) {
    lines.push(chalk.dim("  (not checked yet)"));
  } else if (resultLines.length === 0) {
    lines.push(chalk.dim("  (no output)"));
  } else {
    const total = resultLines.length;
    if (state.statusResultScroll > total - 1) state.statusResultScroll = Math.max(0, total - 1);
    const end = Math.max(0, total - state.statusResultScroll);
    const start = Math.max(0, end - viewport);
    for (const l of resultLines.slice(start, end)) {
      lines.push("  " + truncate(stripCtrl(l), lineWidth));
    }
    while (lines.length < reservedTop + viewport) lines.push("");
    lines.push(SEP);
    const live = state.statusResultScroll === 0;
    const pos = live
      ? chalk.green("latest") + chalk.dim(`  (lines ${start + 1}-${end} of ${total})`)
      : chalk.yellow(`↑ ${state.statusResultScroll} up`) +
        chalk.dim(`  (lines ${start + 1}-${end} of ${total})  · r: jump to latest`);
    lines.push("  " + pos);
  }

  lines.push(chalk.dim("  ↑↓: scroll  PgUp/PgDn: page  r: latest  ESC/q: back"));
  return lines;
}

function drawDetailActionsMenu(e) {
  const lines = [];
  lines.push("  " + chalk.bold("Actions"));
  lines.push("");
  const acts = detailActions(e);
  acts.forEach((a, i) => {
    const isCursor = i === state.detailCursor;
    const arrow = isCursor ? chalk.yellow("▸") : " ";
    const labelText = a.label;
    const label = isCursor ? chalk.yellow.bold(labelText) : chalk.white(labelText);
    const labelPadded = pad(label, 20);
    const k = chalk.dim(`[${a.key}]`);
    lines.push(`  ${arrow} ${labelPadded}${k}`);
  });
  lines.push("");
  lines.push(chalk.dim("  ↑↓: move  Enter: run  shortcut keys also accepted  ESC/q/←: back"));
  return lines;
}

function drawDetailView() {
  const e = detailEntryFromState();
  if (!e) {
    const id = state.detailEntryId;
    return [
      "",
      entryTitle(null, id || "?"),
      SEP,
      chalk.red("  entry not found"),
      SEP,
      chalk.dim("  ESC/q/←: back"),
    ];
  }
  const head = drawDetailHeader(e);
  const content = drawLogPreview();
  const menu = drawDetailActionsMenu(e);
  const footer = [];
  if (state.flash) {
    footer.push(
      "  " + (state.flash.tone === "ok" ? chalk.green(state.flash.text) : chalk.red(state.flash.text)),
    );
  }
  return [...head, ...content, ...menu, ...footer];
}

// detail view + sub-flow (worktreeSelect / optionSelect, etc.). Replaces the menu area with sub-flow lines.
function drawDetailWithSub(subLines) {
  const e = detailEntryFromState();
  if (!e) return drawDetailView();
  const head = drawDetailHeader(e);
  return [...head, ...subLines];
}

function drawWorktreeSelect() {
  const lines = [];
  const id = state.wtEntryId;
  lines.push("");
  lines.push(
    chalk.dim("── ") +
      chalk.bold("Select worktree") +
      chalk.dim(`  (entry: ${id})`) +
      " " +
      chalk.dim("─".repeat(40)),
  );
  lines.push("");

  if (state.wtError) {
    lines.push(chalk.red("  " + state.wtError));
  } else if (state.wtList.length === 0) {
    lines.push(chalk.dim("  (no other worktrees, or all already added)"));
  } else {
    state.wtList.forEach((wt, i) => {
      const isCursor = i === state.wtIndex;
      const arrow = isCursor ? chalk.yellow("▸") : " ";
      const branchTxt = chalk.cyan(wt.label);
      const pathTxt = chalk.dim(wt.subCwd);
      const exists = wt.exists ? "" : chalk.red("  (cwd missing)");
      const text = isCursor ? chalk.yellow.bold(branchTxt) : branchTxt;
      lines.push(`  ${arrow} ${text}${exists}`);
      lines.push(`     ${pathTxt}`);
    });
  }

  lines.push("");
  lines.push(chalk.dim("  ↑↓: move  Enter: add and auto-start  ESC/←: cancel"));
  return lines;
}

function drawOptionKeySelect() {
  const lines = [];
  const id = state.optEntryId;
  const entry = state.entries.find((e) => e.id === id);

  lines.push("");
  lines.push(
    chalk.dim("── ") +
      chalk.bold("Select option") +
      chalk.dim(`  (entry: ${id})`) +
      " " +
      chalk.dim("─".repeat(40)),
  );
  lines.push("");

  state.optKeys.forEach((k, i) => {
    const isCursor = i === state.optKeyIndex;
    const arrow = isCursor ? chalk.yellow("▸") : " ";
    const label = isCursor ? chalk.yellow.bold(pad(k, 10)) : chalk.white(pad(k, 10));
    const current = entry?.optionValues?.[k] ?? "?";
    lines.push(`  ${arrow} ${label}${chalk.magenta(current)}`);
  });

  lines.push("");
  lines.push(chalk.dim("  ↑↓: move  Enter: choose value  ESC/←: cancel"));
  return lines;
}

function drawOptionInput() {
  const lines = [];
  const id = state.optEntryId;
  const key = state.optKey;

  lines.push("");
  lines.push(
    chalk.dim("── ") +
      chalk.bold(`${key} manual input`) +
      chalk.dim(`  (entry: ${id})`) +
      " " +
      chalk.dim("─".repeat(40)),
  );
  lines.push("");
  lines.push(`  ${chalk.bold(key)} = ${chalk.yellow(state.inputBuffer)}${chalk.yellow("▌")}`);
  if (state.inputError) {
    lines.push("");
    lines.push(chalk.red(`  ${state.inputError}`));
  }
  lines.push("");
  lines.push(chalk.dim("  digits only  Enter: confirm  Backspace: erase  ESC/←: cancel"));
  return lines;
}

function drawOptionSelect() {
  const lines = [];
  const id = state.optEntryId;
  const key = state.optKey;
  const entry = state.entries.find((e) => e.id === id);
  const current = entry?.optionValues?.[key];

  lines.push("");
  lines.push(
    chalk.dim("── ") +
      chalk.bold(`${key} option`) +
      chalk.dim(`  (entry: ${id})`) +
      " " +
      chalk.dim("─".repeat(40)),
  );
  lines.push("");

  state.optValues.forEach((v, i) => {
    const isCursor = i === state.optIndex;
    const arrow = isCursor ? chalk.yellow("▸") : " ";
    const isCustom = v === "__CUSTOM__";
    const marker = isCustom ? chalk.dim("✎") : v === current ? chalk.green("●") : chalk.dim("○");
    const display = isCustom ? "manual input…" : v;
    const label = isCursor ? chalk.yellow.bold(display) : chalk.white(display);
    const tail = !isCustom && v === current ? chalk.dim("  (current)") : "";
    lines.push(`  ${arrow} ${marker} ${label}${tail}`);
  });

  lines.push("");
  lines.push(chalk.dim("  ↑↓: move  Enter: confirm  ESC/←: cancel"));
  return lines;
}

function drawLogView() {
  const lines = [];
  const id = state.logEntryId;
  const entry = visibleEntries(state).find((e) => e.id === id);
  const file = logPathFor(id);

  lines.push("");
  const displayName = entry ? displayId(entry) : id || "?";
  lines.push(
    entryTitle(entry, displayName) +
      chalk.dim(" / ") +
      chalk.bold("logs") +
      (entry ? chalk.dim(`  (${entry.status})`) : ""),
  );
  lines.push(SEP);
  const cols = process.stdout.columns || 80;
  const fileLine = `  file: ${file}`;
  lines.push(chalk.dim(truncate(fileLine, cols - 1)));
  if (entry?.command) {
    const cmdLine = `  cmd:  ${entry.command}`;
    lines.push(chalk.dim(truncate(cmdLine, cols - 1)));
  }
  lines.push(SEP);

  const rows = process.stdout.rows || 30;
  const reservedTop = lines.length;
  const reservedBottom = 3;
  const viewport = Math.max(5, rows - reservedTop - reservedBottom);
  // strip control sequences (cursor moves, RIS, color codes from dev server) and
  // truncate to terminal width so a single log line never wraps and pushes the
  // header off-screen.
  const logLineWidth = Math.max(20, cols - 2);

  if (state.logError) {
    lines.push(chalk.red(`  ${state.logError}`));
  } else if (state.logLines.length === 0) {
    lines.push(chalk.dim("  (no log output yet)"));
  } else {
    const total = state.logLines.length;
    const end = Math.max(0, total - state.logScroll);
    const start = Math.max(0, end - viewport);
    for (const l of state.logLines.slice(start, end)) {
      lines.push("  " + colorizeLogLine(truncate(stripCtrl(l), logLineWidth)));
    }
    while (lines.length < reservedTop + viewport) lines.push("");
    lines.push(SEP);
    const live = state.logScroll === 0;
    const pos = live
      ? chalk.green(`live`) + chalk.dim(`  (lines ${start + 1}-${end} of ${total})`)
      : chalk.yellow(`↑ ${state.logScroll} up`) +
        chalk.dim(`  (lines ${start + 1}-${end} of ${total})  · r: jump to live`);
    lines.push("  " + pos);
  }

  if (state.logClearConfirm) {
    lines.push(
      chalk.dim("  ↑↓: scroll  PgUp/PgDn: page  r: live  ") +
        chalk.yellow.bold("[c]") +
        " " +
        chalk.yellow("Enter to clear log, any other key to cancel") +
        chalk.dim("  ESC/q: back"),
    );
  } else {
    lines.push(chalk.dim("  ↑↓: scroll  PgUp/PgDn: page  r: live  c: clear  ESC/q: back"));
  }
  return lines;
}

function colorizeLogLine(line) {
  if (/^---/.test(line)) return chalk.cyan(line);
  if (/error|err!|throw|✗/i.test(line)) return chalk.red(line);
  if (/warn/i.test(line)) return chalk.yellow(line);
  if (/(https?:\/\/\S+)/i.test(line)) {
    return line.replace(/(https?:\/\/\S+)/gi, (u) => chalk.cyan.underline(u));
  }
  return line;
}

function render() {
  let all;
  const rows = process.stdout.rows || 30;
  if (state.viewMode === "log") {
    all = drawLogView();
  } else if (state.viewMode === "statusResult") {
    all = drawStatusResultView();
  } else if (state.viewMode === "detail") {
    all = drawDetailView();
  } else if (state.viewMode === "main") {
    all = layoutMain(rows);
  } else {
    // sub-flow: option / worktree / input
    let sub;
    if (state.viewMode === "optionSelect") sub = drawOptionSelect();
    else if (state.viewMode === "optionKeySelect") sub = drawOptionKeySelect();
    else if (state.viewMode === "optionInput") sub = drawOptionInput();
    else if (state.viewMode === "worktreeSelect") sub = drawWorktreeSelect();
    else sub = [];
    // When the sub-flow was entered from detail, render it under the detail header; otherwise under the main HUD.
    if (state.detailEntryId) all = drawDetailWithSub(sub);
    else all = layoutWithSubFlow(sub, rows);
  }
  const body = all.map((l) => l + ERASE_TO_EOL).join("\n");
  process.stdout.write(CURSOR_HOME + body + ERASE_BELOW);
}

module.exports = {
  render,
  _test: {
    buildEntryLines,
    colorizeLogLine,
    compactStatusDot,
    drawBottom,
    drawDetailView,
    drawDetailWithSub,
    drawErrorOrLoading,
    drawHudTop,
    drawLogPreview,
    drawLogView,
    drawOptionInput,
    drawOptionKeySelect,
    drawOptionSelect,
    drawStatusResultView,
    drawWorktreeSelect,
    ensureCursorVisible,
    layoutMain,
    layoutWithSubFlow,
    padMin,
    render,
    statusCell,
    statusCheckCell,
    statusCheckDot,
    statusResultLinesFor,
  },
};

export {};
