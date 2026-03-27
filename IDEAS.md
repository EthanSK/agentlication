# Agentlication — Master Plan

## Vision

- AI agent overlay for any Electron app via CDP (Chrome DevTools Protocol)
- BYOS (Bring Your Own Subscription) — uses user's existing Claude Code or Codex CLI
- "Agentlication" = Agent + Application
- Domain: agentlication.ai (purchased)

## Terminology

- **Hub** — the main Agentlication window; lists installed apps, lets you agentlicate them, has its own Setup Agent chat
- **Companion** — the AI agent instance attached to a target app (each app gets its own Companion Agent)
- **Target App** — the Electron app being agentlicated
- **App Profile** — per-app config + source + patches stored at `~/.agentlication/apps/{app-name}/`
- **Source Mirror** — local clone of the target app's open-source repo, version-matched to the installed binary
- **Patches** — runtime JS/TSX snippets injected via CDP (not source code diffs); Greasemonkey-style
- **Harness** (`HARNESS.md`) — per-app instruction file for the Companion Agent with app-specific context and learnings
- **Setup Agent** — the Hub's own chat agent for initial configuration, onboarding, troubleshooting
- **Companion Agent** — the per-app chat agent that understands the target app's DOM, state, and harness

## Architecture

- CDP to connect to Electron apps, read DOM + app state, execute JS
- Accessibility API fallback for native apps (limited: click/type only)
- Floating chat panel overlaid on target app (draggable, pop-out to separate window)
- Small routing agent triages every query to appropriate sub-agents (small/medium/large models)
- Dev server mode for hot module replacement of agent-written UIs
- User custom UIs stored as separate commits in branches
- Screenshots AND DOM snapshots for agent context
- Can read React/Vue/Angular component state, Redux stores, localStorage, etc.

### App Profile Structure

```
~/.agentlication/apps/{app-name}/
  profile.json        # app metadata, version, CDP port, preferences
  source/             # source mirror — git clone of open-source repo, version-matched
  patches/            # user's runtime patches (JS/TSX files with metadata headers)
  HARNESS.md          # per-app agent instructions, accumulates learnings
```

### Source Mirror

- Auto-pulled when agentlicating an app for the first time
- Version-matched to the installed app binary (e.g., Slack 4.38 -> git tag v4.38)
- Agentlicate button checks for open-source repo online before cloning
- Gives the Companion Agent full source context without modifying the installed app
- Updated on app version change

### Runtime Patches (Greasemonkey Model)

- Patches are injected at runtime via CDP, NOT applied as source code diffs
- Works for both open-source AND closed-source Electron apps
- Patch file format includes metadata headers (target app, version, author, description)
- User patches backed up to a private Git repo automatically
- Hybrid format: raw JS by default, optional TSX with esbuild compile step
- Can piggyback on the target app's React instance if it has one (no duplicate React)
- Patches persist across reloads by re-injecting on CDP connect

### Floating Chat Panel

- Inspired by AI Music Video Studio's floating chat
- Drag-to-dock on any edge of the target app window
- Resize by dragging the edge
- Undock to a separate floating window
- Can be minimized to a small fab button

## Agent Capabilities

- Read full app state (not just DOM — JS variables, stores, etc.)
- Write and inject custom UI on the fly
- Click buttons, fill forms, navigate
- Match existing app's design system from CSS variables
- Persist injected UI across reloads
- Voice input via Deepgram, speech output via ElevenLabs
- Configurable push-to-talk keyboard shortcut

### Model Picker

- Grouped by provider (Claude, Codex, etc.)
- Shows green/red status dots based on CLI availability
- Thinking modes toggle (like T3 Code's extended thinking)
- Persists selection per-app in the App Profile

## Pipeline / Factory (Internal — Secret Sauce)

- Automated pipeline to fork open-source Electron apps, add agent harness, rebrand
- Cron job for weekly pulls from source repos
- Custom UI changes in separate branch, rebased on updates
- Agent fixes merge conflicts automatically
- Pipeline checks license compatibility (MIT, Apache, BSD — must allow redistribution)
- All forked apps set up as dev servers for HMR
- Floating chat panel as private npm package injected into every app
- Instruction markdown file that accumulates learnings about merging/modifying each project
- Pipeline itself stays PRIVATE — apps output is open source

## Product

- Marketplace of pre-made agentic apps OR paste-a-URL to agentlicate
- Voting page for app requests
- GitHub org to host all forked apps
- Direct download links for pre-built agentic versions
- Auto-updates via installer or within each app
- Could be local installer app OR cloud build queue OR both
- Installer app handles Git installation on Windows/Linux
- Free for users, BYOS for LLM costs
- Open source apps, closed source pipeline

## Business Model

- Open source (MIT/Apache) for the output apps
- Pipeline/factory is the moat — stays private
- Cloud build queue option: users request apps, global queue, donate button
- Domain: agentlication.ai (purchased)

## ToS / Legal

- Electron/CDP: no restrictions
- Most app ToS technically prohibit automation (standard boilerplate)
- Van Buren v. US (2021): using built-in features != unauthorized access
- Accessibility tool parallel: legally protected, functionally identical
- Low practical risk for personal use on most apps
- HIGH risk: Discord, WhatsApp (active enforcement) — avoid targeting these
- Recommendation: build openly, focus on productivity use

## Target Apps (Electron)

- VS Code, Slack, Notion, Figma, Spotify (CEF), Teams, Discord (avoid targeting), Bitwarden, Joplin, Logseq, Obsidian (closed), Hyper, Tabby, Insomnia, Signal, etc.
- Music: Splice is the biggest Electron music app
- No serious Electron DAWs exist — opportunity
- **Producer Player** — good test target for development (Ethan's own app)

## Technical Details

- `npx agentlication --app "Slack"` to agentlicate any app
- Relaunches app with `--remote-debugging-port`, connects via CDP
- For non-Electron: convert to Electron (agent-assisted) or use accessibility API
- Lightweight app pulls latest code, saves locally, applies custom UIs from branches, merges using agent

## Open Questions

- Local installer vs cloud build queue?
- Expose pipeline to users (agentlicate-anything) or keep as internal factory?
- How to handle merge conflicts when source repos update?
- Should custom UIs be in branches or worktrees?
- Dev server shipping — is it possible to ship an Electron app that runs `npm run dev`?
