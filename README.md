# ⚖️ Judge Rift Bound

Un **judge virtuale** per [Rift Bound](https://riftbound.leagueoflegends.com/): descrivi una
situazione di gioco e ricevi in tempo reale un ruling — come procedere e perché — ragionato sul
**regolamento ufficiale** (Riftbound Core Rules) tramite l'**API gratuita di Google Gemini**.

- 🧠 Il judge ragiona sulle regole complete (le Core Rules sono nel prompt di sistema).
- 💬 Interfaccia chat con risposte in **streaming**, ragionamento del judge visibile e follow-up
  (puoi continuare a chiedere sulla stessa situazione).
- 📖 Ogni verdetto cita i **numeri delle regole** applicate, così puoi verificare.
- 🆓 Usa il **piano gratuito di Google Gemini** (nessuna carta di credito richiesta).

## Requisiti

- [Node.js](https://nodejs.org/) 18.17 o superiore
- Una **chiave API di Google Gemini** — gratuita, da [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

## Come ottenere la chiave (gratis)

1. Vai su **https://aistudio.google.com/apikey** e accedi con un account Google.
2. Clicca **Create API key** (crea chiave API).
3. Copia la chiave (inizia con `AIza...`) e incollala nel file `.env` (vedi sotto).

Il piano gratuito è permanente e senza carta di credito, con limiti di velocità pensati per l'uso
personale. Nota: ogni domanda include l'intero regolamento (~95k token) e il piano gratuito
consente 250.000 token di input al minuto per modello, quindi conviene distanziare un minuto le
domande in rapida successione (l'app te lo segnala se superi il limite).

## Avvio rapido (in locale)

```bash
# 1. Installa le dipendenze
npm install

# 2. Configura la chiave API
cp .env.example .env        # su Windows: copy .env.example .env
#    ...poi apri .env e incolla la tua GEMINI_API_KEY

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
> Se il link è pubblico, valuta di aggiungere una password d'accesso (chiedi pure).

## Come si usa

Scrivi cosa sta succedendo in partita: di chi è il turno, la fase, le unità/carte coinvolte, le
keyword. Più contesto dai, più preciso è il ruling. Se manca qualcosa, il judge te lo chiede.

> Esempio: *"È il turno dell'avversario, siamo in uno showdown a un battlefield. Io ho un'unità con
> Tank e lui gioca una spell con Reaction: in che ordine si risolve la chain?"*

Se il ruling dipende dal testo esatto di una carta, incollalo nella chat: per la **Golden Rule** il
testo della carta prevale sulle regole generali.

## Configurazione

Opzioni nel file `.env` (vedi `.env.example`):

| Variabile               | Default            | Descrizione                                                            |
| ----------------------- | ------------------ | --------------------------------------------------------------------- |
| `GEMINI_API_KEY`        | —                  | **Obbligatoria.** La tua chiave API Google Gemini (gratuita).         |
| `PORT`                  | `3000`             | Porta del server.                                                     |
| `JUDGE_MODEL`           | `gemini-flash-latest` | Modello. `gemini-flash-lite-latest` = limiti più alti; `gemini-pro-latest` = più bravo; oppure una versione fissa (es. `gemini-3.6-flash`). |
| `JUDGE_THINKING_BUDGET` | `-1`               | Ragionamento: `-1` automatico, `0` disattivato, oppure un numero di token. |

## Struttura del progetto

```
JudgeRiftBound/
├── server.js                     # server Express + endpoint SSE /api/ask
├── src/judge.js                  # prompt del judge + chiamata Gemini (streaming, thinking)
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
