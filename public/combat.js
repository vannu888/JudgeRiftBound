// Calcolatore di combattimento, con il telefono al centro del tavolo come la
// modalità tavolo: la metà in basso è tua, quella in alto (capovolta) è
// dell'avversario. Le regole di calcolo sono in combat-model.js.

import { TOKENS, makeUnit, mightOf, resolveCombat, describeCombat, restoreCombat } from "./combat-model.js";
import { getJSON } from "./api.js";
import { escapeHtml, renderCardText } from "./markdown.js";
import { load, store } from "./storage.js";
import { icon } from "./icons.js";
import { words } from "./suggest.js";
import { playerNames, scoreConquer } from "./score.js";

const KEY = "jrb.combat.v1";
const RECENT_KEY = "jrb.combat.recent"; // the last units picked from the cards, for one-tap adding
const MAX_RECENT = 10;
// Same colours and artwork as table mode: gold for you, teal for the opponent.
const SIDES = {
  bottom: { hue: "#d9b45f", tint: "#2a2314", player: 0, fallback: "Tu" },
  top: { hue: "#35c7ba", tint: "#0e2a29", player: 1, fallback: "Avversario" },
};

const $ = (id) => document.getElementById(id);
const dialog = $("combatDialog");
const body = $("combatBody");
const addDialog = $("combatAdd");
const addTitle = $("combatAddTitle");
const addBody = $("combatAddBody");
const search = $("combatSearch");

let state = restoreCombat(load(KEY));
let catalog = null; // every unit: { name, base, assault, shield, tank, backline, check, words }
let loading = null;
let editing = null; // { side, id } of the unit whose modifiers are open
let adding = "bottom"; // the side the add panel adds to
let added = []; // names added since the panel opened
let generic = 2; // Might of a unit added without a card
let scored = false; // this combat's Conquer is already on the scoreboard
let recent = (() => {
  const list = load(RECENT_KEY, []);
  return Array.isArray(list) ? list.slice(0, MAX_RECENT).map(makeUnit) : [];
})();
const texts = new Map(); // card name -> rules text, fetched when its modifiers open

const other = (side) => (side === "top" ? "bottom" : "top");
const roleOf = (side) => (state.attacker === side ? "attack" : "defend");
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const names = () => {
  const p = playerNames();
  return { bottom: p?.[0]?.trim() || SIDES.bottom.fallback, top: p?.[1]?.trim() || SIDES.top.fallback };
};

function save() {
  scored = false; // a different combat: its Conquer has not been scored yet
  store(KEY, state);
}

function loadCatalog() {
  loading ??= getJSON("/api/cards/units")
    .then((data) => {
      catalog = (data.units ?? []).map(([name, base, assault, shield, flags]) => ({
        name,
        base,
        assault,
        shield,
        tank: Boolean(flags & 1),
        backline: Boolean(flags & 2),
        check: Boolean(flags & 4),
        words: words(name),
      }));
    })
    .catch(() => {
      loading = null; // offline or locked: tokens and generic units still work
    });
  return loading;
}

// --- Views -------------------------------------------------------------------
function tile(u, side, r) {
  const role = roleOf(side);
  const fate = (side === state.attacker ? r.toAttackers : r.toDefenders).get(u.id);
  const facing = state[other(side)].length > 0;
  const tags = [];
  if (role === "attack" && u.assault) tags.push(`Assault ${u.assault}`);
  if (role === "defend" && u.shield) tags.push(`Shield ${u.shield}`);
  if (u.tank) tags.push("Tank");
  if (u.backline) tags.push("Backline");
  if (u.buff) tags.push("Buff");
  if (u.temp) tags.push(`${signed(u.temp)} turno`);
  if (u.gear) tags.push(`${signed(u.gear)} equip.`);
  if (u.stunned) tags.push("Stordita");
  if (u.first) tags.push("Per prima");
  const might = mightOf(u, role);
  let end = "";
  if (facing && fate.dies) end = `<span class="cu-fate dies">${icon("close")}Muore</span>`;
  else if (facing && fate.assigned + u.damage) end = `<span class="cu-fate">${fate.assigned + u.damage}/${might} danni</span>`;
  return `
    <button type="button" class="c-unit${facing && fate.dies ? " dies" : ""}" data-unit="${u.id}" data-side="${side}">
      <span class="cu-might">${might}</span>
      <span class="cu-name">${escapeHtml(u.name)}</span>
      ${u.check ? `<span class="cu-check" title="Il testo della carta può cambiare il combattimento">!</span>` : ""}
      ${tags.length ? `<span class="cu-tags">${tags.map((t) => `<i>${t}</i>`).join("")}</span>` : ""}
      ${end}
    </button>`;
}

const OUTCOME = {
  conquer: { attack: ["win", "Vinci il combattimento: conquisti il battlefield"], defend: ["lose", "Perdi il combattimento: il battlefield passa all'avversario"] },
  defended: { attack: ["lose", "Perdi il combattimento: le tue unità vengono distrutte"], defend: ["win", "Vinci il combattimento: tieni il battlefield"] },
  recalled: { attack: ["lose", "Perdi il combattimento: le tue unità rimaste tornano in base"], defend: ["win", "Vinci il combattimento: tieni il battlefield"] },
  none: { attack: ["even", "Tutte le unità vengono distrutte: il battlefield resta senza controllo"], defend: ["even", "Tutte le unità vengono distrutte: il battlefield resta senza controllo"] },
};

function foot(side, r) {
  if (!r.outcome) {
    const hint = state[side].length ? "Aggiungi le unità dell'altro lato" : "Aggiungi le tue unità";
    return `<div class="c-foot"><p class="c-status">${hint}</p></div>`;
  }
  const role = roleOf(side);
  const [kind, text] = OUTCOME[r.outcome][role];
  const miss = role === "attack" ? r.attackMissing : r.defenseMissing;
  let hint = "Elimini tutte le unità avversarie";
  if (miss) {
    hint =
      miss.forNext === miss.forAll
        ? `Con +${miss.forAll} Might elimini tutte le unità avversarie`
        : `Con +${miss.forNext} Might elimini anche ${escapeHtml(miss.next)} · con +${miss.forAll} tutte`;
  }
  let action = "";
  if (r.outcome === "conquer" && role === "attack" && playerNames()) {
    action = scored
      ? `<button type="button" class="chip-btn" disabled>${icon("flag")}Conquista segnata</button>`
      : `<button type="button" class="primary-btn small" data-score-conquer>${icon("flag")}Segna la Conquista</button>`;
  }
  return `
    <div class="c-foot">
      <p class="c-status ${kind}">${text}</p>
      <p class="c-hint">${hint}</p>
      ${action}
    </div>`;
}

function sheet(u, side) {
  const role = roleOf(side);
  const step = (field, label, shown) => `
    <div class="cs-step">
      <span>${label}</span>
      <div class="stepper">
        <button type="button" data-inc="${field}" data-d="-1" aria-label="${label}: meno">−</button>
        <output>${shown}</output>
        <button type="button" data-inc="${field}" data-d="1" aria-label="${label}: più">+</button>
      </div>
    </div>`;
  const toggle = (field, label) =>
    `<button type="button" class="cs-toggle" data-flip="${field}" aria-pressed="${u[field]}">${label}</button>`;
  const text = texts.get(u.name);
  return `
    <div class="c-sheet" role="group" aria-label="Modifica ${escapeHtml(u.name)}">
      <div class="cs-head">
        <p><strong>${escapeHtml(u.name)}</strong><span>Might ${mightOf(u, role)} in ${role === "attack" ? "attacco" : "difesa"}</span></p>
        <button type="button" class="icon-btn" data-dup aria-label="Duplica" title="Duplica">${icon("copy")}</button>
        <button type="button" class="icon-btn danger" data-remove aria-label="Rimuovi" title="Rimuovi">${icon("trash")}</button>
        <button type="button" class="primary-btn small" data-done>Fatto</button>
      </div>
      <div class="cs-grid">
        ${step("base", "Might base", u.base)}
        ${step("temp", "Questo turno", signed(u.temp))}
        ${step("damage", "Danni subiti", u.damage)}
        ${step("assault", "Assault", u.assault)}
        ${step("shield", "Shield", u.shield)}
        ${step("gear", "Bonus equip", signed(u.gear))}
      </div>
      <div class="cs-toggles">
        ${toggle("buff", "Buff +1")}${toggle("stunned", "Stordita")}${toggle("tank", "Tank")}${toggle("backline", "Backline")}${toggle("first", "Danni per prima")}
      </div>
      ${text ? `<div class="cs-text">${renderCardText(text)}</div>` : ""}
    </div>`;
}

function half(side, r) {
  const s = SIDES[side];
  const role = roleOf(side);
  const u = editing?.side === side ? state[side].find((x) => x.id === editing.id) : null;
  return `
    <section class="side side-${side}" data-side="${side}">
      <div class="cpanel" style="--hue:${s.hue};--tint:${s.tint}">
        <div class="c-head">
          <p class="c-who">${icon(role === "attack" ? "sword" : "shield")}<span>${role === "attack" ? "Attacco" : "Difesa"} · ${escapeHtml(names()[side])}</span></p>
          <p class="c-total"><b>${side === state.attacker ? r.attack : r.defense}</b><span>Might</span></p>
        </div>
        <div class="c-units">
          ${state[side].map((x) => tile(x, side, r)).join("")}
          <button type="button" class="c-add" data-add="${side}">${icon("plus")}<span>Unità</span></button>
        </div>
        ${foot(side, r)}
        ${u ? sheet(u, side) : ""}
      </div>
    </section>`;
}

function render() {
  // Keep each list where it was scrolled to: every tap redraws the screen.
  const scrolls = [...body.querySelectorAll(".c-units, .c-sheet")].map((el) => [el.className, el.closest("[data-side]").dataset.side, el.scrollTop]);
  const r = resolveCombat(state[state.attacker], state[other(state.attacker)]);
  const empty = !state.bottom.length && !state.top.length;
  body.innerHTML = `
    <div class="table combat">
      ${half("top", r)}
      <div class="table-mid">
        <button type="button" class="tm-btn" data-swap aria-label="Scambia attacco e difesa">${icon("swap")}</button>
        <button type="button" class="tm-btn" data-ask aria-label="Chiedi al judge" ${r.outcome ? "" : "disabled"}>${icon("scale")}</button>
        <button type="button" class="tm-btn" data-clear aria-label="Nuovo combattimento" ${empty ? "disabled" : ""}>${icon("refresh")}</button>
        <button type="button" class="tm-btn" data-close-combat aria-label="Chiudi il combattimento">${icon("close")}</button>
      </div>
      ${half("bottom", r)}
    </div>`;
  for (const [cls, side, top] of scrolls) {
    const el = body.querySelector(`[data-side="${side}"] [class="${cls}"]`);
    if (el) el.scrollTop = top;
  }
  if (editing) showText(state[editing.side].find((x) => x.id === editing.id));
}

/** The card text under its modifiers: conditional abilities are up to the players. */
async function showText(u) {
  if (!u || texts.has(u.name) || !catalog?.some((c) => c.name === u.name)) return;
  texts.set(u.name, "");
  try {
    const data = await getJSON(`/api/cards?type=Unit&limit=1&q=${encodeURIComponent(u.name)}`);
    const card = data.cards?.find((c) => c.name === u.name);
    if (card?.text) {
      texts.set(u.name, card.text);
      if (editing && dialog.open) render();
    }
  } catch {
    texts.delete(u.name); // try again next time
  }
}

// --- Adding units ------------------------------------------------------------
function findUnits(q) {
  const typed = words(q);
  if (!typed.length || !catalog) return [];
  return catalog
    .filter((c) => typed.every((t) => c.words.some((w) => w.startsWith(t))))
    .sort((a, b) => b.words[0].startsWith(typed[0]) - a.words[0].startsWith(typed[0]) || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, 30);
}

let results = [];
function renderAdd() {
  const role = roleOf(adding);
  addTitle.textContent = `${role === "attack" ? "Attacco" : "Difesa"} · ${names()[adding]}`;
  const q = search.value.trim();
  results = findUnits(q);
  let list = "";
  if (q && results.length) {
    list = `<div class="c-results">${results
      .map((c, i) => {
        const facts = [`Might ${c.base}`];
        if (c.assault) facts.push(`Assault ${c.assault}`);
        if (c.shield) facts.push(`Shield ${c.shield}`);
        if (c.tank) facts.push("Tank");
        if (c.backline) facts.push("Backline");
        return `<button type="button" class="c-result" data-pick="${i}"><strong>${escapeHtml(c.name)}</strong><span>${facts.join(" · ")}</span></button>`;
      })
      .join("")}</div>`;
  } else if (q) {
    list = `<p class="muted small">${catalog ? "Nessuna unità con questo nome." : "Elenco delle carte non disponibile ora: usa i segnalini o un'unità generica."}</p>`;
  }
  const chip = (u, attr) =>
    `<button type="button" class="chip-btn" ${attr}>${escapeHtml(u.name)} <b>${u.base}</b></button>`;
  addBody.innerHTML = `
    ${list}
    ${added.length ? `<p class="c-added">${icon("check")}Aggiunte: ${added.map(escapeHtml).join(" · ")}</p>` : ""}
    ${!q && recent.length ? `<p class="setup-label">Usate di recente</p><div class="c-tokens">${recent.map((u, i) => chip(u, `data-recent="${i}"`)).join("")}</div>` : ""}
    <p class="setup-label">Segnalini</p>
    <div class="c-tokens">${TOKENS.map((t, i) => chip(t, `data-token="${i}"`)).join("")}</div>
    <p class="setup-label">Unità senza carta</p>
    <div class="c-generic">
      <span>Might</span>
      <div class="stepper">
        <button type="button" data-generic="-1" aria-label="Meno">−</button>
        <output>${generic}</output>
        <button type="button" data-generic="1" aria-label="Più">+</button>
      </div>
      <button type="button" class="chip-btn" data-add-generic>${icon("plus")}Aggiungi</button>
    </div>`;
}

/** Keep a card among the recent ones, newest first. */
function remember(card) {
  recent = [makeUnit(card), ...recent.filter((u) => u.name !== card.name)].slice(0, MAX_RECENT);
  store(RECENT_KEY, recent.map(({ name, base, assault, shield, tank, backline, check }) => ({ name, base, assault, shield, tank, backline, check })));
}

function addUnit(data) {
  state[adding].push(makeUnit(data));
  added.push(data.name);
  save();
  render();
  renderAdd();
}

function openAdd(side) {
  adding = side;
  added = [];
  search.value = "";
  renderAdd();
  addDialog.showModal();
  loadCatalog().then(() => addDialog.open && renderAdd());
}

// --- Actions -----------------------------------------------------------------
function change(fn) {
  const list = state[editing.side];
  const i = list.findIndex((x) => x.id === editing.id);
  if (i < 0) return;
  const u = { ...list[i] };
  fn(u);
  const role = roleOf(editing.side);
  // Damage equal to its Might would have killed it already.
  u.damage = Math.min(u.damage, Math.max(0, mightOf(u, role) - 1));
  list[i] = makeUnit(u);
  save();
  render();
}

function onClick(e, onAsk) {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.add) openAdd(d.add);
  else if (d.unit) {
    editing = { side: d.side, id: d.unit };
    render();
  } else if ("done" in d) {
    editing = null;
    render();
  } else if (d.inc) change((u) => (u[d.inc] += Number(d.d)));
  else if (d.flip) change((u) => (u[d.flip] = !u[d.flip]));
  else if ("dup" in d) {
    const list = state[editing.side];
    const u = list.find((x) => x.id === editing.id);
    list.splice(list.indexOf(u) + 1, 0, makeUnit({ ...u, id: undefined }));
    save();
    render();
  } else if ("remove" in d) {
    state[editing.side] = state[editing.side].filter((x) => x.id !== editing.id);
    editing = null;
    save();
    render();
  } else if ("swap" in d) {
    state.attacker = other(state.attacker);
    save();
    render();
  } else if ("clear" in d) {
    if (!confirm("Iniziare un nuovo combattimento? Le unità inserite verranno tolte.")) return;
    state = restoreCombat({ attacker: state.attacker });
    editing = null;
    save();
    render();
  } else if ("ask" in d) {
    const n = names();
    const text = describeCombat(state[state.attacker], state[other(state.attacker)], [n[state.attacker], n[other(state.attacker)]]);
    dialog.close();
    onAsk(text);
  } else if ("scoreConquer" in d) {
    // At match point the scoreboard opens on top to ask about the battlefields.
    if (scoreConquer(SIDES[state.attacker].player)) {
      scored = true;
      render();
    }
  } else if ("closeCombat" in d) dialog.close();
}

function onAddClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.pick) {
    const { words: _, ...card } = results[Number(d.pick)];
    remember(card);
    search.value = "";
    addUnit(card);
    search.focus();
  } else if (d.recent) addUnit({ ...recent[Number(d.recent)], id: undefined });
  else if (d.token) addUnit(TOKENS[Number(d.token)]);
  else if (d.generic) {
    generic = Math.min(30, Math.max(0, generic + Number(d.generic)));
    renderAdd();
  } else if ("addGeneric" in d) addUnit({ name: `Unità ${generic}`, base: generic });
}

/** `onAsk(text)` puts the combat in the question box. */
export function initCombat({ onAsk }) {
  $("openCombat").addEventListener("click", () => {
    loadCatalog();
    render();
    dialog.showModal();
  });
  body.addEventListener("click", (e) => onClick(e, onAsk));
  dialog.addEventListener("close", () => {
    editing = null;
  });
  addDialog.addEventListener("click", onAddClick);
  search.addEventListener("input", renderAdd);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && results.length === 1) {
      e.preventDefault();
      addDialog.querySelector("[data-pick]")?.click();
    }
  });
}
