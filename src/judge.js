import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(here, "..", "data", "riftbound-core-rules.txt");

// --- Configuration (override via environment variables) ---
export const MODEL = process.env.JUDGE_MODEL || "claude-opus-5";
export const EFFORT = process.env.JUDGE_EFFORT || "high"; // low | medium | high | xhigh | max
const MAX_TOKENS = Number(process.env.JUDGE_MAX_TOKENS || 32000);

// The official Core Rules, loaded once at startup and reused (cached) on every request.
const RULES_TEXT = fs.readFileSync(RULES_PATH, "utf8");

// One shared client. Credentials are resolved from the environment
// (ANTHROPIC_API_KEY, or an `ant auth login` profile). Never hardcode a key.
const client = new Anthropic();

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

// The system prompt is a stable prefix: mark it for prompt caching so the large
// ruleset is billed at ~10% on every request after the first (1h TTL keeps it
// warm across a play session). Nothing volatile goes before this breakpoint.
const SYSTEM_BLOCKS = [
  {
    type: "text",
    text: SYSTEM_INSTRUCTIONS,
    cache_control: { type: "ephemeral", ttl: "1h" },
  },
];

/**
 * Sanitize the conversation coming from the browser into valid Anthropic messages.
 * Only user/assistant turns with non-empty string content survive.
 */
export function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    out.push({ role: m.role, content });
  }
  // The API requires the first message to be from the user.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/**
 * Open a streaming judge response for the given conversation history.
 * Returns the SDK stream object (async-iterable of events).
 */
export function streamJudge(messages) {
  return client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_BLOCKS,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: EFFORT },
    messages,
  });
}
