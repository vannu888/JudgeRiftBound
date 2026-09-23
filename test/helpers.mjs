// Shared helpers for the HTTP tests (not a test file itself).
import { createApp } from "../server.js";

/** Run `fn(baseUrl)` against a real server; Gemini, password and rate limit are injectable. */
export async function withServer(ask, fn, options = {}) {
  const server = createApp({ ask, password: "", askPerMinute: 0, ...options }).listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

/** POST /api/ask and parse the SSE events (or the JSON error). */
export async function ask(base, messages, headers = {}) {
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ messages }),
  });
  if (!res.headers.get("content-type")?.includes("event-stream")) return { status: res.status, json: await res.json() };
  const events = (await res.text())
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)[1],
      data: JSON.parse(/^data: (.*)$/m.exec(block)[1]),
    }));
  return { status: res.status, events };
}

export const part = (text, thought = false) => ({ candidates: [{ content: { parts: [{ text, thought }] } }] });
export const usage = { usageMetadata: { promptTokenCount: 97000, candidatesTokenCount: 300, thoughtsTokenCount: 100 } };
export const fakeStream = (chunks) => Promise.resolve((async function* () { yield* chunks; })());
export const question = [{ role: "user", content: "L'avversario gioca Falling Comet: posso rispondere?" }];
