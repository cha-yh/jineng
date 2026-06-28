// @ts-nocheck
const CURSOR_HOME = "\x1b[H";
const ERASE_TO_EOL = "\x1b[K";
const ERASE_BELOW = "\x1b[J";
const CLEAR = "\x1b[2J\x1b[H";
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ENABLE_MOUSE = "\x1b[?1002h\x1b[?1006h\x1b[?1007l";
const DISABLE_MOUSE = "\x1b[?1007h\x1b[?1006l\x1b[?1002l";

module.exports = {
  CLEAR,
  CURSOR_HOME,
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  ENTER_ALT_SCREEN,
  ERASE_TO_EOL,
  ERASE_BELOW,
  HIDE_CURSOR,
  LEAVE_ALT_SCREEN,
  SHOW_CURSOR,
};

export {};
