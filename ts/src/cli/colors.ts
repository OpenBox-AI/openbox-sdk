// Color helpers; every chalk-equivalent goes through `useColor()` so
// scripts that pipe stdout/stderr or set NO_COLOR / OPENBOX_NO_COLOR /
// CI=1 / --no-color get clean text. Drift test bans direct `\x1b[` outside
// this file + validators/index.ts (where reportAndExit also uses the
// helper for its single error line).
import { useColor } from './non-interactive.js';

const CODES = {
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  bold: '1',
  dim: '2',
} as const;

export type ColorName = keyof typeof CODES;

function wrap(code: string, s: string): string {
  if (!useColor()) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

export const color = {
  red: (s: string) => wrap(CODES.red, s),
  green: (s: string) => wrap(CODES.green, s),
  yellow: (s: string) => wrap(CODES.yellow, s),
  blue: (s: string) => wrap(CODES.blue, s),
  magenta: (s: string) => wrap(CODES.magenta, s),
  cyan: (s: string) => wrap(CODES.cyan, s),
  bold: (s: string) => wrap(CODES.bold, s),
  dim: (s: string) => wrap(CODES.dim, s),
};
