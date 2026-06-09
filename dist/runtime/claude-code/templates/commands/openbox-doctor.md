---
name: openbox-doctor
description: Verify the installed OpenBox Claude Code plugin and runtime readiness through MCP.
---

# OpenBox doctor

Use the OpenBox MCP tool first:

```
claude_code_doctor
```

This verifies the installed Claude Code/OpenBox plugin surfaces and
runtime readiness without asking Claude Code to run a shell command.
It reads the same OpenBox config source as the hooks and MCP server.

## Output rules

Report what `claude_code_doctor` returned. Do NOT extrapolate and do
NOT suggest extra remediation that doctor did not return.

- Lead with the bottom-line counts: `Pass: <n>, Fail: <n>`.
- For each fail row, print the check name and detail.
- If no rows failed, say `OpenBox Claude Code plugin: ready`.

Do not fall back to shell unless the user explicitly asks you to.
