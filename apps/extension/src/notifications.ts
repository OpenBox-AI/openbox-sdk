// Shared notification helpers. Only place that knows about VS Code's
// quirks (showErrorMessage sticks forever; withProgress auto-fades).

import * as vscode from "vscode";

/** Show an error notification that auto-dismisses after `ms`.
 *  vscode.window.showErrorMessage stays open until the user clicks X;
 *  this uses withProgress so transient errors don't pile up. */
export function showAutoDismissError(
  message: string,
  ms = 5_000,
): Thenable<void> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: message,
      cancellable: false,
    },
    () => new Promise((resolve) => setTimeout(resolve, ms)),
  );
}
