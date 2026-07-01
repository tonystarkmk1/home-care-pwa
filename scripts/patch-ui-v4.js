const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(file, 'utf8');
function r(re, val, label){ if(!re.test(html)) console.warn('Patch UI non trovato:', label); html = html.replace(re, val); }
r(/async function clientNotifications\(\)\{[\s\S]*?\nasync function markNotificationsRead/, `async function clientNotifications(){document.getElementById('main').innerHTML=\`<div class="card"><h2>Notifiche</h2><p>Le notifiche importanti vengono inviate via email: nuovi report, nuovi messaggi da Home Care e pagamenti da saldare.</p><p class="muted">Apri le sezioni Report, Chat e Pagamenti / Preventivi per vedere i dettagli aggiornati.</p></div>\`}
async function markNotificationsRead`, 'client notifications email mode');
r(/async function adminNotifications\(\)\{[\s\S]*?\nasync function adminMessages/, `async function adminNotifications(){document.getElementById('main').innerHTML=\`<div class="card"><h2>Notifiche admin</h2><p>Le notifiche operative arrivano via email: nuovi messaggi cliente, nuove richieste immobile, pagamenti ricevuti e pagamenti non completati.</p><p class="muted">Per i dettagli usa le sezioni Messaggi, Richieste immobili e Pagamenti.</p></div>\`}
async function adminMessages`, 'admin notifications email mode');
fs.writeFileSync(file, html);
console.log('UI notifiche impostate in modalità email.');
