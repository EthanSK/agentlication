import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as esbuild from "esbuild";
import { execFileSync } from "child_process";
import type {
  PatchMetadata,
  PatchFile,
  PatchCreateRequest,
  PatchUpdateRequest,
  PatchFormat,
  PatchInjectAt,
  PatchStatus,
  PatchListResult,
  PatchOperationResult,
} from "@agentlication/contracts";
import { CdpService } from "./cdp-service";

// ── Constants ─────────────────────────────────────────────────────

const AGENTLICATION_ROOT = path.join(os.homedir(), ".agentlication");
const APPS_ROOT = path.join(AGENTLICATION_ROOT, "apps");
const BACKUP_ROOT = path.join(AGENTLICATION_ROOT, "patches-backup");
const COMPILED_DIR = ".compiled";

// ── YAML Frontmatter Parser ───────────────────────────────────────

/**
 * Parse YAML frontmatter from a patch file.
 * Frontmatter is delimited by /*--- and ---*​/ blocks.
 */
function parseFrontmatter(content: string): { metadata: Record<string, unknown>; code: string } {
  const startMarker = "/*---";
  const endMarker = "---*/";

  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) {
    return { metadata: {}, code: content };
  }

  const yamlStart = startIdx + startMarker.length;
  const endIdx = content.indexOf(endMarker, yamlStart);
  if (endIdx === -1) {
    return { metadata: {}, code: content };
  }

  const yamlStr = content.slice(yamlStart, endIdx).trim();
  const codeStart = endIdx + endMarker.length;
  const code = content.slice(codeStart).trim();

  // Simple YAML parser for flat key-value pairs
  const metadata: Record<string, unknown> = {};
  for (const line of yamlStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: string | boolean | number | string[] = trimmed.slice(colonIdx + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Parse arrays: [item1, item2, item3]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1);
      value = inner ? inner.split(",").map(s => s.trim().replace(/^["']|["']$/g, "")) : [];
    }
    // Parse booleans
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    // Parse numbers
    else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);

    metadata[key] = value;
  }

  return { metadata, code };
}

/**
 * Serialize metadata back into YAML frontmatter format.
 */
function serializeFrontmatter(metadata: PatchMetadata): string {
  const lines: string[] = ["/*---"];

  lines.push(`name: ${metadata.name}`);
  lines.push(`description: ${metadata.description}`);
  lines.push(`version: ${metadata.version}`);
  lines.push(`author: ${metadata.author}`);
  lines.push(`target-app: ${metadata.targetApp}`);
  if (metadata.targetVersion) {
    lines.push(`target-version: "${metadata.targetVersion}"`);
  }
  lines.push(`format: ${metadata.format}`);
  lines.push(`priority: ${metadata.priority}`);
  lines.push(`enabled: ${metadata.enabled}`);
  lines.push(`inject-at: ${metadata.injectAt}`);
  lines.push(`run-once: ${metadata.runOnce}`);
  if (metadata.dependsOn.length > 0) {
    lines.push(`depends-on: [${metadata.dependsOn.join(", ")}]`);
  } else {
    lines.push(`depends-on: []`);
  }
  lines.push(`css-inject: ${metadata.cssInject}`);
  lines.push(`created: ${metadata.created}`);
  lines.push(`modified: ${metadata.modified}`);
  if (metadata.tags.length > 0) {
    lines.push(`tags: [${metadata.tags.join(", ")}]`);
  } else {
    lines.push(`tags: []`);
  }

  lines.push("---*/");
  return lines.join("\n");
}

/**
 * Convert raw parsed metadata to a typed PatchMetadata object.
 */
function toMetadata(raw: Record<string, unknown>, appSlug: string): PatchMetadata {
  return {
    name: String(raw.name || "unnamed"),
    description: String(raw.description || ""),
    version: String(raw.version || "1.0.0"),
    author: String(raw.author || "unknown"),
    targetApp: String(raw["target-app"] || appSlug),
    targetVersion: raw["target-version"] ? String(raw["target-version"]) : undefined,
    format: (raw.format as PatchFormat) || "js",
    priority: typeof raw.priority === "number" ? raw.priority : 50,
    enabled: raw.enabled !== false,
    injectAt: (raw["inject-at"] as PatchInjectAt) || "document-ready",
    runOnce: raw["run-once"] === true,
    dependsOn: Array.isArray(raw["depends-on"]) ? raw["depends-on"] : [],
    cssInject: raw["css-inject"] === true || (raw.format === "css"),
    created: String(raw.created || new Date().toISOString()),
    modified: String(raw.modified || new Date().toISOString()),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

// ── Injection Wrapper ─────────────────────────────────────────────

/**
 * Wrap patch code in the standard injection envelope.
 * Provides error handling, cleanup support, and deduplication.
 */
function wrapPatchCode(patchName: string, version: string, targetApp: string, code: string): string {
  // Escape any backticks and backslashes in the code to avoid template literal issues
  const safeName = patchName.replace(/[^a-z0-9_]/gi, "_");

  return `(function __agentlication_patch__${safeName}__() {
  'use strict';
  try {
    var __PATCH_META__ = {
      name: ${JSON.stringify(patchName)},
      version: ${JSON.stringify(version)},
      app: ${JSON.stringify(targetApp)},
    };

    if (!window.__AGENTLICATION_PATCHES__) {
      window.__AGENTLICATION_PATCHES__ = {};
    }
    if (window.__AGENTLICATION_PATCHES__[${JSON.stringify(patchName)}]) {
      try { window.__AGENTLICATION_PATCHES__[${JSON.stringify(patchName)}].cleanup(); } catch(e) {}
    }
    window.__AGENTLICATION_PATCHES__[${JSON.stringify(patchName)}] = {
      meta: __PATCH_META__,
      cleanup: function() {},
      injectedAt: Date.now(),
    };

    ${code}

  } catch (err) {
    console.error('[Agentlication] Patch ' + ${JSON.stringify(patchName)} + ' failed:', err);
    window.dispatchEvent(new CustomEvent('agentlication:patch-error', {
      detail: { name: ${JSON.stringify(patchName)}, error: String(err), stack: err.stack }
    }));
  }
})();`;
}

/**
 * Wrap CSS code in a style injection snippet.
 */
function wrapCssCode(patchName: string, css: string): string {
  return `(function() {
  'use strict';
  var existingStyle = document.getElementById(${JSON.stringify("agentlication-css-" + patchName)});
  if (existingStyle) existingStyle.remove();
  var style = document.createElement('style');
  style.id = ${JSON.stringify("agentlication-css-" + patchName)};
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);

  if (!window.__AGENTLICATION_PATCHES__) window.__AGENTLICATION_PATCHES__ = {};
  window.__AGENTLICATION_PATCHES__[${JSON.stringify(patchName)}] = {
    meta: { name: ${JSON.stringify(patchName)} },
    cleanup: function() { style.remove(); },
    injectedAt: Date.now(),
  };
})();`;
}

/**
 * Wrap code for document-ready timing (DOMContentLoaded).
 */
function wrapForDocumentReady(code: string): string {
  return `if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { ${code} });
} else {
  ${code}
}`;
}

/**
 * Wrap code for document-idle timing (requestIdleCallback or setTimeout).
 */
function wrapForDocumentIdle(code: string): string {
  return `(window.requestIdleCallback || function(cb) { setTimeout(cb, 100); })(function() { ${code} });`;
}

// ── PatchService ─────────────────────────────────────────────────

export type PatchStatusCallback = (text: string, level: "info" | "success" | "error" | "progress") => void;

export class PatchService {
  /** Map of appSlug -> patchName -> CDP script identifier (for removal). */
  private persistentScriptIds: Map<string, Map<string, string>> = new Map();

  constructor(private cdpService: CdpService) {}

  // ── File Path Helpers ─────────────────────────────────────────

  private patchesDir(appSlug: string): string {
    return path.join(APPS_ROOT, appSlug, "patches");
  }

  private compiledDir(appSlug: string): string {
    return path.join(this.patchesDir(appSlug), COMPILED_DIR);
  }

  private patchFilePath(appSlug: string, name: string, format: PatchFormat): string {
    const ext = format === "css" ? "patch.css" : format === "tsx" ? "patch.tsx" : "patch.js";
    return path.join(this.patchesDir(appSlug), `${name}.${ext}`);
  }

  // ── CRUD Operations ───────────────────────────────────────────

  /**
   * Load all patches from an app's patches directory.
   */
  async loadPatches(appSlug: string): Promise<PatchFile[]> {
    const dir = this.patchesDir(appSlug);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f =>
      f.endsWith(".patch.js") || f.endsWith(".patch.tsx") || f.endsWith(".patch.css")
    );

    const patches: PatchFile[] = [];
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const { metadata: rawMeta, code } = parseFrontmatter(content);
        const metadata = toMetadata(rawMeta, appSlug);

        // Check for compiled code if TSX
        let compiledCode: string | undefined;
        if (metadata.format === "tsx") {
          const compiledPath = path.join(this.compiledDir(appSlug), `${metadata.name}.js`);
          if (fs.existsSync(compiledPath)) {
            const sourceTime = fs.statSync(filePath).mtimeMs;
            const compiledTime = fs.statSync(compiledPath).mtimeMs;
            if (compiledTime >= sourceTime) {
              compiledCode = fs.readFileSync(compiledPath, "utf-8");
            }
          }
        }

        const status: PatchStatus = metadata.enabled ? "active" : "disabled";

        patches.push({
          metadata,
          code,
          filePath,
          compiledCode,
          status,
        });
      } catch (err) {
        console.error(`[PatchService] Failed to load patch ${file}:`, err);
      }
    }

    // Sort by priority (ascending — lower runs first)
    patches.sort((a, b) => a.metadata.priority - b.metadata.priority);

    return patches;
  }

  /**
   * Create a new patch file.
   */
  async createPatch(req: PatchCreateRequest, onStatus?: PatchStatusCallback): Promise<PatchOperationResult> {
    try {
      const { appSlug, name, description, format, code } = req;
      const priority = req.priority ?? 50;
      const injectAt = req.injectAt ?? "document-ready";
      const author = req.author ?? "companion-agent";
      const tags = req.tags ?? [];

      // Validate name
      const safeName = name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
      if (!safeName) {
        return { success: false, error: "Invalid patch name" };
      }

      // Ensure patches directory exists
      const dir = this.patchesDir(appSlug);
      fs.mkdirSync(dir, { recursive: true });

      // Check for duplicate
      const filePath = this.patchFilePath(appSlug, safeName, format);
      if (fs.existsSync(filePath)) {
        return { success: false, error: `Patch "${safeName}" already exists` };
      }

      const now = new Date().toISOString();
      const metadata: PatchMetadata = {
        name: safeName,
        description,
        version: "1.0.0",
        author,
        targetApp: appSlug,
        format,
        priority,
        enabled: true,
        injectAt,
        runOnce: false,
        dependsOn: [],
        cssInject: format === "css",
        created: now,
        modified: now,
        tags,
      };

      // Build file content
      const frontmatter = serializeFrontmatter(metadata);
      const fileContent = `${frontmatter}\n\n${code}`;
      fs.writeFileSync(filePath, fileContent, "utf-8");

      onStatus?.(`Patch "${safeName}" created`, "success");

      // Compile if TSX
      let compiledCode: string | undefined;
      if (format === "tsx") {
        const compileResult = await this.compilePatch(code, safeName, appSlug);
        if (compileResult.success) {
          compiledCode = compileResult.code;
        } else {
          onStatus?.(`Compilation failed: ${compileResult.error}`, "error");
          return {
            success: true,
            patch: {
              metadata,
              code,
              filePath,
              status: "error",
              lastError: compileResult.error,
            },
          };
        }
      }

      const patch: PatchFile = {
        metadata,
        code,
        filePath,
        compiledCode,
        status: "active",
      };

      // Auto-inject if CDP is connected
      if (this.cdpService.isConnected()) {
        try {
          await this.injectSinglePatch(patch, appSlug);
          patch.lastInjectedAt = Date.now();
          onStatus?.(`Patch "${safeName}" injected`, "success");
        } catch (err) {
          onStatus?.(`Injection failed: ${String(err)}`, "error");
          patch.status = "error";
          patch.lastError = String(err);
        }
      }

      // Git backup
      this.backupPatches(appSlug).catch(() => {});

      return { success: true, patch };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Update an existing patch.
   */
  async updatePatch(req: PatchUpdateRequest, onStatus?: PatchStatusCallback): Promise<PatchOperationResult> {
    try {
      const { appSlug, name } = req;

      // Find the patch file
      const patches = await this.loadPatches(appSlug);
      const existing = patches.find(p => p.metadata.name === name);
      if (!existing) {
        return { success: false, error: `Patch "${name}" not found` };
      }

      // Read current file
      const content = fs.readFileSync(existing.filePath, "utf-8");
      const { metadata: rawMeta, code: currentCode } = parseFrontmatter(content);
      const metadata = toMetadata(rawMeta, appSlug);

      // Apply updates
      if (req.code !== undefined) metadata.modified = new Date().toISOString();
      if (req.enabled !== undefined) metadata.enabled = req.enabled;
      if (req.priority !== undefined) metadata.priority = req.priority;
      if (req.description !== undefined) metadata.description = req.description;

      const newCode = req.code ?? currentCode;

      // Write back
      const frontmatter = serializeFrontmatter(metadata);
      const fileContent = `${frontmatter}\n\n${newCode}`;
      fs.writeFileSync(existing.filePath, fileContent, "utf-8");

      // Re-compile if TSX
      let compiledCode: string | undefined;
      if (metadata.format === "tsx" && req.code !== undefined) {
        const compileResult = await this.compilePatch(newCode, name, appSlug);
        if (compileResult.success) {
          compiledCode = compileResult.code;
        } else {
          onStatus?.(`Re-compilation failed: ${compileResult.error}`, "error");
        }
      } else if (metadata.format === "tsx") {
        compiledCode = existing.compiledCode;
      }

      const patch: PatchFile = {
        metadata,
        code: newCode,
        filePath: existing.filePath,
        compiledCode,
        status: metadata.enabled ? "active" : "disabled",
      };

      // Re-inject if enabled and connected
      if (metadata.enabled && this.cdpService.isConnected()) {
        try {
          // Remove old persistent script first
          await this.removePersistentScript(appSlug, name);
          await this.injectSinglePatch(patch, appSlug);
          patch.lastInjectedAt = Date.now();
          onStatus?.(`Patch "${name}" re-injected`, "success");
        } catch (err) {
          patch.status = "error";
          patch.lastError = String(err);
          onStatus?.(`Re-injection failed: ${String(err)}`, "error");
        }
      } else if (!metadata.enabled && this.cdpService.isConnected()) {
        // Disabled — run cleanup and remove persistent script
        await this.cleanupPatch(name);
        await this.removePersistentScript(appSlug, name);
        onStatus?.(`Patch "${name}" disabled`, "info");
      }

      // Git backup
      this.backupPatches(appSlug).catch(() => {});

      return { success: true, patch };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Delete a patch file.
   */
  async deletePatch(appSlug: string, name: string, onStatus?: PatchStatusCallback): Promise<PatchOperationResult> {
    try {
      const patches = await this.loadPatches(appSlug);
      const existing = patches.find(p => p.metadata.name === name);
      if (!existing) {
        return { success: false, error: `Patch "${name}" not found` };
      }

      // Cleanup if injected
      if (this.cdpService.isConnected()) {
        await this.cleanupPatch(name);
        await this.removePersistentScript(appSlug, name);
      }

      // Delete patch file
      fs.unlinkSync(existing.filePath);

      // Delete compiled cache if exists
      const compiledPath = path.join(this.compiledDir(appSlug), `${name}.js`);
      if (fs.existsSync(compiledPath)) {
        fs.unlinkSync(compiledPath);
      }
      const metaPath = path.join(this.compiledDir(appSlug), `${name}.js.meta`);
      if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath);
      }

      onStatus?.(`Patch "${name}" deleted`, "success");

      // Git backup
      this.backupPatches(appSlug).catch(() => {});

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Enable a patch.
   */
  async enablePatch(appSlug: string, name: string, onStatus?: PatchStatusCallback): Promise<PatchOperationResult> {
    return this.updatePatch({ appSlug, name, enabled: true }, onStatus);
  }

  /**
   * Disable a patch.
   */
  async disablePatch(appSlug: string, name: string, onStatus?: PatchStatusCallback): Promise<PatchOperationResult> {
    return this.updatePatch({ appSlug, name, enabled: false }, onStatus);
  }

  /**
   * Get a single patch by name.
   */
  async getPatch(appSlug: string, name: string): Promise<PatchFile | null> {
    const patches = await this.loadPatches(appSlug);
    return patches.find(p => p.metadata.name === name) ?? null;
  }

  // ── Compilation ───────────────────────────────────────────────

  /**
   * Compile a TSX patch to plain JS using esbuild.
   */
  async compilePatch(source: string, patchName: string, appSlug: string): Promise<{ success: boolean; code?: string; error?: string }> {
    try {
      const result = await esbuild.transform(source, {
        loader: "tsx",
        jsx: "transform",
        jsxFactory: "React.createElement",
        jsxFragment: "React.Fragment",
        target: "es2020",
        format: "iife",
        sourcemap: false,
        sourcefile: `${patchName}.patch.tsx`,
        minify: false,
        define: {
          "process.env.NODE_ENV": '"production"',
        },
      });

      // Cache the compiled output
      const compiledDir = this.compiledDir(appSlug);
      fs.mkdirSync(compiledDir, { recursive: true });
      const compiledPath = path.join(compiledDir, `${patchName}.js`);
      fs.writeFileSync(compiledPath, result.code, "utf-8");

      // Write meta
      const metaPath = path.join(compiledDir, `${patchName}.js.meta`);
      fs.writeFileSync(metaPath, JSON.stringify({
        sourceHash: Buffer.from(source).toString("base64").slice(0, 32),
        compiledAt: new Date().toISOString(),
        esbuildVersion: esbuild.version,
      }), "utf-8");

      return { success: true, code: result.code };
    } catch (err) {
      const error = err as esbuild.TransformFailure;
      const message = error.errors?.map((e: esbuild.Message) =>
        `${e.text} (line ${e.location?.line})`
      ).join("\n") || String(err);
      return { success: false, error: message };
    }
  }

  // ── Injection ─────────────────────────────────────────────────

  /**
   * Inject all enabled patches for an app.
   */
  async injectPatches(appSlug: string, onStatus?: PatchStatusCallback): Promise<void> {
    if (!this.cdpService.isConnected()) {
      onStatus?.("Cannot inject: CDP not connected", "error");
      return;
    }

    const patches = await this.loadPatches(appSlug);
    const enabled = patches.filter(p => p.metadata.enabled);

    if (enabled.length === 0) {
      onStatus?.("No enabled patches to inject", "info");
      return;
    }

    // Resolve dependency order (topological sort)
    const ordered = this.resolveDependencies(enabled);

    onStatus?.(`Injecting ${ordered.length} patch(es)...`, "progress");

    // Set up error monitoring first
    await this.setupErrorMonitoring();

    for (const patch of ordered) {
      try {
        await this.injectSinglePatch(patch, appSlug);
        onStatus?.(`Injected: ${patch.metadata.name}`, "success");
      } catch (err) {
        onStatus?.(`Failed to inject ${patch.metadata.name}: ${String(err)}`, "error");
      }
    }

    onStatus?.(`${ordered.length} patch(es) injected`, "success");
  }

  /**
   * Inject a single patch via CDP.
   */
  async injectSinglePatch(patch: PatchFile, appSlug: string): Promise<void> {
    if (!this.cdpService.isConnected()) {
      throw new Error("CDP not connected");
    }

    let codeToInject: string;

    if (patch.metadata.cssInject || patch.metadata.format === "css") {
      // CSS patch
      codeToInject = wrapCssCode(patch.metadata.name, patch.code);
    } else if (patch.metadata.format === "tsx") {
      // TSX patch — use compiled code
      let compiled = patch.compiledCode;
      if (!compiled) {
        const result = await this.compilePatch(patch.code, patch.metadata.name, appSlug);
        if (!result.success) {
          throw new Error(`Compilation failed: ${result.error}`);
        }
        compiled = result.code!;
      }
      // Prepend React shim for TSX patches
      const reactShim = this.getReactShim();
      codeToInject = wrapPatchCode(
        patch.metadata.name,
        patch.metadata.version,
        patch.metadata.targetApp,
        reactShim + "\n" + compiled
      );
    } else {
      // Plain JS patch
      codeToInject = wrapPatchCode(
        patch.metadata.name,
        patch.metadata.version,
        patch.metadata.targetApp,
        patch.code
      );
    }

    // Apply timing wrapper based on inject-at
    let wrappedCode = codeToInject;
    if (patch.metadata.injectAt === "document-ready") {
      wrappedCode = wrapForDocumentReady(codeToInject);
    } else if (patch.metadata.injectAt === "document-idle") {
      wrappedCode = wrapForDocumentIdle(codeToInject);
    }
    // document-start: no additional wrapping needed

    // Decide injection strategy based on inject-at and run-once
    const { injectAt, runOnce } = patch.metadata;

    if (runOnce) {
      // Run once: just Runtime.evaluate
      await this.cdpService.evaluate(wrappedCode);
    } else {
      // Persistent: register via addScriptToEvaluateOnNewDocument for future navigations
      await this.setupPersistentScript(appSlug, patch.metadata.name, wrappedCode);

      // Also inject immediately for the current page
      if (injectAt !== "document-start") {
        // For document-start patches, the persistent script handles it
        // For document-ready and document-idle, we also evaluate immediately
        await this.cdpService.evaluate(codeToInject);
      }
    }
  }

  /**
   * Set up Page.addScriptToEvaluateOnNewDocument for persistent injection.
   */
  async setupPersistence(appSlug: string): Promise<void> {
    if (!this.cdpService.isConnected()) return;

    const patches = await this.loadPatches(appSlug);
    const enabled = patches.filter(p => p.metadata.enabled);

    for (const patch of enabled) {
      try {
        await this.injectSinglePatch(patch, appSlug);
      } catch (err) {
        console.error(`[PatchService] Failed to set up persistence for ${patch.metadata.name}:`, err);
      }
    }
  }

  // ── CDP Helpers ───────────────────────────────────────────────

  /**
   * Register a script via Page.addScriptToEvaluateOnNewDocument.
   */
  private async setupPersistentScript(appSlug: string, patchName: string, code: string): Promise<void> {
    if (!this.cdpService.isConnected()) return;

    // Remove any existing persistent script for this patch
    await this.removePersistentScript(appSlug, patchName);

    try {
      const identifier = await this.addScriptToEvaluateOnNewDocument(code);
      if (identifier) {
        if (!this.persistentScriptIds.has(appSlug)) {
          this.persistentScriptIds.set(appSlug, new Map());
        }
        this.persistentScriptIds.get(appSlug)!.set(patchName, identifier);
      }
    } catch (err) {
      console.error(`[PatchService] Failed to register persistent script for ${patchName}:`, err);
    }
  }

  /**
   * Remove a persistent script registered via addScriptToEvaluateOnNewDocument.
   */
  private async removePersistentScript(appSlug: string, patchName: string): Promise<void> {
    const appScripts = this.persistentScriptIds.get(appSlug);
    if (!appScripts) return;

    const identifier = appScripts.get(patchName);
    if (!identifier) return;

    try {
      await this.removeScriptToEvaluateOnNewDocument(identifier);
      appScripts.delete(patchName);
    } catch {
      // Best effort — script may already be removed
    }
  }

  /**
   * Run cleanup function for a patch in the target app.
   */
  private async cleanupPatch(patchName: string): Promise<void> {
    if (!this.cdpService.isConnected()) return;

    try {
      await this.cdpService.evaluate(`
        (function() {
          if (window.__AGENTLICATION_PATCHES__ && window.__AGENTLICATION_PATCHES__[${JSON.stringify(patchName)}]) {
            try { window.__AGENTLICATION_PATCHES__[${JSON.stringify(patchName)}].cleanup(); } catch(e) {}
            delete window.__AGENTLICATION_PATCHES__[${JSON.stringify(patchName)}];
          }
        })()
      `);
    } catch {
      // Best effort
    }
  }

  /**
   * Set up error monitoring for patch errors.
   */
  private async setupErrorMonitoring(): Promise<void> {
    if (!this.cdpService.isConnected()) return;

    try {
      await this.cdpService.evaluate(`
        if (!window.__AGENTLICATION_ERROR_LISTENER__) {
          window.__AGENTLICATION_ERROR_LISTENER__ = true;
          window.addEventListener('agentlication:patch-error', function(e) {
            console.error('[AGENTLICATION_PATCH_ERROR]', JSON.stringify(e.detail));
          });
        }
      `);
    } catch {
      // Non-critical
    }
  }

  /**
   * Get the React shim code for TSX patches.
   * This makes React available from the target app or provides a basic fallback.
   */
  private getReactShim(): string {
    return `
      // React shim for TSX patches
      if (typeof React === 'undefined') {
        if (window.__AGENTLICATION_REACT__ && window.__AGENTLICATION_REACT__.React) {
          var React = window.__AGENTLICATION_REACT__.React;
          var ReactDOM = window.__AGENTLICATION_REACT__.ReactDOM;
        } else if (window.React) {
          var React = window.React;
          var ReactDOM = window.ReactDOM;
        }
      }
    `;
  }

  /**
   * Get the React detection script to inject early.
   */
  getReactDetectionScript(): string {
    return `(function() {
  if (window.__AGENTLICATION_REACT__) return;
  window.__AGENTLICATION_REACT__ = { React: null, ReactDOM: null, detected: false };

  // Check for React on common global locations
  if (window.React && window.ReactDOM) {
    window.__AGENTLICATION_REACT__ = {
      React: window.React,
      ReactDOM: window.ReactDOM,
      detected: true,
      source: 'global',
    };
    return;
  }

  // Check webpack module cache for React
  try {
    if (window.webpackChunk || window.__webpack_modules__) {
      var moduleCache = window.__webpack_modules__ || {};
      for (var id in moduleCache) {
        var mod = moduleCache[id];
        if (mod && mod.exports) {
          if (mod.exports.createElement && mod.exports.useState) {
            window.__AGENTLICATION_REACT__.React = mod.exports;
          }
          if (mod.exports.createRoot || mod.exports.render) {
            window.__AGENTLICATION_REACT__.ReactDOM = mod.exports;
          }
        }
      }
      if (window.__AGENTLICATION_REACT__.React) {
        window.__AGENTLICATION_REACT__.detected = true;
        window.__AGENTLICATION_REACT__.source = 'webpack';
      }
    }
  } catch(e) {}
})();`;
  }

  // ── Dependency Resolution ─────────────────────────────────────

  /**
   * Resolve patch dependencies using topological sort.
   * Falls back to priority order if no dependencies.
   */
  private resolveDependencies(patches: PatchFile[]): PatchFile[] {
    const byName = new Map<string, PatchFile>();
    for (const p of patches) {
      byName.set(p.metadata.name, p);
    }

    // Check if any patches have dependencies
    const hasDeps = patches.some(p => p.metadata.dependsOn.length > 0);
    if (!hasDeps) return patches; // Already sorted by priority

    // Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const p of patches) {
      inDegree.set(p.metadata.name, 0);
      adj.set(p.metadata.name, []);
    }

    for (const p of patches) {
      for (const dep of p.metadata.dependsOn) {
        if (byName.has(dep)) {
          adj.get(dep)!.push(p.metadata.name);
          inDegree.set(p.metadata.name, (inDegree.get(p.metadata.name) || 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    // Sort queue by priority within same dependency level
    queue.sort((a, b) => (byName.get(a)!.metadata.priority - byName.get(b)!.metadata.priority));

    const result: PatchFile[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      result.push(byName.get(name)!);

      for (const next of adj.get(name) || []) {
        const newDegree = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, newDegree);
        if (newDegree === 0) {
          queue.push(next);
          queue.sort((a, b) => (byName.get(a)!.metadata.priority - byName.get(b)!.metadata.priority));
        }
      }
    }

    // Add any patches not reached (circular deps — add them anyway)
    for (const p of patches) {
      if (!result.includes(p)) {
        result.push(p);
      }
    }

    return result;
  }

  // ── CDP Client Access (via CdpService internals) ──────────────

  /**
   * Add a script to evaluate on every new document.
   * Returns the identifier for later removal.
   */
  private async addScriptToEvaluateOnNewDocument(source: string): Promise<string | null> {
    try {
      return await this.cdpService.addScriptToEvaluateOnNewDocument(source);
    } catch (err) {
      console.error("[PatchService] addScriptToEvaluateOnNewDocument failed:", err);
      return null;
    }
  }

  /**
   * Remove a previously registered script.
   */
  private async removeScriptToEvaluateOnNewDocument(identifier: string): Promise<void> {
    try {
      await this.cdpService.removeScriptToEvaluateOnNewDocument(identifier);
    } catch {
      // Best effort — script may already be removed
    }
  }

  // ── Git Backup ────────────────────────────────────────────────

  /**
   * Simple auto-commit on patch changes.
   * Initializes a git repo at ~/.agentlication/patches-backup/ if needed,
   * copies patches, and commits.
   */
  private backupDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async backupPatches(appSlug: string): Promise<void> {
    // Debounce: wait 5 seconds after the last change
    if (this.backupDebounceTimer) {
      clearTimeout(this.backupDebounceTimer);
    }

    this.backupDebounceTimer = setTimeout(async () => {
      try {
        await this.performBackup(appSlug);
      } catch (err) {
        console.error("[PatchService] Backup failed:", err);
      }
    }, 5000);
  }

  private async performBackup(appSlug: string): Promise<void> {
    // Initialize backup repo if needed
    fs.mkdirSync(BACKUP_ROOT, { recursive: true });

    const gitDir = path.join(BACKUP_ROOT, ".git");
    if (!fs.existsSync(gitDir)) {
      try {
        execFileSync("git", ["init"], { cwd: BACKUP_ROOT, stdio: "ignore" });
        execFileSync("git", ["config", "user.name", "Agentlication"], { cwd: BACKUP_ROOT, stdio: "ignore" });
        execFileSync("git", ["config", "user.email", "patches@agentlication.ai"], { cwd: BACKUP_ROOT, stdio: "ignore" });
      } catch (err) {
        console.error("[PatchService] Git init failed:", err);
        return;
      }
    }

    // Copy patches to backup directory
    const srcDir = this.patchesDir(appSlug);
    if (!fs.existsSync(srcDir)) return;

    const destDir = path.join(BACKUP_ROOT, appSlug);
    fs.mkdirSync(destDir, { recursive: true });

    // Copy all patch files (not compiled cache)
    const files = fs.readdirSync(srcDir).filter(f =>
      f.endsWith(".patch.js") || f.endsWith(".patch.tsx") || f.endsWith(".patch.css")
    );

    for (const file of files) {
      const src = path.join(srcDir, file);
      const dest = path.join(destDir, file);
      fs.copyFileSync(src, dest);
    }

    // Remove backup files that no longer exist in source
    if (fs.existsSync(destDir)) {
      const backupFiles = fs.readdirSync(destDir).filter(f =>
        f.endsWith(".patch.js") || f.endsWith(".patch.tsx") || f.endsWith(".patch.css")
      );
      for (const file of backupFiles) {
        if (!files.includes(file)) {
          fs.unlinkSync(path.join(destDir, file));
        }
      }
    }

    // Git add and commit
    try {
      execFileSync("git", ["add", "-A"], { cwd: BACKUP_ROOT, stdio: "ignore" });

      // Check if there are changes to commit
      try {
        execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: BACKUP_ROOT, stdio: "ignore" });
        // No changes
        return;
      } catch {
        // There are staged changes — proceed with commit
      }

      execFileSync("git", [
        "commit", "-m", `Update ${appSlug} patches via Agentlication`
      ], { cwd: BACKUP_ROOT, stdio: "ignore" });
    } catch (err) {
      console.error("[PatchService] Git commit failed:", err);
    }
  }

  /**
   * List patches formatted for the agent's system prompt.
   */
  async getPatchSummaryForPrompt(appSlug: string): Promise<string> {
    const patches = await this.loadPatches(appSlug);
    if (patches.length === 0) {
      return "(No patches created yet)";
    }

    return patches.map(p => {
      const status = p.metadata.enabled ? "enabled" : "disabled";
      return `- ${p.metadata.name} (v${p.metadata.version}, ${status}, priority ${p.metadata.priority}) -- "${p.metadata.description}"`;
    }).join("\n");
  }
}
