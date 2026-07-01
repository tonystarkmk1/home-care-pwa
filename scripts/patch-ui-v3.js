const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(file, 'utf8');
function r(re, val, label){ if(!re.test(html)) console.warn('Patch UI non trovato:', label); html = html.replace(re, val); }
function once(marker, insert){ if(!html.includes(insert.trim().slice(0,30))) html=html.replace(marker, insert+marker); }

once('async function boot()', `
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e});
async function installApp(){
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return}
  alert('Per installare la PWA usa il menu del browser e scegli “Aggiungi a schermata Home” o “Installa app”.');
}
`);
html = html.replace("<button class=\"btn light small\" onclick=\"authView('login')\">Accedi</button>", "<button class=\"btn light small\" onclick=\"installApp()\">Installa app</button> <button class=\"btn light small\" onclick=\"authView('login')\">Accedi</button>");
html = html.replace("<button class=\"btn light small\" onclick=\"logout()\">Esci</button>", "<button class=\"btn light small\" onclick=\"installApp()\">Installa app</button> <button class=\"btn light small\" onclick=\"logout()\">Esci</button>");

html = html.replace("{id:'reports',label:'Report'},{id:'payments',label:'Pagamenti / Preventivi'},{id:'chat',label:'Chat Home Care'}", "{id:'reports',label:'Report'},{id:'payments',label:'Pagamenti / Preventivi'},{id:'notifications',label:'Notifiche'},{id:'chat',label:'Chat Home Care'}");
html = html.replace("if(S.clientTab==='payments')clientPayments(d);if(S.clientTab==='chat')clientChat()", "if(S.clientTab==='payments')clientPayments(d);if(S.clientTab==='notifications')clientNotifications();if(S.clientTab==='chat')clientChat()");
html = html.replace("{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'helpers',label:'Aiutanti'}", "{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'notifications',label:'Notifiche'},{id:'helpers',label:'Aiutanti'}");
html = html.replace("payments:adminPayments,messages:adminMessages,helpers:adminHelpers", "payments:adminPayments,messages:adminMessages,notifications:adminNotifications,helpers:adminHelpers");

r(/function clientPayments\(d\)\{[\s\S]*?\nasync function clientChat/, `function clientPayments(d){document.getElementById('main').innerHTML=\`<div class="card"><h2>Pagamenti / Preventivi manutenzione</h2>\${d.payments.length?\`<table><thead><tr><th>Descrizione</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>\${d.payments.map(p=>\`<tr><td>\${esc(p.description)}</td><td>\${money(p.amount_cents)}</td><td><span class="badge \${p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn'}">\${p.status==='pending'?'Da pagare':p.status==='paid'?'Pagato':'Annullato'}</span></td><td>\${p.status==='pending'&&p.payment_url?\`<a class="btn small gold" target="_blank" href="\${p.payment_url}">Paga ora</a>\`:''}</td></tr>\`).join('')}</tbody></table>\`:'<p>Nessun preventivo o extra.</p>'}</div>\`}
async function clientNotifications(){const r=await api('/api/notifications');document.getElementById('main').innerHTML=\`<div class="card"><h2>Notifiche</h2><button class="btn small light" onclick="markNotificationsRead()">Segna come lette</button>\${r.notifications.length?r.notifications.map(n=>\`<div class="notice \${n.read_at?'':'success'}"><b>\${esc(n.title)}</b><br>\${esc(n.body)}<br><small>\${new Date(n.created_at).toLocaleString('it-IT')}</small></div>\`).join(''):'<p>Nessuna notifica.</p>'}</div>\`}
async function markNotificationsRead(){await api('/api/notifications/read',{method:'POST',body:'{}'});if(S.user.role==='client')clientNotifications();else adminNotifications()}
async function clientChat`, 'client payments/notifications');

r(/async function adminPayments\(\)\{[\s\S]*?\nasync function adminMessages/, `async function adminPayments(){const[ex,mp]=await Promise.all([api('/api/admin/extra-payments'),api('/api/admin/manual-payments')]);document.getElementById('main').innerHTML=\`<div class="row"><div class="col4"><div class="card"><h3>Extra / preventivo manutenzione</h3><form id="extraForm"><label>Cliente</label><select name="customer_id">\${opts()}</select><label>Importo</label><input name="amount_euro" required><label>Descrizione</label><textarea name="description" required></textarea><button class="btn gold">Crea link pagamento</button></form></div></div><div class="col8"><div class="card"><h2>Pagamenti creati</h2><table><thead><tr><th>Cliente</th><th>Descrizione</th><th>Importo</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>\${ex.payments.map(p=>\`<tr><td>\${esc(p.customer_name)}</td><td>\${esc(p.description)}</td><td>\${money(p.amount_cents)}</td><td><span class="badge \${p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn'}">\${p.status}</span></td><td>\${p.payment_url&&p.status==='pending'?\`<a class="btn small gold" target="_blank" href="\${p.payment_url}">Link</a> \`:''}\${p.status==='pending'?\`<button class="btn small light" onclick="editPayment('\${p.id}','\${String(p.description).replace(/'/g,"\\\\'")}',\${(Number(p.amount_cents)||0)/100})">Modifica</button> <button class="btn small red" onclick="cancelPayment('\${p.id}')">Annulla</button>\`:''}</td></tr>\`).join('')}</tbody></table></div><div class="card"><h2>Pagamenti manuali</h2><table><tbody>\${mp.payments.map(p=>\`<tr><td>\${esc(p.customer_name)}</td><td>\${money(p.amount_cents)}</td><td>\${P[p.package_type]||p.package_type||'-'}</td><td>\${p.paid_until||''}</td></tr>\`).join('')}</tbody></table></div></div></div>\`;document.getElementById('extraForm').onsubmit=async e=>{e.preventDefault();await api('/api/admin/extra-payments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});alert('Pagamento creato e notificato al cliente');adminPayments()}}
async function editPayment(id,oldDesc,oldAmount){const amount=prompt('Nuovo importo',oldAmount);if(amount===null)return;const description=prompt('Nuova descrizione',oldDesc);if(description===null)return;await api('/api/admin/extra-payments/'+id,{method:'PATCH',body:JSON.stringify({amount_euro:amount,description})});alert('Pagamento aggiornato');adminPayments()}
async function cancelPayment(id){if(!confirm('Annullare questo pagamento?'))return;await api('/api/admin/extra-payments/'+id+'/cancel',{method:'POST',body:'{}'});adminPayments()}
async function adminNotifications(){const r=await api('/api/notifications');document.getElementById('main').innerHTML=\`<div class="card"><h2>Notifiche admin</h2><button class="btn small light" onclick="markNotificationsRead()">Segna come lette</button>\${r.notifications.length?r.notifications.map(n=>\`<div class="notice \${n.read_at?'':'success'}"><b>\${esc(n.title)}</b><br>\${esc(n.body)}<br><small>\${new Date(n.created_at).toLocaleString('it-IT')}</small></div>\`).join(''):'<p>Nessuna notifica.</p>'}</div>\`}
async function adminMessages`, 'admin payments/notifications');

fs.writeFileSync(file, html);
console.log('UI patch v3 applicata.');
