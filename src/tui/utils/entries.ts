// @ts-nocheck
function visibleEntries(state) {
  return [...state.entries, ...(state.tasks || [])];
}

function isTaskEntry(entry) {
  return entry && entry.type === "task";
}

function totalMenuItems(state) {
  return visibleEntries(state).length;
}

function selectedEntry(state) {
  const visible = visibleEntries(state);
  return state.cursor < visible.length ? visible[state.cursor] : null;
}

function detailEntry(state) {
  if (!state.detailEntryId) return null;
  return visibleEntries(state).find((e) => e.id === state.detailEntryId) || null;
}

function targetEntry(state) {
  if (state.viewMode === "detail") return detailEntry(state);
  return selectedEntry(state);
}

function displayId(entry) {
  if (entry && entry.worktree && entry.worktree.label) return "wt@" + entry.worktree.label;
  return entry.id;
}

function compactBranch(branch) {
  if (!branch) return null;
  const segments = branch.split("/");
  if (segments.length <= 2) return branch;
  return "../" + segments.slice(-2).join("/");
}

function formatPortsForEntry(entry) {
  const ports = entry.ports || [];
  if (ports.length === 0) return null;
  const optionValues = entry.optionValues || {};
  const labelByPort = new Map();
  for (const [key, value] of Object.entries(optionValues)) {
    const port = parseInt(value, 10);
    if (!isNaN(port)) labelByPort.set(port, key);
  }

  let mainPort = null;
  const others = [];
  const unlabeled = [];
  for (const port of ports) {
    const label = labelByPort.get(port);
    if (label === "port") mainPort = port;
    else if (label) others.push(`${label}:${port}`);
    else unlabeled.push(String(port));
  }
  if (mainPort === null && unlabeled.length > 0) {
    mainPort = parseInt(unlabeled.shift(), 10);
  }

  const parts = [];
  if (mainPort !== null) parts.push(String(mainPort));
  parts.push(...unlabeled);
  parts.push(...others);
  return parts.join("/");
}

module.exports = {
  compactBranch,
  detailEntry,
  displayId,
  formatPortsForEntry,
  isTaskEntry,
  selectedEntry,
  targetEntry,
  totalMenuItems,
  visibleEntries,
};

export {};
