// QuickPick + InputBox flows for each filter category. Mobile uses iOS
// ActionSheets; the extension's idiom is QuickPick. Each command mutates
// the shared FilterState through the provided controller, which then
// persists + re-polls.
//
// One set of pure functions, called from both the pending and history
// views via separate command IDs (openbox.filterTier vs
// openbox.history.filterTier). The view-specific command registrations
// live in viewSession.ts; this file just owns the picker contents.

import * as vscode from "vscode";
import type { OpenBoxClient } from "@openbox-ai/openbox-sdk/client";
import type { Member, Team } from "./types";
import type { DateRangeKey, FilterState } from "./filters";

export interface FilterController {
  current(): FilterState;
  update(next: Partial<FilterState>): Promise<void>;
  clear(): Promise<void>;
  // Activity types seen ACROSS the lifetime of this view session, not
  // just the current poll result. Mirrors mobile's
  // `seenActivityTypesRef` - without stickiness, narrowing one filter
  // (e.g. tier) would shrink the type picker to whatever survived,
  // breaking the user's ability to widen back out.
  seenActivityTypes(): string[];
  client(): OpenBoxClient | undefined;
  orgId(): string | undefined;
  teams(): Team[];
  members(): Member[];
  currentUserSub(): string | undefined;
  // History-only views set this true so the category picker offers
  // Status and Date Range; pending hides them (status pinned, no date
  // range on iOS pending either).
  supportsStatus(): boolean;
}

const TIERS = ["1", "2", "3", "4"];
const STATUSES: { label: string; value?: "approved" | "rejected" | "expired" }[] = [
  { label: "All" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Expired", value: "expired" },
];
const DATE_RANGES: { label: string; value: DateRangeKey }[] = [
  { label: "All time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "week" },
  { label: "Last 30 days", value: "month" },
];

export async function pickCategory(controller: FilterController) {
  const f = controller.current();
  const items: vscode.QuickPickItem[] = [
    { label: "$(search) Search", description: f.search ? `"${f.search}"` : undefined },
    { label: "$(verified) Tier", description: f.tier ? `Tier ${f.tier}` : undefined },
    { label: "$(symbol-event) Type", description: f.activityType || undefined },
    { label: "$(organization) Team", description: f.teamId ? teamName(controller, f.teamId) : undefined },
    { label: "$(person) Owner", description: f.ownerId ? ownerName(controller, f.ownerId) : undefined },
    { label: "$(arrow-swap) Sort", description: f.sort === "oldest" ? "Oldest" : "Newest" },
  ];
  if (controller.supportsStatus()) {
    // History only - date range. Status is handled by section headers
    // in the tree, not a filter, so it's no longer a category here.
    const dateLabel = DATE_RANGES.find((d) => d.value === (f.dateRange || "all"))?.label || "All time";
    items.push(
      { label: "$(calendar) Date range", description: dateLabel },
    );
  }
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Filter approvals by…" });
  if (!choice) return;
  if (choice.label.includes("Search")) await pickSearch(controller);
  else if (choice.label.includes("Tier")) await pickTier(controller);
  else if (choice.label.includes("Type")) await pickType(controller);
  else if (choice.label.includes("Team")) await pickTeam(controller);
  else if (choice.label.includes("Owner")) await pickOwner(controller);
  else if (choice.label.includes("Sort")) await toggleSort(controller);
  else if (choice.label.includes("Date range")) await pickDateRange(controller);
}

export async function pickSearch(controller: FilterController) {
  const current = controller.current().search ?? "";
  const value = await vscode.window.showInputBox({
    placeHolder: "Search agent name or reason",
    value: current,
    prompt: "Empty to clear search",
  });
  if (value === undefined) return;
  await controller.update({ search: value.trim() || undefined });
}

export async function pickTier(controller: FilterController) {
  const current = controller.current().tier;
  const items: (vscode.QuickPickItem & { tier?: string })[] = [
    { label: "All tiers" },
    ...TIERS.map((t) => ({ label: `Tier ${t}`, tier: t, picked: t === current })),
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Filter by trust tier" });
  if (!choice) return;
  await controller.update({ tier: choice.tier });
}

export async function pickType(controller: FilterController) {
  const current = controller.current().activityType;
  const types = controller.seenActivityTypes();
  if (types.length === 0) {
    vscode.window.showInformationMessage("No activity types seen yet.");
    return;
  }
  const items: (vscode.QuickPickItem & { value?: string })[] = [
    { label: "All types" },
    ...types.map((t) => ({ label: t, value: t, picked: t === current })),
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Filter by activity type" });
  if (!choice) return;
  await controller.update({ activityType: choice.value });
}

export async function pickTeam(controller: FilterController) {
  const teams = controller.teams();
  if (teams.length === 0) {
    vscode.window.showInformationMessage(
      "No teams available. Either your role lacks read:team or this org has no teams.",
    );
    return;
  }
  const current = controller.current().teamId;
  const items: (vscode.QuickPickItem & { id?: string })[] = [
    { label: "All teams" },
    ...teams.map((t) => ({ label: t.name, id: t.id, picked: t.id === current })),
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Filter by team" });
  if (!choice) return;
  await controller.update({ teamId: choice.id });
}

export async function pickOwner(controller: FilterController) {
  const members = controller.members();
  const sub = controller.currentUserSub();
  // Degraded picker when read:user is denied: just "Anyone" and "Me".
  if (members.length === 0) {
    const items: (vscode.QuickPickItem & { id?: string })[] = [
      { label: "Anyone" },
      ...(sub ? [{ label: "Me", id: sub }] : []),
    ];
    const choice = await vscode.window.showQuickPick(items, { placeHolder: "Filter by owner" });
    if (!choice) return;
    await controller.update({ ownerId: choice.id });
    return;
  }
  const current = controller.current().ownerId;
  const me = sub ? members.find((m) => m.id === sub) : undefined;
  const others = members.filter((m) => m.id !== sub);
  const items: (vscode.QuickPickItem & { id?: string })[] = [
    { label: "Anyone" },
    ...(me
      ? [{ label: `${memberDisplay(me)} (Me)`, id: me.id, picked: me.id === current }]
      : sub
        ? [{ label: "Me", id: sub, picked: sub === current }]
        : []),
    ...others.map((m) => ({ label: memberDisplay(m), id: m.id, picked: m.id === current })),
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Filter by owner" });
  if (!choice) return;
  await controller.update({ ownerId: choice.id });
}

export async function toggleSort(controller: FilterController) {
  const f = controller.current();
  await controller.update({ sort: f.sort === "newest" ? "oldest" : "newest" });
}

export async function pickStatus(controller: FilterController) {
  const current = controller.current().status;
  const items: (vscode.QuickPickItem & { value?: "approved" | "rejected" | "expired" })[] = STATUSES.map((s) => ({
    label: s.label,
    value: s.value,
    picked: s.value === current,
  }));
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Show status…" });
  if (!choice) return;
  await controller.update({ status: choice.value });
}

export async function pickDateRange(controller: FilterController) {
  const current = controller.current().dateRange ?? "all";
  const items: (vscode.QuickPickItem & { value?: DateRangeKey })[] = DATE_RANGES.map((d) => ({
    label: d.label,
    value: d.value,
    picked: d.value === current,
  }));
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Show approvals from…" });
  if (!choice) return;
  await controller.update({ dateRange: choice.value });
}

export function memberDisplay(m: Member): string {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  return full || m.username || m.email || m.id;
}

function teamName(controller: FilterController, id: string): string | undefined {
  return controller.teams().find((t) => t.id === id)?.name;
}

function ownerName(controller: FilterController, id: string): string | undefined {
  const sub = controller.currentUserSub();
  if (id === sub) return "Me";
  const m = controller.members().find((x) => x.id === id);
  return m ? memberDisplay(m) : undefined;
}
