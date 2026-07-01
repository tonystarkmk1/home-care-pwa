const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Il pulsante “Richiedi questo servizio” non deve aprire genericamente login/registrazione.
// Deve salvare il servizio scelto e, se il cliente è già dentro, portarlo al modulo immobile.
html = html.split('onclick="authView(\'register\',\'${id}\')"').join('onclick="selectService(\'${id}\')"');

if (!html.includes('function selectService(id)')) {
  const insert = `
function selectService(id){
  localStorage.setItem('hc_selected_package',id);
  if(S.token&&S.user&&S.user.role==='client'){
    const box=document.getElementById('requestBox');
    if(box){
      const sel=document.querySelector('#clientProp select[name="package_type"]');
      if(sel)sel.value=id;
      const msg=document.getElementById('propMsg');
      if(msg)msg.innerHTML=note('Hai selezionato '+(pkg[id]||id)+'. Inserisci l’indirizzo dell’immobile per inviare la richiesta a Home Care.','success');
      box.scrollIntoView({behavior:'smooth'});
    }else{
      clientDash().then(()=>setTimeout(()=>selectService(id),100));
    }
  }else{
    authView('register',id);
  }
}
function applySelectedService(){
  const id=localStorage.getItem('hc_selected_package');
  if(!id)return;
  const sel=document.querySelector('#clientProp select[name="package_type"]');
  if(sel)sel.value=id;
}
`;
  html = html.replace('function planCards(){', insert + 'function planCards(){');
}

html = html.replace(';loadClientMessages()}catch(e){', ';loadClientMessages();applySelectedService()}catch(e){');
html = html.replace("box.innerHTML=note('Richiesta inviata. Home Care controllerà i dati e ti risponderà.','success');e.target.reset();", "box.innerHTML=note('Richiesta inviata. Home Care controllerà i dati e ti risponderà.','success');localStorage.removeItem('hc_selected_package');e.target.reset();");

fs.writeFileSync(indexPath, html);
console.log('UI patch applicata: richiesta servizio -> modulo immobile.');
