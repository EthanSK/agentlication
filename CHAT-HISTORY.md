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

## 2026-03-26 — Companion Agent Brain + Status Feed Verification

Two changes to make the companion chat panel functional as an AI agent:

### Task 1: Status Feed in Companion Chat
- Verified that the status feed infrastructure was already fully implemented from prior sessions:
  - `emitStatus()` helper in main.ts sends `COMPANION_STATUS` IPC events
  - `onStatusMessage` in preload.ts subscribes to status events
  - ChatPanel renders status messages inline with chat messages via the unified `FeedItem` type
  - Status messages have level-specific styling (progress=amber, success=green, error=red, info=purple)
  - Status icons include: info, success, error, progress, searching, file, connection
- Status messages are emitted during: CDP connect flow, profile creation, source repo search, source cloning, DOM reading

### Task 2: Wire Up Companion Agent Brain
- **New IPC channel `COMPANION_AGENT_SEND`**: Added to contracts, preload, and types. Takes `{ appName, message, modelId }`.
- **Main process handler**: Reads the app's `HARNESS.md` from `~/.agentlication/apps/{slug}/HARNESS.md`, gets CDP page info (title, URL, framework, DOM structure, localStorage keys) and full DOM snapshot via CDP, then builds an enriched system prompt combining all context.
- **System prompt includes**: Agent identity ("Companion Agent for [App]"), HARNESS.md contents, page info summary, DOM snapshot (truncated to 50KB), available CDP actions (CLICK, EVAL, TYPE placeholders for future implementation).
- **ChatPanel updated**: Companion mode now uses `companionAgentSend()` instead of the generic `agentSend()`, ensuring every companion message includes HARNESS.md + DOM context.
- **Preload bridge**: `companionAgentSend` exposed via contextBridge.
- **Tested**: Sent "What is Producer Player?" in the companion chat; Claude responded with a detailed analysis of the app using the system prompt context. Status messages from source repo search also displayed inline in the feed.

## 2026-03-28 — Status Check & Next Steps Discussion

Reviewed the full project state and discussed next steps with Ethan:

- **Current state summary**: MVP scaffold, app scanner, model picker, CDP connection flow, companion floating window, source repo discovery, companion agent brain, status feed, and non-Electron app UI support are all implemented and working.
- **Next steps prioritized**:
  1. CDP action execution (CLICK, TYPE, EVAL — currently placeholders)
  2. Runtime patch system (Greasemonkey-style JS/TSX injection via CDP)
  3. Smoke test / ping test during agentlication
  4. Interactive element mapping
  5. Accessibility API backend for non-Electron apps
  6. Pipeline / factory system
  7. Website / landing page at agentlication.ai
- Awaiting Ethan's decision on which area to tackle next.

## 2026-03-28 — CDP Action Execution Implementation (Phase 1 & 2)

Implemented full CDP action execution — the companion agent can now interact with target apps (click, type, evaluate JS, screenshot, navigate, etc.):

- **Agent action types** (contracts): Added `AgentActionKind` (click, type, eval, click_text, select, scroll, wait, screenshot, get_elements, get_a11y_tree, navigate, press_key), `AgentAction` interface, `AgentActionResult` interface, `InteractiveElement` interface.
- **CDP type definitions** (`chrome-remote-interface.d.ts`): Extended from just RuntimeDomain to include DOM, Input, Accessibility, and Page domain types with full parameter/return types for getDocument, querySelector, getBoxModel, scrollIntoViewIfNeeded, dispatchMouseEvent, dispatchKeyEvent, insertText, getFullAXTree, captureScreenshot, navigate, etc.
- **CdpService action methods** (`cdp-service.ts`): 15+ new methods:
  - `clickElement(selector)` — Runtime.evaluate with mousedown/mouseup/click sequence
  - `clickByText(text, tagFilter?)` — find and click element by visible text content
  - `typeIntoElement(selector, text)` — type with React native input setter trick for framework compatibility
  - `evaluateExpression(expression)` — eval arbitrary JS and return structured result
  - `getInteractiveElements()` — scan all interactive elements, returns numbered list with selectors, text, roles, positions, disabled/checked state
  - `getAccessibilityTree(depth?)` — CDP Accessibility.getFullAXTree formatted as compact indented text
  - `captureScreenshot()` — Page.captureScreenshot returning base64 PNG
  - `scrollToElement(selector)` — scrollIntoView
  - `pressKey(key)` — Input.dispatchKeyEvent with key map for Enter, Tab, Escape, Arrow keys, etc.
  - `navigate(url)` — Page.navigate
  - `waitForElement(selector, timeout)` — poll until element appears
  - `clickElementViaCdp(selector)` — DOM.getBoxModel + Input.dispatchMouseEvent fallback for apps blocking synthetic events
  - `typeViaCdp(text)` — Input.insertText fallback
  - `selectOption(selector, value)` — select dropdown option
  - `executeAction(action)` — main dispatcher that routes AgentAction to the correct method with automatic fallback (e.g., clicks fall back to CDP-level if Runtime.evaluate fails)
- **Tool-block parser** (agent-service.ts): Parses ` ```tool ` JSON blocks from the agent's streaming response. Accumulates full text, regex-matches complete tool blocks, deduplicates by raw string to avoid double-execution, and calls cdpService.executeAction() for each parsed action.
- **Updated system prompt**: Replaced raw DOM snapshot with interactive elements list + accessibility tree. System prompt now documents all 12 available actions with parameter tables and examples. Agent sees numbered elements like `[0] button "Save" selector:#save-btn @(450,320,120x40)`.
- **Companion agent pipeline** (`sendCompanion` method): New method in AgentService that builds enriched system prompt with interactive elements + a11y tree + HARNESS.md, with full tool-block parsing in the streaming handler.
- **IPC wiring**: 10 new IPC channels (cdp:click, cdp:click-text, cdp:type, cdp:get-elements, cdp:get-a11y-tree, cdp:screenshot, cdp:press-key, cdp:scroll, cdp:navigate, cdp:execute-action) added to contracts, preload, main.ts, and renderer types.
- **UI tool-result display**: ChatPanel now handles `agent:tool-result` events, showing inline status messages for executed actions (green check for success, red X for failure) with action name and selector.

## 2026-03-28 — CDP & Native App Support Research

Deep research session exploring implementation approaches for CDP action execution and native macOS app support:

- **Research report written**: `RESEARCH-CDP-AND-NATIVE.md` — comprehensive report with code examples, benchmarks, and architecture recommendations.
- **CDP action execution findings**:
  - `Runtime.evaluate` is the primary approach for click/type/eval — already partially working in the codebase
  - `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` as fallback for apps that block synthetic JS events
  - CDP Accessibility domain provides compact a11y tree (~2-5KB vs 50KB+ raw DOM) — much better for agent context
  - Numbered interactive element list for the agent to reference: `[0] button "Save"`, `[1] input "Search"`
  - JSON tool blocks in agent responses as the initial action format, with MCP server as the long-term approach
  - React native setter trick needed for input fields (bypasses React's synthetic event system)
- **Native app support findings**:
  - Compiled Swift binary (AXUIElement API) is the clear winner — 130ms tree read vs 5,500ms for JXA (40x faster)
  - AX API provides roles, labels, values, positions, sizes, and available actions
  - `AXUIElementPerformAction(kAXPressAction)` for clicks, `AXUIElementSetAttributeValue` for typing
  - Swift CLI binary (`ax-bridge`) bundled as extraResource in the Electron app
  - Permission handling via `systemPreferences.isTrustedAccessibilityClient()`
- **Implementation plan**: Phase 1-2 CDP actions (3-5 days) → Phase 3 native support (3-5 days) → Phase 4 screenshot+vision (optional) → Phase 5 MCP server (future)

### 2026-03-28 — Phase 3: Native macOS App Support

**What was built:**
- **Swift CLI binary (`ax-bridge`)**: Compiled binary at `native/ax-bridge/` that provides commands for reading accessibility trees, clicking elements, typing text, focusing elements, listing interactive elements, performing AX actions, setting values, checking permissions, and getting app info. All output is JSON.
- **Contracts updates**: Added `AXElement`, `AXTree`, `AXActionResult`, `AXAppInfo`, `AXInteractiveElement`, `AXAgentAction` types. Added 11 new IPC channels (`ax:tree`, `ax:click`, `ax:type`, `ax:focus`, `ax:elements`, `ax:action`, `ax:set-value`, `ax:check-permission`, `ax:info`, `ax:execute-action`, `companion:native-agent-send`). Extended `AgentActionKind` with `ax_` prefixed actions. Added `isElectron` to `AppProfile`.
- **AccessibilityService** (`apps/electron/src/accessibility-service.ts`): Node.js wrapper calling `execFile` on the Swift binary with JSON parsing. Methods: `getTree`, `click`, `type`, `focus`, `getActions`, `getInteractiveElements`, `performAction`, `setValue`, `checkPermission`, `getInfo`, `executeAction`.
- **IPC wiring**: All AX handlers registered in `main.ts`, exposed via `preload.ts`, typed in `types.d.ts`.
- **Agent integration**: `sendNativeCompanion()` method in agent-service builds AX-based system prompt with interactive elements, accessibility tree, and app info. Tool-block parser routes `ax_` prefixed actions to AccessibilityService.
- **Permission handling**: Uses `systemPreferences.isTrustedAccessibilityClient()` — checks on agentlication, prompts if not granted.

**Testing results (real native apps):**
- Safari: Info (22ms), tree read depth 3 (66ms), 904 interactive elements discovered (742ms), focus/type/click all working
- Finder: 2123 interactive elements, sidebar, column view detected
- Notes: Folder list, note cells, text fields all visible
- System Settings: 265 elements including sidebar, search field, buttons

## 2026-03-28 — Phase 3 Demo Video: Native macOS App Support

Recorded and sent a screen demo video showcasing AX Bridge's native macOS app support across four real apps:

- **Video recorded**: 45-second 1920x1080 H.264 screen capture at 30fps using ffmpeg avfoundation, showing terminal output of ax-bridge commands run against live native apps.
- **Apps demonstrated**:
  - Safari: 910 interactive elements, full AX tree (depth 3), 2 windows detected, app info with PID
  - Notes: 825 interactive elements, folder outlines, text fields, 1 window ("All iCloud -- 219 notes")
  - System Settings: 265 interactive elements, sidebar navigation
  - Finder: Interactive elements detected
- **ax-bridge commands shown**: `info` (app metadata + windows), `elements --interactive` (numbered interactive element list with roles/names), `tree --depth 3` (hierarchical accessibility tree)
- **Video sent to Ethan via Telegram**: Used Bot API `sendVideo` endpoint directly (not the plugin reply tool) for proper video rendering with streaming support.

## 2026-03-30 — E2E Companion Chat Pipeline Test & Duplicate Text Fix

Tested the full end-to-end companion chat pipeline programmatically and fixed a critical bug:

- **Test approach**: Wrote a Node.js test script that bypasses Electron IPC and directly uses `CdpService` + `AgentService` from compiled output, connecting to Producer Player via CDP on port 9222.
- **Pipeline verified**:
  - CDP reads 30 interactive elements from Producer Player
  - `buildSystemPromptWithActions()` enriches system prompt with elements + a11y tree + page info
  - Claude CLI (sonnet) receives full context and responds intelligently
  - Tool block parser (`parseToolBlocks()`) intercepts ` ```tool ` blocks from streaming output
  - `CdpService.executeAction()` dispatches actions (click, eval, get_elements, screenshot)
  - `agent:tool-result` events fire correctly with action/result payloads
  - `agent:done` event fires on completion
- **Multi-turn test passed** (4 turns):
  1. List elements: Agent described 5 elements with purposes (no tool call needed)
  2. Click button: Agent output `click` tool block, button clicked successfully
  3. Evaluate JS: Agent output `eval` tool block, `document.title` returned "Producer Player"
  4. Refresh elements: Agent output `get_elements` tool block, found 30 elements
- **Bug fixed — duplicate response text**: Claude CLI's `stream-json` format emits content through three paths: `content_block_delta`, `assistant` event, and `result` event. The parser was emitting all three, causing 2-3x duplicated text in chat. Fixed by tracking `hasEmittedContent` flag. Also fixed a subtle edge case where the first `assistant` event has content blocks with undefined text (partial/in-progress), prematurely marking content as emitted and blocking the real response.

## 2026-03-30 — Runtime Patch System

Built the full Runtime Patch System following the detailed plan in `docs/RUNTIME-PATCH-PLAN.md`:

- **PatchService** (`apps/electron/src/patch-service.ts`): Core service for managing persistent patches that modify Electron apps at runtime via CDP. YAML frontmatter parser for `/*--- ... ---*/` blocks in `.patch.js`/`.patch.tsx`/`.patch.css` files. Full CRUD: create, read, update, enable/disable, delete. Injection wrapper with error handling, cleanup support, and deduplication registry (`window.__AGENTLICATION_PATCHES__`). Two-layer CDP injection strategy: `Page.addScriptToEvaluateOnNewDocument` for persistent scripts that survive navigations, plus `Runtime.evaluate` for immediate injection. Priority-based ordering and topological dependency resolution. esbuild TSX compilation pipeline with `.compiled/` cache directory. Git auto-backup with 5-second debounced commits to `~/.agentlication/patches-backup/`.

- **Contracts**: Added `PatchMetadata`, `PatchFile`, `PatchCreateRequest`, `PatchUpdateRequest` interfaces. New types: `PatchFormat` (js/tsx/css), `PatchInjectAt` (document-start/document-ready/document-idle), `PatchStatus`. Extended `AgentActionKind` with 6 patch actions: `create_patch`, `update_patch`, `delete_patch`, `list_patches`, `enable_patch`, `disable_patch`. Added 11 new IPC channels.

- **Agent Integration**: 6 new tool blocks for patch management. `AgentService.executeAction()` routes patch actions to PatchService, CDP actions to CdpService. `buildSystemPromptWithActions()` extended with patch context: current patches list, patch action documentation, examples, and best practices. Companion agent auto-sets `currentAppSlug` for patch routing.

- **CDP Enhancements**: Added `addScriptToEvaluateOnNewDocument()` and `removeScriptToEvaluateOnNewDocument()` to CdpService. React detection script auto-injected on CDP connect. All enabled patches auto-injected after successful CDP connection.

- **IPC & Preload**: All patch handlers wired in `main.ts`. Preload bridge exposes `patchList`, `patchCreate`, `patchUpdate`, `patchDelete`, `patchEnable`, `patchDisable`, `patchGet`, `patchInject`, `patchInjectAll`, `onPatchError`, `onPatchStatus`.

- **Testing**: 26 unit tests passed (YAML parsing, CRUD, priority ordering, enable/disable, deletion). esbuild TSX compilation verified. Live CDP injection tested against VS Code: badge injection, cleanup, re-injection, and `addScriptToEvaluateOnNewDocument` persistence all confirmed working.

## 2026-04-18 — Monorepo Feature Audit

Audited the monorepo against the project vision feature list and classified each feature as shipped, partial, missing, or broken based on code evidence. Verified the current code still builds with `npm run build` and Electron source-repo tests pass with `npm run -w apps/electron test`. Key findings: CDP connection/actions, BYOS CLI providers, model picker, source repo discovery/clone, HMR dev scripts, AX service code, companion window, and runtime patch injection exist to varying degrees; native fallback routing is currently broken in the renderer because companion mode always sends through the CDP companion path; Codex provider ignores the generated system prompt; fork/marketplace/voting/license/auto-update/speech pipeline features are mostly absent or only documented as ideas.
