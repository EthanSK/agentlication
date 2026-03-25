import type { TargetApp, CdpTarget, AgentEvent, ProviderKind } from "@agentlication/contracts";

interface AgentlicationAPI {
  scanApps: () => Promise<TargetApp[]>;
  launchApp: (appPath: string) => Promise<{ success: boolean; port: number; error?: string }>;
  cdpConnect: (port: number) => Promise<{ success: boolean; error?: string }>;
  cdpGetDOM: () => Promise<string>;
  cdpEvaluate: (js: string) => Promise<unknown>;
  cdpListTargets: () => Promise<CdpTarget[]>;
  agentSend: (message: string, modelId: string) => Promise<void>;
  agentCancel: () => Promise<void>;
  onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
  checkProviders: () => Promise<Record<ProviderKind, boolean>>;
}

declare global {
  interface Window {
    agentlication: AgentlicationAPI;
  }
}

export {};
