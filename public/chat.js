// Messaggi della chat: bolle, azioni sotto le risposte e notifiche.

const chatEl = document.getElementById("chat");
const toastEl = document.getElementById("toast");

/** Follow the conversation, unless the user scrolled up to read (force = new message). */
export function scrollDown(force = false) {
  const doc = document.scrollingElement;
  if (force || doc.scrollHeight - doc.scrollTop - doc.clientHeight < 240) doc.scrollTop = doc.scrollHeight;
}

let toastTimer;
/** Short notification at the bottom of the screen. */
export function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

/** Copy text; falls back to execCommand where the Clipboard API is unavailable (plain http). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
    area.style.cssText = "position:fixed;opacity:0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** A ruling as plain text, for copying and sharing. */
export const plainText = (md) =>
  md
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

export function addUserMessage(text) {
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
  return el;
}

export function createJudgeMessage() {
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
        <div class="content"></div>
        <div class="msg-foot" hidden>
          <span class="usage"></span>
          <div class="msg-actions">
            <button type="button" class="chip-btn act-copy">⧉ Copia</button>
            <button type="button" class="chip-btn act-share" hidden>↗ Condividi</button>
            <button type="button" class="chip-btn act-retry">↻ Rigenera</button>
          </div>
        </div>
      </div>
    </div>`;
  chatEl.append(el);
  scrollDown(true);
  const q = (s) => el.querySelector(s);
  return {
    root: el,
    cards: q(".cards-used"),
    reasoning: q(".reasoning"),
    reasoningBody: q(".reasoning-body"),
    content: q(".content"),
    foot: q(".msg-foot"),
    usage: q(".usage"),
    copy: q(".act-copy"),
    share: q(".act-share"),
    retry: q(".act-retry"),
  };
}

/** A small line under the answer: an error or a status note. */
export function addNote(ui, message, kind = "error") {
  const p = document.createElement("p");
  p.className = kind === "error" ? "error-note" : "status-note";
  p.textContent = message;
  ui.content.append(p);
  scrollDown();
}

const fmt = (n) => Number(n ?? 0).toLocaleString("it-IT");

/** Retry button disabled with a countdown while the free-tier limit resets. */
function countdown(btn, seconds, label) {
  btn.disabled = true;
  const tick = () => {
    if (!btn.isConnected) return;
    if (seconds <= 0) {
      btn.disabled = false;
      btn.textContent = label;
      return;
    }
    btn.textContent = `↻ Riprova tra ${seconds}s`;
    seconds--;
    setTimeout(tick, 1000);
  };
  tick();
}

/**
 * Footer of a finished judge message. Retry/regenerate is shown only on the
 * latest message (see CSS); `retryAfter` seconds keep it disabled.
 */
export function finishJudgeMessage(ui, { answer = "", question = "", usage = null, retryAfter = 0, onRetry }) {
  ui.usage.textContent = usage ? `${fmt(usage.input_tokens)} token in · ${fmt(usage.output_tokens)} out` : "";
  ui.copy.hidden = !answer;
  ui.share.hidden = !answer || !navigator.share;
  const text = () => (question ? `❓ ${question}\n\n⚖️ ${plainText(answer)}` : plainText(answer));
  ui.copy.onclick = async () => toast((await copyText(plainText(answer))) ? "Risposta copiata ✓" : "Copia non riuscita");
  ui.share.onclick = () => navigator.share({ title: "Ruling · Judge Rift Bound", text: text() }).catch(() => {});

  const label = answer ? "↻ Rigenera" : "↻ Riprova";
  ui.retry.textContent = label;
  ui.retry.onclick = onRetry;
  if (retryAfter > 0) countdown(ui.retry, retryAfter, label);
  ui.foot.hidden = false;
}
