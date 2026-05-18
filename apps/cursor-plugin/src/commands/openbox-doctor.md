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
- **Strip every environment prefix** from check labels. If doctor
  prints `local api-key missing`, just write `api-key missing`.
  If doctor prints `staging core /health failed`, write
  `core /health failed`. The environment is an internal detail
  the user does not care about.
- Do NOT say things like "set API keys for production and staging".
  The user has one configured stack; whatever env doctor chose is
  the one they're on. Don't recommend touching others.

## Do not do

- Don't mention env names (production / staging / local) in your output.
- Don't add helpful-sounding next steps that doctor didn't print.
- Don't run doctor more than once.
- Do not fall back to shell unless the user explicitly asks you to.
