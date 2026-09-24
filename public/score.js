// Segnapunti: interfaccia. Le regole (modalità, punto vincente, vittoria)
// sono in score-model.js; la partita è salvata su questo dispositivo.

import { MODES, KIND_LABEL, defaultNames, newGame, score, undo, nextRound, summary, toContext, restoreGame, atMatchPoint } from "./score-model.js";
import { escapeHtml } from "./markdown.js";
import { toast } from "./chat.js";
import { load, store } from "./storage.js";
import { icon } from "./icons.js";

const GAME_KEY = "jrb.game.v1";
const SHARE_KEY = "jrb.game.share";
const HUES = ["#d9b45f", "#35c7ba", "#b98be0", "#e8894a"];
const TINTS = ["#2a2314", "#0e2a29", "#241a35", "#2f1e12"]; // each colour over the dark background, for table mode

const dialog = document.getElementById("scoreDialog");
const body = document.getElementById("scoreBody");
const button = document.getElementById("openScore");
const table = document.getElementById("tableDialog");
const tableBody = document.getElementById("tableBody");

let game = restoreGame(load(GAME_KEY));
let share = load(SHARE_KEY, 1) !== 0; // stored as 1/0
let setup = game
  ? { mode: game.mode, names: game.players.map((p) => p.name), victory: game.victory }
  : { mode: "duel", names: [], victory: MODES.duel.victory };
let pending = null; // player whose Conquer at match point awaits the "all battlefields?" answer

/** The score to send with a question, when a game is on and sharing is enabled. */
export const gameContext = () => (game && share ? toContext(game) : null);

function save() {
  store(GAME_KEY, game);
  button.querySelector(".score-chip").textContent = game ? summary(game) : "Punti";
  button.classList.toggle("live", Boolean(game));
  button.title = game ? "Segnapunti: partita in corso" : "Segnapunti";
}

const name = (i) => escapeHtml(game.players[i].name);
/** "Tu vinci" but "Marco vince": the default first player is addressed directly. */
const verb = (i, third, second) => (game.players[i].name.trim().toLowerCase() === "tu" ? second : third);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ruleRef = (id) => `<a class="rule-ref" href="#regola-${id}" data-rule="${id}">${id}</a>`;

// --- Views -------------------------------------------------------------------
function setupView() {
  const m = MODES[setup.mode];
  const modes = Object.entries(MODES)
    .map(
      ([key, mode]) => `
      <label class="mode-card">
        <input type="radio" name="mode" value="${key}" ${key === setup.mode ? "checked" : ""}>
        <span class="mode-name">${mode.label}</span>
        <span class="mode-meta">${mode.victory} punti · regola ${mode.rule}</span>
      </label>`,
    )
    .join("");
  const names = defaultNames(setup.mode)
    .map(
      (d, i) => `
      <input class="field" name="name" data-i="${i}" maxlength="24" placeholder="${escapeHtml(d)}"
        value="${escapeHtml(setup.names[i] ?? "")}" autocomplete="off" aria-label="Nome ${i + 1}">`,
    )
    .join("");
  return `
    <form class="score-setup" id="scoreSetup">
      <p class="setup-label">Modalità</p>
      <div class="mode-grid" role="radiogroup" aria-label="Modalità">${modes}</div>
      <p class="setup-label">${m.teams ? "Squadre" : "Giocatori"} <span class="muted small">(il primo sei tu)</span></p>
      <div class="name-grid">${names}</div>
      <div class="victory-row">
        <span>Punti per vincere</span>
        <div class="stepper">
          <button type="button" data-victory="-1" aria-label="Diminuisci">−</button>
          <output id="victoryOut">${setup.victory}</output>
          <button type="button" data-victory="1" aria-label="Aumenta">+</button>
        </div>
      </div>
      <button class="primary-btn" type="submit">Inizia la partita</button>
      <p class="muted small">Si segna con una Conquista o una Tenuta, al massimo una volta per battlefield per turno (${ruleRef("465")}).</p>
    </form>`;
}

function playerCard(p, i) {
  const m = MODES[game.mode];
  const ended = game.winner !== null;
  const matchPoint = !ended && atMatchPoint(game, i);
  const pips = Array.from({ length: game.victory }, (_, k) => `<i class="${k < p.points ? "on" : ""}"></i>`).join("");
  const needed = Math.ceil(m.bestOf / 2);
  const wins = m.bestOf > 1 ? `<span class="wins" title="Partite vinte">${"★".repeat(p.wins)}${"☆".repeat(Math.max(0, needed - p.wins))}</span>` : "";
  const off = ended ? "disabled" : "";
  return `
    <section class="player${matchPoint ? " match-point" : ""}${game.winner === i ? " winner" : ""}" style="--hue:${HUES[i]}">
      <header><span class="pname">${name(i)}</span>${wins}</header>
      <div class="points"><span class="big">${p.points}</span><span class="of">/ ${game.victory}</span></div>
      <div class="pips" aria-hidden="true">${pips}</div>
      ${matchPoint ? `<p class="mp">Punto vincente</p>` : ""}
      <div class="acts">
        <button type="button" data-score="conquer" data-player="${i}" ${off}>${icon("flag")}Conquista</button>
        <button type="button" data-score="hold" data-player="${i}" ${off}>${icon("castle")}Tenuta</button>
        <button type="button" data-score="other" data-player="${i}" ${off} title="Punto da altre fonti, es. Burn Out dell'avversario o effetti di carte">+1 Altro</button>
        <button type="button" data-score="minus" data-player="${i}" ${ended || !p.points ? "disabled" : ""} aria-label="Togli un punto a ${name(i)}">−1</button>
      </div>
    </section>`;
}

function banner() {
  const m = MODES[game.mode];
  if (game.matchWinner !== null) {
    return `<div class="win-banner">${icon("trophy", "win-icon")}<span><strong>${name(game.matchWinner)}</strong> ${verb(game.matchWinner, "vince", "vinci")} il match!</span>
      <button type="button" class="primary-btn small" data-reset>Nuova partita</button></div>`;
  }
  if (game.winner === null) return "";
  const next = m.bestOf > 1
    ? `<button type="button" class="primary-btn small" data-next>Partita successiva</button>`
    : `<button type="button" class="primary-btn small" data-reset>Nuova partita</button>`;
  return `<div class="win-banner">${icon("trophy", "win-icon")}<span><strong>${name(game.winner)}</strong> ${verb(game.winner, "vince", "vinci")} la partita (${ruleRef("467")})</span>${next}</div>`;
}

function confirmBox() {
  const team = MODES[game.mode].teams
    ? `, esclusi quelli occupati dall'alleato nella Beginning Phase (${ruleRef("484.8.f.1")})`
    : "";
  return `
    <div class="confirm" role="alertdialog" aria-labelledby="confirmTitle">
      <p id="confirmTitle"><strong>Punto vincente con una Conquista</strong></p>
      <p>Vale solo se in questo turno <strong>${name(pending)}</strong> ${verb(pending, "ha", "hai")} segnato <strong>tutti</strong> i battlefield,
        con Conquista o Tenuta${team}. Altrimenti niente punto: si pesca 1 carta (${ruleRef("466.1.b.2")}).</p>
      <div class="confirm-acts">
        <button type="button" class="primary-btn" data-all="yes">Sì, tutti i battlefield</button>
        <button type="button" class="chip-btn" data-all="no">No, pesca 1 carta</button>
        <button type="button" class="chip-btn" data-all="cancel">Annulla</button>
      </div>
    </div>`;
}

function logView() {
  if (!game.log.length) return "";
  const items = game.log
    .slice(-15)
    .reverse()
    .map((e) => {
      const what = e.drew ? "Conquista senza tutti i battlefield → pesca 1" : `${KIND_LABEL[e.kind]} ${e.delta > 0 ? "+1" : "−1"}`;
      return `<li><b style="color:${HUES[e.player]}">${name(e.player)}</b> ${what}</li>`;
    })
    .join("");
  return `<details class="score-log"><summary>Registro (${game.log.length})</summary><ol>${items}</ol></details>`;
}

function gameView() {
  const m = MODES[game.mode];
  return `
    <div class="score-meta">
      <span>${m.label}</span><span>·</span><span>${game.victory} punti</span>
      ${m.bestOf > 1 ? `<span>·</span><span>Partita ${game.round}</span>` : ""}
      ${ruleRef(m.rule)}
    </div>
    ${banner()}
    <button type="button" class="table-btn" data-table-open>
      ${icon("table")}
      <span><strong>Modalità tavolo</strong>
        <span class="muted small">Il telefono al centro: ognuno segna dal suo lato</span></span>
    </button>
    <div class="players n${game.players.length}">${game.players.map(playerCard).join("")}</div>
    ${pending !== null ? confirmBox() : ""}
    <div class="score-tools">
      <button type="button" class="chip-btn" data-undo ${game.log.length ? "" : "disabled"}>${icon("undo")}Annulla</button>
      <button type="button" class="chip-btn danger" data-reset>${icon("refresh")}Nuova partita</button>
    </div>
    <label class="switch-row">
      <span><strong>Il judge conosce il punteggio</strong>
        <span class="muted small">Le domande includono lo stato della partita</span></span>
      <input type="checkbox" class="switch" role="switch" data-share ${share ? "checked" : ""}>
    </label>
    ${logView()}`;
}

// --- Table mode: the phone lies between the players, the top half faces the opponent ---
function tablePlayer(i) {
  const p = game.players[i];
  const m = MODES[game.mode];
  const ended = game.winner !== null;
  const matchPoint = !ended && atMatchPoint(game, i);
  const off = ended ? "disabled" : "";
  const wins = m.bestOf > 1 ? `<span class="wins">${"★".repeat(p.wins)}${"☆".repeat(Math.max(0, Math.ceil(m.bestOf / 2) - p.wins))}</span>` : "";
  // Each half faces its own player, so it speaks to them directly ("Tu" is the phone's owner).
  const lost = (w, what) =>
    game.players[w].name.trim().toLowerCase() === "tu" ? `Hai perso ${what}` : `${cap(what)} a ${name(w)}`;
  let status = matchPoint ? `<p class="tp-mp">Punto vincente</p>` : "";
  if (game.matchWinner !== null) {
    status = game.matchWinner === i ? `<p class="tp-win">${icon("trophy")}Hai vinto il match!</p>` : `<p class="tp-lose">${lost(game.matchWinner, "il match")}</p>`;
  } else if (ended) {
    status = game.winner === i ? `<p class="tp-win">${icon("trophy")}Hai vinto!</p>` : `<p class="tp-lose">${lost(game.winner, "la partita")}</p>`;
  }
  const controls =
    pending === i
      ? `<div class="tp-confirm">
          <p>Punto vincente con una Conquista: in questo turno hai segnato <strong>tutti</strong> i battlefield?</p>
          <div class="tp-confirm-acts">
            <button type="button" class="primary-btn" data-all="yes">Sì, punto</button>
            <button type="button" class="chip-btn" data-all="no">No, pesca 1</button>
            <button type="button" class="chip-btn" data-all="cancel">Annulla</button>
          </div>
        </div>`
      : `<div class="tp-acts">
          <button type="button" data-score="conquer" data-player="${i}" ${off}>${icon("flag")}Conquista</button>
          <button type="button" data-score="hold" data-player="${i}" ${off}>${icon("castle")}Tenuta</button>
          <button type="button" data-score="other" data-player="${i}" ${off}>+1</button>
          <button type="button" data-score="minus" data-player="${i}" ${ended || !p.points ? "disabled" : ""} aria-label="Togli un punto a ${name(i)}">−1</button>
        </div>`;
  return `
    <div class="tp${matchPoint ? " match-point" : ""}${game.winner === i ? " winner" : ""}" style="--hue:${HUES[i]};--tint:${TINTS[i]}">
      <p class="tp-name">${name(i)}${wins}</p>
      <div class="tp-score"><span class="tp-big">${p.points}</span><span class="tp-of">/${game.victory}</span></div>
      ${status}
      ${controls}
    </div>`;
}

function tableView() {
  const n = game.players.length;
  // Two sides of the table: the first players at the bottom, the others facing them.
  const bottom = Array.from({ length: Math.ceil(n / 2) }, (_, i) => i);
  const top = Array.from({ length: n - bottom.length }, (_, i) => bottom.length + i);
  let next = "";
  if (game.winner !== null) {
    next =
      game.matchWinner === null && MODES[game.mode].bestOf > 1
        ? `<button type="button" class="tm-btn go" data-next aria-label="Partita successiva">${icon("refresh")}</button>`
        : `<button type="button" class="tm-btn go" data-reset aria-label="Nuova partita">${icon("refresh")}</button>`;
  }
  return `
    <div class="table n${n}">
      <section class="side side-top">${top.map(tablePlayer).join("")}</section>
      <div class="table-mid">
        <button type="button" class="tm-btn" data-undo aria-label="Annulla l'ultima azione" ${game.log.length ? "" : "disabled"}>${icon("undo")}</button>
        <span class="tm-target" title="Punti per vincere">${icon("trophy")}${game.victory}</span>
        ${next}
        <button type="button" class="tm-btn" data-table-close aria-label="Esci dalla modalità tavolo">${icon("close")}</button>
      </div>
      <section class="side side-bottom">${bottom.map(tablePlayer).join("")}</section>
    </div>`;
}

// The phone lies on the table for the whole game: keep the screen on where supported.
let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    wakeLock = null; // not supported, or refused (e.g. low battery)
  }
}
document.addEventListener("visibilitychange", () => {
  if (table.open && document.visibilityState === "visible") keepAwake();
});

function openTable() {
  if (!game) return;
  dialog.close();
  table.showModal();
  render();
  keepAwake();
}

const render = () => {
  body.innerHTML = game ? gameView() : setupView();
  if (!table.open) return;
  if (game) tableBody.innerHTML = tableView();
  else table.close(); // a new game starts from the setup
};

// --- Actions -----------------------------------------------------------------
function act(i, kind, allBattlefields) {
  const res = score(game, i, kind, { allBattlefields });
  if (res.needsAllBattlefields) {
    pending = i;
    render();
    body.querySelector(".confirm")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  pending = null;
  const wasOpen = game.winner === null;
  game = res.game;
  save();
  render();
  navigator.vibrate?.(12);
  if (res.drew) toast("Niente punto vincente: si pesca 1 carta (466.1.b.2)");
  else if (wasOpen && game.winner !== null) toast(`🏆 ${game.players[game.winner].name} ${verb(game.winner, "vince", "vinci")} la partita!`);
}

function reset() {
  if (game && game.winner === null && game.log.length && !confirm("Iniziare una nuova partita? Il punteggio attuale verrà azzerato.")) return;
  if (game) setup = { mode: game.mode, names: game.players.map((p) => p.name), victory: game.victory };
  game = null;
  pending = null;
  save();
  render();
}

function onClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  if ("tableOpen" in t.dataset) openTable();
  else if ("tableClose" in t.dataset) table.close();
  else if (t.dataset.score) act(Number(t.dataset.player), t.dataset.score);
  else if (t.dataset.all) {
    if (t.dataset.all === "cancel") {
      pending = null;
      render();
    } else act(pending, "conquer", t.dataset.all === "yes");
  } else if (t.dataset.victory) {
    setup.victory = Math.min(30, Math.max(1, setup.victory + Number(t.dataset.victory)));
    document.getElementById("victoryOut").textContent = setup.victory;
  } else if ("undo" in t.dataset) {
    game = undo(game);
    pending = null;
    save();
    render();
  } else if ("next" in t.dataset) {
    game = nextRound(game);
    save();
    render();
  } else if ("reset" in t.dataset) reset();
}

function onChange(e) {
  if (e.target.name === "mode") {
    setup = { mode: e.target.value, names: setup.names, victory: MODES[e.target.value].victory };
    render();
  } else if ("share" in e.target.dataset) {
    share = e.target.checked;
    store(SHARE_KEY, share ? 1 : 0);
    toast(share ? "Il judge vedrà il punteggio" : "Il punteggio resta privato");
  }
}

function onInput(e) {
  if (e.target.name === "name") setup.names[Number(e.target.dataset.i)] = e.target.value;
}

function onSubmit(e) {
  e.preventDefault();
  game = newGame(setup.mode, setup.names, setup.victory);
  save();
  render();
  toast(`Partita iniziata: si vince a ${game.victory} punti`);
}

export function initScoreboard() {
  save(); // refresh the header button
  button.addEventListener("click", () => {
    render();
    dialog.showModal();
  });
  body.addEventListener("click", onClick);
  tableBody.addEventListener("click", onClick);
  table.addEventListener("close", () => {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    pending = null;
    // Back to the scoreboard, where the game can be continued or reset.
    render();
    dialog.showModal();
  });
  body.addEventListener("change", onChange);
  body.addEventListener("input", onInput);
  body.addEventListener("submit", onSubmit);
}
