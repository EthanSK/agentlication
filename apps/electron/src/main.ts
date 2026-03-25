import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
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
    width: 1200,
    height: 800,
    title: "Agentlication",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
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

  // Agent operations
  ipcMain.handle(
    IPC.AGENT_SEND,
    async (_event, message: string, modelId: string) => {
      // Stream events back to renderer via the event channel
      const onEvent = (event: unknown) => {
        mainWindow?.webContents.send(IPC.AGENT_EVENT, event);
      };
      return agentService.send(message, modelId, onEvent);
    }
  );

  ipcMain.handle(IPC.AGENT_CANCEL, async () => {
    return agentService.cancel();
  });

  // Provider check
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
