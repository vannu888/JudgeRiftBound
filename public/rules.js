// Il regolamento nell'interfaccia: la finestra con il testo ufficiale di una
// regola (aperta dai numeri citati dal judge o dalle keyword) e la ricerca.

import { request, getJSON, LockedError } from "./api.js";
import { escapeHtml, withRuleRefs } from "./markdown.js";
import { icon } from "./icons.js";

const dialog = document.getElementById("ruleDialog");
const titleEl = document.getElementById("ruleTitle");
const body = document.getElementById("ruleBody");

const isNumber = (ref) => /^\d{3}/.test(ref);
/** Rules text with its own "See rule 716" references made clickable. */
const text = (s) => withRuleRefs(escapeHtml(s));
const notes = (list) => (list?.length ? `<div class="rule-notes">${list.map((n) => `<p>${text(n)}</p>`).join("")}</div>` : "");

/** "Regola 309.1.a", with the number in the body font (see .rule-id). */
const ruleTitle = (id) => `Regola <span class="rule-id">${escapeHtml(id)}</span>`;

/** Open the official text of a rule number ("309.1.a") or a keyword ("Deflect"). */
export async function openRule(ref) {
  titleEl.innerHTML = isNumber(ref) ? ruleTitle(ref) : escapeHtml(ref);
  body.innerHTML = `<p class="muted">Caricamento…</p>`;
  if (!dialog.open) dialog.showModal();
  try {
    const res = await request(`/api/rules/${encodeURIComponent(ref)}`);
    if (res.status === 404) renderMissing(ref);
    else render(await res.json());
  } catch (err) {
    if (err instanceof LockedError) dialog.close();
    else body.innerHTML = `<p class="error-note">Impossibile caricare la regola.</p>`;
  }
  dialog.querySelector(".dlg-inner").scrollTop = 0;
}

function render(rule) {
  // Section headings read best by name ("809 · Deflect"), everything else by number.
  titleEl.innerHTML =
    !rule.parents.length && rule.text.length <= 40 ? `${escapeHtml(rule.id)} · ${escapeHtml(rule.text)}` : ruleTitle(rule.id);
  const crumbs = rule.parents
    .map((p) => `<button type="button" class="crumb" data-rule="${p.id}"><b>${p.id}</b> ${escapeHtml(p.text)}</button>`)
    .join("");
  const children = rule.children
    .map(
      (c) => `
      <li style="--depth:${c.depth}">
        <button type="button" class="rule-num" data-rule="${c.id}">${c.id}</button>
        <span>${text(c.text)}</span>${notes(c.notes)}
      </li>`,
    )
    .join("");
  body.innerHTML = `
    ${crumbs ? `<nav class="crumbs" aria-label="Contesto">${crumbs}</nav>` : ""}
    <article class="rule-main">
      <span class="rule-num big">${rule.id}</span>
      <p>${text(rule.text)}</p>
      ${notes(rule.notes)}
    </article>
    ${children ? `<ol class="rule-children">${children}</ol>` : ""}
    ${rule.truncated ? `<p class="muted small">Mostrate le prime ${rule.children.length} sotto-regole.</p>` : ""}
    <p class="rule-source">Riftbound Core Rules · 30/03/2026</p>`;
}

function renderMissing(ref) {
  const safe = escapeHtml(ref);
  body.innerHTML = isNumber(ref)
    ? `<div class="rule-missing">
        <p class="missing-title">${icon("alert")}La regola <strong>${safe}</strong> non esiste nel regolamento.</p>
        <p class="muted">Se l'ha citata il judge, potrebbe aver sbagliato numero: verifica cercando nel regolamento.</p>
        <button type="button" class="chip-btn" data-search-rules="${safe}">${icon("search")}Cerca nel regolamento</button>
      </div>`
    : `<div class="rule-missing">
        <p>Nessuna voce del glossario dedicata a <strong>${safe}</strong>.</p>
        <button type="button" class="chip-btn" data-search-rules="${safe}">${icon("search")}Cerca «${safe}» nel regolamento</button>
      </div>`;
}

/** Escaped text with every word containing a query word wrapped in <mark>. */
function highlight(s, q) {
  const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return escapeHtml(s);
  // Match on the plain text (not the escaped HTML, whose "&amp;" must stay intact).
  const re = new RegExp(`[\\p{L}\\p{N}]*(?:${words.join("|")})[\\p{L}\\p{N}]*`, "giu");
  let html = "";
  let last = 0;
  for (const m of s.matchAll(re)) {
    html += `${escapeHtml(s.slice(last, m.index))}<mark>${escapeHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(s.slice(last));
}

/** The "Regole" tab of the archive. */
export function initRulesPanel() {
  const input = document.getElementById("ruleSearch");
  const results = document.getElementById("ruleResults");
  const count = document.getElementById("ruleCount");
  let seq = 0;
  let timer;

  async function run() {
    const q = input.value.trim();
    const id = ++seq;
    if (!q) {
      count.textContent = "Cerca una parola (es. «showdown», «hidden») o un numero (es. 340.1). Non usa la quota di Gemini.";
      results.innerHTML = "";
      return;
    }
    try {
      const data = await getJSON(`/api/rules?q=${encodeURIComponent(q)}&limit=40`);
      if (id !== seq) return; // a newer search already started
      count.textContent = data.total
        ? `${data.total} ${data.total === 1 ? "regola" : "regole"}${data.total > data.rules.length ? ` · mostrate ${data.rules.length}` : ""}`
        : "Nessuna regola trovata.";
      results.innerHTML = data.rules
        .map(
          (r) => `
          <button type="button" class="rule-hit" data-rule="${r.id}">
            <span class="rule-num">${r.id}</span><span>${highlight(r.text, q)}</span>
          </button>`,
        )
        .join("");
    } catch (err) {
      if (id === seq && !(err instanceof LockedError)) count.textContent = "Impossibile cercare nel regolamento.";
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  });
  run();

  return {
    activate: () => input.focus(),
    search(q) {
      input.value = q;
      run();
      input.focus();
    },
  };
}
