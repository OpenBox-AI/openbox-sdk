---
name: openbox-doctor
description: Run `openbox doctor` and report what it found. Stable command, no flags needed.
---

# OpenBox doctor

Run the shell command exactly:

```
openbox doctor
```

Then report what doctor itself printed. Do NOT extrapolate, do NOT
suggest extra remediation that doctor didn't tell the user about.

## Output rules

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

- Don't mention env names (production / staging / local).
- Don't add helpful-sounding next steps that doctor didn't print.
- Don't run doctor more than once.

If `openbox` isn't on PATH, tell the user to install via
`curl -fsSL https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh`
and stop.
