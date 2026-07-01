const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'index.html');
const stripePatchFile = path.join(__dirname, 'start-stripe.js');
let html = fs.readFileSync(file, 'utf8');

function addBefore(marker, insert, label) {
  if (html.includes(insert.trim().slice(0, 70))) return console.log('UI già presente:', label);
  if (!html.includes(marker)) return console.warn('Marker UI non trovato:', label);
  html = html.replace(marker, insert + marker);
  console.log('UI aggiunta:', label);
}

addBefore('async function boot()', [
  "async function forgotPassword(){",
  "  const email=prompt('Inserisci la tua email per ricevere il link di recupero password');",
  "  if(!email)return;",
  "  try{const r=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});alert(r.message||'Controlla la tua email.')}catch(e){alert(e.message)}",
  "}",
  "function resetPasswordView(code){",
  "  app.innerHTML=topPublic()+'<div class=\"wrap\"><div class=\"loginBox\"><h1>Imposta nuova password</h1><p class=\"muted\">Scegli una nuova password per accedere a Home Care.</p><form id=\"resetForm\"><label>Nuova password</label><input name=\"password\" type=\"password\" minlength=\"8\" required><br><br><button class=\"btn\" style=\"width:100%\">Aggiorna password</button></form><div id=\"resetMsg\"></div></div></div>';",
  "  document.getElementById('resetForm').onsubmit=async e=>{e.preventDefault();const msg=document.getElementById('resetMsg');try{const r=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({code,password:new FormData(e.target).get('password')})});msg.innerHTML=note(r.message,'success');setTimeout(()=>authView('login'),1000)}catch(x){msg.innerHTML=note(x.message,'error')}};",
  "}",
].join('\n') + '\n', 'recupero password');

html = html.replace("async function boot(){try{S.config=await api('/api/config',{headers:{}})}catch(e){}if(!S.token)return publicHome();", "async function boot(){const reset=new URLSearchParams(location.search).get('reset');if(reset)return resetPasswordView(reset);try{S.config=await api('/api/config',{headers:{}})}catch(e){}if(!S.token)return publicHome();");
html = html.replace('<br><br><button class="btn" style="width:100%">Accedi</button></form>', '<br><br><button class="btn" style="width:100%">Accedi</button><p><button type="button" class="btn light small" onclick="forgotPassword()">Recupera password</button></p></form>');
html = html.replace('.mobileMenu{display:none}', '.chatQuick{position:fixed;right:18px;bottom:18px;z-index:50;border-radius:999px;box-shadow:0 12px 28px rgba(6,36,58,.25);font-size:18px}.mobileMenu{display:none}');
html = html.replace('<main class="main" id="main">Caricamento...</main></div>`;const d=await clientData();', '<main class="main" id="main">Caricamento...</main></div><button class="btn gold chatQuick" onclick="clientSet(\'chat\')">💬 Chat</button>`;const d=await clientData();');
html = html.replace("{id:'reports',label:'Report'},{id:'payments',label:'Pagamenti / Preventivi'},{id:'chat',label:'Chat Home Care'}", "{id:'reports',label:'Report'},{id:'payments',label:'Pagamenti / Preventivi'},{id:'chat',label:'Chat Home Care'},{id:'contacts',label:'Contatti'}");
html = html.replace("if(S.clientTab==='chat')clientChat()", "if(S.clientTab==='chat')clientChat();if(S.clientTab==='contacts')clientContacts()");
html = html.replace("{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'helpers',label:'Aiutanti'}", "{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'contacts',label:'Contatti'},{id:'helpers',label:'Aiutanti'}");
html = html.replace('payments:adminPayments,messages:adminMessages,helpers:adminHelpers', 'payments:adminPayments,messages:adminMessages,contacts:adminContacts,helpers:adminHelpers');

addBefore('async function loadBase(){', [
  "async function clientContacts(){",
  "  document.getElementById('main').innerHTML='<div class=\"card\"><h2>Contatti Home Care</h2><p>Per comunicazioni operative usa preferibilmente la chat interna.</p><button class=\"btn gold\" onclick=\"clientSet(\\\'chat\\\')\">Apri chat Home Care</button><div id=\"contactList\" style=\"margin-top:14px\">Caricamento...</div></div>';",
  "  try{const r=await api('/api/client/contacts');document.getElementById('contactList').innerHTML=r.contacts.length?r.contacts.map(function(c){return '<div class=\"notice\"><b>'+esc(c.label)+'</b><br>'+esc(c.kind)+': '+esc(c.value)+(c.note?'<br><span class=\"muted\">'+esc(c.note)+'</span>':'')+'</div>';}).join(''):'<p class=\"muted\">Nessun contatto aggiuntivo inserito. Usa la chat interna.</p>'}catch(e){document.getElementById('contactList').innerHTML=note(e.message,'error')}",
  "}",
].join('\n') + '\n', 'contatti cliente');

addBefore('async function adminHelpers(){', [
  "async function adminContacts(){",
  "  const r=await api('/api/admin/contacts');",
  "  const rows=r.contacts.length?r.contacts.map(function(c){return '<tr><td>'+esc(c.label)+'</td><td>'+esc(c.kind)+'</td><td>'+esc(c.value)+'<br><span class=\"muted\">'+esc(c.note||'')+'</span></td><td>'+(c.active?'Visibile':'Archiviato')+'</td><td>'+(c.active?'<button class=\"btn small red\" onclick=\"archiveContact(\\\''+c.id+'\\\')\">Archivia</button>':'')+'</td></tr>';}).join(''):'<tr><td colspan=\"5\">Nessun contatto inserito.</td></tr>';",
  "  document.getElementById('main').innerHTML='<div class=\"row\"><div class=\"col4\"><div class=\"card\"><h2>Nuovo contatto</h2><form id=\"contactForm\"><label>Nome</label><input name=\"label\" required placeholder=\"WhatsApp, Email assistenza...\"><label>Tipo</label><select name=\"kind\"><option value=\"telefono\">Telefono</option><option value=\"whatsapp\">WhatsApp</option><option value=\"email\">Email</option><option value=\"altro\">Altro</option></select><label>Valore</label><input name=\"value\" required><label>Note</label><textarea name=\"note\"></textarea><label>Ordine</label><input name=\"sort_order\" type=\"number\" value=\"0\"><button class=\"btn\">Salva contatto</button></form></div></div><div class=\"col8\"><div class=\"card\"><h2>Contatti visibili ai clienti</h2><table><thead><tr><th>Nome</th><th>Tipo</th><th>Valore</th><th>Stato</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div></div>';",
  "  document.getElementById('contactForm').onsubmit=async e=>{e.preventDefault();await api('/api/admin/contacts',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});adminContacts()};",
  "}",
  "async function archiveContact(id){if(!confirm('Archiviare questo contatto?'))return;await api('/api/admin/contacts/'+id+'/archive',{method:'POST',body:'{}'});adminContacts()}",
].join('\n') + '\n', 'contatti admin');

let stripePatch = fs.readFileSync(stripePatchFile, 'utf8');
if (!stripePatch.includes('function sendPayment')) {
  stripePatch = stripePatch.replace('<a class="btn small gold" target="_blank" href="\\${p.payment_url}">Link</a> ', '<a class="btn small gold" target="_blank" href="\\${p.payment_url}">Link</a> <button class="btn small teal" onclick="sendPayment(\'\\${p.id}\')">Inoltra</button> ');
  stripePatch = stripePatch.replace('async function editPayment(id,oldDesc,oldAmount){', "async function sendPayment(id){await api('/api/admin/extra-payments/'+id+'/send',{method:'POST',body:'{}'});alert('Pagamento inoltrato al cliente')}\nasync function editPayment(id,oldDesc,oldAmount){");
  fs.writeFileSync(stripePatchFile, stripePatch);
}

fs.writeFileSync(file, html);
console.log('UI recupero password, contatti e chat aggiornata.');
