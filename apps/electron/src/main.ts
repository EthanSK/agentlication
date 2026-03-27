import { app, BrowserWindow, ipcMain, dialog, systemPreferences } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync, execSync } from "child_process";
import { IPC } from "@agentlication/contracts";
import type { AppProfile, TargetApp, CdpPageInfo, StatusMessage, SourceRepoFindResult, SourceCloneResult } from "@agentlication/contracts";
import { AgentService } from "./agent-service";
import { CdpService } from "./cdp-service";
import { scanElectronApps, launchAppWithDebugging } from "./app-scanner";
import { findSourceRepo, cloneSourceRepo } from "./source-repo-service";

let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let companionTargetAppName: string | null = null;
let focusSubscriptionId: number | null = null;
const cdpService = new CdpService();
const agentService = new AgentService(cdpService);

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    center: true,
    title: "Agentlication",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  // Prevent new window popups
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Show window cleanly once content is ready (avoids white flash)
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (isDev) {
    const devUrl = process.env.RENDERER_DEV_URL ?? "http://localhost:5173";
    mainWindow.loadURL(devUrl);

    // Only open DevTools when explicitly requested via env var
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "true") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const rendererPath = path.join(
      process.resourcesPath,
      "renderer",
      "index.html"
    );
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── Profile helpers ─────────────────────────────────────────────

const PROFILE_ROOT = path.join(os.homedir(), ".agentlication", "apps");
const CDP_PORT_BASE = 9222;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Read a key from an app's Info.plist (returns empty string on failure). */
function readPlistKey(appPath: string, key: string): string {
  try {
    const plistPath = path.join(appPath, "Contents", "Info");
    return execFileSync("defaults", ["read", plistPath, key], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/** Check if a target app is currently running by its .app path. */
function isAppRunning(appPath: string): boolean {
  try {
    const appName = appPath.split("/").pop()?.replace(".app", "") || "";
    if (!appName) return false;
    execFileSync("pgrep", ["-f", appName], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Auto-assign a CDP port by scanning existing profiles. */
function nextCdpPort(): number {
  try {
    if (!fs.existsSync(PROFILE_ROOT)) return CDP_PORT_BASE;
    const dirs = fs.readdirSync(PROFILE_ROOT);
    let maxPort = CDP_PORT_BASE - 1;
    for (const dir of dirs) {
      const profilePath = path.join(PROFILE_ROOT, dir, "profile.json");
      try {
        const data = JSON.parse(fs.readFileSync(profilePath, "utf-8")) as AppProfile;
        if (data.cdpPort > maxPort) maxPort = data.cdpPort;
      } catch {
        // skip broken profiles
      }
    }
    return maxPort + 1;
  } catch {
    return CDP_PORT_BASE;
  }
}

let statusIdCounter = 0;

/** Emit a status message to the companion window (and main window). */
function emitStatus(text: string, level: "info" | "success" | "error" | "progress") {
  const msg: StatusMessage = {
    id: `status-${++statusIdCounter}-${Date.now()}`,
    text,
    level,
    timestamp: Date.now(),
  };

  mainWindow?.webContents.send(IPC.COMPANION_STATUS, msg);
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send(IPC.COMPANION_STATUS, msg);
  }
}

// ── IPC Handlers ───────────────────────────────────────────────

function registerIpcHandlers() {
  // App scanning
  ipcMain.handle(IPC.SCAN_APPS, async () => {
    return scanElectronApps();
  });

  // Check if an app has been agentlicated (has a per-app profile)
  ipcMain.handle(IPC.APP_IS_AGENTLICATED, async (_event, appName: string) => {
    const slug = slugify(appName);
    const profileFile = path.join(PROFILE_ROOT, slug, "profile.json");
    try {
      return fs.existsSync(profileFile);
    } catch {
      return false;
    }
  });

  // Create an app profile
  ipcMain.handle(
    IPC.APP_CREATE_PROFILE,
    async (_event, appData: { name: string; path: string }): Promise<{ success: boolean; profile?: AppProfile; error?: string }> => {
      try {
        const slug = slugify(appData.name);
        const profileDir = path.join(PROFILE_ROOT, slug);

        // If profile already exists, return it
        const profileFile = path.join(profileDir, "profile.json");
        if (fs.existsSync(profileFile)) {
          const existing = JSON.parse(fs.readFileSync(profileFile, "utf-8")) as AppProfile;
          return { success: true, profile: existing };
        }

        emitStatus(`Creating app profile for ${appData.name}...`, "progress");

        // Create directory structure
        fs.mkdirSync(profileDir, { recursive: true });
        fs.mkdirSync(path.join(profileDir, "source"), { recursive: true });
        fs.mkdirSync(path.join(profileDir, "patches"), { recursive: true });

        // Read app metadata from Info.plist
        const bundleId = readPlistKey(appData.path, "CFBundleIdentifier");
        const installedVersion =
          readPlistKey(appData.path, "CFBundleShortVersionString") ||
          readPlistKey(appData.path, "CFBundleVersion") ||
          "unknown";
        const cdpPort = nextCdpPort();

        const profile: AppProfile = {
          name: appData.name,
          slug,
          bundleId,
          appPath: appData.path,
          installedVersion,
          cdpPort,
          sourceRepoUrl: "",
          dateAgentlicated: new Date().toISOString(),
        };

        // Write profile.json
        fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2), "utf-8");

        // Write HARNESS.md
        const harnessContent = `# ${appData.name} — Companion Agent Harness

## About this app
${appData.name} is an Electron application located at ${appData.path}.

## Key areas
<!-- The Companion Agent will fill this in as it learns the app -->

## Learnings
<!-- Accumulated knowledge from past interactions -->
`;
        fs.writeFileSync(path.join(profileDir, "HARNESS.md"), harnessContent, "utf-8");

        emitStatus(`App profile created for ${appData.name}`, "success");
        return { success: true, profile };
      } catch (err) {
        emitStatus(`Failed to create profile: ${String(err)}`, "error");
        return { success: false, error: String(err) };
      }
    }
  );

  // Launch target app with debugging (legacy — CDP_CONNECT is preferred)
  ipcMain.handle(IPC.LAUNCH_APP, async (_event, appPath: string) => {
    return launchAppWithDebugging(appPath);
  });

  // Get an app's profile by name
  ipcMain.handle(IPC.APP_GET_PROFILE, async (_event, appName: string): Promise<AppProfile | null> => {
    const slug = slugify(appName);
    const profileFile = path.join(PROFILE_ROOT, slug, "profile.json");
    try {
      if (fs.existsSync(profileFile)) {
        return JSON.parse(fs.readFileSync(profileFile, "utf-8")) as AppProfile;
      }
      return null;
    } catch {
      return null;
    }
  });

  // CDP operations — connect takes appPath + port, kills/relaunches the target
  ipcMain.handle(
    IPC.CDP_CONNECT,
    async (_event, appPath: string, cdpPort: number) => {
      const appName = appPath.split("/").pop()?.replace(".app", "") || "the app";

      // If the target app is already running, ask the user to confirm restart
      if (isAppRunning(appPath)) {
        const { response } = await dialog.showMessageBox(mainWindow!, {
          type: "question",
          buttons: ["Quit & Restart", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          title: "Restart Required",
          message: `Do you want to quit and restart ${appName}? It will be relaunched with CDP enabled.`,
        });
        if (response === 1) {
          emitStatus("User cancelled restart", "error");
          return { success: false, error: "User cancelled restart" };
        }
      }

      // Pass the emitStatus callback to cdpService so it reports each step
      const result = await cdpService.connect(appPath, cdpPort, (text, level) => {
        emitStatus(text, level);
      });

      return result;
    }
  );

  ipcMain.handle(IPC.CDP_DISCONNECT, async () => {
    await cdpService.disconnect();
    return { success: true };
  });

  ipcMain.handle(IPC.CDP_GET_DOM, async () => {
    return cdpService.getDOM();
  });

  ipcMain.handle(IPC.CDP_EVALUATE, async (_event, js: string) => {
    return cdpService.evaluate(js);
  });

  ipcMain.handle(IPC.CDP_LIST_TARGETS, async () => {
    return cdpService.listTargets();
  });

  ipcMain.handle(IPC.CDP_GET_INFO, async (): Promise<CdpPageInfo | null> => {
    if (!cdpService.isConnected()) return null;
    try {
      emitStatus("Reading page info...", "progress");
      const info = await cdpService.getPageInfo();
      if (info.framework) {
        emitStatus(`Detected framework: ${info.framework}`, "info");
      } else {
        emitStatus("No framework detected", "info");
      }
      emitStatus("Agentlication complete", "success");
      return info;
    } catch (err) {
      emitStatus(`Failed to read page info: ${String(err)}`, "error");
      return null;
    }
  });

  // Agent operations — Companion chat (with CDP context)
  ipcMain.handle(
    IPC.AGENT_SEND,
    async (_event, message: string, modelId: string) => {
      const onEvent = (event: unknown) => {
        mainWindow?.webContents.send(IPC.AGENT_EVENT, event);
        if (companionWindow && !companionWindow.isDestroyed()) {
          companionWindow.webContents.send(IPC.AGENT_EVENT, event);
        }
      };
      return agentService.send(message, modelId, onEvent);
    }
  );

  // Agent operations — Hub / Setup Agent chat (custom system prompt, no CDP)
  ipcMain.handle(
    IPC.AGENT_SEND_HUB,
    async (_event, message: string, modelId: string, systemPrompt: string) => {
      const onEvent = (event: unknown) => {
        mainWindow?.webContents.send(IPC.AGENT_EVENT, event);
        if (companionWindow && !companionWindow.isDestroyed()) {
          companionWindow.webContents.send(IPC.AGENT_EVENT, event);
        }
      };
      return agentService.sendWithSystemPrompt(
        message,
        modelId,
        systemPrompt,
        onEvent
      );
    }
  );

  ipcMain.handle(IPC.AGENT_CANCEL, async () => {
    return agentService.cancel();
  });

  // Provider check — returns full status with install commands
  ipcMain.handle(IPC.PROVIDER_CHECK, async () => {
    return agentService.checkProviders();
  });

  // ── App preferences handlers ───────────────────────────────────
  ipcMain.handle(
    IPC.APP_UPDATE_PREFERENCES,
    async (_event, appName: string, prefs: { preferredModel?: string; thinkingLevel?: string }) => {
      try {
        const slug = slugify(appName);
        const profileFile = path.join(PROFILE_ROOT, slug, "profile.json");
        if (!fs.existsSync(profileFile)) {
          return { success: false, error: "Profile not found" };
        }
        const profile = JSON.parse(fs.readFileSync(profileFile, "utf-8")) as AppProfile;
        if (prefs.preferredModel !== undefined) profile.preferredModel = prefs.preferredModel;
        if (prefs.thinkingLevel !== undefined) profile.thinkingLevel = prefs.thinkingLevel;
        fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2), "utf-8");
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  );

  ipcMain.handle(
    IPC.APP_GET_PREFERENCES,
    async (_event, appName: string) => {
      try {
        const slug = slugify(appName);
        const profileFile = path.join(PROFILE_ROOT, slug, "profile.json");
        if (!fs.existsSync(profileFile)) return null;
        const profile = JSON.parse(fs.readFileSync(profileFile, "utf-8")) as AppProfile;
        return {
          preferredModel: profile.preferredModel,
          thinkingLevel: profile.thinkingLevel,
        };
      } catch {
        return null;
      }
    }
  );

  // ── Source repo handlers ───────────────────────────────────────
  ipcMain.handle(
    IPC.APP_FIND_SOURCE_REPO,
    async (_event, appName: string, bundleId?: string): Promise<SourceRepoFindResult> => {
      emitStatus(`Searching GitHub for ${appName} source repo...`, "progress");
      const result = await findSourceRepo(appName, bundleId);
      if (result.success && result.repo) {
        emitStatus(
          `Found source repo: ${result.repo.fullName} (${result.repo.confidence} confidence, ${result.repo.stars} stars)`,
          "success"
        );

        // Update the profile with the repo URL
        try {
          const slug = slugify(appName);
          const profileFile = path.join(PROFILE_ROOT, slug, "profile.json");
          if (fs.existsSync(profileFile)) {
            const profile = JSON.parse(fs.readFileSync(profileFile, "utf-8")) as AppProfile;
            profile.sourceRepoUrl = result.repo.repoUrl;
            profile.sourceCloneStatus = "searching";
            fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2), "utf-8");
          }
        } catch {
          // Non-critical — profile update failed but search result is still valid
        }
      } else if (result.error) {
        emitStatus(`Source repo search: ${result.error}`, "info");
      }
      return result;
    }
  );

  ipcMain.handle(
    IPC.APP_CLONE_SOURCE,
    async (_event, appName: string, repoUrl: string): Promise<SourceCloneResult> => {
      emitStatus(`Cloning ${repoUrl}...`, "progress");

      // Get the profile
      const slug = slugify(appName);
      const profileFile = path.join(PROFILE_ROOT, slug, "profile.json");
      if (!fs.existsSync(profileFile)) {
        emitStatus("Cannot clone: app profile not found", "error");
        return { success: false, error: "App profile not found" };
      }

      const profile = JSON.parse(fs.readFileSync(profileFile, "utf-8")) as AppProfile;

      // Update status to cloning
      profile.sourceCloneStatus = "cloning";
      fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2), "utf-8");

      const result = await cloneSourceRepo(profile, repoUrl, PROFILE_ROOT);

      if (result.success) {
        // Update profile with final status
        profile.sourceRepoUrl = repoUrl;
        profile.sourceCloneStatus = "done";
        fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2), "utf-8");

        let msg = `Source cloned to ${result.clonedTo}`;
        if (result.checkedOutVersion) {
          msg += ` (checked out ${result.checkedOutVersion})`;
        }
        emitStatus(msg, "success");
      } else {
        profile.sourceCloneStatus = "error";
        fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2), "utf-8");
        emitStatus(`Clone failed: ${result.error}`, "error");
      }

      return result;
    }
  );

  // ── Companion window handlers ──────────────────────────────────
  ipcMain.handle(IPC.COMPANION_OPEN, async (_event, appName: string) => {
    openCompanionWindow(appName);
  });

  ipcMain.handle(IPC.COMPANION_CLOSE, async () => {
    closeCompanionWindow();
  });
}

// ── Companion Window ──────────────────────────────────────────────

/** Get target app window bounds using Swift/CoreGraphics. Picks the largest window. */
function getTargetAppBounds(appName: string): { x: number; y: number; width: number; height: number } | null {
  try {
    const swift = `
import CoreGraphics
let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
var bestArea = 0
var bestBounds = ""
for w in windows {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] as? Int ?? 0
    let height = bounds["Height"] as? Int ?? 0
    let x = bounds["X"] as? Int ?? 0
    let y = bounds["Y"] as? Int ?? 0
    let area = width * height
    if owner == "${appName.replace(/"/g, '\\"')}" && width > 100 && height > 100 && area > bestArea {
        bestArea = area
        bestBounds = "\\(x),\\(y),\\(width),\\(height)"
    }
}
if !bestBounds.isEmpty { print(bestBounds) }
`;
    const result = execSync(`swift -e '${swift.replace(/'/g, "'\\''")}'`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!result) return null;
    const [x, y, width, height] = result.split(",").map(Number);
    if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

function openCompanionWindow(appName: string) {
  // If already open for the same app, just show it
  if (companionWindow && !companionWindow.isDestroyed()) {
    if (companionTargetAppName === appName) {
      companionWindow.show();
      return;
    }
    // Different app — close old window first
    closeCompanionWindow();
  }

  companionTargetAppName = appName;

  companionWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 300,
    minHeight: 400,
    type: "panel",
    alwaysOnTop: true,
    frame: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0a",
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  // Set floating level so it stays above regular windows
  companionWindow.setAlwaysOnTop(true, "floating");

  // Load renderer with companion mode query params
  const encodedAppName = encodeURIComponent(appName);
  if (isDev) {
    const devUrl = process.env.RENDERER_DEV_URL ?? "http://localhost:5173";
    companionWindow.loadURL(`${devUrl}?mode=companion&app=${encodedAppName}`);
  } else {
    const rendererPath = path.join(
      process.resourcesPath,
      "renderer",
      "index.html"
    );
    companionWindow.loadFile(rendererPath, {
      query: { mode: "companion", app: appName },
    });
  }

  // Position to the right of the target app
  companionWindow.once("ready-to-show", () => {
    if (!companionWindow || companionWindow.isDestroyed()) return;

    const bounds = getTargetAppBounds(appName);
    if (bounds) {
      companionWindow.setPosition(bounds.x + bounds.width, bounds.y);
      // Match target app height if reasonable
      const targetHeight = Math.max(400, Math.min(bounds.height, 900));
      companionWindow.setSize(400, targetHeight);
    }

    companionWindow.show();
  });

  companionWindow.on("closed", () => {
    companionWindow = null;
    companionTargetAppName = null;
    stopFocusTracking();
  });

  // Start focus tracking
  startFocusTracking(appName);
}

function closeCompanionWindow() {
  stopFocusTracking();
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.close();
  }
  companionWindow = null;
  companionTargetAppName = null;
}

function startFocusTracking(targetAppName: string) {
  stopFocusTracking();

  // Use macOS workspace notifications to track app focus changes
  if (process.platform === "darwin") {
    try {
      focusSubscriptionId = systemPreferences.subscribeWorkspaceNotification(
        "NSWorkspaceDidActivateApplicationNotification",
        (_event: string, userInfo: Record<string, unknown>, _object: string) => {
          if (!companionWindow || companionWindow.isDestroyed()) return;

          // userInfo contains NSWorkspaceApplicationKey with the activated app info
          const activeApp = userInfo?.["NSWorkspaceApplicationKey"] as Record<string, unknown> | undefined;
          const activeName = activeApp?.["NSApplicationName"] as string | undefined;

          // Show companion when the target app, Agentlication, or Electron (dev mode) is focused
          const shouldShow =
            activeName === targetAppName ||
            activeName === "Agentlication" ||
            activeName === "Electron";

          if (shouldShow) {
            companionWindow?.show();
          } else {
            companionWindow?.hide();
          }
        }
      );
    } catch {
      // Focus tracking not available — companion stays visible
    }
  }
}

function stopFocusTracking() {
  if (focusSubscriptionId !== null && process.platform === "darwin") {
    try {
      systemPreferences.unsubscribeWorkspaceNotification(focusSubscriptionId);
    } catch {
      // ignore
    }
    focusSubscriptionId = null;
  }
}

// ── App lifecycle ──────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  closeCompanionWindow();
  cdpService.disconnect();
  if (process.platform !== "darwin") app.quit();
});
