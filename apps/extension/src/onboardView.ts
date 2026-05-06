// Single gated onboarding view. Visible only when no API key is set
// (`openbox.needsKey` context true). When this view is up, Pending /
// History / Profile are all hidden so the user sees ONE clear page
// inviting them to set a key — same pattern as VS Code extensions
// like GitHub Pull Requests, Copilot Chat, etc.
//
// The provider returns []; all visible content comes from
// `viewsWelcome` in package.json which renders the buttons.

import * as vscode from "vscode";

export class OnboardProvider implements vscode.TreeDataProvider<never> {
  readonly onDidChangeTreeData = new vscode.EventEmitter<undefined>().event;
  getTreeItem(): vscode.TreeItem { throw new Error("unreachable"); }
  getChildren(): never[] { return []; }
}
