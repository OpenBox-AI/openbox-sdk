# OpenBox Skill

A skill for any LLM tool that uses Claude's Skill format. It helps an
agent build and integrate with the [OpenBox AI governance
platform](https://openbox.ai). The skill loads into the agent's
working context when the user mentions OpenBox or any of the trigger
keywords in `SKILL.md`.

## Install, update, uninstall

The skill ships inside `openbox-sdk`. Install the SDK once with
`npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk`, then:

```bash
openbox install skill            # writes to ~/.claude/skills/openbox/ and ~/.cursor/skills/openbox/
```

Re-run `openbox install skill` to update. The command overwrites the
target directories with the content shipped in the installed
`openbox-sdk` version.

To uninstall, run `rm -rf ~/.claude/skills/openbox`. For Cursor, the
path is `~/.cursor/skills/openbox`.

## Layout

- `SKILL.md`: main entry. The agent loads this first.
- `references/`: domain-specific deep dives, loaded on demand. Covers
  governance flow, guardrails, behaviors, Rego policies, span
  attributes, CLI commands, integration paths, backend conventions,
  and the validation checklist.
- `evals/`: scoring fixtures used to grade the skill's output against
  canonical answers.

The source of truth lives at `skill/` in the
[`openbox-sdk` repo](https://github.com/OpenBox-AI/openbox-sdk).
