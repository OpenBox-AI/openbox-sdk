import * as vscode from "vscode";
import type { Approval } from "./types";

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function timeRemaining(dateStr: string): string {
  const diff = (new Date(dateStr).getTime() - Date.now()) / 1000;
  if (diff <= 0) return "expired";
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${Math.floor(diff % 60)}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

type TreeNode = { kind: "approval"; approval: Approval }
  | { kind: "detail"; label: string; icon?: string; id?: string }
  | { kind: "empty" };

export class ApprovalsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private approvals: Approval[] = [];
  private countdownTimer: ReturnType<typeof setInterval> | undefined;

  update(approvals: Approval[]) {
    this.approvals = approvals;
    this._onDidChange.fire(undefined);
    this.startCountdown();
  }

  private startCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (!this.approvals.some((a) => a.approval_expired_at)) return;
    this.countdownTimer = setInterval(() => this._onDidChange.fire(undefined), 1000);
  }

  dispose() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "empty") {
      const item = new vscode.TreeItem("No pending approvals", vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("check");
      return item;
    }

    if (node.kind === "detail") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      if (node.id) item.id = node.id;
      if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
      return item;
    }

    const approval = node.approval;
    const agent = approval.agent?.agent_name || approval.agent_id || "Unknown Agent";
    const action = approval.activity_type || "";
    const label = action ? `${agent}; ${action}` : agent;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = `approval-${approval.id}`;
    item.contextValue = "approval";
    item.iconPath = new vscode.ThemeIcon("shield");

    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    // Root level
    if (!element) {
      if (this.approvals.length === 0) return [{ kind: "empty" }];
      return this.approvals.map((a) => ({ kind: "approval" as const, approval: a }));
    }

    // Children of an approval node; show details inline
    if (element.kind === "approval") {
      const a = element.approval;
      const verdictMap: Record<number, string> = { 0: "Allow", 1: "Constrain", 2: "Require Approval", 3: "Block", 4: "Halt" };
      const details: TreeNode[] = [];
      const pid = a.id;

      const tier = a.metadata?.trust_tier;
      if (tier) details.push({ kind: "detail", label: `Trust Tier ${tier}`, icon: "verified", id: `${pid}-tier` });

      const verdict = a.verdict != null ? verdictMap[a.verdict] : undefined;
      if (verdict) details.push({ kind: "detail", label: `Verdict: ${verdict}`, icon: "warning", id: `${pid}-verdict` });

      if (a.reason) details.push({ kind: "detail", label: a.reason, icon: "info", id: `${pid}-reason` });

      if (a.created_at) details.push({ kind: "detail", label: `Requested ${timeAgo(a.created_at)}`, icon: "clock", id: `${pid}-time` });

      if (a.approval_expired_at) {
        details.push({ kind: "detail", label: `Expires in ${timeRemaining(a.approval_expired_at)}`, icon: "watch", id: `${pid}-expires` });
      }

      return details;
    }

    return [];
  }
}
