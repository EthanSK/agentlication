import type {
  TargetApp,
  CdpTarget,
  CdpPageInfo,
  AgentEvent,
  AppProfile,
  ProviderStatusMap,
  StatusMessage,
  SourceRepoFindResult,
  SourceCloneResult,
  AgentAction,
  AgentActionResult,
  InteractiveElement,
} from "@agentlication/contracts";

interface AgentlicationAPI {
  scanApps: () => Promise<TargetApp[]>;
  launchApp: (appPath: string) => Promise<{ success: boolean; port: number; error?: string }>;
  isAppAgentlicated: (appName: string) => Promise<boolean>;
  createAppProfile: (appData: { name: string; path: string }) => Promise<{ success: boolean; profile?: AppProfile; error?: string }>;
  getAppProfile: (appName: string) => Promise<AppProfile | null>;
  cdpConnect: (appPath: string, cdpPort: number) => Promise<{ success: boolean; error?: string }>;
  cdpDisconnect: () => Promise<{ success: boolean }>;
  cdpGetDOM: () => Promise<string>;
  cdpEvaluate: (js: string) => Promise<unknown>;
  cdpListTargets: () => Promise<CdpTarget[]>;
  cdpGetInfo: () => Promise<CdpPageInfo | null>;
  cdpClick: (selector: string) => Promise<AgentActionResult>;
  cdpClickText: (text: string, tagFilter?: string) => Promise<AgentActionResult>;
  cdpType: (selector: string, text: string) => Promise<AgentActionResult>;
  cdpGetElements: () => Promise<InteractiveElement[]>;
  cdpGetA11yTree: (depth?: number) => Promise<string>;
  cdpScreenshot: () => Promise<string>;
  cdpPressKey: (key: string) => Promise<AgentActionResult>;
  cdpScroll: (selector: string) => Promise<AgentActionResult>;
  cdpNavigate: (url: string) => Promise<AgentActionResult>;
  cdpExecuteAction: (action: AgentAction) => Promise<AgentActionResult>;
  agentSend: (message: string, modelId: string) => Promise<void>;
  agentSendHub: (message: string, modelId: string, systemPrompt: string) => Promise<void>;
  agentCancel: () => Promise<void>;
  onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
  checkProviders: () => Promise<ProviderStatusMap>;
  updateAppPreferences: (appName: string, prefs: { preferredModel?: string; thinkingLevel?: string }) => Promise<{ success: boolean; error?: string }>;
  getAppPreferences: (appName: string) => Promise<{ preferredModel?: string; thinkingLevel?: string } | null>;
  openCompanion: (appName: string) => Promise<void>;
  closeCompanion: () => Promise<void>;
  findSourceRepo: (appName: string, bundleId?: string) => Promise<SourceRepoFindResult>;
  cloneSource: (appName: string, repoUrl: string) => Promise<SourceCloneResult>;
  companionAgentSend: (payload: { appName: string; message: string; modelId: string }) => Promise<void>;
  onStatusMessage: (callback: (msg: StatusMessage) => void) => () => void;
}

declare global {
  interface Window {
    agentlication: AgentlicationAPI;
  }
}

export {};
