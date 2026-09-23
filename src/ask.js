// POST /api/ask — risponde in streaming (Server-Sent Events) con il ragionamento
// e il verdetto del judge. Eventi: cards, reasoning, answer, retry, done, error.

import { ApiError } from "@google/genai";
import { findCardsInConversation } from "./cards.js";
import { sanitizeMessages, buildContents, streamJudge, HAS_API_KEY, MAX_MESSAGES, MAX_CHARS } from "./judge.js";

const INACTIVITY_MS = Number(process.env.JUDGE_TIMEOUT_MS || 60000);
// Each attempt resends the whole rulebook (~95k tokens) and the free tier allows
// 250k input tokens/minute, so a single retry is the useful maximum.
const MAX_RETRIES = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (err) => err instanceof ApiError && (err.status === 503 || err.status === 500);

function validationError(messages) {
  if (messages.length === 0) return "Nessuna domanda valida ricevuta.";
  if (messages.length > MAX_MESSAGES) return "Conversazione troppo lunga. Inizia una nuova sessione.";
  if (messages.some((m) => m.content.length > MAX_CHARS))
    return "Messaggio troppo lungo: accorcia la descrizione della situazione.";
  return null;
}

function errorMessage(err, hasKey) {
  if (!hasKey) return "Chiave API non configurata sul server. Imposta GEMINI_API_KEY e riavvia.";
  if (!(err instanceof ApiError)) return "Si è verificato un errore nel contattare il judge. Riprova.";
  if (err.status === 429) {
    const wait = /retry in ([\d.]+)s/i.exec(err.message)?.[1];
    return (
      "Limite del piano gratuito raggiunto (token al minuto): ogni domanda include tutto il regolamento. " +
      (wait ? `Riprova tra circa ${Math.ceil(Number(wait))} secondi.` : "Attendi circa un minuto e riprova.")
    );
  }
  if (isTransient(err)) return "Modello Gemini momentaneamente sovraccarico lato Google. Riprova tra qualche secondo.";
  if (err.status === 404) return "Modello non disponibile: controlla JUDGE_MODEL nel file .env.";
  if (err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message)))
    return "Chiave API non valida o senza permessi. Controlla GEMINI_API_KEY.";
  return `Errore API (${err.status}). Riprova.`;
}

const usageSummary = (u) =>
  u
    ? {
        input_tokens: u.promptTokenCount ?? 0,
        output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      }
    : null;

/**
 * Build the handler. `stream` and `hasKey` are injectable so tests can run the
 * full HTTP/SSE flow against a fake Gemini.
 */
export function createAskHandler({ stream = streamJudge, hasKey = HAS_API_KEY, timeoutMs = INACTIVITY_MS } = {}) {
  return async function handleAsk(req, res) {
    const messages = sanitizeMessages(req.body?.messages);
    const invalid = validationError(messages);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }

    const cards = findCardsInConversation(messages);
    const contents = buildContents(messages, cards);

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const finish = () => {
      if (!res.writableEnded) res.end();
    };

    if (cards.length) send("cards", { cards });

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
    let answerStarted = false;
    try {
      // Retry a transient 503/500 only while nothing but reasoning has been
      // sent: redoing it is safe, redoing answer text would duplicate it.
      for (let attempt = 0; ; attempt++) {
        bump();
        try {
          for await (const chunk of await stream(contents, controller.signal)) {
            if (clientGone) break;
            if (chunk.usageMetadata) usage = chunk.usageMetadata;
            for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
              if (typeof part.text !== "string" || !part.text) continue;
              bump();
              if (part.thought) {
                send("reasoning", { text: part.text });
              } else {
                answerStarted = true;
                send("answer", { text: part.text });
              }
            }
          }
          break;
        } catch (err) {
          const canRetry =
            isTransient(err) && !answerStarted && !clientGone && !controller.signal.aborted && attempt < MAX_RETRIES;
          if (!canRetry) throw err;
          send("retry", {}); // the client discards the partial reasoning
          await sleep(800 * 2 ** attempt);
        }
      }
      if (!clientGone) send("done", { usage: usageSummary(usage) });
    } catch (err) {
      if (!clientGone && !res.writableEnded) {
        if (!timedOut) console.error("[judge] errore:", err);
        send("error", {
          message: timedOut
            ? "Il judge non ha risposto in tempo (Gemini lento o sovraccarico). Riprova."
            : errorMessage(err, hasKey),
        });
      }
    } finally {
      clearTimeout(idleTimer);
      finish();
    }
  };
}
