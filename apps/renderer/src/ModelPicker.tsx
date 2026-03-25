import React, { useEffect, useState, useRef } from "react";
import {
  MODEL_GROUPS,
  PROVIDER_INSTALL_COMMANDS,
} from "@agentlication/contracts";
import type { ProviderKind, ProviderStatusMap } from "@agentlication/contracts";

interface Props {
  selected: string;
  onChange: (modelId: string) => void;
  providerStatus: ProviderStatusMap | null;
}

export default function ModelPicker({
  selected,
  onChange,
  providerStatus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setShowStatus(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Find current model label
  const currentModel = MODEL_GROUPS.flatMap((g) => g.models).find(
    (m) => m.id === selected
  );
  const currentLabel = currentModel?.label || selected;

  const getStatusDot = (provider: ProviderKind) => {
    if (!providerStatus) return "status-dot status-dot-unknown";
    return providerStatus[provider]?.installed
      ? "status-dot status-dot-ready"
      : "status-dot status-dot-missing";
  };

  return (
    <div className="model-picker-container" ref={dropdownRef}>
      <button
        className="model-picker-trigger"
        onClick={() => setOpen(!open)}
        title="Select model"
      >
        {providerStatus && currentModel && (
          <span className={getStatusDot(currentModel.provider)} />
        )}
        <span className="model-picker-label">{currentLabel}</span>
        <span className="model-picker-chevron">{open ? "\u25B2" : "\u25BC"}</span>
      </button>

      {open && (
        <div className="model-picker-dropdown">
          {MODEL_GROUPS.map((group) => (
            <div key={group.provider} className="model-group">
              <div className="model-group-header">
                <span className={getStatusDot(group.provider)} />
                <span className="model-group-label">{group.label}</span>
                {providerStatus && (
                  <span className="model-group-status">
                    {providerStatus[group.provider]?.installed
                      ? "ready"
                      : "not found"}
                  </span>
                )}
              </div>
              {group.models.map((model) => (
                <button
                  key={model.id}
                  className={`model-option ${
                    model.id === selected ? "model-option-selected" : ""
                  } ${
                    providerStatus && !providerStatus[model.provider]?.installed
                      ? "model-option-disabled"
                      : ""
                  }`}
                  onClick={() => {
                    onChange(model.id);
                    setOpen(false);
                  }}
                  disabled={
                    providerStatus !== null &&
                    !providerStatus[model.provider]?.installed
                  }
                >
                  {model.label}
                  {model.id === selected && (
                    <span className="model-option-check">{"\u2713"}</span>
                  )}
                </button>
              ))}
            </div>
          ))}

          <div className="model-picker-divider" />
          <button
            className="model-picker-status-btn"
            onClick={() => setShowStatus(!showStatus)}
          >
            {showStatus ? "Hide" : "Show"} provider status
          </button>

          {showStatus && (
            <div className="provider-status-panel">
              {(["claude", "codex"] as ProviderKind[]).map((provider) => {
                const status = providerStatus?.[provider];
                const installed = status?.installed ?? false;
                return (
                  <div key={provider} className="provider-status-row">
                    <span
                      className={
                        installed
                          ? "status-dot status-dot-ready"
                          : "status-dot status-dot-missing"
                      }
                    />
                    <div className="provider-status-info">
                      <span className="provider-status-name">
                        {provider === "claude"
                          ? "Claude Code CLI"
                          : "Codex CLI"}
                      </span>
                      {installed ? (
                        <span className="provider-status-ok">
                          installed, authenticated
                        </span>
                      ) : (
                        <span className="provider-status-missing">
                          not found &mdash; install with{" "}
                          <code>{PROVIDER_INSTALL_COMMANDS[provider]}</code>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
