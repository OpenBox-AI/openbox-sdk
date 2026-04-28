// Installer for Claude Code hooks. Merges OpenBox's hook block into
// ~/.claude/settings.json without overwriting other settings. Driven
// by `openbox claude-code install` (and `--uninstall`).
//
// The hook command points at `openbox claude-code hook` (the binary
// from the openbox-sdk install) - no separate node-script path needed.
// `openbox` must be on $PATH when Claude Code spawns the hook.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLAUDE_SETTINGS_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_SETTINGS_DIR, 'settings.json');
const OPENBOX_CONFIG_DIR = path.join(os.homedir(), '.claude-hooks');
const OPENBOX_CONFIG_FILE = path.join(OPENBOX_CONFIG_DIR, 'config.json');

const HOOK_COMMAND = 'openbox claude-code hook';

interface InnerHook {
  type: string;
  command: string;
  timeout?: number;
}
interface HookRuleEntry {
  matcher?: string;
  hooks: InnerHook[];
}
interface HookConfig {
  hooks?: Record<string, HookRuleEntry[]>;
  [key: string]: unknown;
}

const OPENBOX_HOOKS: Record<string, InnerHook> = {
  PreToolUse:        { type: 'command', command: HOOK_COMMAND, timeout: 86400 },
  PostToolUse:       { type: 'command', command: HOOK_COMMAND },
  UserPromptSubmit:  { type: 'command', command: HOOK_COMMAND, timeout: 86400 },
  PermissionRequest: { type: 'command', command: HOOK_COMMAND, timeout: 86400 },
  SessionStart:      { type: 'command', command: HOOK_COMMAND },
  SessionEnd:        { type: 'command', command: HOOK_COMMAND },
  Stop:              { type: 'command', command: HOOK_COMMAND },
  SubagentStart:     { type: 'command', command: HOOK_COMMAND },
  SubagentStop:      { type: 'command', command: HOOK_COMMAND },
};

function loadSettings(): HookConfig {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    }
  } catch {
    /* start fresh */
  }
  return {};
}

function saveSettings(settings: HookConfig): void {
  fs.mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function ruleIsOpenBox(rule: HookRuleEntry): boolean {
  return rule.hooks?.some(
    (h) =>
      h.command?.includes('openbox claude-code') ||
      h.command?.includes('claude-hooks') /* legacy install path */,
  ) ?? false;
}

export function installClaudeCode(): void {
  const settings = loadSettings();
  if (!settings.hooks) settings.hooks = {};

  for (const [event, innerHook] of Object.entries(OPENBOX_HOOKS)) {
    if (!settings.hooks[event]) settings.hooks[event] = [];
    // Drop pre-existing OpenBox rules to avoid duplicates / legacy paths.
    settings.hooks[event] = settings.hooks[event].filter((r) => !ruleIsOpenBox(r));
    // No matcher = matches every tool call.
    settings.hooks[event].push({ hooks: [innerHook] });
  }

  saveSettings(settings);
  // eslint-disable-next-line no-console
  console.log(`Installed OpenBox hooks into ${CLAUDE_SETTINGS_FILE}`);
  // eslint-disable-next-line no-console
  console.log(`Hook events configured: ${Object.keys(OPENBOX_HOOKS).join(', ')}`);

  fs.mkdirSync(OPENBOX_CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(OPENBOX_CONFIG_FILE)) {
    const exampleConfig = {
      OPENBOX_API_KEY: 'obx_live_YOUR_API_KEY_HERE',
      OPENBOX_ENDPOINT: 'https://core.openbox.ai',
      GOVERNANCE_POLICY: 'fail_open',
      HITL_ENABLED: true,
      HITL_MAX_WAIT: 300,
      VERBOSE: false,
      DRY_RUN: true,
      SKIP_TOOLS: 'Glob,Grep',
    };
    fs.writeFileSync(OPENBOX_CONFIG_FILE, JSON.stringify(exampleConfig, null, 2) + '\n', 'utf-8');
    // eslint-disable-next-line no-console
    console.log(`Created example config at ${OPENBOX_CONFIG_FILE}`);
    // eslint-disable-next-line no-console
    console.log('  -> Set OPENBOX_API_KEY and DRY_RUN=false to enable governance');
  }
}

export function uninstallClaudeCode(): void {
  const settings = loadSettings();
  if (!settings.hooks) {
    // eslint-disable-next-line no-console
    console.log('No hooks configured. Nothing to uninstall.');
    return;
  }

  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter((r) => !ruleIsOpenBox(r));
    removed += before - settings.hooks[event].length;
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  saveSettings(settings);
  // eslint-disable-next-line no-console
  console.log(`Removed ${removed} OpenBox hook(s) from ${CLAUDE_SETTINGS_FILE}`);
}
