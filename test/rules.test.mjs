import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compactRules, resolveRule, getRule, searchRules, RULE_COUNT } from "../src/rules.js";

const words = (s) => s.replace(/[\u200b-\u200d\ufeff]/g, "").split(/\s+/).filter(Boolean).join(" ");

test("compactRules removes the PDF layout without losing words", () => {
  const layout = [
    "135.4.a.                The presence of text, rules, Keywords, and other effects can still be",
    "                        referenced by other game effects.",
    "                  See rule 716. Attachment for more information.",
    "461.4                 The following Task becomes Outstanding:",
    "\u200b",
    "Examples:",
    "A unit with 3 or less Might is no longer a legal target",
    "",
    "Something that's exhausted is no longer a legal target.",
  ].join("\n");
  const out = compactRules(layout);
  assert.equal(words(out), words(layout));
  assert.deepEqual(out.trimEnd().split("\n"), [
    "135.4.a. The presence of text, rules, Keywords, and other effects can still be referenced by other game effects.",
    "See rule 716. Attachment for more information.",
    "461.4 The following Task becomes Outstanding:",
    "Examples: A unit with 3 or less Might is no longer a legal target",
    "",
    "Something that's exhausted is no longer a legal target.",
  ]);
});

test("the shipped rules file is already compact and compaction is idempotent", () => {
  const rules = fs.readFileSync(new URL("../data/riftbound-core-rules.txt", import.meta.url), "utf8");
  assert.equal(compactRules(rules), rules);
  assert.match(rules, /^002\. Card text supersedes rules text\./m);
});

test("all numbered rules are indexed", () => {
  assert.ok(RULE_COUNT > 2000, `only ${RULE_COUNT} rules`);
});

test("rule numbers and glossary terms resolve", () => {
  assert.equal(resolveRule("309.1.a"), "309.1.a");
  assert.equal(resolveRule(" 309.1.A. "), "309.1.a");
  assert.equal(resolveRule("Deflect"), "809");
  assert.equal(resolveRule("Assault 2"), "807"); // keyword with a value
  assert.equal(resolveRule("Quick-Draw"), "819");
  assert.equal(resolveRule("Showdown"), "341"); // plural heading "Showdowns"
  assert.equal(resolveRule("999.9"), null);
  assert.equal(resolveRule("not a rule"), null);
});

test("a rule comes with its context and sub-rules", () => {
  const rule = getRule("309.1.a");
  assert.equal(rule.id, "309.1.a");
  assert.match(rule.text, /Reaction/);
  assert.deepEqual(rule.parents.map((p) => p.id), ["307", "309", "309.1"]); // section heading first
  assert.equal(rule.parents[0].text, "States of the Turn");

  const deflect = getRule("Deflect");
  assert.equal(deflect.id, "809");
  assert.ok(deflect.children.length > 3);
  assert.ok(deflect.children.every((c) => c.id.startsWith("809.") && c.depth >= 1));

  // A section heading owns the rules that follow it ("341. Showdowns" -> 342, 343…).
  const showdowns = getRule("Showdown");
  assert.equal(showdowns.id, "341");
  assert.ok(showdowns.children.some((c) => c.id === "342"));
  assert.deepEqual(getRule("343").parents.map((p) => p.id), ["341"]);

  const big = getRule("341", 5);
  assert.equal(big.children.length, 5);
  assert.equal(big.truncated, true);
  assert.equal(getRule("999.9"), null);
});

test("rules search finds text and puts a direct hit first", () => {
  const res = searchRules("chain resolves");
  assert.ok(res.total > 0);
  assert.equal(res.rules[0].id, "340.1");
  assert.equal(searchRules("309.1.a").rules[0].id, "309.1.a");
  assert.equal(searchRules("").total, 0);
});
