# openbox-bugbot-app: design

Doc-only at this stage. Skeleton lands when the design below is
agreed; until then this README is the contract.

## Problem

Cursor's bugbot reviews PRs and posts review comments / suggestion
diffs as a GitHub user. Those comments are produced by an agent
running on Cursor infrastructure; local hooks see nothing, the
cloud-bridge can't help (bugbot doesn't post to a self-hostable
webhook today), and yet bugbot's review comments are policy-relevant
output: they can ship suggestions that conflict with the org's OpenBox
guardrails, mention internal endpoints, leak conventions, etc.

The repo's own CI / code review flow is the right place to govern
this; review comments are a GitHub-native surface, and GitHub Apps
are the only way to gate or annotate them programmatically.

## What it is

A GitHub App, scoped to repos / orgs the operator chooses, that
subscribes to `pull_request_review_comment` and `issue_comment` events.
For every comment posted by a bot the operator has classified as a
governed agent (bugbot, Cursor cloud agents emitting comments,
internal review bots), it:

1. Resolves the `agent_id` from the GitHub bot login → OpenBox agent
   mapping configured by the operator.
2. Fetches the comment body + the PR diff via the GitHub API.
3. Calls OpenBox's `check_governance` with a `pull_request_review`
   span shape (new shape; see "Span shape" below).
4. Annotates the comment based on the verdict:
   - `pass` → no-op.
   - `warn` → react with ⚠️ and post a thread reply linking to the
     OpenBox approval flow.
   - `halt` → post a thread reply tagging code-owners; optionally
     hide / minimize the original comment via the GraphQL
     `minimizeComment` mutation. Never deletes; operator audit
     trail matters more than UI cleanliness.

The app does not block merges directly; it surfaces verdicts to humans.
A separate `pull_request` check run can land later if operators want a
hard gate, but the first cut is annotation-only.

## Why a GitHub App and not a webhook

GitHub Apps handle:

- Per-installation tokens (no PATs, no rotation).
- Fine-grained repo selection.
- Webhook signing (HMAC) and replay protection out of the box.
- Permissions scoped to exactly `pull_requests:write`,
  `issues:write`, `contents:read`; auditable in the GitHub UI.

A raw webhook receiver (cloud-bridge) is the right fit for a single
trusted upstream. Multi-repo, multi-user, multi-installation is what
GitHub Apps exist for.

## Span shape

We want `pull_request_review` to flow through the same `check_governance`
contract every other span uses. Strawman:

```jsonc
{
  "agent_id": "agt_bugbot_<repo>",
  "span": {
    "kind": "pull_request_review",
    "attributes": {
      "github.repo": "OpenBox-AI/openbox-sdk",
      "github.pr_number": 1234,
      "github.commenter_login": "cursor-bugbot[bot]",
      "github.comment_id": 999,
      "github.comment_body": "...",
      "github.diff_hunks": ["..."]
    }
  }
}
```

The shape lives in `specs/typespec/govern/spans.tsp` (TODO; not yet
created). The bugbot-app and the SDK both read it from there; same
codegen path as the existing CursorEnvelope.

## Layout (proposed)

```
apps/bugbot-app/
  package.json
  README.md                 ← this file
  manifest.yml              ← GitHub App manifest (permissions, events)
  src/
    server.ts               ← Probot or raw @octokit/webhooks listener
    handler.ts              ← event → governance → annotate
    annotate.ts             ← GitHub API surface for reactions/replies
    mappings.ts             ← bot login → OpenBox agent_id
  test/
    fixtures/               ← canned bugbot review comments for test
    handler.test.ts
```

## Open questions

- Annotate-only vs. add a check-run. Default annotate-only for the
  first cut; check-run lands when an operator explicitly asks.
- Mapping store: env var, config file, or fetch from OpenBox? Probably
  config file in the repo + env override; OpenBox-side mapping is a
  bigger change.
- Re-emit OpenBox approvals for bugbot's halt verdicts so the human
  reviewer sees them in the OpenBox dashboard? Yes, same
  `decide_approval` UX as every other halt.

## Out of scope (initial cut)

- Editing bugbot's comment body. We annotate, we never rewrite.
- Spawning OpenBox approvals for every bugbot suggestion regardless
  of verdict. Approvals are for `halt` / `warn`; `pass` stays silent.
- Governing non-bot PR comments (humans). Different flow, different
  policy class.

## Status

Design doc only. Skeleton (`package.json`, `manifest.yml`, empty
`src/`) lands when this design is signed off.
