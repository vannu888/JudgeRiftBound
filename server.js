import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import compression from "compression";
import { MODEL, HAS_API_KEY } from "./src/judge.js";
import { CARDS, DOMAINS, CARDS_UPDATED_AT, searchCards } from "./src/cards.js";
import { createAskHandler } from "./src/ask.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const CARD_TYPES = [...new Set(CARDS.map((c) => c.type).filter(Boolean))].sort();

/** Build the app; `askOptions` lets tests swap Gemini for a fake stream. */
export function createApp(askOptions) {
  const app = express();
  app.disable("x-powered-by");
  // gzip pages and JSON (~70% smaller on mobile data), but never the SSE stream
  // of /api/ask: compressing it would buffer the answer instead of streaming it.
  app.use(compression({ filter: (req, res) => req.path !== "/api/ask" && compression.filter(req, res) }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(here, "public")));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      model: MODEL,
      hasApiKey: HAS_API_KEY,
      cards: CARDS.length,
      cardsUpdatedAt: CARDS_UPDATED_AT,
      cardTypes: CARD_TYPES,
      domains: DOMAINS,
    });
  });

  app.get("/api/cards", (req, res) => {
    const str = (v) => (typeof v === "string" ? v.slice(0, 100) : "");
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    res.json(searchCards({ q: str(req.query.q), domain: str(req.query.domain), type: str(req.query.type), limit }));
  });

  app.post("/api/ask", createAskHandler(askOptions));
  return app;
}

// Start the server only when run directly (`npm start`), not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createApp().listen(PORT, () => {
    console.log(`\n⚖️  Judge Rift Bound in ascolto su http://localhost:${PORT}`);
    console.log(`   Modello: ${MODEL}  |  Carte: ${CARDS.length}  |  GEMINI_API_KEY: ${HAS_API_KEY ? "trovata" : "MANCANTE"}`);
    if (!HAS_API_KEY) {
      console.log("   ⚠️  Crea una chiave GRATUITA su https://aistudio.google.com/apikey e mettila in .env");
    }
    console.log("");
  });
}
