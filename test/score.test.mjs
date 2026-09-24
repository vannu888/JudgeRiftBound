import test from "node:test";
import assert from "node:assert/strict";
import { MODES, newGame, score, undo, nextRound, winnerOf, summary, toContext, restoreGame } from "../public/score-model.js";

/** Apply a list of [player, kind, options?] actions. */
const play = (g, actions) => actions.reduce((acc, [i, kind, opts]) => score(acc, i, kind, opts).game, g);
const points = (g) => g.players.map((p) => p.points);

test("the official modes and victory scores", () => {
  assert.equal(MODES.duel.victory, 8);
  assert.equal(MODES.team.victory, 11);
  assert.equal(newGame("ffa4").players.length, 4);
  assert.deepEqual(newGame("duel", ["Giacomo"]).players.map((p) => p.name), ["Giacomo", "Avversario"]);
  assert.equal(newGame("unknown").mode, "duel");
});

test("conquer, hold and other sources each give a point", () => {
  const g = play(newGame("duel"), [[0, "conquer"], [0, "hold"], [1, "other"]]);
  assert.deepEqual(points(g), [2, 1]);
  assert.equal(summary(g), "2–1");
});

test("a correction never goes below zero", () => {
  const g = play(newGame("duel"), [[1, "minus"], [0, "hold"], [0, "minus"], [0, "minus"]]);
  assert.deepEqual(points(g), [0, 0]);
});

test("466.1.b: the winning point from a conquer needs every battlefield scored", () => {
  const g = newGame("duel", [], 3);
  const atMatchPoint = play(g, [[0, "hold"], [0, "hold"]]); // 2 of 3

  const ask = score(atMatchPoint, 0, "conquer");
  assert.equal(ask.needsAllBattlefields, true);
  assert.equal(ask.game, atMatchPoint); // nothing recorded yet

  const notAll = score(atMatchPoint, 0, "conquer", { allBattlefields: false });
  assert.equal(notAll.drew, true); // 466.1.b.2: draw a card instead
  assert.deepEqual(points(notAll.game), [2, 0]);
  assert.equal(notAll.game.winner, null);

  const all = score(atMatchPoint, 0, "conquer", { allBattlefields: true });
  assert.deepEqual(points(all.game), [3, 0]);
  assert.equal(all.game.winner, 0);

  const hold = score(atMatchPoint, 0, "hold"); // 466.1.b.1: hold always scores it
  assert.equal(hold.game.winner, 0);
  const other = score(atMatchPoint, 0, "other"); // 466.1.a.1: not restricted
  assert.equal(other.game.winner, 0);
});

test("467: the winner needs more points than every opponent", () => {
  const g = newGame("ffa3", [], 2);
  const tied = { ...g, players: g.players.map((p, i) => ({ ...p, points: i < 2 ? 2 : 0 })) };
  assert.equal(winnerOf(tied), null);
  assert.equal(winnerOf({ ...tied, players: tied.players.map((p, i) => (i === 1 ? { ...p, points: 3 } : p)) }), 1);
});

test("no more points after the game is won; undo reopens it", () => {
  const won = play(newGame("duel", [], 1), [[1, "hold"]]);
  assert.equal(won.winner, 1);
  assert.equal(score(won, 0, "hold").game, won);
  const reopened = undo(won);
  assert.equal(reopened.winner, null);
  assert.deepEqual(points(reopened), [0, 0]);
  assert.equal(undo(newGame("duel")).log.length, 0);
});

test("best of 3: game wins are banked until someone wins two", () => {
  let g = play(newGame("match", [], 1), [[0, "hold"]]);
  g = nextRound(g);
  assert.equal(g.round, 2);
  assert.deepEqual(g.players.map((p) => [p.points, p.wins]), [[0, 1], [0, 0]]);
  g = nextRound(play(g, [[0, "hold"]]));
  assert.equal(g.matchWinner, 0);
  assert.equal(g.players[0].wins, 2);
});

test("context for the judge and restore from storage", () => {
  const g = play(newGame("duel", ["Io", "Lui"]), [[0, "hold"], [1, "conquer"], [1, "conquer"]]);
  assert.deepEqual(toContext(g), {
    mode: "duel",
    victory: 8,
    players: [{ name: "Io", points: 1, wins: 0 }, { name: "Lui", points: 2, wins: 0 }],
  });
  const restored = restoreGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(points(restored), [1, 2]);
  assert.equal(restored.log.length, 3);
  assert.equal(restoreGame({ mode: "hack" }), null);
  assert.equal(restoreGame(null), null);

  // A tampered log entry could make "undo" jump the score: it is dropped.
  const tampered = JSON.parse(JSON.stringify(g));
  tampered.log.push({ player: 0, kind: "other", delta: 50 });
  assert.equal(restoreGame(tampered).log.length, 3);
});
