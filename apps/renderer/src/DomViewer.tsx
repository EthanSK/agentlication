import React, { useState } from "react";

/**
 * Optional DOM viewer panel — shows current DOM snapshot from CDP.
 * Can be toggled from the chat panel for debugging.
 */
export default function DomViewer() {
  const [dom, setDom] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      if (window.agentlication) {
        const html = await window.agentlication.cdpGetDOM();
        setDom(html);
      } else {
        setDom("<html><body>Dev mode — no CDP connection</body></html>");
      }
    } catch (err) {
      setDom(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dom-viewer">
      <div className="dom-viewer-header">
        <span>DOM Snapshot</span>
        <button onClick={refresh} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      <pre className="dom-viewer-content">
        {dom || "Click Refresh to load DOM snapshot"}
      </pre>
    </div>
  );
}
