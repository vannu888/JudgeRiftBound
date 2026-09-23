// POST /api/ask — risponde in streaming (Server-Sent Events) con il ragionamento
// e il verdetto del judge. Eventi: cards, reasoning, answer, retry, done, error.

import { createHash } from "node:crypto";
import { ApiError } from "@google/genai";
import { findCardsInConversation } from "./cards.js";
import { sanitizeMessages, sanitizeGame, buildContents, streamJudge, MODELS, HAS_API_KEY, MAX_MESSAGES, MAX_CHARS } from "./judge.js";

const INACTIVITY_MS = Number(process.env.JUDGE_TIMEOUT_MS || 60000);
// Retry an overloaded model at most once: every attempt resends the whole
// rulebook (~67k tokens) and eats into the per-minute quota.
const MAX_OVERLOADS = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const statusOf = (err) => (err instanceof ApiError ? err.status : 0);
const isTransient = (err) => statusOf(err) === 503 || statusOf(err) === 500;
/** Seconds Gemini asks to wait after a 429 ("Please retry in 41.2s"). */
const retrySeconds = (err) => Math.ceil(Number(/retry in ([\d.]+)s/i.exec(err.message)?.[1] ?? 60));
/** A daily quota ("…PerDay…") only resets at midnight Pacific time: look again in an hour. */
const isDaily = (err) => /per ?day/i.test(err.message);

/**
 * The configured models with their quota state: a model that answered 429 is
 * skipped until Gemini says it is usable again.
 */
export function createModelPool(models, now = Date.now) {
  const blockedUntil = new Map();
  return {
    first: models[0],
    /** Usable models, in order of preference. */
    ready: () => models.filter((m) => (blockedUntil.get(m) ?? 0) <= now()),
    block(model, seconds) {
      blockedUntil.set(model, Math.max(blockedUntil.get(model) ?? 0, now() + seconds * 1000));
    },
    /** Seconds until the first model is usable again. */
    wait: () => Math.max(1, Math.ceil((Math.min(...models.map((m) => blockedUntil.get(m) ?? 0)) - now()) / 1000)),
  };
}

/**
 * Recent complete answers by request, so the same question with the same cards
 * and score (an example, a double tap) costs no quota. Least recently used goes first.
 */
export function createAnswerCache({ max = 50, ttlMs = 6 * 3600_000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      entries.delete(key);
      if (!hit || now() - hit.at > ttlMs) return null;
      entries.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, at: now() });
      if (entries.size > max) entries.delete(entries.keys().next().value);
    },
  };
}

const keyOf = (contents) => createHash("sha256").update(JSON.stringify(contents)).digest("base64url");

function validationError(messages) {
  if (messages.length === 0) return "Nessuna domanda valida ricevuta.";
  if (messages.length > MAX_MESSAGES) return "Conversazione troppo lunga. Inizia una nuova sessione.";
  if (messages.some((m) => m.content.length > MAX_CHARS))
    return "Messaggio troppo lungo: accorcia la descrizione della situazione.";
  return null;
}

/** User-facing error, plus `retryAfter` (seconds) when waiting will fix it. */
function errorInfo(err, hasKey) {
  if (!hasKey) return { message: "Chiave API non configurata sul server. Imposta GEMINI_API_KEY e riavvia." };
  if (!(err instanceof ApiError)) return { message: "Si è verificato un errore nel contattare il judge. Riprova." };
  if (err.status === 429) {
    const wait = retrySeconds(err);
    if (wait > 300) {
      return {
        message: "Quota giornaliera gratuita di Gemini esaurita per oggi: si azzera alle 9:00 (ora italiana).",
        retryAfter: wait,
      };
    }
    return {
      message: `Limite del piano gratuito raggiunto (token al minuto): ogni domanda include tutto il regolamento. Riprova tra circa ${wait} secondi.`,
      retryAfter: wait,
    };
  }
  if (isTransient(err)) return { message: "Modello Gemini momentaneamente sovraccarico lato Google. Riprova tra qualche secondo.", retryAfter: 5 };
  if (err.status === 404) return { message: "Modello non disponibile: controlla JUDGE_MODEL nel file .env." };
  if (err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message)))
    return { message: "Chiave API non valida o senza permessi. Controlla GEMINI_API_KEY." };
  return { message: `Errore API (${err.status}). Riprova.` };
}

const usageSummary = (u) =>
  u
    ? {
        input_tokens: u.promptTokenCount ?? 0,
        cached_tokens: u.cachedContentTokenCount ?? 0,
        output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      }
    : null;

/**
 * Build the handler. Gemini (`stream`), the key check, the models and the cache
 * are injectable so tests can run the full HTTP/SSE flow against a fake Gemini.
 */
export function createAskHandler({
  stream = streamJudge,
  hasKey = HAS_API_KEY,
  timeoutMs = INACTIVITY_MS,
  models = MODELS,
  cache = createAnswerCache(),
} = {}) {
  const pool = createModelPool(models);

  return async function handleAsk(req, res) {
    const messages = sanitizeMessages(req.body?.messages);
    const invalid = validationError(messages);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }

    const cards = findCardsInConversation(messages);
    const contents = buildContents(messages, cards, sanitizeGame(req.body?.game));
    const key = keyOf(contents);

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    if (cards.length) send("cards", { cards });

    // "Rigenera" asks for a new answer; anything else may reuse an identical one.
    const cached = req.body?.fresh ? null : cache.get(key);
    if (cached) {
      if (cached.reasoning) send("reasoning", { text: cached.reasoning });
      send("answer", { text: cached.answer });
      send("done", { usage: null, model: cached.model, fallback: cached.model !== pool.first, cached: true });
      res.end();
      return;
    }

    // `req` emits "close" as soon as the body is read, so it is NOT a disconnect
    // signal; the response closing before we finished writing is.
    const controller = new AbortController();
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone = true;
        controller.abort();
      }
    });

    // Abort if Gemini produces nothing for a while, instead of hanging forever.
    let timedOut = false;
    let idleTimer;
    const bump = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    };

    let usage = null;
    let model = null;
    let reasoning = "";
    let answer = "";
    try {
      // Switch model (or retry) only while nothing but reasoning has been sent:
      // redoing it is safe, redoing answer text would duplicate it.
      for (let overloads = 0; ; ) {
        model = pool.ready()[0];
        if (!model) throw new ApiError({ message: `All models are over quota. Please retry in ${pool.wait()}s.`, status: 429 });
        bump();
        try {
          for await (const chunk of await stream(contents, controller.signal, model)) {
            if (clientGone) break;
            if (chunk.usageMetadata) usage = chunk.usageMetadata;
            for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
              if (typeof part.text !== "string" || !part.text) continue;
              bump();
              if (part.thought) {
                reasoning += part.text;
                send("reasoning", { text: part.text });
              } else {
                answer += part.text;
                send("answer", { text: part.text });
              }
            }
          }
          break;
        } catch (err) {
          if (answer || clientGone || controller.signal.aborted) throw err;
          const status = statusOf(err);
          if (status === 429) {
            pool.block(model, isDaily(err) ? 3600 : retrySeconds(err));
          } else if (status === 404) {
            console.warn(`[judge] modello ${model} non disponibile: lo salto.`);
            pool.block(model, 6 * 3600);
          } else if (isTransient(err) && overloads++ < MAX_OVERLOADS) {
            // Another model is the quickest way out; with just one, wait a moment.
            if (pool.ready().length > 1) pool.block(model, 30);
            else await sleep(800);
          } else {
            throw err;
          }
          if (!pool.ready().length) {
            if (status === 429) continue; // the top of the loop says when a model frees up
            throw err;
          }
          reasoning = "";
          send("retry", { reason: status === 429 ? "quota" : "overloaded", model: pool.ready()[0] ?? null });
        }
      }
      if (!clientGone) {
        send("done", { usage: usageSummary(usage), model, fallback: model !== pool.first });
        if (answer.trim()) cache.set(key, { reasoning, answer, model });
      }
    } catch (err) {
      if (!clientGone && !res.writableEnded) {
        if (!timedOut) console.error("[judge] errore:", err instanceof ApiError ? `${err.status} ${err.message}` : err);
        send(
          "error",
          timedOut
            ? { message: "Il judge non ha risposto in tempo (Gemini lento o sovraccarico). Riprova." }
            : errorInfo(err, hasKey),
        );
      }
    } finally {
      clearTimeout(idleTimer);
      if (!res.writableEnded) res.end();
    }
  };
}
