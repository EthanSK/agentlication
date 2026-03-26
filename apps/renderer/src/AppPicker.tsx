import React, { useEffect, useState } from "react";
import type { TargetApp } from "@agentlication/contracts";

interface Props {
  onAppSelected: (app: TargetApp) => void;
  onAppsLoaded?: (apps: TargetApp[]) => void;
}

export default function AppPicker({
  onAppSelected,
  onAppsLoaded,
}: Props) {
  const [apps, setApps] = useState<TargetApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [customPath, setCustomPath] = useState("");
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentlicatedApps, setAgentlicatedApps] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadApps();
  }, []);

  const loadApps = async () => {
    setLoading(true);
    try {
      let scanned: TargetApp[];
      if (window.agentlication) {
        scanned = await window.agentlication.scanApps();
      } else {
        // Dev mode without Electron — show mock data
        scanned = [
          { name: "VS Code", path: "/Applications/Visual Studio Code.app", isElectron: true },
          { name: "Slack", path: "/Applications/Slack.app", isElectron: true },
          { name: "Notion", path: "/Applications/Notion.app", isElectron: true },
        ];
      }
      setApps(scanned);
      onAppsLoaded?.(scanned);

      // Check which apps are already agentlicated
      if (window.agentlication) {
        const tracked = new Set<string>();
        await Promise.all(
          scanned.map(async (app) => {
            const isTracked = await window.agentlication.isAppAgentlicated(app.name);
            if (isTracked) tracked.add(app.name);
          })
        );
        setAgentlicatedApps(tracked);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAgentlicate = async (app: TargetApp) => {
    setLaunching(app.path);
    setError(null);

    try {
      if (window.agentlication) {
        const result = await window.agentlication.launchApp(app.path);
        if (!result.success) {
          setError(result.error || "Failed to launch app");
          setLaunching(null);
          return;
        }

        // Connect via CDP
        const cdpResult = await window.agentlication.cdpConnect(result.port);
        if (!cdpResult.success) {
          setError(cdpResult.error || "Failed to connect via CDP");
          setLaunching(null);
          return;
        }
      }

      onAppSelected(app);
    } catch (err) {
      setError(String(err));
    } finally {
      setLaunching(null);
    }
  };

  const handleCustomPath = () => {
    if (!customPath.trim()) return;
    const name = customPath.split("/").pop()?.replace(".app", "") || "Custom App";
    handleAgentlicate({ name, path: customPath.trim(), isElectron: true });
  };

  return (
    <div className="app-picker">
      <div className="picker-header">
        <h1>Agentlication</h1>
        <p className="subtitle">Select an Electron app to agentlicate</p>
      </div>

      {/* Custom path input */}
      <div className="custom-path">
        <input
          type="text"
          placeholder="Or enter app path: /Applications/MyApp.app"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCustomPath()}
        />
        <button onClick={handleCustomPath} disabled={!customPath.trim()}>
          Agentlicate
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* App list */}
      <div className="app-list">
        {loading ? (
          <div className="loading">Scanning for Electron apps...</div>
        ) : apps.length === 0 ? (
          <div className="empty">No Electron apps found. Try entering a path above.</div>
        ) : (
          apps.map((app) => (
            <div key={app.path} className="app-card">
              <div className="app-icon">
                {app.icon ? (
                  <img src={app.icon} alt={app.name} />
                ) : (
                  <div className="app-icon-placeholder">
                    {app.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="app-info">
                <span className="app-name">{app.name}</span>
                <span className="app-path">{app.path}</span>
              </div>
              {agentlicatedApps.has(app.name) && (
                <span className="agentlicated-badge">Agentlicated</span>
              )}
              <button
                className="agentlicate-btn"
                onClick={() => handleAgentlicate(app)}
                disabled={launching === app.path}
              >
                {launching === app.path
                  ? "Launching..."
                  : agentlicatedApps.has(app.name)
                    ? "Reconnect"
                    : "Agentlicate"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
