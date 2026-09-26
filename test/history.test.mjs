import test from "node:test";
import assert from "node:assert/strict";
import { verdictOf } from "../public/history.js";

const session = (answer) => ({ messages: [{ role: "user", content: "?" }, { role: "assistant", content: answer }] });

test("the history shows the latest verdict in plain text", () => {
  const answer = "### Verdetto\nSì: puoi rispondere con una **Reaction** (309.1.a).\n\n### Perché\nPerché sì.";
  assert.equal(verdictOf(session(answer)), "Sì: puoi rispondere con una Reaction (309.1.a).");
  assert.equal(verdictOf(session("**Verdetto:** No, non puoi.\n**Perché:** …")), "No, non puoi.");
});

test("without a verdict heading the answer's opening is used, shortened", () => {
  assert.equal(verdictOf(session("Dipende dal turno.")), "Dipende dal turno.");
  const long = verdictOf(session("a ".repeat(200)));
  assert.ok(long.length <= 140 && long.endsWith("…"));
  assert.equal(verdictOf({ messages: [{ role: "user", content: "?" }] }), "");
});
