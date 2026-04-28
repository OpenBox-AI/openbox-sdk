# OpenBox Skill

A skill for any LLM tool that uses Claude's Skill format - builds and
integrates with the [OpenBox AI governance platform](https://openbox.ai).
Loaded into the LLM's working context when the user mentions OpenBox or
any of the trigger keywords in `SKILL.md`.

## Install / update / uninstall

The skill ships inside `openbox-sdk`. Install the SDK once
(`npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk`), then:

```bash
openbox skill install            # → ~/.claude/skills/openbox/
openbox skill install --cursor   # → ~/.cursor/skills/openbox/
```

Re-run `openbox skill install` to update - the command overwrites the
target directory with the latest content shipped in the installed
`openbox-sdk` version.

To uninstall: `rm -rf ~/.claude/skills/openbox` (or
`~/.cursor/skills/openbox`).

## Layout

- `SKILL.md` - main entry, the agent loads this first
- `references/` - domain-specific deep dives, loaded on demand
  (governance flow, guardrails, behaviors, Rego policies, span attributes,
  CLI commands, integration paths, backend conventions, validation
  checklist)
- `evals/` - scoring fixtures used by the OpenBox team to grade the
  skill's output against canonical answers

The source of truth lives at `skill/` in the
[`openbox-sdk` repo](https://github.com/OpenBox-AI/openbox-sdk).
