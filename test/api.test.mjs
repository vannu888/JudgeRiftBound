// End-to-end: the real Express app and SSE flow, with Gemini replaced by a fake stream.
import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";
import { withServer, ask, part, usage, fakeStream, question } from "./helpers.mjs";

test("streams cards, reasoning, answer and usage", async () => {
  let sent;
  const stream = (contents) => {
    sent = contents;
    return fakeStream([part("Controllo 309.1.a…", true), part("## Verdetto\n"), part("Sì, con una Reaction."), usage]);
  };
  await withServer({ stream, hasKey: true }, async (base) => {
    const { status, events } = await ask(base, question);
    assert.equal(status, 200);
    assert.deepEqual(events.map((e) => e.event), ["cards", "reasoning", "answer", "answer", "done"]);
    assert.equal(events[0].data.cards[0].name, "Falling Comet");
    assert.deepEqual(events.at(-1).data.usage, { input_tokens: 97000, output_tokens: 400 });

    // The card text is attached to the latest question, not to the system prompt.
    const lastParts = sent.at(-1).parts;
    assert.match(lastParts[0].text, /^\[CARTE CITATE[\s\S]*• Falling Comet/);
    assert.match(lastParts[1].text, /Domanda del giocatore:\nL'avversario gioca Falling Comet/);
  });
});

test("retries once when Gemini is overloaded before the answer starts", async () => {
  let calls = 0;
  const stream = () => {
    calls++;
    if (calls === 1) {
      return Promise.resolve(
        (async function* () {
          yield part("sto ragionando", true);
          throw new ApiError({ message: "overloaded", status: 503 });
        })(),
      );
    }
    return fakeStream([part("Risposta dopo il retry.")]);
  };
  await withServer({ stream, hasKey: true }, async (base) => {
    const { events } = await ask(base, question);
    assert.equal(calls, 2);
    assert.deepEqual(events.map((e) => e.event), ["cards", "reasoning", "retry", "answer", "done"]);
  });
});

test("does not retry once answer text has been sent", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const stream = () => {
    calls++;
    return Promise.resolve(
      (async function* () {
        yield part("Verdetto parziale");
        throw new ApiError({ message: "overloaded", status: 503 });
      })(),
    );
  };
  await withServer({ stream, hasKey: true }, async (base) => {
    const { events } = await ask(base, question);
    assert.equal(calls, 1);
    assert.equal(events.at(-1).event, "error");
    assert.match(events.at(-1).data.message, /sovraccarico/);
  });
});

test("rate limits tell the player how long to wait", async (t) => {
  t.mock.method(console, "error", () => {});
  const stream = async () => {
    throw new ApiError({ message: "Quota exceeded. Please retry in 41.2s.", status: 429 });
  };
  await withServer({ stream, hasKey: true }, async (base) => {
    const { events } = await ask(base, question);
    assert.equal(events.at(-1).event, "error");
    assert.match(events.at(-1).data.message, /Riprova tra circa 42 secondi/);
    assert.equal(events.at(-1).data.retryAfter, 42);
  });
});

test("a silent Gemini times out with a clear message", async () => {
  const stream = (_contents, signal) =>
    Promise.resolve(
      (async function* () {
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      })(),
    );
  await withServer({ stream, hasKey: true, timeoutMs: 50 }, async (base) => {
    const { events } = await ask(base, question);
    assert.match(events.at(-1).data.message, /non ha risposto in tempo/);
  });
});

test("a missing API key is reported", async (t) => {
  t.mock.method(console, "error", () => {});
  const stream = async () => {
    throw new ApiError({ message: "forbidden", status: 403 });
  };
  await withServer({ stream, hasKey: false }, async (base) => {
    const { events } = await ask(base, [{ role: "user", content: "ciao" }]);
    assert.deepEqual(events.map((e) => e.event), ["error"]); // no cards mentioned
    assert.match(events[0].data.message, /GEMINI_API_KEY/);
  });
});

test("invalid requests are rejected", async () => {
  await withServer({ stream: () => fakeStream([]) }, async (base) => {
    assert.equal((await ask(base, [])).status, 400);
    assert.equal((await ask(base, [{ role: "assistant", content: "solo risposta" }])).status, 400);
    const long = await ask(base, [{ role: "user", content: "x".repeat(9000) }]);
    assert.equal(long.status, 400);
    assert.match(long.json.error, /troppo lungo/);
  });
});

test("health and card search endpoints", async () => {
  await withServer({}, async (base) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.ok(health.cards > 500);
    assert.ok(health.cardTypes.includes("Spell"));
    const search = await (await fetch(`${base}/api/cards?q=falling%20comet&limit=3`)).json();
    assert.equal(search.cards[0].name, "Falling Comet");
    assert.ok(search.cards.length <= 3);
  });
});

test("pages and JSON are compressed, the answer stream is not", async () => {
  await withServer({ stream: () => fakeStream([part("ok")]), hasKey: true }, async (base) => {
    const gz = { "accept-encoding": "gzip" };
    assert.equal((await fetch(`${base}/styles.css`, { headers: gz })).headers.get("content-encoding"), "gzip");
    assert.equal((await fetch(`${base}/api/cards?q=jinx`, { headers: gz })).headers.get("content-encoding"), "gzip");
    const res = await fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { ...gz, "content-type": "application/json" },
      body: JSON.stringify({ messages: question }),
    });
    assert.equal(res.headers.get("content-encoding"), null);
    assert.match(await res.text(), /event: done/);
  });
});

test("rules can be looked up and searched", async () => {
  await withServer({}, async (base) => {
    const rule = await (await fetch(`${base}/api/rules/309.1.a`)).json();
    assert.equal(rule.id, "309.1.a");
    assert.ok(rule.parents.length > 0);
    assert.equal((await (await fetch(`${base}/api/rules/Deflect`)).json()).id, "809");
    const missing = await fetch(`${base}/api/rules/999.9`);
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /non trovata/);
    const search = await (await fetch(`${base}/api/rules?q=${encodeURIComponent("chain resolves")}`)).json();
    assert.equal(search.rules[0].id, "340.1");
  });
});
