// End-to-end check in a real browser. Provider API calls are intercepted and answered
// with canned responses, so no real key or network is needed.
//
// Usage: node tests/e2e/run.cjs [baseUrl]   (serve the repo first, e.g. `npm start`)
// Env:   CHROME_PATH, PUPPETEER_MODULE (defaults below) if your install differs.

const path = require("path");
const fs = require("fs");

const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const CHROME = process.env.CHROME_PATH ||
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PUPPETEER = process.env.PUPPETEER_MODULE ||
  "/home/claude/.npm-global/lib/node_modules/puppeteer-core";
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "shots");

const puppeteer = require(PUPPETEER);
fs.mkdirSync(SHOTS, { recursive: true });

const sseBody = (chunks) =>
  chunks.map((t) =>
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: t } })}\n\n`
  ).join("") + "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server", "--proxy-bypass-list=*"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 820 });

  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  // Mock the Anthropic API.
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith("data:")) return req.continue();
    if (req.method() === "OPTIONS") {
      // CORS preflight for the browser-to-provider calls.
      return req.respond({ status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      } });
    }
    if (url.includes("api.anthropic.com/v1/models")) {
      return req.respond({ status: 200, contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ data: [
          { id: "claude-sonnet-test", display_name: "Claude Sonnet (test)" },
          { id: "claude-haiku-test", display_name: "Claude Haiku (test)" },
        ] }) });
    }
    if (url.includes("api.anthropic.com/v1/messages")) {
      return req.respond({ status: 200, contentType: "text/event-stream",
        headers: { "access-control-allow-origin": "*" },
        body: sseBody(["Hello", " from the **mock** model.\n\n```js\nconsole.log('hi')\n```"]) });
    }
    return req.abort();
  });

  const fail = (msg) => { throw new Error(msg); };
  const visible = (sel) => page.$eval(sel, (n) => !n.hidden && getComputedStyle(n).display !== "none").catch(() => false);

  try {
    // 1. First visit shows the setup wizard, not the chat.
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await page.evaluateOnNewDocument(() => {}); // no-op, keeps API symmetric
    if (!(await visible("#modal"))) fail("setup wizard should open on first visit");
    if (!(await visible("#step1"))) fail("provider step should be shown first");
    await page.screenshot({ path: path.join(SHOTS, "1-setup-providers.png") });

    // 2. Pick Anthropic, enter key, load models.
    await page.click("#providers .provider:nth-child(1)");
    await page.waitForSelector("#step2:not([hidden])");
    await page.type("#apiKey", "sk-ant-test-123");
    await page.click("#verify");
    await page.waitForSelector("#step3:not([hidden]) .model-opt");
    const models = await page.$$eval("#modelList .model-opt", (b) => b.map((x) => x.textContent));
    if (models.join("|") !== "Claude Sonnet (test)|Claude Haiku (test)") fail("unexpected model list: " + models);
    await page.screenshot({ path: path.join(SHOTS, "2-setup-models.png") });

    // 3. Choose the second model and finish.
    await page.click("#modelList .model-opt:nth-child(2)");
    await page.click("#finish");
    await page.waitForFunction(() => document.getElementById("modal").hidden);
    const selected = await page.$eval("#modelSelect", (s) => s.value);
    if (selected !== "claude-haiku-test") fail("model picker should reflect the chosen model, got " + selected);

    // 4. Send a message and watch the streamed reply.
    await page.click("#chips .chip:nth-child(1)");
    await page.waitForFunction(() => document.querySelector(".row.assistant .prose strong")?.textContent === "mock",
      { timeout: 8000 });
    const reply = await page.$eval(".row.assistant .prose", (p) => p.textContent);
    if (!reply.includes("Hello from the mock model.")) fail("reply text missing: " + reply);
    if (!(await page.$(".code .copy"))) fail("code block with copy button not rendered");
    await page.waitForFunction(() => !document.querySelector(".caret"), { timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, "3-chat.png") });

    // 5. Config and chat history are persisted; reload restores the conversation.
    const stored = await page.evaluate(() => ({
      config: JSON.parse(localStorage.getItem("swarm.config.v1")),
      chats: JSON.parse(localStorage.getItem("swarm.chats.v1")),
    }));
    if (stored.config.apiKey !== "sk-ant-test-123") fail("key not saved");
    if (stored.chats.length !== 1 || stored.chats[0].messages.length !== 2) fail("chat not saved");
    await page.reload({ waitUntil: "networkidle0" });
    if (await visible("#modal")) fail("setup should not reappear after configuration");
    const restored = await page.$$eval(".row.assistant", (r) => r.length);
    if (restored !== 1) fail("conversation not restored after reload");
    await page.waitForSelector("#history .hist-item");

    // 6. Errors: a bad key is reported and the text is handed back to the input.
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem("swarm.config.v1"));
      c.apiKey = "bad";
      localStorage.setItem("swarm.config.v1", JSON.stringify(c));
    });
    await page.reload({ waitUntil: "networkidle0" });
    await page.setRequestInterception(true);
    await page.click("#newChat");
    await page.type("#input", "this will fail");
    await page.evaluate(() => {}); // flush
    // Make the next messages call fail with 401 for this step only.
    page.removeAllListeners("request");
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith(BASE) || url.startsWith("data:")) return req.continue();
      return req.respond({ status: 401, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: { message: "invalid x-api-key" } }) });
    });
    await page.click("#send");
    await page.waitForFunction(() => !document.getElementById("notice").hidden, { timeout: 5000 });
    const notice = await page.$eval("#notice", (n) => n.textContent);
    if (!notice.includes("rejected this key")) fail("friendly error missing: " + notice);
    const inputBack = await page.$eval("#input", (i) => i.value);
    if (inputBack !== "this will fail") fail("failed message should be restored to the input");

    // 7. Mobile: sidebar is a drawer that opens on demand.
    await page.setViewport({ width: 390, height: 800 });
    await page.reload({ waitUntil: "networkidle0" });
    const sideVisible = await page.$eval(".sidebar", (s) => s.getBoundingClientRect().right > 0);
    if (sideVisible) fail("sidebar should start hidden on small screens");
    await page.screenshot({ path: path.join(SHOTS, "4-mobile.png") });

    // The 401 in step 6 is deliberate; only real exceptions and other console errors count.
    const unexpected = errors.filter((e) => !e.includes("Failed to load resource"));
    if (unexpected.length) fail("browser errors:\n  " + unexpected.join("\n  "));
    console.log("E2E PASSED: setup, models, streaming, persistence, errors, mobile drawer");
  } catch (err) {
    console.error("E2E FAILED:", err.message);
    if (errors.length) console.error("browser errors so far:\n  " + errors.join("\n  "));
    await page.screenshot({ path: path.join(SHOTS, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
