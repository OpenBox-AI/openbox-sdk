// Re-export canonical types from the SDK so the extension and every
// other consumer share one shape per entity. Spec-generated; regenerate
// with `npm run generate:types` at the SDK root.
//
// `OrgApprovalsData` is purely a client-side response wrapper, kept
// here because the live backend doesn't yet annotate the org-approvals
// endpoint shape and we don't want a divergent SDK type just to cover
// one extension-only call site.
export type { UserProfile, Agent, Member, Team } from "@openbox-ai/openbox-sdk/types";

import type { Approval as SdkApproval } from "@openbox-ai/openbox-sdk/types";

// Drop the generated `{ [key: string]: unknown }` catch-all so we can
// override a single named field. A plain `Omit` over an index-signature
// type collapses every named property to `unknown`; stripping the index
// signature first keeps `status`, `verdict`, `metadata`, … intact.
type RemoveIndexSignature<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K];
};

// The spec-generated `Approval.input` collapses to a bare `{ [k]: unknown }`
// map, but the Core server array-wraps activity inputs (`[{ command, cwd }]`,
// `[{ file_path }]`, …) as the field's own JSDoc documents, while still
// accepting a legacy bare object. Re-widen it to the real shape here so
// extension call sites can build and read the array form without casting.
// The catch-all index signature is preserved for forward-compatible fields.
// The proper fix lives in the type codegen, not this consumer package.
export type Approval = Omit<RemoveIndexSignature<SdkApproval>, "input"> & {
  input?: Array<{ [key: string]: unknown }> | { [key: string]: unknown };
} & { [key: string]: unknown };

export interface OrgApprovalsData {
  approvals: {
    data: Approval[];
  };
}
