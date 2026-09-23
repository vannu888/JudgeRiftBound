// Rendering sicuro (HTML sempre escapato) delle risposte del judge e del testo
// delle carte, con i simboli di gioco ([Might], [1], [Fury], [Ganking]…) come
// piccoli badge. Nessuna dipendenza dal DOM: testabile anche in Node.

let domainColors = {
  fury: "#CB222D",
  calm: "#15AA71",
  mind: "#24769A",
  body: "#e2710c",
  chaos: "#6B4891",
  order: "#CDA902",
};

/** Override the domain palette with the one from the card database. */
export function setDomainColors(map) {
  domainColors = Object.fromEntries(Object.entries(map ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
}

export const domainColor = (name) => domainColors[String(name).toLowerCase()] ?? "#8a9bb0";

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** One bracketed game symbol as HTML (input is already escaped). */
function symbolHtml(inner) {
  const low = inner.toLowerCase();
  if (/^(\d{1,2}|x)$/.test(low)) return `<span class="sym sym-num" title="Energy">${inner.toUpperCase()}</span>`;
  if (domainColors[low]) {
    return `<span class="sym sym-dom" style="--dc:${domainColors[low]}" title="Power: ${cap(low)}">${cap(low)}</span>`;
  }
  if (low === "might") return `<span class="sym sym-might" title="Might">⚔</span>`;
  if (low === "rune") return `<span class="sym sym-rune" title="Rune di qualsiasi dominio">◆</span>`;
  if (low === "tap") return `<span class="sym sym-tap" title="Tap (esaurisci)">↷</span>`;
  return `<button type="button" class="kw" data-kw="${inner}" title="Leggi la regola">${cap(inner)}</button>`;
}

/** Replace [Keyword]/[Assault 2]/[1]/[Fury]… in already-escaped text with badges. */
export function withSymbols(escaped) {
  return escaped.replace(/\[(\d{1,2}|[Xx]|[A-Za-z][A-Za-z -]{0,20}(?: \d{1,2})?)\]/g, (_, inner) =>
    symbolHtml(inner.trim()),
  );
}

/**
 * Rule citations ("309.1.a", "(154)", "regola 340") as buttons that open the
 * official text. A bare 3-digit number only counts in a citation context, so
 * "100 carte" or "250.000 token" stay plain text.
 */
export function withRuleRefs(escaped) {
  return escaped.replace(/(?<![\w.#&;/-])\d{3}(?:\.\d{1,2}(?:\.[0-9a-z]{1,2})*)?(?![\w-]|\.\d)/g, (id, at, str) => {
    if (!id.includes(".") && !/(\(|\*\*|regol[ae] |rules? |\d, )$/i.test(str.slice(Math.max(0, at - 8), at))) return id;
    return `<a class="rule-ref" href="#regola-${id}" data-rule="${id}" title="Leggi la regola ${id}">${id}</a>`;
  });
}

function inline(s) {
  return withSymbols(withRuleRefs(escapeHtml(s)))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

/** Card rules text (plain text with symbols and line breaks). */
export function renderCardText(text) {
  return withSymbols(escapeHtml(text ?? "")).replace(/\n+/g, "<br>");
}

/** Minimal Markdown: headings, lists, blockquotes, rules, bold/italic/code. */
export function renderMarkdown(text) {
  let html = "";
  let list = null; // "ul" | "ol"
  let para = [];
  let quote = [];

  const flushPara = () => {
    if (para.length) html += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  const flushQuote = () => {
    if (quote.length) html += `<blockquote>${quote.map(inline).join("<br>")}</blockquote>`;
    quote = [];
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    closeList();
  };

  for (const line of String(text).replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    let m;
    if (!t) {
      flushAll();
    } else if ((m = t.match(/^#{1,4}\s+(.*)$/))) {
      flushAll();
      html += `<h3>${inline(m[1])}</h3>`;
    } else if (/^(-{3,}|\*{3,})$/.test(t)) {
      flushAll();
      html += "<hr>";
    } else if ((m = t.match(/^>\s?(.*)$/))) {
      flushPara();
      closeList();
      quote.push(m[1]);
    } else if ((m = t.match(/^[-*•]\s+(.*)$/)) || (m = t.match(/^\d+[.)]\s+(.*)$/))) {
      flushPara();
      flushQuote();
      const kind = /^\d/.test(t) ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        list = kind;
        html += `<${kind}>`;
      }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      flushQuote();
      closeList();
      para.push(t);
    }
  }
  flushAll();
  return html;
}
