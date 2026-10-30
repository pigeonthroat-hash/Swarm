// A small, safe markdown renderer for chat replies.
// All user/model text is HTML-escaped before any markup is added, so model output
// can't inject scripts. Supports: paragraphs, **bold**, *italic*, `code`,
// fenced code blocks, bullet and numbered lists, and ### headings.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESC[c]);
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1<em>$2</em>");
  return out;
}

function textBlocks(text) {
  return text
    .split(/\n{2,}/)
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split("\n");

      if (lines.every((l) => /^\s*[-*] /.test(l))) {
        return "<ul>" + lines.map((l) => "<li>" + inline(l.replace(/^\s*[-*] /, "")) + "</li>").join("") + "</ul>";
      }
      if (lines.every((l) => /^\s*\d+\. /.test(l))) {
        return "<ol>" + lines.map((l) => "<li>" + inline(l.replace(/^\s*\d+\. /, "")) + "</li>").join("") + "</ol>";
      }
      const heading = block.match(/^(#{1,3}) (.+)$/);
      if (heading && lines.length === 1) {
        return "<h3>" + inline(heading[2]) + "</h3>";
      }
      return "<p>" + lines.map(inline).join("<br>") + "</p>";
    })
    .join("");
}

function codeBlock(lang, code) {
  return (
    '<div class="code"><div class="code-head"><span>' + escapeHtml(lang || "text") +
    '</span><button class="copy" type="button" data-copy>Copy</button></div><pre><code>' +
    escapeHtml(code.replace(/\n$/, "")) +
    "</code></pre></div>"
  );
}

export function renderMarkdown(source) {
  const src = String(source ?? "");
  const fence = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
  let html = "";
  let last = 0;
  let match;
  while ((match = fence.exec(src)) !== null) {
    html += textBlocks(src.slice(last, match.index));
    html += codeBlock(match[1], match[2]);
    last = fence.lastIndex;
    if (match[0].length === 0) break; // guard against zero-length matches
  }
  return html + textBlocks(src.slice(last));
}
