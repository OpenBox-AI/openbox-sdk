# Security Policy

## Supported Versions

Security fixes ship on the latest minor release. Older minors do not
receive backports.

## Reporting a Vulnerability

Report security issues privately via GitHub's
[Report a vulnerability](https://github.com/OpenBox-AI/openbox-sdk/security/advisories/new)
flow. Do not open a public issue.

What to include:

- A short description of the issue and its impact.
- Reproduction steps or a proof-of-concept against a recent release tag.
- Version and runtime details: `openbox-sdk` package version, git
  commit, Node version, OS, and target shell where you observed it.

We aim to acknowledge reports within 5 business days and to publish a
patched release within 30 days for confirmed vulnerabilities. Reports
that turn out to be misuse or non-vulnerabilities will be closed with
a brief note.

## Out of Scope

- Findings that require running an attacker-controlled build of the
  SDK.
- Issues in unrelated software the SDK happens to depend on. Report
  those upstream.
- Self-XSS or social-engineering scenarios that require the user to
  paste attacker-supplied code into a privileged shell.
