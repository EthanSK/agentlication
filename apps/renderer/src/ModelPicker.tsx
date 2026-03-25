import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  MODEL_GROUPS,
  THINKING_LEVELS,
  DEFAULT_THINKING_LEVEL,
  PROVIDER_INSTALL_COMMANDS,
} from "@agentlication/contracts";
import type {
  ProviderKind,
  ProviderStatusMap,
  ThinkingLevel,
} from "@agentlication/contracts";

interface Props {
  selected: string;
  onChange: (modelId: string) => void;
  providerStatus: ProviderStatusMap | null;
  thinkingLevel: string;
  onThinkingLevelChange: (level: string) => void;
}

/** SVG icons for each provider */
function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" width="16" height="16">
      <path
        d="M15.31 3.41L12.61 12.18L17.27 5.66C17.55 5.26 18.09 5.16 18.49 5.44C18.89 5.72 18.99 6.26 18.71 6.66L12.43 15.62L19.15 8.12C19.49 7.74 20.05 7.71 20.43 8.05C20.81 8.39 20.84 8.95 20.5 9.33L12.61 18.11L12.61 18.11C14.39 16.76 16.92 17.09 18.27 18.87C19.62 20.65 19.29 23.18 17.51 24.53C15.73 25.88 13.2 25.55 11.85 23.77L3.34 11.56C1.48 9.08 2.09 5.58 4.73 3.85C7.37 2.12 10.83 2.89 12.53 5.55"
        fill="currentColor"
      />
    </svg>
  );
}

function CodexIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" width="16" height="16">
      <path
        d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.143-.08 4.778-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v3.005l-2.602 1.5-2.607-1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

const PROVIDER_ICONS: Record<ProviderKind, React.FC<{ className?: string }>> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
};

const PROVIDER_ICON_COLORS: Record<ProviderKind, string> = {
  claude: "model-icon-claude",
  codex: "model-icon-codex",
};

export default function ModelPicker({
  selected,
  onChange,
  providerStatus,
  thinkingLevel,
  onThinkingLevelChange,
}: Props) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<ProviderKind | null>(null);
  const [installHint, setInstallHint] = useState<ProviderKind | null>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLDivElement>(null);

  // Find current model
  const currentModel = MODEL_GROUPS.flatMap((g) => g.models).find(
    (m) => m.id === selected
  );
  const currentProvider: ProviderKind = currentModel?.provider ?? "claude";
  const ProviderIcon = PROVIDER_ICONS[currentProvider];
  const thinkingLevels = THINKING_LEVELS[currentProvider];
  const currentEffort = thinkingLevels.find((l) => l.value === thinkingLevel);
  const effortLabel = currentEffort?.label ?? thinkingLevel;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
        setExpandedProvider(null);
        setInstallHint(null);
      }
      if (effortRef.current && !effortRef.current.contains(e.target as Node)) {
        setEffortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleModelSelect = useCallback(
    (modelId: string, provider: ProviderKind) => {
      if (providerStatus && !providerStatus[provider]?.installed) {
        setInstallHint(provider);
        return;
      }
      onChange(modelId);
      // If switching providers, reset thinking level to the new provider's default
      if (currentProvider !== provider) {
        onThinkingLevelChange(DEFAULT_THINKING_LEVEL[provider]);
      }
      setModelMenuOpen(false);
      setExpandedProvider(null);
      setInstallHint(null);
    },
    [onChange, onThinkingLevelChange, providerStatus, currentProvider]
  );

  const handleEffortSelect = useCallback(
    (value: string) => {
      onThinkingLevelChange(value);
      setEffortMenuOpen(false);
    },
    [onThinkingLevelChange]
  );

  const isProviderAvailable = (provider: ProviderKind) =>
    !providerStatus || providerStatus[provider]?.installed;

  return (
    <div className="model-picker-row">
      {/* ── Model selector ── */}
      <div className="model-picker-container" ref={modelRef}>
        <button
          className="model-picker-trigger"
          onClick={() => {
            setModelMenuOpen(!modelMenuOpen);
            setEffortMenuOpen(false);
          }}
        >
          <ProviderIcon className={`model-trigger-icon ${PROVIDER_ICON_COLORS[currentProvider]}`} />
          <span className="model-picker-label">
            {currentModel?.label ?? selected}
          </span>
          <svg className="model-picker-chevron" viewBox="0 0 10 6" width="10" height="6">
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {modelMenuOpen && (
          <div className="model-picker-dropdown">
            {MODEL_GROUPS.map((group) => {
              const GIcon = PROVIDER_ICONS[group.provider];
              const available = isProviderAvailable(group.provider);
              const isExpanded = expandedProvider === group.provider;

              return (
                <div key={group.provider} className="model-group">
                  <button
                    className={`model-group-header ${!available ? "model-group-unavailable" : ""}`}
                    onClick={() =>
                      setExpandedProvider(isExpanded ? null : group.provider)
                    }
                  >
                    <GIcon
                      className={`model-group-icon ${PROVIDER_ICON_COLORS[group.provider]}`}
                    />
                    <span className="model-group-label">{group.label}</span>
                    {!available && (
                      <span className="model-group-badge">Not installed</span>
                    )}
                    <svg
                      className={`model-group-chevron ${isExpanded ? "model-group-chevron-open" : ""}`}
                      viewBox="0 0 10 6"
                      width="10"
                      height="6"
                    >
                      <path
                        d="M1 1l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="model-group-models">
                      {/* Install hint for unavailable providers */}
                      {installHint === group.provider && !available && (
                        <div className="model-install-hint">
                          Install with:{" "}
                          <code>{PROVIDER_INSTALL_COMMANDS[group.provider]}</code>
                        </div>
                      )}

                      {group.models.map((model) => {
                        const isSelected = model.id === selected;
                        return (
                          <button
                            key={model.id}
                            className={`model-option ${isSelected ? "model-option-selected" : ""} ${
                              !available ? "model-option-disabled" : ""
                            }`}
                            onClick={() =>
                              handleModelSelect(model.id, model.provider)
                            }
                          >
                            <span className="model-option-label">{model.label}</span>
                            {isSelected && (
                              <svg
                                className="model-option-check"
                                viewBox="0 0 16 16"
                                width="14"
                                height="14"
                              >
                                <path
                                  d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"
                                  fill="currentColor"
                                />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Separator dot ── */}
      <span className="model-picker-sep">&middot;</span>

      {/* ── Effort / thinking level selector ── */}
      <div className="model-picker-container" ref={effortRef}>
        <button
          className="model-picker-trigger model-picker-effort-trigger"
          onClick={() => {
            setEffortMenuOpen(!effortMenuOpen);
            setModelMenuOpen(false);
          }}
        >
          <span className="model-picker-label">{effortLabel}</span>
          <svg className="model-picker-chevron" viewBox="0 0 10 6" width="10" height="6">
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {effortMenuOpen && (
          <div className="model-picker-dropdown model-picker-effort-dropdown">
            <div className="effort-header">Effort</div>
            {thinkingLevels.map((level: ThinkingLevel) => {
              const isActive = level.value === thinkingLevel;
              const isDefault =
                level.value === DEFAULT_THINKING_LEVEL[currentProvider];
              return (
                <button
                  key={level.value}
                  className={`model-option ${isActive ? "model-option-selected" : ""}`}
                  onClick={() => handleEffortSelect(level.value)}
                >
                  <span className="model-option-label">
                    {level.label}
                    {isDefault && (
                      <span className="effort-default-badge">default</span>
                    )}
                  </span>
                  {isActive && (
                    <svg
                      className="model-option-check"
                      viewBox="0 0 16 16"
                      width="14"
                      height="14"
                    >
                      <path
                        d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"
                        fill="currentColor"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
