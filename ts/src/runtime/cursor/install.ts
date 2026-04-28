// Installer for Cursor hooks. Writes hooks.json into the user's
// Cursor config dir, points each hook event at `openbox cursor hook`.
//
// Driven by `openbox cursor install`. `openbox` must be on $PATH.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOOK_COMMAND = 'openbox cursor hook';

const CURSOR_CONFIG_DIR = path.join(os.homedir(), '.cursor');
const CURSOR_HOOKS_FILE = path.join(CURSOR_CONFIG_DIR, 'hooks.json');
const OPENBOX_CONFIG_DIR = path.join(os.homedir(), '.cursor-hooks');
const OPENBOX_CONFIG_FILE = path.join(OPENBOX_CONFIG_DIR, 'config.json');

interface HookConfig {
  hooks?: Record<string, { command: string }>;
  [key: string]: unknown;
}

const HOOK_EVENTS = [
  'beforeSubmitPrompt',
  'beforeShellExecution',
  'beforeMCPExecution',
  'beforeReadFile',
  'preToolUse',
  'afterMCPExecution',
  'afterAgentResponse',
  'afterAgentThought',
  'afterShellExecution',
  'afterFileEdit',
  'sessionStart',
  'stop',
];

function loadHooks(): HookConfig {
  try {
    if (fs.existsSync(CURSOR_HOOKS_FILE)) {
      return JSON.parse(fs.readFileSync(CURSOR_HOOKS_FILE, 'utf-8'));
    }
  } catch {
    /* start fresh */
  }
  return {};
}

function saveHooks(cfg: HookConfig): void {
  fs.mkdirSync(CURSOR_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CURSOR_HOOKS_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

export function installCursorHooks(): void {
  const cfg = loadHooks();
  if (!cfg.hooks) cfg.hooks = {};
  for (const event of HOOK_EVENTS) {
    cfg.hooks[event] = { command: HOOK_COMMAND };
  }
  saveHooks(cfg);
  // eslint-disable-next-line no-console
  console.log(`Installed Cursor hooks into ${CURSOR_HOOKS_FILE}`);
  // eslint-disable-next-line no-console
  console.log(`Hook events: ${HOOK_EVENTS.join(', ')}`);

  fs.mkdirSync(OPENBOX_CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(OPENBOX_CONFIG_FILE)) {
    fs.writeFileSync(
      OPENBOX_CONFIG_FILE,
      JSON.stringify(
        {
          OPENBOX_API_KEY: 'obx_live_YOUR_API_KEY_HERE',
          OPENBOX_ENDPOINT: 'https://core.openbox.ai',
          GOVERNANCE_POLICY: 'fail_open',
          HITL_ENABLED: true,
          HITL_MAX_WAIT: 300,
          VERBOSE: false,
          DRY_RUN: true,
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    // eslint-disable-next-line no-console
    console.log(`Created example config at ${OPENBOX_CONFIG_FILE}`);
    // eslint-disable-next-line no-console
    console.log('  -> Set OPENBOX_API_KEY and DRY_RUN=false to enable governance');
  }
}

export function uninstallCursorHooks(): void {
  const cfg = loadHooks();
  if (!cfg.hooks) {
    // eslint-disable-next-line no-console
    console.log('No hooks configured. Nothing to uninstall.');
    return;
  }

  let removed = 0;
  for (const event of HOOK_EVENTS) {
    const hook = cfg.hooks[event];
    if (
      hook?.command === HOOK_COMMAND ||
      hook?.command?.includes('cursor-hooks') /* legacy install path */
    ) {
      delete cfg.hooks[event];
      removed += 1;
    }
  }
  if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;

  saveHooks(cfg);
  // eslint-disable-next-line no-console
  console.log(`Removed ${removed} OpenBox hook(s) from ${CURSOR_HOOKS_FILE}`);
}
