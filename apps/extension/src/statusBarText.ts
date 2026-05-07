// Pure text-builders for the OpenBox status bar.
//
// The activate() flow assigns these strings onto a vscode.StatusBarItem.
// Everything that decides WHICH string to show lives here so the logic
// is unit-testable without booting a workbench: same env tag rules,
// same idle-gate annotation, same tooltip copy.

import type { EnvName } from "openbox-sdk/env";

export interface IdleStatusBarInput {
  env: EnvName;
  count: number;
  mockAuth: boolean;
  debugBuild: boolean;
  preWriteGateActive: boolean;
  tabObserverEnabled: boolean;
  tabObserverActive: boolean;
  fileOpGateEnabled: boolean;
  haveAgent: boolean;
}

export interface IdleStatusBarOutput {
  text: string;
  /** undefined means: leave the previous tooltip in place. */
  tooltip?: string;
}

export function buildIdleStatusBar(opts: IdleStatusBarInput): IdleStatusBarOutput {
  // Env tag is debug-only context. Release builds keep the bar clean
  // so end users never see env names tagged on every status-bar
  // refresh; mock-auth always shows env so a tester can tell at a
  // glance which fixture they're driving.
  const showEnv = opts.debugBuild || opts.mockAuth;
  const envSuffix = opts.mockAuth
    ? ` · MOCK · ${opts.env}`
    : showEnv
      ? ` · ${opts.env}`
      : "";

  const anyActive =
    opts.preWriteGateActive ||
    (opts.tabObserverEnabled && opts.tabObserverActive) ||
    opts.fileOpGateEnabled;

  const idleNote = anyActive && !opts.haveAgent ? " · gates idle (no agent)" : "";

  const text =
    opts.count > 0
      ? `$(shield) ${opts.count} Pending${envSuffix}${idleNote}`
      : `$(shield) OpenBox${envSuffix}${idleNote}`;

  const tooltip =
    anyActive && !opts.haveAgent
      ? "Active gates are turned on but `openbox.agentId` is empty, so check_governance is skipped. Set the agent ID in settings to enable enforcement."
      : undefined;

  return { text, tooltip };
}

/** Boot/error tag used for transient states (Set API Key, No Org, ...).
 *  Debug builds carry the env suffix for development visibility; release
 *  builds hide it so end users never see env names tagged on transient
 *  state. */
export function envTagFor(state: string, env: EnvName, debugBuild: boolean): string {
  return debugBuild ? `OpenBox · ${env}: ${state}` : `OpenBox: ${state}`;
}
