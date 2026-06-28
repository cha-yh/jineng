// @ts-nocheck
const WIDE_CHAR_RE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\u8C48-\uFAFF\uFE30-\uFE4F\uFF00-\uFFA0\uFFE0-\uFFE6]/;
const OSC8_RE = /\x1b\]8;;[^\x07]*\x07/g;
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return String(str).replace(OSC8_RE, "").replace(ANSI_SGR_RE, "");
}

function visualWidth(str) {
  const clean = stripAnsi(str);
  let width = 0;
  for (const ch of clean) {
    const code = ch.codePointAt(0);
    if (code >= 0x20000 && code <= 0x3fffd) width += 2;
    else if (WIDE_CHAR_RE.test(ch)) width += 2;
    else width += 1;
  }
  return width;
}

function pad(s, width) {
  const w = visualWidth(s);
  return w >= width ? s : s + " ".repeat(width - w);
}

function truncate(s, maxVisual) {
  if (!s) return "";
  if (visualWidth(s) <= maxVisual) return s;
  let out = "";
  let width = 0;
  for (const ch of s) {
    const chWidth = visualWidth(ch);
    if (width + chWidth > maxVisual - 1) break;
    out += ch;
    width += chWidth;
  }
  return out + "…";
}

module.exports = {
  pad,
  truncate,
  visualWidth,
};

export {};
