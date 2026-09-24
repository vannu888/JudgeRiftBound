#!/usr/bin/env node
// Scarica l'elenco completo delle carte da https://piltoverarchive.com/cards
// e salva in data/cards.json SOLO i dati funzionali utili al judge
// (nome, tipo, costo, might, power, dominio, tag, testo delle regole).
// Niente artwork, flavor text o prezzi.
//
// Uso:  npm run cards
//
// Il sito è un'app Next.js: i dati sono incorporati nell'HTML come payload
// "RSC" (self.__next_f.push([1,"..."])). Scorriamo le pagine ?page=N finché
// non ne troviamo una vuota, con una pausa tra una richiesta e l'altra.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "data", "cards.json");
const BASE = "https://piltoverarchive.com/cards";
const DELAY_MS = 1200; // be polite: one request at a time
const MAX_PAGES = 150; // safety stop

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function fetchPage(n) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}?page=${n}`, {
        headers: { "user-agent": "JudgeRiftBound card sync (personal rules tool)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`  pagina ${n}: ${err.message}, riprovo...`);
      await sleep(DELAY_MS * attempt * 2);
    }
  }
}

async function main() {
  const cards = new Map(); // card id -> record
  const domains = {}; // domain name -> hex color

  for (let page = 1; page <= MAX_PAGES; page++) {
    const variants = variantsFrom(rscPayload(await fetchPage(page)));
    if (variants.length === 0) break; // past the last page

    let added = 0;
    for (const v of variants) {
      const c = v.card;
      for (const col of c.colors ?? []) if (col.name && col.hexCode) domains[col.name] = col.hexCode;
      if (!cards.has(c.id)) {
        cards.set(c.id, toRecord(c));
        added++;
      }
      const rec = cards.get(c.id);
      if (v.variantNumber && !rec.codes.includes(v.variantNumber)) rec.codes.push(v.variantNumber);
    }
    console.log(`pagina ${page}: ${variants.length} varianti, ${added} carte nuove (totale ${cards.size})`);
    await sleep(DELAY_MS);
  }

  if (cards.size === 0) {
    console.error("Nessuna carta trovata: il sito potrebbe aver cambiato formato. File non modificato.");
    process.exit(1);
  }

  const list = [...cards.values()]
    .map((c) => ({ ...c, codes: c.codes.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const data = {
    source: BASE,
    fetchedAt: new Date().toISOString(),
    count: list.length,
    domains,
    cards: list,
  };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log(`\nSalvate ${list.length} carte in ${path.relative(process.cwd(), OUT)}`);
}

// Run only when executed directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("Errore durante il download delle carte:", err);
    process.exit(1);
  });
}
