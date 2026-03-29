declare module "chrome-remote-interface" {
  interface CDPOptions {
    port?: number;
    host?: string;
    target?: string;
  }

  interface RuntimeDomain {
    enable(): Promise<void>;
    evaluate(params: {
      expression: string;
      returnByValue?: boolean;
      awaitPromise?: boolean;
    }): Promise<{
      result: { value: unknown; type: string; objectId?: string };
      exceptionDetails?: { text: string };
    }>;
    callFunctionOn(params: {
      functionDeclaration: string;
      objectId?: string;
      arguments?: Array<{ value?: unknown; objectId?: string }>;
      returnByValue?: boolean;
      awaitPromise?: boolean;
    }): Promise<{
      result: { value: unknown; type: string; objectId?: string };
      exceptionDetails?: { text: string };
    }>;
  }

  // ── DOM Domain ──────────────────────────────────────────────────

  interface DOMNode {
    nodeId: number;
    backendNodeId: number;
    nodeType: number;
    nodeName: string;
    localName: string;
    nodeValue: string;
    childNodeCount?: number;
    children?: DOMNode[];
    attributes?: string[];
    documentURL?: string;
    frameId?: string;
    shadowRoots?: DOMNode[];
    contentDocument?: DOMNode;
  }

  interface BoxModel {
    content: number[];   // [x1,y1, x2,y2, x3,y3, x4,y4]
    padding: number[];
    border: number[];
    margin: number[];
    width: number;
    height: number;
  }

  interface DOMDomain {
    enable(): Promise<void>;
    disable(): Promise<void>;
    getDocument(params?: { depth?: number; pierce?: boolean }): Promise<{ root: DOMNode }>;
    querySelector(params: { nodeId: number; selector: string }): Promise<{ nodeId: number }>;
    querySelectorAll(params: { nodeId: number; selector: string }): Promise<{ nodeIds: number[] }>;
    getBoxModel(params: { nodeId?: number; backendNodeId?: number; objectId?: string }): Promise<{ model: BoxModel }>;
    scrollIntoViewIfNeeded(params: { nodeId?: number; backendNodeId?: number; objectId?: string }): Promise<void>;
    focus(params: { nodeId?: number; backendNodeId?: number; objectId?: string }): Promise<void>;
    resolveNode(params: { nodeId?: number; backendNodeId?: number; objectGroup?: string }): Promise<{ object: { objectId: string; type: string } }>;
    getOuterHTML(params: { nodeId?: number; backendNodeId?: number; objectId?: string }): Promise<{ outerHTML: string }>;
    performSearch(params: { query: string; includeUserAgentShadowDOM?: boolean }): Promise<{ searchId: string; resultCount: number }>;
    getSearchResults(params: { searchId: string; fromIndex: number; toIndex: number }): Promise<{ nodeIds: number[] }>;
    describeNode(params: { nodeId?: number; backendNodeId?: number; objectId?: string; depth?: number; pierce?: boolean }): Promise<{ node: DOMNode }>;
  }

  // ── Input Domain ──────────────────────────────────────────────

  interface InputDomain {
    dispatchMouseEvent(params: {
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      x: number;
      y: number;
      button?: "none" | "left" | "middle" | "right";
      clickCount?: number;
      modifiers?: number;
      deltaX?: number;
      deltaY?: number;
    }): Promise<void>;
    dispatchKeyEvent(params: {
      type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
      key?: string;
      code?: string;
      text?: string;
      windowsVirtualKeyCode?: number;
      nativeVirtualKeyCode?: number;
      modifiers?: number;
      autoRepeat?: boolean;
    }): Promise<void>;
    insertText(params: { text: string }): Promise<void>;
    dispatchTouchEvent(params: {
      type: "touchStart" | "touchEnd" | "touchMove" | "touchCancel";
      touchPoints: Array<{ x: number; y: number; id?: number }>;
      modifiers?: number;
    }): Promise<void>;
  }

  // ── Accessibility Domain ───────────────────────────────────────

  interface AXNode {
    nodeId: string;
    ignored: boolean;
    role?: { type: string; value: string };
    name?: { type: string; value: string; sources?: unknown[] };
    value?: { type: string; value: unknown };
    description?: { type: string; value: string };
    properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
    childIds?: string[];
    parentId?: string;
    backendDOMNodeId?: number;
  }

  interface AccessibilityDomain {
    enable(): Promise<void>;
    disable(): Promise<void>;
    getFullAXTree(params?: { depth?: number; frameId?: string }): Promise<{ nodes: AXNode[] }>;
    queryAXTree(params?: { nodeId?: number; backendNodeId?: number; objectId?: string; accessibleName?: string; role?: string }): Promise<{ nodes: AXNode[] }>;
    getPartialAXTree(params?: { nodeId?: number; backendNodeId?: number; objectId?: string; fetchRelatives?: boolean }): Promise<{ nodes: AXNode[] }>;
  }

  // ── Page Domain ─────────────────────────────────────────────────

  interface PageDomain {
    enable(): Promise<void>;
    disable(): Promise<void>;
    navigate(params: { url: string; referrer?: string }): Promise<{ frameId: string; loaderId?: string; errorText?: string }>;
    reload(params?: { ignoreCache?: boolean }): Promise<void>;
    captureScreenshot(params?: {
      format?: "jpeg" | "png" | "webp";
      quality?: number;
      clip?: { x: number; y: number; width: number; height: number; scale: number };
      fromSurface?: boolean;
      captureBeyondViewport?: boolean;
    }): Promise<{ data: string }>;
    getFrameTree(): Promise<{ frameTree: unknown }>;
  }

  // ── CDPClient ───────────────────────────────────────────────────

  interface CDPClient {
    Runtime: RuntimeDomain;
    DOM: DOMDomain;
    Input: InputDomain;
    Accessibility: AccessibilityDomain;
    Page: PageDomain;
    close(): Promise<void>;
  }

  function CDP(options?: CDPOptions): Promise<CDPClient>;

  namespace CDP {
    function List(options?: { port?: number }): Promise<
      Array<Record<string, string>>
    >;
    type Client = CDPClient;
  }

  export = CDP;
}
