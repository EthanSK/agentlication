# Agentlication — Chat History

## 2026-03-25 — MVP Scaffold

Scaffolded the full Electron + React + Vite + TypeScript monorepo structure:

- **Root**: npm workspaces with `apps/electron`, `apps/renderer`, `packages/contracts`
- **packages/contracts**: Shared types — `ProviderKind`, `AgentEvent`, `ChatMessage`, `TargetApp`, `CdpTarget`, IPC channel constants, model definitions
- **apps/electron**: Main process with `main.ts` (window management, IPC handlers), `agent-service.ts` (Claude/Codex provider abstraction via CLI spawning), `cdp-service.ts` (Chrome DevTools Protocol connection using chrome-remote-interface), `app-scanner.ts` (scans /Applications for Electron apps), `preload.ts` (contextBridge API)
- **apps/renderer**: React app with Vite — `AppPicker` (lists detected Electron apps, custom path input, Agentify button), `ChatPanel` (message timeline with streaming), `ChatComposer` (textarea with Enter to send, Shift+Enter newline), `ModelPicker` (Claude Sonnet/Opus, Codex GPT-5.4), `DomViewer` (optional DOM snapshot viewer), dark theme CSS
- Dev mode works: `npm run dev` starts Vite + Electron concurrently with wait-on
- All three packages compile clean: contracts, renderer (Vite build), electron (tsc)

## 2026-03-25 — Model Picker, CLI Integration, Hub Chat

Enhanced the app with working model picker, real CLI integration, and Hub chat:

- **Model Picker**: Replaced basic `<select>` with custom dropdown grouping models by provider (Claude: Sonnet 4.5, Opus 4.6; Codex: GPT-5.4, GPT-5.3). Shows green/red status dots based on CLI availability. Includes expandable provider status panel with install commands. Disables models whose CLI is not installed.
- **CLI Integration**: Claude provider now spawns `claude --print --output-format stream-json -m <model>` with proper stream-json event parsing (content_block_delta, message_stop, result). Codex provider spawns `codex --model <model> --quiet` with stdout streaming. Both check CLI availability via `execFileSync('which', ...)`. Error handling for missing CLI, auth issues, spawn failures.
- **Hub Chat**: Added a Setup Agent chat panel to the Hub screen (app picker). Togglable via floating button. Uses same ChatPanel component in "hub mode" (no CDP context, different system prompt). ChatPanel made reusable with optional targetApp, title, placeholder props.
- **Provider Status**: Banner on app picker showing each CLI's status. Inline in model picker dropdown. Full status in expandable panel.
- **Contracts**: Added MODEL_GROUPS, ProviderStatus/ProviderStatusMap types, PROVIDER_INSTALL_COMMANDS, cliName field on ProviderModel.
