import test from "node:test";
import assert from "node:assert/strict";
import {
  CARDS,
  normalize,
  matchText,
  findCardsInConversation,
  searchCards,
  formatCard,
  formatCardsBlock,
} from "../src/cards.js";

const byId = new Map(CARDS.map((c) => [c.id, c]));
const names = (text) => matchText(text).map((id) => byId.get(id).name);
const card = (name) => CARDS.find((c) => c.name === name);

test("the card database is loaded", () => {
  assert.ok(CARDS.length > 500, `only ${CARDS.length} cards`);
  assert.ok(card("Vi, Destructive"));
});

test("normalize strips case, accents, apostrophes and punctuation", () => {
  assert.equal(normalize("Kai'Sa, Survivor"), "kaisa survivor");
  assert.equal(normalize("Dr. Mundo"), "dr mundo");
  assert.equal(normalize("Città!"), "citta");
});

test("a full card name matches only that card", () => {
  assert.deepEqual(names("Vi, Destructive attacca il battlefield"), ["Vi, Destructive"]);
});

test("a champion name matches all of that champion's cards", () => {
  const found = names("Il mio Vi attacca");
  assert.ok(found.length > 1);
  assert.ok(found.every((n) => n.startsWith("Vi, ")));
});

test("the Italian word 'vi' is not mistaken for the champion Vi", () => {
  assert.deepEqual(names("e poi vi chiedo come si risolve"), []);
  assert.deepEqual(names("Vi spiego la situazione: ho una spell"), []);
  assert.deepEqual(names("Situazione:\nVi dico cosa succede"), []);
});

test("a name inside a longer name is not matched separately", () => {
  assert.deepEqual(names("Ho una Mega-Mech in campo"), ["Mega-Mech"]);
});

test("apostrophes are optional and each card appears once", () => {
  assert.ok(names("gioco Kaisa").every((n) => n.startsWith("Kai'Sa, ")));
  const jinx = names("Jinx, Rebel attacca e poi Jinx usa la leggenda");
  assert.equal(jinx[0], "Jinx, Rebel");
  assert.equal(new Set(jinx).size, jinx.length);
});

test("keywords are not cards", () => {
  assert.deepEqual(names("come funziona Deflect?"), []);
});

test("the latest question has priority and the limit is respected", () => {
  const conv = [
    { role: "user", content: "Ho Ahri in campo" },
    { role: "assistant", content: "Va bene." },
    { role: "user", content: "e se lui gioca Falling Comet?" },
  ];
  const found = findCardsInConversation(conv);
  assert.equal(found[0].name, "Falling Comet");
  assert.ok(found.some((c) => c.name.startsWith("Ahri, ")));
  assert.equal(findCardsInConversation(conv, 2).length, 2);
});

test("search ranks exact names first and applies filters", () => {
  assert.equal(searchCards({ q: "falling comet" }).cards[0].name, "Falling Comet");
  const fury = searchCards({ domain: "Fury", type: "Spell", limit: 500 });
  assert.ok(fury.total > 0);
  assert.ok(fury.cards.every((c) => c.type === "Spell" && c.domains.includes("Fury")));
  assert.equal(searchCards({ q: "zzzz-no-such-card" }).total, 0);
});

test("formatCard shows the rules-relevant facts", () => {
  const vi = formatCard(card("Vi, Destructive"));
  assert.match(vi, /Unit \(Champion\)/);
  assert.match(vi, /Cost: 2 Energy \+ 1 Power/);
  assert.match(vi, /Might: 3/);
  assert.match(vi, /Text: \[GANKING\]/);

  const banned = CARDS.find((c) => c.bannedFrom);
  assert.match(formatCard(banned), /BANNED since \d{4}-\d{2}-\d{2}/);

  const battlefield = CARDS.find((c) => c.type === "Battlefield");
  assert.doesNotMatch(formatCard(battlefield), /Cost:|Might:/);
});

test("the cards block is clearly delimited", () => {
  const block = formatCardsBlock([card("Falling Comet")]);
  assert.match(block, /^\[CARTE CITATE/);
  assert.match(block, /• Falling Comet/);
  assert.match(block, /\[FINE CARTE\]$/);
});
