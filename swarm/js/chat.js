// Conversation logic: send a message, stream the reply, handle stop and errors.

import { $ } from "./dom.js";
import { streamChat, friendlyError } from "./providers.js";
import { state, activeChat, newId, persistChats } from "./state.js";
import {
  renderAll, addPendingReply, updateStreamingReply, scrollToEnd,
  showNotice, setBusy, autosize, closeSidebarOnSmallScreens,
} from "./ui.js";
import { openSetup } from "./setup.js";

const SYSTEM_PROMPT = "You are Swarm, a helpful, clear assistant. Use Markdown when it helps.";

export const isBusy = () => state.controller !== null;

/** Stops the reply currently streaming, if any. */
export function stopReply() {
  state.controller?.abort();
}

export async function sendMessage(raw) {
  const text = raw.trim();
  if (!text || isBusy()) return;
  if (!state.config) return openSetup();

  let chat = activeChat();
  if (!chat) {
    chat = { id: newId(), title: text.slice(0, 60), messages: [], updated: Date.now() };
    state.chats.unshift(chat);
    state.activeId = chat.id;
  }
  chat.messages.push({ role: "user", content: text });
  chat.updated = Date.now();
  persistChats();
  $("input").value = "";
  autosize();
  renderAll();

  const reply = addPendingReply();
  scrollToEnd(true);
  state.controller = new AbortController();
  setBusy(true);

  let acc = "";
  try {
    for await (const delta of streamChat(state.config, chat.messages, SYSTEM_PROMPT, state.controller.signal)) {
      acc += delta;
      updateStreamingReply(reply, acc);
      scrollToEnd();
    }
    if (!acc) throw new Error("The model returned an empty response.");
    chat.messages.push({ role: "assistant", content: acc });
  } catch (err) {
    if (err.name === "AbortError") {
      // The user pressed stop: keep whatever text arrived.
      if (acc) chat.messages.push({ role: "assistant", content: acc });
    } else {
      // Real failure: undo the user turn so the history stays valid, and give the text back.
      chat.messages.pop();
      if (!chat.messages.length) {
        state.chats = state.chats.filter((c) => c.id !== chat.id);
        state.activeId = null;
      }
      $("input").value = text;
      autosize();
      showNotice(friendlyError(err));
    }
  } finally {
    state.controller = null;
    setBusy(false);
    persistChats();
    renderAll();
    $("input").focus();
  }
}

export function selectChat(id) {
  if (isBusy()) return;
  state.activeId = id;
  renderAll();
  closeSidebarOnSmallScreens();
}

export function newChat() {
  if (isBusy()) return;
  state.activeId = null;
  renderAll();
  $("input").focus();
  closeSidebarOnSmallScreens();
}

export function deleteChat(id) {
  if (isBusy() && id === state.activeId) return;
  state.chats = state.chats.filter((c) => c.id !== id);
  if (state.activeId === id) state.activeId = null;
  persistChats();
  renderAll();
}
