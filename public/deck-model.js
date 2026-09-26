// Mazzi: logica pura, senza DOM (testabile in Node). Le regole di costruzione
// vengono dalle Core Rules (103): Leggenda, Campione scelto, almeno 40 carte,
// al massimo 3 copie per nome, identità di dominio, al massimo 3 Signature,
// 12 rune e (nel 1v1) 3 battlefield diversi.

export const MAIN_MIN = 40; // 103.2
export const MAX_COPIES = 3; // 103.2.b
export const MAX_SIGNATURE = 3; // 103.2.d.1
export const RUNES = 12; // 103.3.a
export const BATTLEFIELDS = 3; // 1v1: each player brings three (480.4.a)
export const MAX_DECKS = 50;

/** Name matching that ignores case, accents and punctuation: "Kai'Sa, Survivor" -> "kaisa survivor". */
export const nameKey = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Rows from /api/cards/deck -> { cards, byName, byKey }. */
export function buildCatalog(rows) {
  const byName = new Map();
  const byKey = new Map();
  for (const [name, type, supertype, domains, energy, power, might, tags, image, set, aliases = []] of rows) {
    const card = { name, type, supertype, domains, energy, power, might, tags, image, set };
    byName.set(name, card);
    for (const n of [name, ...aliases]) if (!byKey.has(nameKey(n))) byKey.set(nameKey(n), card);
  }
  return { cards: [...byName.values()], byName, byKey };
}

/** The part of the deck a card belongs to. */
export function sectionOf(card) {
  if (card.type === "Legend") return "legend";
  if (card.type === "Rune") return "runes";
  if (card.type === "Battlefield") return "battlefields";
  return "main";
}

const colorful = (card) => (card.domains ?? []).filter((d) => d !== "Colorless");

/** 103.1.b.3-4: every domain of the card must be in the identity (colorless cards fit any deck). */
export const fitsIdentity = (card, identity) => colorful(card).every((d) => identity.includes(d));

/** The deck's domain identity: its legend's domains (103.1.b.2). */
export const identityOf = (deck, catalog) => catalog.byName.get(deck.legend)?.domains ?? [];

const legendTags = (deck, catalog) => catalog.byName.get(deck.legend)?.tags ?? [];

/** 103.2.a.2: a champion unit sharing its champion tag with the legend. */
export function canBeChampion(card, deck, catalog) {
  const tags = legendTags(deck, catalog);
  return card?.type === "Unit" && card.supertype === "Champion" && (card.tags ?? []).some((t) => tags.includes(t));
}

const newId = (now) => `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const newDeck = (name = "Nuovo mazzo", now = Date.now()) => ({
  id: newId(now),
  name,
  legend: "",
  champion: "",
  main: {}, // name -> copies, besides the chosen champion
  runes: {}, // name -> copies
  battlefields: [],
  updatedAt: now,
});

/** Copies of a name in the Main Deck, the chosen champion included (103.2.b.1). */
export const copiesOf = (deck, name) => (deck.main[name] ?? 0) + (deck.champion === name ? 1 : 0);

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
export const mainCount = (deck) => sum(deck.main) + (deck.champion ? 1 : 0);
export const runeCount = (deck) => sum(deck.runes);

const touch = (deck, now = Date.now()) => ({ ...deck, updatedAt: now });

/**
 * Add one copy of `card` where it belongs. The first matching champion unit
 * becomes the Chosen Champion. Returns { deck, note } — `note` says what
 * happened, or why nothing did (a limit reached).
 */
export function addCard(deck, card, catalog) {
  const section = sectionOf(card);
  if (section === "legend") {
    const next = { ...deck, legend: card.name };
    if (next.champion && !canBeChampion(catalog.byName.get(next.champion), next, catalog)) {
      next.main = { ...next.main, [next.champion]: (next.main[next.champion] ?? 0) + 1 };
      next.champion = "";
    }
    return { deck: touch(next), note: `Leggenda: ${card.name}` };
  }
  if (section === "runes") {
    if (runeCount(deck) >= RUNES) return { deck, note: `Il Rune Deck ha già ${RUNES} rune` };
    return { deck: touch({ ...deck, runes: { ...deck.runes, [card.name]: (deck.runes[card.name] ?? 0) + 1 } }), note: `+1 ${card.name}` };
  }
  if (section === "battlefields") {
    if (deck.battlefields.includes(card.name)) return { deck, note: "Battlefield già nel mazzo: uno per nome" };
    if (deck.battlefields.length >= BATTLEFIELDS) return { deck, note: `Hai già ${BATTLEFIELDS} battlefield` };
    return { deck: touch({ ...deck, battlefields: [...deck.battlefields, card.name] }), note: `Battlefield: ${card.name}` };
  }
  if (copiesOf(deck, card.name) >= MAX_COPIES) return { deck, note: `Massimo ${MAX_COPIES} copie di ${card.name}` };
  if (!deck.champion && canBeChampion(card, deck, catalog)) {
    return { deck: touch({ ...deck, champion: card.name }), note: `Campione scelto: ${card.name}` };
  }
  return { deck: touch({ ...deck, main: { ...deck.main, [card.name]: (deck.main[card.name] ?? 0) + 1 } }), note: `+1 ${card.name}` };
}

/** Set the copies of a Main Deck card or a rune (0 removes it), within the limits. */
export function setCount(deck, section, name, count) {
  const list = { ...deck[section] };
  const max = section === "runes" ? RUNES - (runeCount(deck) - (list[name] ?? 0)) : MAX_COPIES - (deck.champion === name ? 1 : 0);
  const n = Math.max(0, Math.min(max, Math.trunc(Number(count)) || 0));
  if (n) list[name] = n;
  else delete list[name];
  return touch({ ...deck, [section]: list });
}

export const removeBattlefield = (deck, name) => touch({ ...deck, battlefields: deck.battlefields.filter((b) => b !== name) });

/** No chosen champion any more: its copy goes back among the Main Deck cards. */
export function clearChampion(deck) {
  if (!deck.champion) return deck;
  return touch({ ...deck, champion: "", main: { ...deck.main, [deck.champion]: (deck.main[deck.champion] ?? 0) + 1 } });
}

/** Make a Main Deck copy the chosen champion. */
export function makeChampion(deck, name) {
  const main = { ...deck.main };
  if (!main[name]) return deck;
  if (--main[name] === 0) delete main[name];
  const next = deck.champion ? { ...deck, main: { ...main, [deck.champion]: (main[deck.champion] ?? 0) + 1 } } : { ...deck, main };
  return touch({ ...next, champion: name });
}

/**
 * Numbers for the deck view: Main Deck size, energy curve (0..7+), types,
 * runes, battlefields and Signature cards. The chosen champion counts in the Main Deck.
 */
export function deckStats(deck, catalog) {
  const curve = Array(8).fill(0);
  const types = { Unit: 0, Spell: 0, Gear: 0 };
  let signature = 0;
  const entries = Object.entries(deck.main);
  if (deck.champion) entries.push([deck.champion, 1]);
  for (const [name, n] of entries) {
    const card = catalog.byName.get(name);
    if (!card) continue;
    curve[Math.min(7, card.energy ?? 0)] += n;
    const type = card.type === "Unit Gear" ? "Unit" : card.type;
    if (type in types) types[type] += n;
    if (card.supertype === "Signature") signature += n;
  }
  return { main: mainCount(deck), runes: runeCount(deck), battlefields: deck.battlefields.length, curve, types, signature };
}

/** Every rule the deck breaks, with its number: [{ rule, text }]. An empty list means the deck is legal. */
export function deckProblems(deck, catalog) {
  const out = [];
  const add = (rule, text) => out.push({ rule, text });
  const legend = catalog.byName.get(deck.legend);
  const identity = legend?.domains ?? [];
  if (!legend) add("103.1", "Scegli la Leggenda: decide i domini del mazzo");

  const champion = catalog.byName.get(deck.champion);
  if (!deck.champion) add("103.2.a", `Scegli il Campione: un'unità campione${legend ? ` di ${legend.tags?.[0] ?? legend.name}` : ""}`);
  else if (legend && !canBeChampion(champion, deck, catalog)) add("103.2.a.2", `${deck.champion} non può essere il Campione di ${legend.name}`);

  const main = mainCount(deck);
  if (main < MAIN_MIN) add("103.2", `Main Deck: ${main}/${MAIN_MIN} carte`);

  const names = new Set([...Object.keys(deck.main), deck.champion].filter(Boolean));
  let signature = 0;
  for (const name of names) {
    const card = catalog.byName.get(name);
    if (!card) {
      add("103", `${name}: carta non trovata nel database`);
      continue;
    }
    if (copiesOf(deck, name) > MAX_COPIES) add("103.2.b", `${name}: ${copiesOf(deck, name)} copie, massimo ${MAX_COPIES}`);
    if (legend && !fitsIdentity(card, identity)) add("103.1.b", `${name} è fuori dai domini della Leggenda`);
    if (card.supertype === "Signature") {
      signature += copiesOf(deck, name);
      if (legend && !(card.tags ?? []).some((t) => legend.tags?.includes(t))) add("103.2.d.2", `${name} è una Signature di un altro campione`);
    }
  }
  if (signature > MAX_SIGNATURE) add("103.2.d.1", `${signature} carte Signature: massimo ${MAX_SIGNATURE} in tutto`);

  const runes = runeCount(deck);
  if (runes !== RUNES) add("103.3.a", `Rune Deck: ${runes}/${RUNES} rune`);
  for (const name of Object.keys(deck.runes)) {
    const card = catalog.byName.get(name);
    if (card && legend && !fitsIdentity(card, identity)) add("103.3.a.1", `${name} è fuori dai domini della Leggenda`);
  }

  if (deck.battlefields.length !== BATTLEFIELDS) add("480.4.a", `Battlefield: ${deck.battlefields.length}/${BATTLEFIELDS}`);
  for (const name of deck.battlefields) {
    const card = catalog.byName.get(name);
    if (card && legend && !fitsIdentity(card, identity)) add("103.4.b", `${name} è fuori dai domini della Leggenda`);
  }
  return out;
}

const byName = (a, b) => a[0].localeCompare(b[0]);

/** The deck as text, one "copies name" per line under each section: to copy, share or buy. */
export function exportDeck(deck) {
  const lines = [`# ${deck.name}`];
  if (deck.legend) lines.push("Legend:", `1 ${deck.legend}`);
  if (deck.champion) lines.push("Champion:", `1 ${deck.champion}`);
  const main = Object.entries(deck.main).sort(byName);
  if (main.length) lines.push("Main Deck:", ...main.map(([n, c]) => `${c} ${n}`));
  if (deck.battlefields.length) lines.push("Battlefields:", ...deck.battlefields.map((n) => `1 ${n}`));
  const runes = Object.entries(deck.runes).sort(byName);
  if (runes.length) lines.push("Runes:", ...runes.map(([n, c]) => `${c} ${n}`));
  return lines.join("\n");
}

// Section names as other sites and players write them.
const HEADER_WORDS = [
  [/^(legends?|leggenda)$/i, "legend"],
  [/^((chosen\s*)?champions?|campione)$/i, "champion"],
  [/^battlefields?$/i, "battlefields"],
  [/^runes?(\s*deck)?$/i, "runes"],
  [/^(main\s*deck|maindeck|main|deck|mazzo|cards|carte)$/i, "main"],
];
const headerOf = (s) => HEADER_WORDS.find(([re]) => re.test(s.replace(/[*_]/g, "").trim()))?.[1] ?? null;

/** "3 Name", "3x Name", "Name x3", "Name (3)"; a trailing set code "(OGN-085)" or "OGN-085" is dropped. */
function parseLine(line) {
  let s = line.replace(/^[-*•]\s*/, "").trim();
  let count = 1;
  let m;
  if ((m = /^(\d{1,2})\s*[x×]?\s+(.+)$/i.exec(s))) [count, s] = [Number(m[1]), m[2]];
  else if ((m = /^(.+?)\s+[x×](\d{1,2})$/i.exec(s))) [s, count] = [m[1], Number(m[2])];
  else if ((m = /^(.+?)\s+\((\d{1,2})\)$/.exec(s))) [s, count] = [m[1], Number(m[2])];
  s = s.replace(/\s*\(?\b[A-Z]{2,4}-\d{2,3}[a-z*]?\)?\s*$/, "").trim();
  return { name: s, count };
}

/**
 * Read a deck list pasted from anywhere. Section headers (Legend, Champion,
 * Main Deck, Battlefields, Runes) are optional: without them each card goes
 * where its type says, and one copy of a matching champion unit becomes the
 * Chosen Champion. Returns { deck, unknown: [names not found] }.
 */
export function importDeck(text, catalog, name = "Mazzo importato") {
  let deck = newDeck(name);
  const unknown = [];
  let header = null;
  const champions = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const title = line.replace(/^#+\s*/, "").trim();
      if (title) deck.name = title.slice(0, 40);
      continue;
    }
    let body = line;
    const inline = /^([^:\d]{3,24}):\s*(.*)$/.exec(line); // "Legend: 1 Jinx, Loose Cannon" or "Runes:"
    if (inline && headerOf(inline[1])) {
      header = headerOf(inline[1]);
      body = inline[2];
    } else if (!/^\d/.test(line) && headerOf(line.replace(/\s*\(\d+\)$/, "")) && !catalog.byKey.has(nameKey(line))) {
      header = headerOf(line.replace(/\s*\(\d+\)$/, "")); // "Main Deck (40)"
      continue;
    }
    if (!body || /^\(?\d+\)?$/.test(body)) continue; // a header with its total
    const parsed = parseLine(body);
    const card = catalog.byKey.get(nameKey(parsed.name));
    if (!card) {
      unknown.push(parsed.name);
      continue;
    }
    const section = sectionOf(card);
    if (section === "legend") deck.legend = card.name;
    else if (header === "champion" && section === "main") {
      deck.champion = card.name;
      if (parsed.count > 1) deck.main[card.name] = (deck.main[card.name] ?? 0) + parsed.count - 1;
    } else if (section === "runes") deck.runes[card.name] = (deck.runes[card.name] ?? 0) + parsed.count;
    else if (section === "battlefields") {
      if (!deck.battlefields.includes(card.name)) deck.battlefields.push(card.name);
    } else {
      deck.main[card.name] = (deck.main[card.name] ?? 0) + parsed.count;
      if (card.supertype === "Champion") champions.push(card.name);
    }
  }
  // No "Champion:" section: one copy of a matching champion unit becomes the chosen champion.
  if (!deck.champion) {
    const pick = champions.find((n) => canBeChampion(catalog.byName.get(n), deck, catalog));
    if (pick) deck = makeChampion(deck, pick);
  }
  return { deck, unknown };
}

const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
function counts(obj, max) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj).slice(0, 120)) {
    const n = Math.trunc(Number(v));
    if (k && n > 0) out[k.slice(0, 60)] = Math.min(max, n);
  }
  return out;
}

/** Saved decks, checked (they may be old or tampered with). */
export function restoreDecks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d) => d && typeof d === "object")
    .slice(0, MAX_DECKS)
    .map((d) => ({
      id: text(d.id, 20) || newId(Date.now()),
      name: text(d.name, 40) || "Mazzo",
      legend: text(d.legend, 60),
      champion: text(d.champion, 60),
      main: counts(d.main, 99),
      runes: counts(d.runes, 99),
      battlefields: Array.isArray(d.battlefields) ? [...new Set(d.battlefields.filter((b) => typeof b === "string").map((b) => b.slice(0, 60)))].slice(0, 10) : [],
      updatedAt: Number(d.updatedAt) || 0,
    }));
}
