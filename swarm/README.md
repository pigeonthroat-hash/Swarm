# Swarm

A chat app for your own AI provider API key. It's a static web app: no backend, no build step, no account.
Pick Anthropic, OpenAI, xAI (Grok), Google (Gemini), or any OpenAI-compatible endpoint, paste your key, choose a model, and chat.

Live on GitHub Pages once enabled (see below).

## Features

- First-run setup wizard: provider → API key → model picked from the provider's own list
- Streaming replies, Markdown, code blocks with a copy button
- Chat history in the sidebar, stop button, retry-friendly error handling
- Model picker in the top bar; settings to change provider or key
- Light and dark themes (follows your OS), responsive layout with a mobile drawer

## Privacy

Your API key and conversations are stored in this browser's `localStorage` only.
Requests go straight from your browser to the provider you chose. Nothing passes through
a server operated by this project.

Anyone who can use this browser profile can read the saved key. Don't use the app on a
shared computer, and use a key with a spending limit.

## Run locally

Module scripts don't load from `file://`, so serve the folder:

```bash
npm start                      # http://127.0.0.1:8080
# or: python3 -m http.server 8080
```

## Deploy to GitHub Pages

1. Push this repository to GitHub (the `main` branch).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Open the URL GitHub shows. It can take a minute on the first deploy.

`.nojekyll` tells Pages to serve the files as they are. Without it, Pages would run them through Jekyll.

## Providers and browser access

Calls come straight from the browser, so each provider has to allow browser requests (CORS):

| Provider | Browser access |
|---|---|
| Anthropic | Yes, with the `anthropic-dangerous-direct-browser-access` header |
| OpenAI | Yes |
| Google Gemini | Yes |
| xAI (Grok) | Depends on their current policy. If it's blocked, the app says so. |
| Custom | Only if your server sends CORS headers |

## Project structure

```
index.html          app shell: markup only
css/app.css         all styles, themed with CSS variables
js/
  main.js           entry point: wires events, boots the app
  state.js          shared app state and persistence helpers
  storage.js        localStorage read/write
  providers.js      AI provider adapters (model listing, streaming, errors)
  markdown.js       safe Markdown renderer (escapes HTML first)
  chat.js           sending, streaming, stop, chat selection
  setup.js          the setup wizard
  ui.js             rendering: sidebar, thread, composer, notices
  dom.js            small DOM helpers
tests/
  *.test.mjs        unit tests for markdown and providers (node:test)
  e2e/run.cjs       browser test with mocked provider APIs (puppeteer-core)
package.json        scripts: start, test, e2e
.nojekyll           keeps GitHub Pages from running Jekyll
```

## Tests

```bash
npm test               # unit tests, no browser needed
npm run e2e            # full run in headless Chrome (server must be running)
```

`npm run e2e` expects `puppeteer-core` and a Chrome build. Set `CHROME_PATH` and
`PUPPETEER_MODULE` if they're somewhere other than the defaults in `tests/e2e/run.cjs`.
The e2e test intercepts provider calls, so it never uses a real key.

## Adding a provider

Add an entry to `PROVIDERS` in `js/providers.js` and an adapter with `list` and `stream` functions.
If the provider speaks the OpenAI chat completions format, reuse the existing OpenAI adapter with a different base URL.

## History

This repository used to contain a Python agent framework and a local server. Those were
removed to keep the project a plain web app. They're still in the git history
(commit `09cbf62` and the commits after it) if you want them back.

## License

See [LICENSE](LICENSE).
