import React, { useState } from "react";
import type { TargetApp } from "@agentlication/contracts";
import AppPicker from "./AppPicker";
import ChatPanel from "./ChatPanel";

type Screen = "picker" | "chat";

export default function App() {
  const [screen, setScreen] = useState<Screen>("picker");
  const [targetApp, setTargetApp] = useState<TargetApp | null>(null);
  const [selectedModel, setSelectedModel] = useState("sonnet");

  const handleAppSelected = (app: TargetApp) => {
    setTargetApp(app);
    setScreen("chat");
  };

  const handleBack = () => {
    setScreen("picker");
    setTargetApp(null);
  };

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-drag" />
        <span className="titlebar-title">
          {screen === "chat" && targetApp
            ? `Agentlication — ${targetApp.name}`
            : "Agentlication"}
        </span>
      </div>

      <div className="content">
        {screen === "picker" && (
          <AppPicker onAppSelected={handleAppSelected} />
        )}
        {screen === "chat" && targetApp && (
          <ChatPanel
            targetApp={targetApp}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
