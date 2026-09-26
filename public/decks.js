// Mazzi: la scheda "Mazzi" dell'archivio e l'editor a immagini. Le regole di
// costruzione sono in deck-model.js; i mazzi restano su questo dispositivo.
// Le immagini arrivano dal server ufficiale di Riot, i link portano alla
// ricerca di Cardmarket (l'app non raccoglie prezzi né dati dal negozio).

import { getJSON } from "./api.js";
import { escapeHtml, domainColor } from "./markdown.js";
import { load, store } from "./storage.js";
import { icon } from "./icons.js";
import { toast, copyText } from "./chat.js";
import { cardImage, openCardDetail } from "./cards.js";
import { words } from "./suggest.js";
import {
  buildCatalog, newDeck, addCard, setCount, removeBattlefield, clearChampion, makeChampion, deckStats, deckProblems,
  exportDeck, importDeck, restoreDecks, fitsIdentity, identityOf, canBeChampion, copiesOf, sectionOf,
  MAIN_MIN, RUNES, BATTLEFIELDS, MAX_DECKS,
} from "./deck-model.js";

const KEY = "jrb.decks.v1";
const PAGE = 60;
const TYPE_LABEL = { Legend: "Leggenda", Unit: "Unità", Spell: "Spell", Gear: "Gear", "Unit Gear": "Unità / Gear", Battlefield: "Battlefield", Rune: "Runa" };
const TYPE_ORDER = ["Legend", "Unit", "Unit Gear", "Spell", "Gear", "Battlefield", "Rune"];
const FILTERS = [
  ["all", "Tutte"],
  ["Legend", "Leggende"],
  ["champion", "Campioni"],
  ["Unit", "Unità"],
  ["Spell", "Spell"],
  ["Gear", "Gear"],
  ["Battlefield", "Battlefield"],
  ["Rune", "Rune"],
];

const $ = (id) => document.getElementById(id);
const dialog = $("deckDialog");
const nameInput = $("deckName");
const summaryEl = $("deckSummary");
const deckPane = $("deckPane");
const search = $("deckSearch");
const filtersEl = $("deckFilters");
const onlyIdentity = $("deckIdentity");
const resultsEl = $("deckResults");

let decks = restoreDecks(load(KEY, []));
let catalog = null;
let loading = null;
let deck = null; // the deck being edited
let filter = "all";
let shown = PAGE;
let unknown = []; // names an import did not recognise
let listEl = null; // the "Mazzi" tab, set by initDecks

/** Cardmarket's search for a card (Riftbound, Italian site). */
export const cardmarketUrl = (name) =>
  `https://www.cardmarket.com/it/Riftbound/Products/Search?searchString=${encodeURIComponent(name)}`;

function loadCatalog() {
  loading ??= getJSON("/api/cards/deck")
    .then((data) => {
      catalog = buildCatalog(data.cards ?? []);
      for (const c of catalog.cards) c.words = words(`${c.name} ${(c.tags ?? []).join(" ")}`);
    })
    .catch(() => {
      loading = null; // offline or locked: try again next time
    });
  return loading;
}

function saveDeck() {
  if (!deck) return;
  decks = [deck, ...decks.filter((d) => d.id !== deck.id)].slice(0, MAX_DECKS);
  store(KEY, decks);
}

// --- Small pieces ------------------------------------------------------------
const thumb = (card, width = 120) =>
  card?.image
    ? `<img src="${escapeHtml(cardImage(card.image, width))}" alt="" loading="lazy" decoding="async" width="${width}" height="${Math.round(width * 1.4)}">`
    : `<span class="thumb-ph">${escapeHtml(card?.name ?? "?")}</span>`;

const dots = (card) => (card?.domains ?? []).filter((d) => d !== "Colorless").map((d) => `<i class="dom-dot" style="--dc:${domainColor(d)}" title="${escapeHtml(d)}"></i>`).join("");

const shopLink = (name) =>
  `<a class="icon-btn small shop" href="${escapeHtml(cardmarketUrl(name))}" target="_blank" rel="noopener" aria-label="Cerca ${escapeHtml(name)} su Cardmarket" title="Cerca su Cardmarket">${icon("cart")}</a>`;

/** "38/40 carte" while short; "42 carte" once there are enough (the Main Deck needs at least 40). */
const mainLabel = (n) => (n >= MAIN_MIN ? `${n} carte` : `${n}/${MAIN_MIN} carte`);

const ruleLink = (id) => `<a class="rule-ref" href="#regola-${id}" data-rule="${id}">${id}</a>`;

// --- The "Mazzi" tab: the list of decks ----------------------------------------
function statusOf(d) {
  if (!catalog) return "";
  const problems = deckProblems(d, catalog).length;
  return problems
    ? `<span class="deck-status warn">${icon("alert")}${problems} ${problems === 1 ? "problema" : "problemi"}</span>`
    : `<span class="deck-status ok">${icon("check")}Valido</span>`;
}

function renderList() {
  if (!listEl) return;
  const items = decks
    .map((d) => {
      const legend = catalog?.byName.get(d.legend);
      const s = catalog ? deckStats(d, catalog) : null;
      return `
        <li>
          <button type="button" class="deck-item" data-open-deck="${escapeHtml(d.id)}">
            <span class="deck-thumb">${legend ? thumb(legend, 120) : icon("deck")}</span>
            <span class="deck-info">
              <strong>${escapeHtml(d.name)}</strong>
              <span class="muted small">${legend ? escapeHtml(legend.name) : "Nessuna Leggenda"}</span>
              ${s ? `<span class="deck-counts">${mainLabel(s.main)} · ${s.runes}/${RUNES} rune · ${s.battlefields}/${BATTLEFIELDS} BF</span>` : ""}
              ${statusOf(d)}
            </span>
          </button>
        </li>`;
    })
    .join("");
  listEl.innerHTML = `
    <div class="deck-actions">
      <button type="button" class="primary-btn small" data-new-deck>${icon("plus")}Nuovo mazzo</button>
      <details class="deck-import">
        <summary class="chip-btn">${icon("copy")}Importa una lista</summary>
        <textarea id="deckImportText" class="field" rows="7" placeholder="Incolla la lista: una carta per riga, es. «3 Get Excited!». Le sezioni (Legend, Champion, Main Deck, Battlefields, Runes) sono facoltative."></textarea>
        <button type="button" class="primary-btn small" data-import-deck>Importa</button>
      </details>
    </div>
    ${
      decks.length
        ? `<ul class="deck-list">${items}</ul>`
        : `<div class="empty">${icon("deck")}<p>Nessun mazzo salvato.</p><p class="muted small">Crea un mazzo con le immagini delle carte: l'app controlla le regole di costruzione (103) e ti porta su Cardmarket per comprare le carte.</p></div>`
    }
    ${catalog ? "" : `<p class="muted small">${loading ? "Carico le carte…" : "Elenco delle carte non disponibile ora: riprova quando sei online."}</p>`}`;
}

// --- The editor ----------------------------------------------------------------
function curveHtml(curve) {
  const max = Math.max(1, ...curve);
  const bars = curve
    .map((n, cost) => {
      const label = cost === 7 ? "7+" : String(cost);
      return `
        <div class="curve-col" title="${n} ${n === 1 ? "carta" : "carte"} a costo ${label}">
          <span class="curve-n">${n || ""}</span>
          <span class="curve-bar" style="height:${Math.round((n / max) * 100)}%"></span>
          <span class="curve-x">${label}</span>
        </div>`;
    })
    .join("");
  const text = curve.map((n, cost) => `${cost === 7 ? "7+" : cost}: ${n}`).join(", ");
  return `<div class="curve" role="img" aria-label="Curva dei costi in Energy: ${text}">${bars}</div>`;
}

function slot(kind, card, extra = "") {
  const empty = kind === "legend" ? "Scegli la Leggenda" : "Scegli il Campione";
  if (!card) {
    return `<button type="button" class="deck-slot empty" data-pick="${kind}">${icon("plus")}<span><strong>${empty}</strong><span class="muted small">${
      kind === "legend" ? "Decide i domini del mazzo (103.1)" : "Un'unità campione della tua Leggenda (103.2.a)"
    }</span></span></button>`;
  }
  return `
    <div class="deck-slot">
      <button type="button" class="slot-art" data-info="${escapeHtml(card.name)}" aria-label="Testo di ${escapeHtml(card.name)}">${thumb(card, 160)}</button>
      <span class="slot-text">
        <span class="slot-kind">${kind === "legend" ? "Leggenda" : "Campione scelto"}</span>
        <strong>${escapeHtml(card.name)}</strong>
        <span class="slot-dots">${dots(card)}</span>
        ${extra}
      </span>
      <span class="slot-acts">
        <button type="button" class="chip-btn" data-pick="${kind}">Cambia</button>
        ${shopLink(card.name)}
      </span>
    </div>`;
}

function row(card, count, section) {
  const stepper =
    section === "battlefields"
      ? `<button type="button" class="icon-btn small" data-remove-bf="${escapeHtml(card.name)}" aria-label="Togli ${escapeHtml(card.name)}">${icon("close")}</button>`
      : `<span class="row-step">
          <button type="button" data-step="-1" data-section="${section}" data-name="${escapeHtml(card.name)}" aria-label="Una copia in meno">−</button>
          <output>${count}</output>
          <button type="button" data-step="1" data-section="${section}" data-name="${escapeHtml(card.name)}" aria-label="Una copia in più">+</button>
        </span>`;
  const champ =
    section === "main" && !deck.champion && canBeChampion(card, deck, catalog)
      ? `<button type="button" class="link-btn small" data-make-champion="${escapeHtml(card.name)}">Rendi Campione</button>`
      : "";
  return `
    <li class="deck-row">
      <button type="button" class="row-art" data-info="${escapeHtml(card.name)}" aria-label="Testo di ${escapeHtml(card.name)}">${thumb(card, 96)}</button>
      <span class="row-text">
        <span class="row-name">${escapeHtml(card.name)}</span>
        <span class="row-meta">${card.type === "Battlefield" || card.type === "Rune" ? "" : `<b class="cost">${card.energy}</b>`}${dots(card)}${champ}</span>
      </span>
      ${stepper}
      ${shopLink(card.name)}
    </li>`;
}

function renderDeck() {
  if (!deck || !catalog) return;
  const s = deckStats(deck, catalog);
  const problems = deckProblems(deck, catalog);
  const legend = catalog.byName.get(deck.legend);
  const champion = catalog.byName.get(deck.champion);
  summaryEl.innerHTML = `
    <span class="${s.main >= MAIN_MIN ? "ok" : ""}">${mainLabel(s.main)}</span>
    <span class="${s.runes === RUNES ? "ok" : ""}">${s.runes}/${RUNES} rune</span>
    <span class="${s.battlefields === BATTLEFIELDS ? "ok" : ""}">${s.battlefields}/${BATTLEFIELDS} BF</span>
    ${problems.length ? `<span class="warn">${icon("alert")}${problems.length} ${problems.length === 1 ? "problema" : "problemi"}</span>` : `<span class="ok">${icon("check")}Valido</span>`}`;

  const groups = new Map();
  for (const [name, n] of Object.entries(deck.main)) {
    const card = catalog.byName.get(name) ?? { name, type: "?", energy: 0, domains: [] };
    const type = card.type === "Unit Gear" ? "Unit" : card.type;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push([card, n]);
  }
  const mainHtml = [...groups.entries()]
    .sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]))
    .map(([type, list]) => {
      list.sort((a, b) => (a[0].energy ?? 0) - (b[0].energy ?? 0) || a[0].name.localeCompare(b[0].name));
      const total = list.reduce((acc, [, n]) => acc + n, 0);
      return `<h4 class="deck-group">${TYPE_LABEL[type] ?? type} <span>${total}</span></h4><ul class="deck-rows">${list.map(([c, n]) => row(c, n, "main")).join("")}</ul>`;
    })
    .join("");
  const bfHtml = deck.battlefields.map((n) => row(catalog.byName.get(n) ?? { name: n, domains: [] }, 1, "battlefields")).join("");
  const runeHtml = Object.entries(deck.runes)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([n, c]) => row(catalog.byName.get(n) ?? { name: n, domains: [] }, c, "runes"))
    .join("");
  const types = s.types;

  deckPane.innerHTML = `
    ${
      problems.length
        ? `<div class="deck-problems"><p><strong>Da sistemare</strong></p><ul>${problems.map((p) => `<li>${escapeHtml(p.text)} (${ruleLink(p.rule)})</li>`).join("")}</ul></div>`
        : `<p class="deck-ok">${icon("check")}Il mazzo rispetta le regole di costruzione (103).</p>`
    }
    ${unknown.length ? `<p class="deck-unknown">${icon("alert")}Non riconosciute nell'import: ${unknown.map(escapeHtml).join(", ")}</p>` : ""}
    <div class="deck-slots">${slot("legend", legend)}${slot("champion", champion)}</div>
    <div class="deck-stats">
      <div>
        <p class="setup-label">Curva dei costi</p>
        ${curveHtml(s.curve)}
      </div>
      <p class="deck-types">Unità <b>${types.Unit}</b> · Spell <b>${types.Spell}</b> · Gear <b>${types.Gear}</b>${s.signature ? ` · Signature <b>${s.signature}</b>/3` : ""}</p>
    </div>
    <h3 class="deck-section">Main Deck <span>${mainLabel(s.main)}</span></h3>
    ${mainHtml || `<p class="muted small">Tocca le carte in «Aggiungi carte» per metterle nel mazzo.</p>`}
    <h3 class="deck-section">Battlefield <span>${s.battlefields}/${BATTLEFIELDS}</span></h3>
    ${bfHtml ? `<ul class="deck-rows">${bfHtml}</ul>` : `<p class="muted small">Tre battlefield diversi (1v1, 480.4.a).</p>`}
    <h3 class="deck-section">Rune Deck <span>${s.runes}/${RUNES}</span></h3>
    ${runeHtml ? `<ul class="deck-rows">${runeHtml}</ul>` : `<p class="muted small">Dodici rune dei domini della Leggenda (103.3).</p>`}
    <div class="deck-foot">
      <button type="button" class="chip-btn" data-copy-deck>${icon("copy")}Copia la lista</button>
      <a class="chip-btn" href="https://www.cardmarket.com/it/Riftbound/Products/Singles" target="_blank" rel="noopener">${icon("cart")}Riftbound su Cardmarket</a>
      <button type="button" class="chip-btn danger" data-delete-deck>${icon("trash")}Elimina il mazzo</button>
    </div>`;
}

/** Cards for the "Aggiungi carte" pane: search words, type filter, the legend's domains. */
function matches() {
  const typed = words(search.value);
  const identity = identityOf(deck, catalog);
  const useIdentity = onlyIdentity.checked && deck.legend;
  return catalog.cards
    .filter((c) => {
      if (filter === "champion") {
        if (c.supertype !== "Champion" || c.type !== "Unit") return false;
        if (deck.legend && !canBeChampion(c, deck, catalog)) return false;
      } else if (filter === "all") {
        if (c.type === "Legend" && deck.legend) return false; // chosen: the other legends are under "Leggende"
      } else if (c.type !== filter && !(filter === "Unit" && c.type === "Unit Gear")) return false;
      if (useIdentity && c.type !== "Legend" && !fitsIdentity(c, identity)) return false;
      return typed.every((t) => c.words.some((w) => w.startsWith(t)));
    })
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (a.energy ?? 0) - (b.energy ?? 0) || a.name.localeCompare(b.name),
    );
}

function inDeck(card) {
  const section = sectionOf(card);
  if (section === "legend") return deck.legend === card.name ? 1 : 0;
  if (section === "runes") return deck.runes[card.name] ?? 0;
  if (section === "battlefields") return deck.battlefields.includes(card.name) ? 1 : 0;
  return copiesOf(deck, card.name);
}

function renderResults() {
  if (!deck || !catalog) return;
  filtersEl.innerHTML = FILTERS.map(
    ([key, label]) => `<button type="button" class="dom-pill" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`,
  ).join("");
  const list = matches();
  const tiles = list
    .slice(0, shown)
    .map((c) => {
      const n = inDeck(c);
      return `
        <div class="dcard${n ? " in" : ""}">
          <button type="button" class="dcard-add" data-add="${escapeHtml(c.name)}" aria-label="Aggiungi ${escapeHtml(c.name)}">
            ${thumb(c, 240)}
            ${n ? `<span class="dcard-count">×${n}</span>` : ""}
          </button>
          <button type="button" class="dcard-info" data-info="${escapeHtml(c.name)}" aria-label="Testo di ${escapeHtml(c.name)}">${icon("book")}</button>
          <span class="dcard-name">${escapeHtml(c.name)}</span>
        </div>`;
    })
    .join("");
  resultsEl.innerHTML = list.length
    ? `<p class="card-count">${list.length} ${list.length === 1 ? "carta" : "carte"} · tocca per aggiungere</p>
       <div class="deck-grid">${tiles}</div>
       ${list.length > shown ? `<button type="button" class="ghost-btn more" data-more>Mostra altre</button>` : ""}`
    : `<p class="card-count">Nessuna carta con questi filtri.</p>`;
}

function render() {
  renderDeck();
  renderResults();
  renderList();
}

function setPane(pane) {
  dialog.dataset.pane = pane;
  for (const b of dialog.querySelectorAll("[data-pane]")) b.setAttribute("aria-pressed", String(b.dataset.pane === pane));
}

async function openEditor(d, pane = "deck") {
  deck = d;
  unknown = [];
  filter = "all";
  shown = PAGE;
  search.value = "";
  nameInput.value = deck.name;
  setPane(pane);
  if (!dialog.open) dialog.showModal();
  summaryEl.textContent = "Carico le carte…";
  deckPane.innerHTML = "";
  resultsEl.innerHTML = "";
  await loadCatalog();
  if (!catalog) {
    summaryEl.textContent = "Elenco delle carte non disponibile: serve la connessione la prima volta.";
    return;
  }
  onlyIdentity.checked = true;
  render();
}

/** Full text of a card, above the editor. */
async function showCard(name) {
  try {
    const data = await getJSON(`/api/cards?limit=1&q=${encodeURIComponent(name)}`);
    const card = data.cards?.find((c) => c.name === name);
    if (card) openCardDetail(card);
  } catch {
    toast("Testo della carta non disponibile ora");
  }
}

function change(next, note) {
  deck = next;
  saveDeck();
  render();
  if (note) toast(note);
}

function onEditorClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.pane) setPane(d.pane);
  else if (d.add) {
    const card = catalog.byName.get(d.add);
    const r = addCard(deck, card, catalog);
    change(r.deck, r.note);
    navigator.vibrate?.(8);
  } else if (d.info) showCard(d.info);
  else if (d.step) {
    const current = d.section === "runes" ? deck.runes[d.name] ?? 0 : deck.main[d.name] ?? 0;
    change(setCount(deck, d.section, d.name, current + Number(d.step)));
  } else if (d.removeBf) change(removeBattlefield(deck, d.removeBf));
  else if (d.makeChampion) change(makeChampion(deck, d.makeChampion), `Campione scelto: ${d.makeChampion}`);
  else if (d.pick) {
    if (d.pick === "champion" && deck.champion) deck = clearChampion(deck);
    filter = d.pick === "legend" ? "Legend" : "champion";
    shown = PAGE;
    search.value = "";
    setPane("add");
    render();
  } else if (d.filter) {
    filter = d.filter;
    shown = PAGE;
    renderResults();
  } else if ("more" in d) {
    shown += PAGE;
    renderResults();
  } else if ("copyDeck" in d) {
    copyText(exportDeck(deck)).then((ok) => toast(ok ? "Lista copiata ✓" : "Copia non riuscita"));
  } else if ("deleteDeck" in d) {
    if (!confirm(`Eliminare il mazzo «${deck.name}»?`)) return;
    decks = decks.filter((x) => x.id !== deck.id);
    store(KEY, decks);
    deck = null;
    dialog.close();
    renderList();
  }
}

function onListClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if ("newDeck" in d) {
    const created = newDeck(`Mazzo ${decks.length + 1}`);
    decks = [created, ...decks].slice(0, MAX_DECKS);
    store(KEY, decks);
    openEditor(created, "add").then(() => {
      filter = "Legend";
      renderResults();
    });
  } else if (d.openDeck) {
    const found = decks.find((x) => x.id === d.openDeck);
    if (found) openEditor(found);
  } else if ("importDeck" in d) {
    const text = $("deckImportText").value;
    if (!text.trim()) return;
    loadCatalog().then(() => {
      if (!catalog) return toast("Elenco delle carte non disponibile ora");
      const result = importDeck(text, catalog);
      decks = [result.deck, ...decks].slice(0, MAX_DECKS);
      store(KEY, decks);
      openEditor(result.deck).then(() => {
        unknown = result.unknown;
        renderDeck();
        const n = result.unknown.length;
        toast(n ? `Importato: ${n} ${n === 1 ? "riga non riconosciuta" : "righe non riconosciute"}` : "Mazzo importato ✓");
      });
    });
  }
}

/** The "Mazzi" tab of the archive: returns { activate } like the other tabs. */
export function initDecks(container) {
  listEl = container;
  listEl.addEventListener("click", onListClick);
  dialog.addEventListener("click", onEditorClick);
  dialog.addEventListener("close", () => renderList());
  nameInput.addEventListener("input", () => {
    if (!deck) return;
    deck = { ...deck, name: nameInput.value.trim().slice(0, 40) || "Mazzo", updatedAt: Date.now() };
    saveDeck();
  });
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      shown = PAGE;
      renderResults();
    }, 120);
  });
  onlyIdentity.addEventListener("change", () => {
    shown = PAGE;
    renderResults();
  });
  renderList();
  return {
    activate() {
      renderList();
      loadCatalog().then(renderList);
    },
    search() {},
  };
}
