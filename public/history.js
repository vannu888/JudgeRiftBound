// Cronologia delle sessioni, salvata solo su questo dispositivo (localStorage):
// se Safari ricarica la pagina a metà partita, la conversazione non si perde.

import { escapeHtml } from "./markdown.js";
import { load, store } from "./storage.js";
import { icon } from "./icons.js";

const KEY = "jrb.sessions.v1";
const MAX_SESSIONS = 30;

function read() {
  const list = load(KEY, []);
  return Array.isArray(list) ? list.filter((s) => s?.id && Array.isArray(s.messages) && s.messages.length) : [];
}

/** Save, dropping the oldest sessions if the browser storage is full. */
function write(list) {
  let n = list.length;
  while (n >= 0 && !store(KEY, list.slice(0, n))) n--;
}

// crypto.randomUUID needs https; this also works on http://192.168… in the home Wi-Fi.
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const newSession = () => ({ id: newId(), title: "", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });

export const listSessions = () => read().sort((a, b) => b.updatedAt - a.updatedAt);

export function saveSession(session) {
  if (!session.messages.length) return;
  session.title ||= session.messages.find((m) => m.role === "user")?.content.slice(0, 90) ?? "Sessione";
  session.updatedAt = Date.now();
  write([session, ...listSessions().filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS));
}

export const deleteSession = (id) => write(listSessions().filter((s) => s.id !== id));

export function relativeTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "adesso";
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  return new Date(ts).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

const questions = (s) => s.messages.filter((m) => m.role === "user").length;

/** The latest verdict in plain text: what the list shows under each question. */
export function verdictOf(s) {
  const answer = s.messages.findLast((m) => m.role === "assistant")?.content ?? "";
  const m = /(?:^|\n)\s*(?:#{1,4}\s*|\*\*)Verdetto\b[:*\s]*([\s\S]*?)(?=\n\s*(?:#{1,4}\s|\*\*[^*\n]{2,30}\*\*)|$)/i.exec(answer);
  const text = (m ? m[1] : answer)
    .replace(/[#*`>_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text;
}

function itemHtml(s, current) {
  const n = questions(s);
  const verdict = verdictOf(s);
  return `
    <li>
      <button type="button" class="history-item" data-open="${s.id}">
        <span class="h-title">${escapeHtml(s.title)}</span>
        ${verdict ? `<span class="h-verdict">${escapeHtml(verdict)}</span>` : ""}
        <span class="h-meta">${n} ${n === 1 ? "domanda" : "domande"} · ${relativeTime(s.updatedAt)}${s.id === current ? " · <b>aperta</b>" : ""}</span>
      </button>
      <button type="button" class="icon-btn small" data-delete="${s.id}" aria-label="Elimina la sessione">${icon("trash")}</button>
    </li>`;
}

/**
 * Wire the history drawer. `onOpen(session)` loads a session into the chat,
 * `current()` is the id of the session on screen.
 */
export function initHistory({ onOpen, current }) {
  const dialog = document.getElementById("historyDialog");
  const list = document.getElementById("historyList");
  const clear = document.getElementById("clearHistory");

  const render = () => {
    const sessions = listSessions();
    list.innerHTML = sessions.length
      ? `<ul class="history-list">${sessions.map((s) => itemHtml(s, current())).join("")}</ul>`
      : `<div class="empty">${icon("history")}<p>Nessuna conversazione salvata.</p><p class="muted small">Le domande al judge restano solo su questo dispositivo.</p></div>`;
    clear.hidden = !sessions.length;
  };

  document.getElementById("openHistory").addEventListener("click", () => {
    render();
    dialog.showModal();
  });
  list.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    const del = e.target.closest("[data-delete]");
    if (open) {
      const s = listSessions().find((x) => x.id === open.dataset.open);
      if (s) onOpen(s);
      dialog.close();
    } else if (del) {
      deleteSession(del.dataset.delete);
      render();
    }
  });
  clear.addEventListener("click", () => {
    if (confirm("Eliminare tutta la cronologia da questo dispositivo?")) {
      write([]);
      render();
    }
  });
}

/** "Riprendi" list on the welcome screen (the 3 most recent sessions). */
export function renderRecent(container, onOpen) {
  const recent = listSessions().slice(0, 3);
  container.hidden = !recent.length;
  if (!recent.length) return;
  container.innerHTML = `
    <p class="examples-label">Riprendi una sessione</p>
    <div class="recent-list">${recent
      .map(
        (s) => `
        <button type="button" class="recent-item" data-open="${s.id}">
          <span class="ex-icon" aria-hidden="true">${icon("history")}</span>
          <span class="r-text"><span class="h-title">${escapeHtml(s.title)}</span>
          <span class="h-meta">${relativeTime(s.updatedAt)}</span></span>
        </button>`,
      )
      .join("")}</div>`;
  container.onclick = (e) => {
    const btn = e.target.closest("[data-open]");
    const s = btn && listSessions().find((x) => x.id === btn.dataset.open);
    if (s) onOpen(s);
  };
}
