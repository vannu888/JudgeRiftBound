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
    .replace(/[\u0300-\u036f]/g, "")
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
        [c.name, ...(c.aliases ?? []), c.type, c.supertype, ...(c.domains ?? []), ...(c.tags ?? []), c.set, c.text, c.effect].join(" "),
      ),
    },
  ]),
);

const fold = (w) => w.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Word tokens with their original spelling and position: "l'Ahri" -> l, Ahri. */
function tokenize(text) {
  return Array.from(String(text).matchAll(/[\p{L}\p{M}\p{N}]+/gu), (m) => ({ word: fold(m[0]), raw: m[0], at: m.index }));
}

// Match index: every full card name and its other spellings (see `aliases` in
// the data), a legend's title on its own ("Heart of the Tempest"), plus a
// champion alias ("Jinx" -> every "Jinx, …" card) so "il mio Jinx" also works.
// Each name is indexed split at its punctuation ("kai sa", "mega mech") and with
// it removed ("kaisa", "megamech"), keyed by first word with the longest names first.
const INDEX = (() => {
  const entries = [];
  for (const c of CARDS) {
    for (const raw of [c.name, ...(c.aliases ?? [])]) entries.push({ raw, ids: [c.id], alias: false });
    const title = c.type === "Legend" ? c.name.split(", ")[1] : null;
    if (title && title.includes(" ")) entries.push({ raw: title, ids: [c.id], alias: false });
  }
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
    entries.push({ raw: champ, ids: list.map((c) => c.id), alias: true });
  }

  const index = new Map();
  for (const e of entries) {
    const spellings = [e.raw, e.raw.replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")];
    for (const v of new Set(spellings.map((s) => tokenize(s).map((t) => t.word).join(" ")))) {
      if (!v) continue;
      const words = v.split(" ");
      if (!index.has(words[0])) index.set(words[0], []);
      index.get(words[0]).push({ ...e, words, strict: e.raw.length <= 2 });
    }
  }
  for (const list of index.values()) list.sort((a, b) => b.words.length - a.words.length);
  return index;
})();

const SENTENCE_START = /(^|[.!?:\n])[ \t]*$/;

/** Does `key` match the tokens starting at position `i`? */
function fits(key, tokens, i, text) {
  if (i + key.words.length > tokens.length) return false;
  for (let j = 1; j < key.words.length; j++) if (tokens[i + j].word !== key.words[j]) return false;
  // Very short names (the champion "Vi") collide with everyday Italian ("vi dico…"):
  // they only count with the exact capitalization and not opening a sentence.
  return !key.strict || (tokens[i].raw === key.raw && !SENTENCE_START.test(text.slice(0, tokens[i].at)));
}

/**
 * Card ids mentioned in one piece of text: full names first, then champion
 * aliases. The longest name wins at each position, so "Mega-Mech" is not also
 * "Mech" and "Jinx, Rebel" is not also every Jinx.
 */
export function matchText(text) {
  const str = String(text);
  const tokens = tokenize(str);
  const exact = [];
  const alias = [];
  for (let i = 0; i < tokens.length; ) {
    const key = INDEX.get(tokens[i].word)?.find((k) => fits(k, tokens, i, str));
    if (!key) {
      i++;
      continue;
    }
    (key.alias ? alias : exact).push(...key.ids);
    i += key.words.length;
  }
  return [...new Set([...exact, ...alias])];
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

/**
 * Every name the question box can suggest, as compact rows:
 * [name, type, first domain, [other spellings and a legend's title]].
 */
export const CARD_NAMES = CARDS.map((c) => {
  const title = c.type === "Legend" ? c.name.split(", ")[1] : null;
  const other = [...(c.aliases ?? []), ...(title && title.includes(" ") ? [title] : [])];
  return other.length ? [c.name, c.type ?? "", c.domains?.[0] ?? "", other] : [c.name, c.type ?? "", c.domains?.[0] ?? ""];
});

// Printed keywords open a line of rules text: "[Assault 2], [Shield 2] (+2 [Might]…)".
// Keywords granted by conditions ("While I'm Mighty, I have [Shield]") are not printed.
const KEYWORD_LINE = /^(?:\[[A-Z][\w-]*(?: \d+)?\](?:, *| +)?)+/;
// Text that can change a unit's numbers in combat: "+2 [Might]", granted keywords, buffs, stuns.
const MIGHT_WORDS = /[+-] ?\d* ?\[Might\]|\[(?:Assault|Shield|Tank|Backline|Mighty)|\bbuff|\bstun/i;

/** Combat numbers of a unit: [name, might, assault, shield, flags] with flags 1 Tank, 2 Backline, 4 check the text. */
function unitStats(c) {
  let assault = 0;
  let shield = 0;
  let flags = 0;
  const rest = [];
  for (const line of (c.text ?? "").split("\n")) {
    const printed = line.match(KEYWORD_LINE)?.[0] ?? "";
    for (const [, kw, n] of printed.matchAll(/\[(Assault|Shield|Tank|Backline)(?: (\d+))?\]/g)) {
      if (kw === "Assault") assault += Number(n ?? 1);
      else if (kw === "Shield") shield += Number(n ?? 1);
      else flags |= kw === "Tank" ? 1 : 2;
    }
    rest.push(line.slice(printed.length).replace(/\([^)]*\)/g, ""));
  }
  if (MIGHT_WORDS.test(rest.join(" "))) flags |= 4;
  return [c.name, c.might ?? 0, assault, shield, flags];
}

export const UNIT_STATS = CARDS.filter((c) => c.type === "Unit").map(unitStats);

/**
 * Every card a deck can hold (no tokens), compact for the deck builder:
 * [name, type, supertype, domains, energy, power, might, tags, image, set, other spellings].
 * `image` is the file name on Riot's image server.
 */
export const DECK_CARDS = CARDS.filter((c) => c.supertype !== "Token" && c.type !== "Card").map((c) => [
  c.name,
  c.type ?? "",
  c.supertype ?? "",
  c.domains ?? [],
  c.energy ?? 0,
  c.power ?? 0,
  c.might ?? 0,
  c.tags ?? [],
  c.image ?? "",
  c.set ?? "",
  c.aliases ?? [],
]);

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
