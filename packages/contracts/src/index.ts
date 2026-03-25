// ── Provider types ──────────────────────────────────────────────

export type ProviderKind = "claude" | "codex";

export interface ProviderModel {
  id: string;
  label: string;
  provider: ProviderKind;
  cliName: string; // the CLI binary name (e.g. "claude", "codex")
}

export const MODELS: ProviderModel[] = [
  { id: "sonnet-4.5", label: "Claude Sonnet 4.5", provider: "claude", cliName: "claude" },
  { id: "opus-4.6", label: "Claude Opus 4.6", provider: "claude", cliName: "claude" },
  { id: "gpt-5.4", label: "Codex GPT-5.4", provider: "codex", cliName: "codex" },
  { id: "gpt-5.3", label: "Codex GPT-5.3", provider: "codex", cliName: "codex" },
];

// Group models by provider for UI display
export const MODEL_GROUPS: { provider: ProviderKind; label: string; models: ProviderModel[] }[] = [
  {
    provider: "claude",
    label: "Claude",
    models: MODELS.filter((m) => m.provider === "claude"),
  },
  {
    provider: "codex",
    label: "Codex",
    models: MODELS.filter((m) => m.provider === "codex"),
  },
];

// ── Thinking / effort modes ─────────────────────────────────────

export interface ThinkingLevel {
  value: string;
  label: string;
}

export const THINKING_LEVELS: Record<ProviderKind, ThinkingLevel[]> = {
  claude: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  codex: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ],
};

export const DEFAULT_THINKING_LEVEL: Record<ProviderKind, string> = {
  claude: "medium",
  codex: "medium",
};

// ── Provider status ─────────────────────────────────────────────

export interface ProviderStatus {
  installed: boolean;
  installCommand: string;
}

export type ProviderStatusMap = Record<ProviderKind, ProviderStatus>;

export const PROVIDER_INSTALL_COMMANDS: Record<ProviderKind, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
};

// ── Agent events (main <-> renderer IPC) ─────────────────────────

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
