import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, renderCardText, withSymbols, withRuleRefs } from "../public/markdown.js";

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
  assert.match(withSymbols("[GANKING]"), /class="kw" data-kw="GANKING"[^>]*>Ganking</);
  assert.match(withSymbols("[ASSAULT 2]"), /class="kw" data-kw="ASSAULT 2"[^>]*>Assault 2</);
});

test("rule numbers in brackets are left alone", () => {
  assert.equal(withSymbols("[308.1.a]"), "[308.1.a]");
});

test("card text keeps line breaks and escapes HTML", () => {
  assert.equal(renderCardText("a\n\nb <c>"), "a<br>b &lt;c&gt;");
});

test("rule citations become buttons, other numbers stay text", () => {
  const refs = (s) => [...withRuleRefs(s).matchAll(/data-rule="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(refs("Closed State (309.1) e Reaction (308.1.a, 309.1.a)."), ["309.1", "308.1.a", "309.1.a"]);
  assert.deepEqual(refs("la regola 340 e (154, 155) e **466**"), ["340", "154", "155", "466"]);
  assert.deepEqual(refs("prima 340.1, poi 309.1.a."), ["340.1", "309.1.a"]);
  assert.deepEqual(refs("100 carte, 250.000 token, anno 2026, 6.5 punti, 3 carte, 100 punti"), []);
  assert.match(renderMarkdown("Vedi (340.1)."), /<a class="rule-ref" href="#regola-340.1" data-rule="340.1"/);
});

test("answers are split into sections: verdict, why, rules", () => {
  const html = renderMarkdown("### Verdetto\nSì.\n\n### Perché\nMotivo.\n\n### Regole\n- 466 — Winning Point\n- 340.1: chain");
  assert.match(html, /^<section class="sec sec-verdict"><h3>Verdetto<\/h3><p>Sì\.<\/p><\/section>/);
  assert.match(html, /<section class="sec sec-why"><h3>Perché<\/h3>/);
  // In the rules list a leading bare number is a citation too.
  assert.match(html, /<section class="sec sec-rules">[\s\S]*<li><a class="rule-ref" [^>]*data-rule="466"/);
  assert.match(html, /<\/section>$/);
  // A bold lead-in works like a heading; other bold text does not.
  const bold = renderMarkdown("**Verdetto:** No, non puoi.\n\nTesto **normale**.");
  assert.match(bold, /^<section class="sec sec-verdict"><h3>Verdetto<\/h3><p>No, non puoi\.<\/p>/);
  assert.match(bold, /Testo <strong>normale<\/strong>/);
  assert.equal(renderMarkdown("Solo testo."), "<p>Solo testo.</p>");
});
