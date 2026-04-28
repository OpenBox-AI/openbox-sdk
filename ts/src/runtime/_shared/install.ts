// Shared install/uninstall primitive used by every runtime adapter.
// The per-adapter install.ts files load their generated INSTALL_SPEC
// (file path, JSON key, per-event style, hook command) and call
// installAdapter / uninstallAdapter - all the JSON-merge work lives
// here, so adding a new adapter is just declaring @installTarget in
// the spec.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface InstallSpec {
  file: string;
  key: string;
  style: 'claude-array' | 'cursor-keyed';
  command: string;
  configDir: string;
  events: Array<{ name: string; timeout?: number }>;
}

/** Expand a leading `~` to the user's home dir. */
function expand(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function loadJson(file: string): Record<string, unknown> {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    }
  } catch {
    /* start fresh */
  }
  return {};
}

function saveJson(file: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

interface ClaudeInnerHook {
  type: string;
  command: string;
  timeout?: number;
}
interface ClaudeRuleEntry {
  matcher?: string;
  hooks: ClaudeInnerHook[];
}

function ruleIsOpenBox(rule: ClaudeRuleEntry, command: string): boolean {
  return rule.hooks?.some(
    (h) =>
      h.command === command ||
      h.command?.includes('openbox claude-code') ||
      h.command?.includes('openbox cursor') ||
      h.command?.includes('claude-hooks') /* legacy */ ||
      h.command?.includes('cursor-hooks') /* legacy */,
  ) ?? false;
}

function isCursorOpenBoxHook(value: unknown, command: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const cmd = (value as { command?: string }).command;
  return (
    cmd === command ||
    cmd?.includes('openbox cursor') === true ||
    cmd?.includes('cursor-hooks') === true /* legacy */
  );
}

function dropExampleConfig(spec: InstallSpec): void {
  const dir = expand(spec.configDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  if (fs.existsSync(file)) return;
  const example = {
    OPENBOX_API_KEY: 'obx_live_YOUR_API_KEY_HERE',
    OPENBOX_ENDPOINT: 'https://core.openbox.ai',
    GOVERNANCE_POLICY: 'fail_open',
    HITL_ENABLED: true,
    HITL_MAX_WAIT: 300,
    VERBOSE: false,
    DRY_RUN: true,
  };
  fs.writeFileSync(file, JSON.stringify(example, null, 2) + '\n', 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`Created example config at ${file}`);
  // eslint-disable-next-line no-console
  console.log('  -> Set OPENBOX_API_KEY and DRY_RUN=false to enable governance');
}

export function installAdapter(spec: InstallSpec): void {
  const file = expand(spec.file);
  const settings = loadJson(file);

  if (spec.style === 'claude-array') {
    let hooksBlock = settings[spec.key] as Record<string, ClaudeRuleEntry[]> | undefined;
    if (!hooksBlock) {
      hooksBlock = {};
      settings[spec.key] = hooksBlock;
    }
    for (const evt of spec.events) {
      if (!hooksBlock[evt.name]) hooksBlock[evt.name] = [];
      hooksBlock[evt.name] = hooksBlock[evt.name].filter((r) => !ruleIsOpenBox(r, spec.command));
      const inner: ClaudeInnerHook = { type: 'command', command: spec.command };
      if (evt.timeout) inner.timeout = evt.timeout;
      hooksBlock[evt.name].push({ hooks: [inner] });
    }
  } else {
    // cursor-keyed: events[evt] = { command }
    let hooksBlock = settings[spec.key] as Record<string, { command: string }> | undefined;
    if (!hooksBlock) {
      hooksBlock = {};
      settings[spec.key] = hooksBlock;
    }
    for (const evt of spec.events) {
      hooksBlock[evt.name] = { command: spec.command };
    }
  }

  saveJson(file, settings);
  // eslint-disable-next-line no-console
  console.log(`Installed OpenBox hooks into ${file}`);
  // eslint-disable-next-line no-console
  console.log(`Hook events: ${spec.events.map((e) => e.name).join(', ')}`);

  dropExampleConfig(spec);
}

export function uninstallAdapter(spec: InstallSpec): void {
  const file = expand(spec.file);
  const settings = loadJson(file);
  const hooksBlock = settings[spec.key];
  if (!hooksBlock || typeof hooksBlock !== 'object') {
    // eslint-disable-next-line no-console
    console.log('No hooks configured. Nothing to uninstall.');
    return;
  }

  let removed = 0;
  if (spec.style === 'claude-array') {
    const block = hooksBlock as Record<string, ClaudeRuleEntry[]>;
    for (const evt of Object.keys(block)) {
      const before = block[evt].length;
      block[evt] = block[evt].filter((r) => !ruleIsOpenBox(r, spec.command));
      removed += before - block[evt].length;
      if (block[evt].length === 0) delete block[evt];
    }
    if (Object.keys(block).length === 0) delete settings[spec.key];
  } else {
    const block = hooksBlock as Record<string, unknown>;
    for (const evt of spec.events) {
      if (isCursorOpenBoxHook(block[evt.name], spec.command)) {
        delete block[evt.name];
        removed += 1;
      }
    }
    if (Object.keys(block).length === 0) delete settings[spec.key];
  }

  saveJson(file, settings);
  // eslint-disable-next-line no-console
  console.log(`Removed ${removed} OpenBox hook(s) from ${file}`);
}
