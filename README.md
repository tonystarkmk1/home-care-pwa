# Home Care PWA

Gestionale mobile-first per il servizio Home Care. Riunisce area cliente, area amministrativa e operatività degli aiutanti in una PWA installabile, con immobili, controlli, fotografie private, report, attività, giro GPS, messaggi, contatti, piani e pagamenti.

## Funzioni principali

### Cliente

- registrazione con conferma email e recupero password;
- richiesta e consultazione degli immobili;
- stato del piano e pagamento mensile o annuale;
- preventivi e servizi extra;
- report dei controlli con fotografie protette;
- chat e contatti ufficiali Home Care;
- installazione guidata su iPhone, iPad, Android e desktop.

### Amministratore

- dashboard operativa e richieste immobili;
- clienti, immobili, GPS e aiutanti;
- controlli con checklist, note e fotografie;
- report, attività e giro ordinato per distanza;
- pagamenti manuali, Stripe e preventivi extra;
- messaggi e contatti;
- listino modificabile e piani personalizzati per cliente.

### Aiutante

L'aiutante può gestire immobili, controlli, report, attività e giro. Gli importi e le funzioni economiche restano riservati all'amministratore.

## Interfaccia mobile-first

La navigazione usa una barra inferiore sui telefoni, azioni touch da almeno 44–48 px, safe area per iPhone, pannelli adatti all'uso con una mano e tabelle convertite in schede responsive. Su desktop viene mostrata una barra laterale completa.

L'installazione segue lo stesso approccio del gestionale ASD:

- prompt nativo quando il browser lo espone;
- istruzioni dedicate a Safari iOS, Chrome, Edge e Samsung Internet;
- pulsante sempre disponibile finché l'app non è installata;
- avviso offline;
- notifica quando un nuovo service worker è pronto;
- cache limitata ai soli asset pubblici, mai API, fotografie o dati riservati.

## Sicurezza

- sessione in cookie `HttpOnly`, senza JWT in `localStorage`;
- CSRF, controllo dell'origine, CSP, header Helmet e rate limiting;
- validazione server e vincoli PostgreSQL per ruoli, piani e stati;
- importi Stripe calcolati dal database, non dal browser;
- webhook Stripe firmato e idempotente;
- fotografie JPEG, PNG o WebP validate tramite firma binaria, massimo 8 MB ciascuna, salvate in PostgreSQL e servite solo dopo autorizzazione;
- codici email e password reset generati con `crypto.randomBytes` e memorizzati come hash;
- cancellazioni e attivazioni complesse eseguite in transazione.

## Requisiti

- Node.js 20.11 o superiore; Node.js 22 è usato in CI;
- PostgreSQL 16 consigliato;
- HTTPS in produzione.

## Avvio locale

```bash
cp .env.example .env
npm install
npm run migrate
npm run seed
npm start
```

Apri `http://localhost:3000`.

`npm run seed` crea l'amministratore solo se non esiste. Per reimpostarne intenzionalmente la password, imposta temporaneamente `RESET_ADMIN_PASSWORD=true`.

## Controlli automatici

```bash
npm run check
npm test
npm audit --omit=dev --audit-level=high
```

La workflow GitHub Actions avvia PostgreSQL, installa le dipendenze, esegue i controlli statici e PWA, applica due volte la migrazione e il seed per verificarne l'idempotenza, lancia i test di integrazione e infine esegue l'audit delle dipendenze.

## Deploy su Render

Il file `render.yaml` crea un servizio Node e un database PostgreSQL. Durante la creazione del Blueprint inserisci almeno:

- `ADMIN_EMAIL`;
- `ADMIN_PASSWORD`, lunga almeno 12 caratteri.

Il deploy esegue:

```bash
npm ci --ignore-scripts && npm run check
npm run predeploy
npm start
```

`predeploy` applica le migrazioni e prepara l'amministratore senza sovrascriverne la password esistente.

### Email

Per inviare conferme e recuperi password configura:

- `BREVO_API_KEY`;
- `BREVO_SENDER_EMAIL`;
- `BREVO_SENDER_NAME`.

Senza Brevo, in ambiente non produttivo l'API restituisce un link di prova. In produzione la registrazione viene resa non disponibile finché il canale email non è configurato; può essere disattivata esplicitamente con `REGISTRATION_ENABLED=false`.

### Stripe

Configura insieme:

- `STRIPE_SECRET_KEY`;
- `STRIPE_WEBHOOK_SECRET`.

Webhook:

```text
https://TUO-DOMINIO/api/stripe/webhook
```

Eventi gestiti:

- `checkout.session.completed`;
- `invoice.paid`;
- `invoice.payment_failed`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`.

L'app rifiuta l'avvio se è presente la chiave Stripe ma manca il secret del webhook.

## Dati e fotografie

Le fotografie dei controlli vengono salvate in PostgreSQL, non nel filesystem effimero di Render. Gli URL delle immagini richiedono una sessione valida e verificano che il cliente sia proprietario dell'immobile; amministratori e aiutanti possono accedervi per motivi operativi.

## Struttura

- `server3.js`: API, autenticazione, autorizzazione, Stripe e server statico;
- `schema.sql`: schema completo per nuove installazioni;
- `scripts/migrate.js`: aggiornamento idempotente dei database esistenti;
- `public/app.js` e `public/app.css`: interfaccia responsive;
- `public/install-app.js`, `public/sw.js` e `public/manifest.json`: installazione PWA, aggiornamenti e offline;
- `tests/app.test.js`: test di integrazione con PostgreSQL reale.
