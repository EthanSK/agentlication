import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@agentlication/contracts";

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
  agentCancel: () => ipcRenderer.invoke(IPC.AGENT_CANCEL),
  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.AGENT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, handler);
  },

  // Provider
  checkProviders: () => ipcRenderer.invoke(IPC.PROVIDER_CHECK),
});
