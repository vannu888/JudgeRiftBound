// --- State ---
/** @type {{role: "user"|"assistant", content: string}[]} */
let history = [];
let busy = false;

// --- Elements ---
const chatEl = document.getElementById("chat");
const welcomeEl = document.getElementById("welcome");
const formEl = document.getElementById("askForm");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const newChatBtn = document.getElementById("newChat");
const apiWarning = document.getElementById("apiWarning");

// --- Health check (warn if the server has no API key) ---
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    if (!h.hasApiKey) apiWarning.hidden = false;
  })
  .catch(() => {});

// --- Textarea auto-grow ---
function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + "px";
}
inputEl.addEventListener("input", autoGrow);

// Enter = send, Shift+Enter = newline
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

// --- Example prompts ---
document.querySelectorAll(".example").forEach((btn) => {
  btn.addEventListener("click", () => {
    inputEl.value = btn.textContent.trim().replace(/\s+/g, " ");
    autoGrow();
    inputEl.focus();
    formEl.requestSubmit();
  });
});

// --- New session ---
newChatBtn.addEventListener("click", () => {
  if (busy) return;
  history = [];
  chatEl.querySelectorAll(".msg").forEach((n) => n.remove());
  if (welcomeEl) welcomeEl.style.display = "";
  inputEl.value = "";
  autoGrow();
  inputEl.focus();
});

// --- Submit ---
formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const text = inputEl.value.trim();
  if (!text) return;

  if (welcomeEl) welcomeEl.style.display = "none";

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

// --- Rendering helpers ---
function addUserMessage(text) {
  const el = document.createElement("div");
  el.className = "msg user";
  el.innerHTML = `<div class="role">Tu</div><div class="bubble"></div>`;
  el.querySelector(".bubble").textContent = text;
  chatEl.appendChild(el);
  scrollDown();
}

function createJudgeMessage() {
  const el = document.createElement("div");
  el.className = "msg judge";
  el.innerHTML = `
    <div class="role">Judge</div>
    <div class="bubble">
      <details class="reasoning" hidden>
        <summary>Ragionamento del judge</summary>
        <div class="reasoning-body"></div>
      </details>
      <div class="content cursor"></div>
    </div>`;
  chatEl.appendChild(el);
  scrollDown();
  return {
    root: el,
    reasoning: el.querySelector(".reasoning"),
    reasoningBody: el.querySelector(".reasoning-body"),
    content: el.querySelector(".content"),
  };
}

function scrollDown() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

// --- Ask the judge (SSE over fetch) ---
async function askJudge() {
  setBusy(true);
  const ui = createJudgeMessage();
  let answer = "";
  let reasoning = "";
  let gotAnswer = false;

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    if (!res.ok || !res.body) {
      let msg = "Errore nel contattare il judge.";
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch {}
      showError(ui, msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const { event, data } = parseSSE(rawEvent);
        if (!event) continue;

        if (event === "reasoning") {
          reasoning += data.text;
          ui.reasoning.hidden = false;
          if (!gotAnswer) ui.reasoning.open = true; // auto-open while thinking
          ui.reasoningBody.textContent = reasoning;
          scrollDown();
        } else if (event === "answer") {
          if (!gotAnswer) {
            gotAnswer = true;
            ui.reasoning.open = false; // collapse reasoning once the verdict starts
          }
          answer += data.text;
          ui.content.innerHTML = renderMarkdown(answer);
          scrollDown();
        } else if (event === "retry") {
          // Server is re-attempting after a transient error: discard the
          // partial output so the fresh attempt doesn't append to it.
          reasoning = "";
          answer = "";
          gotAnswer = false;
          ui.reasoningBody.textContent = "";
          ui.content.innerHTML = "";
        } else if (event === "error") {
          showError(ui, data.message);
        } else if (event === "done") {
          if (data.usage) attachUsage(ui, data.usage);
        }
      }
    }

    ui.content.classList.remove("cursor");
    if (answer.trim()) {
      history.push({ role: "assistant", content: answer });
    }
  } catch (err) {
    console.error(err);
    showError(ui, "Connessione interrotta. Riprova.");
  } finally {
    ui.content.classList.remove("cursor");
    setBusy(false);
    inputEl.focus();
  }
}

function parseSSE(raw) {
  let event = "";
  let dataStr = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  let data = {};
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch {}
  }
  return { event, data };
}

function showError(ui, message) {
  ui.content.classList.remove("cursor");
  const p = document.createElement("p");
  p.className = "error-note";
  p.textContent = "⚠️ " + message;
  ui.content.appendChild(p);
  scrollDown();
}

function attachUsage(ui, usage) {
  const cached = usage.cache_read_input_tokens || 0;
  const el = document.createElement("div");
  el.className = "usage";
  el.textContent =
    `token: ${usage.input_tokens ?? 0} in · ${usage.output_tokens ?? 0} out` +
    (cached ? ` · ${cached} da cache` : "");
  ui.root.querySelector(".bubble").appendChild(el);
}

// --- Minimal, safe Markdown renderer ---
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMd(s) {
  // Order matters: escape first, then apply inline formatting.
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function renderMarkdown(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let html = "";
  let listType = null; // "ul" | "ol" | null
  let para = [];

  const flushPara = () => {
    if (para.length) {
      html += "<p>" + para.map(inlineMd).join("<br>") + "</p>";
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushPara();
      closeList();
      continue;
    }
    const heading = t.match(/^(#{1,4})\s+(.*)$/);
    const ul = t.match(/^[-*]\s+(.*)$/);
    const ol = t.match(/^\d+[.)]\s+(.*)$/);

    if (heading) {
      flushPara();
      closeList();
      html += "<h3>" + inlineMd(heading[2]) + "</h3>";
    } else if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html += "<ul>";
      }
      html += "<li>" + inlineMd(ul[1]) + "</li>";
    } else if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html += "<ol>";
      }
      html += "<li>" + inlineMd(ol[1]) + "</li>";
    } else {
      closeList();
      para.push(t);
    }
  }
  flushPara();
  closeList();
  return html;
}
