import React, { useEffect, useState } from "react";
import type { TargetApp } from "@agentlication/contracts";

interface Props {
  onAppSelected: (app: TargetApp) => void;
}

export default function AppPicker({ onAppSelected }: Props) {
  const [apps, setApps] = useState<TargetApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [customPath, setCustomPath] = useState("");
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadApps();
  }, []);

  const loadApps = async () => {
    setLoading(true);
    try {
      if (window.agentlication) {
        const scanned = await window.agentlication.scanApps();
        setApps(scanned);
      } else {
        // Dev mode without Electron — show mock data
        setApps([
          { name: "VS Code", path: "/Applications/Visual Studio Code.app", isElectron: true },
          { name: "Slack", path: "/Applications/Slack.app", isElectron: true },
          { name: "Notion", path: "/Applications/Notion.app", isElectron: true },
        ]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAgentify = async (app: TargetApp) => {
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
    handleAgentify({ name, path: customPath.trim(), isElectron: true });
  };

  return (
    <div className="app-picker">
      <div className="picker-header">
        <h1>Agentlication</h1>
        <p className="subtitle">Select an Electron app to agentify</p>
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
          Agentify
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
              <button
                className="agentify-btn"
                onClick={() => handleAgentify(app)}
                disabled={launching === app.path}
              >
                {launching === app.path ? "Launching..." : "Agentify"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
