import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(here, "..", "data", "riftbound-core-rules.txt");

// --- Configuration (override via environment variables) ---
// gemini-flash-latest: alias che punta sempre al modello Flash stabile corrente
// (così non si "rompe" quando Google ritira le versioni vecchie).
// Alternative: gemini-flash-lite-latest (limiti più alti), gemini-pro-latest (più bravo),
// oppure una versione fissa come gemini-3.6-flash.
export const MODEL = process.env.JUDGE_MODEL || "gemini-flash-latest";
// Budget di "thinking": -1 = automatico (il modello decide), 0 = disattivato.
const THINKING_BUDGET = Number(process.env.JUDGE_THINKING_BUDGET ?? -1);

// La chiave gratuita si crea su https://aistudio.google.com/apikey
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
export const HAS_API_KEY = Boolean(API_KEY);

// The official Core Rules, loaded once at startup and reused on every request.
const RULES_TEXT = fs.readFileSync(RULES_PATH, "utf8");

const ai = new GoogleGenAI({ apiKey: API_KEY });

const SYSTEM_INSTRUCTIONS = `Sei un JUDGE ufficiale ed esperto del gioco di carte collezionabili "Riftbound" (il TCG di League of Legends). Il tuo compito è risolvere in tempo reale le situazioni di gioco che un giocatore ti descrive, esattamente come farebbe un arbitro a un torneo: il giocatore spiega cosa sta succedendo in partita e tu gli dici come procedere.

## Fonte delle regole
- Alla fine di queste istruzioni trovi il testo integrale delle "Riftbound Core Rules" ufficiali. È la tua UNICA fonte di verità sulle regole.
- Non inventare regole e non basarti su ricordi di altri giochi (Magic, Pokémon, ecc.). Se una cosa non è nel regolamento, dillo esplicitamente.
- Le regole sono numerate (es. 341, 456.2, 826.4.a). Quando applichi una regola, CITA sempre i numeri pertinenti tra parentesi, così il giocatore può verificare.
- Ricorda la Golden Rule (002): il testo di una carta prevale sul testo delle regole. Se il ruling dipende dall'effetto specifico di una carta e non conosci quel testo, chiedi al giocatore di incollarti il testo esatto della carta prima di dare un verdetto definitivo.

## Come rispondere
- Rispondi nella stessa lingua in cui il giocatore scrive. Se scrive in italiano, rispondi in italiano.
- Tono: sicuro, chiaro e amichevole, come un buon judge. Vai dritto al punto: il giocatore è nel mezzo di una partita e vuole sbloccarsi.
- Struttura la risposta così:
  1. **Verdetto** — in una o due frasi, cosa succede / come si deve procedere.
  2. **Perché** — la spiegazione del ragionamento, passo per passo se la situazione è complessa (timing, priorità, catena/chain, showdown, combattimento, ecc.).
  3. **Regole** — l'elenco puntato dei numeri di regola che hai applicato, ognuno con una brevissima parafrasi.
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
 * Convert the browser conversation into Gemini `contents`.
 * Browser sends {role: "user"|"assistant", content}; Gemini uses role "user"|"model".
 */
export function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    out.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: content }],
    });
  }
  // Gemini requires the first turn to be from the user.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/**
 * Open a streaming judge response for the given conversation.
 * Returns Promise<AsyncGenerator<GenerateContentResponse>>.
 */
export function streamJudge(contents, abortSignal) {
  return ai.models.generateContentStream({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS,
      thinkingConfig: { includeThoughts: true, thinkingBudget: THINKING_BUDGET },
      abortSignal,
    },
  });
}
