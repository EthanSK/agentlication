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

/** Optional icon hint — overrides the default level-based icon in the UI. */
export type StatusIcon = "success" | "progress" | "error" | "searching" | "file" | "connection" | "info";

export interface StatusMessage {
  id: string;
  text: string;
  level: StatusLevel;
  icon?: StatusIcon;
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
  isElectron: boolean;    // Whether this is an Electron app
  installedVersion: string; // Version from Info.plist
  cdpPort: number;        // Auto-assigned CDP port (0 for non-Electron)
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

// ── Agent action types (CDP tool-use) ────────────────────────────

export type AgentActionKind =
  | "click"
  | "type"
  | "eval"
  | "click_text"
  | "select"
  | "scroll"
  | "wait"
  | "screenshot"
  | "get_elements"
  | "get_a11y_tree"
  | "navigate"
  | "press_key"
  // Native AX actions (prefixed with ax_)
  | "ax_click"
  | "ax_type"
  | "ax_focus"
  | "ax_get_tree"
  | "ax_elements"
  | "ax_set_value"
  | "ax_action"
  | "ax_info";

export interface AgentAction {
  action: AgentActionKind;
  selector?: string;      // CSS selector
  text?: string;          // Text to type, or text content to find
  expression?: string;    // JS expression for eval
  value?: string;         // Value for select
  key?: string;           // Key for press_key (e.g., "Enter", "Tab")
  x?: number;             // Coordinates for click
  y?: number;
  timeout?: number;       // Max wait time in ms
  depth?: number;         // Depth for a11y tree
  tagFilter?: string;     // Tag filter for click_text
  label?: string;         // AX element label (for ax_ actions)
  axAction?: string;      // AX action name (e.g. "AXPress", "AXShowMenu")
  appName?: string;       // Target app name (for ax_ actions)
}

export interface AgentActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** An interactive element found via getInteractiveElements. */
export interface InteractiveElement {
  index: number;
  tag: string;
  type?: string;
  role?: string;
  text: string;
  ariaLabel?: string;
  placeholder?: string;
  selector: string;
  value?: string;
  disabled: boolean;
  checked?: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

// ── Accessibility (native macOS app) types ─────────────────────

/** A single node in the macOS accessibility tree. */
export interface AXElement {
  role: string;
  name: string;
  value?: string;
  description?: string;
  identifier?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  enabled: boolean;
  focused?: boolean;
  actions: string[];
  children?: AXElement[];
}

/** The full accessibility tree for a native app. */
export interface AXTree {
  appName: string;
  pid: number;
  tree: AXElement;
  timestamp: number;
}

/** Result of an accessibility action (click, type, focus, etc.). */
export interface AXActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Info about a running native app. */
export interface AXAppInfo {
  name: string;
  pid: number;
  bundleId?: string;
  windows: Array<{
    title: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>;
  menuBarItems?: string[];
}

/** An interactive element discovered via the AX API. */
export interface AXInteractiveElement {
  index: number;
  role: string;
  name: string;
  value?: string;
  description?: string;
  enabled: boolean;
  actions: string[];
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

/** Agent action kinds for native AX interactions. */
export type AXAgentActionKind =
  | "ax_click"
  | "ax_type"
  | "ax_focus"
  | "ax_get_tree"
  | "ax_elements"
  | "ax_set_value"
  | "ax_action"
  | "ax_info";

/** Agent action for native AX interactions (used in tool blocks). */
export interface AXAgentAction {
  action: AXAgentActionKind;
  label?: string;      // Element label/name to target
  text?: string;       // Text to type
  value?: string;      // Value to set
  axAction?: string;   // AX action name (e.g. "AXPress", "AXShowMenu")
  depth?: number;      // Tree depth
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

  // Companion agent (with HARNESS.md + DOM context)
  COMPANION_AGENT_SEND: "companion:agent-send",

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

  // Companion agent for native apps (with AX context)
  COMPANION_NATIVE_AGENT_SEND: "companion:native-agent-send",
} as const;
