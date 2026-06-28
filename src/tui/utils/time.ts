// @ts-nocheck
function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
}

function fmtClock(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

module.exports = {
  fmtClock,
  fmtUptime,
};

export {};
