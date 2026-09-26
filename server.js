import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import compression from "compression";
import { MODELS, HAS_API_KEY } from "./src/judge.js";
import { CARDS, CARD_NAMES, UNIT_STATS, DECK_CARDS, DOMAINS, CARDS_UPDATED_AT, searchCards } from "./src/cards.js";
import { RULE_COUNT, getRule, searchRules } from "./src/rules.js";
import { createAskHandler } from "./src/ask.js";
import { createAccessControl, rateLimit } from "./src/security.js";
import { buildServiceWorker } from "./src/offline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const CARD_TYPES = [...new Set(CARDS.map((c) => c.type).filter(Boolean))].sort();

// Built on first request: its version is a fingerprint of the app, rules and cards.
let serviceWorker;
const DATA_FILES = ["riftbound-core-rules.txt", "cards.json"].map((f) => path.join(here, "data", f));

// Hardening for when the app is online: scripts, data and fonts only from this
// server (pages use inline style attributes, never inline scripts), no framing,
// no MIME sniffing, no referrer sent to other sites.
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://cmsassets.rgpub.io", // card images, from Riot's image server
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const str = (v, max = 100) => (typeof v === "string" ? v.slice(0, max) : "");
const clamp = (v, fallback, max) => Math.min(Math.max(Number(v) || fallback, 1), max);

/**
 * Build the app. Every option defaults to the environment:
 * - ask: overrides for the judge handler (tests swap Gemini for a fake stream)
 * - password: ACCESS_PASSWORD — protects the API when the app is online
 * - askPerMinute: ASK_RATE_LIMIT — questions per minute per IP (0 = unlimited)
 */
export function createApp({
  ask,
  password = process.env.ACCESS_PASSWORD,
  askPerMinute = Number(process.env.ASK_RATE_LIMIT ?? 10),
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });
  // Behind a host's proxy (Render sets RENDER) the client IP is in X-Forwarded-For.
  if (process.env.TRUST_PROXY || process.env.RENDER) app.set("trust proxy", 1);
  // gzip pages and JSON (~70% smaller on mobile data), but never the SSE stream
  // of /api/ask: compressing it would buffer the answer instead of streaming it.
  app.use(compression({ filter: (req, res) => req.path !== "/api/ask" && compression.filter(req, res) }));
  app.use(express.json({ limit: "1mb" }));
  app.get("/sw.js", (_req, res) => {
    serviceWorker ??= buildServiceWorker(PUBLIC, DATA_FILES);
    res.type("js").set("Cache-Control", "no-cache").send(serviceWorker);
  });
  app.use(
    express.static(PUBLIC, {
      // Fonts, icons and artwork hardly ever change; the rest is revalidated (tiny 304s).
      setHeaders(res, file) {
        if (/[\\/](?:fonts|icons|img)[\\/]/.test(file)) res.set("Cache-Control", "public, max-age=604800");
      },
    }),
  );

  const access = createAccessControl(password);

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      locked: !access.authorized(req),
      models: MODELS,
      hasApiKey: HAS_API_KEY,
      cards: CARDS.length,
      rules: RULE_COUNT,
      cardsUpdatedAt: CARDS_UPDATED_AT,
      cardTypes: CARD_TYPES,
      domains: DOMAINS,
    });
  });

  app.post(
    "/api/login",
    rateLimit({ windowMs: 15 * 60_000, max: 10, message: (s) => `Troppi tentativi: riprova tra ${Math.ceil(s / 60)} minuti.` }),
    access.login,
  );

  // Everything below needs the password, when one is configured.
  app.use("/api", access.guard);

  app.get("/api/cards", (req, res) => {
    const { q, domain, type, limit } = req.query;
    res.json(searchCards({ q: str(q), domain: str(domain), type: str(type), limit: clamp(limit, 60, 200) }));
  });

  // All card names at once: the question box filters them on the phone, even offline.
  app.get("/api/cards/names", (_req, res) => {
    res.json({ updatedAt: CARDS_UPDATED_AT, names: CARD_NAMES });
  });

  // Every unit's combat numbers, for the combat calculator.
  app.get("/api/cards/units", (_req, res) => {
    res.json({ updatedAt: CARDS_UPDATED_AT, units: UNIT_STATS });
  });

  // Every card a deck can hold, for the deck builder (filtered on the phone, even offline).
  app.get("/api/cards/deck", (_req, res) => {
    res.json({ updatedAt: CARDS_UPDATED_AT, cards: DECK_CARDS });
  });

  app.get("/api/rules", (req, res) => {
    res.json(searchRules(str(req.query.q), clamp(req.query.limit, 30, 100)));
  });

  app.get("/api/rules/:ref", (req, res) => {
    const rule = getRule(str(req.params.ref, 60));
    if (rule) res.json(rule);
    else res.status(404).json({ error: "Regola non trovata nel regolamento." });
  });

  app.post(
    "/api/ask",
    rateLimit({ windowMs: 60_000, max: askPerMinute, message: (s) => `Troppe domande in poco tempo: riprova tra ${s} secondi.` }),
    createAskHandler(ask),
  );
  return app;
}

// Start the server only when run directly (`npm start`), not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createApp().listen(PORT, () => {
    console.log(`\n⚖️  Judge Rift Bound in ascolto su http://localhost:${PORT}`);
    console.log(`   Modelli: ${MODELS.join(" → ")}  |  Regole: ${RULE_COUNT}  |  Carte: ${CARDS.length}  |  GEMINI_API_KEY: ${HAS_API_KEY ? "trovata" : "MANCANTE"}`);
    if (process.env.ACCESS_PASSWORD) console.log("   🔒 Accesso protetto da password (ACCESS_PASSWORD)");
    if (!HAS_API_KEY) console.log("   ⚠️  Crea una chiave GRATUITA su https://aistudio.google.com/apikey e mettila in .env");
    console.log("");
  });
}
