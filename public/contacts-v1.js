(function(){
  function contactTypeOptions(current){
    const types = [['telefono','Telefono'],['whatsapp','WhatsApp'],['email','Email'],['altro','Altro']];
    return types.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');
  }

  function contactLink(c){
    const value = String(c.value || '');
    if(c.kind === 'email') return `<a href="mailto:${esc(value)}">${esc(value)}</a>`;
    if(c.kind === 'telefono') return `<a href="tel:${esc(value)}">${esc(value)}</a>`;
    if(c.kind === 'whatsapp') {
      const phone = value.replace(/[^0-9+]/g,'');
      const normalized = phone.startsWith('+') ? phone.slice(1) : phone;
      return `<a target="_blank" href="https://wa.me/${normalized}">${esc(value)}</a>`;
    }
    return esc(value);
  }

  window.applyContactsV1 = function(){
    try {
      window.clientContacts = clientContacts = async function(){
        document.getElementById('main').innerHTML = `<div class="card"><h2>Contatti Home Care</h2><div class="notice success"><h3>Prima scelta: chat interna</h3><p>Per comunicazioni operative, richieste e aggiornamenti usa preferibilmente la chat interna Home Care. Così resta tutto tracciato nella tua area cliente.</p><button class="btn gold" onclick="clientSet('chat')">Apri chat Home Care</button></div><div id="contactList" class="card" style="box-shadow:none;margin-top:14px"><p>Caricamento contatti...</p></div></div>`;
        try {
          const r = await api('/api/client/contacts');
          document.getElementById('contactList').innerHTML = `<h3>Altri contatti</h3>${r.contacts.length ? r.contacts.map(c=>`<div class="notice"><b>${esc(c.label)}</b><br>${esc(c.kind)}: ${contactLink(c)}${c.note?`<br><span class="muted">${esc(c.note)}</span>`:''}</div>`).join('') : '<p class="muted">Nessun contatto aggiuntivo inserito. Usa la chat interna.</p>'}`;
        } catch(e) {
          document.getElementById('contactList').innerHTML = note(e.message,'error');
        }
      };

      window.adminContacts = adminContacts = async function(){
        const r = await api('/api/admin/contacts');
        const rows = r.contacts.length ? r.contacts.map(c=>`<tr><td><b>${esc(c.label)}</b><br><span class="muted">${esc(c.note||'')}</span></td><td>${esc(c.kind)}</td><td>${contactLink(c)}</td><td>${c.active?'<span class="badge ok">Visibile</span>':'<span class="badge bad">Archiviato</span>'}</td><td>${c.active?`<button class="btn small red" onclick="archiveContact('${c.id}')">Archivia</button>`:`<button class="btn small green" onclick="restoreContact('${c.id}')">Ripristina</button>`}</td></tr>`).join('') : '<tr><td colspan="5">Nessun contatto inserito.</td></tr>';
        document.getElementById('main').innerHTML = `<div class="row"><div class="col4"><div class="card"><h2>Nuovo contatto</h2><p class="muted">Questi contatti saranno visibili ai clienti nella pagina Contatti, sotto il consiglio di usare prima la chat interna.</p><form id="contactForm"><label>Nome contatto</label><input name="label" required placeholder="WhatsApp Home Care, Email assistenza..."><label>Tipo</label><select name="kind">${contactTypeOptions('whatsapp')}</select><label>Contatto</label><input name="value" required placeholder="Numero, email o riferimento"><label>Note visibili al cliente</label><textarea name="note" placeholder="Es. Per urgenze operative"></textarea><label>Ordine</label><input name="sort_order" type="number" value="0"><button class="btn green">Salva contatto</button></form></div></div><div class="col8"><div class="card"><h2>Contatti visibili ai clienti</h2><table><thead><tr><th>Nome</th><th>Tipo</th><th>Contatto</th><th>Stato</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
        document.getElementById('contactForm').onsubmit = async function(e){
          e.preventDefault();
          await api('/api/admin/contacts',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
          adminContacts();
        };
      };

      window.archiveContact = archiveContact = async function(id){
        if(!confirm('Archiviare questo contatto? Non sarà più visibile ai clienti.')) return;
        await api('/api/admin/contacts/'+id+'/archive',{method:'POST',body:'{}'});
        adminContacts();
      };

      window.restoreContact = restoreContact = async function(id){
        await api('/api/admin/contacts/'+id+'/restore',{method:'POST',body:'{}'});
        adminContacts();
      };

      window.clientShell = clientShell = async function(){
        app.innerHTML=topPrivate()+`<div class="layout">${side([{id:'home',label:'Home'},{id:'properties',label:'Immobili'},{id:'reports',label:'Report'},{id:'payments',label:'Pagamenti / Preventivi'},{id:'chat',label:'Chat Home Care'},{id:'contacts',label:'Contatti'}],S.clientTab,'clientSet')}<main class="main" id="main">Caricamento...</main></div>`;
        const d=await clientData();
        if(S.clientTab==='home')clientHome(d);
        if(S.clientTab==='properties')clientProperties(d);
        if(S.clientTab==='reports')clientReports(d);
        if(S.clientTab==='payments')clientPayments(d);
        if(S.clientTab==='chat')clientChat();
        if(S.clientTab==='contacts')clientContacts();
      };

      window.adminShell = adminShell = async function(){
        app.innerHTML=topPrivate()+`<div class="layout">${side([{id:'dashboard',label:'Dashboard'},{id:'requests',label:'Richieste immobili'},{id:'customers',label:'Clienti'},{id:'properties',label:'Immobili/GPS'},{id:'checks',label:'Controlli'},{id:'reports',label:'Report'},{id:'tasks',label:'Cose da fare'},{id:'route',label:'Giro'}].concat(S.user.role==='admin'?[{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'contacts',label:'Contatti'},{id:'helpers',label:'Aiutanti'}]:[]),S.tab,'adminSet')}<main class="main" id="main">Caricamento...</main></div>`;
        await loadBase();
        ({dashboard:adminDashboard,requests:adminRequests,customers:adminCustomers,properties:adminProperties,checks:adminChecks,reports:adminReports,tasks:adminTasks,route:adminRoute,payments:adminPayments,messages:adminMessages,contacts:adminContacts,helpers:adminHelpers}[S.tab]||adminDashboard)();
      };
    } catch(e) {
      console.warn('Contacts V1 non applicato:', e);
    }
  };
})();
