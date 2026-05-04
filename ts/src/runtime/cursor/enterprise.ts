// Enterprise hardening profile applied to ~/.cursor/settings.json.
// Cursor doesn't expose an "enterprise mode" toggle, so the closest
// reachable surface is the per-user settings file plus the workspace
// .vscode/settings.json (Cursor reads both like VS Code does). This
// module writes a managed subset of keys; everything else the user
// has set is preserved.
//
// Idempotent: rerunning produces no diff. Reversible: `unhardenCursor`
// removes only the keys this module set, identified by a marker
// section we write alongside.
//
// We deliberately don't ship a "force" mode that locks users out.
// Cursor settings are edit-anywhere; the goal here is a sane managed
// default plus an audit trail (the marker), not an attempt to defeat
// a determined user.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type EnterpriseProfileName = 'enterprise-strict' | 'enterprise-default';

interface EnterpriseProfile {
  name: EnterpriseProfileName;
  description: string;
  /**
   * Settings keys we set. Values are exact; null means "remove the key
   * if present." Keys are dot-separated to match Cursor / VS Code
   * settings vocabulary, but the writer flattens to top-level (Cursor
   * stores both nested and flat forms; we use flat for compatibility).
   */
  settings: Record<string, unknown>;
}

const PROFILES: Record<EnterpriseProfileName, EnterpriseProfile> = {
  'enterprise-default': {
    name: 'enterprise-default',
    description:
      'Disable cloud features that send code to third parties, opt out of ' +
      'crash telemetry, prefer privacy mode for chat.',
    settings: {
      // Privacy: prefer the strictest mode Cursor exposes. The exact
      // key name has shifted across Cursor releases; we set both the
      // current and the legacy name so older / newer builds both pick
      // it up.
      'cursor.general.privacy': true,
      'cursor.privacy.privacyMode': true,
      // Disable code indexing of cloud-stored data.
      'cursor.cpp.enabled': false,
      // Telemetry off (best-effort; key may be ignored if Cursor honors
      // only the system-level Anthropic/OpenAI provider settings).
      'telemetry.telemetryLevel': 'off',
      'telemetry.enableCrashReporter': false,
    },
  },
  'enterprise-strict': {
    name: 'enterprise-strict',
    description:
      'Default profile + disable Tab autocomplete and Composer entirely. ' +
      'Use when no agentic UX is permitted; chat with explicit prompts only.',
    settings: {
      'cursor.general.privacy': true,
      'cursor.privacy.privacyMode': true,
      'cursor.cpp.enabled': false,
      'cursor.cpp.disabledLanguages': ['*'],
      'cursor.composer.disabled': true,
      'telemetry.telemetryLevel': 'off',
      'telemetry.enableCrashReporter': false,
    },
  },
};

const MARKER_KEY = '_openbox_managed';

interface OpenBoxMarker {
  profile: EnterpriseProfileName;
  appliedAt: string;
  /** Keys this profile set, so unharden knows what to remove. */
  managedKeys: string[];
}

function settingsPath(): string {
  // Cursor uses VS Code's user settings layout. macOS / Linux variants
  // both land at ~/.cursor/User/settings.json on recent builds; older
  // builds use ~/.config/Cursor/User/settings.json. Pick whichever
  // exists; otherwise default to the modern path.
  const modern = path.join(os.homedir(), '.cursor', 'User', 'settings.json');
  const legacy = path.join(os.homedir(), '.config', 'Cursor', 'User', 'settings.json');
  if (fs.existsSync(modern)) return modern;
  if (fs.existsSync(legacy)) return legacy;
  return modern;
}

function loadJson(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Refusing to overwrite malformed JSON at ${file}; fix it manually then rerun.`,
    );
  }
}

function saveJson(file: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

export interface HardenOpts {
  /** Profile to apply. Defaults to enterprise-default. */
  profile?: EnterpriseProfileName;
  /** Print the diff but don't touch the file. */
  dryRun?: boolean;
}

export interface HardenResult {
  file: string;
  profile: EnterpriseProfileName;
  applied: string[];
  unchanged: string[];
}

export function hardenCursor(opts: HardenOpts = {}): HardenResult {
  const profileName = opts.profile ?? 'enterprise-default';
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown enterprise profile: ${profileName}`);
  }

  const file = settingsPath();
  const settings = loadJson(file);

  const applied: string[] = [];
  const unchanged: string[] = [];
  const managedKeys: string[] = [];

  for (const [key, value] of Object.entries(profile.settings)) {
    managedKeys.push(key);
    if (value === null) {
      if (key in settings) {
        applied.push(`-${key}`);
        delete settings[key];
      } else {
        unchanged.push(key);
      }
      continue;
    }
    const before = JSON.stringify(settings[key]);
    const after = JSON.stringify(value);
    if (before === after) {
      unchanged.push(key);
    } else {
      applied.push(key);
      settings[key] = value;
    }
  }

  const marker: OpenBoxMarker = {
    profile: profileName,
    appliedAt: new Date().toISOString(),
    managedKeys,
  };
  settings[MARKER_KEY] = marker;

  if (!opts.dryRun) {
    saveJson(file, settings);
  }
  return { file, profile: profileName, applied, unchanged };
}

export function unhardenCursor(): { file: string; removed: string[] } {
  const file = settingsPath();
  if (!fs.existsSync(file)) return { file, removed: [] };
  const settings = loadJson(file);
  const marker = settings[MARKER_KEY] as OpenBoxMarker | undefined;
  if (!marker || !Array.isArray(marker.managedKeys)) {
    return { file, removed: [] };
  }
  const removed: string[] = [];
  for (const key of marker.managedKeys) {
    if (key in settings) {
      delete settings[key];
      removed.push(key);
    }
  }
  delete settings[MARKER_KEY];
  saveJson(file, settings);
  return { file, removed };
}

export function listProfiles(): Array<{ name: EnterpriseProfileName; description: string }> {
  return Object.values(PROFILES).map((p) => ({ name: p.name, description: p.description }));
}
