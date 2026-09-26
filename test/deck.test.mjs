import test from "node:test";
import assert from "node:assert/strict";
import { DECK_CARDS } from "../src/cards.js";
import {
  buildCatalog, newDeck, addCard, setCount, deckStats, deckProblems, exportDeck, importDeck, restoreDecks,
  fitsIdentity, canBeChampion, copiesOf, clearChampion, makeChampion, removeBattlefield, MAIN_MIN,
} from "../public/deck-model.js";

const catalog = buildCatalog(DECK_CARDS);
const card = (name) => catalog.byName.get(name);
const JINX = "Jinx, Loose Cannon";

/** A legal Jinx deck built from the real card database. */
function jinxDeck() {
  let deck = addCard(newDeck("Jinx"), card(JINX), catalog).deck;
  deck = addCard(deck, card("Jinx, Rebel"), catalog).deck;
  const fillers = catalog.cards
    .filter((c) => ["Unit", "Spell", "Gear"].includes(c.type) && !c.supertype && c.domains.length === 1 && ["Fury", "Chaos"].includes(c.domains[0]))
    .slice(0, 13);
  for (const c of fillers) for (let i = 0; i < 3; i++) deck = addCard(deck, c, catalog).deck;
  for (let i = 0; i < 6; i++) deck = addCard(addCard(deck, card("Fury Rune"), catalog).deck, card("Chaos Rune"), catalog).deck;
  for (const b of catalog.cards.filter((c) => c.type === "Battlefield" && !c.supertype).slice(0, 3)) deck = addCard(deck, b, catalog).deck;
  return deck;
}

test("a legal deck has no problems", () => {
  const deck = jinxDeck();
  assert.equal(deck.legend, JINX);
  assert.equal(deck.champion, "Jinx, Rebel"); // the first matching champion unit is the Chosen Champion
  const stats = deckStats(deck, catalog);
  assert.deepEqual([stats.main, stats.runes, stats.battlefields], [MAIN_MIN, 12, 3]);
  assert.equal(stats.curve.reduce((a, b) => a + b, 0), MAIN_MIN);
  assert.deepEqual(deckProblems(deck, catalog), []);
});

test("an empty deck lists what is missing, with the rule numbers", () => {
  const rules = deckProblems(newDeck(), catalog).map((p) => p.rule);
  assert.deepEqual(rules, ["103.1", "103.2.a", "103.2", "103.3.a", "480.4.a"]);
});

test("limits: 3 copies (champion included), 12 runes, 3 different battlefields", () => {
  let deck = addCard(newDeck(), card(JINX), catalog).deck;
  for (let i = 0; i < 3; i++) deck = addCard(deck, card("Jinx, Rebel"), catalog).deck;
  assert.equal(copiesOf(deck, "Jinx, Rebel"), 3);
  const r = addCard(deck, card("Jinx, Rebel"), catalog);
  assert.match(r.note, /Massimo 3 copie/);
  assert.equal(setCount(deck, "main", "Jinx, Rebel", 9).main["Jinx, Rebel"], 2); // plus the champion copy
  for (let i = 0; i < 13; i++) deck = addCard(deck, card("Fury Rune"), catalog).deck;
  assert.equal(deck.runes["Fury Rune"], 12);
  const bf = catalog.cards.find((c) => c.type === "Battlefield");
  deck = addCard(deck, bf, catalog).deck;
  assert.match(addCard(deck, bf, catalog).note, /già nel mazzo/);
  assert.equal(removeBattlefield(deck, bf.name).battlefields.length, 0);
});

test("domain identity, champion tag and Signature cards", () => {
  const legend = card(JINX); // Fury + Chaos
  assert.ok(fitsIdentity(card("Fury Rune"), legend.domains));
  assert.ok(!fitsIdentity(card("Calm Rune"), legend.domains));
  const colorless = catalog.cards.find((c) => c.type === "Battlefield" && c.domains.includes("Colorless"));
  assert.ok(fitsIdentity(colorless, legend.domains));
  const deck = addCard(newDeck(), legend, catalog).deck;
  assert.ok(canBeChampion(card("Jinx, Rebel"), deck, catalog));
  assert.ok(!canBeChampion(card("Vi, Destructive"), deck, catalog));

  let bad = { ...jinxDeck(), champion: "Vi, Destructive" };
  const otherSignature = catalog.cards.find((c) => c.supertype === "Signature" && !c.tags.includes("Jinx"));
  bad = { ...bad, main: { ...bad.main, [otherSignature.name]: 1, "Calm Rune": 0 } };
  bad.runes = { ...bad.runes, "Calm Rune": 1 };
  const rules = deckProblems(bad, catalog).map((p) => p.rule);
  for (const r of ["103.2.a.2", "103.1.b", "103.2.d.2", "103.3.a", "103.3.a.1"]) assert.ok(rules.includes(r), `${r} in ${rules}`);
});

test("changing the legend drops a champion that no longer fits", () => {
  let deck = jinxDeck();
  deck = addCard(deck, card("Vi, Piltover Enforcer"), catalog).deck;
  assert.equal(deck.champion, "");
  assert.equal(deck.main["Jinx, Rebel"], 1); // back among the Main Deck cards
  assert.equal(makeChampion(deck, "Jinx, Rebel").champion, "Jinx, Rebel");
  assert.equal(clearChampion(jinxDeck()).main["Jinx, Rebel"], 1);
});

test("export and import give the same deck back", () => {
  const deck = jinxDeck();
  const { deck: back, unknown } = importDeck(exportDeck(deck), catalog);
  assert.deepEqual(unknown, []);
  for (const k of ["name", "legend", "champion", "main", "runes", "battlefields"]) assert.deepEqual(back[k], deck[k], k);
});

test("import reads lists written in other ways", () => {
  const text = [
    "Legend: Jinx, Loose Cannon",
    "Main Deck (40)",
    "3x Jinx, Rebel",
    "- 2 Get Excited! (OGN-008)",
    "Stagazer x2", // another spelling of Stargazer
    "Not A Card",
    "Runes",
    "6 Fury Rune",
    "6 chaos rune",
  ].join("\n");
  const { deck, unknown } = importDeck(text, catalog);
  assert.equal(deck.legend, JINX);
  assert.equal(deck.champion, "Jinx, Rebel"); // one copy becomes the Chosen Champion
  assert.equal(deck.main["Jinx, Rebel"], 2);
  assert.deepEqual(deck.runes, { "Fury Rune": 6, "Chaos Rune": 6 });
  assert.deepEqual(unknown, ["Not A Card"]);
  assert.ok(Object.keys(deck.main).some((n) => /stargazer/i.test(n)));
});

test("saved decks are checked", () => {
  const [d] = restoreDecks([{ name: "x".repeat(99), main: { A: 7, B: -1, C: "2" }, runes: "no", battlefields: ["X", "X", 3] }, null]);
  assert.equal(d.name.length, 40);
  assert.deepEqual(d.main, { A: 7, C: 2 });
  assert.deepEqual(d.runes, {});
  assert.deepEqual(d.battlefields, ["X"]);
  assert.deepEqual(restoreDecks("nope"), []);
});
