// Talks to AI providers directly from the browser.
// Each adapter knows one API's auth headers, model listing and streaming format.

export const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", sub: "Claude", base: "https://api.anthropic.com/v1",
    hint: "Create a key at console.anthropic.com." },
  { id: "openai", name: "OpenAI", sub: "GPT models", base: "https://api.openai.com/v1",
    hint: "Create a key at platform.openai.com/api-keys." },
  { id: "xai", name: "xAI", sub: "Grok", base: "https://api.x.ai/v1",
    hint: "Create a key at console.x.ai." },
  { id: "google", name: "Google", sub: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta",
    hint: "Create a key at aistudio.google.com/apikey." },
  { id: "custom", name: "Custom", sub: "OpenAI-compatible", base: "",
    hint: "Any server that implements the OpenAI chat completions API." },
];

export const getProvider = (id) => PROVIDERS.find((p) => p.id === id);

// Models that aren't chat models, filtered out of OpenAI-style listings.
const NON_CHAT = /embed|whisper|tts|dall-e|moderation|audio|image|realtime|transcribe|babbage|davinci/i;

/* ---------- shared helpers ---------- */

export async function checkResponse(res) {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  let detail = text;
  try {
    const j = JSON.parse(text);
    detail = j.error?.message || (typeof j.error === "string" ? j.error : "") || j.message || text;
  } catch { /* body wasn't JSON */ }
  const err = new Error(`HTTP ${res.status}${detail ? ": " + String(detail).slice(0, 300) : ""}`);
  err.status = res.status;
  throw err;
}

// Yields the payload of each "data:" line in a server-sent events response.
export async function* readSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trimEnd();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  buf += decoder.decode();
  for (const line of buf.split("\n")) {
    if (line.startsWith("data:")) yield line.slice(5).trim();
  }
}

/* ---------- Anthropic ---------- */

const anthropicHeaders = (cfg) => ({
  "x-api-key": cfg.apiKey,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

async function anthropicList(cfg) {
  const res = await fetch(cfg.baseUrl + "/models?limit=100", { headers: anthropicHeaders(cfg) });
  await checkResponse(res);
  const j = await res.json();
  return (j.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
}

async function* anthropicStream(cfg, messages, system, signal) {
  const res = await fetch(cfg.baseUrl + "/messages", {
    method: "POST",
    signal,
    headers: { ...anthropicHeaders(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      stream: true,
      system,
      messages: messages.map(({ role, content }) => ({ role, content })),
    }),
  });
  await checkResponse(res);
  for await (const data of readSSE(res)) {
    const j = JSON.parse(data);
    if (j.type === "error") throw new Error(j.error?.message || "Stream error");
    if (j.type === "content_block_delta" && j.delta?.type === "text_delta") yield j.delta.text;
  }
}

/* ---------- OpenAI, xAI and custom OpenAI-compatible endpoints ---------- */

async function openaiList(cfg) {
  const res = await fetch(cfg.baseUrl + "/models", {
    headers: { Authorization: "Bearer " + cfg.apiKey },
  });
  await checkResponse(res);
  const j = await res.json();
  return (j.data || [])
    .map((m) => m.id)
    .filter((id) => !NON_CHAT.test(id))
    .sort()
    .map((id) => ({ id, label: id }));
}

async function* openaiStream(cfg, messages, system, signal) {
  const res = await fetch(cfg.baseUrl + "/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages.map(({ role, content }) => ({ role, content }))],
    }),
  });
  await checkResponse(res);
  for await (const data of readSSE(res)) {
    if (data === "[DONE]") return;
    const j = JSON.parse(data);
    if (j.error) throw new Error(j.error.message || "Stream error");
    const delta = j.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/* ---------- Google Gemini ---------- */

const googleHeaders = (cfg) => ({ "x-goog-api-key": cfg.apiKey });

async function googleList(cfg) {
  const res = await fetch(cfg.baseUrl + "/models?pageSize=200", { headers: googleHeaders(cfg) });
  await checkResponse(res);
  const j = await res.json();
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => {
      const id = m.name.replace(/^models\//, "");
      return { id, label: m.displayName || id };
    });
}

async function* googleStream(cfg, messages, system, signal) {
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { ...googleHeaders(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    }),
  });
  await checkResponse(res);
  for await (const data of readSSE(res)) {
    const j = JSON.parse(data);
    if (j.error) throw new Error(j.error.message || "Stream error");
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (text) yield text;
  }
}

/* ---------- public API ---------- */

const ADAPTERS = {
  anthropic: { list: anthropicList, stream: anthropicStream },
  openai: { list: openaiList, stream: openaiStream },
  xai: { list: openaiList, stream: openaiStream },
  custom: { list: openaiList, stream: openaiStream },
  google: { list: googleList, stream: googleStream },
};

/** Returns [{id, label}] of chat-capable models available to this key. */
export function listModels(cfg) {
  return ADAPTERS[cfg.provider].list(cfg);
}

/** Async generator yielding text deltas for the given conversation. */
export function streamChat(cfg, messages, system, signal) {
  return ADAPTERS[cfg.provider].stream(cfg, messages, system, signal);
}

/** Turns an exception into a sentence a person can act on. */
export function friendlyError(err) {
  if (err instanceof TypeError) {
    return "Couldn't reach the provider from this browser. Check the key and base URL, and that the provider allows browser requests.";
  }
  if (err.status === 401 || err.status === 403) {
    return `The provider rejected this key (${err.status}). Check it and try again.`;
  }
  return err.message || "Something went wrong.";
}
