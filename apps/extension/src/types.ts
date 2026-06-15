// Re-export canonical types from the SDK so the extension and every
// other consumer share one shape per entity. Spec-generated; regenerate
// with `npm run generate:types` at the SDK root.
//
// `OrgApprovalsData` is purely a client-side response wrapper, kept
// here because the live backend doesn't yet annotate the org-approvals
// endpoint shape and we don't want a divergent SDK type just to cover
// one extension-only call site.
export type { Approval, UserProfile, Agent, Member, Team } from "@openbox-ai/openbox-sdk/types";

import type { Approval } from "@openbox-ai/openbox-sdk/types";

export interface OrgApprovalsData {
  approvals: {
    data: Approval[];
  };
}
