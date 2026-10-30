// Small DOM helpers. Text always goes in as text nodes, never as HTML.

export const $ = (id) => document.getElementById(id);

/**
 * el("button", { class: "x", onclick: fn, disabled: true }, "Label", childNode)
 * - attrs with a false/null value are skipped; `true` becomes a bare attribute
 * - keys starting with "on" become event listeners
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}
