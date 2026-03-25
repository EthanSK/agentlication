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
            } else if (parsed.type === "assistant" && parsed.message?.content) {
              // Full message event — extract text blocks
              for (const block of parsed.message.content) {
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
  private resolvedPath: string | null = null;
  public cliVersion: string | null = null;

  async isAvailable(): Promise<boolean> {
    const resolved = resolveCliBinary("codex");
    if (!resolved) return false;
    this.resolvedPath = resolved;
    // Verify the CLI actually works by checking its help output
    this.cliVersion = getCliVersion(resolved, ["--help"]);
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
        ["--model", cliModel, "--quiet", message],
        { env: augmentedEnv }
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
