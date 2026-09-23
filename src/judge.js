// Il "cervello" del judge: prompt di sistema (regolamento completo) e
// chiamata in streaming a Google Gemini.

import { GoogleGenAI } from "@google/genai";
import { formatCardsBlock } from "./cards.js";
import { RULES_TEXT } from "./rules.js";

// --- Configuration (override via environment variables) ---
// gemini-flash-latest: alias che punta sempre al modello Flash stabile corrente.
// Alternative: gemini-flash-lite-latest (limiti più alti), gemini-pro-latest (più bravo),
// oppure una versione fissa come gemini-3.6-flash.
export const MODEL = process.env.JUDGE_MODEL || "gemini-flash-latest";
// Budget di "thinking": -1 = automatico (il modello decide), 0 = disattivato.
const THINKING_BUDGET = Number(process.env.JUDGE_THINKING_BUDGET ?? -1);

// La chiave gratuita si crea su https://aistudio.google.com/apikey
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
export const HAS_API_KEY = Boolean(API_KEY);

export const MAX_MESSAGES = 40; // safety cap on conversation length
export const MAX_CHARS = 8000; // safety cap on a single message

// Created on first use, so importing this module never needs a key.
let client;
const ai = () => (client ??= new GoogleGenAI({ apiKey: API_KEY }));

// Stable for every request (only the conversation changes), so Gemini can reuse
// it from its automatic prompt cache.
const SYSTEM_INSTRUCTIONS = `Sei un JUDGE ufficiale ed esperto del gioco di carte collezionabili "Riftbound" (il TCG di League of Legends). Il tuo compito è risolvere in tempo reale le situazioni di gioco che un giocatore ti descrive, esattamente come farebbe un arbitro a un torneo: il giocatore spiega cosa sta succedendo in partita e tu gli dici come procedere.

## Fonte delle regole
- Alla fine di queste istruzioni trovi il testo integrale delle "Riftbound Core Rules" ufficiali. È la tua UNICA fonte di verità sulle regole.
- Non inventare regole e non basarti su ricordi di altri giochi (Magic, Pokémon, ecc.). Se una cosa non è nel regolamento, dillo esplicitamente.
- Le regole sono numerate (es. 341, 456.2, 826.4.a). Quando applichi una regola, CITA sempre i numeri pertinenti tra parentesi, così il giocatore può verificare.

## Testo delle carte
- Quando il giocatore nomina delle carte, il suo messaggio inizia con un blocco [CARTE CITATE] con il testo ufficiale (tipo, dominio, costo in Energy/Power, Might, testo, eventuali errata e ban). Per la Golden Rule (002) il testo della carta prevale sulle regole generali: basa il ruling su quel testo e citalo quando serve.
- Il blocco è generato automaticamente riconoscendo i nomi: può contenere carte che non c'entrano (ignorale) e, se il giocatore nomina un campione, tutte le sue versioni (usa quella pertinente o chiedi quale).
- Se il ruling dipende da una carta che NON compare nel blocco, chiedi il nome esatto della carta (in inglese, come stampato) o il suo testo prima di dare un verdetto definitivo.
- Se una carta risulta BANNED, segnalalo quando è rilevante (es. deck building o tornei).

## Stato della partita
- Se il messaggio contiene un blocco [STATO PARTITA], è il punteggio attuale dal segnapunti del giocatore: usalo per i ruling su punti e vittoria (es. il punto vincente, 466.1.b, e la vittoria, 467). Il primo giocatore elencato è chi ti scrive.

## Come rispondere
- Rispondi nella stessa lingua in cui il giocatore scrive. Se scrive in italiano, rispondi in italiano.
- Tono: sicuro, chiaro e amichevole, come un buon judge. Vai dritto al punto: il giocatore è nel mezzo di una partita e vuole sbloccarsi.
- Struttura la risposta così:
  1. **Verdetto** — in una o due frasi, cosa succede / come si deve procedere.
  2. **Perché** — la spiegazione del ragionamento, passo per passo se la situazione è complessa (timing, priorità, catena/chain, showdown, combattimento, ecc.).
  3. **Regole** — l'elenco puntato dei numeri di regola (e delle carte) che hai applicato, ognuno con una brevissima parafrasi.
- Se mancano informazioni essenziali per decidere (di chi è il turno, quale stato/fase, quali carte o keyword coinvolte, chi ha la priorità/focus), NON tirare a indovinare: dai comunque il quadro generale e poi fai domande specifiche e mirate per completare il ruling.
- Se il giocatore descrive più sotto-domande, rispondi a tutte in modo ordinato.
- Non essere prolisso oltre il necessario, ma non sacrificare la correttezza: la precisione del ruling viene prima di tutto.

## Limiti
- Sei un assistente basato sul regolamento, non un arbitro certificato: per un torneo ufficiale la parola finale spetta al judge presente. Menzionalo solo se il giocatore chiede qualcosa che va oltre le regole di gioco (es. penalità di torneo, policy) che non è coperto dal testo fornito.

Di seguito il testo integrale delle Riftbound Core Rules.
======================= RIFTBOUND CORE RULES =======================
${RULES_TEXT}
======================= FINE REGOLE =======================`;

/**
 * Validate the conversation sent by the browser.
 * Returns [{ role: "user"|"assistant", content }] starting with a user turn.
 */
export function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (content) out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

const MODES = {
  duel: "1v1 Duello (480)",
  match: "1v1 Match al meglio di 3 (481)",
  ffa3: "Tutti contro tutti, 3 giocatori (482)",
  ffa4: "Tutti contro tutti, 4 giocatori (483)",
  team: "2v2 a squadre (484)",
};

const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Validate the score sent by the scoreboard; null if absent or malformed. */
export function sanitizeGame(raw) {
  if (!raw || typeof raw !== "object" || !Object.hasOwn(MODES, raw.mode)) return null;
  const victory = int(raw.victory, 1, 50);
  if (!victory || !Array.isArray(raw.players)) return null;
  const players = raw.players.slice(0, 4).map((p) => ({
    name: String(p?.name ?? "").replace(/[\[\]\r\n]/g, " ").trim().slice(0, 24) || "Giocatore",
    points: int(p?.points, 0, 99) ?? 0,
    wins: int(p?.wins, 0, 9) ?? 0,
  }));
  return players.length >= 2 ? { mode: raw.mode, victory, players } : null;
}

export function formatGameBlock(game) {
  const score = game.players
    .map((p) => `${p.name} ${p.points}${game.mode === "match" ? ` (partite vinte ${p.wins})` : ""}`)
    .join(" · ");
  return `[STATO PARTITA dal segnapunti] Modalità: ${MODES[game.mode]}. Punti per vincere: ${game.victory}. Punteggio: ${score}.`;
}

/**
 * Convert to Gemini `contents`. The text of the cited cards and the current
 * score go into the latest question (not into the system prompt, which must
 * stay identical to be reused from Gemini's cache).
 */
export function buildContents(messages, cards = [], game = null) {
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  const context = [];
  if (cards.length) context.push({ text: formatCardsBlock(cards) });
  if (game) context.push({ text: formatGameBlock(game) });
  return messages.map((m, i) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts:
      i === lastUser && context.length
        ? [...context, { text: `Domanda del giocatore:\n${m.content}` }]
        : [{ text: m.content }],
  }));
}

/** Open a streaming judge response. Resolves to an AsyncGenerator of chunks. */
export function streamJudge(contents, abortSignal) {
  return ai().models.generateContentStream({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS,
      thinkingConfig: { includeThoughts: true, thinkingBudget: THINKING_BUDGET },
      abortSignal,
    },
  });
}
