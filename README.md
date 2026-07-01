# Home Care PWA

PWA gestionale per il servizio Home Care: clienti, immobili, controlli periodici, GPS, giri di controllo, report fotografici, Stripe e pagamenti manuali.

## Funzioni incluse

### Area admin

- Login admin.
- Scheda cliente.
- Scheda immobile collegata al cliente.
- Servizio visibile per ogni immobile:
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
- Calcolo giro controlli ordinato per distanza dalla posizione attuale.
- Checklist diversa in base al servizio.
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

## Deploy su Render

Il file `render.yaml` è già pronto per il deploy tramite Blueprint.

### Nota sul piano Render Hobby

Il piano Hobby del tuo account va bene. Nel file `render.yaml` il servizio web usa `plan: starter`, mentre il database usa il nuovo piano Postgres `basic-256mb`, perché i vecchi piani database come `starter` non sono più supportati per nuovi database.

### Variabili da compilare quando Render le chiede

- `Blueprint Name`: `home-care-pwa`
- `APP_URL`: puoi lasciarlo vuoto al primo deploy e inserirlo dopo, oppure mettere l’URL Render quando lo avrai.
- `ADMIN_EMAIL`: la tua email admin.
- `ADMIN_PASSWORD`: password admin iniziale.
- `STRIPE_SECRET_KEY`: lascia vuoto per il primo test se non vuoi configurare subito Stripe.
- `STRIPE_WEBHOOK_SECRET`: lascia vuoto per il primo test se non vuoi configurare subito Stripe.

Dopo il primo deploy potrai accedere con `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

## Stripe

Quando vorrai attivare Stripe, imposta il webhook verso:

```text
https://TUO-DOMINIO-RENDER/api/stripe/webhook
```

Eventi consigliati:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`

## Nota importante sulle foto

La cartella `uploads` salva le foto sul server. Su Render, questa soluzione va bene per una prova, ma per uso reale conviene passare in futuro a un servizio esterno come Cloudinary o S3, così le foto restano salvate anche dopo aggiornamenti o redeploy.

## Logica pagamento/controlli

Un controllo viene considerato eseguibile solo se il cliente è in regola:

- pagamento Stripe attivo, oppure
- pagamento manuale registrato con data “pagato fino al” non scaduta.

Se il cliente non è in regola, il controllo compare come bloccato e non può essere segnato come completato.

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
