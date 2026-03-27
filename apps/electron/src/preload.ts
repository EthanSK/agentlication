import { contextBridge, ipcRenderer } from "electron";

// IPC channel names inlined here because sandboxed preload scripts cannot
// require non-electron modules (like @agentlication/contracts).
// Keep these in sync with packages/contracts/src/index.ts → IPC.
const IPC = {
  SCAN_APPS: "app:scan",
  LAUNCH_APP: "app:launch",
  APP_IS_AGENTLICATED: "app:is-agentlicated",
  APP_CREATE_PROFILE: "app:create-profile",
  APP_GET_PROFILE: "app:get-profile",
  APP_UPDATE_PREFERENCES: "app:update-preferences",
  APP_GET_PREFERENCES: "app:get-preferences",
  CDP_CONNECT: "cdp:connect",
  CDP_DISCONNECT: "cdp:disconnect",
  CDP_GET_DOM: "cdp:get-dom",
  CDP_EVALUATE: "cdp:evaluate",
  CDP_LIST_TARGETS: "cdp:list-targets",
  CDP_GET_INFO: "cdp:get-info",
  AGENT_SEND: "agent:send",
  AGENT_SEND_HUB: "agent:send-hub",
  AGENT_EVENT: "agent:event",
  AGENT_CANCEL: "agent:cancel",
  PROVIDER_CHECK: "provider:check",
  COMPANION_OPEN: "companion:open",
  COMPANION_CLOSE: "companion:close",
  COMPANION_STATUS: "companion:status",
  APP_FIND_SOURCE_REPO: "app:find-source-repo",
  APP_CLONE_SOURCE: "app:clone-source",
  COMPANION_AGENT_SEND: "companion:agent-send",
} as const;

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld("agentlication", {
  // App picker
  scanApps: () => ipcRenderer.invoke(IPC.SCAN_APPS),
  launchApp: (appPath: string) => ipcRenderer.invoke(IPC.LAUNCH_APP, appPath),
  isAppAgentlicated: (appName: string) => ipcRenderer.invoke(IPC.APP_IS_AGENTLICATED, appName),
  createAppProfile: (appData: { name: string; path: string }) =>
    ipcRenderer.invoke(IPC.APP_CREATE_PROFILE, appData),
  getAppProfile: (appName: string) => ipcRenderer.invoke(IPC.APP_GET_PROFILE, appName),

  // CDP
  cdpConnect: (appPath: string, cdpPort: number) =>
    ipcRenderer.invoke(IPC.CDP_CONNECT, appPath, cdpPort),
  cdpDisconnect: () => ipcRenderer.invoke(IPC.CDP_DISCONNECT),
  cdpGetDOM: () => ipcRenderer.invoke(IPC.CDP_GET_DOM),
  cdpEvaluate: (js: string) => ipcRenderer.invoke(IPC.CDP_EVALUATE, js),
  cdpListTargets: () => ipcRenderer.invoke(IPC.CDP_LIST_TARGETS),
  cdpGetInfo: () => ipcRenderer.invoke(IPC.CDP_GET_INFO),

  // Agent
  agentSend: (message: string, modelId: string) =>
    ipcRenderer.invoke(IPC.AGENT_SEND, message, modelId),
  agentSendHub: (message: string, modelId: string, systemPrompt: string) =>
    ipcRenderer.invoke(IPC.AGENT_SEND_HUB, message, modelId, systemPrompt),
  agentCancel: () => ipcRenderer.invoke(IPC.AGENT_CANCEL),
  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.AGENT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, handler);
  },

  // Provider
  checkProviders: () => ipcRenderer.invoke(IPC.PROVIDER_CHECK),

  // App preferences
  updateAppPreferences: (appName: string, prefs: { preferredModel?: string; thinkingLevel?: string }) =>
    ipcRenderer.invoke(IPC.APP_UPDATE_PREFERENCES, appName, prefs),
  getAppPreferences: (appName: string) =>
    ipcRenderer.invoke(IPC.APP_GET_PREFERENCES, appName),

  // Companion window
  openCompanion: (appName: string) => ipcRenderer.invoke(IPC.COMPANION_OPEN, appName),
  closeCompanion: () => ipcRenderer.invoke(IPC.COMPANION_CLOSE),

  // Source repo
  findSourceRepo: (appName: string, bundleId?: string) =>
    ipcRenderer.invoke(IPC.APP_FIND_SOURCE_REPO, appName, bundleId),
  cloneSource: (appName: string, repoUrl: string) =>
    ipcRenderer.invoke(IPC.APP_CLONE_SOURCE, appName, repoUrl),

  // Companion agent (with HARNESS.md + DOM context)
  companionAgentSend: (payload: { appName: string; message: string; modelId: string }) =>
    ipcRenderer.invoke(IPC.COMPANION_AGENT_SEND, payload),

  // Status feed
  onStatusMessage: (callback: (msg: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.COMPANION_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.COMPANION_STATUS, handler);
  },
});
