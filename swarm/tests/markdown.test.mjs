import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, escapeHtml } from "../js/markdown.js";

test("escapes raw HTML so model output can't inject markup", () => {
  const html = renderMarkdown("hi <img src=x onerror=alert(1)> & friends");
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&amp; friends"));
});

test("bold, italic and inline code", () => {
  const html = renderMarkdown("**bold** and *soft* and `x<y`");
  assert.equal(html, "<p><strong>bold</strong> and <em>soft</em> and <code>x&lt;y</code></p>");
});

test("bullet and numbered lists", () => {
  assert.equal(renderMarkdown("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
  assert.equal(renderMarkdown("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
});

test("fenced code blocks keep content literal and include a copy button", () => {
  const html = renderMarkdown("```js\nconst a = '<b>';\n```");
  assert.ok(html.includes('<div class="code">'));
  assert.ok(html.includes("data-copy"));
  assert.ok(html.includes("const a = &#39;&lt;b&gt;&#39;;"));
});

test("unclosed code fence (mid-stream) still renders", () => {
  const html = renderMarkdown("here:\n```py\nprint(1)");
  assert.ok(html.includes("print(1)"));
  assert.ok(html.includes("<pre><code>"));
});

test("headings and paragraphs", () => {
  assert.equal(renderMarkdown("## Title"), "<h3>Title</h3>");
  assert.equal(renderMarkdown("a\n\nb"), "<p>a</p><p>b</p>");
});

test("empty and nullish input", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
  assert.equal(escapeHtml(42), "42");
});
