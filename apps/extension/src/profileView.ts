// Profile view. Mirrors the mobile app's Profile / Account card:
// the user-facing identity rows only (Email, Org). Everything else
// the extension knows about the active session (env, key prefix,
// key id, permissions, polling stats) lives in the Debug view,
// which only shows up in dev builds.
//
// Sign Out / Set API Key / Open Dashboard sit in the view's title
// bar (see package.json view/title menu).

import * as vscode from "vscode";
import type { DebugSnapshot } from "./debugInfoPanel";

type Row = "email" | "orgId";

export class ProfileProvider implements vscode.TreeDataProvider<Row> {
  private _onDidChange = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private getSnapshot: () => DebugSnapshot) {}

  refresh() { this._onDidChange.fire(undefined); }

  getTreeItem(node: Row): vscode.TreeItem {
    const snap = this.getSnapshot();
    const row = (label: string, description: string, icon: string, tooltip?: string): vscode.TreeItem => {
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.description = description;
      item.iconPath = new vscode.ThemeIcon(icon);
      item.tooltip = tooltip ?? `${label}: ${description}`;
      return item;
    };
    switch (node) {
      case "email": return row("Email", snap.email || snap.preferredUsername || "-", "account");
      case "orgId": return row("Org", snap.orgId || "-", "organization");
    }
  }

  getChildren(): Row[] {
    const snap = this.getSnapshot();
    // Match mobile: Email is always rendered (with "-" placeholder
    // when the session has no human identity, e.g. org API-key
    // auth); Org only when present so the card stays compact.
    return snap.orgId ? ["email", "orgId"] : ["email"];
  }
}
