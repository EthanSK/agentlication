// ── Provider types ──────────────────────────────────────────────

export type ProviderKind = "claude" | "codex";

export interface ProviderModel {
  id: string;
  label: string;
  provider: ProviderKind;
  cliName: string; // the CLI binary name (e.g. "claude", "codex")
}

// Models are ordered biggest/latest first. Update this list when new models are released.
export const MODELS: ProviderModel[] = [
  { id: "opus-4.6", label: "Claude Opus 4.6", provider: "claude", cliName: "claude" },
  { id: "sonnet-4.5", label: "Claude Sonnet 4.5", provider: "claude", cliName: "claude" },
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

// Default thinking level — update if new levels are added
export const DEFAULT_THINKING_LEVEL: Record<ProviderKind, string> = {
  claude: "high",
  codex: "high",
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

// ── Status feed types ─────────────────────────────────────────

export type StatusLevel = "info" | "success" | "error" | "progress";

export interface StatusMessage {
  id: string;
  text: string;
  level: StatusLevel;
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

/** Info gathered after connecting to a target app via CDP. */
export interface CdpPageInfo {
  title: string;
  url: string;
  framework: string | null; // "react" | "vue" | "angular" | null
  localStorageKeys: string[];
  documentStructure: string; // brief summary of top-level DOM tags
}

/** Status of a CDP connection for a given app slug. */
export type CdpConnectionStatus = "connected" | "disconnected" | "connecting" | "error";

// ── App profile types ─────────────────────────────────────────

export interface AppProfile {
  name: string;           // Display name
  slug: string;           // Directory name (slugified)
  bundleId: string;       // macOS bundle ID if available
  appPath: string;        // Full path to .app
  installedVersion: string; // Version from Info.plist
  cdpPort: number;        // Auto-assigned CDP port
  sourceRepoUrl: string;  // Empty initially
  sourceCloneStatus?: SourceCloneStatus; // Status of source repo cloning
  dateAgentlicated: string; // ISO date
  preferredModel?: string;   // Per-app model override (e.g. "opus-4.6")
  thinkingLevel?: string;    // Per-app thinking level override (e.g. "high")
}

// ── Source repo types ─────────────────────────────────────────

export type SourceCloneStatus = "idle" | "searching" | "cloning" | "checking-out" | "done" | "error";

export interface SourceRepoSearchResult {
  repoUrl: string;
  fullName: string;       // e.g. "EthanSK/producer-player"
  description: string;
  stars: number;
  confidence: "high" | "medium" | "low" | "none";
}

export interface SourceRepoFindResult {
  success: boolean;
  repo?: SourceRepoSearchResult;
  candidates?: SourceRepoSearchResult[];
  error?: string;
}

export interface SourceCloneResult {
  success: boolean;
  clonedTo?: string;       // Path to cloned repo
  checkedOutVersion?: string; // Tag that was checked out, if any
  error?: string;
}

// ── IPC channel names ──────────────────────────────────────────

export const IPC = {
  // App picker
  SCAN_APPS: "app:scan",
  LAUNCH_APP: "app:launch",
  APP_IS_AGENTLICATED: "app:is-agentlicated",
  APP_CREATE_PROFILE: "app:create-profile",
  APP_GET_PROFILE: "app:get-profile",

  // CDP
  CDP_CONNECT: "cdp:connect",
  CDP_DISCONNECT: "cdp:disconnect",
  CDP_GET_DOM: "cdp:get-dom",
  CDP_EVALUATE: "cdp:evaluate",
  CDP_LIST_TARGETS: "cdp:list-targets",
  CDP_GET_INFO: "cdp:get-info",

  // Agent
  AGENT_SEND: "agent:send",
  AGENT_SEND_HUB: "agent:send-hub",
  AGENT_EVENT: "agent:event",
  AGENT_CANCEL: "agent:cancel",

  // Provider
  PROVIDER_CHECK: "provider:check",

  // App preferences
  APP_UPDATE_PREFERENCES: "app:update-preferences",
  APP_GET_PREFERENCES: "app:get-preferences",

  // Companion window
  COMPANION_OPEN: "companion:open",
  COMPANION_CLOSE: "companion:close",
  COMPANION_STATUS: "companion:status",

  // Source repo
  APP_FIND_SOURCE_REPO: "app:find-source-repo",
  APP_CLONE_SOURCE: "app:clone-source",
} as const;
