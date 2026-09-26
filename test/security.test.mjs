import test from "node:test";
import assert from "node:assert/strict";
import { withServer, ask, part, fakeStream, question } from "./helpers.mjs";

test("with a password, the API is locked until login", async () => {
  await withServer({ stream: () => fakeStream([part("ok")]), hasKey: true }, async (base) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.locked, true);
    assert.equal((await fetch(`${base}/api/cards?q=jinx`)).status, 401);
    assert.equal((await ask(base, question)).status, 401);
    assert.equal((await fetch(`${base}/styles.css`)).status, 200); // the page itself still loads

    const login = (password) =>
      fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    assert.equal((await login("sbagliata")).status, 401);
    const ok = await login("segreta");
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie").split(";")[0];
    assert.match(ok.headers.get("set-cookie"), /HttpOnly/i);

    const authed = { cookie };
    assert.equal((await (await fetch(`${base}/api/health`, { headers: authed })).json()).locked, false);
    assert.equal((await fetch(`${base}/api/cards?q=jinx`, { headers: authed })).status, 200);
    const answer = await ask(base, question, authed);
    assert.equal(answer.events.at(-1).event, "done");
    assert.equal((await fetch(`${base}/api/cards`, { headers: { cookie: "jrb_auth=forged" } })).status, 401);
  }, { password: "segreta" });
});

test("without a password everything is open", async () => {
  await withServer({}, async (base) => {
    assert.equal((await (await fetch(`${base}/api/health`)).json()).locked, false);
    assert.equal((await fetch(`${base}/api/cards?q=jinx`)).status, 200);
  });
});

test("questions are rate limited per client", async () => {
  await withServer({ stream: () => fakeStream([part("ok")]), hasKey: true }, async (base) => {
    assert.equal((await ask(base, question)).status, 200);
    assert.equal((await ask(base, question)).status, 200);
    const limited = await ask(base, question);
    assert.equal(limited.status, 429);
    assert.ok(limited.json.retryAfter > 0 && limited.json.retryAfter <= 60);
    assert.match(limited.json.error, /Troppe domande/);
  }, { askPerMinute: 2 });
});

test("every response carries the security headers", async () => {
  await withServer({}, async (base) => {
    for (const path of ["/", "/api/health", "/app.js"]) {
      const res = await fetch(`${base}${path}`);
      assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
      assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    }
  });
});
