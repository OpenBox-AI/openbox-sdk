# OpenBox Skill

Skill for building and integrating with the OpenBox AI governance platform.

## Install (Claude Code)

```bash
openbox skill install
```

## Install (Cursor)

```bash
openbox skill install --cursor
```

Or if already installed for Claude Code:

```bash
ln -s ~/.claude/skills/openbox ~/.cursor/skills/openbox
```

## Update

```bash
cd ~/.claude/skills/openbox && git pull
```

## Uninstall

```bash
rm -rf ~/.claude/skills/openbox ~/.cursor/skills/openbox
```
