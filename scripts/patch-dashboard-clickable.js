const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const patch = `
async function adminDashboard(){
  const s=await api('/api/admin/summary');
  document.getElementById('main').innerHTML='<div class="grid">'+
    '<div class="card" onclick="adminSet(\\'customers\\')" style="cursor:pointer"><div class="muted">Clienti</div><div class="stat">'+s.customers+'</div></div>'+ 
    '<div class="card" onclick="adminSet(\\'requests\\')" style="cursor:pointer"><div class="muted">Richieste immobili</div><div class="stat">'+(s.pendingProperties||0)+'</div><button class="btn small gold" onclick="event.stopPropagation();adminSet(\\'requests\\')">Vai</button></div>'+ 
    '<div class="card" onclick="adminSet(\\'checks\\')" style="cursor:pointer"><div class="muted">Controlli da fare</div><div class="stat">'+s.dueChecks+'</div></div>'+ 
    '<div class="card" onclick="adminSet(\\'customers\\')" style="cursor:pointer"><div class="muted">Sospesi pagamento</div><div class="stat">'+s.blockedChecks+'</div></div>'+ 
    '<div class="card" onclick="adminSet(\\'tasks\\')" style="cursor:pointer"><div class="muted">Cose da fare</div><div class="stat">'+s.todoTasks+'</div></div>'+ 
    '</div>';
}
`;

if (!html.includes("onclick=\"adminSet(\\'checks\\')\"")) {
  html = html.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();", patch + "\nif('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();");
  console.log('Dashboard admin cliccabile aggiornata.');
} else {
  console.log('Dashboard admin cliccabile già presente.');
}

fs.writeFileSync(indexPath, html);
