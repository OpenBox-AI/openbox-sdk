# OpenBox Skill

A skill for any LLM tool that uses Claude's Skill format. It helps an
agent build and integrate with the [OpenBox AI governance
platform](https://openbox.ai). The skill loads into the agent's
working context when the user mentions OpenBox or any of the trigger
keywords in `SKILL.md`.

## Install, update, uninstall

The skill ships inside the project-local Cursor and Claude Code plugin
assets exported by `openbox-sdk`:

```bash
openbox install claude-code      # writes <project>/.claude/skills/openbox/
openbox install cursor           # writes <project>/.cursor/plugins/local/openbox/
```

Re-run the project-local install command to update the bundled skill
content from the installed `openbox-sdk` version.

To uninstall, run `openbox uninstall claude-code --cwd <project>` or
`openbox uninstall cursor --cwd <project>`.

## Layout

- `SKILL.md`: main entry. The agent loads this first.
- `references/`: domain-specific deep dives, loaded on demand. The
  current command and SDK references are intentionally compact and
  API-first.
- `evals/`: scoring fixtures used to grade the skill's output against
  canonical answers.

The source of truth lives at `skill/` in the
[`openbox-sdk` repo](https://github.com/OpenBox-AI/openbox-sdk).
