export interface UserProfile {
  orgId?: string;
  email?: string;
  preferred_username?: string;
  sub?: string;
}

export interface Approval {
  id: string;
  agent_id?: string;
  activity_type?: string;
  verdict?: number;
  reason?: string;
  created_at?: string;
  approval_expired_at?: string;
  metadata?: {
    trust_tier?: number;
  };
  agent?: {
    agent_name: string;
  };
}

export interface OrgApprovalsData {
  approvals: {
    data: Approval[];
  };
}
