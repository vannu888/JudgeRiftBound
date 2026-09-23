// Protezione opzionale per quando l'app è online: password d'accesso (così
// nessun altro consuma la tua quota Gemini) e limite di richieste per IP.

import crypto from "node:crypto";

const COOKIE = "jrb_auth";
const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

/**
 * Password gate for the API. Without a password everything is open. With one,
 * POST /api/login sets a long-lived HttpOnly cookie derived from the password
 * (changing the password logs everyone out); no server-side session state.
 */
export function createAccessControl(password) {
  if (!password) {
    return { enabled: false, authorized: () => true, guard: (_req, _res, next) => next(), login: (_req, res) => res.json({ ok: true }) };
  }
  const token = crypto.createHmac("sha256", password).update("judge-riftbound").digest("hex");
  // Compare fixed-length digests in constant time (no length or timing leaks).
  const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
  const authorized = (req) => same(readCookie(req, COOKIE), token);

  return {
    enabled: true,
    authorized,
    guard(req, res, next) {
      if (authorized(req)) return next();
      res.status(401).json({ error: "Accesso protetto: inserisci la password.", locked: true });
    },
    login(req, res) {
      if (!same(req.body?.password ?? "", password)) {
        res.status(401).json({ error: "Password errata.", locked: true });
        return;
      }
      res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: ONE_YEAR_MS, path: "/" });
      res.json({ ok: true });
    },
  };
}

/**
 * Sliding-window rate limit per client IP (in memory). `max` requests per
 * `windowMs`; 0 disables it. Answers 429 with `retryAfter` seconds.
 */
export function rateLimit({ windowMs, max, message }) {
  if (!max) return (_req, _res, next) => next();
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.set("Retry-After", String(retryAfter)).status(429).json({ error: message(retryAfter), retryAfter });
      return;
    }
    recent.push(now);
    hits.set(req.ip, recent);
    if (hits.size > 10000) {
      for (const [ip, times] of hits) if (now - times.at(-1) >= windowMs) hits.delete(ip);
    }
    next();
  };
}
