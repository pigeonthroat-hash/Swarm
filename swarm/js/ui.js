// Rendering only. Holds no business logic; chat.js and setup.js decide what happens.

import { $, el } from "./dom.js";
import { renderMarkdown } from "./markdown.js";
import { state, activeChat } from "./state.js";

let handlers = { onSelect: () => {}, onDelete: () => {} };

export function setSidebarHandlers(h) {
  handlers = { ...handlers, ...h };
}

export function renderAll() {
  renderSidebar();
  renderThread();
}

/* ---------- sidebar and model picker ---------- */

export function renderSidebar() {
  $("history").replaceChildren(...state.chats.map((chat) =>
    el("div", {
      class: "hist-item" + (chat.id === state.activeId ? " active" : ""),
      onclick: () => handlers.onSelect(chat.id),
    },
      el("span", { class: "hist-title" }, chat.title || "New chat"),
      el("button", {
        class: "hist-del",
        type: "button",
        title: "Delete chat",
        "aria-label": "Delete chat",
        onclick: (e) => { e.stopPropagation(); handlers.onDelete(chat.id); },
      }, "✕"))));
}

export function renderModelSelect() {
  const select = $("modelSelect");
  if (!state.config) {
    select.replaceChildren(el("option", { value: "" }, "Set up a provider"));
    select.disabled = true;
    return;
  }
  const models = state.config.models?.length
    ? state.config.models
    : [{ id: state.config.model, label: state.config.model }];
  select.disabled = false;
  select.replaceChildren(...models.map((m) =>
    el("option", { value: m.id, selected: m.id === state.config.model }, m.label)));
}

/* ---------- thread ---------- */

export function renderThread() {
  const chat = activeChat();
  const thread = $("thread");
  thread.replaceChildren();

  const hasMessages = Boolean(chat && chat.messages.length);
  $("empty").hidden = hasMessages;
  thread.hidden = !hasMessages;
  if (!hasMessages) return;

  for (const message of chat.messages) thread.append(messageNode(message));
  scrollToEnd(true);
}

function messageNode(message) {
  if (message.role === "user") {
    return el("div", { class: "row user" }, el("div", { class: "bubble" }, message.content));
  }
  const prose = el("div", { class: "prose" });
  prose.innerHTML = renderMarkdown(message.content);
  return el("div", { class: "row assistant" }, prose);
}

/** Adds an empty assistant bubble while a reply is streaming; returns its text container. */
export function addPendingReply() {
  const prose = el("div", { class: "prose" }, el("span", { class: "caret" }));
  $("thread").append(el("div", { class: "row assistant" }, prose));
  return prose;
}

export function updateStreamingReply(prose, text) {
  prose.innerHTML = renderMarkdown(text);
  prose.append(el("span", { class: "caret" }));
}

export function scrollToEnd(force = false) {
  const scroll = $("scroll");
  const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
  if (force || nearBottom) scroll.scrollTop = scroll.scrollHeight;
}

/* ---------- composer ---------- */

export function showNotice(message) {
  const box = $("notice");
  box.textContent = message;
  box.hidden = !message;
  if (message) {
    setTimeout(() => { if (box.textContent === message) box.hidden = true; }, 8000);
  }
}

export function setBusy(busy) {
  const button = $("send");
  button.textContent = busy ? "■" : "↑";
  button.setAttribute("aria-label", busy ? "Stop" : "Send");
}

export function autosize() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}

export function renderSuggestions(suggestions, onPick) {
  $("chips").replaceChildren(...suggestions.map((text) =>
    el("button", { class: "chip", type: "button", onclick: () => onPick(text) }, text)));
}

/* ---------- misc ---------- */

export function toggleSidebar() {
  const app = $("app");
  if (matchMedia("(max-width: 820px)").matches) app.classList.toggle("side-open");
  else app.classList.toggle("collapsed");
}

export function closeSidebarOnSmallScreens() {
  if (matchMedia("(max-width: 820px)").matches) $("app").classList.remove("side-open");
}

/** Handles "Copy" clicks on code blocks inside the thread. */
export function handleCopyClick(event) {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const code = button.closest(".code").querySelector("code").textContent;
  navigator.clipboard?.writeText(code).catch(() => {});
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = "Copy"; }, 1500);
}
