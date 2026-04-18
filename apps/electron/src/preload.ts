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
  CDP_CLICK: "cdp:click",
  CDP_CLICK_TEXT: "cdp:click-text",
  CDP_TYPE: "cdp:type",
  CDP_GET_ELEMENTS: "cdp:get-elements",
  CDP_GET_A11Y_TREE: "cdp:get-a11y-tree",
  CDP_SCREENSHOT: "cdp:screenshot",
  CDP_PRESS_KEY: "cdp:press-key",
  CDP_SCROLL: "cdp:scroll",
  CDP_NAVIGATE: "cdp:navigate",
  CDP_EXECUTE_ACTION: "cdp:execute-action",
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

  // Patch management
  PATCH_LIST: "patch:list",
  PATCH_CREATE: "patch:create",
  PATCH_UPDATE: "patch:update",
  PATCH_DELETE: "patch:delete",
  PATCH_ENABLE: "patch:enable",
  PATCH_DISABLE: "patch:disable",
  PATCH_INJECT: "patch:inject",
  PATCH_INJECT_ALL: "patch:inject-all",
  PATCH_GET: "patch:get",
  PATCH_ERROR: "patch:error",
  PATCH_STATUS: "patch:status",

  // Accessibility (native macOS apps)
  AX_TREE: "ax:tree",
  AX_CLICK: "ax:click",
  AX_TYPE: "ax:type",
  AX_FOCUS: "ax:focus",
  AX_ELEMENTS: "ax:elements",
  AX_ACTION: "ax:action",
  AX_SET_VALUE: "ax:set-value",
  AX_CHECK_PERMISSION: "ax:check-permission",
  AX_INFO: "ax:info",
  AX_EXECUTE_ACTION: "ax:execute-action",
  COMPANION_NATIVE_AGENT_SEND: "companion:native-agent-send",
} as const;

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld("agentlication", {
  // App picker
  scanApps: (options?: { includeHiddenApps?: boolean }) =>
    ipcRenderer.invoke(IPC.SCAN_APPS, options),
  launchApp: (appPath: string) => ipcRenderer.invoke(IPC.LAUNCH_APP, appPath),
  isAppAgentlicated: (appName: string) => ipcRenderer.invoke(IPC.APP_IS_AGENTLICATED, appName),
  createAppProfile: (appData: { name: string; path: string; isElectron?: boolean }) =>
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
  cdpClick: (selector: string) => ipcRenderer.invoke(IPC.CDP_CLICK, selector),
  cdpClickText: (text: string, tagFilter?: string) =>
    ipcRenderer.invoke(IPC.CDP_CLICK_TEXT, text, tagFilter),
  cdpType: (selector: string, text: string) =>
    ipcRenderer.invoke(IPC.CDP_TYPE, selector, text),
  cdpGetElements: () => ipcRenderer.invoke(IPC.CDP_GET_ELEMENTS),
  cdpGetA11yTree: (depth?: number) => ipcRenderer.invoke(IPC.CDP_GET_A11Y_TREE, depth),
  cdpScreenshot: () => ipcRenderer.invoke(IPC.CDP_SCREENSHOT),
  cdpPressKey: (key: string) => ipcRenderer.invoke(IPC.CDP_PRESS_KEY, key),
  cdpScroll: (selector: string) => ipcRenderer.invoke(IPC.CDP_SCROLL, selector),
  cdpNavigate: (url: string) => ipcRenderer.invoke(IPC.CDP_NAVIGATE, url),
  cdpExecuteAction: (action: unknown) => ipcRenderer.invoke(IPC.CDP_EXECUTE_ACTION, action),

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

  // Patch management
  patchList: (appSlug: string) =>
    ipcRenderer.invoke(IPC.PATCH_LIST, appSlug),
  patchCreate: (req: unknown) =>
    ipcRenderer.invoke(IPC.PATCH_CREATE, req),
  patchUpdate: (req: unknown) =>
    ipcRenderer.invoke(IPC.PATCH_UPDATE, req),
  patchDelete: (appSlug: string, name: string) =>
    ipcRenderer.invoke(IPC.PATCH_DELETE, appSlug, name),
  patchEnable: (appSlug: string, name: string) =>
    ipcRenderer.invoke(IPC.PATCH_ENABLE, appSlug, name),
  patchDisable: (appSlug: string, name: string) =>
    ipcRenderer.invoke(IPC.PATCH_DISABLE, appSlug, name),
  patchGet: (appSlug: string, name: string) =>
    ipcRenderer.invoke(IPC.PATCH_GET, appSlug, name),
  patchInject: (appSlug: string, name: string) =>
    ipcRenderer.invoke(IPC.PATCH_INJECT, appSlug, name),
  patchInjectAll: (appSlug: string) =>
    ipcRenderer.invoke(IPC.PATCH_INJECT_ALL, appSlug),
  onPatchError: (callback: (error: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.PATCH_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.PATCH_ERROR, handler);
  },
  onPatchStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.PATCH_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.PATCH_STATUS, handler);
  },

  // Accessibility (native macOS apps)
  axCheckPermission: () => ipcRenderer.invoke(IPC.AX_CHECK_PERMISSION),
  axTree: (appName: string, depth?: number) =>
    ipcRenderer.invoke(IPC.AX_TREE, appName, depth),
  axClick: (appName: string, label: string) =>
    ipcRenderer.invoke(IPC.AX_CLICK, appName, label),
  axType: (appName: string, text: string) =>
    ipcRenderer.invoke(IPC.AX_TYPE, appName, text),
  axFocus: (appName: string, label: string) =>
    ipcRenderer.invoke(IPC.AX_FOCUS, appName, label),
  axElements: (appName: string) =>
    ipcRenderer.invoke(IPC.AX_ELEMENTS, appName),
  axAction: (appName: string, action: string, label: string) =>
    ipcRenderer.invoke(IPC.AX_ACTION, appName, action, label),
  axSetValue: (appName: string, label: string, value: string) =>
    ipcRenderer.invoke(IPC.AX_SET_VALUE, appName, label, value),
  axInfo: (appName: string) =>
    ipcRenderer.invoke(IPC.AX_INFO, appName),
  axExecuteAction: (appName: string, action: unknown) =>
    ipcRenderer.invoke(IPC.AX_EXECUTE_ACTION, appName, action),

  // Companion agent for native apps (with AX context)
  companionNativeAgentSend: (payload: { appName: string; message: string; modelId: string }) =>
    ipcRenderer.invoke(IPC.COMPANION_NATIVE_AGENT_SEND, payload),

  // Status feed
  onStatusMessage: (callback: (msg: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.COMPANION_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.COMPANION_STATUS, handler);
  },
});
