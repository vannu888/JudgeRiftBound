import { renderMarkdown, setDomainColors } from "./markdown.js";
import { initCardBrowser, renderCardChips } from "./cards.js";

/** @type {{role: "user"|"assistant", content: string}[]} */
let history = [];
let busy = false;

const $ = (id) => document.getElementById(id);
const chatEl = $("chat");
const welcomeEl = $("welcome");
const formEl = $("askForm");
const inputEl = $("input");
const sendBtn = $("send");

// --- Startup: server status, stats, card archive ------------------------------
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    if (!h.hasApiKey) $("apiWarning").hidden = false;
    setDomainColors(h.domains);
    showStats(h);
    initCardBrowser({ domains: h.domains, types: h.cardTypes, onInsert: insertCardName });
  })
  .catch(() => {});

function showStats(h) {
  const stats = $("stats");
  const items = [["📖", "Core Rules 30/03/2026"]];
  if (h.cards) items.push(["🃏", `${h.cards} carte`]);
  items.push(["⚡", "Gemini"]);
  stats.innerHTML = items.map(([i, t]) => `<span><span aria-hidden="true">${i}</span> ${t}</span>`).join("");
  stats.hidden = false;
}

function insertCardName(name) {
  const v = inputEl.value.trimEnd();
  inputEl.value = v ? `${v} ${name} ` : `${name} `;
  autoGrow();
  inputEl.focus();
}

// --- Composer ---------------------------------------------------------------
function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
}
inputEl.addEventListener("input", autoGrow);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

for (const btn of document.querySelectorAll(".example")) {
  btn.addEventListener("click", () => {
    // Only the question text, not the decorative icon.
    inputEl.value = btn.lastElementChild.textContent.trim().replace(/\s+/g, " ");
    formEl.requestSubmit();
  });
}

$("newChat").addEventListener("click", () => {
  if (busy) return;
  history = [];
  for (const n of chatEl.querySelectorAll(".msg")) n.remove();
  welcomeEl.hidden = false;
  inputEl.value = "";
  autoGrow();
  inputEl.focus();
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (busy || !text) return;
  welcomeEl.hidden = true;
  addUserMessage(text);
  history.push({ role: "user", content: text });
  inputEl.value = "";
  autoGrow();
  await askJudge();
});

function setBusy(state) {
  busy = state;
  sendBtn.disabled = state;
  inputEl.disabled = state;
}

// --- Messages ---------------------------------------------------------------
/** Follow the conversation, unless the user scrolled up to read (force = new message). */
function scrollDown(force = false) {
  const doc = document.scrollingElement;
  if (force || doc.scrollHeight - doc.scrollTop - doc.clientHeight < 240) doc.scrollTop = doc.scrollHeight;
}

function addUserMessage(text) {
  const el = document.createElement("div");
  el.className = "msg user";
  el.innerHTML = `
    <div class="avatar" aria-hidden="true">🧑</div>
    <div class="stack">
      <div class="role">Tu</div>
      <div class="bubble"></div>
    </div>`;
  el.querySelector(".bubble").textContent = text;
  chatEl.append(el);
  scrollDown(true);
}

function createJudgeMessage() {
  const el = document.createElement("div");
  el.className = "msg judge";
  el.innerHTML = `
    <div class="avatar" aria-hidden="true">⚖️</div>
    <div class="stack">
      <div class="role">Judge</div>
      <div class="bubble">
        <div class="cards-used" hidden></div>
        <details class="reasoning" hidden>
          <summary><span class="spark" aria-hidden="true">✦</span> Ragionamento del judge</summary>
          <div class="reasoning-body"></div>
        </details>
        <div class="content cursor"><span class="thinking">Il judge sta consultando le regole…</span></div>
        <div class="msg-foot" hidden>
          <span class="usage"></span>
          <button type="button" class="chip-btn copy">Copia risposta</button>
        </div>
      </div>
    </div>`;
  chatEl.append(el);
  scrollDown(true);
  const q = (s) => el.querySelector(s);
  return {
    cards: q(".cards-used"),
    reasoning: q(".reasoning"),
    reasoningBody: q(".reasoning-body"),
    content: q(".content"),
    foot: q(".msg-foot"),
    usage: q(".usage"),
    copy: q(".copy"),
  };
}

function showError(ui, message) {
  const p = document.createElement("p");
  p.className = "error-note";
  p.textContent = `⚠️ ${message}`;
  ui.content.querySelector(".thinking")?.remove();
  ui.content.append(p);
  scrollDown();
}

function showFooter(ui, usage, answer) {
  if (usage) {
    ui.usage.textContent = `${usage.input_tokens.toLocaleString("it-IT")} token in · ${usage.output_tokens.toLocaleString("it-IT")} out`;
  }
  ui.copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(answer);
      ui.copy.textContent = "Copiata ✓";
    } catch {
      ui.copy.textContent = "Copia non riuscita";
    }
    setTimeout(() => (ui.copy.textContent = "Copia risposta"), 1800);
  });
  ui.foot.hidden = false;
}

// --- Ask the judge (Server-Sent Events over fetch) ----------------------------
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
      /* ignore malformed event */
    }
  }
}

async function askJudge() {
  setBusy(true);
  const ui = createJudgeMessage();
  let answer = "";
  let reasoning = "";

  // Gemini streams many small chunks: repaint at most once per animation frame.
  let frame = 0;
  const paint = () => {
    frame = 0;
    ui.reasoningBody.textContent = reasoning;
    if (answer) ui.content.innerHTML = renderMarkdown(answer);
    scrollDown();
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(paint);
  };
  const flush = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    paint();
  };

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      showError(ui, err.error || "Errore nel contattare il judge.");
      return;
    }

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
            renderCardChips(ui.cards, data.cards ?? []);
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
          case "retry": // server restarts after a transient error: drop partial output
            flush();
            reasoning = "";
            answer = "";
            ui.reasoningBody.textContent = "";
            ui.content.innerHTML = `<span class="thinking">Gemini è sovraccarico, riprovo…</span>`;
            break;
          case "error":
            flush(); // paint pending text first, so it can't overwrite the error
            showError(ui, data.message);
            break;
          case "done":
            flush();
            if (answer) showFooter(ui, data.usage, answer);
            break;
        }
      }
    }
    if (answer.trim()) history.push({ role: "assistant", content: answer });
  } catch (err) {
    console.error(err);
    flush();
    showError(ui, "Connessione interrotta. Riprova.");
  } finally {
    flush();
    ui.content.classList.remove("cursor");
    ui.content.querySelector(".thinking")?.remove();
    setBusy(false);
    inputEl.focus();
  }
}
