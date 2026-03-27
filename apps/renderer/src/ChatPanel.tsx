import React, { useState, useEffect, useRef } from "react";
import type {
  TargetApp,
  ChatMessage,
  AgentEvent,
  AgentChunk,
  ProviderStatusMap,
  StatusMessage,
} from "@agentlication/contracts";
import ChatComposer from "./ChatComposer";

const SETUP_AGENT_SYSTEM_PROMPT = `You are the Agentlication Setup Agent — a friendly, knowledgeable assistant that helps users set up and configure their Electron applications for use with Agentlication.

You can help with:
1. Explaining what Agentlication does (it lets AI agents see and interact with Electron apps via Chrome DevTools Protocol)
2. Guiding users through selecting and connecting to their Electron apps
3. Explaining provider setup (Claude CLI, Codex CLI) and how to install them
4. Troubleshooting connection issues
5. Answering questions about how agents interact with apps (DOM inspection, JS execution, UI injection)

Be concise, helpful, and friendly. Use markdown formatting for clarity. When listing steps, use numbered lists. Keep responses focused and actionable.

You do NOT have access to the user's filesystem or any tools — you are a conversational assistant only. Do not hallucinate capabilities you don't have.`;

interface Props {
  /** If provided, this is a Companion chat (per-app). Otherwise it's the Hub chat. */
  targetApp?: TargetApp;
  selectedModel: string;
  onBack?: () => void;
  providerStatus: ProviderStatusMap | null;
  /** Title override for Hub mode */
  title?: string;
  /** Placeholder text for the composer */
  placeholder?: string;
}

type FeedItem =
  | { kind: "chat"; data: ChatMessage }
  | { kind: "status"; data: StatusMessage };

let messageIdCounter = 0;
function nextId(): string {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const STATUS_ICONS: Record<string, string> = {
  info: "\u2139\uFE0F",
  success: "\u2705",
  error: "\u274C",
  progress: "\u23F3",
};

export default function ChatPanel({
  targetApp,
  selectedModel,
  onBack,
  providerStatus,
  title,
  placeholder,
}: Props) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to agent events
  useEffect(() => {
    if (!window.agentlication) return;

    const unsubscribe = window.agentlication.onAgentEvent(
      (event: AgentEvent) => {
        switch (event.kind) {
          case "agent:chunk": {
            const chunk = event.payload as AgentChunk;
            setStreamingText((prev) => prev + chunk.text);
            break;
          }
          case "agent:done": {
            setStreamingText((prev) => {
              if (prev) {
                setFeed((items) => [
                  ...items,
                  {
                    kind: "chat",
                    data: {
                      id: nextId(),
                      role: "assistant",
                      content: prev,
                      timestamp: Date.now(),
                    },
                  },
                ]);
              }
              return "";
            });
            setStreaming(false);
            break;
          }
          case "agent:error": {
            const { message } = event.payload as { message: string };
            setFeed((items) => [
              ...items,
              {
                kind: "chat",
                data: {
                  id: nextId(),
                  role: "assistant",
                  content: `Error: ${message}`,
                  timestamp: Date.now(),
                },
              },
            ]);
            setStreaming(false);
            setStreamingText("");
            break;
          }
        }
      }
    );

    return unsubscribe;
  }, []);

  // Subscribe to status messages
  useEffect(() => {
    if (!window.agentlication?.onStatusMessage) return;

    const unsubscribe = window.agentlication.onStatusMessage(
      (msg: StatusMessage) => {
        setFeed((items) => [
          ...items,
          { kind: "status", data: msg },
        ]);
      }
    );

    return unsubscribe;
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed, streamingText]);

  const handleSend = async (text: string) => {
    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setFeed((prev) => [...prev, { kind: "chat", data: userMessage }]);
    setStreaming(true);
    setStreamingText("");

    if (window.agentlication) {
      if (targetApp) {
        // Companion chat — uses CDP context
        await window.agentlication.agentSend(text, selectedModel);
      } else {
        // Hub / Setup Agent chat — uses dedicated system prompt
        await window.agentlication.agentSendHub(
          text,
          selectedModel,
          SETUP_AGENT_SYSTEM_PROMPT
        );
      }
    } else {
      // Dev mode mock
      const context = targetApp
        ? `I would interact with **${targetApp.name}** via CDP here.`
        : "I'm the Setup Agent. I can help you configure your Electron apps.";
      setTimeout(() => {
        setFeed((prev) => [
          ...prev,
          {
            kind: "chat",
            data: {
              id: nextId(),
              role: "assistant",
              content: `[Dev mode] ${context} Model: ${selectedModel}`,
              timestamp: Date.now(),
            },
          },
        ]);
        setStreaming(false);
      }, 800);
    }
  };

  const handleCancel = () => {
    window.agentlication?.agentCancel();
    setStreaming(false);
  };

  const displayTitle = title || (targetApp ? targetApp.name : "Setup Agent");
  const emptyHint = targetApp
    ? "Ask the agent to interact with the app, read its state, or inject custom UI."
    : "Ask me to help configure your Electron apps, set up providers, or get started.";

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        {onBack && (
          <button className="back-btn" onClick={onBack}>
            &larr;
          </button>
        )}
        <span className="chat-target-name">{displayTitle}</span>
      </div>

      {/* Messages & Status Feed */}
      <div className="chat-messages">
        {feed.length === 0 && !streaming && (
          <div className="chat-empty">
            <p>
              {targetApp ? (
                <>
                  Connected to <strong>{targetApp.name}</strong>
                </>
              ) : (
                <>Agentlication Setup Agent</>
              )}
            </p>
            <p className="chat-empty-hint">{emptyHint}</p>
          </div>
        )}

        {feed.map((item) => {
          if (item.kind === "status") {
            const s = item.data;
            return (
              <div key={s.id} className={`status-feed-item status-feed-${s.level}`}>
                <span className="status-feed-icon">{STATUS_ICONS[s.level] || ""}</span>
                <span className="status-feed-text">{s.text}</span>
                <span className="status-feed-time">{formatTime(s.timestamp)}</span>
              </div>
            );
          }
          const msg = item.data;
          return (
            <div
              key={msg.id}
              className={`chat-message chat-message-${msg.role}`}
            >
              <div className="message-bubble">
                <div className="message-content">{msg.content}</div>
              </div>
            </div>
          );
        })}

        {/* Streaming indicator */}
        {streaming && streamingText && (
          <div className="chat-message chat-message-assistant">
            <div className="message-bubble">
              <div className="message-content">{streamingText}</div>
              <span className="streaming-cursor" />
            </div>
          </div>
        )}

        {streaming && !streamingText && (
          <div className="chat-message chat-message-assistant">
            <div className="message-bubble">
              <div className="typing-indicator">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <ChatComposer
        onSend={handleSend}
        onCancel={handleCancel}
        streaming={streaming}
        placeholder={placeholder}
      />
    </div>
  );
}
