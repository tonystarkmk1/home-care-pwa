# Sicurezza

## Segnalazioni

Non pubblicare credenziali, dati personali o dettagli sfruttabili in una issue pubblica. Invia la segnalazione direttamente al proprietario del repository, indicando:

- versione o commit interessato;
- percorso per riprodurre il problema;
- impatto osservato;
- eventuale proposta di correzione.

## Principi applicati

- sessione in cookie `HttpOnly`, `Secure` in produzione e `SameSite=Lax`;
- protezione CSRF e controllo dell'origine per le operazioni che modificano dati;
- Content Security Policy senza script inline;
- prezzi dei pagamenti calcolati esclusivamente lato server;
- webhook Stripe con firma obbligatoria e deduplicazione degli eventi;
- fotografie private, validate e salvate in PostgreSQL;
- autorizzazione per ruolo e verifica della proprietà dei dati;
- rate limiting sugli endpoint sensibili;
- migrazioni, test di integrazione e audit dipendenze in GitHub Actions.

## Configurazione essenziale

In produzione `JWT_SECRET` deve contenere almeno 32 caratteri. Quando Stripe è attivo, `STRIPE_WEBHOOK_SECRET` è obbligatorio. Le chiavi reali devono essere configurate soltanto nel provider di hosting e mai committate nel repository.
