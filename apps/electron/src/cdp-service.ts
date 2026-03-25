import CDP from "chrome-remote-interface";
import type { CdpTarget } from "@agentlication/contracts";

export class CdpService {
  private client: CDP.Client | null = null;
  private port = 9222;

  async connect(port: number = 9222): Promise<{ success: boolean; error?: string }> {
    this.port = port;
    try {
      this.client = await CDP({ port });
      // Enable Runtime domain for evaluating JS
      await this.client.Runtime.enable();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = null;
    }
  }

  async getDOM(): Promise<string> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text || "Failed to get DOM"
      );
    }

    return result.result.value as string;
  }

  async evaluate(expression: string): Promise<unknown> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text || "Evaluation failed"
      );
    }

    return result.result.value;
  }

  async listTargets(): Promise<CdpTarget[]> {
    try {
      const targets = await CDP.List({ port: this.port });
      return targets.map((t: Record<string, string>) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        type: t.type,
      }));
    } catch {
      return [];
    }
  }
}
