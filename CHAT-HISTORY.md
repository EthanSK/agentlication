# Agentlication — Chat History

## 2026-03-25 — MVP Scaffold

Scaffolded the full Electron + React + Vite + TypeScript monorepo structure:

- **Root**: npm workspaces with `apps/electron`, `apps/renderer`, `packages/contracts`
- **packages/contracts**: Shared types — `ProviderKind`, `AgentEvent`, `ChatMessage`, `TargetApp`, `CdpTarget`, IPC channel constants, model definitions
- **apps/electron**: Main process with `main.ts` (window management, IPC handlers), `agent-service.ts` (Claude/Codex provider abstraction via CLI spawning), `cdp-service.ts` (Chrome DevTools Protocol connection using chrome-remote-interface), `app-scanner.ts` (scans /Applications for Electron apps), `preload.ts` (contextBridge API)
- **apps/renderer**: React app with Vite — `AppPicker` (lists detected Electron apps, custom path input, Agentlicate button), `ChatPanel` (message timeline with streaming), `ChatComposer` (textarea with Enter to send, Shift+Enter newline), `ModelPicker` (Claude Sonnet/Opus, Codex GPT-5.4), `DomViewer` (optional DOM snapshot viewer), dark theme CSS
- Dev mode works: `npm run dev` starts Vite + Electron concurrently with wait-on
- All three packages compile clean: contracts, renderer (Vite build), electron (tsc)

## 2026-03-25 — Model Picker, CLI Integration, Hub Chat

Enhanced the app with working model picker, real CLI integration, and Hub chat:

- **Model Picker**: Replaced basic `<select>` with custom dropdown grouping models by provider (Claude: Sonnet 4.5, Opus 4.6; Codex: GPT-5.4, GPT-5.3). Shows green/red status dots based on CLI availability. Includes expandable provider status panel with install commands. Disables models whose CLI is not installed.
- **CLI Integration**: Claude provider now spawns `claude --print --output-format stream-json -m <model>` with proper stream-json event parsing (content_block_delta, message_stop, result). Codex provider spawns `codex --model <model> --quiet` with stdout streaming. Both check CLI availability via `execFileSync('which', ...)`. Error handling for missing CLI, auth issues, spawn failures.
- **Hub Chat**: Added a Setup Agent chat panel to the Hub screen (app picker). Togglable via floating button. Uses same ChatPanel component in "hub mode" (no CDP context, different system prompt). ChatPanel made reusable with optional targetApp, title, placeholder props.
- **Provider Status**: Banner on app picker showing each CLI's status. Inline in model picker dropdown. Full status in expandable panel.
- **Contracts**: Added MODEL_GROUPS, ProviderStatus/ProviderStatusMap types, PROVIDER_INSTALL_COMMANDS, cliName field on ProviderModel.

## 2026-03-25 — App Icons, T3 Code-style Model Picker

- **App Icons**: Extracted real macOS app icons using `sips` to convert `.icns` to PNG. Icons displayed in the app picker grid.
- **Model Picker Redesign**: Moved model picker to global header bar (T3 Code style) instead of per-chat. Cleaner dropdown with provider grouping.

## 2026-03-25 — Architecture Deep Dive: Terminology, App Profiles, Patches

Extended brainstorming session defining the full architecture:

- **Terminology established**: Hub, Companion, Target App, App Profile, Source Mirror, Patches, Harness, Setup Agent, Companion Agent. Each term has a precise meaning in the Agentlication system.
- **App Profile structure**: Each agentlicated app gets `~/.agentlication/apps/{app-name}/` with `profile.json`, `source/` (mirror), `patches/`, and `harness.md`.
- **Source Mirror concept**: When agentlicating, Agentlication checks for an open-source repo online, clones it version-matched to the installed binary. Gives the agent full source context without modifying the installed app.
- **Runtime patches (Greasemonkey model)**: Key decision — patches are injected at runtime via CDP, NOT applied as source code diffs. This means Agentlication works on closed-source apps too. Patch files have metadata headers (target app, version, author, description).
- **Hybrid patch format**: Raw JS by default for simplicity. Optional TSX with esbuild compile step for complex UI patches. Can piggyback on the target app's React instance if present.
- **User patch backup**: Patches automatically backed up to a private Git repo.
- **Floating chat panel**: Inspired by AI Music Video Studio — drag-to-dock on any window edge, resize, undock to separate window.
- **Model picker with thinking modes**: Like T3 Code's extended thinking toggle.
- **Hub Setup Agent**: The Hub screen has its own chat agent for onboarding and configuration.
- **Per-app harness.md**: Each Companion Agent gets a harness file with app-specific instructions and accumulated learnings.
- **ElevenLabs for speech output**: Added to voice capabilities alongside Deepgram for input.
- **Producer Player as test target**: Using Ethan's own app for development testing.

## 2026-03-25 — Fix Codex Duplicate Response Bug

Fixed a bug where Codex responses appeared twice in the chat. The Codex JSONL stream emits both `item.streaming_delta` events (incremental text chunks) and a final `item.completed` event (full text). Both were being forwarded as `agent:chunk` events to the renderer, causing the entire response to be duplicated. Added a `hasStreamedDeltas` flag in `CodexProvider.send()` to skip the redundant `item.completed` payload when streaming deltas have already been received. Also applied the same guard to the buffer-flush logic in the process close handler.

## 2026-03-26 — Rename "agentify" to "agentlicate" Throughout Codebase

Renamed all instances of "agentify"/"Agentify"/"agentified"/"Agentified"/"agentifying" to "agentlicate"/"Agentlicate"/"agentlicated"/"Agentlicated"/"agentlicating" across the entire codebase to align terminology with the "Agentlication" brand name. Changes spanned:

- **UI text**: Button labels ("Agentlicate"), subtitle ("Select an Electron app to agentlicate"), badge text ("Agentlicated")
- **Code**: Variable names (`agentlicatedApps`), function names (`handleAgentlicate`), API methods (`isAppAgentlicated`), CSS class names (`.agentlicate-btn`, `.agentlicated-badge`)
- **IPC channels**: `app:is-agentified` -> `app:is-agentlicated`, constant name `APP_IS_AGENTIFIED` -> `APP_IS_AGENTLICATED` (in contracts, preload, and main)
- **Prompt files**: Trigger value `on-agentify` -> `on-agentlicate` in frontmatter and documentation
- **Documentation**: IDEAS.md, AGENTS.md, CHAT-HISTORY.md updated with new terminology
- Did NOT change: app name "Agentlication", domain "agentlication.ai", package/repo names
