# Agentlication Research: CDP Action Execution & Native App Support

**Date:** 2026-03-28
**Author:** Claude (research session)

---

## 1. Executive Summary

### CDP Action Execution (Electron Apps)

**Recommendation:** Use a **hybrid approach** combining `Runtime.evaluate` for most interactions with `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` as fallback for edge cases. The agent should specify targets via **CSS selectors** (primary) with **text content** and **XPath** as fallbacks. Actions should be defined as **structured tool calls** using a simple JSON format that the agent outputs and Agentlication's main process intercepts and executes.

**Key findings:**
- The codebase already has `Runtime.evaluate` working -- most click/type/interact actions can be built on top of it
- `Input.dispatchMouseEvent` requires pixel coordinates, which means resolving element positions first via `DOM.getBoxModel` or `Runtime.evaluate` -- more complex but necessary for drag, hover, and apps that intercept synthetic events
- The CDP `Accessibility` domain provides an accessibility tree that can serve as a compact, agent-friendly representation of the page (much smaller than full DOM)
- Claude CLI's `--output-format stream-json` already emits structured events -- the existing streaming parser can be extended to detect tool-use blocks

### Native App Support (macOS non-Electron)

**Recommendation:** Use a **compiled Swift CLI binary** that communicates with Node.js via JSON over stdout/stdin. This is 40x faster than JXA/osascript (0.13s vs 5.5s) and provides full access to the AXUIElement API. The binary should be compiled at build time and bundled with the Electron app.

**Key findings:**
- macOS Accessibility API (AXUIElement) provides element hierarchy, roles, labels, values, positions, sizes, and actions
- A compiled Swift binary can read the full accessibility tree of Safari in ~130ms -- fast enough for real-time agent use
- `AXUIElementPerformAction` can click buttons, `AXUIElementSetAttributeValue` can type into text fields
- JXA (osascript -l JavaScript) works but is 40x slower (~5.5s for a tree read)
- CGEvent provides low-level mouse/keyboard simulation as a fallback
- The `node-mac-permissions` npm package can help manage Accessibility permission requests

---

## 2. CDP Action Execution

### 2.1 Current State

The codebase currently has:
- **`CdpService.evaluate()`** -- executes arbitrary JS via `Runtime.evaluate` (line 118 of `cdp-service.ts`)
- **`CdpService.getDOM()`** -- gets full `outerHTML` via `Runtime.evaluate`
- **`CdpService.getPageInfo()`** -- gathers title, URL, framework, localStorage keys, DOM structure
- **`Runtime.enable()`** called on connect
- Placeholder action syntax in the companion system prompt: `[CLICK: selector]`, `[EVAL: code]`, `[TYPE: selector, text]`
- An `agent:tool-use` / `agent:tool-result` event system already defined in contracts but not fully wired

### 2.2 Available CDP Domains

From the protocol.json bundled with chrome-remote-interface v0.33.2:

| Domain | Key Commands for Agentlication |
|--------|-------------------------------|
| **Runtime** | `evaluate`, `callFunctionOn`, `addBinding` |
| **DOM** | `querySelector`, `querySelectorAll`, `getBoxModel`, `getContentQuads`, `focus`, `scrollIntoViewIfNeeded`, `performSearch`, `getDocument`, `resolveNode`, `describeNode` |
| **Input** | `dispatchMouseEvent`, `dispatchKeyEvent`, `insertText`, `dispatchTouchEvent`, `synthesizeTapGesture`, `synthesizeScrollGesture` |
| **DOMSnapshot** | `captureSnapshot` -- structured snapshot of entire DOM tree with computed styles and positions |
| **Accessibility** | `getFullAXTree`, `queryAXTree`, `getPartialAXTree` -- accessibility tree with roles, names, values |
| **Page** | `navigate`, `reload`, `captureScreenshot`, `getFrameTree` |
| **CSS** | `getComputedStyleForNode`, `getMatchedStylesForNode` |
| **Overlay** | `highlightNode`, `hideHighlight` -- visual debugging |

### 2.3 Approach A: Runtime.evaluate (Recommended Primary)

This is the simplest approach and already partially works. The agent outputs JS code blocks that get evaluated in the target app's context.

#### Click by CSS Selector

```typescript
// In cdp-service.ts
async clickElement(selector: string): Promise<{ success: boolean; error?: string }> {
  if (!this.client) throw new Error("CDP not connected");

  const result = await this.client.Runtime.evaluate({
    expression: `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${selector}' });

        // Scroll into view
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Focus the element
        el.focus();

        // Dispatch a proper click event sequence
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

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
```

#### Type into an Element

```typescript
async typeIntoElement(
  selector: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  if (!this.client) throw new Error("CDP not connected");

  const result = await this.client.Runtime.evaluate({
    expression: `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify({ success: false, error: 'Element not found' });

        // Focus and clear
        el.focus();
        el.value = '';

        // Set value and dispatch events to trigger React/Vue/Angular change detection
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, ${JSON.stringify(text)});
        } else {
          el.value = ${JSON.stringify(text)};
        }

        // Fire input events that frameworks listen to
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
```

**Why the native setter trick?** React uses synthetic events and overrides the `value` setter on input elements. Setting `.value` directly bypasses React's change detection. The native setter approach triggers React's internal `onChange` handler.

#### Click by Text Content

```typescript
async clickByText(
  text: string,
  tagFilter?: string
): Promise<{ success: boolean; error?: string }> {
  if (!this.client) throw new Error("CDP not connected");

  const result = await this.client.Runtime.evaluate({
    expression: `
      (function() {
        const tag = ${JSON.stringify(tagFilter || '*')};
        const elements = document.querySelectorAll(tag);
        for (const el of elements) {
          if (el.textContent?.trim() === ${JSON.stringify(text)} ||
              el.textContent?.trim().includes(${JSON.stringify(text)})) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
            return JSON.stringify({
              success: true,
              tagName: el.tagName,
              selector: buildSelector(el)
            });
          }
        }
        return JSON.stringify({
          success: false,
          error: 'No element with text: ${text}'
        });

        function buildSelector(el) {
          if (el.id) return '#' + el.id;
          let path = el.tagName.toLowerCase();
          if (el.className) {
            path += '.' + el.className.trim().split(/\\s+/).join('.');
          }
          return path;
        }
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
```

### 2.4 Approach B: CDP DOM + Input Domains (Fallback for Edge Cases)

Some apps intercept or prevent synthetic JS events. For these, use the actual CDP protocol domains.

#### Click Using DOM.getBoxModel + Input.dispatchMouseEvent

```typescript
async clickElementViaCdp(
  selector: string
): Promise<{ success: boolean; error?: string }> {
  if (!this.client) throw new Error("CDP not connected");

  // Step 1: Enable DOM domain
  await this.client.DOM.enable();

  // Step 2: Get document root
  const { root } = await this.client.DOM.getDocument({ depth: 0 });

  // Step 3: Find element by selector
  const { nodeId } = await this.client.DOM.querySelector({
    nodeId: root.nodeId,
    selector,
  });

  if (!nodeId) {
    return { success: false, error: `Element not found: ${selector}` };
  }

  // Step 4: Scroll into view
  await this.client.DOM.scrollIntoViewIfNeeded({ nodeId });

  // Step 5: Get element's bounding box
  const { model } = await this.client.DOM.getBoxModel({ nodeId });
  // content quad: [x1,y1, x2,y2, x3,y3, x4,y4]
  const content = model.content;
  const centerX = (content[0] + content[2]) / 2;
  const centerY = (content[1] + content[5]) / 2;

  // Step 6: Dispatch mouse events at the center of the element
  await this.client.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x: centerX,
    y: centerY,
    button: 'left',
    clickCount: 1,
  });
  await this.client.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x: centerX,
    y: centerY,
    button: 'left',
    clickCount: 1,
  });

  return { success: true };
}
```

#### Type Using Input.insertText and Input.dispatchKeyEvent

```typescript
async typeViaCdp(text: string): Promise<void> {
  if (!this.client) throw new Error("CDP not connected");

  // Method 1: insertText (simplest, works for most cases)
  await this.client.Input.insertText({ text });
}

async pressKey(
  key: string,
  code: string,
  keyCode: number
): Promise<void> {
  if (!this.client) throw new Error("CDP not connected");

  // Method 2: Full key events (needed for special keys like Enter, Tab, Escape)
  await this.client.Input.dispatchKeyEvent({
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
  await this.client.Input.dispatchKeyEvent({
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
}
```

### 2.5 Using the CDP Accessibility Tree for Agent Context

Instead of sending the full DOM (which can be 50KB+), use the CDP Accessibility tree as a compact, agent-friendly representation.

```typescript
async getAccessibilityTree(): Promise<string> {
  if (!this.client) throw new Error("CDP not connected");

  await this.client.Accessibility.enable();
  const { nodes } = await this.client.Accessibility.getFullAXTree({
    depth: 5,
  });

  // Format as a compact tree string
  const lines: string[] = [];
  const nodeMap = new Map(nodes.map((n: any) => [n.nodeId, n]));

  function formatNode(node: any, depth: number) {
    if (node.ignored) return;
    const indent = '  '.repeat(depth);
    const role = node.role?.value || '?';
    const name = node.name?.value || '';
    const value = node.value?.value || '';

    let line = `${indent}${role}`;
    if (name) line += ` "${name}"`;
    if (value && typeof value === 'string' && value.length < 80) {
      line += ` val="${value}"`;
    }

    // Add properties like disabled, checked, expanded
    for (const prop of (node.properties || [])) {
      if (prop.name === 'disabled' && prop.value?.value) {
        line += ' [disabled]';
      }
      if (prop.name === 'checked') {
        line += ` [checked=${prop.value?.value}]`;
      }
      if (prop.name === 'expanded') {
        line += ` [expanded=${prop.value?.value}]`;
      }
    }

    lines.push(line);

    for (const childId of (node.childIds || [])) {
      const child = nodeMap.get(childId);
      if (child) formatNode(child, depth + 1);
    }
  }

  const root = nodes.find((n: any) => !n.parentId);
  if (root) formatNode(root, 0);

  return lines.join('\n');
}
```

**This is how the chrome-devtools-mcp `take_snapshot` tool works** -- it uses the a11y tree, not the raw DOM. The snapshot is compact and semantically rich, making it much better for agent consumption.

### 2.6 Element Identification Strategy

The agent needs a way to refer to elements. Recommended approach with priority order:

1. **CSS selector** (most reliable): `#submit-btn`, `.nav-link[href="/settings"]`, `button[data-testid="save"]`
2. **Text content** (most natural for agents): `button:has-text("Save Changes")`
3. **ARIA role + name** (accessible and stable): `role:button name:"Submit"`
4. **XPath** (fallback for complex structures): `//div[@class="panel"]//button[2]`
5. **Coordinates** (last resort, for canvas/custom rendering): `@(450, 320)`

#### Interactive Element Map

Build a map of all interactive elements and give the agent a numbered list:

```typescript
async getInteractiveElements(): Promise<InteractiveElement[]> {
  if (!this.client) throw new Error("CDP not connected");

  const result = await this.client.Runtime.evaluate({
    expression: `
      (function() {
        const interactable =
          'a, button, input, select, textarea, [role="button"], ' +
          '[role="link"], [role="checkbox"], [role="tab"], ' +
          '[role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"])';

        const elements = document.querySelectorAll(interactable);
        const results = [];

        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

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
          const testId = el.getAttribute('data-testid');
          if (testId) return '[data-testid="' + testId + '"]';
          let path = el.tagName.toLowerCase();
          if (el.className && typeof el.className === 'string') {
            const cls = el.className.trim().split(/\\s+/).slice(0, 2);
            if (cls.length) {
              path += '.' + cls.map(c => CSS.escape(c)).join('.');
            }
          }
          return path;
        }
      })()
    `,
    returnByValue: true,
  });

  return JSON.parse(result.result.value as string);
}
```

The agent receives something like:

```
[0] button "Save Changes" selector:#save-btn @(450,320,120x40)
[1] input[text] placeholder:"Search..." selector:#search @(200,60,300x36) val=""
[2] a "Settings" selector:a.nav-link @(50,200,100x24)
[3] button "Delete" selector:.delete-btn [disabled] @(450,380,80x32)
```

Then the agent can say: "Click element [0]" or "Type 'hello' into element [1]"

### 2.7 Handling Iframes, Shadow DOM, and Web Components

#### Iframes

CDP targets specific execution contexts. For cross-origin iframes, **`Input.dispatchMouseEvent` / `Input.insertText`** is the only reliable approach because these work at the browser level, not the JS level.

For same-origin iframes, `Runtime.evaluate` can access `iframe.contentDocument` directly.

For cross-origin iframes:
1. Use `DOM.getDocument({ pierce: true })` to traverse into iframe DOMs
2. Use `DOM.getBoxModel` to get coordinates of elements inside iframes
3. Use `Input.dispatchMouseEvent` at those coordinates to click
4. Use `Input.insertText` to type into focused elements inside iframes

Alternatively, use `Target.attachToTarget` to connect to the iframe's separate target and run `Runtime.evaluate` in its context.

#### Shadow DOM

```typescript
// pierce: true in DOM.getDocument traverses shadow roots
const { root } = await this.client.DOM.getDocument({
  depth: -1,
  pierce: true,
});

// In Runtime.evaluate, use el.shadowRoot to access shadow DOM
const result = await this.client.Runtime.evaluate({
  expression: `
    (function() {
      const host = document.querySelector('my-component');
      const shadowBtn = host?.shadowRoot?.querySelector('button');
      if (shadowBtn) { shadowBtn.click(); return true; }
      return false;
    })()
  `,
  returnByValue: true,
});
```

### 2.8 Agent Action Format -- Structured Tool Use

**Recommended: JSON tool-call blocks in the agent's response.**

The agent outputs structured action blocks that the main process parses and executes:

```
I'll click the save button for you.

\`\`\`tool
{"action": "click", "selector": "#save-btn"}
\`\`\`

Done! The save button has been clicked.
```

#### Tool Schema

```typescript
// In packages/contracts/src/index.ts

export type AgentActionKind =
  | 'click'
  | 'type'
  | 'eval'
  | 'click_text'
  | 'select'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'get_elements'
  | 'navigate'
  | 'press_key';

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
}
```

Examples:
- `{ "action": "click", "selector": "#submit" }`
- `{ "action": "type", "selector": "input[name=email]", "text": "user@example.com" }`
- `{ "action": "eval", "expression": "document.title" }`
- `{ "action": "click_text", "text": "Save Changes" }`
- `{ "action": "press_key", "key": "Enter" }`
- `{ "action": "scroll", "selector": ".content", "y": 500 }`
- `{ "action": "screenshot" }`
- `{ "action": "get_elements" }`
- `{ "action": "navigate", "text": "https://example.com" }`
- `{ "action": "wait", "selector": ".loading", "timeout": 5000 }`

#### Parsing Tool Blocks from Streaming Response

```typescript
// In agent-service.ts -- add to the streaming handler

function parseToolBlocks(text: string): AgentAction[] {
  const toolBlockRegex = /```tool\n([\s\S]*?)```/g;
  const actions: AgentAction[] = [];

  let match;
  while ((match = toolBlockRegex.exec(text)) !== null) {
    try {
      const action = JSON.parse(match[1].trim());
      if (action.action) actions.push(action);
    } catch {
      // Not valid JSON -- skip
    }
  }

  return actions;
}
```

In the streaming handler, accumulate text and check for complete tool blocks. Track which actions have already been executed to avoid double-execution.

### 2.9 Alternative: MCP Server Approach

Instead of parsing tool blocks from text output, Agentlication could expose an **MCP server** that the Claude CLI connects to. This gives the agent real structured tool calling.

```json
{
  "mcpServers": {
    "agentlication": {
      "command": "node",
      "args": ["/path/to/agentlication-mcp-server.js"],
      "env": {
        "CDP_PORT": "9222"
      }
    }
  }
}
```

The MCP server would expose tools like:
- `click(selector)` -- click an element
- `type(selector, text)` -- type into an element
- `eval(expression)` -- evaluate JS
- `screenshot()` -- take a screenshot
- `get_elements()` -- get interactive elements list
- `get_accessibility_tree()` -- get the a11y tree

**Pros:** Native structured tool use, no text parsing, automatic retries, proper error handling.
**Cons:** More complex setup, requires spawning an MCP server process, needs Claude CLI to support `--mcp-config` (it does).

**This is the better long-term approach** but the tool-block parsing is simpler to implement first.

### 2.10 Updated Type Definitions Needed

The `chrome-remote-interface.d.ts` file needs to be extended to support the additional CDP domains (DOM, Input, Accessibility, Page). The current file only has `RuntimeDomain`. Add interfaces for:

- `DOMDomain` -- enable, getDocument, querySelector, querySelectorAll, getBoxModel, scrollIntoViewIfNeeded, focus, performSearch, getSearchResults, resolveNode, getOuterHTML
- `InputDomain` -- dispatchMouseEvent, dispatchKeyEvent, insertText
- `AccessibilityDomain` -- enable, disable, getFullAXTree, queryAXTree
- `PageDomain` -- enable, navigate, reload, captureScreenshot

Each with proper parameter and return types. See the full protocol.json in `node_modules/chrome-remote-interface/lib/protocol.json` for reference.

---

## 3. Native App Support (macOS non-Electron)

### 3.1 Research Summary

I tested four approaches for interacting with native macOS apps:

| Approach | Speed | Capabilities | Complexity |
|----------|-------|-------------|------------|
| **Compiled Swift binary** | ~130ms (tree read) | Full AXUIElement API, CGEvent | Medium (compile step needed) |
| **JXA (osascript -l JavaScript)** | ~5,500ms (tree read) | Full System Events access | Low (no compile) |
| **AppleScript (osascript)** | ~500ms for simple commands | System Events, limited scripting | Low |
| **CGEvent (via Swift)** | <10ms per event | Mouse/keyboard only, no element discovery | Low |

**Winner: Compiled Swift binary.** It is 40x faster than JXA and provides the same capabilities. The compile step can happen at build time.

### 3.2 What the Accessibility API Provides

From testing with Safari, Finder, and Notes:

**Element attributes available:**
- `AXRole` -- button, textField, staticText, group, window, toolbar, etc.
- `AXTitle` / `AXDescription` -- human-readable name/description
- `AXValue` -- current value (text field content, checkbox state, etc.)
- `AXEnabled` -- whether the element is interactable
- `AXFocused` -- whether the element has focus
- `AXPosition` -- screen coordinates (x, y)
- `AXSize` -- dimensions (width, height)
- `AXChildren` -- child elements (tree structure)
- `AXIdentifier` -- unique identifier (not always present)

**Actions available:**
- `AXPress` -- click a button, toggle a checkbox
- `AXShowMenu` -- open a context/dropdown menu
- `AXZoomWindow` -- zoom a window
- `AXRaise` -- bring window to front
- `AXScrollLeftByPage` / `AXScrollUpByPage` etc. -- scroll
- Custom actions per-element (shown in the action list)

**What you CAN'T get:**
- No DOM access
- No JS execution
- No CSS information
- No framework detection
- No network requests
- No localStorage/sessionStorage

### 3.3 Live Test Results

**Safari accessibility tree (compiled Swift, 130ms):**
```
AXWindow "claude app - Google Search" @(239,71,1324x940) actions:AXRaise
  AXSplitGroup @(239,71,1324x940)
    AXTabGroup @(239,71,1324x940)
    AXGroup [Set Default Browser Banner] @(239,123,1324x80)
      AXButton "Make Safari Default" enabled:true @(1400,151,149x24) actions:AXPress
  AXToolbar @(239,71,1324x52) actions:AXShowMenu
    AXGroup @(331,71,75x52)
      AXButton [show sidebar] enabled:true @(334,78,42x38) actions:AXPress
      AXMenuButton [Tab Group picker] enabled:true @(374,78,20x38) actions:AXShowMenu,AXPress
    AXGroup @(630,71,543x52)
      AXTextField val="claude app" enabled:true @(...)
      AXButton [Reload this page] enabled:true @(...)
```

**Clicking a button by label (compiled Swift):**
```
Found: AXButton "?"
AXPress performed successfully
-- execution time: ~1.0s (includes app response time)
```

**Notes app tree (compiled Swift, 217ms):**
```
AXWindow "All iCloud -- 219 notes" @(684,335,1000x660) actions:AXRaise
  AXSplitGroup @(684,335,1000x660)
    AXScrollArea @(692,387,220x600)
      AXOutline [Folders] enabled:true @(691,386,222x602) actions:AXShowMenu
        AXRow @(692,387,220x19)
        AXRow @(692,406,220x32)
        ...
```

### 3.4 Architecture: Swift CLI Binary

The recommended approach is a compiled Swift CLI tool that Agentlication bundles and calls from Node.js.

#### Command Interface

```
ax-bridge <command> <app-name> [args...]

Commands:
  tree <app-name> [--depth N] [--window N]    Get accessibility tree as JSON
  click <app-name> <label-or-path>            Click element by label/description
  type <app-name> <text>                       Type text into focused element
  focus <app-name> <label-or-path>            Focus an element
  actions <app-name> <label-or-path>          List available actions on element
  info <app-name>                              Get app info (windows, menu bar)
  elements <app-name> [--interactive]          List all interactive elements
  perform <app-name> <action> <label-or-path> Perform any AX action
  set-value <app-name> <label-or-path> <val>  Set element value
  screenshot <app-name>                        Take screenshot of app window
  check-permission                             Check if Accessibility is granted
  request-permission                           Prompt user for Accessibility
```

#### Swift Implementation Sketch

The core Swift code uses these APIs:
- `AXUIElementCreateApplication(pid)` to get the app's root element
- `AXUIElementCopyAttributeValue` to read any attribute
- `AXUIElementCopyActionNames` to list available actions
- `AXUIElementPerformAction` to click/press/interact
- `AXUIElementSetAttributeValue` to set values (text fields, focus)
- `AXValueGetValue` to extract CGPoint/CGSize from position/size attributes

Key functions needed:
- `elementToDict()` -- recursively convert AX tree to JSON dictionary
- `findElementByLabel()` -- search tree by name/description match
- `findTextField()` -- find first text field in tree
- CGEvent functions for keyboard simulation when AX value setting is insufficient

All commands output JSON to stdout for easy parsing from Node.js.

#### Node.js Integration

```typescript
// apps/electron/src/accessibility-service.ts

import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class AccessibilityService {
  private binaryPath: string;

  constructor() {
    const isDev = !require('electron').app.isPackaged;
    this.binaryPath = isDev
      ? path.join(__dirname, '..', '..', '..', 'native', 'ax-bridge')
      : path.join(process.resourcesPath, 'native', 'ax-bridge');
  }

  async getTree(appName: string, depth: number = 5): Promise<AXTree> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'tree', appName, '--depth', String(depth), '--json'
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  }

  async click(appName: string, label: string): Promise<ActionResult> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'click', appName, label
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  }

  async type(appName: string, text: string): Promise<ActionResult> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'type', appName, text
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  }

  async focus(appName: string, label: string): Promise<ActionResult> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'focus', appName, label
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  }

  async getInteractiveElements(
    appName: string
  ): Promise<AXElement[]> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'elements', appName, '--interactive', '--json'
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  }

  async performAction(
    appName: string,
    action: string,
    label: string
  ): Promise<ActionResult> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'perform', appName, action, label
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  }

  async setValue(
    appName: string,
    label: string,
    value: string
  ): Promise<ActionResult> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'set-value', appName, label, value
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  }

  async checkPermission(): Promise<boolean> {
    const { stdout } = await execFileAsync(this.binaryPath, [
      'check-permission'
    ], { timeout: 2000 });
    return JSON.parse(stdout).granted === true;
  }

  async requestPermission(): Promise<void> {
    await execFileAsync(this.binaryPath, [
      'request-permission'
    ], { timeout: 2000 });
  }
}
```

### 3.5 Permission Handling

Accessibility API requires explicit user permission. Agentlication needs to:

1. Check if permission is granted on startup
2. If not, show a clear prompt explaining why it is needed
3. Open System Settings > Privacy > Accessibility automatically

```typescript
// In main.ts -- add to the agentlication flow for non-Electron apps
import { systemPreferences } from 'electron';

function checkAccessibilityPermission(): boolean {
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function requestAccessibilityPermission(): void {
  // This opens System Settings and highlights the app in the list
  systemPreferences.isTrustedAccessibilityClient(true);
}
```

### 3.6 Hybrid Approach: Screenshots + Accessibility Tree

For the richest understanding of a native app, combine:

1. **Accessibility tree** -- structural information, element labels, actions
2. **Screenshot** -- visual context the agent can "see"
3. **Element overlay** -- highlight elements in the screenshot using AX position data

The companion agent system prompt for native apps would include the AX tree (compact text format) and optionally a screenshot. The agent uses tool blocks with `ax_` prefixed actions:

- `{ "action": "ax_click", "label": "Save" }`
- `{ "action": "ax_type", "text": "Hello world" }`
- `{ "action": "ax_focus", "label": "Search" }`
- `{ "action": "ax_get_tree" }`
- `{ "action": "ax_screenshot" }`

### 3.7 AppleScript/JXA as Lightweight Alternative

For simple one-off actions where the compiled binary is not needed, `osascript` can work:

```typescript
// Quick AppleScript actions via osascript
async function appleScriptClick(
  appName: string,
  buttonName: string
): Promise<void> {
  await execFileAsync('osascript', ['-e', `
    tell application "System Events"
      tell process "${appName}"
        click button "${buttonName}" of window 1
      end tell
    end tell
  `]);
}
```

**Note:** AppleScript is fine for simple, infrequent actions but is too slow (~500ms per call) for building an interactive agent experience. Use the compiled Swift binary for anything that runs frequently.

---

## 4. Implementation Plan

### Phase 1: CDP Actions (1-2 days)

**Priority: HIGH -- Enables the core use case**

| Step | Task | Complexity | Dependency |
|------|------|-----------|------------|
| 1 | Extend `chrome-remote-interface.d.ts` with DOM, Input, Accessibility, Page types | Low | None |
| 2 | Add action methods to `CdpService`: clickElement, typeIntoElement, clickByText, getInteractiveElements, getAccessibilityTree, captureScreenshot | Medium | Step 1 |
| 3 | Add tool-block parser to `AgentService` -- parse tool blocks from streaming response, execute via CdpService, send results as agent:tool-result events | Medium | Step 2 |
| 4 | Update companion system prompt -- include interactive element list, document tool-block format, include a11y tree as compact DOM alternative | Low | Step 2 |
| 5 | Add CDP action types to contracts -- AgentAction type, new IPC channels | Low | None |

### Phase 2: Robust CDP Actions (2-3 days)

| Step | Task | Complexity | Dependency |
|------|------|-----------|------------|
| 6 | Add fallback CDP-level interactions: clickElementViaCdp (DOM.getBoxModel + Input.dispatchMouseEvent), typeViaCdp (Input.insertText), pressKey (Input.dispatchKeyEvent) | Medium | Step 2 |
| 7 | Handle iframes and shadow DOM -- detect cross-origin iframes, fall back to Input domain, pierce shadow DOM in queries | High | Step 6 |
| 8 | Add wait/retry logic -- wait for element to appear, retry with alternative approaches | Medium | Step 2 |

### Phase 3: Native App Support (3-5 days)

| Step | Task | Complexity | Dependency |
|------|------|-----------|------------|
| 9 | Build the Swift `ax-bridge` CLI binary -- all commands, JSON output, compile script | High | None |
| 10 | Create `AccessibilityService` in Electron main process -- Node.js wrapper | Medium | Step 9 |
| 11 | Add permission flow -- check on agentlicate, show request UI, guide to System Settings | Low | Step 10 |
| 12 | Create native app companion system prompt -- AX tree, AX tool blocks | Low | Step 10 |
| 13 | Wire up IPC handlers -- new channels, route based on Electron vs native | Medium | Steps 10, 12 |

### Phase 4: Screenshot + Vision (2-3 days, optional)

| Step | Task | Complexity | Dependency |
|------|------|-----------|------------|
| 14 | Screenshot capture for native apps -- screencapture -l, send to agent as base64 | Low | Step 10 |
| 15 | Overlay element positions on screenshots -- draw bounding boxes, number elements | Medium | Step 14 |

### Phase 5: MCP Server (Future, 3-5 days)

| Step | Task | Complexity | Dependency |
|------|------|-----------|------------|
| 16 | Build an Agentlication MCP server -- expose CDP and AX actions as MCP tools, pass to Claude CLI via --mcp-config | High | Steps 2, 10 |

---

## 5. Open Questions

### For Ethan to decide:

1. **Tool format: tool blocks vs MCP server?**
   - Tool blocks (JSON in fenced code blocks) are simpler to implement now
   - MCP server gives real structured tool use but is more complex
   - Recommendation: Start with tool blocks, migrate to MCP later
   - The existing `agent:tool-use` event kind suggests MCP was already being considered

2. **Agent context: DOM vs Accessibility tree vs Interactive elements list?**
   - Full DOM is too large and noisy for the agent (50KB+)
   - CDP Accessibility tree is compact and semantic (~2-5KB)
   - Interactive elements list is the most actionable (~1KB)
   - Recommendation: Send interactive elements list + a11y tree, keep DOM as on-demand

3. **Should the companion agent auto-execute tool blocks, or ask for confirmation?**
   - Auto-execute is faster and more natural
   - Confirmation is safer (user sees what will happen)
   - Recommendation: Auto-execute by default with a "safe mode" toggle

4. **How to handle the Swift binary in development vs production?**
   - Dev: compile on first run or via `npm run build:native`
   - Production: bundle pre-compiled binary in Electron's extraResources
   - Recommendation: Add a build step, bundle in production

5. **Should non-Electron apps use a different companion UI?**
   - The current companion shows DOM viewer, which is irrelevant for native apps
   - Could show the accessibility tree visualizer instead
   - Or keep it simple: just the chat panel (agent handles the tree internally)

6. **Priority: CDP actions first or native app support first?**
   - CDP actions unlock the primary use case (Electron app control)
   - Native app support is a differentiator but secondary
   - Recommendation: CDP actions first (Phase 1-2), then native (Phase 3)

7. **Codex CLI tool use format?**
   - The current Codex provider uses `exec --json` with different event types
   - Need to verify if Codex supports MCP or similar tool-use patterns
   - Tool-block parsing works regardless of provider

### Technical questions to investigate:

8. **Does `Input.dispatchMouseEvent` work on Electron apps that use BrowserViews?**
   - BrowserViews have their own coordinate systems
   - May need to calculate offsets

9. **Can `Runtime.evaluate` access web workers or service workers?**
   - Some Electron apps do heavy work in workers
   - May need `Target.attachToTarget` for worker contexts

10. **How does the React native setter trick work with Vue/Angular/Svelte?**
    - Each framework has different change detection mechanisms
    - Need to test and add framework-specific input handling

---

## Appendix: Benchmarks

| Operation | Time | Method |
|-----------|------|--------|
| Swift AX tree read (Safari, depth 4) | 130ms | Compiled Swift binary |
| Swift AX tree read (Notes, depth 4) | 217ms | Compiled Swift binary |
| Swift AX click by label | ~1.0s | Compiled binary (includes app response) |
| JXA tree read (Safari, depth 3) | 5,500ms | osascript -l JavaScript |
| AppleScript button list | ~500ms | osascript |
| Swift "hello" print | 113ms | swift -e (includes compilation) |
| CGEvent creation | <1ms | In-process Swift |
| AXIsProcessTrusted() check | <1ms | Swift |

## Appendix: npm Packages Worth Investigating

- **`node-mac-permissions`** (v2.5.0) -- manage macOS system permissions from Node.js (check/request Accessibility, Screen Recording, etc.)
- **`robotjs`** -- desktop automation (mouse/keyboard), native C++ addon, but outdated
- **`@nut-tree-fork/nut-js`** -- native system automation for Node.js (cross-platform)
- **`run-applescript`** -- run AppleScript from Node.js (by sindresorhus)

The compiled Swift binary approach is preferred over all of these because it is faster, gives more control, and does not require native Node.js addon compilation (which is fragile with Electron's Node.js version).
