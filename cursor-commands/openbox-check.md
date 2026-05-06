---
name: openbox-check
description: Evaluate a hypothetical agent action against OPA without executing it.
---

# Dry-run governance check

Ask the user (in one sentence) which agent + which action they
want to evaluate. Then call:

```
openbox core evaluate \
  --agent-id <agentId> \
  --activity-type <ShellExecution|FileWrite|FileRead|...> \
  --command "<the command or path>"
```

Report the verdict (`allow` / `require_approval` / `deny` /
`block`) and the matched rule id. If `require_approval`, mention
they can decide via `/openbox-pending` once it surfaces.
