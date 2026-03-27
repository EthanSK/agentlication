import type {
  TargetApp,
  CdpTarget,
  CdpPageInfo,
  AgentEvent,
  AppProfile,
  ProviderStatusMap,
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
  agentSend: (message: string, modelId: string) => Promise<void>;
  agentSendHub: (message: string, modelId: string, systemPrompt: string) => Promise<void>;
  agentCancel: () => Promise<void>;
  onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
  checkProviders: () => Promise<ProviderStatusMap>;
  openCompanion: (appName: string) => Promise<void>;
  closeCompanion: () => Promise<void>;
}

declare global {
  interface Window {
    agentlication: AgentlicationAPI;
  }
}

export {};
