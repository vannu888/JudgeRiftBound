// Suggerimenti mentre scrivi la domanda: riconosce il nome di carta che stai
// digitando e propone le carte possibili; ogni parola in più restringe la scelta.
// I nomi si scaricano una volta sola (~9 KB) e restano in memoria anche offline.

import { getJSON } from "./api.js";
import { escapeHtml, domainColor } from "./markdown.js";

const MAX_SHOWN = 8;
const MAX_WORDS = 5; // the longest card names

const TYPE_LABEL = { Unit: "Unità", Legend: "Leggenda", Battlefield: "Battlefield", Rune: "Runa", Card: "Segnalino" };

/** "Kai'Sa, Survivor" -> ["kaisa", "survivor"] (accents, apostrophes and punctuation dropped). */
export const words = (s) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Cards whose name starts with the typed words, each typed word being the start
 * of a name word: "fall" -> Falling Comet…, "vi d" -> Vi, Destructive. Names
 * matching every word but the last exactly come first, then shorter names.
 */
export function suggest(entries, typed, limit = MAX_SHOWN) {
  const tw = words(typed);
  if (!tw.length) return [];
  const found = new Map(); // card name -> rank
  for (const e of entries) {
    if (e.words.length < tw.length) continue;
    let exact = true;
    let ok = true;
    for (let i = 0; i < tw.length && ok; i++) {
      if (!e.words[i].startsWith(tw[i])) ok = false;
      else if (i < tw.length - 1 && e.words[i] !== tw[i]) exact = false;
    }
    if (!ok) continue;
    const rank = (exact ? 0 : 1000) + e.words.length * 10 + (e.alias ? 5 : 0);
    if (!found.has(e.card.name) || found.get(e.card.name).rank > rank) found.set(e.card.name, { card: e.card, rank });
  }
  return [...found.values()]
    .sort((a, b) => a.rank - b.rank || a.card.name.localeCompare(b.card.name))
    .slice(0, limit)
    .map((f) => f.card);
}

/** Rows from /api/cards/names -> searchable entries (a card appears once per spelling). */
export function buildEntries(rows) {
  const entries = [];
  for (const [name, type, domain, other = []] of rows) {
    const card = { name, type, domain };
    entries.push({ card, words: words(name), alias: false });
    for (const alt of other) entries.push({ card, words: words(alt), alias: true });
  }
  return entries;
}

/**
 * The name being typed just before the caret, as the longest run of words that
 * still matches some card: [start index, suggestions]. Short lowercase words
 * ("la", "con") are ordinary Italian, so a lowercase start needs 4 letters.
 */
export function fragmentAt(entries, text, caret) {
  if (/[\p{L}\p{N}]/u.test(text.charAt(caret))) return null; // in the middle of a word
  const before = text.slice(Math.max(0, caret - 80), caret);
  const offset = caret - before.length;
  // Word starts, not crossing the end of a sentence.
  const tokens = [...before.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’!-]*/gu)];
  if (!tokens.length) return null;
  const last = tokens.at(-1);
  if (last.index + last[0].length !== before.length) return null; // the caret follows a space
  for (let k = Math.min(MAX_WORDS, tokens.length); k >= 1; k--) {
    const first = tokens[tokens.length - k];
    const fragment = before.slice(first.index);
    if (/[.?!;:\n]/.test(fragment.slice(0, -1))) continue;
    const letters = fragment.replace(/[^\p{L}\p{N}]/gu, "");
    const capital = /^\p{Lu}/u.test(fragment);
    if (letters.length < (capital ? 2 : 4)) continue;
    const found = suggest(entries, fragment);
    if (found.length) return { start: offset + first.index, found };
  }
  return null;
}

/** Wire the suggestion bar to the question box. `onChange` runs after a name is inserted. */
export function initSuggestions({ input, bar, onChange }) {
  let entries = null;
  let loading = null;
  let current = null; // { start, found }
  let dismissed = false;
  let blurTimer;

  const load = () => {
    loading ??= getJSON("/api/cards/names")
      .then((data) => {
        entries = buildEntries(data.names ?? []);
      })
      .catch(() => {
        loading = null; // offline or locked: try again on the next keystroke
      });
    return loading;
  };

  const hide = () => {
    current = null;
    bar.hidden = true;
    bar.replaceChildren();
  };

  const render = () => {
    bar.innerHTML = current.found
      .map(
        (c, i) => `
        <button type="button" class="sug" role="option" data-i="${i}" style="--dc:${domainColor(c.domain)}">
          <span class="sug-name">${escapeHtml(c.name)}</span><span class="sug-type">${escapeHtml(TYPE_LABEL[c.type] ?? c.type)}</span>
        </button>`,
      )
      .join("");
    bar.hidden = false;
    bar.scrollLeft = 0;
  };

  const update = () => {
    if (!entries || dismissed || input.selectionStart !== input.selectionEnd) return hide();
    current = fragmentAt(entries, input.value, input.selectionStart);
    // Nothing to offer once the whole name has been written.
    if (!current || (current.found.length === 1 && words(current.found[0].name).join(" ") === words(input.value.slice(current.start, input.selectionStart)).join(" "))) return hide();
    render();
  };

  const accept = (i) => {
    const card = current?.found[i];
    if (!card) return;
    const caret = input.selectionStart;
    const after = input.value.slice(caret);
    const insert = card.name + (/^\s/.test(after) ? "" : " ");
    input.value = input.value.slice(0, current.start) + insert + after;
    const pos = current.start + insert.length;
    input.setSelectionRange(pos, pos);
    hide();
    input.focus();
    onChange?.();
  };

  input.addEventListener("input", () => {
    clearTimeout(blurTimer);
    dismissed = false;
    if (entries) update();
    else load().then(update);
  });
  input.addEventListener("focus", () => {
    clearTimeout(blurTimer);
    load();
  });
  input.addEventListener("click", () => entries && update());
  input.addEventListener("blur", () => {
    blurTimer = setTimeout(hide, 150);
  });
  input.addEventListener("keydown", (e) => {
    if (bar.hidden) return;
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      accept(0);
    } else if (e.key === "Escape") {
      dismissed = true;
      hide();
    }
  });
  // Keep the keyboard open: a tap or click on a suggestion must not take the focus away from the box.
  for (const type of ["pointerdown", "mousedown"]) bar.addEventListener(type, (e) => e.preventDefault());
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-i]");
    if (btn) accept(Number(btn.dataset.i));
  });

  return { hide };
}
