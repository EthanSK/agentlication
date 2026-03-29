import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import { promisify } from "util";
import type {
  AXTree,
  AXActionResult,
  AXAppInfo,
  AXInteractiveElement,
  AXAgentAction,
} from "@agentlication/contracts";

const execFileAsync = promisify(execFile);

/**
 * Node.js wrapper around the ax-bridge Swift CLI binary.
 * Provides accessibility-based interaction with native macOS apps.
 *
 * Uses execFile (not exec) to safely invoke the binary without shell
 * interpretation of arguments.
 */
export class AccessibilityService {
  private binaryPath: string;

  constructor() {
    const isDev = !app.isPackaged;
    if (isDev) {
      // In development, the binary is at native/ax-bridge/ax-bridge relative to project root
      this.binaryPath = path.join(
        __dirname, "..", "..", "..", "native", "ax-bridge", "ax-bridge"
      );
    } else {
      // In production, it's bundled in the app resources
      this.binaryPath = path.join(
        process.resourcesPath, "native", "ax-bridge"
      );
    }
  }

  /**
   * Check if the ax-bridge binary exists and is executable.
   */
  isBinaryAvailable(): boolean {
    try {
      fs.accessSync(this.binaryPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the path to the ax-bridge binary (for debugging).
   */
  getBinaryPath(): string {
    return this.binaryPath;
  }

  /**
   * Execute an ax-bridge command and parse the JSON output.
   * Uses execFile (safe, no shell injection) to invoke the binary.
   */
  private async exec(args: string[], timeoutMs: number = 10000): Promise<any> {
    if (!this.isBinaryAvailable()) {
      throw new Error(
        `ax-bridge binary not found at ${this.binaryPath}. ` +
        `Run: cd native/ax-bridge && bash build.sh`
      );
    }

    try {
      const { stdout } = await execFileAsync(this.binaryPath, args, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return JSON.parse(stdout.trim());
    } catch (err: any) {
      // If the process produced JSON output before failing, try to parse it
      if (err.stdout) {
        try {
          return JSON.parse(err.stdout.trim());
        } catch {
          // fall through
        }
      }
      throw new Error(`ax-bridge command failed: ${err.message || String(err)}`);
    }
  }

  /**
   * Check if Accessibility permission is granted.
   */
  async checkPermission(): Promise<boolean> {
    const result = await this.exec(["check-permission"], 3000);
    return result.granted === true;
  }

  /**
   * Get the accessibility tree for an app.
   */
  async getTree(appName: string, depth: number = 5): Promise<AXTree> {
    const result = await this.exec(
      ["tree", appName, "--depth", String(depth)],
      10000
    );
    if (!result.success) {
      throw new Error(result.error || "Failed to get accessibility tree");
    }
    return result as AXTree;
  }

  /**
   * Click an element by label/description.
   */
  async click(appName: string, label: string): Promise<AXActionResult> {
    const result = await this.exec(["click", appName, label], 5000);
    return result as AXActionResult;
  }

  /**
   * Type text into the focused element (or first text field).
   */
  async type(appName: string, text: string): Promise<AXActionResult> {
    const result = await this.exec(["type", appName, text], 5000);
    return result as AXActionResult;
  }

  /**
   * Focus an element by label/description.
   */
  async focus(appName: string, label: string): Promise<AXActionResult> {
    const result = await this.exec(["focus", appName, label], 5000);
    return result as AXActionResult;
  }

  /**
   * Get the list of available actions on an element.
   */
  async getActions(appName: string, label: string): Promise<AXActionResult> {
    const result = await this.exec(["actions", appName, label], 5000);
    return result as AXActionResult;
  }

  /**
   * Get all interactive elements in an app.
   */
  async getInteractiveElements(appName: string): Promise<AXInteractiveElement[]> {
    const result = await this.exec(
      ["elements", appName, "--interactive"],
      10000
    );
    if (!result.success) {
      throw new Error(result.error || "Failed to get interactive elements");
    }
    return result.elements as AXInteractiveElement[];
  }

  /**
   * Perform any AX action on an element.
   */
  async performAction(
    appName: string,
    action: string,
    label: string
  ): Promise<AXActionResult> {
    const result = await this.exec(
      ["perform", appName, action, label],
      5000
    );
    return result as AXActionResult;
  }

  /**
   * Set the value of an element.
   */
  async setValue(
    appName: string,
    label: string,
    value: string
  ): Promise<AXActionResult> {
    const result = await this.exec(
      ["set-value", appName, label, value],
      5000
    );
    return result as AXActionResult;
  }

  /**
   * Get app info (windows, menu bar, etc.).
   */
  async getInfo(appName: string): Promise<AXAppInfo> {
    const result = await this.exec(["info", appName], 5000);
    if (!result.success) {
      throw new Error(result.error || "Failed to get app info");
    }
    return result as AXAppInfo;
  }

  /**
   * Execute a structured AXAgentAction. This is the main dispatcher
   * called by the tool-block parser for native app actions.
   */
  async executeAction(
    action: AXAgentAction,
    appName: string
  ): Promise<AXActionResult> {
    switch (action.action) {
      case "ax_click":
        if (!action.label) return { success: false, error: "ax_click requires label" };
        return this.click(appName, action.label);

      case "ax_type":
        if (!action.text) return { success: false, error: "ax_type requires text" };
        return this.type(appName, action.text);

      case "ax_focus":
        if (!action.label) return { success: false, error: "ax_focus requires label" };
        return this.focus(appName, action.label);

      case "ax_get_tree":
        try {
          const tree = await this.getTree(appName, action.depth ?? 5);
          return { success: true, data: tree };
        } catch (err) {
          return { success: false, error: String(err) };
        }

      case "ax_elements":
        try {
          const elements = await this.getInteractiveElements(appName);
          return { success: true, data: elements };
        } catch (err) {
          return { success: false, error: String(err) };
        }

      case "ax_set_value":
        if (!action.label) return { success: false, error: "ax_set_value requires label" };
        if (action.value === undefined) return { success: false, error: "ax_set_value requires value" };
        return this.setValue(appName, action.label, action.value);

      case "ax_action":
        if (!action.axAction) return { success: false, error: "ax_action requires axAction" };
        if (!action.label) return { success: false, error: "ax_action requires label" };
        return this.performAction(appName, action.axAction, action.label);

      case "ax_info":
        try {
          const info = await this.getInfo(appName);
          return { success: true, data: info };
        } catch (err) {
          return { success: false, error: String(err) };
        }

      default:
        return { success: false, error: `Unknown AX action: ${action.action}` };
    }
  }
}
