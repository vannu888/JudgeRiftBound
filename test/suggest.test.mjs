import test from "node:test";
import assert from "node:assert/strict";
import { CARD_NAMES } from "../src/cards.js";
import { buildEntries, suggest, fragmentAt } from "../public/suggest.js";

const entries = buildEntries(CARD_NAMES);
const names = (list) => list.map((c) => c.name);
const at = (text) => fragmentAt(entries, text, text.length);

test("each word typed narrows the suggestions", () => {
  const one = names(suggest(entries, "Fall", 50));
  assert.ok(one.includes("Falling Comet"));
  const two = names(suggest(entries, "Falling Co", 50));
  assert.deepEqual(two, ["Falling Comet"]);
  assert.ok(one.length > two.length);
  // Every word may be abbreviated; the first word matched exactly ranks first.
  assert.deepEqual(names(suggest(entries, "vi d")), ["Vi, Destructive"]);
  assert.equal(names(suggest(entries, "Jinx"))[0].startsWith("Jinx"), true);
});

test("other spellings and legend titles lead to the card's real name", () => {
  assert.deepEqual(names(suggest(entries, "Stagaz")), ["Stargazer"]);
  assert.ok(names(suggest(entries, "Heart of the Temp")).includes("Kennen, Heart of the Tempest"));
});

test("the name being typed is found inside an Italian sentence", () => {
  const found = at("L'avversario gioca Falling Co");
  assert.equal(found.start, "L'avversario gioca ".length);
  assert.deepEqual(names(found.found), ["Falling Comet"]);
  assert.deepEqual(names(at("il mio Vi, D").found), ["Vi, Destructive"]);
  // Ordinary short Italian words, a finished word, or a new sentence suggest nothing.
  assert.equal(at("posso rispondere con"), null);
  assert.equal(at("Falling Comet "), null);
  assert.equal(at("vi dico"), null);
  assert.deepEqual(names(at("Chiedo. Falling Com").found), ["Falling Comet"]);
  // Not in the middle of a word.
  assert.equal(fragmentAt(entries, "Falling Comet", 4), null);
});
