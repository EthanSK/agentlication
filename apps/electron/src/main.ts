import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { IPC } from "@agentlication/contracts";
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

// ── IPC Handlers ───────────────────────────────────────────────

function registerIpcHandlers() {
  // App scanning
  ipcMain.handle(IPC.SCAN_APPS, async () => {
    return scanElectronApps();
  });

  // Check if an app has been agentlicated (has a per-app profile)
  ipcMain.handle(IPC.APP_IS_AGENTLICATED, async (_event, appName: string) => {
    const profileDir = path.join(os.homedir(), ".agentlication", "apps", appName);
    try {
      const stat = fs.statSync(profileDir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  });

  // Launch target app with debugging
  ipcMain.handle(IPC.LAUNCH_APP, async (_event, appPath: string) => {
    return launchAppWithDebugging(appPath);
  });

  // CDP operations
  ipcMain.handle(IPC.CDP_CONNECT, async (_event, port: number) => {
    return cdpService.connect(port);
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
