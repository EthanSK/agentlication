# Agentlication — Agent Instructions

## On Every Message
- Commit and push changes after making modifications
- Update IDEAS.md with any new ideas discussed
- Append conversation summary to CHAT-HISTORY.md (strip sensitive info: passwords, API keys, tokens, personal addresses)
- Always push after committing
- After every UI change, send a screenshot of just the app window (not full screen) to Ethan via Telegram
- NEVER use Playwright browser view for screenshots — always use native macOS screencapture on the actual Electron window
- The app should always be tested and screenshotted as a real Electron app, not via localhost in a browser

## Project Info
- Repo: https://github.com/EthanSK/agentlication
- Domain: agentlication.ai
- Local path: /Users/ethansk/Projects/agentlication

## Key Files
- IDEAS.md — brain dump, product ideas, brainstorming (separate from this file)
- CHAT-HISTORY.md — sanitized conversation history showing how this app was built
- CLAUDE.md — symlink to this file (AGENTS.md)
- `prompts/` — standardized prompt/instruction files (see below)

## Subagent Verification Pattern

Every subagent that makes UI changes MUST verify its work visually before reporting success. This is a screenshot-verify-fix loop that ensures no broken UI gets committed.

### Step 1: Find the Electron window ID

Run this Swift snippet to get the window ID for the Agentlication Electron window:

```bash
WINDOW_ID=$(swift -e '
import CoreGraphics
let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for w in windows {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    let title = w[kCGWindowName as String] as? String ?? ""
    let wid = w[kCGWindowNumber as String] as? Int ?? 0
    let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] as? Int ?? 0
    let height = bounds["Height"] as? Int ?? 0
    if (owner == "Electron" || owner == "Agentlication") && width > 100 && height > 100 {
        print(wid)
        break
    }
}
' 2>/dev/null)
```

If the app is not running yet, start it first with `cd /Users/ethansk/Projects/agentlication && npm run dev &` and wait a few seconds for the window to appear.

### Step 2: Take a screenshot

```bash
screencapture -l "$WINDOW_ID" -o /tmp/agentlication-verify.png
```

The `-o` flag excludes the window shadow for a cleaner image.

### Step 3: Verify the screenshot

Read the screenshot file using the Read tool (it supports images). Check that:
- The UI change you made is visible
- Nothing is visually broken (layout issues, missing elements, overlapping text, blank areas)
- The change matches what was requested

### Step 4: Fix-and-retry loop

If the screenshot does NOT look correct:
1. Identify what is wrong from the screenshot
2. Fix the code
3. Wait for hot-reload to apply (1-2 seconds for Vite HMR)
4. Go back to Step 1 and take a new screenshot
5. Repeat up to **3 attempts**

### Step 5: Escalate if stuck

If after 3 fix attempts the UI still does not look right:
1. Take a final screenshot
2. Send it to Ethan via Telegram with a message explaining:
   - What you were trying to achieve
   - What the screenshot shows instead
   - What you tried to fix it
3. Do NOT commit broken UI — leave it uncommitted so Ethan can intervene

### Step 6: Success

Once the screenshot confirms the UI is correct:
1. Send the screenshot to Ethan via Telegram
2. Commit and push the changes
3. Report success

### Important rules
- NEVER use Playwright/browser screenshots — always use native `screencapture -l` on the real Electron window
- NEVER skip verification — every UI change must be screenshotted and checked
- NEVER commit UI changes without a passing screenshot verification
- The app must be running as a real Electron app, not viewed via localhost in a browser

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
