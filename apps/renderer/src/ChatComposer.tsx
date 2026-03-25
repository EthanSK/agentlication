import React, { useState, useRef, useEffect } from "react";

interface Props {
  onSend: (message: string) => void;
  onCancel: () => void;
  streaming: boolean;
}

export default function ChatComposer({ onSend, onCancel, streaming }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-composer">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask the agent..."
        rows={1}
        disabled={streaming}
      />
      {streaming ? (
        <button className="cancel-btn" onClick={onCancel}>
          Stop
        </button>
      ) : (
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send
        </button>
      )}
    </div>
  );
}
