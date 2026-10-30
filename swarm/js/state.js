// The single source of truth for the running app. Modules read and mutate this object,
// then call the persist helpers to save it.

import { storage } from "./storage.js";

export const state = {
  config: storage.getConfig(),  // null until a provider is set up
  chats: storage.getChats(),    // newest first
  activeId: null,               // id of the open chat, or null for a fresh one
  controller: null,             // AbortController while a reply is streaming
};

state.chats.sort((a, b) => b.updated - a.updated);
if (state.chats.length) state.activeId = state.chats[0].id;

export const activeChat = () => state.chats.find((c) => c.id === state.activeId) ?? null;

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const persistChats = () => storage.setChats(state.chats);

export const persistConfig = () => storage.setConfig(state.config);
