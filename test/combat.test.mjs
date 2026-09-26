import test from "node:test";
import assert from "node:assert/strict";
import { makeUnit, mightOf, dealtBy, lethalFor, totalMight, damageOrder, assignDamage, resolveCombat, describeCombat, restoreCombat } from "../public/combat-model.js";
import { UNIT_STATS } from "../src/cards.js";

const u = (name, base, extra = {}) => makeUnit({ id: name, name, base, ...extra });

test("Assault counts only when attacking, Shield only when defending (807, 814)", () => {
  const garen = u("Garen", 5, { assault: 2, shield: 2 });
  assert.equal(mightOf(garen, "attack"), 7);
  assert.equal(mightOf(garen, "defend"), 7);
  const enforcer = u("Enforcer", 2, { assault: 2 });
  assert.equal(mightOf(enforcer, "attack"), 4);
  assert.equal(mightOf(enforcer, "defend"), 2);
});

test("buff, this-turn modifiers and gear add up", () => {
  assert.equal(mightOf(u("A", 3, { buff: true, temp: 2, gear: 1 }), "attack"), 7);
  assert.equal(mightOf(u("B", 2, { temp: -3 }), "defend"), -1);
});

test("negative Might deals 0 but is still killed by any damage (143.2)", () => {
  const weak = u("Weak", 2, { temp: -3 });
  assert.equal(dealtBy(weak, "attack"), 0);
  assert.equal(lethalFor(weak, "attack"), 1);
});

test("a stunned unit deals no damage but needs its full Might to die (423.1)", () => {
  const stunned = u("Stunned", 4, { stunned: true });
  assert.equal(dealtBy(stunned, "defend"), 0);
  assert.equal(lethalFor(stunned, "defend"), 4);
  assert.equal(totalMight([stunned, u("Other", 3)], "defend"), 3);
});

test("damage already marked lowers what is needed to kill", () => {
  assert.equal(lethalFor(u("Hurt", 5, { damage: 3 }), "defend"), 2);
});

test("Tank is assigned damage first and Backline last (815, 826)", () => {
  const units = [u("Back", 1, { backline: true }), u("Plain", 2), u("Tank", 5, { tank: true })];
  assert.deepEqual(damageOrder(units, "defend").map((x) => x.name), ["Tank", "Plain", "Back"]);
});

test("within the same priority the cheapest kills come first, unless a unit is marked first", () => {
  const units = [u("Big", 4), u("Small", 1), u("Mid", 2)];
  assert.deepEqual(damageOrder(units, "defend").map((x) => x.name), ["Small", "Mid", "Big"]);
  units[0].first = true;
  assert.deepEqual(damageOrder(units, "defend").map((x) => x.name), ["Big", "Small", "Mid"]);
});

test("lethal damage in full before the next unit (460.2.c.3): the rules' own example", () => {
  // 5 damage among four 3 Might units: one dies, another takes 2.
  const units = ["a", "b", "c", "d"].map((n) => u(n, 3));
  const { byId, left } = assignDamage(units, "defend", 5);
  const got = units.map((x) => byId.get(x.id));
  assert.deepEqual(got.map((r) => r.assigned), [3, 2, 0, 0]);
  assert.deepEqual(got.map((r) => r.dies), [true, false, false, false]);
  assert.equal(left, 0);
});

test("a full combat: Tank soaks the damage, the defenders win", () => {
  const attackers = [u("Chemtech Enforcer", 2, { assault: 2 }), u("Black Rose Dignitary", 2, { assault: 1 })];
  const defenders = [u("Blitzcrank", 5, { tank: true }), u("Mutated Mouser", 1, { shield: 2 })];
  const r = resolveCombat(attackers, defenders);
  assert.equal(r.attack, 7);
  assert.equal(r.defense, 8);
  assert.equal(r.toDefenders.get("Blitzcrank").dies, true);
  assert.deepEqual(r.toDefenders.get("Mutated Mouser"), { assigned: 2, dies: false });
  assert.equal(r.attackersLeft, 0);
  assert.equal(r.outcome, "defended");
  assert.deepEqual(r.attackMissing, { next: "Mutated Mouser", forNext: 1, forAll: 1 });
  assert.equal(r.defenseMissing, null);
});

test("the four outcomes (461)", () => {
  assert.equal(resolveCombat([u("A", 5)], [u("D", 2)]).outcome, "conquer");
  assert.equal(resolveCombat([u("A", 2)], [u("D", 5)]).outcome, "defended");
  assert.equal(resolveCombat([u("A", 3), u("A2", 3)], [u("D", 3), u("D2", 3)]).outcome, "none");
  // Both sides survive only when someone deals less than their Might, e.g. a stunned defender.
  assert.equal(resolveCombat([u("A", 3)], [u("D", 5, { stunned: true })]).outcome, "recalled");
  assert.equal(resolveCombat([u("A", 1)], []).outcome, null);
});

test("what is missing: the next kill and all of them", () => {
  const r = resolveCombat([u("A", 3)], [u("D1", 2), u("D2", 3), u("D3", 4)]);
  assert.deepEqual(r.attackMissing, { next: "D2", forNext: 2, forAll: 6 });
});

test("the judge gets a readable summary", () => {
  const text = describeCombat([u("Garen", 5, { assault: 2, buff: true })], [u("Mouser", 1, { shield: 2, tank: true, damage: 1 })], ["Tu", "Marco"]);
  assert.match(text, /Attaccanti \(Tu\):\n- Garen: Might 8 \(base 5, buff \+1, Assault 2\)/);
  assert.match(text, /Difensori \(Marco\):\n- Mouser: Might 3 \(base 1, Shield 2\), Tank, 1 danno già subiti/);
});

test("a saved combat is checked before use", () => {
  const c = restoreCombat({ attacker: "evil", bottom: [{ name: "X", base: 999, temp: "7", damage: -4 }], top: "nope" });
  assert.equal(c.attacker, "bottom");
  assert.deepEqual([c.bottom[0].base, c.bottom[0].temp, c.bottom[0].damage], [30, 7, 0]);
  assert.deepEqual(c.top, []);
  assert.deepEqual(restoreCombat(null), { attacker: "bottom", bottom: [], top: [] });
});

test("unit stats come from the printed keywords only", () => {
  const stats = (name) => UNIT_STATS.find((r) => r[0] === name);
  assert.deepEqual(stats("Garen, Rugged"), ["Garen, Rugged", 5, 2, 2, 0]);
  assert.deepEqual(stats("Mutated Mouser"), ["Mutated Mouser", 1, 0, 2, 1]);
  assert.equal(stats("Enthusiastic Promoter")[4] & 2, 2); // Backline
  // "[Empowered] I have [Assault 2]" is conditional: not counted, but flagged to check.
  assert.deepEqual(stats("Ambessa, Respected and Feared").slice(1), [5, 0, 0, 4]);
  assert.ok(UNIT_STATS.every((r) => Number.isInteger(r[1])));
});
