import { renderMarkdown, setDomainColors } from "./markdown.js";
import { request, setLockedHandler, LockedError } from "./api.js";
import { initCardBrowser, renderCardChips } from "./cards.js";
import { openRule, initRulesPanel } from "./rules.js";
import { addUserMessage, createJudgeMessage, finishJudgeMessage, addNote, scrollDown, toast } from "./chat.js";
import { newSession, saveSession, listSessions, initHistory, renderRecent } from "./history.js";
import { initScoreboard, gameContext } from "./score.js";
import { initCombat } from "./combat.js";
import { icon } from "./icons.js";
import { initSuggestions } from "./suggest.js";

const $ = (id) => document.getElementById(id);
const chatEl = $("chat");
const welcomeEl = $("welcome");
const formEl = $("askForm");
const inputEl = $("input");
const sendBtn = $("send");
const archive = $("archive");

/** A session updated this recently is reopened automatically (e.g. Safari reloaded mid-game). */
const RESTORE_WINDOW_MS = 3 * 3600 * 1000;

let session = newSession();
let busy = false;
let controller = null;
let panels = null; // archive tabs, ready once the card data is known

// --- Dialogs: close with the X or by tapping outside ------------------------------
for (const dlg of document.querySelectorAll("dialog")) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
}

// --- Rule numbers and keywords are clickable everywhere --------------------------
document.addEventListener("click", (e) => {
  const ref = e.target.closest("[data-rule], [data-kw]");
  if (ref) {
    e.preventDefault(); // rule citations are links, so they wrap like text
    openRule(ref.dataset.rule ?? ref.dataset.kw);
    return;
  }
  const search = e.target.closest("[data-search-rules]");
  if (search) {
    $("ruleDialog").close();
    openArchive("rules", search.dataset.searchRules);
  }
});

// --- Archive (cards and rules) ---------------------------------------------------
let archiveTab = "cards";
function openArchive(tab = archiveTab, query) {
  archiveTab = tab;
  for (const b of archive.querySelectorAll("[role=tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  for (const p of archive.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab;
  if (!archive.open) archive.showModal();
  const panel = panels?.[tab];
  if (!panel) return;
  if (query === undefined) panel.activate();
  else panel.search(query);
}
archive.addEventListener("click", (e) => {
  const tab = e.target.closest("[role=tab]");
  if (tab) openArchive(tab.dataset.tab);
});
$("openArchive").addEventListener("click", () => openArchive());

function insertCardName(name) {
  archive.close();
  const v = inputEl.value.trimEnd();
  inputEl.value = v ? `${v} ${name} ` : `${name} `;
  autoGrow();
  inputEl.focus();
}

// --- Startup and password gate -----------------------------------------------------
setLockedHandler(() => {
  $("lock").hidden = false;
  $("lockPassword").focus();
});

$("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("lockError");
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("lockPassword").value }),
  }).catch(() => null);
  if (res?.ok) {
    $("lock").hidden = true;
    $("lockPassword").value = "";
    error.hidden = true;
    start();
  } else {
    error.textContent = (await res?.json().catch(() => null))?.error ?? "Connessione non riuscita.";
    error.hidden = false;
  }
});

let startTimer;
async function start(attempt = 0) {
  clearTimeout(startTimer);
  let health;
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    health = await res.json();
  } catch {
    // The free server may still be waking up: try again for a couple of minutes
    // (and whenever the phone gets back online, see below).
    if (attempt < 8) startTimer = setTimeout(() => start(attempt + 1), Math.min(30_000, 2000 * 2 ** attempt));
    return;
  }
  if (health.locked) {
    $("lock").hidden = false;
    $("lockPassword").focus();
    return;
  }
  $("apiWarning").hidden = health.hasApiKey;
  setDomainColors(health.domains);
  const stats = [["book", `${health.rules} regole`], ["cards", `${health.cards} carte`], ["bolt", "Gemini"]];
  $("stats").innerHTML = stats.map(([i, t]) => `<span>${icon(i)}${t}</span>`).join("");
  $("stats").hidden = false;
  if (!panels) {
    panels = {
      cards: initCardBrowser({ domains: health.domains, types: health.cardTypes, onInsert: insertCardName }),
      rules: initRulesPanel(),
    };
    if (archive.open) openArchive(); // opened while the server was still waking up
  }
}

// --- Composer ------------------------------------------------------------------
// The long hint does not fit on one line on a phone.
const narrow = matchMedia("(max-width: 600px)");
const setPlaceholder = () => {
  inputEl.placeholder = narrow.matches ? "Descrivi la situazione…" : "Descrivi la situazione (nomi delle carte in inglese)…";
};
setPlaceholder();
narrow.addEventListener("change", setPlaceholder);

function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
}
inputEl.addEventListener("input", autoGrow);
// Card names are suggested while typing (see suggest.js).
const suggestions = initSuggestions({ input: inputEl, bar: $("suggest"), onChange: autoGrow });
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

for (const btn of document.querySelectorAll(".example")) {
  btn.addEventListener("click", () => {
    inputEl.value = btn.lastElementChild.textContent.trim().replace(/\s+/g, " "); // not the icon
    formEl.requestSubmit();
  });
}

function setBusy(state) {
  busy = state;
  sendBtn.classList.toggle("stop", state);
  sendBtn.title = state ? "Ferma la risposta" : "Invia (Invio)";
  sendBtn.querySelector(".send-label").textContent = state ? "Stop" : "Chiedi al judge";
  sendBtn.querySelector(".send-icon use").setAttribute("href", state ? "#i-stop" : "#i-send");
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) {
    // The button is "Stop" while the judge answers; Enter must not stop it by accident.
    if (e.submitter === sendBtn) controller?.abort();
    else toast("Attendi la risposta (o premi Stop)");
    return;
  }
  const text = inputEl.value.trim();
  if (!text) return;
  suggestions.hide();
  welcomeEl.hidden = true;
  addUserMessage(text);
  session.messages.push({ role: "user", content: text });
  saveSession(session); // kept even if the page reloads before the answer
  inputEl.value = "";
  autoGrow();
  ask();
});

// --- Sessions ------------------------------------------------------------------
function showSession(s) {
  if (busy) controller?.abort();
  session = s;
  for (const n of chatEl.querySelectorAll(".msg")) n.remove();
  welcomeEl.hidden = s.messages.length > 0;
  let question = "";
  for (const m of s.messages) {
    if (m.role === "user") {
      addUserMessage(m.content);
      question = m.content;
    } else {
      const ui = createJudgeMessage();
      renderCardChips(ui.cards, m.cards ?? []);
      ui.content.innerHTML = renderMarkdown(m.content);
      finishJudgeMessage(ui, { answer: m.content, question, onRetry: regenerate });
    }
  }
  if (s.messages.at(-1)?.role === "user") {
    // The page was closed before the answer arrived.
    const ui = createJudgeMessage();
    addNote(ui, "La risposta non è stata completata.", "status");
    finishJudgeMessage(ui, { onRetry: regenerate });
  }
  if (!s.messages.length) renderRecent($("recent"), showSession);
  scrollDown(true);
}

$("newChat").addEventListener("click", () => {
  showSession(newSession());
  inputEl.focus();
});

initHistory({ onOpen: showSession, current: () => session.id });

// --- Asking the judge (Server-Sent Events over fetch) --------------------------
/** Yield every complete SSE event in `buffer.text`, leaving any partial one in place. */
function* parseEvents(buffer) {
  let sep;
  while ((sep = buffer.text.indexOf("\n\n")) !== -1) {
    const raw = buffer.text.slice(0, sep);
    buffer.text = buffer.text.slice(sep + 2);
    let event = "";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!event) continue;
    try {
      yield { event, data: data ? JSON.parse(data) : {} };
    } catch {
      /* ignore a malformed event */
    }
  }
}

/** Drop the last answer (if any) and ask the same question again. */
function regenerate() {
  if (busy) return;
  if (session.messages.at(-1)?.role === "assistant") session.messages.pop();
  if (session.messages.at(-1)?.role !== "user") return;
  const last = chatEl.lastElementChild;
  if (last?.classList.contains("judge")) last.remove();
  saveSession(session);
  ask({ fresh: true });
}

/** `fresh`: skip the server's cache of identical questions (a new answer is wanted). */
async function ask({ fresh = false } = {}) {
  // Another conversation may be opened while this one is answered: the answer
  // (even a partial one) belongs to the conversation that asked.
  const current = session;
  setBusy(true);
  controller = new AbortController();
  const ui = createJudgeMessage();
  ui.root.classList.add("streaming");
  ui.content.innerHTML = `<span class="thinking">Il judge sta consultando le regole…</span>`;
  ui.content.classList.add("cursor");

  let answer = "";
  let reasoning = "";
  let cards = [];
  let meta = {}; // the "done" event: usage, model, cache
  let error = "";
  let retryAfter = 0;
  let stopped = false;

  // Gemini streams many small chunks: repaint about 12 times a second, which
  // still reads as live text but spares the phone's CPU (and battery).
  let timer = 0;
  const paint = () => {
    timer = 0;
    ui.reasoningBody.textContent = reasoning;
    if (answer) ui.content.innerHTML = renderMarkdown(answer);
    scrollDown();
  };
  const schedule = () => {
    timer ||= setTimeout(paint, 80);
  };
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    paint();
  };

  try {
    const res = await request("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: current.messages.map(({ role, content }) => ({ role, content })),
        game: gameContext(),
        fresh,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      error = err.error || "Errore nel contattare il judge.";
      retryAfter = err.retryAfter ?? 0;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const buffer = { text: "" };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer.text += decoder.decode(value, { stream: true });
        for (const { event, data } of parseEvents(buffer)) {
          switch (event) {
            case "cards":
              cards = data.cards ?? [];
              renderCardChips(ui.cards, cards);
              scrollDown();
              break;
            case "reasoning":
              reasoning += data.text;
              ui.reasoning.hidden = false;
              if (!answer) ui.reasoning.open = true; // show the thinking live
              schedule();
              break;
            case "answer":
              if (!answer) ui.reasoning.open = false; // collapse once the verdict starts
              answer += data.text;
              schedule();
              break;
            case "retry": // the server starts over (another model or a retry): drop partial output
              flush();
              reasoning = "";
              answer = "";
              ui.reasoningBody.textContent = "";
              ui.content.innerHTML = `<span class="thinking">${
                data.reason === "quota" ? "Limite raggiunto, passo al modello di riserva…" : "Gemini è sovraccarico, riprovo…"
              }</span>`;
              break;
            case "error":
              error = data.message;
              retryAfter = data.retryAfter ?? 0;
              break;
            case "done":
              meta = data;
              break;
          }
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") stopped = true;
    else if (err instanceof LockedError) error = "Accesso protetto: inserisci la password e riprova.";
    else if (!navigator.onLine)
      error = "Sei offline: per le risposte del judge serve internet. Segnapunti, cronologia e regole già consultate funzionano anche offline.";
    else error = "Connessione interrotta. Riprova.";
  }

  flush(); // paint pending text first, so nothing overwrites the notes below
  ui.root.classList.remove("streaming");
  ui.content.classList.remove("cursor");
  ui.content.querySelector(".thinking")?.remove();
  if (answer.trim()) {
    current.messages.push({ role: "assistant", content: answer, cards });
    saveSession(current);
  }
  if (stopped) addNote(ui, "Risposta interrotta.", "stopped");
  if (error) addNote(ui, error);
  const question = current.messages.findLast((m) => m.role === "user")?.content ?? "";
  finishJudgeMessage(ui, { answer, question, meta, retryAfter, onRetry: regenerate });
  controller = null;
  setBusy(false);
  inputEl.focus({ preventScroll: true });
}

// --- Offline use and updates (service worker) --------------------------------
if ("serviceWorker" in navigator) {
  const hadWorker = Boolean(navigator.serviceWorker.controller); // so a takeover means an update
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadWorker) $("updateBar").hidden = false;
  });
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      // A Home Screen app is resumed rather than reloaded: look for updates then too.
      let checked = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || Date.now() - checked < 30 * 60_000) return;
        checked = Date.now();
        reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
$("updateBar").addEventListener("click", () => location.reload());

// --- Go ----------------------------------------------------------------------
initScoreboard();
initCombat({
  onAsk(text) {
    inputEl.value = text;
    autoGrow();
    inputEl.focus();
    toast("Combattimento nella domanda: aggiungi i dettagli e invia");
  },
});
start();
window.addEventListener("online", () => start());
const last = listSessions()[0];
if (last && Date.now() - last.updatedAt < RESTORE_WINDOW_MS) showSession(last);
else renderRecent($("recent"), showSession);
