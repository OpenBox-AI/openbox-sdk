// Stand-in for OpenBoxClient when openbox.mockAuth is on. Implements
// only the methods the extension calls (getProfile, getOrgApprovals,
// decideApproval, getAgent, listTeams, listMembers); response shapes
// match the wire shape closely enough that downstream code (Polling,
// ViewSession, FilterCommands) doesn't have to branch.
//
// Filters in getOrgApprovals are honored client-side here (search,
// tier, activity_type, team_id, fromTime/toTime) so the QuickPicks +
// search box behave the same way against mock data as they do against
// the real backend.

import type { Approval } from "./types";
import { mockStore } from "./mockStore";

interface OrgApprovalsQuery {
  status?: "pending" | "approved" | "rejected" | "expired";
  page?: number;
  perPage?: number;
  search?: string;
  tiers?: string[];
  activity_types?: string[];
  team_ids?: string[];
  fromTime?: string;
  toTime?: string;
}

export class MockClient {
  async getProfile(): Promise<any> {
    return mockStore().profile();
  }

  async getOrgApprovals(
    _orgId: string,
    query: OrgApprovalsQuery = {},
  ): Promise<{ approvals: { data: Approval[] }; metrics?: any }> {
    let rows = mockStore().list(query.status);

    if (query.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter((a) =>
        (a.agent?.agent_name || "").toLowerCase().includes(q) ||
        (a.reason || "").toLowerCase().includes(q),
      );
    }
    if (query.tiers && query.tiers.length > 0) {
      const tiers = query.tiers.map((t) => Number(t));
      rows = rows.filter((a) => tiers.includes(a.metadata?.trust_tier as number));
    }
    if (query.activity_types && query.activity_types.length > 0) {
      const types = new Set(query.activity_types);
      rows = rows.filter((a) => types.has((a.action_type || a.activity_type) as string));
    }
    if (query.team_ids && query.team_ids.length > 0) {
      const teams = new Set(query.team_ids);
      const agents = mockStore().agents();
      rows = rows.filter((a) => {
        const agent = a.agent_id ? agents[a.agent_id] : undefined;
        return agent?.teams?.some((t) => teams.has(t.id));
      });
    }
    if (query.fromTime) {
      const from = Date.parse(query.fromTime);
      rows = rows.filter((a) => Date.parse(a.created_at || "") >= from);
    }
    if (query.toTime) {
      const to = Date.parse(query.toTime);
      rows = rows.filter((a) => Date.parse(a.created_at || "") <= to);
    }

    const page = query.page ?? 0;
    const perPage = query.perPage ?? 50;
    const start = page * perPage;
    return { approvals: { data: rows.slice(start, start + perPage) } };
  }

  async decideApproval(
    _agentId: string,
    eventId: string,
    body: { action: "approve" | "reject" },
  ): Promise<any> {
    mockStore().decide(eventId, body.action);
    return { ok: true };
  }

  async getAgent(agentId: string): Promise<any> {
    const agents = mockStore().agents();
    const a = agents[agentId];
    if (!a) return null;
    return {
      id: agentId,
      agent_name: a.agent_name,
      owner_id: a.owner_id,
      teams: a.teams,
    };
  }

  async listTeams(_orgId: string, _query?: any): Promise<any> {
    return { data: mockStore().teams() };
  }

  async listMembers(_orgId: string, _query?: any): Promise<any> {
    return { members: mockStore().members() };
  }
}
