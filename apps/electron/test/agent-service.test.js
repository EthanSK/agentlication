const test = require("node:test");
const assert = require("node:assert/strict");

// Load buildCodexPrompt from the compiled dist. This exercises the same
// exported helper that CodexProvider uses at runtime, so a regression where
// the system prompt stops being forwarded will be caught here.
const { buildCodexPrompt } = require("../dist/agent-service.js");

test("buildCodexPrompt: empty system prompt returns just the user message", () => {
  assert.equal(buildCodexPrompt("", "hello"), "hello");
  assert.equal(buildCodexPrompt("   ", "hello"), "hello");
  // @ts-expect-error — defensive: null should be treated as empty, not crash
  assert.equal(buildCodexPrompt(null, "hello"), "hello");
});

test("buildCodexPrompt: prepends a clearly delimited system section", () => {
  const out = buildCodexPrompt("You are X. Use tool-blocks.", "please click Save");

  // Both the system instructions and the user message must be present —
  // that's the actual bug (system prompt was dropped entirely).
  assert.match(out, /You are X\./);
  assert.match(out, /Use tool-blocks\./);
  assert.match(out, /please click Save/);

  // System block must appear before the user block so the model reads it
  // as context rather than a reply target.
  const sysIdx = out.indexOf("You are X.");
  const userIdx = out.indexOf("please click Save");
  assert.ok(sysIdx >= 0 && userIdx >= 0);
  assert.ok(sysIdx < userIdx, "system instructions must precede the user message");

  // Delimiter exists so the model (and humans debugging the CLI invocation)
  // can tell the two sections apart.
  assert.match(out, /# System Instructions/);
  assert.match(out, /# User Message/);
});

test("buildCodexPrompt: multi-line system prompts are preserved verbatim (trimmed)", () => {
  const systemPrompt = `Line 1
Line 2
Line 3`;
  const out = buildCodexPrompt(systemPrompt, "go");
  assert.match(out, /Line 1\nLine 2\nLine 3/);
  assert.match(out, /\n\ngo$/);
});

// ─────────────────────────────────────────────────────────────────────
// Bug 1 regression guard — companion routing decision.
//
// The renderer's ChatPanel imports pickCompanionSender() from
// @agentlication/contracts to decide which IPC to invoke. We import the
// *same* exported helper here so a regression (hardcoding one branch or
// inverting the check) fails this test regardless of which workspace
// introduces it.
// ─────────────────────────────────────────────────────────────────────
const { pickCompanionSender } = require("@agentlication/contracts");

test("pickCompanionSender: Electron targets hit the CDP-based IPC", () => {
  assert.equal(pickCompanionSender(true), "companionAgentSend");
});

test("pickCompanionSender: non-Electron targets hit the native AX IPC", () => {
  // This was Bug 1: the renderer hardcoded isElectron:true, so the AX
  // branch was unreachable. If anyone reintroduces that, this fails.
  assert.equal(pickCompanionSender(false), "companionNativeAgentSend");
});
