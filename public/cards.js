// Interfaccia delle carte: tile, chip "carte considerate", dettaglio e archivio.

import { escapeHtml, renderCardText, domainColor } from "./markdown.js";
import { getJSON, LockedError } from "./api.js";

const COSTED = new Set(["Unit", "Unit Gear", "Spell", "Gear"]);
const TYPE_LABEL = {
  Unit: "Unità",
  Spell: "Spell",
  Gear: "Gear",
  Battlefield: "Battlefield",
  Legend: "Leggenda",
  Rune: "Runa",
  Card: "Segnalino",
  "Unit Gear": "Unità / Gear",
};

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("it-IT") : "");

/** CSS accent for a card: its domain color, or a gradient for dual-domain cards. */
function accent(card) {
  const cols = (card.domains ?? []).map(domainColor);
  if (cols.length === 0) return "linear-gradient(180deg,#8a9bb0,#56657a)";
  if (cols.length === 1) return cols[0];
  return `linear-gradient(180deg,${cols.join(",")})`;
}

function statsHtml(c) {
  const out = [];
  if (COSTED.has(c.type)) {
    out.push(`<span class="stat cost" title="Energy Cost">${c.energy ?? 0}</span>`);
    const dom = domainColor(c.domains?.[0] ?? "");
    for (let i = 0; i < (c.power ?? 0); i++) out.push(`<span class="stat pow" style="--dc:${dom}" title="Power"></span>`);
  }
  if (c.type?.includes("Unit")) out.push(`<span class="stat might" title="Might">⚔ ${c.might ?? 0}</span>`);
  if (c.mightBonus) out.push(`<span class="stat might" title="Might Bonus">+${c.mightBonus}</span>`);
  return out.join("");
}

/** Full card tile (archive and detail view). */
export function cardTileHtml(c, { insert = true } = {}) {
  const typeLine = [TYPE_LABEL[c.type] ?? c.type, c.supertype, ...(c.domains ?? [])].filter(Boolean).join(" · ");
  return `
    <article class="card-tile" style="--accent:${accent(c)}">
      <header>
        <div class="ct-title">
          <h3>${escapeHtml(c.name)}</h3>
          <p class="ct-type">${escapeHtml(typeLine)}</p>
        </div>
        <div class="ct-stats">${statsHtml(c)}</div>
      </header>
      ${c.bannedFrom ? `<p class="ct-banned">⛔ Bandita dal ${escapeHtml(fmtDate(c.bannedFrom))}</p>` : ""}
      ${c.text ? `<div class="ct-text">${renderCardText(c.text)}</div>` : ""}
      ${c.effect ? `<div class="ct-text ct-effect"><span class="ct-label">Quando è attaccato</span>${renderCardText(c.effect)}</div>` : ""}
      <footer>
        <span class="ct-codes">${escapeHtml((c.codes ?? []).slice(0, 3).join(" · "))}</span>
        ${insert ? `<button type="button" class="chip-btn" data-insert="${escapeHtml(c.name)}">＋ Usa nella domanda</button>` : ""}
      </footer>
    </article>`;
}

// --- Detail dialog -----------------------------------------------------------
const detail = document.getElementById("cardDialog");
const detailBody = document.getElementById("cardDialogBody");

export function openCardDetail(card) {
  detailBody.innerHTML = cardTileHtml(card, { insert: false });
  detail.showModal();
}

/** "Carte considerate" chips at the top of a judge message. */
export function renderCardChips(container, cards) {
  container.innerHTML = "";
  if (!cards.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const label = document.createElement("span");
  label.className = "cards-used-label";
  label.textContent = `🃏 Carte considerate (${cards.length})`;
  container.append(label);
  for (const card of cards) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "card-chip";
    chip.style.setProperty("--accent", accent(card));
    chip.textContent = card.name;
    chip.title = "Mostra il testo della carta";
    chip.addEventListener("click", () => openCardDetail(card));
    container.append(chip);
  }
}

// --- Archive: the "Carte" tab ---------------------------------------------------
/**
 * Wire the card search. `onInsert(name)` is called when the user picks a card
 * to use in the question. Returns { activate, search } for the archive tabs.
 */
export function initCardBrowser({ domains = {}, types = [], onInsert }) {
  const search = document.getElementById("cardSearch");
  const typeSel = document.getElementById("typeFilter");
  const domainBox = document.getElementById("domainFilters");
  const results = document.getElementById("cardResults");
  const count = document.getElementById("cardCount");
  const more = document.getElementById("moreCards");

  let domain = "";
  let limit = 40;
  let seq = 0;
  let timer;

  for (const t of types) typeSel.add(new Option(TYPE_LABEL[t] ?? t, t));
  for (const [name, color] of Object.entries(domains)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dom-pill";
    b.style.setProperty("--dc", color);
    b.textContent = name;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      domain = domain === name ? "" : name;
      for (const p of domainBox.children) p.setAttribute("aria-pressed", String(p.textContent === domain));
      refresh(true);
    });
    domainBox.append(b);
  }

  async function refresh(reset) {
    if (reset) limit = 40;
    const id = ++seq;
    const params = new URLSearchParams({ q: search.value, domain, type: typeSel.value, limit });
    try {
      const data = await getJSON(`/api/cards?${params}`);
      if (id !== seq) return; // a newer search already started
      count.textContent = data.total
        ? `${data.total} ${data.total === 1 ? "carta" : "carte"}${data.total > data.cards.length ? ` · mostrate ${data.cards.length}` : ""}`
        : "Nessuna carta trovata.";
      results.innerHTML = data.cards.map((c) => cardTileHtml(c)).join("");
      more.hidden = data.total <= data.cards.length;
    } catch (err) {
      if (id === seq && !(err instanceof LockedError)) count.textContent = "Impossibile caricare le carte.";
    }
  }

  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(true), 160);
  });
  typeSel.addEventListener("change", () => refresh(true));
  more.addEventListener("click", () => {
    limit += 40;
    refresh(false);
  });
  results.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-insert]");
    if (btn) onInsert(btn.dataset.insert);
  });

  return {
    activate() {
      if (!results.childElementCount) refresh(true);
      search.focus();
    },
    search(q) {
      search.value = q;
      refresh(true);
      search.focus();
    },
  };
}
