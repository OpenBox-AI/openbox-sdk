---
name: openbox-doctor
description: Run the OpenBox Cursor doctor through MCP and report what it found.
---

# OpenBox doctor

Use the OpenBox MCP tool first:

```
cursor_doctor
```

This verifies the installed Cursor/OpenBox surfaces and runtime
readiness without asking Cursor chat to run a shell command. It reads
the same `~/.openbox/config` env source as the extension and MCP server.

## Output rules

Report what `cursor_doctor` returned. Do NOT extrapolate, do NOT
suggest extra remediation that doctor didn't tell the user about.

- Lead with the bottom-line counts: `Pass: <n>, Warn: <n>, Fail: <n>`.
- For each warn/fail row, print the check name + the `run: ...`
  remediation hint that doctor itself emitted on that line.
  If the row has no remediation hint, just say so - don't invent one.
- Strip any deployment/profile prefix from check labels. The user
  has one configured stack; report the failing URL/key/check without
  inventing alternate targets.

## Do not do

- Don't mention target aliases or environment names in your output.
- Don't add helpful-sounding next steps that doctor didn't print.
- Don't run doctor more than once.
- Do not fall back to shell unless the user explicitly asks you to.
