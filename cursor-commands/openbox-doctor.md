---
name: openbox-doctor
description: Run `openbox doctor` and report install + reachability status across all envs.
---

# OpenBox doctor

Run the shell command `openbox doctor` (or `openbox --env <env> doctor`
if the user named an env) and report the table of pass / warn / fail
checks to the user. Highlight any failures with the suggested
remediation the doctor printed (the `run: ...` hints).

If the user asked about a specific env, run with `--env <env>`. If
they didn't, run all three (`production`, `staging`, `local`) one by
one and consolidate the results.

If `openbox` isn't on PATH, tell the user to install via
`curl -fsSL https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh`
and stop.
