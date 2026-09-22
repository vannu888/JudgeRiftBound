import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ApiError } from "@google/genai";
import { streamJudge, normalizeMessages, MODEL, HAS_API_KEY } from "./src/judge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MAX_MESSAGES = 40; // safety cap on conversation length
const MAX_CHARS = 8000; // safety cap on a single message

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, hasApiKey: HAS_API_KEY });
});

app.post("/api/ask", async (req, res) => {
  const contents = normalizeMessages(req.body?.messages);

  if (contents.length === 0) {
    res.status(400).json({ error: "Nessuna domanda valida ricevuta." });
    return;
  }
  if (contents.length > MAX_MESSAGES) {
    res.status(400).json({ error: "Conversazione troppo lunga. Inizia una nuova sessione." });
    return;
  }
  const tooLong = contents.find((m) => m.parts[0].text.length > MAX_CHARS);
  if (tooLong) {
    res.status(400).json({ error: "Messaggio troppo lungo: accorcia la descrizione della situazione." });
    return;
  }

  // Server-Sent Events stream to the browser.
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // NOTE: `req` emits "close" as soon as the request body is received, even
  // while the client is still connected — so it is NOT a disconnect signal.
  // The response's "close" before we finish writing is the real signal.
  const controller = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort(); // stop the upstream Gemini call
    }
  });

  // Inactivity guard: if the upstream produces nothing for a while (Gemini
  // hanging or overloaded), abort and tell the user instead of hanging forever.
  const INACTIVITY_MS = Number(process.env.JUDGE_TIMEOUT_MS || 60000);
  let timedOut = false;
  let idleTimer;
  const bump = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, INACTIVITY_MS);
  };

  try {
    let usage = null;
    let answerStarted = false;
    bump();

    // Gemini can return transient 503/500 (high demand) even mid-stream. Retry
    // once if it fails BEFORE any answer text was sent (only reasoning so far),
    // which is safe to redo. We keep it to a SINGLE retry: each attempt resends
    // the full ruleset (~95k tokens), and the free tier allows 250k input
    // tokens/minute, so more retries would just trigger a 429. Once answer text
    // has streamed we don't retry (it would duplicate) and surface the error.
    const MAX_RETRIES = 1;
    for (let attempt = 0; ; attempt++) {
      try {
        const stream = await streamJudge(contents, controller.signal);
        for await (const chunk of stream) {
          if (clientGone) break;
          if (chunk.usageMetadata) usage = chunk.usageMetadata;

          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (typeof part.text !== "string" || part.text.length === 0) continue;
            bump(); // progress: reset the inactivity timer
            if (part.thought) {
              send("reasoning", { text: part.text });
            } else {
              answerStarted = true;
              send("answer", { text: part.text });
            }
          }
        }
        break; // stream finished cleanly
      } catch (err) {
        const transient = err instanceof ApiError && (err.status === 503 || err.status === 500);
        const canRetry = transient && !answerStarted && !clientGone && !controller.signal.aborted && attempt < MAX_RETRIES;
        if (!canRetry) throw err;
        send("retry", {}); // tell the client to discard the partial (reasoning) output
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt)); // 0.8s, 1.6s, 3.2s
      }
    }
    clearTimeout(idleTimer);

    if (!clientGone) {
      send("done", {
        usage: usage
          ? {
              input_tokens: usage.promptTokenCount ?? 0,
              output_tokens:
                (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            }
          : null,
      });
      res.end();
    }
  } catch (err) {
    clearTimeout(idleTimer);
    if (clientGone) {
      try { res.end(); } catch { /* ignore */ }
      return;
    }
    if (res.writableEnded) return;

    if (timedOut) {
      send("error", { message: "Il judge non ha risposto in tempo (Gemini lento o sovraccarico). Riprova." });
      res.end();
      return;
    }

    console.error("[judge] errore:", err);
    let message = "Si è verificato un errore nel contattare il judge. Riprova.";
    if (!HAS_API_KEY) {
      message = "Chiave API non configurata sul server. Imposta GEMINI_API_KEY e riavvia.";
    } else if (err instanceof ApiError) {
      if (err.status === 429) {
        message = "Limite del piano gratuito raggiunto (250k token/minuto): ogni domanda include tutto il regolamento. Attendi ~1 minuto tra una domanda e l'altra.";
      } else if (err.status === 503 || err.status === 500) {
        message = "Modello Gemini momentaneamente sovraccarico lato Google. Riprova tra qualche secondo.";
      } else if (err.status === 400 || err.status === 403) {
        message = "Chiave API non valida o senza permessi. Controlla GEMINI_API_KEY.";
      } else {
        message = `Errore API (${err.status}): ${err.message}`;
      }
    }
    send("error", { message });
    res.end();
  }
});

app.listen(PORT, () => {
  const keyState = HAS_API_KEY ? "trovata" : "MANCANTE";
  console.log(`\n⚖️  Judge Rift Bound in ascolto su http://localhost:${PORT}`);
  console.log(`   Modello: ${MODEL}  |  GEMINI_API_KEY: ${keyState}`);
  if (!HAS_API_KEY) {
    console.log("   ⚠️  Crea una chiave GRATUITA su https://aistudio.google.com/apikey e mettila in .env\n");
  } else {
    console.log("");
  }
});
