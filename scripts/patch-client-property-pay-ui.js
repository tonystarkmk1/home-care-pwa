const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(file, 'utf8');

const js = `
function payCellForProperty(p,customerPaid){
  if(!p.active)return '-';
  if(customerPaid)return '<span class="badge ok">Pagato</span>';
  return '<button class="btn small gold" onclick="payProperty(\\\''+p.id+'\\\',\\\'monthly\\\')">Paga mensile</button> <button class="btn small teal" onclick="payProperty(\\\''+p.id+'\\\',\\\'annual\\\')">Paga annuale</button>';
}
async function payProperty(id,billing){
  try{const r=await api('/api/client/properties/'+id+'/pay',{method:'POST',body:JSON.stringify({billing})});if(r.url)location.href=r.url;else alert('Link pagamento non disponibile')}catch(e){alert(e.message)}
}
function clientProperties(d){
  const selected=localStorage.getItem('hc_selected_package')||'base';
  const customerPaid=Boolean(d.customer&&d.customer.payment_valid);
  document.getElementById('main').innerHTML='<div class="card"><h2>Aggiungi immobile da affidare a Home Care</h2><form id="clientProp"><label>Nome immobile</label><input name="name" required placeholder="Casa al mare, Villetta, Appartamento"><label>Indirizzo completo</label><input name="address" required><div class="row"><div class="col6"><label>Comune</label><input name="city" value="Badesi"></div><div class="col6"><label>Zona / località</label><input name="zone"></div></div><label>Tipo immobile</label><select name="property_type"><option>Appartamento</option><option>Villetta</option><option>Villa con giardino</option><option>Altro</option></select><label>Servizio richiesto</label><select name="package_type">'+PLAN_LIST.map(function(k){return '<option value="'+k+'" '+(selected===k?'selected':'')+'>'+P[k]+' - '+PRICE[k]+'</option>';}).join('')+'</select><label>Note utili</label><textarea name="notes"></textarea><button class="btn teal">Invia richiesta</button></form><div id="propMsg"></div></div><div class="card" style="margin-top:14px"><h2>I miei immobili</h2>'+(d.properties.length?'<table><thead><tr><th>Immobile</th><th>Indirizzo</th><th>Servizio</th><th>Stato</th><th>Pagamento</th><th>Prossimo controllo</th></tr></thead><tbody>'+d.properties.map(function(p){const status=p.request_status==='pending'?'<span class="badge warn">In attesa di verifica</span>':p.active?'<span class="badge ok">Attivo</span>':'<span class="badge bad">Non attivo</span>';return '<tr><td><b>'+esc(p.name)+'</b></td><td>'+esc(p.address)+'<br>'+esc(p.city)+'</td><td>'+(P[p.package_type]||p.package_type)+'<br><span class="muted">'+money(p.monthly_price_cents)+'/mese</span></td><td>'+status+'</td><td>'+payCellForProperty(p,customerPaid)+'</td><td>'+(p.next_check_date||'-')+'</td></tr>';}).join('')+'</tbody></table>':'<p>Nessun immobile inserito.</p>')+'</div>';
  document.getElementById('clientProp').onsubmit=async function(e){e.preventDefault();const box=document.getElementById('propMsg');try{await api('/api/client/properties',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});localStorage.removeItem('hc_selected_package');box.innerHTML=note('Richiesta inviata. Home Care controllerà i dati e ti risponderà.','success');setTimeout(clientShell,800)}catch(x){box.innerHTML=note(x.message,'error')}};
}
`;

if (!html.includes('function payCellForProperty')) {
  html = html.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();", js + "\nif('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();");
}

fs.writeFileSync(file, html);
console.log('Pulsanti pagamento immobili approvati aggiunti.');
