---
name: check-latest-models
description: Query provider CLIs and APIs for available models, then update the local model registry.
provider: any
model: small
thinking: low
trigger: periodic
timeout: 60
---

# Check Latest Models

## Context

The agent receives the path to the model registry file (JSON) used by the Agentlication
app to know which AI models are available for each provider.

Registry path: `packages/contracts/models.json` (create if missing).

## Instructions

1. For each supported provider, fetch the current list of available models:
   - **OpenAI** — Run `openai api models list` or call the `/v1/models` endpoint.
   - **Anthropic** — Check the Anthropic docs or API for current Claude model IDs.
   - **Google** — Run `gcloud ai models list` or query the Gemini API model list.
   - **Local / Ollama** — Run `ollama list` if Ollama is installed.

2. For each model found, extract:
   - `id` — the model identifier used in API calls (e.g. `claude-sonnet-4-20250514`)
   - `provider` — which provider it belongs to
   - `context_window` — max token context if known
   - `supports_thinking` — boolean, whether extended thinking is supported

3. Merge the results into the existing registry. Do not remove models that are
   already present but were not returned (they may be gated or temporarily unavailable).

4. Write the updated registry back to disk.

## Output

Updated `models.json` file with the following schema per entry:

```json
{
  "models": [
    {
      "id": "claude-sonnet-4-20250514",
      "provider": "anthropic",
      "context_window": 200000,
      "supports_thinking": true,
      "last_seen": "2026-03-25"
    }
  ]
}
```

## Notes

- If a CLI is not installed, skip that provider and log a warning — do not fail the whole prompt.
- Rate-limit API calls; this prompt may run on a schedule.
