import React, { useState, useEffect } from "react";
import type { TargetApp, ProviderStatusMap } from "@agentlication/contracts";
import { DEFAULT_THINKING_LEVEL } from "@agentlication/contracts";
import AppPicker from "./AppPicker";
import ChatPanel from "./ChatPanel";
import ModelPicker from "./ModelPicker";

type Screen = "hub" | "chat";

export default function App() {
  const [screen, setScreen] = useState<Screen>("hub");
  const [targetApp, setTargetApp] = useState<TargetApp | null>(null);
  // Default to biggest Claude model; falls back to biggest Codex if Claude unavailable
  const [selectedModel, setSelectedModel] = useState("opus-4.6");
  const [thinkingLevel, setThinkingLevel] = useState(DEFAULT_THINKING_LEVEL.claude);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusMap | null>(null);
  const [detectedApps, setDetectedApps] = useState<TargetApp[]>([]);
  const [hubChatOpen, setHubChatOpen] = useState(true);

  // Check provider status on startup
  useEffect(() => {
    checkProviders();
  }, []);

  const checkProviders = async () => {
    if (window.agentlication) {
      try {
        const status = await window.agentlication.checkProviders();
        setProviderStatus(status as ProviderStatusMap);

        // Auto-select biggest available model (update when new models are released)
        if (status.claude?.installed) {
          setSelectedModel("opus-4.6");
        } else if (status.codex?.installed) {
          setSelectedModel("gpt-5.4");
          setThinkingLevel(DEFAULT_THINKING_LEVEL.codex);
        }
      } catch {
        // Ignore — status will remain null
      }
    } else {
      // Dev mode — mock both as available
      setProviderStatus({
        claude: { installed: true, installCommand: "npm i -g @anthropic-ai/claude-code" },
        codex: { installed: false, installCommand: "npm i -g @openai/codex" },
      });
    }
  };

  const handleAppSelected = (app: TargetApp) => {
    setTargetApp(app);
    setScreen("chat");
  };

  const handleBack = () => {
    setScreen("hub");
    setTargetApp(null);
  };

  const handleAppsLoaded = (apps: TargetApp[]) => {
    setDetectedApps(apps);
  };

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-drag" />
        <span className="titlebar-title">
          {screen === "chat" && targetApp
            ? `Agentlication \u2014 ${targetApp.name}`
            : "Agentlication"}
        </span>
        <div className="titlebar-spacer" />
        <ModelPicker
          selected={selectedModel}
          onChange={setSelectedModel}
          providerStatus={providerStatus}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={setThinkingLevel}
        />
      </div>

      <div className="content">
        {screen === "hub" && (
          <div className="hub-layout">
            <div className={`hub-picker ${hubChatOpen ? "hub-picker-with-chat" : ""}`}>
              <AppPicker
                onAppSelected={handleAppSelected}
                onAppsLoaded={handleAppsLoaded}
              />

              {/* Collapsed toggle — only shows when chat is hidden */}
              {!hubChatOpen && (
                <button
                  className="hub-chat-toggle"
                  onClick={() => setHubChatOpen(true)}
                  title="Open Setup Agent chat"
                >
                  <span className="hub-chat-toggle-icon">?</span>
                  <span>Setup Agent</span>
                </button>
              )}
            </div>

            {/* Chat panel — visible by default on the right */}
            {hubChatOpen && (
              <div className="hub-chat">
                <div className="hub-chat-header-bar">
                  <span className="hub-chat-title">Setup Agent</span>
                  <button
                    className="hub-chat-close"
                    onClick={() => setHubChatOpen(false)}
                    title="Close chat"
                  >
                    {"\u2715"}
                  </button>
                </div>
                <ChatPanel
                  selectedModel={selectedModel}
                  providerStatus={providerStatus}
                  title="Setup Agent"
                  placeholder="Ask about setting up apps, providers..."
                />
              </div>
            )}
          </div>
        )}

        {screen === "chat" && targetApp && (
          <ChatPanel
            targetApp={targetApp}
            selectedModel={selectedModel}
            onBack={handleBack}
            providerStatus={providerStatus}
          />
        )}
      </div>
    </div>
  );
}
