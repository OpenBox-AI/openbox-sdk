// Shared config-file readers for host-app runtime hooks (claude-code
// and cursor). Both flavors of `loadConfig()` consume the same
// on-disk formats: a JSON config plus a dotenv-style file under
// `<hostHomeDir>/{config.json,.env}`. The parsers live here so the
// two readers cannot drift apart.

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Read a JSON config file. Returns the parsed object as
 *  string-keyed values, with each camelCase key also exposed under
 *  its UPPER_SNAKE form so the consumer's `get('FOO_BAR')` lookup
 *  matches `{ fooBar: ... }` entries. */
export function loadJsonConfig(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      // Insert the camelCase boundary underscore BEFORE uppercasing — uppercasing
      // first left no lowercase chars for the regex, so it never matched and
      // `fooBar` became `FOOBAR` instead of the documented `FOO_BAR`.
      out[k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()] = String(v);
      out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** Read a dotenv-style file. Comments (`# …`) and blank lines are
 *  ignored; values are trimmed and matching surrounding quotes are
 *  stripped. */
export function loadDotenv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  try {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge a small runtime env patch into a private dotenv file. Undefined
 *  values are ignored so callers can update only the secrets they know. */
export function writeDotenvConfig(
  file: string,
  patch: Record<string, string | undefined>,
): void {
  const next = {
    ...loadDotenv(file),
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    next[key] = value;
  }
  const lines = Object.entries(next)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, {
    mode: 0o600,
    encoding: 'utf-8',
  });
  fs.chmodSync(file, 0o600);
}
