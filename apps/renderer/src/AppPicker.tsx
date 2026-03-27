import React, { useEffect, useState, useMemo } from "react";
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

/** SVG info icon for non-Electron badge tooltip */
function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.75" fill="currentColor" />
    </svg>
  );
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
  /** Search/filter input */
  const [searchQuery, setSearchQuery] = useState("");
  /** Show all apps or Electron only */
  const [showAllApps, setShowAllApps] = useState(true);

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
          { name: "Safari", path: "/Applications/Safari.app", isElectron: false },
          { name: "Finder", path: "/System/Library/CoreServices/Finder.app", isElectron: false },
          { name: "Preview", path: "/Applications/Preview.app", isElectron: false },
          { name: "Calendar", path: "/Applications/Calendar.app", isElectron: false },
          { name: "Music", path: "/Applications/Music.app", isElectron: false },
          { name: "Notes", path: "/Applications/Notes.app", isElectron: false },
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

  /** Filter and group apps based on search query and toggle */
  const { electronApps, otherApps } = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = apps.filter((app) => {
      if (!showAllApps && !app.isElectron) return false;
      if (query) {
        return app.name.toLowerCase().includes(query);
      }
      return true;
    });

    return {
      electronApps: filtered.filter((a) => a.isElectron),
      otherApps: filtered.filter((a) => !a.isElectron),
    };
  }, [apps, searchQuery, showAllApps]);

  const electronCount = apps.filter((a) => a.isElectron).length;
  const totalCount = apps.length;

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

        // Step 1b: Non-blocking source repo discovery and clone
        // This runs in background while CDP connection proceeds
        if (profile && !profile.sourceRepoUrl) {
          findAndCloneSourceRepo(app.name, profile.bundleId).catch(() => {
            // Source repo discovery is best-effort, don't block agentlication
          });
        }
      } catch (err) {
        setError(String(err));
        setCreatingProfile(null);
        return;
      } finally {
        setCreatingProfile(null);
      }
    }

    // For non-Electron apps, skip CDP connection entirely
    if (!app.isElectron) {
      onAppSelected(app);

      // Open companion window for this app
      if (window.agentlication?.openCompanion) {
        window.agentlication.openCompanion(app.name);
      }
      return;
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

      // Open companion window for this app
      if (window.agentlication?.openCompanion) {
        window.agentlication.openCompanion(app.name);
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

  /**
   * Non-blocking: search GitHub for the app's source repo and clone it.
   * Runs in background after profile creation so it doesn't block CDP connection.
   */
  const findAndCloneSourceRepo = async (appName: string, bundleId?: string) => {
    if (!window.agentlication?.findSourceRepo) return;

    try {
      const findResult = await window.agentlication.findSourceRepo(appName, bundleId);
      if (!findResult.success || !findResult.repo) return;

      // Clone the discovered repo
      if (window.agentlication.cloneSource) {
        await window.agentlication.cloneSource(appName, findResult.repo.repoUrl);
      }
    } catch {
      // Source repo operations are best-effort
    }
  };

  const handleCustomPath = () => {
    if (!customPath.trim()) return;
    const name = customPath.split("/").pop()?.replace(".app", "") || "Custom App";
    handleAgentlicate({ name, path: customPath.trim(), isElectron: true });
  };

  const renderAppCard = (app: TargetApp) => {
    const conn = connections[app.name];
    return (
      <div key={app.path} className={`app-card ${!app.isElectron ? "app-card-non-electron" : ""}`}>
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
            {!app.isElectron && (
              <span className="non-electron-badge" title="Limited support — no DOM access. Uses macOS Accessibility API.">
                <InfoIcon />
                <span className="non-electron-badge-text">Native</span>
              </span>
            )}
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
  };

  return (
    <div className="app-picker">
      <div className="picker-header">
        <h1>Agentlication</h1>
        <p className="subtitle">Select an app to agentlicate</p>
      </div>

      {/* Search and filter bar */}
      <div className="app-filter-bar">
        <input
          type="text"
          className="app-search-input"
          placeholder="Search apps..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className={`app-filter-toggle ${showAllApps ? "app-filter-toggle-active" : ""}`}
          onClick={() => setShowAllApps(!showAllApps)}
          title={showAllApps ? "Showing all apps" : "Showing Electron apps only"}
        >
          {showAllApps ? "All Apps" : "Electron Only"}
        </button>
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
          <div className="loading">Scanning for apps...</div>
        ) : electronApps.length === 0 && otherApps.length === 0 ? (
          <div className="empty">
            {searchQuery
              ? "No apps match your search."
              : "No apps found. Try entering a path above."}
          </div>
        ) : (
          <>
            {/* Electron apps section */}
            {electronApps.length > 0 && (
              <>
                {showAllApps && otherApps.length > 0 && (
                  <div className="app-section-header">
                    <span className="app-section-label">Electron Apps</span>
                    <span className="app-section-count">{electronCount}</span>
                  </div>
                )}
                {electronApps.map(renderAppCard)}
              </>
            )}

            {/* Non-Electron apps section */}
            {showAllApps && otherApps.length > 0 && (
              <>
                <div className="app-section-header app-section-other">
                  <span className="app-section-label">Other Apps</span>
                  <span className="app-section-count">{totalCount - electronCount}</span>
                  <span className="app-section-hint">Limited support — Accessibility API only</span>
                </div>
                {otherApps.map(renderAppCard)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
