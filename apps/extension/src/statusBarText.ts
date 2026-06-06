// Pure text-builders for the OpenBox status bar.
//
// The activate() flow assigns these strings onto a vscode.StatusBarItem.
// Everything that decides WHICH string to show lives here so the logic
// is unit-testable without booting a workbench: same idle-gate
// annotation, same tooltip copy.
//
// Shape: $(openbox-logo) [info]; the icon identifies it as OpenBox,
// info is just the relevant short action / state. No redundant
// "OpenBox" word; if there's nothing to say, the bar is just the
// icon.

export interface IdleStatusBarInput {
  count: number;
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
  const anyActive =
    opts.preWriteGateActive ||
    (opts.tabObserverEnabled && opts.tabObserverActive) ||
    opts.fileOpGateEnabled;

  const parts: string[] = [];
  if (opts.count > 0) parts.push(`${opts.count} Pending`);
  if (anyActive && !opts.haveAgent) parts.push("gates idle (no agent)");

  const text =
    parts.length > 0
      ? `$(openbox-logo) ${parts.join(" · ")}`
      : "$(openbox-logo) OpenBox";

  const tooltip =
    anyActive && !opts.haveAgent
      ? "Active gates are turned on but `openbox.agentId` is empty, so check_governance is skipped. Set the agent ID in settings to enable enforcement."
      : undefined;

  return { text, tooltip };
}

/** Boot/error tag used for transient states (Connect, Error, ...).
 *  Just the action text; the icon already identifies the bar as
 *  OpenBox. */
export function statusTagFor(state: string, debugBuild: boolean): string {
  void debugBuild;
  return state;
}
