---
name: openbox-status
description: One-line OpenBox health snapshot.
---

# OpenBox status

Run `openbox doctor` and print a single line:

- All checks pass: `OpenBox: healthy`
- Some warnings, no failures: `OpenBox: <N> warning(s); run /openbox-doctor for details`
- Any failures: `OpenBox: <N> issue(s); run /openbox-doctor for details`

Do NOT mention environment names. Do NOT print the full doctor
table; that's what `/openbox-doctor` is for. If `openbox` isn't
on PATH, tell the user how to install (see `/openbox-doctor`).
