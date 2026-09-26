import test from "node:test";
import assert from "node:assert/strict";
import { addEntry, removeEntry, restoreDiary, diaryStats, winRate, MAX_ENTRIES } from "../public/diary-model.js";

const JINX = "Jinx, Loose Cannon";
const AHRI = "Ahri, Nine-Tailed Fox";
const VI = "Vi, Piltover Enforcer";

function diary(games) {
  let list = [];
  games.forEach(([mine, opp, won], i) => (list = addEntry(list, { mine, opp, won, score: won ? "8–5" : "4–8" }, 1000 + i)));
  return list;
}

test("games are kept newest first", () => {
  const list = diary([[JINX, AHRI, true], [JINX, VI, false]]);
  assert.deepEqual(list.map((e) => e.opp), [VI, AHRI]);
  assert.equal(removeEntry(list, list[0].id).length, 1);
});

test("stats: totals, streak and record per legend", () => {
  const s = diaryStats(diary([[JINX, AHRI, true], [JINX, AHRI, false], [VI, AHRI, true], [JINX, VI, true], [JINX, VI, true]]));
  assert.deepEqual([s.games, s.wins, s.losses, s.rate], [5, 4, 1, 80]);
  assert.deepEqual(s.streak, { won: true, count: 3 }); // the last three games were won
  assert.deepEqual(s.byOpp, [{ legend: AHRI, games: 3, wins: 2 }, { legend: VI, games: 2, wins: 2 }]);
  assert.deepEqual(s.byMine[0], { legend: JINX, games: 4, wins: 3 });
  assert.equal(diaryStats([]).streak, null);
});

test("games without a legend are grouped last", () => {
  const s = diaryStats(diary([["", "", true], ["", "", true], [JINX, AHRI, false]]));
  assert.deepEqual(s.byOpp.map((g) => g.legend), [AHRI, ""]);
});

test("a saved diary is checked and capped", () => {
  const raw = [{ mine: "x".repeat(200), opp: AHRI, won: true, at: 5 }, { won: "yes" }, null, { opp: VI, won: false, at: 9 }];
  const list = restoreDiary(raw);
  assert.equal(list.length, 2);
  assert.equal(list[0].opp, VI); // newest first
  assert.equal(list[1].mine.length, 60);
  assert.equal(restoreDiary(Array.from({ length: 600 }, (_, i) => ({ won: true, at: i + 1 }))).length, MAX_ENTRIES);
  assert.deepEqual(restoreDiary("nope"), []);
  assert.equal(winRate(0, 0), 0);
});
