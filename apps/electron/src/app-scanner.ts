import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, execFileSync } from "child_process";
import type { TargetApp } from "@agentlication/contracts";

const APPLICATIONS_DIR = "/Applications";
const ICONS_DIR = "/tmp/agentlication-icons";

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

// Ensure temp icon directory exists
try {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
} catch {
  // ignore
}

/**
 * Extract the app icon as a base64 data URL.
 * Prefers Info.plist-defined icons, then falls back to best candidate in Resources.
 */
function extractAppIcon(appPath: string, appName: string): string | undefined {
  try {
    const iconCandidates = collectIconCandidates(appPath, appName);
    for (const iconPath of iconCandidates) {
      const dataUrl = convertIconToDataUrl(iconPath, appName);
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

function convertIconToDataUrl(iconPath: string, appName: string): string | undefined {
  try {
    const safeName = appName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sourceName = path.basename(iconPath).replace(/[^a-zA-Z0-9._-]/g, "_");
    const pngPath = path.join(ICONS_DIR, `${safeName}-${sourceName}.png`);

    if (iconPath.toLowerCase().endsWith(".png")) {
      // Reuse PNG directly to avoid conversion failures where possible.
      const pngBuffer = fs.readFileSync(iconPath);
      return `data:image/png;base64,${pngBuffer.toString("base64")}`;
    }

    execFileSync(
      "sips",
      ["-s", "format", "png", "-z", "64", "64", iconPath, "--out", pngPath],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    if (!fs.existsSync(pngPath)) return undefined;

    const pngBuffer = fs.readFileSync(pngPath);
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
 * Scan /Applications and common Electron build output directories for ALL apps.
 * Returns both Electron and non-Electron apps, with `isElectron` flag set accordingly.
 * De-duplicates by app name, preferring /Applications/ version when both exist.
 */
export function scanElectronApps(options: ScanAppsOptions = {}): TargetApp[] {
  const includeHiddenApps = options.includeHiddenApps ?? false;

  /** Map from app name -> TargetApp (used for de-duplication) */
  const appMap = new Map<string, TargetApp>();

  // 1. Scan /Applications — include ALL .app bundles
  try {
    const entries = fs.readdirSync(APPLICATIONS_DIR);

    for (const entry of entries) {
      if (!shouldIncludeAppBundle(entry, includeHiddenApps)) continue;

      const appPath = path.join(APPLICATIONS_DIR, entry);
      const appName = entry.replace(".app", "");
      const isElectron = checkIfElectron(appPath);
      const icon = extractAppIcon(appPath, appName);

      appMap.set(appName, {
        name: appName,
        path: appPath,
        icon,
        isElectron,
      });
    }
  } catch (err) {
    console.error("Failed to scan /Applications:", err);
  }

  // 2. Scan dev build output directories under ~/Projects (Electron apps only)
  try {
    const projectsDir = path.join(os.homedir(), "Projects");
    if (fs.existsSync(projectsDir)) {
      const projects = fs.readdirSync(projectsDir);
      for (const project of projects) {
        const projectPath = path.join(projectsDir, project);
        try {
          if (!fs.statSync(projectPath).isDirectory()) continue;
        } catch {
          continue;
        }

        for (const subdir of DEV_BUILD_SUBDIRS) {
          const buildDir = path.join(projectPath, subdir);
          try {
            if (!fs.existsSync(buildDir)) continue;
            const entries = fs.readdirSync(buildDir);
            for (const entry of entries) {
              if (!shouldIncludeAppBundle(entry, includeHiddenApps)) continue;
              const appPath = path.join(buildDir, entry);
              const appName = entry.replace(".app", "");
              // Only add if not already found in /Applications (prefer system installs)
              if (!appMap.has(appName) && checkIfElectron(appPath)) {
                const icon = extractAppIcon(appPath, appName);
                appMap.set(appName, {
                  name: appName,
                  path: appPath,
                  icon,
                  isElectron: true,
                });
              }
            }
          } catch {
            // Skip inaccessible directories
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to scan dev build directories:", err);
  }

  // Sort: Electron apps first, then alphabetical within each group
  return Array.from(appMap.values()).sort((a, b) => {
    if (a.isElectron !== b.isElectron) return a.isElectron ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
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
