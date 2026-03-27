import React, { useEffect, useState } from "react";
import type { TargetApp, CdpPageInfo, AppProfile } from "@agentlication/contracts";

interface Props {
  onAppSelected: (app: TargetApp) => void;
  onAppsLoaded?: (apps: TargetApp[]) => void;
}

interface ConnectionState {
  status: "disconnected" | "connecting" | "connected" | "error";
  info: CdpPageInfo | null;
  error?: string;
}

export default function AppPicker({
  onAppSelected,
  onAppsLoaded,
}: Props) {
  const [apps, setApps] = useState<TargetApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [customPath, setCustomPath] = useState("");
  const [launching, setLaunching] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentlicatedApps, setAgentlicatedApps] = useState<Set<string>>(new Set());
  /** Tracks CDP connection state per app (by name). */
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({});

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
        // Dev mode without Electron -- show mock data
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

  const setConnectionState = (appName: string, state: ConnectionState) => {
    setConnections((prev) => ({ ...prev, [appName]: state }));
  };

  const handleAgentlicate = async (app: TargetApp) => {
    setError(null);

    // Step 1: Create profile if not already agentlicated
    let profile: AppProfile | undefined;
    if (!agentlicatedApps.has(app.name) && window.agentlication) {
      setCreatingProfile(app.path);
      try {
        const profileResult = await window.agentlication.createAppProfile({
          name: app.name,
          path: app.path,
        });
        if (!profileResult.success) {
          setError(profileResult.error || "Failed to create app profile");
          setCreatingProfile(null);
          return;
        }
        profile = profileResult.profile;
        // Mark as agentlicated
        setAgentlicatedApps((prev) => new Set(prev).add(app.name));
      } catch (err) {
        setError(String(err));
        setCreatingProfile(null);
        return;
      } finally {
        setCreatingProfile(null);
      }
    }

    // Step 2: Get profile to know the CDP port
    if (!profile && window.agentlication) {
      profile = (await window.agentlication.getAppProfile(app.name)) ?? undefined;
    }
    const cdpPort = profile?.cdpPort ?? 9222;

    // Step 3: Connect via CDP (kill, relaunch with flag, connect)
    setLaunching(app.path);
    setConnectionState(app.name, { status: "connecting", info: null });

    try {
      if (window.agentlication) {
        const cdpResult = await window.agentlication.cdpConnect(app.path, cdpPort);
        if (!cdpResult.success) {
          setConnectionState(app.name, {
            status: "error",
            info: null,
            error: cdpResult.error || "Failed to connect via CDP",
          });
          setError(cdpResult.error || "Failed to connect via CDP");
          setLaunching(null);
          return;
        }

        // Step 4: Get page info
        const pageInfo = await window.agentlication.cdpGetInfo();
        setConnectionState(app.name, {
          status: "connected",
          info: pageInfo,
        });
      }

      onAppSelected(app);
    } catch (err) {
      setConnectionState(app.name, {
        status: "error",
        info: null,
        error: String(err),
      });
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
          apps.map((app) => {
            const conn = connections[app.name];
            return (
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
                  <div className="app-name-row">
                    <span className="app-name">{app.name}</span>
                    {conn && (
                      <span
                        className={`cdp-status-dot cdp-status-${conn.status}`}
                        title={
                          conn.status === "connected"
                            ? `Connected${conn.info?.title ? ` - ${conn.info.title}` : ""}`
                            : conn.status === "connecting"
                              ? "Connecting..."
                              : conn.status === "error"
                                ? conn.error || "Connection error"
                                : "Disconnected"
                        }
                      />
                    )}
                  </div>
                  <span className="app-path">{app.path}</span>
                  {conn?.status === "connected" && conn.info && (
                    <div className="cdp-info">
                      {conn.info.title && (
                        <span className="cdp-info-item">
                          {conn.info.title}
                        </span>
                      )}
                      {conn.info.framework && (
                        <span className="cdp-info-badge">
                          {conn.info.framework}
                        </span>
                      )}
                      {conn.info.url && (
                        <span className="cdp-info-url">
                          {conn.info.url}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {agentlicatedApps.has(app.name) && (
                  <span className="agentlicated-badge">Agentlicated</span>
                )}
                <button
                  className="agentlicate-btn"
                  onClick={() => handleAgentlicate(app)}
                  disabled={launching === app.path || creatingProfile === app.path}
                >
                  {creatingProfile === app.path
                    ? "Creating profile..."
                    : launching === app.path
                      ? "Connecting..."
                      : agentlicatedApps.has(app.name)
                        ? "Reconnect"
                        : "Agentlicate"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
