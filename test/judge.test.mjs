import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compactRules, sanitizeMessages, buildContents } from "../src/judge.js";

const words = (s) => s.replace(/[​-‍﻿]/g, "").split(/\s+/).filter(Boolean).join(" ");

test("compactRules removes the PDF layout without losing words", () => {
  const layout = [
    "135.4.a.                The presence of text, rules, Keywords, and other effects can still be",
    "                        referenced by other game effects.",
    "                  See rule 716. Attachment for more information.",
    "461.4                 The following Task becomes Outstanding:",
    "​",
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

test("messages are sanitized and cards go into the latest question", () => {
  const messages = sanitizeMessages([
    { role: "assistant", content: "orphan answer" },
    { role: "user", content: "  prima domanda  " },
    { role: "system", content: "ignored" },
    { role: "assistant", content: "risposta" },
    { role: "user", content: "seconda domanda" },
  ]);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(messages[0].content, "prima domanda");

  const contents = buildContents(messages, [{ name: "Falling Comet", type: "Spell", text: "Deal 6." }]);
  assert.deepEqual(contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(contents[0].parts.length, 1);
  assert.match(contents[2].parts[0].text, /Falling Comet/);
  assert.equal(contents[2].parts[1].text, "Domanda del giocatore:\nseconda domanda");
});
