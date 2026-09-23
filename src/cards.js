// Database delle carte (data/cards.json, generato con `npm run cards`):
// riconoscimento delle carte citate nella conversazione, ricerca e
// formattazione del testo da passare al judge.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CARDS_PATH = path.join(here, "..", "data", "cards.json");

/** Max cards attached to one question (keeps the prompt small on the free tier). */
export const MAX_CARDS = 16;

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));
    return { cards: data.cards ?? [], domains: data.domains ?? {}, updatedAt: data.fetchedAt ?? null };
  } catch {
    console.warn("[cards] data/cards.json non trovato: esegui `npm run cards`. Il judge funziona anche senza.");
    return { cards: [], domains: {}, updatedAt: null };
  }
}

export const { cards: CARDS, domains: DOMAINS, updatedAt: CARDS_UPDATED_AT } = load();

/** Lowercase, strip accents/apostrophes/punctuation: "Kai'Sa, Survivor" -> "kaisa survivor". */
export function normalize(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TYPE_ORDER = ["Legend", "Unit", "Unit Gear", "Spell", "Gear", "Battlefield", "Rune", "Card"];
const typeRank = (c) => {
  const i = TYPE_ORDER.indexOf(c.type);
  return i === -1 ? TYPE_ORDER.length : i;
};

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

// Precomputed search fields, so lookups never re-normalize the whole database.
const SEARCH = new Map(
  CARDS.map((c) => [
    c.id,
    {
      name: normalize(c.name),
      hay: normalize(
        [c.name, c.type, c.supertype, ...(c.domains ?? []), ...(c.tags ?? []), c.text, c.effect].join(" "),
      ),
    },
  ]),
);

// Match keys: every full card name, plus a champion alias ("Jinx" -> every
// "Jinx, …" card) so "il mio Jinx" also finds the right cards.
const KEYS = (() => {
  const keys = CARDS.map((c) => ({ key: SEARCH.get(c.id).name, raw: c.name, ids: [c.id] }));
  const champions = new Map();
  for (const c of CARDS) {
    const comma = c.name.indexOf(", ");
    if (comma > 0) {
      const champ = c.name.slice(0, comma);
      if (!champions.has(champ)) champions.set(champ, []);
      champions.get(champ).push(c);
    }
  }
  for (const [champ, list] of champions) {
    list.sort((a, b) => typeRank(a) - typeRank(b) || a.name.localeCompare(b.name));
    keys.push({ key: normalize(champ), raw: champ, ids: list.map((c) => c.id) });
  }
  return keys.filter((k) => k.key);
})();

/**
 * Very short names (the champion "Vi") collide with everyday Italian ("vi dico…"),
 * so they only count when written with the exact capitalization and not as the
 * first word of a sentence.
 */
function shortNameUsed(raw, text) {
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
  for (const m of text.matchAll(re)) {
    const before = text.slice(0, m.index + m[1].length);
    if (!/(^|[.!?:\n])[ \t]*$/.test(before)) return true; // not the start of a sentence/line
  }
  return false;
}

/** Card ids mentioned in one piece of text: full names first, then champion aliases. */
export function matchText(text) {
  const padded = ` ${normalize(text)} `;
  const hits = [];
  for (const k of KEYS) {
    const needle = ` ${k.key} `;
    let at = padded.indexOf(needle);
    if (at === -1) continue;
    if (k.raw.length <= 2 && !shortNameUsed(k.raw, String(text))) continue;
    const spans = [];
    while (at !== -1) {
      spans.push([at, at + needle.length]);
      at = padded.indexOf(needle, at + 1);
    }
    hits.push({ ...k, spans, alias: k.ids.length > 1 || k.raw !== BY_ID.get(k.ids[0])?.name });
  }

  // Drop a hit whose every occurrence sits inside a longer hit
  // ("Mech" inside "Mega-Mech", alias "Jinx" inside "Jinx, Rebel").
  const kept = hits.filter((h) =>
    h.spans.some(
      ([s, e]) =>
        !hits.some(
          (o) => o !== h && o.key.length > h.key.length && o.spans.some(([os, oe]) => os <= s && e <= oe),
        ),
    ),
  );

  kept.sort((a, b) => Number(a.alias) - Number(b.alias) || a.spans[0][0] - b.spans[0][0]);
  return [...new Set(kept.flatMap((h) => h.ids))];
}

/**
 * Cards mentioned anywhere in the conversation, most relevant first:
 * the latest question, then earlier questions, then the judge's answers.
 */
export function findCardsInConversation(messages, limit = MAX_CARDS) {
  const ordered = [
    ...messages.filter((m) => m.role === "user").reverse(),
    ...messages.filter((m) => m.role === "assistant").reverse(),
  ];
  const found = [];
  const seen = new Set();
  for (const m of ordered) {
    for (const id of matchText(m.content)) {
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(BY_ID.get(id));
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/** Free-text search for the card browser, with optional domain/type filters. */
export function searchCards({ q = "", domain = "", type = "", limit = 60 } = {}) {
  const query = normalize(q);
  const words = query ? query.split(" ") : [];
  const results = [];
  for (const c of CARDS) {
    if (domain && !(c.domains ?? []).includes(domain)) continue;
    if (type && c.type !== type) continue;
    const { name, hay } = SEARCH.get(c.id);
    let score = 1;
    if (query) {
      if (name === query) score = 100;
      else if (name.startsWith(query)) score = 80;
      else if (` ${name}`.includes(` ${query}`)) score = 60;
      else if (words.every((w) => name.includes(w))) score = 40;
      else if (words.every((w) => hay.includes(w))) score = 20;
      else continue;
    }
    results.push([score, c]);
  }
  results.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  return { total: results.length, cards: results.slice(0, limit).map(([, c]) => c) };
}

const COSTED = new Set(["Unit", "Unit Gear", "Spell", "Gear"]);

/** One card as compact, rules-oriented text for the judge's prompt. */
export function formatCard(c) {
  const facts = [c.supertype ? `${c.type} (${c.supertype})` : c.type];
  if (c.domains?.length) facts.push(`Domain: ${c.domains.join("/")}`);
  if (COSTED.has(c.type)) facts.push(`Cost: ${c.energy ?? 0} Energy${c.power ? ` + ${c.power} Power` : ""}`);
  if (c.type?.includes("Unit")) facts.push(`Might: ${c.might ?? 0}`);
  if (c.mightBonus) facts.push(`Might Bonus: +${c.mightBonus}`);
  if (c.tags?.length) facts.push(`Tags: ${c.tags.join(", ")}`);

  const lines = [`• ${c.name} — ${facts.join(" · ")}`];
  if (c.text) lines.push(`  Text: ${c.text.replace(/\n+/g, " / ")}`);
  if (c.effect) lines.push(`  While attached: ${c.effect.replace(/\n+/g, " / ")}`);
  if (c.bannedFrom) lines.push(`  BANNED since ${c.bannedFrom} (max copies: ${c.maxCopies ?? 0}).`);
  else if (c.maxCopies != null) lines.push(`  Max copies in a deck: ${c.maxCopies}`);
  return lines.join("\n");
}

/** The block prepended to the player's latest message. */
export function formatCardsBlock(cards) {
  return [
    "[CARTE CITATE — testo ufficiale dal database carte. Per la Golden Rule prevale sulle regole generali.",
    "Il riconoscimento è automatico: ignora le carte che non c'entrano con la situazione.]",
    ...cards.map(formatCard),
    "[FINE CARTE]",
  ].join("\n");
}
