# Home Care PWA

PWA gestionale per il servizio Home Care: clienti, immobili, controlli periodici, GPS, mappa, giri di controllo, Stripe e pagamenti manuali.

## Funzioni incluse nella prima versione

### Area admin

- Login admin.
- Scheda cliente.
- Scheda immobile collegata al cliente.
- Pacchetto visibile per ogni immobile:
  - Base: 39 €/mese
  - Comfort: 79 €/mese
  - Premium: 199 €/mese
  - Villa & Giardino: da 300 €/mese
  - Località Limitrofe: da 150 €/mese
- Dashboard con:
  - controlli da fare;
  - controlli bloccati per pagamento non regolare;
  - cose da fare;
  - pagamenti extra da incassare.
- GPS al primo controllo:
  - salva posizione attuale dell’immobile;
  - apre rapidamente Google Maps.
- Mappa con OpenStreetMap/Leaflet.
- Calcolo giro controlli ordinato per distanza dalla posizione attuale.
- Checklist diversa in base al pacchetto.
- Report controllo con note e foto.
- Pagamenti extra/manutenzioni con importo libero tramite Stripe Checkout.
- Pagamento manuale/annuale:
  - segna il cliente come pagato;
  - imposta la data “pagato fino al”;
  - utile per contanti, bonifico o pagamento anticipato annuale.

### Area cliente

- Login cliente generato dall’admin.
- Visualizzazione immobili.
- Stato pagamento.
- Report recenti.
- Pagamenti extra in sospeso con link pagamento.

## Installazione locale

1. Installa Node.js 20 o superiore.
2. Crea un database PostgreSQL.
3. Copia il file `.env.example` in `.env` e modifica i valori.
4. Installa le dipendenze:

```bash
npm install
```

5. Crea le tabelle:

```bash
npm run migrate
```

6. Crea l’utente admin iniziale:

```bash
npm run seed
```

7. Avvia:

```bash
npm start
```

Poi apri `http://localhost:3000`.

## Deploy su Render

Nel progetto è incluso `render.yaml`. Puoi caricare questa cartella su GitHub e poi collegare il repository a Render.

Variabili importanti su Render:

- `APP_URL`: URL pubblico dell’app Render.
- `JWT_SECRET`: stringa segreta lunga.
- `DATABASE_URL`: collegata al PostgreSQL Render.
- `ADMIN_EMAIL`: email admin.
- `ADMIN_PASSWORD`: password admin iniziale.
- `STRIPE_SECRET_KEY`: chiave segreta Stripe.
- `STRIPE_WEBHOOK_SECRET`: segreto webhook Stripe.

Dopo il primo deploy, imposta su Stripe il webhook verso:

```text
https://TUO-DOMINIO-RENDER/api/stripe/webhook
```

Eventi consigliati:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`

## Nota importante sulle foto

La cartella `uploads` salva le foto sul server. Su Render, per conservare le foto nel tempo, conviene aggiungere un Persistent Disk oppure passare in futuro a un servizio esterno come Cloudinary o S3.

## Logica pagamento/controlli

Un controllo viene considerato eseguibile solo se il cliente è in regola:

- pagamento Stripe attivo, oppure
- pagamento manuale registrato con data “pagato fino al” non scaduta.

Se il cliente non è in regola, il controllo compare come bloccato e non può essere segnato come completato.
