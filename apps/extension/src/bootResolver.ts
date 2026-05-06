// Boot-time auth/env resolver. Replaces the old "throw and show error"
// pattern with a tiered fallback:
//
//   1. mockAuth flag set        → no auth required, fixtures route
//   2. configured env has key   → use it
//   3. another env has a key    → auto-fall-back, log to status bar
//   4. no env has a key + no mock → one actionable info dialog
//                                   (Use mock auth / Create API key /
//                                    Open settings)
//
// Also handles agent_id resolution: workspace setting → ~/.openbox/config
// fallback. Returns the resolved view; the consumer decides what to
// boot (mock feed vs real client).

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ENVIRONMENTS, type EnvName } from 'openbox-sdk/env';
import { loadApiKey as loadFileApiKey } from 'openbox-sdk/file-tokens';

const ENVS: EnvName[] = ['production', 'staging', 'local'];

export interface BootView {
  /** Auth mode the extension should run in. */
  mode: 'mock' | 'real' | 'unconfigured';
  /** Resolved env (may differ from configured if we auto-fell-back). */
  env: EnvName;
  /** Whether we silently switched away from the user's configured env. */
  fellBackFrom?: EnvName;
  /** Resolved agent ID, if any, after workspace + global fallback. */
  agentId?: string;
}

function configuredEnv(): EnvName {
  const v = vscode.workspace.getConfiguration('openbox').get<string>('environment', 'production');
  return v === 'staging' || v === 'local' ? v : 'production';
}

function isMockAuth(): boolean {
  return vscode.workspace.getConfiguration('openbox').get<boolean>('mockAuth', false);
}

function workspaceAgentId(): string | undefined {
  const v = vscode.workspace.getConfiguration('openbox').get<string>('agentId', '').trim();
  return v || undefined;
}

/** Read `~/.openbox/config` for a global agent ID default. The file
 *  is plain `KEY=value` lines; we only care about OPENBOX_AGENT_ID. */
function globalAgentId(): string | undefined {
  const cfg = path.join(os.homedir(), '.openbox', 'config');
  if (!fs.existsSync(cfg)) return undefined;
  try {
    const lines = fs.readFileSync(cfg, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^OPENBOX_AGENT_ID\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function envsWithKey(): EnvName[] {
  return ENVS.filter((e) => !!loadFileApiKey(e));
}

export function resolveBoot(): BootView {
  const agentId = workspaceAgentId() ?? globalAgentId();
  if (isMockAuth()) {
    return { mode: 'mock', env: configuredEnv(), agentId };
  }
  const requested = configuredEnv();
  if (loadFileApiKey(requested)) {
    return { mode: 'real', env: requested, agentId };
  }
  const candidates = envsWithKey();
  if (candidates.length === 1) {
    return {
      mode: 'real',
      env: candidates[0],
      fellBackFrom: requested,
      agentId,
    };
  }
  if (candidates.length > 1) {
    return {
      mode: 'real',
      env: candidates[0],
      fellBackFrom: requested,
      agentId,
    };
  }
  return { mode: 'unconfigured', env: requested, agentId };
}

/** One-time first-run prompt when the user has no key for any env
 *  and mockAuth is off. Three actions: enable mock, create a key, open
 *  the settings UI. The user can also dismiss; we mark globalState so
 *  it doesn't fire again until they explicitly re-trigger. */
export async function showUnconfiguredPrompt(
  context: vscode.ExtensionContext,
  env: EnvName,
): Promise<void> {
  const KEY = 'openbox.unconfiguredDismissed';
  if (context.globalState.get<boolean>(KEY)) return;
  const choice = await vscode.window.showInformationMessage(
    `OpenBox: no API key configured for env '${env}'. Pick one to get started, or enable mock auth to try the UI without a backend.`,
    'Use Mock Auth',
    'Create API Key',
    'Open Settings',
    "Don't show again",
  );
  if (choice === 'Use Mock Auth') {
    await vscode.workspace
      .getConfiguration('openbox')
      .update('mockAuth', true, vscode.ConfigurationTarget.Global);
  } else if (choice === 'Create API Key') {
    // Dashboard URL is env-specific; pull from the spec-driven env
    // table so a production user lands on the prod dashboard, a
    // staging user on staging, and a local-stack user on their
    // local platform host.
    const platformUrl = ENVIRONMENTS[env]?.platformUrl;
    if (platformUrl) {
      void vscode.env.openExternal(vscode.Uri.parse(platformUrl));
    } else {
      void vscode.window.showWarningMessage(
        `No platform URL configured for env '${env}'. Set OPENBOX_PLATFORM_URL or pick a different environment.`,
      );
    }
  } else if (choice === 'Open Settings') {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'openbox');
  } else if (choice === "Don't show again") {
    await context.globalState.update(KEY, true);
  }
}
