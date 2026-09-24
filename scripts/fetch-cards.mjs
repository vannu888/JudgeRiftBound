#!/usr/bin/env node
// Scarica l'elenco completo delle carte e salva in data/cards.json SOLO i dati
// funzionali utili al judge (nome, tipo, costo, might, power, dominio, tag,
// testo delle regole, errata, rarità). Niente artwork, flavor text o prezzi.
//
// Uso:  npm run cards
//
// Tre fonti, unite carta per carta:
// 1. piltoverarchive.com — la base: include le errata e le anteprime dei set in uscita.
// 2. playriftbound.com   — la galleria ufficiale di Riot: corregge i refusi del testo.
// 3. api.riftcodex.com   — API della community: nuove carte e conferma dei nomi.
// Se una fonte non risponde si usa quello che arriva dalle altre.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "data", "cards.json");
const PILTOVER = "https://piltoverarchive.com/cards";
const OFFICIAL = "https://playriftbound.com/en-us/card-gallery/";
const RIFTCODEX = "https://api.riftcodex.com/cards";
const DELAY_MS = 1200; // be polite: one request at a time
const MAX_PAGES = 150; // safety stop
const HEADERS = { "user-agent": "JudgeRiftBound card sync (personal rules tool)" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- piltoverarchive.com -----------------------------------------------------
// The site is a Next.js app: the data is embedded in the HTML as an "RSC"
// payload (self.__next_f.push([1,"..."])), one page of cards at a time.

/** Reassemble the React Server Components payload embedded in the HTML. */
export function rscPayload(html) {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (const m of html.matchAll(re)) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      /* skip malformed chunk */
    }
  }
  return out;
}

/** Parse the JSON object/array that starts exactly at index `i` of `s`. */
export function readJsonAt(s, i) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Every card variant object on a page ({ id, variantNumber, set, card: {...} }). */
export function variantsFrom(payload) {
  const found = [];
  const re = /\{"id":"[0-9a-f-]{36}","variantNumber":/g;
  for (const m of payload.matchAll(re)) {
    const v = readJsonAt(payload, m.index);
    if (v && v.card && v.card.id && v.card.name) found.push(v);
  }
  return found;
}

/**
 * Normalize card text: NFKC turns "mathematical bold" Unicode used for errata
 * notes (𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮) into plain letters, then tidy whitespace.
 */
export function cleanText(s) {
  if (typeof s !== "string") return undefined;
  const t = s.normalize("NFKC").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return t || undefined;
}

/** Keep only the functional, rules-relevant fields; drop nulls/empties. */
export function toRecord(card) {
  const rec = {
    id: card.id,
    name: card.name,
    type: card.type ?? undefined,
    supertype: card.super ?? undefined,
    domains: (card.colors ?? []).map((c) => c.name).filter(Boolean),
    energy: card.energy ?? undefined,
    power: card.power ?? undefined,
    might: card.might ?? undefined,
    mightBonus: card.mightBonus || undefined,
    tags: card.tags?.length ? card.tags : undefined,
    text: cleanText(card.description),
    effect: cleanText(card.effect),
    maxCopies: card.maxCopies ?? undefined,
    bannedFrom: card.banEffectiveDate ?? undefined,
    codes: [],
  };
  if (!rec.domains.length) delete rec.domains;
  return rec;
}

async function fetchText(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`  ${url}: ${err.message}, riprovo...`);
      await sleep(DELAY_MS * attempt * 2);
    }
  }
}

async function fetchPiltover() {
  const cards = new Map(); // card id -> record
  const domains = {}; // domain name -> hex color
  for (let page = 1; page <= MAX_PAGES; page++) {
    const variants = variantsFrom(rscPayload(await fetchText(`${PILTOVER}?page=${page}`)));
    if (variants.length === 0) break; // past the last page
    for (const v of variants) {
      const c = v.card;
      for (const col of c.colors ?? []) if (col.name && col.hexCode) domains[col.name] = col.hexCode;
      if (!cards.has(c.id)) cards.set(c.id, toRecord(c));
      const rec = cards.get(c.id);
      if (v.variantNumber && !rec.codes.includes(v.variantNumber)) rec.codes.push(v.variantNumber);
    }
    console.log(`  pagina ${page}: ${variants.length} varianti (totale ${cards.size} carte)`);
    await sleep(DELAY_MS);
  }
  return { cards: [...cards.values()], domains };
}

// --- Official gallery and Riftcodex: the same rich-text format --------------

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const decodeEntities = (s) =>
  s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** Riot's card HTML (":rb_might:", "<br />", lists) as this app's text ("[Might]", new lines). */
export function richText(html) {
  if (typeof html !== "string") return undefined;
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/:rb_might:/g, "[Might]")
    .replace(/:rb_exhaust:/g, "[Tap]")
    .replace(/:rb_rune_rainbow:/g, "[Rune]")
    .replace(/:rb_energy_(\d+):/g, "[$1]")
    .replace(/:rb_rune_([a-z]+):/g, (_, d) => `[${cap(d)}]`)
    .replace(/\[>\]/g, " ") // a layout marker, not game text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n");
  return cleanText(text);
}

const num = (field) => (typeof field?.value?.id === "number" ? field.value.id : undefined);
const optional = (list) => (list?.length ? list : undefined);

/** "Vi - Piltover Enforcer (Signature)" or "Recruit (273) // Buff" -> "Vi, Piltover Enforcer", "Recruit". */
export function baseName(name) {
  return String(name)
    .replace(/\s*\/\/.*$/, "")
    .replace(/(\s*\([^)]*\))+\s*$/, "")
    .replace(/\s+-\s+/, ", ")
    .trim();
}

/** A card of the official gallery (playriftbound.com) as a record. */
export function fromOfficial(item) {
  const type = item.cardType?.type?.[0]?.label;
  const tags = optional(item.tags?.tags);
  // Legends are listed by title ("Bashful Bloom"), champions with a subtitle ("Ahri" + "Inquisitive").
  let name = item.name;
  if (item.subtitle) name = `${item.name}, ${item.subtitle}`;
  else if (type === "Legend" && tags?.[0] && !item.name.includes(tags[0])) name = `${tags[0]}, ${item.name}`;
  return {
    name,
    type,
    supertype: item.cardType?.superType?.[0]?.label,
    domains: optional((item.domain?.values ?? []).map((d) => d.label)),
    energy: num(item.energy),
    power: num(item.power),
    might: num(item.might),
    mightBonus: num(item.mightBonus) || undefined,
    tags,
    text: richText(item.text?.richText?.body),
    effect: richText(item.effect?.richText?.body),
    rarity: item.rarity?.value?.label,
    set: item.set?.value?.label,
    codes: item.publicCode ? [item.publicCode.split("/")[0]] : [],
  };
}

/** The card list inside the official gallery page (Next.js __NEXT_DATA__). */
export function officialItems(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return [];
  let found = [];
  const walk = (v) => {
    if (found.length || !v || typeof v !== "object") return;
    if (Array.isArray(v.items) && v.items[0]?.publicCode && v.items[0]?.cardType) found = v.items;
    else for (const x of Object.values(v)) walk(x);
  };
  walk(JSON.parse(m[1]));
  return found;
}

/** A card of the Riftcodex API as a record. */
export function fromRiftcodex(item) {
  const [set = "", number = ""] = String(item.riftbound_id ?? "").split("-");
  const c = item.classification ?? {};
  return {
    name: baseName(item.name),
    type: c.type ?? undefined,
    supertype: c.supertype ?? undefined,
    domains: optional(c.domain),
    energy: item.attributes?.energy ?? undefined,
    power: item.attributes?.power ?? undefined,
    might: item.attributes?.might ?? undefined,
    tags: optional(item.tags),
    text: richText(item.text?.rich),
    rarity: c.rarity ?? undefined,
    set: item.set?.label,
    codes: set && number ? [`${set}-${number}`.toUpperCase()] : [],
  };
}

async function fetchOfficial() {
  const items = officialItems(await fetchText(OFFICIAL));
  if (!items.length) throw new Error("nessuna carta nella pagina");
  return items.map(fromOfficial);
}

async function fetchRiftcodex() {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = JSON.parse(await fetchText(`${RIFTCODEX}?size=100&page=${page}`));
    out.push(...(data.items ?? []).map(fromRiftcodex));
    if (page >= (data.pages ?? 1)) break;
    await sleep(DELAY_MS / 2);
  }
  return out;
}

// --- Merge -------------------------------------------------------------------

/** "Kai'Sa, Survivor" -> "kaisa survivor" */
export const nameKey = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The words that change a ruling: no reminder text, symbols, punctuation or case. */
const ruleWords = (s) =>
  String(s ?? "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Edit distance, to recognise the same card spelled differently ("Stagazer"/"Stargazer"). */
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/**
 * Merge the sources into one list. `base` (piltoverarchive) comes first;
 * `others` is [{ source, cards }]. A card of another source is the same card
 * when its name (or a known alias) matches, or when it has a known code and a
 * nearly identical name. Then it fills missing fields, adds its spelling as an
 * alias, and, from the official gallery, replaces a text whose words differ
 * unless ours carries an errata (the gallery shows the printed text). Cards
 * with unknown codes are new cards (e.g. previews of an upcoming set).
 */
export function mergeCards(base, others) {
  const cards = base.map((c) => ({ ...c, codes: [...(c.codes ?? [])], spellings: { [c.name]: 1 } }));
  const byName = new Map(cards.map((c) => [nameKey(c.name), c]));
  const byCode = new Map();
  for (const c of cards) for (const code of c.codes) byCode.set(code.replace(/\*$/, ""), c);

  for (const { source, cards: list } of others) {
    const seen = new Set(); // one vote per card and source (the lists repeat variants)
    for (const r of list) {
      const key = nameKey(r.name);
      let card = byName.get(key);
      if (!card) {
        const sameCode = r.codes.map((code) => byCode.get(code.replace(/\*$/, ""))).find(Boolean);
        if (sameCode && distance(nameKey(sameCode.name), key) <= 3) card = sameCode;
        else if (sameCode) continue; // a variant listed under another name: not a new card
      }
      if (!card) {
        card = { ...r, id: `${source}:${key}`, codes: [...r.codes], spellings: {}, source };
        cards.push(card);
        for (const code of card.codes) byCode.set(code.replace(/\*$/, ""), card);
      }
      byName.set(key, card);
      for (const code of r.codes) {
        if (!card.codes.includes(code)) card.codes.push(code);
        byCode.set(code.replace(/\*$/, ""), card);
      }
      if (seen.has(card)) continue;
      seen.add(card);
      card.spellings[r.name] = (card.spellings[r.name] ?? 0) + 1;
      for (const field of ["rarity", "set", "tags", "domains", "supertype"]) card[field] ??= r[field];
      if (source === "official") {
        for (const field of ["text", "effect"]) {
          if (r[field] && ruleWords(r[field]) !== ruleWords(card[field]) && !/errata/i.test(card[field] ?? "")) {
            card[field] = r[field];
          }
        }
      }
    }
  }

  // Most sources agree on the name; every other spelling still finds the card.
  const taken = new Set();
  for (const c of cards) {
    const ranked = Object.entries(c.spellings).sort((a, b) => b[1] - a[1]);
    if (ranked.length) c.name = ranked[0][0];
    taken.add(nameKey(c.name));
  }
  for (const c of cards) {
    const aliases = Object.keys(c.spellings).filter((n) => nameKey(n) !== nameKey(c.name) && !taken.has(nameKey(n)));
    delete c.spellings;
    if (aliases.length) c.aliases = aliases;
  }
  return cards;
}

async function main() {
  const sources = [
    ["piltoverarchive.com", fetchPiltover],
    ["playriftbound.com (ufficiale)", fetchOfficial],
    ["api.riftcodex.com", fetchRiftcodex],
  ];
  const results = [];
  for (const [label, fetcher] of sources) {
    console.log(`\n${label}…`);
    try {
      const result = await fetcher();
      const count = Array.isArray(result) ? result.length : result.cards.length;
      console.log(`  ✓ ${count} voci`);
      results.push(result);
    } catch (err) {
      console.warn(`  ✗ non disponibile (${err.message}): continuo con le altre fonti.`);
      results.push(null);
    }
  }
  const [piltover, official, riftcodex] = results;
  const others = [
    ["official", official],
    ["riftcodex", riftcodex],
  ].filter(([, cards]) => cards?.length);
  const baseCards = piltover?.cards ?? [];
  if (!baseCards.length && !others.length) {
    console.error("\nNessuna fonte disponibile: file non modificato.");
    process.exit(1);
  }
  const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const merged = mergeCards(baseCards, others.map(([source, cards]) => ({ source, cards })));

  const list = merged
    .map((c) => ({ ...c, codes: [...new Set(c.codes)].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const data = {
    sources: [PILTOVER, OFFICIAL, RIFTCODEX],
    fetchedAt: new Date().toISOString(),
    count: list.length,
    domains: piltover?.domains ?? previous.domains ?? {},
    cards: list,
  };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
  const added = list.filter((c) => c.source).length;
  console.log(`\nSalvate ${list.length} carte in ${path.relative(process.cwd(), OUT)} (${added} solo da altre fonti).`);
}

// Run only when executed directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("Errore durante il download delle carte:", err);
    process.exit(1);
  });
}
