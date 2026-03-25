# Agentlication — Agent Instructions

## On Every Message
- Commit and push changes after making modifications
- Update IDEAS.md with any new ideas discussed
- Append conversation summary to CHAT-HISTORY.md (strip sensitive info: passwords, API keys, tokens, personal addresses)
- Always push after committing
- After every UI change, send a screenshot of just the app window (not full screen) to Ethan via Telegram

## Project Info
- Repo: https://github.com/EthanSK/agentlication
- Domain: agentlication.ai
- Local path: /Users/ethansk/Projects/agentlication

## Key Files
- IDEAS.md — brain dump, product ideas, brainstorming (separate from this file)
- CHAT-HISTORY.md — sanitized conversation history showing how this app was built
- CLAUDE.md — symlink to this file (AGENTS.md)
- `prompts/` — standardized prompt/instruction files (see below)

## Prompt File Architecture

Agentlication uses a standardized format for agent prompt files. These live in
`/prompts/` and define discrete tasks that agents can execute.

### Format

Every prompt file is a Markdown file with YAML frontmatter:

```yaml
---
name: <prompt-name>            # kebab-case identifier
description: <what it does>    # one-line summary
provider: claude | codex | any # which AI provider(s) can run this
model: small | medium | large  # model size class needed
thinking: low | medium | high  # extended thinking budget
trigger: manual | on-scan | on-agentify | periodic | on-install
timeout: <seconds>             # max execution time
---
```

The body uses four standard sections:
- **Context** — what inputs/data the agent receives
- **Instructions** — step-by-step imperatives for what to do
- **Output** — the expected output format (usually a JSON schema)
- **Notes** — optional edge cases and tips

### Template

See `prompts/TEMPLATE.md` for the canonical template. Copy it when creating new prompts.

### Existing Prompts

| File | Trigger | Description |
|------|---------|-------------|
| `check-latest-models.md` | periodic | Query provider CLIs/APIs for available models |
| `find-source-repo.md` | on-agentify | Search GitHub for an app's open-source repo |
| `scan-electron-apps.md` | on-scan | Discover installed Electron apps and their metadata |

### Execution

Prompts are executed by the Agentlication runtime. The runtime:
1. Reads the frontmatter to select the appropriate provider, model, and timeout.
2. Injects the **Context** section with runtime data (file paths, user input, etc.).
3. Sends the **Instructions** to the agent.
4. Validates the response against the **Output** schema.

The `trigger` field determines when a prompt runs:
- `manual` — user explicitly invokes it
- `on-scan` — runs during system scanning
- `on-agentify` — runs when the user agentifies an app
- `periodic` — runs on a schedule (e.g. model registry refresh)
- `on-install` — runs once when Agentlication is first set up

### Adding New Prompts

1. Copy `prompts/TEMPLATE.md` to `prompts/<your-prompt-name>.md`
2. Fill in the frontmatter and all sections
3. Add an entry to the table above in this file
4. Test the prompt manually before setting a non-manual trigger
