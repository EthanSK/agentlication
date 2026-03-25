import { contextBridge, ipcRenderer } from "electron";

// IPC channel names inlined here because sandboxed preload scripts cannot
// require non-electron modules (like @agentlication/contracts).
// Keep these in sync with packages/contracts/src/index.ts → IPC.
const IPC = {
  SCAN_APPS: "app:scan",
  LAUNCH_APP: "app:launch",
  APP_IS_AGENTIFIED: "app:is-agentified",
  CDP_CONNECT: "cdp:connect",
  CDP_GET_DOM: "cdp:get-dom",
  CDP_EVALUATE: "cdp:evaluate",
  CDP_LIST_TARGETS: "cdp:list-targets",
  AGENT_SEND: "agent:send",
  AGENT_SEND_HUB: "agent:send-hub",
  AGENT_EVENT: "agent:event",
  AGENT_CANCEL: "agent:cancel",
  PROVIDER_CHECK: "provider:check",
} as const;

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld("agentlication", {
  // App picker
  scanApps: () => ipcRenderer.invoke(IPC.SCAN_APPS),
  launchApp: (appPath: string) => ipcRenderer.invoke(IPC.LAUNCH_APP, appPath),
  isAppAgentified: (appName: string) => ipcRenderer.invoke(IPC.APP_IS_AGENTIFIED, appName),

  // CDP
  cdpConnect: (port: number) => ipcRenderer.invoke(IPC.CDP_CONNECT, port),
  cdpGetDOM: () => ipcRenderer.invoke(IPC.CDP_GET_DOM),
  cdpEvaluate: (js: string) => ipcRenderer.invoke(IPC.CDP_EVALUATE, js),
  cdpListTargets: () => ipcRenderer.invoke(IPC.CDP_LIST_TARGETS),

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
});
