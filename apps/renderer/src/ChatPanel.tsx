import React, { useState, useEffect, useRef } from "react";
import type { TargetApp, ChatMessage, AgentEvent, AgentChunk } from "@agentlication/contracts";
import ChatComposer from "./ChatComposer";
import ModelPicker from "./ModelPicker";

interface Props {
  targetApp: TargetApp;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onBack: () => void;
}

let messageIdCounter = 0;
function nextId(): string {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

export default function ChatPanel({
  targetApp,
  selectedModel,
  onModelChange,
  onBack,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
                setMessages((msgs) => [
                  ...msgs,
                  {
                    id: nextId(),
                    role: "assistant",
                    content: prev,
                    timestamp: Date.now(),
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
            setMessages((msgs) => [
              ...msgs,
              {
                id: nextId(),
                role: "assistant",
                content: `Error: ${message}`,
                timestamp: Date.now(),
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

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSend = async (text: string) => {
    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setStreaming(true);
    setStreamingText("");

    if (window.agentlication) {
      await window.agentlication.agentSend(text, selectedModel);
    } else {
      // Dev mode mock
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: `[Dev mode] I would interact with **${targetApp.name}** via CDP here. Model: ${selectedModel}`,
            timestamp: Date.now(),
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

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <button className="back-btn" onClick={onBack}>
          &larr;
        </button>
        <span className="chat-target-name">{targetApp.name}</span>
        <ModelPicker selected={selectedModel} onChange={onModelChange} />
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !streaming && (
          <div className="chat-empty">
            <p>Connected to <strong>{targetApp.name}</strong></p>
            <p className="chat-empty-hint">
              Ask the agent to interact with the app, read its state, or inject custom UI.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message-${msg.role}`}>
            <div className="message-bubble">
              <div className="message-content">{msg.content}</div>
            </div>
          </div>
        ))}

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
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <ChatComposer onSend={handleSend} onCancel={handleCancel} streaming={streaming} />
    </div>
  );
}
