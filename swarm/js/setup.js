// The setup wizard: choose a provider, enter a key, load and pick a model.
// Opens automatically on first visit and from the Settings button afterwards.

import { $, el } from "./dom.js";
import { PROVIDERS, getProvider, listModels, friendlyError } from "./providers.js";
import { state, persistConfig } from "./state.js";
import { renderModelSelect, renderSidebar } from "./ui.js";

// Wizard state, separate from the saved config until the user finishes.
let draft = null;

export function openSetup() {
  if (state.config) {
    draft = { ...state.config, models: state.config.models || [] };
    if (draft.models.length) {
      renderModels();
      showStep(3);
    } else {
      prepareKeyStep();
      showStep(2);
    }
  } else {
    draft = { provider: null, apiKey: "", baseUrl: "", model: "", models: [] };
    renderProviders();
    showStep(1);
  }
  $("modal").hidden = false;
}

function closeSetup() {
  // Only closable once a provider is configured; first run must complete setup.
  if (state.config) $("modal").hidden = true;
}

function showStep(n) {
  $("step1").hidden = n !== 1;
  $("step2").hidden = n !== 2;
  $("step3").hidden = n !== 3;
  $("setupTitle").textContent = ["", "Connect an AI provider", "Enter your API key", "Pick a model"][n];
  $("closeSetup").hidden = !state.config;
  $("setupError").hidden = true;
}

function renderProviders() {
  $("providers").replaceChildren(...PROVIDERS.map((p) =>
    el("button", { class: "provider", type: "button", onclick: () => pickProvider(p.id) },
      el("span", { class: "p-name" }, p.name),
      el("span", { class: "p-sub" }, p.sub))));
}

function pickProvider(id) {
  if (id !== draft.provider) {
    // Switching provider invalidates the key and model list from the previous one.
    draft.provider = id;
    draft.apiKey = "";
    draft.models = [];
    draft.model = "";
    draft.baseUrl = getProvider(id).base;
  }
  prepareKeyStep();
  showStep(2);
}

function prepareKeyStep() {
  const info = getProvider(draft.provider);
  $("step2Title").textContent = `${info.name} · ${info.sub}`;
  $("keyHelp").textContent = info.hint;
  $("apiKey").value = draft.apiKey || "";
  $("baseWrap").hidden = draft.provider !== "custom";
  $("baseUrl").value = draft.provider === "custom" ? draft.baseUrl || "" : "";
}

function showError(message) {
  $("setupError").textContent = message;
  $("setupError").hidden = false;
}

async function verifyKey() {
  const apiKey = $("apiKey").value.trim();
  const typedBase = $("baseUrl").value.trim().replace(/\/+$/, "");
  if (!apiKey) return showError("Paste your API key first.");
  if (draft.provider === "custom" && !typedBase) return showError("Enter the base URL for your endpoint.");

  draft.apiKey = apiKey;
  draft.baseUrl = draft.provider === "custom" ? typedBase : getProvider(draft.provider).base;

  const button = $("verify");
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    const models = await listModels(draft);
    if (!models.length) throw new Error("This key returned no chat models.");
    draft.models = models;
    if (!models.some((m) => m.id === draft.model)) draft.model = models[0].id;
    renderModels();
    showStep(3);
  } catch (err) {
    showError(friendlyError(err));
  } finally {
    button.disabled = false;
    button.textContent = "Load models";
  }
}

function renderModels() {
  $("modelList").replaceChildren(...draft.models.map((m) =>
    el("button", {
      class: "model-opt" + (m.id === draft.model ? " selected" : ""),
      type: "button",
      onclick: () => { draft.model = m.id; renderModels(); },
    }, m.label)));
  $("finish").disabled = !draft.model;
}

function finishSetup() {
  state.config = {
    provider: draft.provider,
    apiKey: draft.apiKey,
    baseUrl: draft.baseUrl,
    model: draft.model,
    models: draft.models,
  };
  persistConfig();
  $("modal").hidden = true;
  renderModelSelect();
  renderSidebar();
}

function removeKey() {
  state.config = null;
  persistConfig(); // stores null, which clears the saved key
  renderModelSelect();
  openSetup();
}

export function initSetup() {
  $("verify").addEventListener("click", verifyKey);
  $("apiKey").addEventListener("keydown", (e) => { if (e.key === "Enter") verifyKey(); });
  $("back1").addEventListener("click", () => { renderProviders(); showStep(1); });
  $("back2").addEventListener("click", () => { prepareKeyStep(); showStep(2); });
  $("finish").addEventListener("click", finishSetup);
  $("removeKey").addEventListener("click", removeKey);
  $("closeSetup").addEventListener("click", closeSetup);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeSetup(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSetup(); });
}
