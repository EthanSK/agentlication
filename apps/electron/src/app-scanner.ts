import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, execFileSync } from "child_process";
import type { TargetApp, AppScanUpdate } from "@agentlication/contracts";

const APPLICATIONS_DIR = "/Applications";
const ICONS_DIR = "/tmp/agentlication-icons";

/**
 * Persistent on-disk icon cache.
 *
 * First-open lag root cause: on every hub load we were re-running
 * `defaults read` + `sips -z 64 ... --out ...` for every .app bundle found in
 * `/Applications` (200+ on a typical dev machine). Each sub-process is
 * 50–300ms, so the renderer saw 5–15s of "Scanning for apps..." blank. The
 * scan is also fully synchronous, so it blocked the Electron main process the
 * entire time.
 *
 * Fix: cache PNG bytes at `~/.agentlication/icon-cache/` keyed by
 * `hash(appPath) + mtime(appBundle)`. A cache hit is ~1ms (one readFile); a
 * miss still runs sips once and writes the result so subsequent launches are
 * instant.
 */
const ICON_CACHE_DIR = path.join(os.homedir(), ".agentlication", "icon-cache");

/**
 * Subdirectory paths (relative to each project) where Electron build output
 * commonly lives. Each is checked for .app bundles.
 */
const DEV_BUILD_SUBDIRS = [
  "release/mac-arm64",
  "release/mac",
  "dist/mac-arm64",
  "dist/mac",
  "out",
];

const ELECTRON_INDICATORS = [
  "Electron Framework.framework",
  "Electron",
  "electron.asar",
];

export interface ScanAppsOptions {
  includeHiddenApps?: boolean;
}

export interface StreamingScanOptions extends ScanAppsOptions {
  /**
   * Callback invoked for each per-app update (icon, Electron flag) after the
   * initial bare list is returned. `done: true` is emitted once exactly when
   * all apps have been enriched.
   */
  onUpdate: (update: AppScanUpdate) => void;
}

// Ensure temp + cache dirs exist
try {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
} catch {
  // ignore
}
try {
  fs.mkdirSync(ICON_CACHE_DIR, { recursive: true });
} catch {
  // ignore
}

/** Compute a stable cache key for an app bundle (path + mtime). */
function iconCacheKey(appPath: string): string | null {
  try {
    const stat = fs.statSync(appPath);
    const hash = crypto
      .createHash("sha1")
      .update(`${appPath}:${stat.mtimeMs}`)
      .digest("hex");
    return hash;
  } catch {
    return null;
  }
}

function readIconFromCache(appPath: string): string | undefined {
  const key = iconCacheKey(appPath);
  if (!key) return undefined;
  const cachePath = path.join(ICON_CACHE_DIR, `${key}.png`);
  try {
    if (!fs.existsSync(cachePath)) return undefined;
    const pngBuffer = fs.readFileSync(cachePath);
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function writeIconToCache(appPath: string, pngBuffer: Buffer): void {
  const key = iconCacheKey(appPath);
  if (!key) return;
  const cachePath = path.join(ICON_CACHE_DIR, `${key}.png`);
  try {
    fs.writeFileSync(cachePath, pngBuffer);
  } catch {
    // cache writes are best-effort
  }
}

/**
 * Extract the app icon as a base64 data URL.
 * Prefers Info.plist-defined icons, then falls back to best candidate in Resources.
 */
function extractAppIcon(appPath: string, appName: string): string | undefined {
  try {
    // Fast path: disk cache hit avoids spawning `defaults` + `sips`.
    const cached = readIconFromCache(appPath);
    if (cached) return cached;

    const iconCandidates = collectIconCandidates(appPath, appName);
    for (const iconPath of iconCandidates) {
      const dataUrl = convertIconToDataUrl(iconPath, appName, appPath);
      if (dataUrl) return dataUrl;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function collectIconCandidates(appPath: string, appName: string): string[] {
  const resourcesDir = path.join(appPath, "Contents", "Resources");
  if (!fs.existsSync(resourcesDir)) return [];

  const plistPath = path.join(appPath, "Contents", "Info");
  const candidates: string[] = [];

  const bundleIconFile = readPlistKey(plistPath, "CFBundleIconFile");
  const bundleIconName = readPlistKey(plistPath, "CFBundleIconName");

  for (const iconName of [bundleIconFile, bundleIconName]) {
    if (!iconName) continue;
    addNamedIconCandidates(candidates, resourcesDir, iconName);
  }

  // Fallback: look through Resources for likely icon files.
  try {
    const appToken = normalizeToken(appName);
    const fallbackIcons = fs
      .readdirSync(resourcesDir)
      .filter((entry) => entry.toLowerCase().endsWith(".icns") || entry.toLowerCase().endsWith(".png"))
      .filter((entry) => !entry.startsWith("."))
      .sort((a, b) => scoreIconFilename(b, appToken) - scoreIconFilename(a, appToken));

    for (const entry of fallbackIcons) {
      candidates.push(path.join(resourcesDir, entry));
    }
  } catch {
    // ignore fallback failures
  }

  // Keep only existing files and de-dupe in insertion order.
  const seen = new Set<string>();
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (fs.existsSync(candidate)) {
      existing.push(candidate);
    }
  }

  return existing;
}

function readPlistKey(plistPath: string, key: string): string | undefined {
  try {
    const raw = execFileSync("defaults", ["read", plistPath, key], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!raw) return undefined;

    // defaults can return quoted values or multi-line formats; use first signal line.
    const firstLine = raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && line !== "(" && line !== ")" && line !== "{") || "";

    const cleaned = firstLine.replace(/[",;]/g, "").trim();
    return cleaned || undefined;
  } catch {
    return undefined;
  }
}

function addNamedIconCandidates(candidates: string[], resourcesDir: string, iconName: string) {
  const trimmed = iconName.trim();
  if (!trimmed) return;

  const ext = path.extname(trimmed).toLowerCase();
  const base = ext ? trimmed.slice(0, -ext.length) : trimmed;

  const possibleNames = new Set<string>([
    trimmed,
    `${base}.icns`,
    `${base}.png`,
    `${base}.Iconset`,
  ]);

  for (const name of possibleNames) {
    candidates.push(path.join(resourcesDir, name));
  }
}

function scoreIconFilename(fileName: string, appToken: string): number {
  const lower = fileName.toLowerCase();
  const normalized = normalizeToken(fileName.replace(/\.(icns|png)$/i, ""));

  let score = 0;

  if (normalized === appToken) score += 50;
  if (appToken && normalized.includes(appToken)) score += 30;
  if (lower.includes("icon")) score += 20;
  if (lower.endsWith(".icns")) score += 10;

  return score;
}

function convertIconToDataUrl(
  iconPath: string,
  appName: string,
  appPath: string
): string | undefined {
  try {
    const safeName = appName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sourceName = path.basename(iconPath).replace(/[^a-zA-Z0-9._-]/g, "_");
    const pngPath = path.join(ICONS_DIR, `${safeName}-${sourceName}.png`);

    if (iconPath.toLowerCase().endsWith(".png")) {
      // Reuse PNG directly to avoid conversion failures where possible.
      const pngBuffer = fs.readFileSync(iconPath);
      writeIconToCache(appPath, pngBuffer);
      return `data:image/png;base64,${pngBuffer.toString("base64")}`;
    }

    execFileSync(
      "sips",
      ["-s", "format", "png", "-z", "64", "64", iconPath, "--out", pngPath],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    if (!fs.existsSync(pngPath)) return undefined;

    const pngBuffer = fs.readFileSync(pngPath);
    writeIconToCache(appPath, pngBuffer);
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldIncludeAppBundle(entry: string, includeHiddenApps: boolean): boolean {
  if (!entry.endsWith(".app")) return false;

  const appName = entry.slice(0, -4);
  if (!includeHiddenApps && appName.startsWith(".")) {
    return false;
  }

  return true;
}

/**
 * Describes a discovered bundle before the expensive per-app metadata work
 * (Electron detection, icon extraction) runs.
 */
interface BundleRef {
  name: string;
  path: string;
  /** True if this bundle was discovered under a dev build dir (Electron-only source). */
  isDevBuild: boolean;
}

/** Fast phase: list `.app` bundles without any sips/defaults/Frameworks probing. */
function discoverBundles(includeHiddenApps: boolean): BundleRef[] {
  const seen = new Map<string, BundleRef>(); // key = app name (for de-dupe)

  // 1) /Applications — readdir only, no stat calls
  try {
    for (const entry of fs.readdirSync(APPLICATIONS_DIR)) {
      if (!shouldIncludeAppBundle(entry, includeHiddenApps)) continue;
      const name = entry.slice(0, -4);
      if (seen.has(name)) continue;
      seen.set(name, {
        name,
        path: path.join(APPLICATIONS_DIR, entry),
        isDevBuild: false,
      });
    }
  } catch (err) {
    console.error("Failed to scan /Applications:", err);
  }

  // 2) Dev build outputs under ~/Projects
  try {
    const projectsDir = path.join(os.homedir(), "Projects");
    if (fs.existsSync(projectsDir)) {
      for (const project of fs.readdirSync(projectsDir)) {
        const projectPath = path.join(projectsDir, project);
        for (const subdir of DEV_BUILD_SUBDIRS) {
          const buildDir = path.join(projectPath, subdir);
          try {
            if (!fs.existsSync(buildDir)) continue;
            for (const entry of fs.readdirSync(buildDir)) {
              if (!shouldIncludeAppBundle(entry, includeHiddenApps)) continue;
              const name = entry.slice(0, -4);
              if (seen.has(name)) continue; // prefer /Applications version
              seen.set(name, {
                name,
                path: path.join(buildDir, entry),
                isDevBuild: true,
              });
            }
          } catch {
            // skip inaccessible dirs
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to scan dev build directories:", err);
  }

  return Array.from(seen.values());
}

/** Sort: Electron apps first, then alphabetical within each group. */
function sortApps(apps: TargetApp[]): TargetApp[] {
  return apps.sort((a, b) => {
    if (a.isElectron !== b.isElectron) return a.isElectron ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fast initial scan: returns every `.app` bundle with only the cheap fields
 * (name, path, isElectron) populated. Icons come later via the streaming
 * scan. This lets the renderer paint a usable hub in <100ms even on a cold
 * icon cache.
 *
 * `isElectron` detection is kept here because it only requires one
 * `readdirSync` on `Contents/Frameworks/` (very fast, no child processes) and
 * the renderer sorts/filters by it.
 */
export function scanElectronApps(options: ScanAppsOptions = {}): TargetApp[] {
  const includeHiddenApps = options.includeHiddenApps ?? false;
  console.time("[scan] bare-list");
  const bundles = discoverBundles(includeHiddenApps);
  console.timeEnd("[scan] bare-list");

  console.time("[scan] electron-check");
  const apps: TargetApp[] = [];
  for (const bundle of bundles) {
    const isElectron = bundle.isDevBuild ? true : checkIfElectron(bundle.path);
    // In dev-build discovery we only keep Electron apps (matches previous behaviour).
    if (bundle.isDevBuild && !isElectron) continue;

    apps.push({
      name: bundle.name,
      path: bundle.path,
      // Opportunistically populate from disk cache — zero-cost if it's a miss.
      icon: readIconFromCache(bundle.path),
      isElectron,
    });
  }
  console.timeEnd("[scan] electron-check");

  return sortApps(apps);
}

/**
 * Streaming scan: returns the bare app list synchronously, then fires
 * `onUpdate` for every app that needs icon extraction (or Electron
 * re-detection) as the work completes.
 *
 * The initial list is returned immediately; icon enrichment runs on the Node
 * event loop in small async batches so it doesn't freeze the main process.
 * Apps whose icons are already in the disk cache ship with the first
 * response — no update event needed.
 */
export function scanElectronAppsStreaming(options: StreamingScanOptions): TargetApp[] {
  const { onUpdate, ...scanOptions } = options;
  const apps = scanElectronApps(scanOptions);

  // Figure out which apps still need icon work (cache miss).
  const pending = apps.filter((app) => !app.icon);
  if (pending.length === 0) {
    // Everything came from cache — still signal done so the renderer can
    // clear any skeleton pulse timers.
    queueMicrotask(() => onUpdate({ path: "", done: true }));
    return apps;
  }

  console.log(`[scan] ${apps.length} apps total, ${pending.length} need icon extraction`);

  // Process icons in small batches with setImmediate gaps so the main process
  // stays responsive (IPC replies, UI events) during the enrichment phase.
  const BATCH_SIZE = 6;
  let index = 0;
  const scanStart = Date.now();

  function processBatch() {
    const batch = pending.slice(index, index + BATCH_SIZE);
    index += BATCH_SIZE;

    for (const app of batch) {
      const icon = extractAppIcon(app.path, app.name);
      if (icon) {
        onUpdate({ path: app.path, icon });
      }
    }

    if (index < pending.length) {
      setImmediate(processBatch);
    } else {
      const elapsed = Date.now() - scanStart;
      console.log(`[scan] icon enrichment done in ${elapsed}ms (${pending.length} apps)`);
      onUpdate({ path: "", done: true });
    }
  }

  setImmediate(processBatch);
  return apps;
}

function checkIfElectron(appPath: string): boolean {
  const frameworksPath = path.join(appPath, "Contents", "Frameworks");

  try {
    if (!fs.existsSync(frameworksPath)) return false;
    const frameworks = fs.readdirSync(frameworksPath);
    return ELECTRON_INDICATORS.some((indicator) =>
      frameworks.some((f) => f.includes(indicator))
    );
  } catch {
    return false;
  }
}

/**
 * Relaunch a target app with --remote-debugging-port flag for CDP access.
 */
export function launchAppWithDebugging(
  appPath: string,
  port: number = 9222
): Promise<{ success: boolean; port: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      // Find the actual executable inside the .app bundle
      const appName = path.basename(appPath, ".app");
      const executablePath = path.join(
        appPath,
        "Contents",
        "MacOS",
        appName
      );

      if (!fs.existsSync(executablePath)) {
        // Try to find any executable in MacOS dir
        const macosDir = path.join(appPath, "Contents", "MacOS");
        const files = fs.readdirSync(macosDir);
        if (files.length === 0) {
          resolve({
            success: false,
            port,
            error: "No executable found in app bundle",
          });
          return;
        }
        const altExec = path.join(macosDir, files[0]);
        launchExecutable(altExec, port, resolve);
        return;
      }

      launchExecutable(executablePath, port, resolve);
    } catch (err) {
      resolve({ success: false, port, error: String(err) });
    }
  });
}

function launchExecutable(
  executablePath: string,
  port: number,
  resolve: (val: { success: boolean; port: number; error?: string }) => void
) {
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  // Give it a moment to start
  setTimeout(() => {
    resolve({ success: true, port });
  }, 2000);

  child.on("error", (err) => {
    resolve({ success: false, port, error: String(err) });
  });
}
