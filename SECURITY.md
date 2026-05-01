# Security Policy

## Supported Versions

Security fixes ship on the latest minor release. Older minors do not
receive backports.

## Reporting a Vulnerability

Please report security issues privately via GitHub's
"[Report a vulnerability](https://github.com/OpenBox-AI/openbox-sdk/security/advisories/new)"
flow rather than opening a public issue.

What to include:

- A short description of the issue and its impact.
- Reproduction steps or a proof-of-concept against a recent release tag.
- The version (`openbox-sdk` package version + git commit) and runtime
  (Node, OS, target shell) you observed it on.

We aim to acknowledge reports within 5 business days and to publish a
patched release within 30 days for confirmed vulnerabilities. Reports
that turn out to be misuse or non-vulnerabilities will be closed with
a brief note.

## Out of Scope

- Findings that require running an attacker-controlled build of the SDK.
- Issues in unrelated software the SDK happens to depend on (please
  report those upstream).
- Self-XSS / social-engineering scenarios that require the user to paste
  attacker-supplied code into a privileged shell.
