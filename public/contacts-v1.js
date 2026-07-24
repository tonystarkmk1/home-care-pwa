(function(){
  function contactTypeOptions(current){
    const types = [['telefono','Telefono'],['whatsapp','WhatsApp'],['email','Email'],['link','Link / sito'],['altro','Altro']];
    return types.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');
  }

  function ensureContactLinkStyles(){
    if(document.getElementById('homecare-contact-link-styles')) return;
    const style = document.createElement('style');
    style.id = 'homecare-contact-link-styles';
    style.textContent = `.contact-link{display:inline-flex;align-items:center;gap:6px;color:var(--teal);font-weight:1000;text-decoration:underline;text-underline-offset:3px;word-break:break-word}.contact-link:hover{filter:brightness(.88)}.contact-link.external:after{content:'↗';font-size:.9em;text-decoration:none}.contact-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.contact-copy{border:1px solid var(--line);background:#fffdf7;color:#06243a;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:900;cursor:pointer}`;
    document.head.appendChild(style);
  }

  function normalizeUrl(value){
    const raw = String(value || '').trim();
    if(!raw) return '';
    if(/^https?:\/\//i.test(raw)) return raw;
    if(/^www\./i.test(raw)) return 'https://' + raw;
    if(/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return 'https://' + raw;
    return '';
  }

  function whatsappHref(value){
    let phone = String(value || '').replace(/[^0-9+]/g,'');
    if(!phone) return '';
    if(phone.startsWith('+')) phone = phone.slice(1);
    // Numero mobile italiano scritto senza prefisso, es. 3511049598.
    if(/^3\d{8,10}$/.test(phone)) phone = '39' + phone;
    return `https://wa.me/${phone}`;
  }

  function contactLink(c){
    const value = String(c.value || '').trim();
    const safeValue = esc(value);
    if(!value) return '';
    if(c.kind === 'email') return `<a class="contact-link" href="mailto:${encodeURIComponent(value)}">${safeValue}</a>`;
    if(c.kind === 'telefono') {
      const phone = value.replace(/[^0-9+]/g,'');
      return `<a class="contact-link" href="tel:${esc(phone)}">${safeValue}</a>`;
    }
    if(c.kind === 'whatsapp') {
      const href = whatsappHref(value);
      return href ? `<a class="contact-link external" target="_blank" rel="noopener" href="${href}">${safeValue}</a>` : safeValue;
    }
    const url = normalizeUrl(value);
    if(c.kind === 'link' || c.kind === 'altro') {
      if(url) return `<a class="contact-link external" target="_blank" rel="noopener" href="${esc(url)}">${safeValue}</a>`;
    }
    return safeValue;
  }

  function contactActionLink(c){
    const value = String(c.value || '').trim();
    if(!value) return '';
    if(c.kind === 'whatsapp') return `<a class="btn small teal" target="_blank" rel="noopener" href="${whatsappHref(value)}">Apri WhatsApp</a>`;
    if(c.kind === 'email') return `<a class="btn small teal" href="mailto:${encodeURIComponent(value)}">Scrivi email</a>`;
    if(c.kind === 'telefono') return `<a class="btn small teal" href="tel:${esc(value.replace(/[^0-9+]/g,''))}">Chiama</a>`;
    const url = normalizeUrl(value);
    if(url) return `<a class="btn small teal" target="_blank" rel="noopener" href="${esc(url)}">Apri link</a>`;
    return '';
  }

  window.copyContactValue = async function(value){
    try {
      await navigator.clipboard.writeText(value);
      alert('Contatto copiato');
    } catch(_) {
      prompt('Copia il contatto:', value);
    }
  };

  window.applyContactsV1 = function(){
    try {
      ensureContactLinkStyles();
      window.clientContacts = clientContacts = async function(){
        document.getElementById('main').innerHTML = `<div class="card"><h2>Contatti Home Care</h2><div class="notice success"><h3>Prima scelta: chat interna</h3><p>Per comunicazioni operative, richieste e aggiornamenti usa preferibilmente la chat interna Home Care. Così resta tutto tracciato nella tua area cliente.</p><button class="btn gold" onclick="clientSet('chat')">Apri chat Home Care</button></div><div id="contactList" class="card" style="box-shadow:none;margin-top:14px"><p>Caricamento contatti...</p></div></div>`;
        try {
          const r = await api('/api/client/contacts');
          document.getElementById('contactList').innerHTML = `<h3>Altri contatti</h3>${r.contacts.length ? r.contacts.map(c=>`<div class="notice"><b>${esc(c.label)}</b><br>${esc(c.kind)}: ${contactLink(c)}${c.note?`<br><span class="muted">${esc(c.note)}</span>`:''}<div class="contact-actions" style="margin-top:10px">${contactActionLink(c)}<button class="contact-copy" type="button" onclick="copyContactValue('${esc(String(c.value||'')).replace(/'/g,'\\&#39;')}')">Copia</button></div></div>`).join('') : '<p class="muted">Nessun contatto aggiuntivo inserito. Usa la chat interna.</p>'}`;
        } catch(e) {
          document.getElementById('contactList').innerHTML = note(e.message,'error');
        }
      };

      window.adminContacts = adminContacts = async function(){
        ensureContactLinkStyles();
        const r = await api('/api/admin/contacts');
        const rows = r.contacts.length ? r.contacts.map(c=>`<tr><td><b>${esc(c.label)}</b><br><span class="muted">${esc(c.note||'')}</span></td><td>${esc(c.kind)}</td><td>${contactLink(c)}</td><td>${c.active?'<span class="badge ok">Visibile</span>':'<span class="badge bad">Archiviato</span>'}</td><td>${c.active?`<button class="btn small red" onclick="archiveContact('${c.id}')">Archivia</button>`:`<button class="btn small green" onclick="restoreContact('${c.id}')">Ripristina</button>`}</td></tr>`).join('') : '<tr><td colspan="5">Nessun contatto inserito.</td></tr>';
        document.getElementById('main').innerHTML = `<div class="row"><div class="col4"><div class="card"><h2>Nuovo contatto</h2><p class="muted">Questi contatti saranno visibili ai clienti nella pagina Contatti, sotto il consiglio di usare prima la chat interna.</p><form id="contactForm"><label>Nome contatto</label><input name="label" required placeholder="WhatsApp Home Care, Email assistenza..."><label>Tipo</label><select name="kind">${contactTypeOptions('whatsapp')}</select><label>Contatto</label><input name="value" required placeholder="Numero, email o link"><label>Note visibili al cliente</label><textarea name="note" placeholder="Es. Per urgenze operative"></textarea><label>Ordine</label><input name="sort_order" type="number" value="0"><button class="btn green">Salva contatto</button></form></div></div><div class="col8"><div class="card"><h2>Contatti visibili ai clienti</h2><table><thead><tr><th>Nome</th><th>Tipo</th><th>Contatto</th><th>Stato</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
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