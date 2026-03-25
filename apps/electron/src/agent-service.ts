import { spawn, ChildProcess } from "child_process";
import { AgentEvent, ProviderKind, MODELS } from "@agentlication/contracts";
import { CdpService } from "./cdp-service";

// ── Provider abstraction ───────────────────────────────────────

interface Provider {
  send(
    message: string,
    systemPrompt: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
}

class ClaudeProvider implements Provider {
  private process: ChildProcess | null = null;

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("claude", ["--version"], { shell: true });
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async send(
    message: string,
    systemPrompt: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use claude CLI with streaming JSON output
      this.process = spawn(
        "claude",
        [
          "--print",
          "--output-format",
          "stream-json",
          "--system-prompt",
          systemPrompt,
          message,
        ],
        { shell: true }
      );

      let buffer = "";

      this.process.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "content_block_delta") {
              onEvent({
                kind: "agent:chunk",
                payload: { text: parsed.delta?.text || "" },
                timestamp: Date.now(),
              });
            } else if (parsed.type === "message_stop") {
              onEvent({
                kind: "agent:done",
                payload: {},
                timestamp: Date.now(),
              });
            }
          } catch {
            // Not valid JSON yet, might be partial — accumulate in buffer
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("error")) {
          onEvent({
            kind: "agent:error",
            payload: { message: text },
            timestamp: Date.now(),
          });
        }
      });

      this.process.on("close", () => {
        this.process = null;
        resolve();
      });

      this.process.on("error", (err) => {
        this.process = null;
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
    return new Promise((resolve) => {
      const proc = spawn("codex", ["--version"], { shell: true });
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async send(
    message: string,
    _systemPrompt: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    // Codex provider — stubbed for now, will implement when codex CLI stabilizes
    onEvent({
      kind: "agent:error",
      payload: { message: "Codex provider not yet implemented" },
      timestamp: Date.now(),
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
      await provider.send(message, systemPrompt, async (event) => {
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

  cancel(): void {
    this.currentProvider?.cancel();
    this.currentProvider = null;
  }

  async checkProviders(): Promise<Record<ProviderKind, boolean>> {
    const [claude, codex] = await Promise.all([
      this.providers.claude.isAvailable(),
      this.providers.codex.isAvailable(),
    ]);
    return { claude, codex };
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
