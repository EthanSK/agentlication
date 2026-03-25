# Agentlication — Master Plan

## Vision

- AI agent overlay for any Electron app via CDP (Chrome DevTools Protocol)
- BYOS (Bring Your Own Subscription) — uses user's existing Claude Code or Codex CLI
- "Agentlication" = Agent + Application
- Domain: agentlication.ai (purchased)

## Architecture

- CDP to connect to Electron apps, read DOM + app state, execute JS
- Accessibility API fallback for native apps (limited: click/type only)
- Floating chat panel overlaid on target app (draggable, pop-out to separate window)
- Small routing agent triages every query to appropriate sub-agents (small/medium/large models)
- Dev server mode for hot module replacement of agent-written UIs
- User custom UIs stored as separate commits in branches
- Screenshots AND DOM snapshots for agent context
- Can read React/Vue/Angular component state, Redux stores, localStorage, etc.

## Agent Capabilities

- Read full app state (not just DOM — JS variables, stores, etc.)
- Write and inject custom UI on the fly
- Click buttons, fill forms, navigate
- Match existing app's design system from CSS variables
- Persist injected UI across reloads
- Voice input via Deepgram + ElevenLabs
- Configurable push-to-talk keyboard shortcut

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

- Marketplace of pre-made agentic apps OR paste-a-URL to agentify
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

## Technical Details

- `npx agentlication --app "Slack"` to agentify any app
- Relaunches app with `--remote-debugging-port`, connects via CDP
- For non-Electron: convert to Electron (agent-assisted) or use accessibility API
- Lightweight app pulls latest code, saves locally, applies custom UIs from branches, merges using agent

## Open Questions

- Local installer vs cloud build queue?
- Expose pipeline to users (agentify-anything) or keep as internal factory?
- How to handle merge conflicts when source repos update?
- Should custom UIs be in branches or worktrees?
- Dev server shipping — is it possible to ship an Electron app that runs `npm run dev`?
