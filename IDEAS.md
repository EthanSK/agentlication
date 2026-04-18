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

## Agentlication Smoke Test / Ping Test

- During the agentlication flow, run a quick smoke test to verify the CDP connection actually works
- Test DOM readability: can the agent read page title, URL, basic DOM structure?
- Test interactivity: click a button, verify the response (e.g., element state change)
- Catches broken CDP connections, apps that block automation, or apps with unusual setups
- Could display pass/fail results in the companion panel before the agent starts working

## Non-Electron App Support (Accessibility API)

- macOS Accessibility API (AXUIElement) as fallback for non-Electron native apps
- Limited capabilities compared to CDP: can click buttons, type text, read UI element labels
- No DOM access, no JS execution, no framework detection — purely visual/structural
- Could still be useful for simple automation tasks (click this, type that)
- Explore combining with screenshots + vision model for richer understanding
- AXUIElement tree gives element hierarchy, roles, labels, values, positions

## Chat Status Feed

- Show all agentlication steps as a status feed in the companion panel
- Real-time display: "Connecting to CDP...", "Reading DOM...", "Detecting framework...", "Loading harness..."
- Each step shows pass/fail/in-progress state
- Gives the user visibility into what the agent is doing before the chat becomes interactive
- Could also show ongoing agent actions (e.g., "Injecting patch...", "Reading localStorage...")

## Source Repo Auto-Discovery

- When agentlicating an app, automatically search for its open-source repository
- Use GitHub API or `gh` CLI to search by app name, bundle ID, or known org
- Match the installed version to a git tag or release for version-accurate source mirror
- Store discovered repo URL in profile.json for future reference
- Already have the `find-source-repo.md` prompt — this extends it with automated execution

## Per-App Model Picker and Thinking Level Persistence

- Each companion window has its own model and thinking level selection
- Persisted in the app's `profile.json` as `preferredModel` and `thinkingLevel`
- Different apps may benefit from different model sizes (simple apps = small model, complex apps = large)
- Settings survive companion window close/reopen and app restarts

## Companion Window as NSPanel

- Companion window uses Electron BrowserWindow `type: "panel"` which maps to macOS NSPanel
- NSPanel floats above normal windows without stealing focus from the target app
- Combined with `alwaysOnTop: true` at `"floating"` level for proper layering
- User can interact with the target app while the companion panel is visible

## Future: CDP Injection Mode

- Instead of a separate companion window, inject the chat panel directly into the target app's DOM via CDP
- Would appear as a native part of the target app's UI
- Eliminates window management complexity (positioning, focus tracking, show/hide)
- Could use the target app's own CSS variables for seamless visual integration
- Trade-off: more fragile (target app DOM changes could break it), harder to debug
- Start with separate window (current approach), migrate to injection as an advanced option

## Re-Agentlication After App Updates

- When a target app updates to a new version, re-run the agentlication flow
- Update the source mirror to the new version tag
- Re-run smoke test to verify CDP still works
- Check if existing patches are still compatible
- Update `installedVersion` in profile.json
- Could auto-detect updates by monitoring app version on launch

## Interactive Element Mapping

- During agentlication, map all interactive elements in the target app
- Buttons, inputs, links, dropdowns, toggles, sliders, etc.
- Store as a structured toolkit the agent can reference (element ID/selector, label, action type)
- Gives the agent a "menu" of available actions without needing to scan the full DOM each time
- Could be refreshed periodically or on page navigation

## Keyboard Shortcuts and Menu Structure Extraction

- During setup, extract the target app's keyboard shortcuts and menu bar structure
- Read from the app's menu bar via Electron's `Menu.getApplicationMenu()` or DOM inspection
- Parse keyboard shortcut definitions from the app's source code or help documentation
- Store in HARNESS.md or a separate `shortcuts.json` for agent reference
- Enables the agent to use keyboard shortcuts instead of clicking (faster, more reliable)

## Non-Electron Agentlication Flow

- When a non-Electron app is agentlicated, profile creation works the same (profile.json, HARNESS.md, etc.)
- But instead of CDP, the Companion Agent uses macOS Accessibility API for interaction
- Consider a separate `accessibility-service.ts` in the Electron main process for AXUIElement access
- The companion chat could accept "click the X button" or "type Y in the text field" commands
- Screenshots + vision model could supplement the accessibility tree for UI understanding
- Need to handle Accessibility permissions (System Preferences > Privacy > Accessibility)
- Could auto-prompt the user to grant Accessibility access on first non-Electron agentlication

## App Picker UX — Click-to-Capture Next Active Window

- Add a "Capture next active window" button in the app picker UI (Hub and/or per-panel configuration)
- Clicking it puts Agentlication into a short-lived "capture-next-active-window" mode
- The next window that becomes frontmost/active on macOS is assigned as the target app for the agent panel being configured
- Much faster than scrolling an installed-apps list — especially for obscure or unlisted apps, or when the user already has the target open
- Implementation sketch: macOS `NSWorkspace.didActivateApplicationNotification` (or CGWindow frontmost polling via accessibility API); capture bundle identifier, PID, and window title; auto-populate the panel's target
- Include an "Esc to cancel" escape hatch and a 10–15s timeout so capture mode doesn't get stuck
- Pairs well with the existing accessibility-API path — works for both Electron and non-Electron targets

## VST Plugin Targets — Agent Panels Inside DAWs

- Extend Agentlication target support to VST/VST3/AU plugins hosted inside DAWs (Ableton Live, Logic Pro, FL Studio, Bitwarden-style DAWs)
- VST plugin UIs run as subwindows inside the DAW's process (Ableton's `Live` process hosts the plugin chrome), so the window picker / click-to-capture flow above would naturally target them if the window list is walked per-process rather than only per-app
- Opens up a direct integration path with mixassist-ai (Ethan's music-focused agent product) — attach a companion chat to a specific plugin instance (an EQ, a synth, a compressor) and let the agent read knob values, automate parameter sweeps, generate presets
- Investigation needed: how plugin subwindows expose themselves via CGWindow / accessibility API; whether each plugin instance gets a unique window id or they share one per host; VST3 vs AU vs VST2 differences
- Could start with a single DAW (Ableton Live) + a single plugin format (VST3) as proof-of-concept, then generalize

## Cold-Start App Scan Hang (bug-fix idea)

- On first launch the hub can stall on "Scanning for apps..." even though the main process finishes extracting icons (129 files in `/tmp/agentlication-icons/`) and no `sips`/`defaults` child processes remain. Cmd+R reliably recovers.
- Repro condition appears correlated with `/Applications` size — 131 bundles on the MBP triggers it; the Mini with fewer apps didn't exhibit it in the bootstrap run.
- Likely causes to investigate:
  1. `scanElectronApps` uses `execFileSync` for `defaults read` × 2 + `sips` per app → up to ~400 synchronous subprocess calls. Main event loop is pinned for the full duration, and the IPC reply may arrive after some renderer-side timeout / effect cleanup.
  2. `setApps(scanned)` then `Promise.all(...isAppAgentlicated)` runs AFTER — a rejected `isAppAgentlicated` could potentially leave `setLoading(false)` unreached if the exception is thrown between `setApps` and the `Promise.all`. (Actually `finally` should catch this — so more likely #1.)
- Suggested fix: move `extractAppIcon` to a worker thread or make it async with a bounded concurrency (e.g. `p-limit(8)`). Stream results back to the renderer as they're ready so the UI can populate incrementally instead of blocking on the full set.
- Secondary idea: cache scan results to disk (`~/.agentlication/app-scan-cache.json`) keyed by `/Applications` mtime so warm launches skip the scan entirely. Refresh in the background.

## Detachable Companion Window Architecture

- Observed during manual testing: the Setup Agent panel can pop out into its own smaller window (~400x600) while the main hub stays open at 1100x750. Both titled "Agentlication" but logically separate.
- Worth documenting the lifecycle: when does a pop-out happen, how is state shared, does closing the pop-out kill the companion session or just detach the view?
- User-facing idea: make pop-out explicit via a "Detach companion" button so the user can park agent panels as floating mini-windows alongside the target app (fits the "agent panel overlaying the target app" vision better than a side pane).

## Open Questions

- Local installer vs cloud build queue?
- Expose pipeline to users (agentlicate-anything) or keep as internal factory?
- How to handle merge conflicts when source repos update?
- Should custom UIs be in branches or worktrees?
- Dev server shipping — is it possible to ship an Electron app that runs `npm run dev`?
- For non-Electron apps: should the agent use screenshots + vision model, accessibility tree, or both?
- Should non-Electron apps get a different companion UI that shows the accessibility tree instead of DOM viewer?

## Hub Load Performance (2026-04-18)

- **Icon cache on disk**: `~/.agentlication/icon-cache/` keyed by `sha1(appPath + mtime)`. Cache hits avoid the `defaults read` + `sips` pipeline entirely (~1ms vs 100-300ms per app).
- **Streaming scan**: `scanElectronAppsStreaming` returns the bare app list in <100ms, then enriches icons in batches of 6 via `setImmediate` gaps so the main process stays responsive to other IPCs.
- **Skeleton loader**: 10 shimmer placeholder rows with typing-dot header ("Scanning apps…"). Matches existing dark theme, respects `prefers-reduced-motion`.
- **Future**: could move icon extraction to a worker thread or `utilityProcess.fork` to use parallel sips calls; currently serialized. Would cut the ~9s cold-cache enrichment to ~2s.
- **Future**: `sips` is invoked per app — could batch-convert multiple .icns files in one sips invocation, or cache at install time by watching `/Applications/` with `fs.watch`.

## Bug-bash 2026-04-18 — parked findings

Lower-priority bugs found during the bug-bash that weren't fixed in commit `ed5c08a` (repo-URL arg-injection + zombie CLI reap). Ordered by rough severity.

### Codex-flagged regression in another subagent's unstaged work
- `apps/electron/src/app-scanner.ts:369-371` — the bare-list `scanElectronApps` rewrite forces `isElectron: true` for any `.app` found under a `~/Projects/*/{dist,out}` build dir, bypassing the `checkIfElectron` probe. Non-Electron dev-build apps will then render in the Electron section and route to the CDP path instead of the native AX path. Owner: lag-fix subagent (file is unstaged, not ours to commit). Flag to them before they push.

### Agent pipeline / provider-spawn path
- `agent-service.ts:226-238` (Claude) and `:450-462` (Codex) — the stderr handler flags ANY line containing the substring "error" / "unauthorized" / "expired" as an `agent:error` event. CLIs commonly log neutral phrases like "No errors found" or version strings containing "unauthorized key" — false positives surface as red error bubbles in the UI. Fix: match anchored patterns or only emit `agent:error` on non-zero exit.
- `agent-service.ts:154-224` — the Claude stream-json parser has buffered assistant/result/delta pathways guarded by a `hasEmittedContent` flag. If the CLI emits a `result` event with `result: ""` (empty string, not undefined), the flush still races. Low-risk but worth a test case for empty completions.
- `agent-service.ts:1014-1031` — `parseToolBlocks` dedups by the raw regex match string. If the model deliberately emits the same JSON blob twice (e.g. two identical `{"action":"get_elements"}` calls), the second is silently dropped. Probably desirable; worth documenting.
- No timeout on `spawn(resolvedPath, [...])` for claude/codex. A hung CLI holds the UI in `streaming` state indefinitely — ChatPanel has `onCancel` but no watchdog.

### IPC / main-process
- `main.ts:807-842` `getTargetAppBounds` interpolates `appName` into a Swift string literal via `.replace(/"/g, '\\"')`. Missing: backslash escaping. An app name containing `\"` or trailing `\` breaks the Swift heredoc and could in principle escape the string literal. `appName` ultimately flows from a trusted source (local .app bundle name on disk) so this is mostly theoretical, but hardening it is cheap.
- `main.ts:106-115` `isAppRunning` uses `pgrep -f <appName>` with no regex escaping. App names with regex metacharacters (`.`, `*`, `+`, `(`) could mis-match or error. Low impact.
- Every patch-management IPC handler (`PATCH_CREATE`, `PATCH_UPDATE`, `PATCH_DELETE`, etc.) calls `patchService.*` with a renderer-supplied `appSlug` and `name` but doesn't validate either. `patchService.createPatch` does its own slug normalization, but defense-in-depth validation at the IPC boundary (reject `..`, slashes, empty strings) would protect against future refactors.

### Renderer
- `ChatPanel.tsx:77-174` — both the hub's ChatPanel and the companion's ChatPanel subscribe to `onAgentEvent`. Main process broadcasts agent events to BOTH windows via `mainWindow?.webContents.send(...)` and `companionWindow?.webContents.send(...)`. Events fired for a Hub Setup Agent send leak into an open Companion window's feed and vice versa. Fix: tag events with a target window id, or split into separate IPC channels (`AGENT_EVENT_HUB` vs `AGENT_EVENT_COMPANION`).
- `ChatPanel.tsx:77-158` — the `onAgentEvent` effect has `[]` deps but closes over `setStreaming` / `setFeed`. React guarantees these setters are stable, so it works; still, if `onAgentEvent` ever captures state (future refactor risk), the empty deps would hide the bug.
- `AppPicker.tsx` + its consumers — untested. Auth/setup-flow errors could silently leave UI in the wrong state.

### Test coverage gaps
- No tests at all for `patchService` (patch create/update/delete, frontmatter round-trip, CSS injection wrapper).
- No tests for `cdpService` (screenshot/eval error paths, connect retries).
- No tests for `accessibility-service` (AX bridge error surfaces).
- No IPC integration tests — the preload → main → service chain is only exercised manually.

### Chat UI streaming-state races
- If `agent:done` arrives AFTER the user has already started a second send, the empty-streamingText guard prevents double-appends, but any pending `setStreamingText` update from the first turn can leak into the second. Manifests as an "assistant: [empty bubble]". Hard to repro, plausible under high latency.

### Recommended cadence
- Next bug-bash: 2 weeks. Focus: integration tests for IPC boundary + patchService unit tests (biggest coverage gap), then fix the dual-window agent-event leak (clearest user-visible bug left).
