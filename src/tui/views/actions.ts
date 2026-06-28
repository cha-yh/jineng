// @ts-nocheck
function detailActions(entry) {
  const actions = [];
  if (entry.status === "running" || entry.status === "paused") {
    actions.push({ key: "x", label: "stop" });
  } else {
    actions.push({ key: "s", label: "start" });
  }
  actions.push({ key: "R", label: "restart" });
  if (entry.options && Object.keys(entry.options).length > 0) {
    actions.push({ key: "o", label: "options" });
  }
  if (entry.worktree) actions.push({ key: "d", label: "remove worktree" });
  else if (entry.type !== "task" && entry.entryId === entry.id) actions.push({ key: "w", label: "add worktree" });
  return actions;
}

module.exports = { detailActions };

export {};
