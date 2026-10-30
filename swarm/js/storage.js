// Everything persists in this browser's localStorage. Nothing is sent to a server.

const CONFIG_KEY = "swarm.config.v1"; // { provider, apiKey, baseUrl, model, models }
const CHATS_KEY = "swarm.chats.v1";   // [{ id, title, messages: [{ role, content }], updated }]

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getConfig: () => read(CONFIG_KEY, null),
  setConfig: (config) => write(CONFIG_KEY, config),
  getChats: () => read(CHATS_KEY, []),
  setChats: (chats) => write(CHATS_KEY, chats),
};
