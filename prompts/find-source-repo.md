---
name: find-source-repo
description: Given a desktop app name, search GitHub for its open-source repository.
provider: any
model: medium
thinking: medium
trigger: on-agentify
timeout: 90
---

# Find Source Repo

## Context

The agent receives the name (and optionally the bundle identifier) of a desktop
application that the user wants to agentify. The goal is to find the app's
open-source repository on GitHub so the agent can study its DOM structure, IPC
channels, or extension points.

Input:
- `app_name` — Display name of the app (e.g. "VS Code", "Obsidian", "Slack")
- `bundle_id` (optional) — macOS bundle identifier (e.g. `com.microsoft.VSCode`)

## Instructions

1. Search GitHub using the GitHub CLI or API:
   ```
   gh search repos "<app_name>" --sort stars --limit 10
   ```

2. If the bundle ID is provided, also search for it — some repos mention the
   bundle ID in their `package.json`, `Info.plist`, or build configs.

3. Filter candidates:
   - Prefer repos with >100 stars.
   - Prefer repos whose description or README mentions "Electron", "desktop app",
     or the app name.
   - Exclude forks unless the original is archived.

4. For the top candidate, fetch key metadata:
   - Repo URL
   - Default branch
   - Language breakdown
   - Whether it uses Electron (check `package.json` for `electron` dependency)
   - Last commit date (to confirm it is actively maintained)

5. If no strong match is found, return `null` with a reason.

## Output

```json
{
  "app_name": "VS Code",
  "repo_url": "https://github.com/microsoft/vscode",
  "default_branch": "main",
  "is_electron": true,
  "languages": { "TypeScript": 85, "JavaScript": 10, "CSS": 5 },
  "stars": 170000,
  "last_commit": "2026-03-24",
  "confidence": "high"
}
```

`confidence` is one of: `high`, `medium`, `low`, `none`.

## Notes

- Many popular Electron apps are closed-source (e.g. Slack, Discord). Return
  `confidence: "none"` in those cases rather than guessing.
- For apps with multiple forks or community builds, prefer the most-starred repo.
