import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { listModels, streamChat, friendlyError, PROVIDERS } from "../js/providers.js";

// A fake fetch so the adapters can be tested without network access.
let calls;
let originalFetch;
beforeEach(() => { calls = []; originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

function mockFetch(handler) {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
const sse = (lines) => new Response(lines.map((l) => l + "\n").join(""), {
  status: 200, headers: { "content-type": "text/event-stream" },
});
async function collect(gen) {
  let out = "";
  for await (const d of gen) out += d;
  return out;
}
const signal = new AbortController().signal;
const messages = [{ role: "user", content: "hi" }];

test("provider list covers the four named providers plus custom", () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["anthropic", "openai", "xai", "google", "custom"]);
});

test("anthropic: lists models and streams text deltas with browser-access header", async () => {
  mockFetch((url) => {
    if (url.includes("/models")) return json({ data: [{ id: "claude-x", display_name: "Claude X" }] });
    return sse([
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
      "",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
    ]);
  });
  const cfg = { provider: "anthropic", apiKey: "k", baseUrl: "https://api.anthropic.com/v1", model: "claude-x" };
  assert.deepEqual(await listModels(cfg), [{ id: "claude-x", label: "Claude X" }]);
  assert.equal(await collect(streamChat(cfg, messages, "sys", signal)), "Hello");
  const post = calls.at(-1);
  assert.equal(post.opts.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(JSON.parse(post.opts.body).system, "sys");
});

test("openai-style: filters non-chat models and streams until [DONE]", async () => {
  mockFetch((url) => {
    if (url.endsWith("/models")) return json({ data: [{ id: "gpt-4o" }, { id: "text-embedding-3" }, { id: "o3" }] });
    return sse(['data: {"choices":[{"delta":{"content":"Hi "}}]}',
      'data: {"choices":[{"delta":{"content":"there"}}]}', "data: [DONE]",
      'data: {"choices":[{"delta":{"content":"ignored"}}]}']);
  });
  const cfg = { provider: "openai", apiKey: "k", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" };
  assert.deepEqual((await listModels(cfg)).map((m) => m.id), ["gpt-4o", "o3"]);
  assert.equal(await collect(streamChat(cfg, messages, "sys", signal)), "Hi there");
});

test("xai and custom endpoints use the same OpenAI-style adapter", async () => {
  mockFetch(() => sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]"]));
  const cfg = { provider: "xai", apiKey: "k", baseUrl: "https://api.x.ai/v1", model: "grok-x" };
  assert.equal(await collect(streamChat(cfg, messages, "sys", signal)), "ok");
  assert.equal(calls[0].url, "https://api.x.ai/v1/chat/completions");
});

test("google: lists generateContent models and streams candidate parts", async () => {
  mockFetch((url) => {
    if (url.includes("/models?")) return json({ models: [
      { name: "models/gemini-x", displayName: "Gemini X", supportedGenerationMethods: ["generateContent"] },
      { name: "models/emb", supportedGenerationMethods: ["embedContent"] },
    ] });
    return sse(['data: {"candidates":[{"content":{"parts":[{"text":"G1"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"G2"}]}}]}']);
  });
  const cfg = { provider: "google", apiKey: "k", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-x" };
  assert.deepEqual(await listModels(cfg), [{ id: "gemini-x", label: "Gemini X" }]);
  assert.equal(await collect(streamChat(cfg, messages, "sys", signal)), "G1G2");
  assert.equal(calls.at(-1).opts.headers["x-goog-api-key"], "k"); // key in a header, not the URL
  assert.ok(!calls.at(-1).url.includes("key="));
});

test("HTTP errors become readable messages", async () => {
  mockFetch(() => json({ error: { message: "invalid x-api-key" } }, 401));
  const cfg = { provider: "anthropic", apiKey: "bad", baseUrl: "https://api.anthropic.com/v1" };
  await assert.rejects(listModels(cfg), (err) => {
    assert.equal(err.status, 401);
    assert.equal(friendlyError(err), "The provider rejected this key (401). Check it and try again.");
    return true;
  });
});

test("network failures explain the likely cause", async () => {
  mockFetch(() => { throw new TypeError("Failed to fetch"); });
  const cfg = { provider: "openai", apiKey: "k", baseUrl: "https://offline.example/v1" };
  await assert.rejects(listModels(cfg), (err) => {
    assert.ok(friendlyError(err).startsWith("Couldn't reach the provider"));
    return true;
  });
});
