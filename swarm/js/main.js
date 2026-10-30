// Entry point. Wires the DOM to the modules and starts the app.

import { $ } from "./dom.js";
import { state, persistConfig } from "./state.js";
import {
  renderAll, renderModelSelect, renderSuggestions, setSidebarHandlers,
  toggleSidebar, handleCopyClick, autosize,
} from "./ui.js";
import { sendMessage, stopReply, selectChat, newChat, deleteChat, isBusy } from "./chat.js";
import { openSetup, initSetup } from "./setup.js";

const SUGGESTIONS = [
  "Explain how a neural network learns",
  "Draft a polite email declining a meeting",
  "Plan a 3-day trip to Kyoto",
  "Help me debug a JavaScript promise",
];

function boot() {
  initSetup();
  setSidebarHandlers({ onSelect: selectChat, onDelete: deleteChat });

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (isBusy()) return stopReply();
    sendMessage($("input").value);
  });
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("input").addEventListener("input", autosize);

  $("thread").addEventListener("click", handleCopyClick);
  $("newChat").addEventListener("click", newChat);
  $("openSettings").addEventListener("click", openSetup);
  $("toggleSide").addEventListener("click", toggleSidebar);
  $("modelSelect").addEventListener("change", (e) => {
    if (!state.config) return;
    state.config.model = e.target.value;
    persistConfig();
  });

  renderSuggestions(SUGGESTIONS, sendMessage);
  renderModelSelect();
  renderAll();
  if (!state.config) openSetup();
}

boot();
