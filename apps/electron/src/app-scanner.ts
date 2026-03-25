import * as fs from "fs";
import * as path from "path";
import { spawn, execFileSync } from "child_process";
import type { TargetApp } from "@agentlication/contracts";

const APPLICATIONS_DIR = "/Applications";
const ICONS_DIR = "/tmp/agentlication-icons";
const ELECTRON_INDICATORS = [
  "Electron Framework.framework",
  "Electron",
  "electron.asar",
];

// Ensure temp icon directory exists
try {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
} catch {
  // ignore
}

/**
 * Extract the app icon as a base64 data URL.
 * Uses Info.plist to find the icon file, then sips to convert .icns to PNG.
 */
function extractAppIcon(appPath: string, appName: string): string | undefined {
  try {
    // Read CFBundleIconFile from Info.plist
    const plistPath = path.join(appPath, "Contents", "Info");
    const iconFileName = execFileSync(
      "defaults",
      ["read", plistPath, "CFBundleIconFile"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (!iconFileName) return undefined;

    // Add .icns extension if not present
    const icnsName = iconFileName.endsWith(".icns")
      ? iconFileName
      : `${iconFileName}.icns`;
    const icnsPath = path.join(appPath, "Contents", "Resources", icnsName);

    if (!fs.existsSync(icnsPath)) return undefined;

    // Convert to PNG using sips
    const safeName = appName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const pngPath = path.join(ICONS_DIR, `${safeName}.png`);

    execFileSync(
      "sips",
      ["-s", "format", "png", "-z", "64", "64", icnsPath, "--out", pngPath],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    if (!fs.existsSync(pngPath)) return undefined;

    const pngBuffer = fs.readFileSync(pngPath);
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * Scan /Applications for Electron apps by checking for Electron framework files.
 */
export function scanElectronApps(): TargetApp[] {
  const apps: TargetApp[] = [];

  try {
    const entries = fs.readdirSync(APPLICATIONS_DIR);

    for (const entry of entries) {
      if (!entry.endsWith(".app")) continue;

      const appPath = path.join(APPLICATIONS_DIR, entry);
      const appName = entry.replace(".app", "");
      const isElectron = checkIfElectron(appPath);

      if (isElectron) {
        const icon = extractAppIcon(appPath, appName);
        apps.push({
          name: appName,
          path: appPath,
          icon,
          isElectron: true,
        });
      }
    }
  } catch (err) {
    console.error("Failed to scan applications:", err);
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
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
