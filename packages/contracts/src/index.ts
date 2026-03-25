// ── Provider types ──────────────────────────────────────────────

export type ProviderKind = "claude" | "codex";

export interface ProviderModel {
  id: string;
  label: string;
  provider: ProviderKind;
}

export const MODELS: ProviderModel[] = [
  { id: "sonnet", label: "Claude Sonnet", provider: "claude" },
  { id: "opus", label: "Claude Opus", provider: "claude" },
  { id: "gpt-5.4", label: "Codex GPT-5.4", provider: "codex" },
];

// ── Agent events (main ↔ renderer IPC) ─────────────────────────

export type AgentEventKind =
  | "agent:chunk"      // streaming text chunk
  | "agent:done"       // generation complete
  | "agent:error"      // something went wrong
  | "agent:tool-use"   // agent wants to execute JS via CDP
  | "agent:tool-result"; // result of CDP execution

export interface AgentEvent {
  kind: AgentEventKind;
  payload: unknown;
  timestamp: number;
}

export interface AgentChunk {
  text: string;
}

export interface AgentToolUse {
  js: string; // JavaScript to execute on target app
}

export interface AgentToolResult {
  result: unknown;
  error?: string;
}

// ── Chat types ─────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
}

// ── Target app types ───────────────────────────────────────────

export interface TargetApp {
  name: string;
  path: string;
  icon?: string; // base64 data URI
  isElectron: boolean;
}

export interface CdpTarget {
  id: string;
  title: string;
  url: string;
  type: string;
}

// ── IPC channel names ──────────────────────────────────────────

export const IPC = {
  // App picker
  SCAN_APPS: "app:scan",
  LAUNCH_APP: "app:launch",

  // CDP
  CDP_CONNECT: "cdp:connect",
  CDP_GET_DOM: "cdp:get-dom",
  CDP_EVALUATE: "cdp:evaluate",
  CDP_LIST_TARGETS: "cdp:list-targets",

  // Agent
  AGENT_SEND: "agent:send",
  AGENT_EVENT: "agent:event",
  AGENT_CANCEL: "agent:cancel",

  // Provider
  PROVIDER_CHECK: "provider:check",
} as const;
