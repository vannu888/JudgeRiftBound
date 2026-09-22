# ⚖️ Judge Rift Bound

Un **judge virtuale** per [Rift Bound](https://riftbound.leagueoflegends.com/): descrivi una
situazione di gioco e ricevi in tempo reale un ruling — come procedere e perché — ragionato sul
**regolamento ufficiale** (Riftbound Core Rules) tramite la **Claude API**.

- 🧠 Il judge ragiona sulle regole complete (le Core Rules sono incluse nel system prompt).
- 💬 Interfaccia chat con risposte in **streaming**, ragionamento del judge visibile e supporto ai
  follow-up (puoi continuare a chiedere sulla stessa situazione).
- 📖 Ogni verdetto cita i **numeri delle regole** applicate, così puoi verificare.
- ⚡ **Prompt caching**: il regolamento viene messo in cache, quindi dopo la prima domanda ogni
  risposta è molto più veloce ed economica.

## Requisiti

- [Node.js](https://nodejs.org/) 18.17 o superiore
- Una **chiave API Anthropic** (da [console.anthropic.com](https://console.anthropic.com/settings/keys))

## Avvio rapido

```bash
# 1. Installa le dipendenze
npm install

# 2. Configura la chiave API
cp .env.example .env
#    ...poi apri .env e incolla la tua ANTHROPIC_API_KEY

# 3. Avvia
npm start
```

Apri il browser su **http://localhost:3000** e comincia a fare domande.

## Come si usa

Scrivi cosa sta succedendo in partita, il più chiaramente possibile: di chi è il turno, la fase, le
unità/carte coinvolte, le keyword. Più contesto dai, più preciso è il ruling. Se manca qualcosa, il
judge te lo chiede.

> Esempio: *"È il turno dell'avversario, siamo in uno showdown a un battlefield. Io ho un'unità con
> Tank e lui gioca una spell con Reaction: in che ordine si risolve la chain?"*

Se il ruling dipende dal testo esatto di una carta, incollalo nella chat: per la **Golden Rule** il
testo della carta prevale sulle regole generali.

## Configurazione

Tutte le opzioni si impostano nel file `.env` (vedi `.env.example`):

| Variabile           | Default          | Descrizione                                                        |
| ------------------- | ---------------- | ------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | —                | **Obbligatoria.** La tua chiave API Anthropic.                     |
| `PORT`              | `3000`           | Porta del server.                                                  |
| `JUDGE_MODEL`       | `claude-opus-5`  | Modello Claude. Usa `claude-sonnet-5` per più velocità/costo minore. |
| `JUDGE_EFFORT`      | `high`           | Profondità di ragionamento: `low` \| `medium` \| `high` \| `xhigh` \| `max`. |
| `JUDGE_MAX_TOKENS`  | `32000`          | Lunghezza massima della risposta.                                  |

## Struttura del progetto

```
JudgeRiftBound/
├── server.js                     # server Express + endpoint SSE /api/ask
├── src/judge.js                  # system prompt del judge + chiamata Claude (streaming, caching)
├── data/riftbound-core-rules.txt # testo integrale delle Core Rules (fonte del judge)
└── public/                       # interfaccia web (HTML/CSS/JS, nessun build step)
    ├── index.html
    ├── styles.css
    └── app.js
```

## Note

- Il regolamento incluso è la versione **Core Rules del 2026-03-30**. Per aggiornarlo, sostituisci
  `data/riftbound-core-rules.txt` con il nuovo testo.
- Questo strumento si basa sulle Core Rules e **non sostituisce** un judge certificato: in un torneo
  ufficiale la parola finale spetta all'arbitro presente.
- La chiave API resta **solo sul server** (nel file `.env`, escluso da Git) e non viene mai esposta al
  browser.
