import { spawn, ChildProcess, execFileSync } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import {
  AgentEvent,
  ProviderKind,
  MODELS,
  ProviderStatusMap,
  PROVIDER_INSTALL_COMMANDS,
} from "@agentlication/contracts";
import type { AgentAction, AgentActionResult, InteractiveElement, AXInteractiveElement, PatchCreateRequest, PatchUpdateRequest } from "@agentlication/contracts";
import { CdpService } from "./cdp-service";
import { AccessibilityService } from "./accessibility-service";
import { PatchService } from "./patch-service";

// ── Provider abstraction ───────────────────────────────────────

interface Provider {
  send(
    message: string,
    systemPrompt: string,
    modelId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
}

/**
 * Resolve the full path to a CLI binary. Checks common locations that
 * Electron's child processes might not have on PATH.
 */
function resolveCliBinary(name: string): string | null {
  // Try common install locations first (Electron often has a minimal PATH)
  const candidates = [
    path.join(os.homedir(), ".local", "bin", name),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    path.join(os.homedir(), ".npm-global", "bin", name),
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not found here
    }
  }

  // Fall back to `which` via shell
  try {
    return execFileSync("which", [name], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      env: { ...process.env, PATH: `${process.env.PATH || ""}:${path.join(os.homedir(), ".local", "bin")}:/usr/local/bin:/opt/homebrew/bin` },
    }).trim();
  } catch {
    return null;
  }
}

function cliExists(name: string): boolean {
  return resolveCliBinary(name) !== null;
}

/**
 * Get the version string from a CLI tool, or null if unavailable.
 */
function getCliVersion(name: string, args: string[] = ["--version"]): string | null {
  try {
    return execFileSync(name, args, {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

// TODO: Implement true dynamic model discovery when the CLIs support listing
// available models (e.g. `claude models list`, `codex --list-models`).
// For now we verify CLI availability via version checks at startup and keep
// the model list hardcoded in @agentlication/contracts.

class ClaudeProvider implements Provider {
  private process: ChildProcess | null = null;
  private resolvedPath: string | null = null;
  public cliVersion: string | null = null;

  async isAvailable(): Promise<boolean> {
    const resolved = resolveCliBinary("claude");
    if (!resolved) return false;
    this.resolvedPath = resolved;
    // Verify the CLI actually works by checking its version
    this.cliVersion = getCliVersion(resolved, ["--version"]);
    return this.cliVersion !== null;
  }

  async send(
    message: string,
    systemPrompt: string,
    modelId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const available = await this.isAvailable();
    if (!available || !this.resolvedPath) {
      onEvent({
        kind: "agent:error",
        payload: {
          message: `Claude CLI not found. Install with: ${PROVIDER_INSTALL_COMMANDS.claude}`,
        },
        timestamp: Date.now(),
      });
      return;
    }

    // Map model IDs to claude CLI model names
    const modelMap: Record<string, string> = {
      "sonnet-4.5": "sonnet",
      "opus-4.6": "opus",
    };
    const cliModel = modelMap[modelId] || "sonnet";

    return new Promise((resolve, reject) => {
      // Use the resolved absolute path so we don't need shell: true.
      // This avoids shell interpretation of special characters in the
      // system prompt and user message.
      const augmentedEnv = {
        ...process.env,
        PATH: `${process.env.PATH || ""}:${path.join(os.homedir(), ".local", "bin")}:/usr/local/bin:/opt/homebrew/bin`,
      };

      this.process = spawn(
        this.resolvedPath!,
        [
          "--print",
          "--verbose",
          "--output-format",
          "stream-json",
          "--model",
          cliModel,
          "--system-prompt",
          systemPrompt,
          message,
        ],
        { env: augmentedEnv }
      );

      let buffer = "";
      let doneSent = false;
      let hasEmittedContent = false;

      this.process.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            // Handle various stream-json event types from Claude CLI.
            // The stream-json format can emit content via three paths:
            //   1. content_block_delta — incremental streaming chunks
            //   2. assistant — full message with all content blocks
            //   3. result — final result text
            // We must only emit content ONCE. Track via hasEmittedContent.
            if (parsed.type === "content_block_delta") {
              hasEmittedContent = true;
              const text = parsed.delta?.text || "";
              if (text) {
                onEvent({
                  kind: "agent:chunk",
                  payload: { text },
                  timestamp: Date.now(),
                });
              }
            } else if (parsed.type === "assistant" && parsed.message?.content) {
              // Full message event — skip if we already emitted content.
              // Note: Claude CLI may emit multiple assistant events — the first
              // is often partial with empty text blocks. Only mark as emitted
              // once we actually send content to the consumer.
              if (!hasEmittedContent) {
                for (const block of parsed.message.content) {
                  if (block.type === "text" && block.text) {
                    hasEmittedContent = true;
                    onEvent({
                      kind: "agent:chunk",
                      payload: { text: block.text },
                      timestamp: Date.now(),
                    });
                  }
                }
              }
            } else if (
              parsed.type === "message_stop" ||
              parsed.type === "result"
            ) {
              // result event — only emit if no content was emitted yet
              if (parsed.result && !hasEmittedContent) {
                hasEmittedContent = true;
                onEvent({
                  kind: "agent:chunk",
                  payload: { text: parsed.result },
                  timestamp: Date.now(),
                });
              }
              if (!doneSent) {
                doneSent = true;
                onEvent({
                  kind: "agent:done",
                  payload: {},
                  timestamp: Date.now(),
                });
              }
            }
          } catch {
            // Not valid JSON yet, partial line — accumulate
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (
          text.toLowerCase().includes("error") ||
          text.toLowerCase().includes("unauthorized") ||
          text.toLowerCase().includes("expired")
        ) {
          onEvent({
            kind: "agent:error",
            payload: { message: text.trim() },
            timestamp: Date.now(),
          });
        }
      });

      this.process.on("close", (code) => {
        // Flush remaining buffer — only emit if we haven't emitted content yet
        if (buffer.trim() && !hasEmittedContent) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.result) {
              onEvent({
                kind: "agent:chunk",
                payload: { text: parsed.result },
                timestamp: Date.now(),
              });
            }
          } catch {
            if (buffer.trim().length > 0) {
              onEvent({
                kind: "agent:chunk",
                payload: { text: buffer.trim() },
                timestamp: Date.now(),
              });
            }
          }
        }

        if (!doneSent) {
          doneSent = true;
          onEvent({
            kind: "agent:done",
            payload: {},
            timestamp: Date.now(),
          });
        }

        this.process = null;
        if (code !== 0 && code !== null) {
          reject(new Error(`Claude CLI exited with code ${code}`));
        } else {
          resolve();
        }
      });

      this.process.on("error", (err) => {
        this.process = null;
        onEvent({
          kind: "agent:error",
          payload: { message: `Failed to spawn Claude CLI: ${err.message}` },
          timestamp: Date.now(),
        });
        reject(err);
      });
    });
  }

  cancel(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}

class CodexProvider implements Provider {
  private process: ChildProcess | null = null;
  private resolvedPath: string | null = null;
  public cliVersion: string | null = null;

  async isAvailable(): Promise<boolean> {
    const resolved = resolveCliBinary("codex");
    if (!resolved) return false;
    this.resolvedPath = resolved;
    // Verify the CLI actually works by checking its version
    this.cliVersion = getCliVersion(resolved, ["--version"]);
    return this.cliVersion !== null;
  }

  async send(
    message: string,
    _systemPrompt: string,
    modelId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const available = await this.isAvailable();
    if (!available || !this.resolvedPath) {
      onEvent({
        kind: "agent:error",
        payload: {
          message: `Codex CLI not found. Install with: ${PROVIDER_INSTALL_COMMANDS.codex}`,
        },
        timestamp: Date.now(),
      });
      return;
    }

    const modelMap: Record<string, string> = {
      "gpt-5.4": "gpt-5.4",
      "gpt-5.3": "gpt-5.3",
    };
    const cliModel = modelMap[modelId] || "gpt-5.4";

    const augmentedEnv = {
      ...process.env,
      PATH: `${process.env.PATH || ""}:${path.join(os.homedir(), ".local", "bin")}:/usr/local/bin:/opt/homebrew/bin`,
    };

    return new Promise((resolve, reject) => {
      this.process = spawn(
        this.resolvedPath!,
        [
          "exec",
          "--model",
          cliModel,
          "--dangerously-bypass-approvals-and-sandbox",
          "--skip-git-repo-check",
          "--json",
          message,
        ],
        { env: augmentedEnv }
      );

      let buffer = "";
      let doneSent = false;
      let hasStreamedDeltas = false;

      this.process.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            // Handle JSONL events from `codex exec --json`
            // Skip item.completed when we already streamed deltas — the
            // completed event contains the same full text that was already
            // sent incrementally via streaming_delta events.
            if (parsed.type === "item.completed" && parsed.item?.text) {
              if (!hasStreamedDeltas) {
                onEvent({
                  kind: "agent:chunk",
                  payload: { text: parsed.item.text },
                  timestamp: Date.now(),
                });
              }
            } else if (parsed.type === "item.streaming_delta" && parsed.delta) {
              hasStreamedDeltas = true;
              onEvent({
                kind: "agent:chunk",
                payload: { text: parsed.delta },
                timestamp: Date.now(),
              });
            } else if (parsed.type === "turn.completed") {
              if (!doneSent) {
                doneSent = true;
                onEvent({
                  kind: "agent:done",
                  payload: {},
                  timestamp: Date.now(),
                });
              }
            }
          } catch {
            // Partial JSON line — accumulate
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (
          text.toLowerCase().includes("error") ||
          text.toLowerCase().includes("not found")
        ) {
          onEvent({
            kind: "agent:error",
            payload: { message: text.trim() },
            timestamp: Date.now(),
          });
        }
      });

      this.process.on("close", (code) => {
        // Flush remaining buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.type === "item.completed" && parsed.item?.text && !hasStreamedDeltas) {
              onEvent({
                kind: "agent:chunk",
                payload: { text: parsed.item.text },
                timestamp: Date.now(),
              });
            }
          } catch {
            if (buffer.trim().length > 0 && !hasStreamedDeltas) {
              onEvent({
                kind: "agent:chunk",
                payload: { text: buffer.trim() },
                timestamp: Date.now(),
              });
            }
          }
        }

        if (!doneSent) {
          doneSent = true;
          onEvent({
            kind: "agent:done",
            payload: {},
            timestamp: Date.now(),
          });
        }

        this.process = null;
        if (code !== 0 && code !== null) {
          reject(new Error(`Codex CLI exited with code ${code}`));
        } else {
          resolve();
        }
      });

      this.process.on("error", (err) => {
        this.process = null;
        onEvent({
          kind: "agent:error",
          payload: { message: `Failed to spawn Codex CLI: ${err.message}` },
          timestamp: Date.now(),
        });
        reject(err);
      });
    });
  }

  cancel(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}

// ── Agent Service ──────────────────────────────────────────────

export class AgentService {
  private providers: Record<ProviderKind, Provider> = {
    claude: new ClaudeProvider(),
    codex: new CodexProvider(),
  };

  private currentProvider: Provider | null = null;
  private patchService: PatchService | null = null;
  private currentAppSlug: string | null = null;

  constructor(
    private cdpService: CdpService,
    private accessibilityService?: AccessibilityService
  ) {}

  /**
   * Set the PatchService instance for handling patch tool blocks.
   */
  setPatchService(patchService: PatchService): void {
    this.patchService = patchService;
  }

  /**
   * Set the current app slug (for routing patch actions).
   */
  setCurrentAppSlug(slug: string | null): void {
    this.currentAppSlug = slug;
  }

  /**
   * Execute an action, routing patch actions to PatchService.
   */
  private async executeAction(action: AgentAction): Promise<AgentActionResult> {
    // Route patch actions to PatchService
    if (this.isPatchAction(action.action)) {
      return this.executePatchAction(action);
    }
    // Route CDP actions to CdpService
    return this.cdpService.executeAction(action);
  }

  private isPatchAction(actionKind: string): boolean {
    return ["create_patch", "update_patch", "delete_patch", "list_patches", "enable_patch", "disable_patch"].includes(actionKind);
  }

  private async executePatchAction(action: AgentAction): Promise<AgentActionResult> {
    if (!this.patchService) {
      return { success: false, error: "PatchService not available" };
    }
    if (!this.currentAppSlug) {
      return { success: false, error: "No app connected (currentAppSlug not set)" };
    }

    const appSlug = this.currentAppSlug;

    switch (action.action) {
      case "create_patch": {
        if (!action.name || !action.code) {
          return { success: false, error: "create_patch requires 'name' and 'code'" };
        }
        const req: PatchCreateRequest = {
          appSlug,
          name: action.name,
          description: action.description || `Patch created by agent: ${action.name}`,
          format: action.format || "js",
          code: action.code,
          priority: action.priority,
          injectAt: action.inject_at,
          author: "companion-agent",
          tags: [],
        };
        const result = await this.patchService.createPatch(req);
        if (result.success) {
          return { success: true, data: { message: `Patch "${action.name}" created and injected`, patch: result.patch?.metadata } };
        }
        return { success: false, error: result.error };
      }

      case "update_patch": {
        if (!action.name) {
          return { success: false, error: "update_patch requires 'name'" };
        }
        const req: PatchUpdateRequest = {
          appSlug,
          name: action.name,
          code: action.code,
          enabled: action.enabled,
          priority: action.priority,
          description: action.description,
        };
        const result = await this.patchService.updatePatch(req);
        if (result.success) {
          return { success: true, data: { message: `Patch "${action.name}" updated`, patch: result.patch?.metadata } };
        }
        return { success: false, error: result.error };
      }

      case "delete_patch": {
        if (!action.name) {
          return { success: false, error: "delete_patch requires 'name'" };
        }
        const result = await this.patchService.deletePatch(appSlug, action.name);
        if (result.success) {
          return { success: true, data: { message: `Patch "${action.name}" deleted` } };
        }
        return { success: false, error: result.error };
      }

      case "list_patches": {
        const patches = await this.patchService.loadPatches(appSlug);
        const summary = patches.map(p => ({
          name: p.metadata.name,
          description: p.metadata.description,
          version: p.metadata.version,
          enabled: p.metadata.enabled,
          format: p.metadata.format,
          priority: p.metadata.priority,
          author: p.metadata.author,
        }));
        return { success: true, data: summary };
      }

      case "enable_patch": {
        if (!action.name) {
          return { success: false, error: "enable_patch requires 'name'" };
        }
        const result = await this.patchService.enablePatch(appSlug, action.name);
        if (result.success) {
          return { success: true, data: { message: `Patch "${action.name}" enabled` } };
        }
        return { success: false, error: result.error };
      }

      case "disable_patch": {
        if (!action.name) {
          return { success: false, error: "disable_patch requires 'name'" };
        }
        const result = await this.patchService.disablePatch(appSlug, action.name);
        if (result.success) {
          return { success: true, data: { message: `Patch "${action.name}" disabled` } };
        }
        return { success: false, error: result.error };
      }

      default:
        return { success: false, error: `Unknown patch action: ${action.action}` };
    }
  }

  async send(
    message: string,
    modelId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) {
      onEvent({
        kind: "agent:error",
        payload: { message: `Unknown model: ${modelId}` },
        timestamp: Date.now(),
      });
      return;
    }

    const provider = this.providers[model.provider];
    this.currentProvider = provider;

    // Build system prompt with interactive elements + a11y context + patches
    const systemPrompt = await buildSystemPromptWithActions(this.cdpService, this.patchService, this.currentAppSlug);

    // Tool-block accumulator for parsing ```tool blocks from streaming text
    let fullText = "";
    let executedToolBlocks = new Set<string>();

    try {
      await provider.send(message, systemPrompt, modelId, async (event) => {
        // Intercept chunks to look for tool blocks
        if (event.kind === "agent:chunk") {
          const chunk = event.payload as { text: string };
          fullText += chunk.text;

          // Check for complete tool blocks
          const actions = parseToolBlocks(fullText);
          for (const { raw, action } of actions) {
            if (executedToolBlocks.has(raw)) continue;
            executedToolBlocks.add(raw);

            // Execute the action
            try {
              const result = await this.executeAction(action);
              onEvent({
                kind: "agent:tool-result",
                payload: { action, result },
                timestamp: Date.now(),
              });
            } catch (err) {
              onEvent({
                kind: "agent:tool-result",
                payload: { action, result: { success: false, error: String(err) } },
                timestamp: Date.now(),
              });
            }
          }
        }

        // Intercept tool-use events to execute JS via CDP (legacy path)
        if (event.kind === "agent:tool-use") {
          const { js } = event.payload as { js: string };
          try {
            const result = await this.cdpService.evaluate(js);
            onEvent({
              kind: "agent:tool-result",
              payload: { result },
              timestamp: Date.now(),
            });
          } catch (err) {
            onEvent({
              kind: "agent:tool-result",
              payload: { result: null, error: String(err) },
              timestamp: Date.now(),
            });
          }
        }
        onEvent(event);
      });
    } catch (err) {
      onEvent({
        kind: "agent:error",
        payload: { message: String(err) },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send a companion agent message with full action support.
   * Builds system prompt with interactive elements, a11y tree, and
   * tool-block parsing for the response.
   */
  async sendCompanion(
    message: string,
    modelId: string,
    appName: string,
    harnessSection: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) {
      onEvent({
        kind: "agent:error",
        payload: { message: `Unknown model: ${modelId}` },
        timestamp: Date.now(),
      });
      return;
    }

    const provider = this.providers[model.provider];
    this.currentProvider = provider;

    // Build the enriched system prompt with interactive elements + a11y tree + patches
    let systemPrompt = await buildSystemPromptWithActions(this.cdpService, this.patchService, this.currentAppSlug);

    // Prepend companion-specific context
    systemPrompt = `You are a Companion Agent for ${appName}. ` +
      systemPrompt.replace(
        "You are Agentlication, an AI assistant that can see and interact with Electron applications via Chrome DevTools Protocol (CDP).",
        `You can see and interact with ${appName} via Chrome DevTools Protocol (CDP).`
      ) + harnessSection;

    // Tool-block accumulator
    let fullText = "";
    let executedToolBlocks = new Set<string>();

    try {
      await provider.send(message, systemPrompt, modelId, async (event) => {
        // Intercept chunks to look for tool blocks
        if (event.kind === "agent:chunk") {
          const chunk = event.payload as { text: string };
          fullText += chunk.text;

          // Check for complete tool blocks
          const actions = parseToolBlocks(fullText);
          for (const { raw, action } of actions) {
            if (executedToolBlocks.has(raw)) continue;
            executedToolBlocks.add(raw);

            try {
              const result = await this.executeAction(action);
              onEvent({
                kind: "agent:tool-result",
                payload: { action, result },
                timestamp: Date.now(),
              });
            } catch (err) {
              onEvent({
                kind: "agent:tool-result",
                payload: { action, result: { success: false, error: String(err) } },
                timestamp: Date.now(),
              });
            }
          }
        }
        onEvent(event);
      });
    } catch (err) {
      onEvent({
        kind: "agent:error",
        payload: { message: String(err) },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send a companion agent message for a NATIVE (non-Electron) app.
   * Uses the AccessibilityService instead of CDP for context and actions.
   */
  async sendNativeCompanion(
    message: string,
    modelId: string,
    appName: string,
    harnessSection: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    if (!this.accessibilityService) {
      onEvent({
        kind: "agent:error",
        payload: { message: "AccessibilityService not available" },
        timestamp: Date.now(),
      });
      return;
    }

    const model = MODELS.find((m) => m.id === modelId);
    if (!model) {
      onEvent({
        kind: "agent:error",
        payload: { message: `Unknown model: ${modelId}` },
        timestamp: Date.now(),
      });
      return;
    }

    const provider = this.providers[model.provider];
    this.currentProvider = provider;

    // Build the system prompt with AX context
    const systemPrompt = await buildNativeSystemPrompt(
      this.accessibilityService,
      appName,
      harnessSection
    );

    // Tool-block accumulator for parsing tool blocks
    let fullText = "";
    let executedToolBlocks = new Set<string>();
    const axService = this.accessibilityService;

    try {
      await provider.send(message, systemPrompt, modelId, async (event) => {
        if (event.kind === "agent:chunk") {
          const chunk = event.payload as { text: string };
          fullText += chunk.text;

          // Check for complete tool blocks
          const actions = parseToolBlocks(fullText);
          for (const { raw, action } of actions) {
            if (executedToolBlocks.has(raw)) continue;
            executedToolBlocks.add(raw);

            // Route AX actions to AccessibilityService
            if (action.action.startsWith("ax_")) {
              try {
                const result = await axService.executeAction(
                  { action: action.action as any, label: action.label, text: action.text, value: action.value, axAction: action.axAction, depth: action.depth },
                  appName
                );
                onEvent({
                  kind: "agent:tool-result",
                  payload: { action, result },
                  timestamp: Date.now(),
                });
              } catch (err) {
                onEvent({
                  kind: "agent:tool-result",
                  payload: { action, result: { success: false, error: String(err) } },
                  timestamp: Date.now(),
                });
              }
            } else {
              // Non-AX actions for native apps are not supported
              onEvent({
                kind: "agent:tool-result",
                payload: {
                  action,
                  result: { success: false, error: `CDP action "${action.action}" not available for native apps. Use ax_ prefixed actions.` },
                },
                timestamp: Date.now(),
              });
            }
          }
        }
        onEvent(event);
      });
    } catch (err) {
      onEvent({
        kind: "agent:error",
        payload: { message: String(err) },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send a message using a custom system prompt (no CDP context).
   * Used for Hub chat (Setup Agent).
   */
  async sendWithSystemPrompt(
    message: string,
    modelId: string,
    systemPrompt: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) {
      onEvent({
        kind: "agent:error",
        payload: { message: `Unknown model: ${modelId}` },
        timestamp: Date.now(),
      });
      return;
    }

    const provider = this.providers[model.provider];
    this.currentProvider = provider;

    try {
      await provider.send(message, systemPrompt, modelId, onEvent);
    } catch (err) {
      onEvent({
        kind: "agent:error",
        payload: { message: String(err) },
        timestamp: Date.now(),
      });
    }
  }

  cancel(): void {
    this.currentProvider?.cancel();
    this.currentProvider = null;
  }

  async checkProviders(): Promise<ProviderStatusMap> {
    const [claudeAvail, codexAvail] = await Promise.all([
      this.providers.claude.isAvailable(),
      this.providers.codex.isAvailable(),
    ]);

    const claudeProvider = this.providers.claude as ClaudeProvider;
    const codexProvider = this.providers.codex as CodexProvider;

    if (claudeAvail) {
      console.log(`[AgentService] Claude CLI detected: ${claudeProvider.cliVersion}`);
    }
    if (codexAvail) {
      console.log(`[AgentService] Codex CLI detected`);
    }

    return {
      claude: {
        installed: claudeAvail,
        installCommand: PROVIDER_INSTALL_COMMANDS.claude,
      },
      codex: {
        installed: codexAvail,
        installCommand: PROVIDER_INSTALL_COMMANDS.codex,
      },
    };
  }
}

// ── Tool-block parser ─────────────────────────────────────────

/**
 * Parse ```tool JSON blocks from agent text output.
 * Returns an array of { raw, action } pairs where raw is the full match
 * string (used for dedup) and action is the parsed AgentAction.
 */
function parseToolBlocks(text: string): Array<{ raw: string; action: AgentAction }> {
  const toolBlockRegex = /```tool\n([\s\S]*?)```/g;
  const results: Array<{ raw: string; action: AgentAction }> = [];

  let match;
  while ((match = toolBlockRegex.exec(text)) !== null) {
    try {
      const action = JSON.parse(match[1].trim()) as AgentAction;
      if (action.action) {
        results.push({ raw: match[0], action });
      }
    } catch {
      // Not valid JSON yet -- skip
    }
  }

  return results;
}

/**
 * Format interactive elements as a compact numbered list for the agent.
 */
function formatInteractiveElements(elements: InteractiveElement[]): string {
  if (elements.length === 0) return "(No interactive elements found)";

  const lines: string[] = [];
  for (const el of elements.slice(0, 60)) {
    let line = `[${el.index}] ${el.tag}`;
    if (el.type) line += `[${el.type}]`;
    if (el.role) line += `[role=${el.role}]`;
    if (el.text) line += ` "${el.text}"`;
    if (el.ariaLabel) line += ` aria="${el.ariaLabel}"`;
    if (el.placeholder) line += ` placeholder="${el.placeholder}"`;
    line += ` selector:${el.selector}`;
    if (el.value) line += ` val="${el.value}"`;
    if (el.disabled) line += ` [disabled]`;
    if (el.checked) line += ` [checked]`;
    line += ` @(${el.rect.x},${el.rect.y},${el.rect.w}x${el.rect.h})`;
    lines.push(line);
  }

  return lines.join("\n");
}

// ── System prompt builder ──────────────────────────────────────

async function buildSystemPromptWithActions(
  cdpService: CdpService,
  patchService?: PatchService | null,
  appSlug?: string | null
): Promise<string> {
  let elementsSection = "\n\n(No interactive elements available -- CDP not connected)";
  let a11ySection = "";
  let pageInfoSection = "";
  let patchesSection = "";

  if (cdpService.isConnected()) {
    try {
      const elements = await cdpService.getInteractiveElements();
      const formatted = formatInteractiveElements(elements);
      elementsSection = `\n\n## Interactive Elements\n\`\`\`\n${formatted}\n\`\`\``;
    } catch {
      elementsSection = "\n\n(Failed to read interactive elements)";
    }

    try {
      const tree = await cdpService.getAccessibilityTree(4);
      const truncated = tree.length > 8000 ? tree.slice(0, 8000) + "\n... (truncated)" : tree;
      a11ySection = `\n\n## Accessibility Tree\n\`\`\`\n${truncated}\n\`\`\``;
    } catch {
      // Non-critical
    }

    try {
      const info = await cdpService.getPageInfo();
      pageInfoSection = `\n\n## Page Info\n- Title: ${info.title}\n- URL: ${info.url}\n- Framework: ${info.framework || "unknown"}\n- DOM structure: ${info.documentStructure}`;
    } catch {
      // Non-critical
    }
  }

  // Add patches context if available
  if (patchService && appSlug) {
    try {
      const patchSummary = await patchService.getPatchSummaryForPrompt(appSlug);
      patchesSection = `\n\n## Patches

You can create persistent modifications to the app using patches.
Patches are JavaScript/TSX/CSS files that are injected via CDP and persist across app restarts and page navigations.

Current patches for this app:
${patchSummary}

### Patch Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| create_patch | name, code, description?, format?, priority?, inject_at? | Create a new patch and inject it |
| update_patch | name, code?, enabled?, priority?, description? | Modify an existing patch |
| delete_patch | name | Delete a patch |
| list_patches | (none) | List all patches for this app |
| enable_patch | name | Enable a disabled patch |
| disable_patch | name | Disable a patch without deleting it |

### Patch Examples

Create a simple JS patch:
\`\`\`tool
{"action": "create_patch", "name": "my-widget", "description": "Adds a floating widget", "format": "js", "code": "(function() { var div = document.createElement('div'); div.textContent = 'Hello from Agentlication!'; div.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#1a1a2e;color:#fff;padding:8px 16px;border-radius:8px;z-index:99999;font-family:system-ui;'; document.body.appendChild(div); window.__AGENTLICATION_PATCHES__['my-widget'].cleanup = function() { div.remove(); }; })()"}
\`\`\`

Update a patch:
\`\`\`tool
{"action": "update_patch", "name": "my-widget", "code": "...new code..."}
\`\`\`

Toggle a patch:
\`\`\`tool
{"action": "enable_patch", "name": "my-widget"}
\`\`\`

### Patch Best Practices
- Always register a cleanup function via \`window.__AGENTLICATION_PATCHES__['patch-name'].cleanup = function() { ... }\`
- Use stable selectors (data-testid, aria-label, role) over class names
- Wrap your patch code in an IIFE for isolation
- For CSS-only changes, use format "css"
- After creating a patch, verify it worked by inspecting the DOM or taking a screenshot`;
    } catch {
      // Non-critical
    }
  }

  return `You are Agentlication, an AI assistant that can see and interact with Electron applications via Chrome DevTools Protocol (CDP).

## Your Capabilities

You can interact with the connected app using structured tool calls. To perform an action, output a tool code block containing a JSON object:

\`\`\`tool
{"action": "click", "selector": "#submit-btn"}
\`\`\`

## Available Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| click | selector, OR x+y | Click an element by CSS selector or coordinates |
| click_text | text, tagFilter? | Click an element by its visible text content |
| type | selector, text | Type text into an input/textarea |
| eval | expression | Evaluate JavaScript in the app context |
| get_elements | (none) | Get updated list of interactive elements |
| get_a11y_tree | depth? | Get the accessibility tree |
| screenshot | (none) | Capture a screenshot |
| scroll | selector | Scroll element into view |
| press_key | key | Press a key (Enter, Tab, Escape, etc.) |
| navigate | text (URL) | Navigate to a URL |
| wait | selector, timeout? | Wait for an element to appear |
| select | selector, value | Select an option from a dropdown |

## Examples

Click a button:
\`\`\`tool
{"action": "click", "selector": "#save-btn"}
\`\`\`

Type into a field:
\`\`\`tool
{"action": "type", "selector": "input[name=email]", "text": "user@example.com"}
\`\`\`

Click by text:
\`\`\`tool
{"action": "click_text", "text": "Save Changes"}
\`\`\`

Run JavaScript:
\`\`\`tool
{"action": "eval", "expression": "document.title"}
\`\`\`

Press Enter:
\`\`\`tool
{"action": "press_key", "key": "Enter"}
\`\`\`

Get fresh element list:
\`\`\`tool
{"action": "get_elements"}
\`\`\`

## Important Notes
- Use the Interactive Elements list below to find CSS selectors for elements
- After performing actions that change the page, use get_elements to refresh the element list
- If a click fails via selector, try click_text with the button text instead
- For React/Vue apps, the type action handles framework change detection automatically
- Be concise and helpful. Explain what you are doing before each action.
${pageInfoSection}${elementsSection}${a11ySection}${patchesSection}`;
}

function buildSystemPrompt(domSnapshot: string): string {
  const domSection = domSnapshot
    ? `\n\n## Current DOM Snapshot\n\`\`\`html\n${domSnapshot.slice(0, 50000)}\n\`\`\``
    : "\n\n(No DOM snapshot available -- CDP not connected)";

  return `You are Agentlication, an AI assistant that can see and interact with Electron applications.

You can:
1. Read the current state of the app (DOM, JS variables, stores)
2. Execute JavaScript in the app's context
3. Click buttons, fill forms, navigate
4. Inject custom UI elements

When you need to interact with the app, output JavaScript code in a js code block.
The code will be executed in the app's renderer process via CDP.

Be concise and helpful. Match the app's existing design when injecting UI.
${domSection}`;
}

// ── Native app system prompt builder ──────────────────────────

/**
 * Format AX interactive elements as a compact numbered list for the agent.
 */
function formatAXInteractiveElements(elements: AXInteractiveElement[]): string {
  if (elements.length === 0) return "(No interactive elements found)";

  const lines: string[] = [];
  for (const el of elements.slice(0, 80)) {
    let line = `[${el.index}] ${el.role}`;
    if (el.name) line += ` "${el.name}"`;
    if (el.description) line += ` desc="${el.description}"`;
    if (el.value) line += ` val="${el.value}"`;
    if (!el.enabled) line += ` [disabled]`;
    if (el.actions.length > 0) line += ` actions:${el.actions.join(",")}`;
    if (el.position && el.size) {
      line += ` @(${el.position.x},${el.position.y},${el.size.width}x${el.size.height})`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Format the AX tree as a compact text representation for the agent.
 */
function formatAXTree(tree: any, indent: number = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);
  const role = tree.role || "?";
  const name = tree.name || "";
  const value = tree.value;

  let line = `${prefix}${role}`;
  if (name) line += ` "${name}"`;
  if (value && typeof value === "string" && value.length < 80) {
    line += ` val="${value}"`;
  }
  if (tree.focused) line += " [focused]";
  if (!tree.enabled) line += " [disabled]";
  if (tree.actions && tree.actions.length > 0) {
    line += ` actions:${tree.actions.join(",")}`;
  }

  lines.push(line);

  if (tree.children) {
    for (const child of tree.children) {
      lines.push(formatAXTree(child, indent + 1));
    }
  }

  return lines.join("\n");
}

/**
 * Build a system prompt for native app interactions using the AX API.
 */
async function buildNativeSystemPrompt(
  axService: AccessibilityService,
  appName: string,
  harnessSection: string
): Promise<string> {
  let elementsSection = "\n\n(No interactive elements available -- AX not connected)";
  let treeSection = "";
  let appInfoSection = "";

  try {
    const elements = await axService.getInteractiveElements(appName);
    const formatted = formatAXInteractiveElements(elements);
    elementsSection = `\n\n## Interactive Elements\n\`\`\`\n${formatted}\n\`\`\``;
  } catch {
    elementsSection = "\n\n(Failed to read interactive elements)";
  }

  try {
    const tree = await axService.getTree(appName, 4);
    const formatted = formatAXTree(tree.tree);
    const truncated = formatted.length > 8000 ? formatted.slice(0, 8000) + "\n... (truncated)" : formatted;
    treeSection = `\n\n## Accessibility Tree\n\`\`\`\n${truncated}\n\`\`\``;
  } catch {
    // Non-critical
  }

  try {
    const info = await axService.getInfo(appName);
    const windowList = info.windows
      .map((w) => `  - "${w.title}" at (${w.position.x},${w.position.y}) ${w.size.width}x${w.size.height}`)
      .join("\n");
    const menuItems = info.menuBarItems?.join(", ") || "unknown";
    appInfoSection = `\n\n## App Info\n- Name: ${info.name}\n- PID: ${info.pid}\n- Bundle ID: ${info.bundleId || "unknown"}\n- Windows:\n${windowList}\n- Menu bar: ${menuItems}`;
  } catch {
    // Non-critical
  }

  return `You are Agentlication, an AI assistant that can see and interact with native macOS applications via the Accessibility API.

You are a Companion Agent for ${appName}.

## Your Capabilities

You can interact with ${appName} using structured tool calls. To perform an action, output a tool code block containing a JSON object:

\`\`\`tool
{"action": "ax_click", "label": "Save"}
\`\`\`

## Available Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| ax_click | label | Click an element by its name/label |
| ax_type | text | Type text into the focused element |
| ax_focus | label | Focus an element by its name/label |
| ax_get_tree | depth? | Get the full accessibility tree |
| ax_elements | (none) | Get updated list of interactive elements |
| ax_set_value | label, value | Set the value of an element |
| ax_action | axAction, label | Perform any AX action (e.g. AXPress, AXShowMenu) |
| ax_info | (none) | Get app info (windows, menu bar) |

## Examples

Click a button:
\`\`\`tool
{"action": "ax_click", "label": "Save"}
\`\`\`

Type into a focused field:
\`\`\`tool
{"action": "ax_type", "text": "Hello world"}
\`\`\`

Focus a text field then type:
\`\`\`tool
{"action": "ax_focus", "label": "Search"}
\`\`\`
\`\`\`tool
{"action": "ax_type", "text": "my search query"}
\`\`\`

Perform a specific AX action:
\`\`\`tool
{"action": "ax_action", "axAction": "AXShowMenu", "label": "File"}
\`\`\`

Get fresh element list:
\`\`\`tool
{"action": "ax_elements"}
\`\`\`

## Important Notes
- Use the Interactive Elements list below to find element names/labels
- After performing actions that change the UI, use ax_elements to refresh the element list
- Elements are identified by their "name" (title or description)
- If a click fails by label, try using ax_action with "AXPress" directly
- For text input, first ax_focus the field, then ax_type the text
- Be concise and helpful. Explain what you are doing before each action.
${appInfoSection}${elementsSection}${treeSection}${harnessSection}`;
}
