// Diario delle partite: salvataggio a fine partita (dal segnapunti) o a mano,
// e statistiche per Leggenda. Tutto resta su questo dispositivo.

import { getJSON } from "./api.js";
import { escapeHtml } from "./markdown.js";
import { load, store } from "./storage.js";
import { icon } from "./icons.js";
import { addEntry, removeEntry, restoreDiary, diaryStats, winRate } from "./diary-model.js";

const KEY = "jrb.diary.v1";
const LAST_KEY = "jrb.diary.last"; // the legends chosen last time: one tap to save the next game
const SHOWN_GAMES = 30;

const dialog = document.getElementById("diaryDialog");
const body = document.getElementById("diaryBody");

let entries = restoreDiary(load(KEY));
let last = (() => {
  const saved = load(LAST_KEY, {});
  const pick = (v) => (typeof v === "string" ? v.slice(0, 60) : "");
  return { mine: pick(saved?.mine), opp: pick(saved?.opp) };
})();
let legends = null; // legend names, from the card database
let loading = null;
let manualWon = true; // result chosen in the "add a game" form
let formOpen = false; // the form stays open while it is used (every tap redraws the diary)
let onChange = () => {};

/** The legends for the pickers (same data as the card suggestions, cached offline). */
export function loadLegends() {
  loading ??= getJSON("/api/cards/names")
    .then((data) => {
      legends = (data.names ?? [])
        .filter((row) => row[1] === "Legend")
        .map((row) => row[0])
        .sort((a, b) => a.localeCompare(b));
    })
    .catch(() => {
      loading = null; // offline or locked: try again next time
    });
  return loading;
}

/** A legend picker; `which` is "mine" or "opp". It remembers the choice (see setLastLegend). */
export function legendSelect(which, label) {
  const selected = last[which];
  const names = legends ?? [];
  const options = names.map((n) => `<option value="${escapeHtml(n)}"${n === selected ? " selected" : ""}>${escapeHtml(n)}</option>`);
  if (selected && !names.includes(selected)) options.unshift(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
  return `
    <label class="legend-pick">
      <span>${label}</span>
      <select class="field" data-legend="${which}"><option value="">Non indicata</option>${options.join("")}</select>
    </label>`;
}

export function setLastLegend(which, value) {
  last = { ...last, [which]: String(value).slice(0, 60) };
  store(LAST_KEY, last);
}

/** Record a game with the legends chosen in the pickers. */
export function saveGame({ won, score = "" }) {
  entries = addEntry(entries, { mine: last.mine, opp: last.opp, won, score });
  store(KEY, entries);
}

/** "12 partite · 58% vittorie", for the scoreboard. */
export function diarySummary() {
  const s = diaryStats(entries);
  return s.games ? `${s.games} ${s.games === 1 ? "partita" : "partite"} · ${s.rate}% vittorie` : "Salva le partite per vedere come vai contro ogni Leggenda";
}

// --- Views -------------------------------------------------------------------
const legendName = (n) => (n ? escapeHtml(n) : `<span class="muted">Non indicata</span>`);

/** One legend's record with its win rate as a meter (the numbers are written too). */
function recordRow({ legend, games, wins }) {
  const rate = winRate(wins, games);
  return `
    <li class="rec">
      <span class="rec-name">${legendName(legend)}</span>
      <span class="rec-count">${wins} V · ${games - wins} S</span>
      <span class="rec-rate">${rate}%</span>
      <span class="meter" role="img" aria-label="${rate}% di vittorie su ${games} ${games === 1 ? "partita" : "partite"}"><i style="width:${rate}%"></i></span>
    </li>`;
}

function gameRow(e) {
  const date = new Date(e.at).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  return `
    <li class="game-row">
      <span class="gr-result ${e.won ? "win" : "loss"}" title="${e.won ? "Vinta" : "Persa"}">${e.won ? "V" : "S"}</span>
      <span class="gr-main">
        <span class="gr-legends">${legendName(e.mine)} <em>vs</em> ${legendName(e.opp)}</span>
        <span class="gr-meta">${date}${e.score ? ` · ${escapeHtml(e.score)}` : ""}</span>
      </span>
      <button type="button" class="icon-btn small" data-del-game="${escapeHtml(e.id)}" aria-label="Elimina la partita">${icon("trash")}</button>
    </li>`;
}

function render() {
  const s = diaryStats(entries);
  const addForm = `
    <details class="diary-add"${formOpen || !s.games ? " open" : ""}>
      <summary>${icon("plus")}Aggiungi una partita</summary>
      <div class="diary-form">
        ${legendSelect("mine", "La tua Leggenda")}
        ${legendSelect("opp", "Leggenda avversaria")}
        <div class="seg" role="group" aria-label="Risultato">
          <button type="button" data-manual="win" aria-pressed="${manualWon}">Vinta</button>
          <button type="button" data-manual="loss" aria-pressed="${!manualWon}">Persa</button>
        </div>
        <button type="button" class="primary-btn small" data-add-game>Aggiungi</button>
      </div>
    </details>`;
  if (!s.games) {
    body.innerHTML = `
      <div class="empty">${icon("diary")}<p>Nessuna partita nel diario.</p>
        <p class="muted small">A fine partita, nel segnapunti, tocca «Salva nel diario»; oppure aggiungine una qui sotto.</p></div>
      ${addForm}`;
    return;
  }
  const streak = s.streak.count;
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">Partite</span><span class="kpi-value">${s.games}</span></div>
      <div class="kpi"><span class="kpi-label">Vittorie</span><span class="kpi-value">${s.rate}%</span><span class="kpi-sub">${s.wins} V · ${s.losses} S</span></div>
      <div class="kpi"><span class="kpi-label">Serie attuale</span><span class="kpi-value">${streak}</span>
        <span class="kpi-sub">${s.streak.won ? (streak === 1 ? "vittoria" : "vittorie") : streak === 1 ? "sconfitta" : "sconfitte"}${streak > 1 ? " di fila" : ""}</span></div>
    </div>
    ${addForm}
    <h3 class="setup-label">Contro le Leggende avversarie</h3>
    <ul class="records">${s.byOpp.map(recordRow).join("")}</ul>
    <h3 class="setup-label">Con le tue Leggende</h3>
    <ul class="records">${s.byMine.map(recordRow).join("")}</ul>
    <h3 class="setup-label">Ultime partite</h3>
    <ul class="games">${entries.slice(0, SHOWN_GAMES).map(gameRow).join("")}</ul>
    ${entries.length > SHOWN_GAMES ? `<p class="muted small">Mostrate le ultime ${SHOWN_GAMES} di ${entries.length}.</p>` : ""}
    <button type="button" class="chip-btn danger clear-all" data-clear-diary>${icon("trash")}Cancella il diario</button>`;
}

export function openDiary() {
  render();
  if (!dialog.open) dialog.showModal();
  loadLegends().then(() => dialog.open && render());
}

/** `changed()` runs when the diary changes (the scoreboard shows its summary). */
export function initDiary(changed) {
  onChange = changed;
  body.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.manual) manualWon = d.manual === "win";
    else if ("addGame" in d) {
      saveGame({ won: manualWon });
      onChange();
    } else if (d.delGame) {
      entries = removeEntry(entries, d.delGame);
      store(KEY, entries);
      onChange();
    } else if ("clearDiary" in d) {
      if (!confirm("Eliminare tutte le partite dal diario di questo dispositivo?")) return;
      entries = [];
      store(KEY, entries);
      onChange();
    } else return;
    render();
  });
  // "toggle" does not bubble: listen while it goes down to the <details>.
  body.addEventListener("toggle", (e) => {
    if (e.target.classList?.contains("diary-add")) formOpen = e.target.open;
  }, true);
  body.addEventListener("change", (e) => {
    if (e.target.dataset.legend) setLastLegend(e.target.dataset.legend, e.target.value);
  });
}
