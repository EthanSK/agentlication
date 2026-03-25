---
name: scan-electron-apps
description: Scan the system for installed Electron apps and return their metadata.
provider: any
model: small
thinking: low
trigger: on-scan
timeout: 120
---

# Scan Electron Apps

## Context

The agent runs on the user's local machine and has filesystem access. The goal is
to discover all installed Electron-based desktop apps so the user can choose which
ones to agentify.

## Instructions

1. **Find candidate apps.** Search these locations for `.app` bundles (macOS):
   - `/Applications/`
   - `~/Applications/`
   - `/System/Applications/` (unlikely but check)

   On Linux, search for `.desktop` files in `/usr/share/applications/` and
   `~/.local/share/applications/`.

2. **Detect Electron.** For each candidate app:
   - **macOS:** Check if the bundle contains `Frameworks/Electron Framework.framework`
     or if the main binary links against Electron. A quick test:
     ```bash
     ls "/Applications/<App>.app/Contents/Frameworks/Electron Framework.framework" 2>/dev/null
     ```
   - **Linux:** Check if the binary is an Electron wrapper by looking for
     `electron` or `libnode` in `ldd` output.

3. **Extract metadata** for each confirmed Electron app:
   - `name` — Display name from `Info.plist` (`CFBundleName`) or `.desktop` file
   - `bundle_id` — `CFBundleIdentifier` (macOS) or desktop file ID (Linux)
   - `version` — `CFBundleShortVersionString` or equivalent
   - `electron_version` — Parse from `Electron Framework.framework/Resources/Info.plist`
     or the app's `package.json`
   - `path` — Absolute path to the app bundle
   - `has_devtools` — Whether Chrome DevTools can be attached (check if
     `--remote-debugging-port` is accepted or if the app exposes a debug port)

4. Sort results by app name alphabetically.

## Output

```json
{
  "platform": "darwin",
  "scan_date": "2026-03-25",
  "apps": [
    {
      "name": "Visual Studio Code",
      "bundle_id": "com.microsoft.VSCode",
      "version": "1.98.0",
      "electron_version": "34.0.0",
      "path": "/Applications/Visual Studio Code.app",
      "has_devtools": true
    }
  ]
}
```

## Notes

- This prompt can take a while on systems with many apps. The 120s timeout is
  generous — if it runs long, skip apps that are slow to inspect.
- Some Electron apps ship a renamed Electron binary. The framework check is more
  reliable than binary name matching.
- Do not launch any apps during the scan. Only inspect files on disk.
