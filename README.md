# ⚖️ Judge Rift Bound

Un **judge virtuale** per [Rift Bound](https://riftbound.leagueoflegends.com/): descrivi una
situazione di gioco e ricevi in tempo reale un ruling — come procedere e perché — ragionato sul
**regolamento ufficiale** (Riftbound Core Rules) e sul **testo delle carte**, tramite l'**API
gratuita di Google Gemini**.

- 🧠 Il judge ragiona sulle regole complete (le Core Rules sono nel prompt di sistema).
- 🃏 **Database di ~945 carte**: quando nomini una carta, il suo testo ufficiale (costo, Might,
  keyword, errata, ban) viene passato al judge — per la Golden Rule il testo della carta prevale.
- 🔎 **Archivio carte** con ricerca, filtri per dominio e tipo, e inserimento nella domanda.
- 💬 Chat con risposte in **streaming**, ragionamento del judge visibile e follow-up.
- 📖 Ogni verdetto cita i **numeri delle regole** applicate, così puoi verificare.
- 🆓 Usa il **piano gratuito di Google Gemini** (nessuna carta di credito richiesta).

## Requisiti

- [Node.js](https://nodejs.org/) 18.17 o superiore
- Una **chiave API di Google Gemini** — gratuita, da [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

## Come ottenere la chiave (gratis)

1. Vai su **https://aistudio.google.com/apikey** e accedi con un account Google.
2. Clicca **Create API key** (crea chiave API) e copiala.
3. Mettila nel file `.env` del progetto (vedi sotto). **Non** scriverla in `.env.example` né in
   altri file su GitHub: sono pubblici.

Il piano gratuito è permanente e senza carta di credito, con limiti pensati per l'uso personale.
Ogni domanda include l'intero regolamento (~95k token) e il piano gratuito consente circa 250.000
token di input al minuto per modello: se fai domande a raffica, l'app ti dice quanti secondi
attendere.

## Avvio rapido (in locale)

```bash
# 1. Installa le dipendenze
npm install

# 2. Configura la chiave API
cp .env.example .env        # poi apri .env e incolla la tua GEMINI_API_KEY
#    su Windows: doppio clic su crea-env-windows.bat, incolli la chiave e premi Invio

# 3. Avvia
npm start
```

Apri il browser su **http://localhost:3000** e comincia a fare domande.

### Usarla dal telefono sulla stessa Wi-Fi

Con il server avviato sul PC, scopri l'IP locale del PC (`ipconfig` su Windows → "IPv4 Address",
es. `192.168.1.20`) e sul telefono apri `http://192.168.1.20:3000`. Devono essere sulla stessa rete
Wi-Fi e il PC deve restare acceso (consenti l'accesso a Node se il firewall lo chiede).

## Metterla online gratis (per usarla ovunque dall'iPhone)

Puoi pubblicarla su un servizio con piano gratuito (es. [Render](https://render.com)) direttamente
dal repository GitHub:

1. Crea un account su render.com (login con GitHub).
2. **New → Web Service** → collega questo repository.
3. Build command: `npm install` · Start command: `npm start`.
4. In **Environment** aggiungi la variabile `GEMINI_API_KEY` con la tua chiave.
5. Deploy → ottieni un link `https://...onrender.com` da aprire su Safari e "Aggiungi a Home".

> Il server usa già `process.env.PORT`, quindi funziona senza modifiche sulla maggior parte degli host.
> Se il link è pubblico, valuta di aggiungere una password d'accesso.

## Come si usa

Scrivi cosa sta succedendo in partita: di chi è il turno, la fase, le unità/carte coinvolte, le
keyword. Più contesto dai, più preciso è il ruling. Se manca qualcosa, il judge te lo chiede.

> Esempio: *"L'avversario gioca Falling Comet sulla mia unità: posso rispondere con una Reaction?
> In che ordine si risolve la chain?"*

**Scrivi i nomi delle carte in inglese, come sono stampati** (es. `Vi, Destructive`, `Falling Comet`).
Basta anche il nome del campione (`il mio Jinx…`): il judge riceve tutte le sue versioni. Sopra la
risposta vedi le **carte considerate**: toccane una per leggerne il testo. Se non ricordi il nome
esatto, apri **🃏 Carte**, cerca e premi **Usa nella domanda**.

## Database delle carte

Il file `data/cards.json` contiene i dati **funzionali** di tutte le carte (nome, tipo, dominio, costo in Energy/Power, Might, tag, testo delle regole, errata e ban),
presi da [piltoverarchive.com/cards](https://piltoverarchive.com/cards). Niente artwork, flavor text o
prezzi.

Quando esce un nuovo set, aggiornalo con:

```bash
npm run cards
```

Lo script scorre educatamente le pagine del sito (una richiesta alla volta) e riscrive
`data/cards.json`. Il server riconosce le carte nominate nella conversazione (nomi completi e nomi dei
campioni, con attenzione a falsi positivi come la parola italiana "vi") e ne allega il testo alla
domanda, fino a 16 carte, così il prompt resta leggero.

## Configurazione

Opzioni nel file `.env` (vedi `.env.example`):

| Variabile               | Default               | Descrizione                                                          |
| ----------------------- | --------------------- | -------------------------------------------------------------------- |
| `GEMINI_API_KEY`        | —                     | **Obbligatoria.** La tua chiave API Google Gemini (gratuita).        |
| `PORT`                  | `3000`                | Porta del server.                                                    |
| `JUDGE_MODEL`           | `gemini-flash-latest` | `gemini-flash-lite-latest` = limiti più alti; `gemini-pro-latest` = più bravo; oppure una versione fissa (es. `gemini-3.6-flash`). |
| `JUDGE_THINKING_BUDGET` | `-1`                  | Ragionamento: `-1` automatico, `0` disattivato, oppure un numero di token. |
| `JUDGE_TIMEOUT_MS`      | `60000`               | Dopo quanti ms senza risposta da Gemini la richiesta viene interrotta. |

## Struttura del progetto

```
JudgeRiftBound/
├── server.js                     # server Express: rotte /api/health, /api/cards, /api/ask
├── src/
│   ├── judge.js                  # prompt del judge + chiamata Gemini (streaming, thinking)
│   ├── ask.js                    # risposta in streaming (SSE): retry, timeout, errori
│   └── cards.js                  # database carte: riconoscimento, ricerca, formattazione
├── scripts/fetch-cards.mjs       # aggiorna data/cards.json (npm run cards)
├── data/
│   ├── riftbound-core-rules.txt  # testo integrale delle Core Rules
│   └── cards.json                # dati funzionali delle carte
├── public/                       # interfaccia web (HTML/CSS/JS, nessun build step)
│   ├── index.html
│   ├── styles.css
│   ├── app.js                    # chat e streaming
│   ├── cards.js                  # archivio, chip e dettaglio carte
│   └── markdown.js               # rendering sicuro di risposte e simboli di gioco
└── test/                         # test automatici (npm test)
```

## Test

```bash
npm test
```

Verificano il riconoscimento delle carte, il rendering sicuro, lo scraper e l'intero flusso della
chat (con Gemini simulato: streaming, retry, limiti, timeout).

## Note

- Il regolamento incluso è la versione **Core Rules del 2026-03-30**. Per aggiornarlo, sostituisci
  `data/riftbound-core-rules.txt` con il nuovo testo.
- Questo strumento si basa sulle Core Rules e **non sostituisce** un judge certificato: in un torneo
  ufficiale la parola finale spetta all'arbitro presente.
- La chiave API resta **solo sul server** (nel file `.env`, escluso da Git) e non viene mai esposta al
  browser.
