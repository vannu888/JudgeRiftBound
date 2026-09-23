import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeMessages, buildContents, shortenAnswer } from "../src/judge.js";

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

test("the scoreboard state is validated and attached to the latest question", async () => {
  const { sanitizeGame } = await import("../src/judge.js");
  assert.equal(sanitizeGame(null), null);
  assert.equal(sanitizeGame({ mode: "chess", victory: 8, players: [{}, {}] }), null);
  assert.equal(sanitizeGame({ mode: "duel", victory: 8, players: [{ name: "Solo", points: 1 }] }), null);
  const game = sanitizeGame({
    mode: "duel",
    victory: 8,
    players: [{ name: "Tu [x]\nhack", points: 7 }, { name: "", points: 300 }],
  });
  assert.deepEqual(game.players, [
    { name: "Tu  x  hack", points: 7, wins: 0 },
    { name: "Giocatore", points: 0, wins: 0 },
  ]);

  const contents = buildContents([{ role: "user", content: "Posso vincere conquistando?" }], [], game);
  assert.match(contents[0].parts[0].text, /^\[STATO PARTITA[^\n]*Punti per vincere: 8\. Punteggio: Tu {2}x {2}hack 7 · Giocatore 0\./);
  assert.equal(contents[0].parts[1].text, "Domanda del giocatore:\nPosso vincere conquistando?");
});

test("follow-ups resend old answers only up to their verdict", () => {
  const long = `## Verdetto\nSì, puoi.\n\n## Perché\n${"Spiegazione lunga. ".repeat(80)}`;
  const short = shortenAnswer(long);
  assert.ok(short.length < 760);
  assert.match(short, /^## Verdetto\nSì, puoi\./);
  assert.match(short, /\[… risposta precedente abbreviata\]$/);
  assert.equal(shortenAnswer("Breve."), "Breve.");

  const messages = [
    { role: "user", content: "q1" },
    { role: "assistant", content: long },
    { role: "user", content: "q2" },
    { role: "assistant", content: long },
    { role: "user", content: "q3" },
  ];
  const contents = buildContents(messages);
  assert.equal(contents[1].parts[0].text, short); // old answer: shortened
  assert.equal(contents[3].parts[0].text, long); // latest answer: in full
});
