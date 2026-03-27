import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync } from "child_process";
import { IPC } from "@agentlication/contracts";
import type { AppProfile, TargetApp, CdpPageInfo } from "@agentlication/contracts";
import { AgentService } from "./agent-service";
import { CdpService } from "./cdp-service";
import { scanElectronApps, launchAppWithDebugging } from "./app-scanner";

let mainWindow: BrowserWindow | null = null;
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

        // Write harness.md
        const harnessContent = `# ${appData.name} — Companion Agent Harness

## About this app
${appData.name} is an Electron application located at ${appData.path}.

## Key areas
<!-- The Companion Agent will fill this in as it learns the app -->

## Learnings
<!-- Accumulated knowledge from past interactions -->
`;
        fs.writeFileSync(path.join(profileDir, "harness.md"), harnessContent, "utf-8");

        return { success: true, profile };
      } catch (err) {
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
      return cdpService.connect(appPath, cdpPort);
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
      return await cdpService.getPageInfo();
    } catch {
      return null;
    }
  });

  // Agent operations — Companion chat (with CDP context)
  ipcMain.handle(
    IPC.AGENT_SEND,
    async (_event, message: string, modelId: string) => {
      const onEvent = (event: unknown) => {
        mainWindow?.webContents.send(IPC.AGENT_EVENT, event);
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
  cdpService.disconnect();
  if (process.platform !== "darwin") app.quit();
});
