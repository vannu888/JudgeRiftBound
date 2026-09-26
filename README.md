# ⚖️ Judge Rift Bound

Un **judge virtuale** per [Rift Bound](https://riftbound.leagueoflegends.com/): descrivi una
situazione di gioco e ricevi in tempo reale un ruling — come procedere e perché — ragionato sul
**regolamento ufficiale** (Riftbound Core Rules) e sul **testo delle carte**, tramite l'**API
gratuita di Google Gemini**.

- 🧠 Il judge ragiona sulle regole complete (le Core Rules sono nel prompt di sistema).
- 🃏 **Database di ~945 carte**: quando nomini una carta, il suo testo ufficiale (costo, Might,
  keyword, errata, ban) viene passato al judge — per la Golden Rule il testo della carta prevale.
- 📖 Ogni verdetto cita i **numeri delle regole**: toccali per leggere il **testo ufficiale** della
  regola, con la sezione di appartenenza e le sotto-regole. Anche le keyword delle carte
  (Ganking, Deflect…) aprono la loro regola.
- 🔎 **Archivio** con due schede: **Carte** (ricerca, filtri per dominio e tipo, inserimento nella
  domanda) e **Regole** (ricerca nel regolamento per parola o numero).
- 🏆 **Segnapunti** per la partita con le regole ufficiali di punteggio (vedi sotto); se vuoi, il
  judge conosce il punteggio quando gli fai una domanda.
- ⚔️ **Calcolatore di combattimento** con il telefono al centro del tavolo: Might, parole chiave,
  chi muore e come finisce (vedi sotto).
- 💬 Chat con risposte in **streaming**, ragionamento del judge visibile, follow-up, pulsante
  **Stop**, **Rigenera**, **Copia** e **Condividi**.
- 🕘 **Cronologia** delle ultime 30 conversazioni con l'anteprima dell'ultimo verdetto, salvata sul
  dispositivo (nessun dato sul server).
- 📱 **Installabile** su iPhone come app (Safari → Condividi → Aggiungi a Home), con icona propria.
  Si apre all'istante anche mentre il server gratuito si risveglia e funziona **offline** per
  segnapunti, cronologia e regole già consultate.
- 🔒 **Password d'accesso** opzionale, limite di domande al minuto e intestazioni di sicurezza
  (niente script esterni, niente incorporamento in altri siti), per quando la metti online.
- 🆓 Usa il **piano gratuito di Google Gemini** (nessuna carta di credito richiesta) e lo fa durare
  il più possibile: modello di riserva quando il primo esaurisce la quota, risposte già date
  riutilizzate senza consumi, follow-up più leggeri.

## Requisiti

- [Node.js](https://nodejs.org/) 18.17 o superiore
- Una **chiave API di Google Gemini** — gratuita, da [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

## Come ottenere la chiave (gratis)

1. Vai su **https://aistudio.google.com/apikey** e accedi con un account Google.
2. Clicca **Create API key** (crea chiave API) e copiala.
3. Mettila nel file `.env` del progetto (vedi sotto). **Non** scriverla in `.env.example` né in
   altri file su GitHub: sono pubblici.

Il piano gratuito è permanente e senza carta di credito, con limiti pensati per l'uso personale.
Ogni domanda include l'intero regolamento (~67k token) e i limiti valgono **per modello** (token al
minuto e richieste al giorno). Per questo il judge usa due modelli: quando il primo raggiunge il
limite passa da solo al secondo (sotto la risposta vedi *modello di riserva*); solo se sono entrambi
al limite l'app ti dice quanti secondi attendere. La quota giornaliera si azzera alle 9:00 (ora
italiana).

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
4. In **Environment** aggiungi la variabile `GEMINI_API_KEY` con la tua chiave e, consigliato,
   `ACCESS_PASSWORD` con una password a tua scelta: così solo chi la conosce può usare il judge
   (e la tua quota gratuita).
5. Deploy → ottieni un link `https://...onrender.com` da aprire su Safari e "Aggiungi a Home".

> Il server usa già `process.env.PORT`, quindi funziona senza modifiche sulla maggior parte degli host.
> La password va inserita una sola volta per dispositivo: poi resta ricordata.

## Come si usa

Scrivi cosa sta succedendo in partita: di chi è il turno, la fase, le unità/carte coinvolte, le
keyword. Più contesto dai, più preciso è il ruling. Se manca qualcosa, il judge te lo chiede.

> Esempio: *"L'avversario gioca Falling Comet sulla mia unità: posso rispondere con una Reaction?
> In che ordine si risolve la chain?"*

**Scrivi i nomi delle carte in inglese, come sono stampati** (es. `Vi, Destructive`, `Falling Comet`):
mentre scrivi, sopra il campo compaiono le **carte suggerite** e a ogni parola in più la scelta si
restringe; toccane una (o premi Tab) per inserire il nome completo.
Basta anche il nome del campione (`il mio Jinx…`, `l'Ahri dell'avversario`): il judge riceve tutte le sue
versioni. Apostrofi e punteggiatura sono facoltativi (`Kaisa`, `BF Sword`, `Megamech`). Sopra la
risposta vedi le **carte considerate**: toccane una per leggerne il testo. Se non ricordi il nome
esatto, apri **📚 Archivio → Carte**, cerca e premi **Usa nella domanda**.

Ogni risposta è divisa in **Verdetto** (in evidenza, da leggere al volo durante la partita),
**Perché** e **Regole** applicate. I **numeri delle regole** (es. `340.1`) si toccano per leggerne il testo ufficiale: se
il judge citasse una regola che non esiste, l'app lo segnala. Sotto ogni risposta trovi **Copia**,
**Condividi** e **Rigenera**; mentre il judge scrive, il pulsante di invio diventa **Stop**. Le
conversazioni restano in **🕘 Cronologia** e, se ricarichi la pagina durante una partita, riprendi da
dove eri.

## Segnapunti

Tocca **🏆 Punti** in alto:

1. Scegli la modalità — **1v1 Duello** (8 punti, regola 480), **1v1 al meglio di 3** (481), **tutti
   contro tutti** a 3 o 4 giocatori (482–483), **2v2 a squadre** (11 punti, 484) — e i nomi (il primo
   sei tu). I punti per vincere si possono cambiare.
2. Durante la partita segna ogni punto con **⚔ Conquista** o **🏰 Tenuta** (una volta per battlefield
   per turno, 465); **＋1 Altro** per punti da altre fonti (es. effetti di carte) e **−1** per
   correggere. **↶ Annulla** toglie l'ultima azione.
3. Quando a un giocatore manca **un solo punto** compare *Punto vincente*: con una Tenuta lo prende
   sempre, con una Conquista l'app chiede se in questo turno ha segnato **tutti** i battlefield —
   altrimenti niente punto e si pesca 1 carta (466.1.b).
4. La vittoria viene annunciata secondo la regola 467; nel meglio di 3 si passa alla partita
   successiva tenendo il conto delle vittorie.

**Modalità tavolo**: tocca *Modalità tavolo* e appoggia il telefono al centro del tavolo. Lo schermo
si divide a metà e la metà in alto è capovolta verso l'avversario: ognuno ha davanti il proprio
punteggio e i propri pulsanti (con 3-4 giocatori, due per lato). Al centro ci sono Annulla, i punti per
vincere ed Esci; lo schermo resta acceso finché la modalità è aperta (dove il telefono lo consente).
Ogni metà ha la sua illustrazione (`table-bottom.webp` dal tuo lato, `table-top.webp` da quello
dell'avversario): per cambiarle basta sostituire i due file in `public/img/`.

Il punteggio resta salvato sul telefono anche se chiudi l'app e compare nel pulsante in alto. Con
**"Il judge conosce il punteggio"** attivo, ogni domanda include lo stato della partita, così il judge
può rispondere a domande come *"se conquisto adesso, vinco?"*.

## Combattimento

Il pulsante con la **spada** in alto apre il calcolatore di un singolo combattimento. Come la modalità
tavolo, il telefono va al centro: la metà in basso è tua, quella in alto è capovolta verso
l'avversario, e ognuno gestisce le sue unità dal suo lato. Le frecce al centro scambiano chi attacca e
chi difende.

- **+ Unità** cerca la carta per nome (in inglese) e ne carica il **Might** e le parole chiave
  stampate: **Assault** conta solo in attacco, **Shield** solo in difesa, **Tank** e **Backline**
  decidono l'ordine dei danni. Ci sono anche i segnalini (Recruit, Sand Soldier, Mech…), le unità
  senza carta con il Might che vuoi e le ultime carte usate, da aggiungere con un tocco.
- Toccando un'unità si aprono i modificatori: **Buff** (+1, uno solo), **+/− per questo turno**,
  **bonus dell'equipaggiamento**, **danni già subiti**, **Stordita** (non infligge danni ma serve
  tutto il suo Might per ucciderla), Tank/Backline concessi, Assault/Shield in più e **Danni per
  prima** per scegliere quale unità colpire. Sotto c'è il testo della carta: le abilità condizionali
  (il **!** sulla tessera) vanno aggiunte a mano.
- Mentre inserisci, l'app somma il Might di ogni lato, assegna i danni come la regola 460 (danno
  letale completo prima di passare all'unità successiva; tra unità con la stessa priorità propone
  l'ordine che ne elimina di più), segna chi **muore** e dice come finisce secondo la 461:
  conquista, battlefield difeso, attaccanti richiamati o battlefield senza controllo. Dice anche
  **quanto manca**: *"con +1 Might elimini tutte le unità avversarie"*.
- La **bilancia** al centro manda il combattimento al judge come domanda già scritta; con una partita
  in corso nel segnapunti, **Segna la Conquista** aggiunge il punto a chi ha vinto.

Il combattimento resta salvato sul telefono finché non ne inizi uno nuovo (la freccia circolare).

## Database delle carte

Il file `data/cards.json` contiene i dati **funzionali** di tutte le carte (nome, tipo, dominio, costo
in Energy/Power, Might, tag, testo delle regole, errata, ban, set e rarità). Niente artwork, flavor text
o prezzi. Lo script unisce tre fonti, carta per carta:

- [piltoverarchive.com](https://piltoverarchive.com/cards) — la base: include le **errata** e le
  anteprime dei set in uscita;
- la [galleria ufficiale di Riot](https://playriftbound.com/en-us/card-gallery/) — corregge i refusi
  del testo (non tocca le carte con errata, perché la galleria mostra il testo stampato);
- l'API di [Riftcodex](https://riftcodex.com/) — nuove carte e conferma dei nomi.

Quando le fonti scrivono un nome in modo diverso vince la maggioranza, e le altre grafie restano come
alias (il judge riconosce sia `Stargazer` sia `Stagazer`).

Quando esce un nuovo set, aggiornalo con:

```bash
npm run cards
```

Lo script fa una richiesta alla volta (per non pesare sui siti), continua anche se una fonte non
risponde e riscrive `data/cards.json`: rilancialo durante le anteprime di un nuovo set (es. Radiance,
in uscita il 23 ottobre 2026) per avere subito le nuove carte. Il server riconosce le carte nominate nella conversazione (nomi completi e nomi dei
campioni, con attenzione a falsi positivi come la parola italiana "vi") e ne allega il testo alla
domanda, fino a 16 carte, così il prompt resta leggero.

## Configurazione

Opzioni nel file `.env` (vedi `.env.example`):

| Variabile               | Default               | Descrizione                                                          |
| ----------------------- | --------------------- | -------------------------------------------------------------------- |
| `GEMINI_API_KEY`        | —                     | **Obbligatoria.** La tua chiave API Google Gemini (gratuita).        |
| `PORT`                  | `3000`                | Porta del server.                                                    |
| `JUDGE_MODEL`           | `gemini-flash-latest,gemini-flash-lite-latest` | Modelli in ordine di preferenza, separati da virgola: quando uno esaurisce la quota si passa al successivo. Anche un solo modello o versioni fisse (es. `gemini-3.6-flash`). |
| `JUDGE_THINKING_BUDGET` | `-1`                  | Ragionamento: `-1` automatico, `0` disattivato, oppure un numero di token. |
| `JUDGE_TIMEOUT_MS`      | `60000`               | Dopo quanti ms senza risposta da Gemini la richiesta viene interrotta. |
| `ACCESS_PASSWORD`       | —                     | Se impostata, l'app chiede questa password prima di rispondere (consigliata online). |
| `ASK_RATE_LIMIT`        | `10`                  | Domande al minuto per dispositivo/IP (`0` = nessun limite).          |
| `TRUST_PROXY`           | —                     | Metti `1` se il server sta dietro un proxy (su Render è automatico). |

## Struttura del progetto

```
JudgeRiftBound/
├── server.js                     # server Express: /api/health, /api/cards (+ /names, /units), /api/rules, /api/ask
├── src/
│   ├── judge.js                  # prompt del judge + chiamata Gemini (streaming, thinking)
│   ├── ask.js                    # risposta in streaming (SSE): retry, timeout, errori
│   ├── rules.js                  # regolamento: compattazione, indice, ricerca
│   ├── cards.js                  # database carte: riconoscimento, ricerca, formattazione
│   ├── security.js               # password d'accesso e limite di richieste
│   ├── offline.js                # prepara /sw.js con versione ed elenco dei file
│   └── service-worker.js         # (gira nel browser) app offline e aggiornamenti
├── scripts/fetch-cards.mjs       # aggiorna data/cards.json (npm run cards)
├── data/
│   ├── riftbound-core-rules.txt  # testo integrale delle Core Rules
│   └── cards.json                # dati funzionali delle carte
├── public/                       # interfaccia web (HTML/CSS/JS, nessun build step)
│   ├── index.html · styles.css · manifest.webmanifest · icons/ · fonts/
│   ├── app.js                    # avvio, domande e streaming
│   ├── chat.js                   # messaggi, azioni (copia, condividi, rigenera)
│   ├── rules.js                  # testo delle regole e ricerca nel regolamento
│   ├── cards.js                  # archivio, chip e dettaglio carte
│   ├── history.js                # cronologia salvata sul dispositivo
│   ├── storage.js                # salvataggi locali sicuri (localStorage)
│   ├── score.js · score-model.js # segnapunti (interfaccia e regole di punteggio)
│   ├── combat.js · combat-model.js # calcolatore di combattimento (interfaccia e regole 460-461)
│   ├── api.js                    # chiamate al server (e blocco con password)
│   └── markdown.js               # rendering sicuro di risposte e simboli di gioco
└── test/                         # test automatici (npm test)
```

## Test

```bash
npm test
```

Verificano il riconoscimento delle carte, il regolamento (compattazione, ricerca, sezioni), le
regole di punteggio del segnapunti, i calcoli del combattimento (Might, parole chiave, ordine dei
danni, esito), il rendering sicuro, la password e i limiti, il service worker,
lo scraper e l'intero flusso della chat (con Gemini simulato: streaming, modelli di riserva, cache
delle risposte, limiti, timeout, compressione).

## Prestazioni e consumi

**Quota Gemini**
- **Modello di riserva**: i limiti gratuiti sono per modello; al primo `429` il judge passa al modello
  successivo e non riprova quello esaurito finché Gemini non lo consente, così non spreca richieste.
- **Risposte già pronte**: la stessa domanda con le stesse carte e lo stesso punteggio (un esempio, un
  doppio tocco) riceve la risposta già data, senza consumare quota. **Rigenera** ne chiede sempre una nuova.
- **Follow-up leggeri**: nelle domande successive le risposte più vecchie viaggiano solo con il verdetto;
  l'ultima risposta resta completa.
- **Cache di Gemini**: il prompt con il regolamento è identico a ogni domanda, così Gemini lo riusa dalla
  sua cache automatica; sotto ogni risposta vedi quanti token sono stati riusati.
- **Regolamento compattato**: all'avvio il testo estratto dal PDF viene ripulito dall'impaginazione
  (spazi di colonna, righe spezzate, caratteri invisibili) senza perdere una parola: circa **6.000 token
  in meno a ogni domanda** (−8,5%), cioè risposte più rapide e più domande al minuto col piano gratuito.
- **Carte**: il riconoscimento usa un indice per parole (circa 20 volte più veloce del confronto
  nome per nome) e invia al judge solo le carte citate.

**Telefono (dati e batteria)**
- **Service worker**: dopo la prima visita l'app si apre dalla memoria del telefono, senza scaricare nulla;
  i file vengono riscaricati solo quando cambiano (compare *Nuova versione pronta*). Le regole e le
  ricerche già fatte restano disponibili anche offline.
- **Rete**: pagine e ricerche sono compresse (circa −70% di dati su rete mobile); lo stream delle
  risposte no, così resta in tempo reale.
- **Nessuna richiesta a siti esterni**: testo con il font di sistema (San Francisco su iPhone), titoli con
  il font Cinzel servito dall'app stessa.
- **Batteria**: niente sfocature ricalcolate durante lo scorrimento né animazioni infinite; la risposta in
  streaming viene ridisegnata circa 12 volte al secondo invece che a ogni frame.

## Note

- Lo sfondo e le due metà della modalità tavolo sono illustrazioni di Riot Games (in `public/img/`;
  lo sfondo è intero per il desktop e ritagliato sul soggetto per lo smartphone). Judge Rift Bound è un progetto di fan gratuito e non ufficiale: non è
  approvato da Riot Games e non riflette le opinioni di Riot Games o di chiunque sia coinvolto
  ufficialmente nella produzione o gestione delle sue proprietà. Riftbound, League of Legends e tutte
  le proprietà associate sono marchi o marchi registrati di Riot Games, Inc.

- Il regolamento incluso è la versione **Core Rules del 2026-03-30**. Per aggiornarlo, sostituisci
  `data/riftbound-core-rules.txt` con il nuovo testo.
- Questo strumento si basa sulle Core Rules e **non sostituisce** un judge certificato: in un torneo
  ufficiale la parola finale spetta all'arbitro presente.
- La chiave API resta **solo sul server** (nel file `.env`, escluso da Git) e non viene mai esposta al
  browser. Cronologia e segnapunti restano solo sul tuo dispositivo.
