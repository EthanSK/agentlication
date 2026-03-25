import { spawn, ChildProcess, execFileSync } from "child_process";
import {
  AgentEvent,
  ProviderKind,
  MODELS,
  ProviderStatusMap,
  PROVIDER_INSTALL_COMMANDS,
} from "@agentlication/contracts";
import { CdpService } from "./cdp-service";

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

function cliExists(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

class ClaudeProvider implements Provider {
  private process: ChildProcess | null = null;

  async isAvailable(): Promise<boolean> {
    return cliExists("claude");
  }

  async send(
    message: string,
    systemPrompt: string,
    modelId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
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
      "sonnet-4.5": "claude-sonnet-4-5-20250514",
      "opus-4.6": "claude-opus-4-6-20250514",
    };
    const cliModel = modelMap[modelId] || "claude-sonnet-4-5-20250514";

    return new Promise((resolve, reject) => {
      this.process = spawn(
        "claude",
        [
          "--print",
          "--output-format",
          "stream-json",
          "-m",
          cliModel,
          "--system-prompt",
          systemPrompt,
          message,
        ],
        { shell: true }
      );

      let buffer = "";
      let doneSent = false;

      this.process.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            // Handle various stream-json event types from Claude CLI
            if (parsed.type === "content_block_delta") {
              const text = parsed.delta?.text || "";
              if (text) {
                onEvent({
                  kind: "agent:chunk",
                  payload: { text },
                  timestamp: Date.now(),
                });
              }
            } else if (parsed.type === "assistant" && parsed.content) {
              // Full message event — extract text blocks
              for (const block of parsed.content) {
                if (block.type === "text" && block.text) {
                  onEvent({
                    kind: "agent:chunk",
                    payload: { text: block.text },
                    timestamp: Date.now(),
                  });
                }
              }
            } else if (
              parsed.type === "message_stop" ||
              parsed.type === "result"
            ) {
              if (parsed.result) {
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
        // Flush remaining buffer
        if (buffer.trim()) {
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

  async isAvailable(): Promise<boolean> {
    return cliExists("codex");
  }

  async send(
    message: string,
    _systemPrompt: string,
    modelId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
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

    return new Promise((resolve, reject) => {
      this.process = spawn(
        "codex",
        ["--model", cliModel, "--quiet", message],
        { shell: true }
      );

      this.process.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        onEvent({
          kind: "agent:chunk",
          payload: { text },
          timestamp: Date.now(),
        });
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
        onEvent({
          kind: "agent:done",
          payload: {},
          timestamp: Date.now(),
        });
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

  constructor(private cdpService: CdpService) {}

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

    // Build system prompt with DOM context
    let domSnapshot = "";
    try {
      domSnapshot = await this.cdpService.getDOM();
    } catch {
      // CDP might not be connected yet — that's ok
    }

    const systemPrompt = buildSystemPrompt(domSnapshot);

    try {
      await provider.send(message, systemPrompt, modelId, async (event) => {
        // Intercept tool-use events to execute JS via CDP
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
    const [claude, codex] = await Promise.all([
      this.providers.claude.isAvailable(),
      this.providers.codex.isAvailable(),
    ]);
    return {
      claude: {
        installed: claude,
        installCommand: PROVIDER_INSTALL_COMMANDS.claude,
      },
      codex: {
        installed: codex,
        installCommand: PROVIDER_INSTALL_COMMANDS.codex,
      },
    };
  }
}

// ── System prompt builder ──────────────────────────────────────

function buildSystemPrompt(domSnapshot: string): string {
  const domSection = domSnapshot
    ? `\n\n## Current DOM Snapshot\n\`\`\`html\n${domSnapshot.slice(0, 50000)}\n\`\`\``
    : "\n\n(No DOM snapshot available — CDP not connected)";

  return `You are Agentlication, an AI assistant that can see and interact with Electron applications.

You can:
1. Read the current state of the app (DOM, JS variables, stores)
2. Execute JavaScript in the app's context
3. Click buttons, fill forms, navigate
4. Inject custom UI elements

When you need to interact with the app, output JavaScript code in a \`\`\`js\`\`\` code block.
The code will be executed in the app's renderer process via CDP.

Be concise and helpful. Match the app's existing design when injecting UI.
${domSection}`;
}
