// Shared config-file readers for host-app runtime hooks (claude-code,
// cursor). Both flavors of `loadConfig()` consume the same on-disk
// formats — a JSON config + a dotenv-style file under
// <hostHomeDir>/{config.json,.env} — and share these parsers so they
// can't drift apart.

import * as fs from 'node:fs';

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
      out[k.toUpperCase().replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()] = String(v);
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
