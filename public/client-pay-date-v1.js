(function(){
  function fmtDate(value){
    if(!value) return '-';
    const text = String(value);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const date = new Date(text);
    if(Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString('it-IT');
  }

  function formatVisibleDates(root){
    const node = root || document.getElementById('main') || document.body;
    if(!node) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const toChange = [];
    while(walker.nextNode()) {
      const current = walker.currentNode;
      if(/\d{4}-\d{2}-\d{2}/.test(current.nodeValue || '')) toChange.push(current);
    }
    toChange.forEach((textNode)=>{
      textNode.nodeValue = textNode.nodeValue.replace(/(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?/g, '$3/$2/$1');
    });
  }

  function fixedPlans(){
    const keys = ['base','comfort','premium','villa_giardino','personalizzato'];
    return keys.filter((key)=>typeof P !== 'undefined' && P[key]);
  }

  function planSelectHtml(current){
    const selected = current || 'base';
    return `<select id="clientPlanSelect">${fixedPlans().map((key)=>`<option value="${key}" ${selected===key?'selected':''}>${P[key]} - ${PRICE[key] || ''}</option>`).join('')}</select>`;
  }

  function planPaymentBox(d){
    const current = d.customer?.current_package_type || 'base';
    const paid = Boolean(d.customer?.payment_valid);
    return `<div class="card" style="margin-top:14px"><h2>${paid?'Gestisci piano':'Riattiva il servizio'}</h2>${paid?'<p class="muted">Puoi cambiare piano o rinnovare scegliendo una delle opzioni qui sotto.</p>':'<div class="notice error"><b>Pagamento non regolare</b><br>Il servizio resta sospeso finché il pagamento non viene riattivato. Puoi pagare subito il tuo piano o scegliere un nuovo piano.</div>'}<label>Piano da pagare / attivare</label>${planSelectHtml(current)}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn gold" onclick="payClientPlan('monthly')">Paga mensile</button><button class="btn teal" onclick="payClientPlan('annual')">Paga annuale</button></div><p class="muted">Il pagamento mensile attiva o riattiva l’abbonamento. Il pagamento annuale calcola 12 mensilità.</p></div>`;
  }

  window.payClientPlan = async function(billing){
    try {
      const select = document.getElementById('clientPlanSelect');
      const package_type = select ? select.value : undefined;
      const result = await api('/api/client/plan-checkout', {
        method:'POST',
        body: JSON.stringify({ billing, package_type })
      });
      if(result.url) location.href = result.url;
      else alert('Link pagamento non disponibile.');
    } catch(error) {
      alert(error.message || 'Errore pagamento');
    }
  };

  window.applyClientPayDateV1 = function(){
    try {
      window.fmtDateIT = fmtDate;

      window.reportHtml = reportHtml = function(r){
        let photos=[];
        try{photos=Array.isArray(r.photo_urls)?r.photo_urls:JSON.parse(r.photo_urls||'[]')}catch(e){}
        let checklist=[];
        try{checklist=Array.isArray(r.checklist_json)?r.checklist_json:JSON.parse(r.checklist_json||'[]')}catch(e){}
        return `<div class="notice"><b>${esc(r.property_name)}</b> · ${fmtDate(r.completed_at)}<p>${esc(r.notes||'')}</p>${checklist.length?`<ul class="clean">${checklist.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<div class="photos">${photos.map(u=>`<a href="${u}" target="_blank"><img src="${u}"></a>`).join('')}</div></div>`;
      };

      window.clientHome = clientHome = function(d){
        const latest=d.reports.slice(0,3),pending=d.payments.filter(p=>p.status==='pending'),upcoming=d.properties.filter(p=>p.active).slice(0,5);
        document.getElementById('main').innerHTML=`<div class="grid"><div class="card"><h3>Stato</h3><span class="badge ${d.customer?.payment_valid?'ok':'bad'}">${d.customer?.payment_valid?'Pagamento regolare':'Pagamento non regolare'}</span><p>Piano cliente: <b>${P[d.customer?.current_package_type]||'Non ancora attivo'}</b></p></div><div class="card"><h3>Prossime scadenze</h3>${upcoming.length?upcoming.map(p=>`<p><b>${esc(p.name)}</b><br>Prossimo controllo: ${fmtDate(p.next_check_date)}</p>`).join(''):'<p>Nessun controllo pianificato.</p>'}</div><div class="card"><h3>Preventivi / extra da pagare</h3>${pending.length?pending.map(p=>`<p><b>${money(p.amount_cents)}</b><br>${esc(p.description)}${p.payment_url?`<br><a class="btn small gold" target="_blank" href="${p.payment_url}">Paga ora</a>`:''}</p>`).join(''):'<p>Nessun pagamento extra in sospeso.</p>'}</div></div>${planPaymentBox(d)}<div class="card" style="margin-top:14px"><h2>Ultimi report</h2>${latest.length?latest.map(reportHtml).join(''):'<p>Nessun report disponibile.</p>'}</div>`;
        formatVisibleDates();
      };

      window.clientPayments = clientPayments = function(d){
        const rows = d.payments.length ? `<table><thead><tr><th>Descrizione</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>${d.payments.map(p=>`<tr><td>${esc(p.description)}</td><td>${money(p.amount_cents)}</td><td><span class="badge ${p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn'}">${p.status==='pending'?'Da pagare':p.status==='paid'?'Pagato':p.status}</span></td><td>${p.status==='pending'&&p.payment_url?`<a class="btn small gold" target="_blank" href="${p.payment_url}">Paga ora</a>`:''}</td></tr>`).join('')}</tbody></table>` : '<p>Nessun preventivo o extra.</p>';
        document.getElementById('main').innerHTML=`${planPaymentBox(d)}<div class="card" style="margin-top:14px"><h2>Pagamenti / Preventivi manutenzione</h2>${rows}</div>`;
        formatVisibleDates();
      };

      const originalClientProperties = window.clientProperties || clientProperties;
      window.clientProperties = clientProperties = function(d){
        originalClientProperties(d);
        formatVisibleDates();
      };

      const originalAdminReports = window.adminReports || adminReports;
      if(typeof originalAdminReports === 'function') {
        window.adminReports = adminReports = async function(){
          await originalAdminReports();
          formatVisibleDates();
        };
      }
    } catch(error) {
      console.warn('ClientPayDate V1 non applicato:', error);
    }
  };
})();
