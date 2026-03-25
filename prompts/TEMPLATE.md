---
name: <prompt-name>
description: <one-line summary of what this prompt does>
provider: claude | codex | any
model: small | medium | large
thinking: low | medium | high
trigger: manual | on-scan | on-agentify | periodic | on-install
timeout: 120
---

# <Prompt Title>

## Context

What context the agent receives before executing this prompt. This may include:
- File paths or directories to read
- Environment variables or config values
- Output from previous prompts in a chain
- User-provided input

## Instructions

Step-by-step instructions for what the agent should do. Write these as imperative
commands, not descriptions. Be specific about:
- What tools to use (file search, web search, shell commands, etc.)
- What order to perform operations
- How to handle errors or missing data
- When to stop

## Output

The expected output format. Define the structure so downstream consumers (other
prompts, the app, or the user) can rely on it.

```json
{
  "example": "Use a concrete schema when the output is structured data"
}
```

## Notes

Optional section for edge cases, known limitations, or tips for prompt authors.
