import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { streamJudge, normalizeMessages, MODEL, EFFORT } from "./src/judge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MAX_MESSAGES = 40; // safety cap on conversation length
const MAX_CHARS = 8000; // safety cap on a single message

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    effort: EFFORT,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.post("/api/ask", async (req, res) => {
  const messages = normalizeMessages(req.body?.messages);

  if (messages.length === 0) {
    res.status(400).json({ error: "Nessuna domanda valida ricevuta." });
    return;
  }
  if (messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: "Conversazione troppo lunga. Inizia una nuova sessione." });
    return;
  }
  const tooLong = messages.find((m) => m.content.length > MAX_CHARS);
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
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });

  try {
    const stream = streamJudge(messages);

    // Abort the upstream call if the browser actually disconnects.
    res.on("close", () => {
      if (!res.writableEnded) stream.abort?.();
    });

    for await (const chunk of stream) {
      if (clientGone) break;
      if (chunk.type === "content_block_delta") {
        if (chunk.delta.type === "thinking_delta") {
          send("reasoning", { text: chunk.delta.thinking });
        } else if (chunk.delta.type === "text_delta") {
          send("answer", { text: chunk.delta.text });
        }
      }
    }

    if (!clientGone) {
      const final = await stream.finalMessage();
      send("done", {
        stop_reason: final.stop_reason,
        usage: {
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
          cache_read_input_tokens: final.usage.cache_read_input_tokens,
          cache_creation_input_tokens: final.usage.cache_creation_input_tokens,
        },
      });
      res.end();
    }
  } catch (err) {
    console.error("[judge] errore:", err);
    if (clientGone || res.writableEnded) {
      try { res.end(); } catch { /* ignore */ }
      return;
    }
    let message = "Si è verificato un errore nel contattare il judge. Riprova.";
    if (!process.env.ANTHROPIC_API_KEY) {
      message = "Chiave API non configurata sul server. Imposta ANTHROPIC_API_KEY nel file .env e riavvia.";
    } else if (err instanceof Anthropic.AuthenticationError) {
      message = "Chiave API mancante o non valida. Controlla ANTHROPIC_API_KEY nel file .env.";
    } else if (err instanceof Anthropic.RateLimitError) {
      message = "Troppe richieste al momento. Attendi qualche secondo e riprova.";
    } else if (err instanceof Anthropic.APIError) {
      message = `Errore API (${err.status ?? "?"}): ${err.message}`;
    }
    send("error", { message });
    res.end();
  }
});

app.listen(PORT, () => {
  const keyState = process.env.ANTHROPIC_API_KEY ? "trovata" : "MANCANTE";
  console.log(`\n⚖️  Judge Rift Bound in ascolto su http://localhost:${PORT}`);
  console.log(`   Modello: ${MODEL}  |  effort: ${EFFORT}  |  ANTHROPIC_API_KEY: ${keyState}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("   ⚠️  Imposta la chiave in un file .env (vedi .env.example) prima di fare domande.\n");
  } else {
    console.log("");
  }
});
