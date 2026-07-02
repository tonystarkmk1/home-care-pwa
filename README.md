# Home Care PWA

PWA gestionale per il servizio Home Care: clienti, immobili, controlli periodici, GPS, giri di controllo, report fotografici, Stripe, pagamenti manuali e comunicazioni cliente/admin.

## Funzioni incluse

### Area admin

- Login admin.
- Gestione clienti, immobili e aiutanti.
- Dashboard con richieste immobili, controlli da fare, controlli bloccati per pagamento non regolare e cose da fare.
- Servizi visibili per ogni immobile:
  - Base: 39 €/mese
  - Comfort: 79 €/mese
  - Premium: 199 €/mese
  - Villa & Giardino: da 300 €/mese
  - Località Limitrofe: da 150 €/mese
- Salvataggio GPS dell'immobile e apertura rapida su Google Maps.
- Calcolo giro controlli ordinato per distanza dalla posizione attuale.
- Checklist diversa in base al servizio.
- Report controllo con note e foto.
- Pagamenti extra/manutenzioni e registrazione pagamenti manuali.

### Area cliente

- Registrazione cliente con conferma email.
- Inserimento immobili da affidare a Home Care.
- Visualizzazione stato pagamento, immobili, report e pagamenti extra.
- Chat Home Care cliente/admin.

## Deploy su Render

Il repo contiene un `render.yaml` pronto per il deploy tramite Blueprint.

La configurazione crea:

- un Web Service Node (`home-care-pwa`);
- un database Render Postgres (`home-care-db`);
- `DATABASE_URL` collegata automaticamente al database;
- migrazioni e seed admin eseguiti nel `preDeployCommand`;
- start stabile con `npm start`.

### Passi

1. Vai su Render e scegli **New > Blueprint**.
2. Collega questo repository GitHub.
3. Quando Render chiede le variabili `sync: false`, compila almeno:
   - `ADMIN_EMAIL`: email admin iniziale;
   - `ADMIN_PASSWORD`: password admin iniziale.
4. Puoi lasciare vuote al primo test:
   - `APP_URL`;
   - `STRIPE_SECRET_KEY`;
   - `STRIPE_WEBHOOK_SECRET`;
   - `BREVO_API_KEY`;
   - `BREVO_SENDER_EMAIL`.
5. Avvia il Blueprint.
6. A deploy concluso, apri l'URL `onrender.com` del servizio e accedi con `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

### Comandi usati da Render

```bash
npm install && npm run check
npm run predeploy
npm start
```

`npm run predeploy` esegue:

```bash
npm run migrate && npm run seed
```

## Variabili ambiente

| Variabile | Obbligatoria | Note |
| --- | --- | --- |
| `NODE_ENV` | Sì | Su Render è `production`. |
| `DATABASE_URL` | Sì | Inserita automaticamente dal Blueprint tramite Render Postgres. |
| `JWT_SECRET` | Sì | Generata automaticamente da Render. |
| `ADMIN_EMAIL` | Sì | Email admin iniziale. |
| `ADMIN_PASSWORD` | Sì | Password admin iniziale. |
| `APP_URL` | No | Puoi impostarla dopo il primo deploy con l'URL Render o il dominio. |
| `STRIPE_SECRET_KEY` | No | Necessaria solo per attivare Stripe. |
| `STRIPE_WEBHOOK_SECRET` | No | Necessaria solo per verificare i webhook Stripe. |
| `BREVO_API_KEY` | No | Necessaria solo per inviare email reali. |
| `BREVO_SENDER_EMAIL` | No | Mittente email Brevo. |
| `BREVO_SENDER_NAME` | No | Default: `Home Care`. |
| `UPLOAD_DIR` | Sì | Default: `uploads`. |

## Stripe

Quando vuoi attivare Stripe, imposta il webhook verso:

```text
https://TUO-DOMINIO-RENDER/api/stripe/webhook
```

Eventi consigliati:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`

## Nota importante sulle foto

La cartella `uploads` salva le foto sul filesystem del servizio. Su Render va bene per una prova, ma per uso reale conviene passare in futuro a un servizio esterno come Cloudinary o S3, così le foto restano salvate anche dopo aggiornamenti o redeploy.

## Installazione locale

1. Installa Node.js 20 o superiore.
2. Crea un database PostgreSQL.
3. Copia `.env.example` in `.env` e modifica i valori.
4. Installa le dipendenze:

```bash
npm install
```

5. Crea le tabelle:

```bash
npm run migrate
```

6. Crea l'utente admin iniziale:

```bash
npm run seed
```

7. Avvia:

```bash
npm start
```

Poi apri `http://localhost:3000`.
