// Il regolamento: testo compatto per il prompt del judge, più un indice delle
// regole numerate per verificare le citazioni e cercare senza usare Gemini.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(here, "..", "data", "riftbound-core-rules.txt");

const RULE_START = /^\d{3}\.(?:[0-9a-z]+\.?)*\s/; // "135.", "461.4", "359.3.f.3.a.1"
const OWN_LINE = /^(?:examples?\b|notes?\b|see rule\b|\* |• )/i;

/**
 * Strip the PDF layout from the rules (column padding, lines wrapped mid-sentence,
 * zero-width characters) without touching a single word: every rule, example
 * and "See rule" note starts a new line; wrapped lines are joined back. This
 * cuts the tokens sent with every question. Idempotent.
 */
export function compactRules(text) {
  const out = [];
  let paragraphBreak = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[ \t]+/g, " ").trim();
    if (!line) {
      paragraphBreak = true;
      continue;
    }
    const startsItem = RULE_START.test(line) || OWN_LINE.test(line);
    if (!paragraphBreak && !startsItem) {
      out[out.length - 1] += ` ${line}`; // a line wrapped by the PDF layout
    } else {
      // Keep a blank line only where it is the sole separator (e.g. between example items).
      if (paragraphBreak && !startsItem && out.length) out.push("");
      out.push(line);
    }
    paragraphBreak = false;
  }
  return `${out.join("\n")}\n`;
}

export const RULES_TEXT = compactRules(fs.readFileSync(RULES_PATH, "utf8"));

const fold = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "309.1.A." -> "309.1.a" */
const normalizeId = (ref) => String(ref ?? "").trim().toLowerCase().replace(/\.$/, "");

// --- Index: id -> { id, text, notes[] }, in document order --------------------
const ENTRIES = new Map();
const CHILDREN = new Map(); // parent id -> child ids
{
  let current = null;
  for (const line of RULES_TEXT.split("\n")) {
    const m = /^(\d{3}\.(?:[0-9a-z]+\.?)*)\s(.*)$/.exec(line);
    if (m) {
      const id = normalizeId(m[1]);
      if (ENTRIES.has(id)) continue;
      current = { id, text: m[2], notes: [] };
      ENTRIES.set(id, current);
      const parent = parentOf(id);
      if (parent) {
        if (!CHILDREN.has(parent)) CHILDREN.set(parent, []);
        CHILDREN.get(parent).push(id);
      }
    } else if (line.trim() && current) {
      current.notes.push(line.trim()); // examples and "See rule" notes
    }
  }
}

/** Nearest existing ancestor: "309.1.a" -> "309.1". */
function parentOf(id) {
  const parts = id.split(".");
  for (let n = parts.length - 1; n > 0; n--) {
    const p = parts.slice(0, n).join(".");
    if (ENTRIES.has(p)) return p;
  }
  return null;
}

// Short top-level entries are headings ("341. Showdowns", "809. Deflect"): they
// double as the glossary, and a heading owns the rules that follow it up to the
// next heading ("341. Showdowns" -> 342, 343…).
const isHeading = (text) => text.split(" ").length <= 4 && !/[.:]$/.test(text);
const TOP_LEVEL = [...ENTRIES.keys()].filter((id) => /^\d{3}$/.test(id));
const HEADINGS = new Set(TOP_LEVEL.filter((id) => isHeading(ENTRIES.get(id).text)));
const TERMS = new Map();
for (const id of HEADINGS) {
  const key = fold(ENTRIES.get(id).text);
  if (!TERMS.has(key)) TERMS.set(key, id);
}

/** Direct sub-rules; for a heading without numbered sub-rules, the rules of its section. */
function subRules(id) {
  if (CHILDREN.has(id) || !HEADINGS.has(id)) return CHILDREN.get(id) ?? [];
  const out = [];
  for (let i = TOP_LEVEL.indexOf(id) + 1; i < TOP_LEVEL.length && !HEADINGS.has(TOP_LEVEL[i]); i++) out.push(TOP_LEVEL[i]);
  return out;
}

/** The section heading a top-level rule belongs to (null for headings). */
function headingOf(topId) {
  for (let i = TOP_LEVEL.indexOf(topId); i >= 0; i--) {
    if (HEADINGS.has(TOP_LEVEL[i])) return TOP_LEVEL[i] === topId ? null : TOP_LEVEL[i];
  }
  return null;
}

const SEARCH_TEXT = new Map([...ENTRIES.values()].map((e) => [e.id, fold(`${e.text} ${e.notes.join(" ")}`)]));

export const RULE_COUNT = ENTRIES.size;

/** A rule number ("309.1.a") or a keyword/term ("Deflect", "Assault 2", "Showdown"). */
export function resolveRule(ref) {
  const id = normalizeId(ref);
  if (ENTRIES.has(id)) return id;
  const term = fold(ref).replace(/ \d+$/, ""); // "Assault 2" -> "assault"
  for (const t of [term, `${term}s`, term.replace(/s$/, ""), term.replace(/ed$/, "")]) {
    if (TERMS.has(t)) return TERMS.get(t);
  }
  return null;
}

const brief = (id) => ({ id, text: ENTRIES.get(id).text });

/** A rule with its ancestors (context) and its sub-rules (up to `limit`). */
export function getRule(ref, limit = 60) {
  const id = resolveRule(ref);
  if (!id) return null;
  const parents = [];
  for (let p = parentOf(id); p; p = parentOf(p)) parents.unshift(brief(p));
  const heading = headingOf(parents[0]?.id ?? id);
  if (heading) parents.unshift(brief(heading));

  const children = [];
  let total = 0;
  const walk = (ids, depth) => {
    for (const cid of ids) {
      total++;
      if (children.length < limit) children.push({ ...brief(cid), notes: ENTRIES.get(cid).notes, depth });
      walk(CHILDREN.get(cid) ?? [], depth + 1);
    }
  };
  walk(subRules(id), 1);
  return { ...ENTRIES.get(id), parents, children, truncated: total > children.length };
}

/** Full-text search over rules and their notes. */
export function searchRules(q, limit = 30) {
  const direct = resolveRule(q);
  const words = fold(q).split(" ").filter(Boolean);
  if (!words.length) return { total: 0, rules: [] };
  const hits = [];
  for (const [id, hay] of SEARCH_TEXT) {
    if (id === direct) continue;
    if (!words.every((w) => hay.includes(w))) continue;
    const title = fold(ENTRIES.get(id).text);
    const score = (title.startsWith(words.join(" ")) ? 2 : 0) + (words.every((w) => title.includes(w)) ? 1 : 0);
    hits.push([score, id]);
  }
  hits.sort((a, b) => b[0] - a[0]); // stable: document order within a score
  const ids = direct ? [direct, ...hits.map(([, id]) => id)] : hits.map(([, id]) => id);
  return { total: ids.length, rules: ids.slice(0, limit).map(brief) };
}
