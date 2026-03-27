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
- **App Profile structure**: Each agentlicated app gets `~/.agentlication/apps/{app-name}/` with `profile.json`, `source/` (mirror), `patches/`, and `HARNESS.md`.
- **Source Mirror concept**: When agentlicating, Agentlication checks for an open-source repo online, clones it version-matched to the installed binary. Gives the agent full source context without modifying the installed app.
- **Runtime patches (Greasemonkey model)**: Key decision — patches are injected at runtime via CDP, NOT applied as source code diffs. This means Agentlication works on closed-source apps too. Patch files have metadata headers (target app, version, author, description).
- **Hybrid patch format**: Raw JS by default for simplicity. Optional TSX with esbuild compile step for complex UI patches. Can piggyback on the target app's React instance if present.
- **User patch backup**: Patches automatically backed up to a private Git repo.
- **Floating chat panel**: Inspired by AI Music Video Studio — drag-to-dock on any window edge, resize, undock to separate window.
- **Model picker with thinking modes**: Like T3 Code's extended thinking toggle.
- **Hub Setup Agent**: The Hub screen has its own chat agent for onboarding and configuration.
- **Per-app HARNESS.md**: Each Companion Agent gets a harness file with app-specific instructions and accumulated learnings.
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

## 2026-03-26 — Fix Stale Build Artifacts After Rename

Fixed `TypeError: window.agentlication.isAppAgentlicated is not a function` caused by stale compiled JavaScript in `apps/electron/dist/`. The previous rename commit updated all TypeScript source files but did not rebuild the electron dist. Since Electron loads the compiled `dist/preload.js` (not the `.ts` source), the runtime was still exposing the old `isAppAgentified` method name while the renderer was calling the new `isAppAgentlicated`. Fix: rebuilt electron TypeScript (`npm run build:electron`) to regenerate dist files with the correct names.

## 2026-03-27 — Context Reload, Rename Wrap-up, Next Steps Discussion

Resumed Agentlication development by reloading full project context from prior sessions:

- **Session context reload**: Used session-reader subagent to load the complete Agentlication context (architecture, terminology, codebase state, prior decisions) from past conversations so work could continue seamlessly.
- **Rename cleanup finalized**: Confirmed the "agentify" to "agentlicate" rename across all 12 affected files (source, prompts, docs) was complete and consistent. Verified the preload bridge bug from the previous session (stale `dist/preload.js` with old `isAppAgentified` name) was resolved after rebuilding with `tsc`.
- **Next steps outlined**: Discussed the roadmap for the next development phase:
  1. **App profile creation flow** — when user clicks "Agentlicate" on an app, create the `~/.agentlication/apps/{app-name}/` directory structure with `profile.json`, `HARNESS.md`, empty `source/` and `patches/` dirs.
  2. **CDP connection** — relaunch the target app with `--remote-debugging-port`, connect via chrome-remote-interface, verify DOM access.
  3. **Companion Agent** — attach the per-app chat agent with harness context, enabling the agent to read/manipulate the target app.
- **App profile components explained**: Defined the four components that make up an App Profile:
  - `profile.json` — app metadata (name, version, path, CDP port, preferences)
  - `HARNESS.md` — agent instruction file with app-specific context and accumulated learnings
  - `source/` — source mirror (git clone of open-source repo, version-matched to installed binary)
  - `patches/` — runtime JS snippets injected via CDP at launch (Greasemonkey-style, not source diffs)

## 2026-03-27 — App Profile Creation Flow

Implemented the full app profile creation flow that runs when the user clicks "Agentlicate" on an app:

- **New IPC channel**: Added `APP_CREATE_PROFILE` (`app:create-profile`) to contracts, preload, and main process. Accepts `{ name, path }` and returns `{ success, profile?, error? }`.
- **AppProfile type**: Added `AppProfile` interface to contracts with fields: name, slug, bundleId, appPath, installedVersion, cdpPort, sourceRepoUrl, dateAgentlicated.
- **Profile creation logic** (main.ts):
  - Slugifies the app name (lowercase, hyphens, trimmed) for the directory name
  - Creates `~/.agentlication/apps/{slug}/` with `profile.json`, `HARNESS.md`, `source/`, `patches/`
  - Reads bundle ID and version from macOS Info.plist via `defaults read`
  - Auto-assigns CDP ports starting from 9222, incrementing by scanning existing profiles
  - Returns existing profile if already created (idempotent)
- **Updated isAppAgentlicated**: Now uses slugified name and checks for `profile.json` existence (not just directory existence).
- **UI flow** (AppPicker.tsx):
  - "Agentlicate" button first creates the profile (shows "Creating profile..." loading state), then launches the app and connects CDP
  - After profile creation, the app immediately shows the green "Agentlicated" badge
  - Button text changes to "Reconnect" for already-agentlicated apps
- **Tested**: Successfully agentlicated Producer Player — profile created at `~/.agentlication/apps/producer-player/` with correct metadata (bundleId: com.ethansk.producerplayer, version: 1.1.6, cdpPort: 9222).

## 2026-03-26 — CDP Connection Flow (Step 2)

Implemented the full CDP connection flow — when clicking "Reconnect" on an agentlicated app, the system kills, relaunches with CDP debugging enabled, connects, and reads page info:

- **CdpService rewrite** (`apps/electron/src/cdp-service.ts`):
  - `connect(appPath, cdpPort)` now handles the full flow: kill running instance, relaunch with `--remote-debugging-port`, poll `/json/version` until CDP is ready, connect via chrome-remote-interface, pick the main page target
  - `disconnect()` cleanly closes the CDP session
  - `isConnected()` check for active connection status
  - `getPageInfo()` gathers title, URL, detected framework (React/Vue/Angular via devtools hooks and DOM markers), localStorage keys, and brief DOM structure summary — all in a single `Runtime.evaluate` call
  - `killApp()` uses `execFileSync("pkill")` and `osascript` quit for graceful shutdown (safe against command injection)
  - `launchWithCdp()` uses `spawn("open", ["-a", appPath, "--args", ...])` for macOS .app bundles
  - `waitForCdp()` polls `http://localhost:<port>/json/version` with 500ms intervals, up to 15s timeout
- **New IPC channels**:
  - `CDP_DISCONNECT` (`cdp:disconnect`) — disconnect from target
  - `CDP_GET_INFO` (`cdp:get-info`) — get page info (title, URL, framework, localStorage keys, DOM structure)
  - `APP_GET_PROFILE` (`app:get-profile`) — retrieve an app's profile by name (needed to get cdpPort for reconnection)
- **Contracts updated**: Added `CdpPageInfo` interface (title, url, framework, localStorageKeys, documentStructure), `CdpConnectionStatus` type, new IPC constants
- **Preload updated**: Added `cdpDisconnect()`, `cdpGetInfo()`, `getAppProfile()` to the exposed API; `cdpConnect()` now takes `(appPath, cdpPort)` instead of just `(port)`
- **AppPicker UI updates**:
  - Connection status dot next to app name (green=connected, yellow+pulse=connecting, red=error)
  - CDP info row showing page title, detected framework badge, and URL when connected
  - Button text shows "Connecting..." during the connect flow
  - Fetches app profile to get cdpPort before connecting
- **CSS**: New styles for `.cdp-status-dot`, `.cdp-info`, `.cdp-info-badge`, `.cdp-info-url` with animations

## 2026-03-26 — Reconnect Confirmation Dialog

Added a confirmation dialog when the user clicks "Reconnect" on an agentlicated app and the target app is already running:

- **isAppRunning helper** (main.ts): Uses `pgrep -f` via `execFileSync` to check if the target app process is currently running. Extracts the app name from the `.app` path and matches against running processes.
- **Confirmation dialog** (main.ts): In the `CDP_CONNECT` IPC handler, before proceeding with the kill-relaunch-connect flow, checks if the target app is running. If so, shows an Electron `dialog.showMessageBox` with "Quit & Restart" and "Cancel" buttons, explaining that the app will be relaunched with CDP enabled. If the user cancels, returns early with `{ success: false, error: "User cancelled restart" }` without touching the target app.
- **Imports**: Added `dialog` to the Electron imports in main.ts.

## 2026-03-26 — Companion Agent Floating Window

Implemented the Companion Agent floating window that opens when connecting to a target app:

- **Companion BrowserWindow** (main.ts): Created `openCompanionWindow(appName)` that opens a separate floating panel (macOS NSPanel via `type: "panel"`) with `alwaysOnTop: true` at `"floating"` level. Uses `frame: false` + `titleBarStyle: "hiddenInset"` for a custom titlebar with traffic lights. Size 400x600, min 300x400.
- **Window positioning**: Uses Swift/CoreGraphics to query `CGWindowListCopyWindowInfo` and find the target app's largest window bounds. Positions companion flush to the right of the target app window. Matches target app height.
- **Focus tracking**: Uses `systemPreferences.subscribeWorkspaceNotification("NSWorkspaceDidActivateApplicationNotification")` to show/hide companion based on which app is focused. Shows when target app, Agentlication, or Electron (dev mode) is active; hides when any other app gains focus.
- **Renderer companion mode**: `App.tsx` checks for `?mode=companion&app={name}` query params. In companion mode, renders only a custom frameless titlebar (with app name, draggable region, close button) and the ChatPanel — no app picker, no hub UI, no model picker.
- **IPC channels**: Added `COMPANION_OPEN` and `COMPANION_CLOSE` to contracts and preload. `openCompanion(appName)` and `closeCompanion()` exposed via preload bridge.
- **Agent event forwarding**: Both `AGENT_SEND` and `AGENT_SEND_HUB` handlers now forward agent events to both main window and companion window.
- **CSS**: Added `.companion-app`, `.companion-titlebar`, `.companion-titlebar-drag/title/close`, `.companion-content` styles. Hides redundant chat header in companion mode. Compact layout for 400px width.
- **AppPicker integration**: Calls `openCompanion(app.name)` after successful CDP connection in the Reconnect/Agentlicate flow.
- **Cleanup**: `closeCompanionWindow()` called on `window-all-closed` event. Focus tracking subscription properly cleaned up.

## 2026-03-26 — Rename harness.md to HARNESS.md

Renamed all filename references from `harness.md` to `HARNESS.md` (uppercase) for consistency with project conventions (matching CLAUDE.md, IDEAS.md, etc.):

- **Actual file**: Renamed `~/.agentlication/apps/producer-player/harness.md` to `HARNESS.md`
- **Source code** (main.ts): Updated the comment and `fs.writeFileSync` call in the profile creation flow to write `HARNESS.md` instead of `harness.md`
- **Documentation**: Updated all filename references in IDEAS.md (terminology section, directory tree) and CHAT-HISTORY.md (5 occurrences across architecture, profile creation, and next-steps sections)
- **No changes to prose**: The concept name "harness" in descriptive text was left as-is; only the literal filename was uppercased
- Verified both `npm run build:contracts` and `npm run build:electron` pass cleanly

## 2026-03-26 — Companion Model Picker and Per-App Preferences

Added a model picker and thinking mode selector to the Companion Agent window, with per-app persistence:

- **ModelPicker in Companion**: Reused the existing `ModelPicker` component from the hub header bar. Added it to the companion window's custom titlebar between the app name and close button. Compact styling for the 400px companion width (smaller fonts, icons, padding).
- **Per-app preferences**: Each companion panel has its own model and thinking level settings, persisted to the app's `profile.json`:
  - Added `preferredModel` and `thinkingLevel` optional fields to the `AppProfile` interface in contracts
  - New IPC channels: `APP_UPDATE_PREFERENCES` (save model/thinking to profile.json) and `APP_GET_PREFERENCES` (load from profile.json)
  - Preload bridge exposes `updateAppPreferences(appName, prefs)` and `getAppPreferences(appName)` methods
  - Main process handlers read/write the fields in the app's profile.json file
- **Companion state management**: Companion mode in App.tsx uses separate `companionModel` and `companionThinking` state variables (independent from hub state). On mount, loads persisted preferences from profile.json. On change, persists immediately.
- **UI layout**: Companion titlebar shows `[App Name] [Model Picker] [Dot] [Thinking Picker] [Close]`. New `.companion-titlebar-controls` container with no-drag region. Model picker dropdown appears correctly over the companion content.
- **Persistence verified**: Changed model to Sonnet 4.5/Medium via IPC, closed companion, reopened — correctly loaded the saved preferences from profile.json

## 2026-03-27 — Model Picker, Harness Rename, Architecture Discussions

Continued Agentlication development with companion enhancements, naming decisions, and extensive architecture brainstorming:

- **Model picker in companion**: Added the ModelPicker component to the companion window's custom titlebar with per-app persistence. Each companion saves its preferred model and thinking level to the app's `profile.json`, independent from the hub's settings. Settings survive window close/reopen.
- **HARNESS.md uppercase rename**: Renamed all references from `harness.md` to `HARNESS.md` for consistency with other project convention files (CLAUDE.md, IDEAS.md, etc.). Updated source code, documentation, and the actual file on disk.
- **Harness vs agents naming discussion**: Discussed whether the per-app instruction file should be called `harness.md` or `agents.md`. Decided on HARNESS.md — "harness" is the project's unique terminology and avoids confusion with the project-level AGENTS.md.
- **Chat status feed design**: Designed a real-time status feed for the companion panel showing agentlication steps (CDP connecting, DOM reading, framework detection, harness loading) with pass/fail/in-progress states. Gives users visibility into what the agent is doing before chat becomes interactive.
- **Source repo scanning architecture**: Discussed automatic open-source repo discovery during agentlication using GitHub API or `gh` CLI. Match installed app version to git tags for version-accurate source mirrors. Already have the `find-source-repo.md` prompt file — extending it with automated execution.
- **Ping/smoke test concept**: Proposed running a quick verification during agentlication to confirm CDP actually works — test DOM readability, click a button, verify response. Catches broken connections or apps that block automation before the user starts chatting.
- **Non-Electron app support**: Discussed macOS Accessibility API (AXUIElement) as a fallback for native (non-Electron) apps. Limited to click/type/read-labels (no DOM, no JS execution), but could be combined with screenshots + vision models for richer understanding.
- **Companion window as NSPanel**: Confirmed the companion uses Electron's `type: "panel"` (macOS NSPanel) for float-without-focus-steal behavior, combined with `alwaysOnTop` at floating level.
- **Future CDP injection mode**: Explored injecting the chat panel directly into the target app's DOM via CDP instead of a separate window. Would provide seamless integration but is more fragile. Keeping separate window as the primary approach, injection as a future advanced option.
- **Re-agentlication after updates**: Discussed automatically re-running the agentlication flow when a target app updates — refresh source mirror, re-run smoke test, check patch compatibility.
- **Interactive element mapping**: Proposed mapping all interactive elements during agentlication to build a structured agent toolkit (element selectors, labels, action types).
- **Keyboard shortcuts extraction**: Extract the target app's shortcuts and menu structure during setup for agent reference — enables keyboard-driven automation.
- **File update confirmations**: Added a rule to the agentlication-builder skill requiring a confirmation line at the end of every Telegram reply when IDEAS.md or CHAT-HISTORY.md is updated, so Ethan always knows what was captured.

## 2026-03-27 — Source Repo Discovery & Cloning

Implemented automatic source repository discovery and cloning during the agentlication flow:

- **Source repo service** (`source-repo-service.ts`): New service that searches GitHub for an app's open source repo using the `gh` CLI. Uses multiple search queries (app name, app name + "electron", bundle ID terms) and ranks results by a confidence scoring algorithm that compares repo names against normalized app names and bundle IDs.
- **Confidence scoring**: Repos are scored as high/medium/low/none based on name matching (exact match = high, partial match + stars = medium, description mentions = low). Sorts by confidence then stars.
- **Cloning**: Clones the best-matching repo into `~/.agentlication/apps/<slug>/source/` with `--depth 1` for speed. After cloning, fetches tags and attempts to checkout a matching version tag (e.g., `v1.1.6`) if one exists.
- **IPC channels**: Added `APP_FIND_SOURCE_REPO` and `APP_CLONE_SOURCE` channels to contracts, preload, main process handlers, and renderer types.
- **Non-blocking integration**: Source repo discovery runs in the background after profile creation. The CDP connection proceeds in parallel so the user isn't blocked. Status updates are sent via the COMPANION_STATUS channel.
- **Profile updates**: The `sourceRepoUrl` and `sourceCloneStatus` fields are updated in `profile.json` as the process progresses.
- **Contracts**: Added `SourceCloneStatus`, `SourceRepoSearchResult`, `SourceRepoFindResult`, and `SourceCloneResult` types.
- **Testing**: Verified the search correctly discovers `EthanSK/producer-player` with high confidence when searching for "Producer Player" with bundle ID "com.ethansk.producerplayer". Clone successfully pulls the repo into the source directory. Version tag matching works when tags exist (Producer Player doesn't have a `v1.1.6` tag, so it correctly stays on the default branch).

## 2026-03-26 — Non-Electron App Support (All Apps in Picker)

Added support for showing ALL macOS applications in the app picker, not just Electron apps:

- **App scanner update** (`app-scanner.ts`): The `scanElectronApps()` function now scans ALL `.app` bundles in `/Applications/`, not just those containing the Electron framework. Each app gets an `isElectron` flag based on framework detection. Sorting order: Electron apps first, then alphabetical within each group.
- **AppPicker UI overhaul** (`AppPicker.tsx`):
  - Added search/filter input at the top of the app list for filtering by app name
  - Added "All Apps" / "Electron Only" toggle button to switch between showing all apps or just Electron ones
  - Apps are grouped into "Electron Apps" and "Other Apps" sections with headers showing counts
  - Non-Electron apps display a "Native" badge (amber-colored) with an info icon and tooltip: "Limited support — no DOM access. Uses macOS Accessibility API."
  - Non-Electron app cards have slightly muted styling (0.8 opacity) that becomes full on hover
  - The "Other Apps" section header includes a hint text about Accessibility API limitations
- **Graceful CDP skip**: When agentlicating a non-Electron app, the CDP connection flow is skipped entirely. Profile creation still works, and the companion window opens — but no CDP kill/relaunch/connect cycle happens.
- **CSS additions** (`styles.css`): New styles for `.app-filter-bar`, `.app-search-input`, `.app-filter-toggle`, `.app-section-header`, `.app-section-count`, `.app-section-hint`, `.app-card-non-electron`, `.non-electron-badge`, and `.non-electron-badge-text`.
- **Dev mock data**: Updated the dev-mode mock data in AppPicker to include non-Electron apps (Safari, Finder, Preview, Calendar, Music, Notes) alongside the existing Electron mocks.
- **No accessibility API implementation yet**: This change is UI-only. The actual macOS Accessibility API interaction will be implemented separately. Non-Electron apps can be agentlicated and will get profiles, but CDP-related features are skipped gracefully.
