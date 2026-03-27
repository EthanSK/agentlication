import CDP from "chrome-remote-interface";
import { execFileSync, spawn } from "child_process";
import * as http from "http";
import type { CdpTarget, CdpPageInfo, StatusLevel, StatusIcon } from "@agentlication/contracts";

export type StatusCallback = (text: string, level: StatusLevel, icon?: StatusIcon) => void;

/**
 * Manages CDP connections to target Electron apps.
 * Handles killing, relaunching with --remote-debugging-port, connecting,
 * and gathering page info.
 */
export class CdpService {
  private client: CDP.Client | null = null;
  private port = 9222;

  /**
   * Full connect flow:
   * 1. Kill the running instance of the target app
   * 2. Relaunch it with --remote-debugging-port
   * 3. Wait for CDP to be ready
   * 4. Connect via chrome-remote-interface
   */
  async connect(
    appPath: string,
    cdpPort: number,
    onStatus?: StatusCallback
  ): Promise<{ success: boolean; error?: string }> {
    this.port = cdpPort;
    const appName = appPath.split("/").pop()?.replace(".app", "") || "the app";
    const status = onStatus ?? (() => {});

    try {
      // Disconnect any existing connection first
      await this.disconnect();

      // Step 1: Kill existing instances of the target app
      status(`Quitting ${appName}...`, "progress", "connection");
      await this.killApp(appPath);

      // Step 2: Relaunch with CDP flag
      status(`Launching ${appName} with CDP on port ${cdpPort}...`, "progress", "connection");
      this.launchWithCdp(appPath, cdpPort);

      // Step 3: Wait for CDP to be ready (poll /json/version)
      status("Waiting for CDP to be ready...", "progress", "progress");
      await this.waitForCdp(cdpPort, 15000);

      // Step 4: Get available targets and pick the main page
      status("Listing CDP targets...", "info", "searching");
      const targets = await CDP.List({ port: cdpPort });
      const pageTarget = targets.find(
        (t: Record<string, string>) => t.type === "page"
      );

      // Step 5: Connect to the target
      status("Connecting to CDP target...", "progress", "connection");
      const connectOpts: { port: number; target?: string } = { port: cdpPort };
      if (pageTarget) {
        connectOpts.target = pageTarget.id;
      }

      this.client = await CDP(connectOpts);
      await this.client.Runtime.enable();
      status(`Connected to ${appName}`, "success", "success");

      return { success: true };
    } catch (err) {
      status(`Connection failed: ${String(err)}`, "error", "error");
      return { success: false, error: String(err) };
    }
  }

  /**
   * Disconnect from the current CDP session (does NOT kill the target app).
   */
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

  /**
   * Check if we currently have an active CDP connection.
   */
  isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Get the full outer HTML of the connected page.
   */
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

  /**
   * Evaluate a JavaScript expression in the connected page.
   */
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

  /**
   * List available CDP targets (pages, workers, etc.).
   */
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

  /**
   * Gather info about the connected page: title, URL, detected framework,
   * localStorage keys, and a brief DOM structure summary.
   */
  async getPageInfo(): Promise<CdpPageInfo> {
    if (!this.client) throw new Error("CDP not connected");

    // Gather all info in parallel via a single evaluate call
    const infoScript = `
      (function() {
        var title = document.title || '';
        var url = window.location.href || '';

        // Detect framework
        var framework = null;
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]') || document.querySelector('#root > div')) {
          try {
            var rootEl = document.getElementById('root') || document.getElementById('app');
            if (rootEl && rootEl._reactRootContainer) framework = 'react';
            else if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) framework = 'react';
          } catch(e) {}
          if (!framework && window.__REACT_DEVTOOLS_GLOBAL_HOOK__) framework = 'react';
        }
        if (!framework && (window.__VUE__ || window.__VUE_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-v-]'))) {
          framework = 'vue';
        }
        if (!framework && (window.ng || document.querySelector('[ng-version]') || document.querySelector('[_nghost-]'))) {
          framework = 'angular';
        }

        // Get localStorage keys
        var lsKeys = [];
        try {
          for (var i = 0; i < localStorage.length; i++) {
            lsKeys.push(localStorage.key(i));
          }
        } catch(e) {}

        // Brief DOM structure - top-level children of body
        var structure = '';
        try {
          var bodyChildren = document.body.children;
          var tags = [];
          for (var j = 0; j < Math.min(bodyChildren.length, 20); j++) {
            var el = bodyChildren[j];
            var desc = '<' + el.tagName.toLowerCase();
            if (el.id) desc += '#' + el.id;
            if (el.className && typeof el.className === 'string') {
              var cls = el.className.trim().split(/\\s+/).slice(0, 3).join('.');
              if (cls) desc += '.' + cls;
            }
            desc += '>';
            tags.push(desc);
          }
          structure = tags.join(' ');
        } catch(e) {
          structure = '(unable to read)';
        }

        return JSON.stringify({
          title: title,
          url: url,
          framework: framework,
          localStorageKeys: lsKeys,
          documentStructure: structure
        });
      })()
    `;

    const result = await this.client.Runtime.evaluate({
      expression: infoScript,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text || "Failed to get page info"
      );
    }

    try {
      return JSON.parse(result.result.value as string) as CdpPageInfo;
    } catch {
      return {
        title: "",
        url: "",
        framework: null,
        localStorageKeys: [],
        documentStructure: "",
      };
    }
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Kill existing instances of the target app by bundle path.
   * Uses pkill with the executable name derived from the .app path.
   */
  private async killApp(appPath: string): Promise<void> {
    try {
      // Extract the executable name (e.g. "Producer Player" from "Producer Player.app")
      const appName = appPath.split("/").pop()?.replace(".app", "") || "";
      if (!appName) return;

      // Use pkill to kill by process name — uses execFileSync to avoid shell injection
      try {
        execFileSync("pkill", ["-f", appName], { stdio: "ignore" });
      } catch {
        // Process wasn't running — that's fine
      }

      // Also try osascript quit (more graceful for macOS apps)
      try {
        execFileSync("osascript", ["-e", `tell application "${appName}" to quit`], {
          stdio: "ignore",
          timeout: 3000,
        });
      } catch {
        // Ignore
      }

      // Give it a moment to actually quit
      await this.sleep(1500);
    } catch {
      // Best-effort kill
    }
  }

  /**
   * Launch the app with --remote-debugging-port flag.
   * Uses `open -a` with --args for macOS .app bundles.
   */
  private launchWithCdp(appPath: string, port: number): void {
    const child = spawn("open", ["-a", appPath, "--args", `--remote-debugging-port=${port}`], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  /**
   * Poll http://localhost:<port>/json/version until it responds,
   * or timeout after the specified ms.
   */
  private waitForCdp(port: number, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 500;

    return new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`CDP did not become ready within ${timeoutMs}ms on port ${port}`));
          return;
        }

        const req = http.get(`http://localhost:${port}/json/version`, (res) => {
          if (res.statusCode === 200) {
            // Consume data to free the socket
            res.resume();
            resolve();
          } else {
            setTimeout(poll, pollInterval);
          }
        });

        req.on("error", () => {
          setTimeout(poll, pollInterval);
        });

        req.setTimeout(1000, () => {
          req.destroy();
          setTimeout(poll, pollInterval);
        });
      };

      poll();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
