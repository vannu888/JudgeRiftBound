import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, renderCardText, withSymbols } from "../public/markdown.js";

test("HTML in answers is escaped", () => {
  const html = renderMarkdown('Testo <script>alert(1)</script> e <img src=x onerror="y">');
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
});

test("headings, lists, quotes and emphasis render", () => {
  const html = renderMarkdown("## Verdetto\nSì, **puoi**.\n\n- uno\n- due\n\n1. primo\n\n> testo carta\n\n---");
  assert.match(html, /<h3>Verdetto<\/h3>/);
  assert.match(html, /<strong>puoi<\/strong>/);
  assert.match(html, /<ul><li>uno<\/li><li>due<\/li><\/ul>/);
  assert.match(html, /<ol><li>primo<\/li><\/ol>/);
  assert.match(html, /<blockquote>testo carta<\/blockquote>/);
  assert.match(html, /<hr>/);
});

test("game symbols become badges", () => {
  assert.match(withSymbols("+1 [Might]"), /sym-might/);
  assert.match(withSymbols("[2]"), /sym-num"[^>]*>2</);
  assert.match(withSymbols("[fury]"), /sym-dom[^>]*>Fury</);
  assert.match(withSymbols("[GANKING]"), /class="kw">Ganking</);
  assert.match(withSymbols("[ASSAULT 2]"), /class="kw">Assault 2</);
});

test("rule numbers in brackets are left alone", () => {
  assert.equal(withSymbols("[308.1.a]"), "[308.1.a]");
});

test("card text keeps line breaks and escapes HTML", () => {
  assert.equal(renderCardText("a\n\nb <c>"), "a<br>b &lt;c&gt;");
});
