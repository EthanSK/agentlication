import CDP from "chrome-remote-interface";
import { execFileSync, spawn } from "child_process";
import * as http from "http";
import type {
  CdpTarget,
  CdpPageInfo,
  StatusLevel,
  StatusIcon,
  AgentAction,
  AgentActionResult,
  InteractiveElement,
} from "@agentlication/contracts";

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

  // ── CDP Action Methods ─────────────────────────────────────────

  /**
   * Click an element by CSS selector.
   * Uses Runtime.evaluate with mousedown/mouseup/click sequence.
   */
  async clickElement(selector: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' });

          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();

          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

          return JSON.stringify({ success: true, data: { tagName: el.tagName, text: (el.textContent || '').trim().substring(0, 80) } });
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text };
    }
    return JSON.parse(result.result.value as string);
  }

  /**
   * Click an element by its visible text content.
   */
  async clickByText(text: string, tagFilter?: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression: `
        (function() {
          var tag = ${JSON.stringify(tagFilter || '*')};
          var elements = document.querySelectorAll(tag);
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var elText = (el.textContent || '').trim();
            if (elText === ${JSON.stringify(text)} || elText.includes(${JSON.stringify(text)})) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.focus();
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return JSON.stringify({ success: true, data: { tagName: el.tagName, text: elText.substring(0, 80) } });
            }
          }
          return JSON.stringify({ success: false, error: 'No element with text: ' + ${JSON.stringify(text)} });
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text };
    }
    return JSON.parse(result.result.value as string);
  }

  /**
   * Type text into an element by CSS selector.
   * Uses the React native input setter trick for framework compatibility.
   */
  async typeIntoElement(selector: string, text: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression: `
        (function() {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' });

          el.focus();

          // Use native setter trick for React/Vue/Angular compatibility
          var nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          );
          if (!nativeSetter) {
            nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype, 'value'
            );
          }

          if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(el, ${JSON.stringify(text)});
          } else {
            el.value = ${JSON.stringify(text)};
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));

          return JSON.stringify({ success: true });
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text };
    }
    return JSON.parse(result.result.value as string);
  }

  /**
   * Evaluate arbitrary JavaScript in the connected page and return the result.
   */
  async evaluateExpression(expression: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text || "Evaluation failed" };
    }

    return { success: true, data: result.result.value };
  }

  /**
   * Get all interactive elements on the page as a numbered list.
   */
  async getInteractiveElements(): Promise<InteractiveElement[]> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression: `
        (function() {
          var interactable =
            'a, button, input, select, textarea, [role="button"], ' +
            '[role="link"], [role="checkbox"], [role="radio"], [role="tab"], ' +
            '[role="menuitem"], [role="switch"], [role="slider"], ' +
            '[onclick], [tabindex]:not([tabindex="-1"])';

          var elements = document.querySelectorAll(interactable);
          var results = [];

          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            // Skip elements hidden via display/visibility
            var style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

            results.push({
              index: results.length,
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute('type') || undefined,
              role: el.getAttribute('role') || undefined,
              text: (el.textContent || '').trim().substring(0, 80),
              ariaLabel: el.getAttribute('aria-label') || undefined,
              placeholder: el.getAttribute('placeholder') || undefined,
              selector: buildUniqueSelector(el),
              value: el.value || undefined,
              disabled: el.disabled || false,
              checked: el.checked || undefined,
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height)
              },
            });
          }

          return JSON.stringify(results);

          function buildUniqueSelector(el) {
            if (el.id) return '#' + CSS.escape(el.id);
            var testId = el.getAttribute('data-testid');
            if (testId) return '[data-testid="' + testId + '"]';
            // Build a path with tag + classes
            var path = el.tagName.toLowerCase();
            if (el.className && typeof el.className === 'string') {
              var cls = el.className.trim().split(/\\s+/).slice(0, 2);
              if (cls.length) {
                path += '.' + cls.map(function(c) { return CSS.escape(c); }).join('.');
              }
            }
            // If not unique, add nth-child
            if (el.parentElement) {
              var siblings = el.parentElement.querySelectorAll(':scope > ' + path.split('.')[0]);
              if (siblings.length > 1) {
                var idx = Array.prototype.indexOf.call(el.parentElement.children, el) + 1;
                path += ':nth-child(' + idx + ')';
              }
            }
            return path;
          }
        })()
      `,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Failed to get interactive elements");
    }

    return JSON.parse(result.result.value as string);
  }

  /**
   * Get the CDP accessibility tree as a compact text representation.
   */
  async getAccessibilityTree(depth?: number): Promise<string> {
    if (!this.client) throw new Error("CDP not connected");

    await this.client.Accessibility.enable();
    const { nodes } = await this.client.Accessibility.getFullAXTree({
      depth: depth ?? 5,
    });

    // Format as a compact tree string
    const lines: string[] = [];
    const nodeMap = new Map<string, (typeof nodes)[0]>();
    for (const n of nodes) {
      nodeMap.set(n.nodeId, n);
    }

    const formatNode = (node: (typeof nodes)[0], indent: number) => {
      if (node.ignored) return;
      const prefix = "  ".repeat(indent);
      const role = node.role?.value || "?";
      const name = node.name?.value || "";
      const value = node.value?.value;

      let line = `${prefix}${role}`;
      if (name) line += ` "${name}"`;
      if (value && typeof value === "string" && value.length < 80) {
        line += ` val="${value}"`;
      }

      // Add state properties
      for (const prop of node.properties || []) {
        if (prop.name === "disabled" && prop.value?.value) {
          line += " [disabled]";
        }
        if (prop.name === "checked") {
          line += ` [checked=${prop.value?.value}]`;
        }
        if (prop.name === "expanded") {
          line += ` [expanded=${prop.value?.value}]`;
        }
        if (prop.name === "selected" && prop.value?.value) {
          line += " [selected]";
        }
        if (prop.name === "focused" && prop.value?.value) {
          line += " [focused]";
        }
      }

      lines.push(line);

      for (const childId of node.childIds || []) {
        const child = nodeMap.get(childId);
        if (child) formatNode(child, indent + 1);
      }
    };

    // Find the root (no parentId) and start formatting
    const root = nodes.find((n) => !n.parentId);
    if (root) formatNode(root, 0);

    return lines.join("\n");
  }

  /**
   * Capture a screenshot of the connected page via Page.captureScreenshot.
   * Returns base64-encoded PNG data.
   */
  async captureScreenshot(): Promise<string> {
    if (!this.client) throw new Error("CDP not connected");

    const { data } = await this.client.Page.captureScreenshot({
      format: "png",
    });
    return data;
  }

  /**
   * Scroll an element into view by CSS selector.
   */
  async scrollToElement(selector: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression: `
        (function() {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' });
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return JSON.stringify({ success: true });
        })()
      `,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text };
    }
    return JSON.parse(result.result.value as string);
  }

  /**
   * Press a keyboard key (Enter, Tab, Escape, etc.) via Input.dispatchKeyEvent.
   */
  async pressKey(key: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const keyMap: Record<string, { code: string; keyCode: number }> = {
      Enter:     { code: "Enter",     keyCode: 13 },
      Tab:       { code: "Tab",       keyCode: 9 },
      Escape:    { code: "Escape",    keyCode: 27 },
      Backspace: { code: "Backspace", keyCode: 8 },
      Delete:    { code: "Delete",    keyCode: 46 },
      ArrowUp:   { code: "ArrowUp",   keyCode: 38 },
      ArrowDown: { code: "ArrowDown", keyCode: 40 },
      ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
      ArrowRight:{ code: "ArrowRight",keyCode: 39 },
      Home:      { code: "Home",      keyCode: 36 },
      End:       { code: "End",       keyCode: 35 },
      PageUp:    { code: "PageUp",    keyCode: 33 },
      PageDown:  { code: "PageDown",  keyCode: 34 },
      Space:     { code: "Space",     keyCode: 32 },
    };

    const mapped = keyMap[key];
    const code = mapped?.code || key;
    const keyCode = mapped?.keyCode || key.charCodeAt(0);

    try {
      await this.client.Input.dispatchKeyEvent({
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
      await this.client.Input.dispatchKeyEvent({
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Navigate to a URL via Page.navigate.
   */
  async navigate(url: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    try {
      const result = await this.client.Page.navigate({ url });
      if (result.errorText) {
        return { success: false, error: result.errorText };
      }
      return { success: true, data: { frameId: result.frameId } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Wait for an element matching the selector to appear, polling until timeout.
   */
  async waitForElement(selector: string, timeoutMs: number = 5000): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const startTime = Date.now();
    const pollInterval = 200;

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.client.Runtime.evaluate({
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
      });

      if (result.result.value === true) {
        return { success: true, data: { elapsed: Date.now() - startTime } };
      }

      await this.sleep(pollInterval);
    }

    return { success: false, error: `Element ${selector} did not appear within ${timeoutMs}ms` };
  }

  // ── CDP-level fallback methods ────────────────────────────────

  /**
   * Click an element using DOM.getBoxModel + Input.dispatchMouseEvent.
   * Fallback for apps that block synthetic events from Runtime.evaluate.
   */
  async clickElementViaCdp(selector: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    try {
      await this.client.DOM.enable();
      const { root } = await this.client.DOM.getDocument({ depth: 0 });
      const { nodeId } = await this.client.DOM.querySelector({
        nodeId: root.nodeId,
        selector,
      });

      if (!nodeId) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      await this.client.DOM.scrollIntoViewIfNeeded({ nodeId });
      const { model } = await this.client.DOM.getBoxModel({ nodeId });

      const content = model.content;
      const centerX = (content[0] + content[2]) / 2;
      const centerY = (content[1] + content[5]) / 2;

      await this.client.Input.dispatchMouseEvent({
        type: "mousePressed",
        x: centerX,
        y: centerY,
        button: "left",
        clickCount: 1,
      });
      await this.client.Input.dispatchMouseEvent({
        type: "mouseReleased",
        x: centerX,
        y: centerY,
        button: "left",
        clickCount: 1,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Type into the currently focused element using Input.insertText.
   * Fallback for apps where Runtime.evaluate input setting fails.
   */
  async typeViaCdp(text: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    try {
      await this.client.Input.insertText({ text });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Action dispatch ───────────────────────────────────────────

  /**
   * Execute a structured AgentAction. This is the main dispatcher
   * called by the tool-block parser.
   */
  async executeAction(action: AgentAction): Promise<AgentActionResult> {
    switch (action.action) {
      case "click":
        if (action.selector) {
          const result = await this.clickElement(action.selector);
          // If synthetic click failed, try CDP-level fallback
          if (!result.success) {
            return this.clickElementViaCdp(action.selector);
          }
          return result;
        }
        if (action.x !== undefined && action.y !== undefined) {
          return this.clickAtCoordinates(action.x, action.y);
        }
        return { success: false, error: "click requires selector or x/y coordinates" };

      case "click_text":
        if (!action.text) return { success: false, error: "click_text requires text" };
        return this.clickByText(action.text, action.tagFilter);

      case "type":
        if (!action.selector) return { success: false, error: "type requires selector" };
        if (action.text === undefined) return { success: false, error: "type requires text" };
        return this.typeIntoElement(action.selector, action.text);

      case "eval":
        if (!action.expression) return { success: false, error: "eval requires expression" };
        return this.evaluateExpression(action.expression);

      case "get_elements":
        try {
          const elements = await this.getInteractiveElements();
          return { success: true, data: elements };
        } catch (err) {
          return { success: false, error: String(err) };
        }

      case "get_a11y_tree":
        try {
          const tree = await this.getAccessibilityTree(action.depth);
          return { success: true, data: tree };
        } catch (err) {
          return { success: false, error: String(err) };
        }

      case "screenshot":
        try {
          const screenshot = await this.captureScreenshot();
          return { success: true, data: { base64: screenshot } };
        } catch (err) {
          return { success: false, error: String(err) };
        }

      case "scroll":
        if (!action.selector) return { success: false, error: "scroll requires selector" };
        return this.scrollToElement(action.selector);

      case "press_key":
        if (!action.key) return { success: false, error: "press_key requires key" };
        return this.pressKey(action.key);

      case "navigate":
        if (!action.text) return { success: false, error: "navigate requires text (URL)" };
        return this.navigate(action.text);

      case "wait":
        if (!action.selector) return { success: false, error: "wait requires selector" };
        return this.waitForElement(action.selector, action.timeout);

      case "select":
        if (!action.selector) return { success: false, error: "select requires selector" };
        if (!action.value) return { success: false, error: "select requires value" };
        return this.selectOption(action.selector, action.value);

      default:
        return { success: false, error: `Unknown action: ${action.action}` };
    }
  }

  /**
   * Click at specific coordinates using Input.dispatchMouseEvent.
   */
  private async clickAtCoordinates(x: number, y: number): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    try {
      await this.client.Input.dispatchMouseEvent({
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await this.client.Input.dispatchMouseEvent({
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Select an option from a <select> element.
   */
  private async selectOption(selector: string, value: string): Promise<AgentActionResult> {
    if (!this.client) throw new Error("CDP not connected");

    const result = await this.client.Runtime.evaluate({
      expression: `
        (function() {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return JSON.stringify({ success: false, error: 'Element not found' });
          if (el.tagName !== 'SELECT') return JSON.stringify({ success: false, error: 'Element is not a <select>' });

          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return JSON.stringify({ success: true });
        })()
      `,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text };
    }
    return JSON.parse(result.result.value as string);
  }

  // ── Patch injection helpers ──────────────────────────────────

  /**
   * Register a script to run on every new document load via Page.addScriptToEvaluateOnNewDocument.
   * Returns the identifier for later removal.
   */
  async addScriptToEvaluateOnNewDocument(source: string): Promise<string> {
    if (!this.client) throw new Error("CDP not connected");

    await this.client.Page.enable();
    const { identifier } = await this.client.Page.addScriptToEvaluateOnNewDocument({
      source,
    });
    return identifier;
  }

  /**
   * Remove a previously registered script from Page.addScriptToEvaluateOnNewDocument.
   */
  async removeScriptToEvaluateOnNewDocument(identifier: string): Promise<void> {
    if (!this.client) throw new Error("CDP not connected");

    await this.client.Page.removeScriptToEvaluateOnNewDocument({ identifier });
  }

  /**
   * Get the raw CDP client for advanced operations.
   * Used by PatchService for Page domain access.
   */
  getClient(): CDP.Client | null {
    return this.client;
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
