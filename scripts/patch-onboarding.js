const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(file, 'utf8');

if (!html.includes('function planSummaryHtml(id)')) {
  const helper = [
    "function planSummaryHtml(id){",
    "  const benefits={",
    "    base:['1 controllo completo al mese','Verifica accessi, porte e finestre','Report fotografico dopo ogni visita'],",
    "    comfort:['2 controlli completi al mese','Aerazione ambienti','Verifica visiva impianti accessibili','Ritiro posta o piccole consegne'],",
    "    premium:['Controllo settimanale','Preparazione casa con almeno 15 giorni di preavviso','Report fotografici dettagliati','Priorità nella pianificazione interventi'],",
    "    villa_giardino:['Servizio Premium incluso','Cura ordinaria giardino','Aree esterne, cancelli e recinzioni'],",
    "    localita_limitrofe:['Servizio fuori dal comune di Badesi','Prezzo in base a distanza e frequenza','Servizi personalizzati']",
    "  };",
    "  const list=benefits[id]||benefits.base;",
    "  return '<div class=\"notice success\"><b>Servizio selezionato: '+(P[id]||id)+' - '+(PRICE[id]||'')+'</b><ul class=\"clean\">'+list.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>';",
    "}",
  ].join('\n');
  html = html.replace('function clientHome(d){', helper + '\nfunction clientHome(d){');
}

const onboarding = [
  "function clientHome(d){",
  "  const latest=d.reports.slice(0,3),pending=d.payments.filter(p=>p.status==='pending'),upcoming=d.properties.filter(p=>p.active).slice(0,5);",
  "  const hasPlan=Boolean(d.customer&&d.customer.current_package_type&&d.customer.payment_valid);",
  "  const pendingProps=d.properties.filter(p=>p.request_status==='pending');",
  "  if(!hasPlan){",
  "    document.getElementById('main').innerHTML='<div class=\"card\"><h1>Attiva il tuo servizio Home Care</h1><p>Non hai ancora un piano attivo. Scegli il servizio più adatto, inserisci l’indirizzo dell’immobile e Home Care verificherà la richiesta prima dell’attivazione.</p><div class=\"grid\"><div><b>1. Scegli il servizio</b><br><span class=\"muted\">Vedi vantaggi e prezzo.</span></div><div><b>2. Inserisci immobile</b><br><span class=\"muted\">Indirizzo, zona e note utili.</span></div><div><b>3. Approvazione Home Care</b><br><span class=\"muted\">Confermiamo piano e attivazione.</span></div></div></div>'+",
  "      (pendingProps.length?'<div class=\"notice\"><b>Richiesta in attesa di verifica</b><br>'+pendingProps.map(p=>esc(p.name)+' - '+esc(p.address)+' ('+(P[p.package_type]||p.package_type)+')').join('<br>')+'</div>':'')+",
  "      '<div class=\"sectionTitle\"><h2>Scegli il servizio da attivare</h2><span class=\"muted\">Da 39 €/mese</span></div>'+planCards()+",
  "      '<div class=\"card\" style=\"margin-top:14px\"><h2>Come si attiva</h2><p>Quando clicchi su <b>Richiedi questo servizio</b>, ti portiamo direttamente al modulo immobile con il piano già selezionato. Dopo l’approvazione potrai completare il pagamento o concordare il pagamento manuale.</p></div>';",
  "    return;",
  "  }",
  "  document.getElementById('main').innerHTML='<div class=\"grid\"><div class=\"card\"><h3>Stato</h3><span class=\"badge ok\">Pagamento regolare</span><p>Piano cliente: <b>'+(P[d.customer.current_package_type]||d.customer.current_package_type)+'</b></p></div><div class=\"card\"><h3>Prossime scadenze</h3>'+",
  "    (upcoming.length?upcoming.map(p=>'<p><b>'+esc(p.name)+'</b><br>Prossimo controllo: '+(p.next_check_date||'-')+'</p>').join(''):'<p>Nessun controllo pianificato.</p>')+",
  "    '</div><div class=\"card\"><h3>Preventivi / extra da pagare</h3>'+",
  "    (pending.length?pending.map(p=>'<p><b>'+money(p.amount_cents)+'</b><br>'+esc(p.description)+'</p>').join(''):'<p>Nessun pagamento extra in sospeso.</p>')+",
  "    '</div></div><div class=\"card\" style=\"margin-top:14px\"><h2>Ultimi report</h2>'+",
  "    (latest.length?latest.map(reportHtml).join(''):'<p>Nessun report disponibile.</p>')+'</div>';",
  "}",
].join('\n');

html = html.replace(/function clientHome\(d\)\{[\s\S]*?\nfunction reportHtml/, onboarding + '\nfunction reportHtml');

if (!html.includes('${planSummaryHtml(selected)}<form id="clientProp"')) {
  html = html.replace(
    '<div class="card"><h2>Aggiungi immobile da affidare a Home Care</h2><form id="clientProp">',
    '<div class="card"><h2>Aggiungi immobile da affidare a Home Care</h2>${planSummaryHtml(selected)}<form id="clientProp">'
  );
}

fs.writeFileSync(file, html);
console.log('Onboarding cliente aggiornato.');
