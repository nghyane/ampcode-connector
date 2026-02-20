/** Raw ANSI escape helpers — no dependencies. */

const ESC = "\x1b[";

export const cursor = {
  hide: () => out(`${ESC}?25l`),
  show: () => out(`${ESC}?25h`),
  home: () => out(`${ESC}H`),
};

export const screen = {
  clear: () => out(`${ESC}2J${ESC}H`),
};

/** Erase from cursor to end of line. */
const eol = `${ESC}K`;

export const s = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  inverse: `${ESC}7m`,
  green: `${ESC}32m`,
  red: `${ESC}31m`,
  yellow: `${ESC}33m`,
  gray: `${ESC}90m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
};

export function out(text: string): void {
  process.stdout.write(text);
}

export function line(text = ""): void {
  process.stdout.write(`${text}${eol}\n`);
}
